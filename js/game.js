/* ============ Cadê no Mapa? — lógica do jogo ============ */
(() => {
  'use strict';

  // ---------- constantes ----------
  const ROUNDS_PER_LEVEL = 5;
  const MAX_ROUND_PTS = 1000;
  const MAX_LEVEL_PTS = ROUNDS_PER_LEVEL * MAX_ROUND_PTS;
  const LAT_TOP = 84;    // recorte do mapa (sem polos vazios / Antártida)
  const LAT_BOTTOM = -56;
  const LAT_SPAN = LAT_TOP - LAT_BOTTOM;
  const MAP_ASPECT = 360 / LAT_SPAN;

  const CAT_LABEL = {
    capital: '⭐ Capital',
    cidade: '🏙️ Cidade',
    turistico: '🗿 Ponto turístico',
    natureza: '🏞️ Natureza',
  };

  const levelGoal = (i) => Math.round(MAX_LEVEL_PTS * (0.4 + i * 0.04) / 50) * 50;

  const fmt = (n) => n.toLocaleString('pt-BR');

  // ---------- persistência ----------
  const store = {
    get unlocked() { return Math.max(1, parseInt(localStorage.getItem('cnm_unlocked') || '1', 10)); },
    set unlocked(v) { localStorage.setItem('cnm_unlocked', String(v)); },
    get best() { try { return JSON.parse(localStorage.getItem('cnm_best') || '[]'); } catch { return []; } },
    set best(v) { localStorage.setItem('cnm_best', JSON.stringify(v)); },
    get muted() { return localStorage.getItem('cnm_muted') === '1'; },
    set muted(v) { localStorage.setItem('cnm_muted', v ? '1' : '0'); },
  };

  // ---------- áudio (WebAudio, sem arquivos) ----------
  const sfx = {
    ctx: null,
    ensure() {
      if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === 'suspended') this.ctx.resume();
    },
    tone(freq, dur, { type = 'sine', gain = 0.12, slideTo = null, delay = 0 } = {}) {
      if (store.muted) return;
      try {
        this.ensure();
        const t0 = this.ctx.currentTime + delay;
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t0);
        if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
        g.gain.setValueAtTime(gain, t0);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
        osc.connect(g).connect(this.ctx.destination);
        osc.start(t0);
        osc.stop(t0 + dur + 0.02);
      } catch { /* áudio bloqueado: segue o jogo */ }
    },
    tick() { this.tone(950, 0.04, { type: 'square', gain: 0.05 }); },
    plop() { this.tone(520, 0.16, { slideTo: 150, gain: 0.2 }); },
    good() { this.tone(523, 0.1); this.tone(659, 0.1, { delay: 0.09 }); this.tone(784, 0.16, { delay: 0.18 }); },
    bad() { this.tone(320, 0.22, { slideTo: 170, gain: 0.15, type: 'triangle' }); },
    fanfare() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.18, { delay: i * 0.13 })); },
  };

  // ---------- geometria ----------
  const haversineKm = (lat1, lng1, lat2, lng2) => {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  };

  const easeOutBounce = (t) => {
    const n1 = 7.5625, d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  };
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

  // ---------- renderizador do mapa ----------
  class WorldMap {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.base = document.createElement('canvas'); // cache do mapa base
      this.w = 0; this.h = 0; this.dpr = 1;
      this.overlay = null; // { guess:{x,y}, target:{x,y}, phase, t0 }
      this._raf = null;
      window.addEventListener('resize', () => this.resize());
    }

    project(lat, lng) {
      return [ (lng + 180) / 360 * this.w, (LAT_TOP - lat) / LAT_SPAN * this.h ];
    }
    unproject(x, y) {
      return [ LAT_TOP - (y / this.h) * LAT_SPAN, (x / this.w) * 360 - 180 ];
    }

    resize() {
      const box = this.canvas.parentElement.getBoundingClientRect();
      if (box.width < 10 || box.height < 10) return;
      let cw = box.width, ch = cw / MAP_ASPECT;
      if (ch > box.height) { ch = box.height; cw = ch * MAP_ASPECT; }
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.style.width = cw + 'px';
      this.canvas.style.height = ch + 'px';
      this.w = Math.round(cw * this.dpr);
      this.h = Math.round(ch * this.dpr);
      this.canvas.width = this.w;
      this.canvas.height = this.h;
      this.renderBase();
      this.draw();
    }

    renderBase() {
      const { w, h } = this;
      this.base.width = w; this.base.height = h;
      const ctx = this.base.getContext('2d');

      // oceano
      const sea = ctx.createLinearGradient(0, 0, 0, h);
      sea.addColorStop(0, '#0c2240');
      sea.addColorStop(1, '#123156');
      ctx.fillStyle = sea;
      ctx.fillRect(0, 0, w, h);

      // graticule (meridianos/paralelos a cada 30°)
      ctx.strokeStyle = 'rgba(150, 190, 235, 0.07)';
      ctx.lineWidth = 1;
      for (let lng = -150; lng <= 150; lng += 30) {
        const [x] = this.project(0, lng);
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      }
      for (let lat = -30; lat <= 60; lat += 30) {
        const [, y] = this.project(lat, 0);
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }

      // países
      ctx.lineWidth = Math.max(0.6, this.dpr * 0.5);
      ctx.strokeStyle = 'rgba(8, 20, 38, 0.9)';

      // desenha um anel "desembrulhando" longitudes que cruzam o antimeridiano
      // e repete o traçado deslocado para cobrir a borda oposta do mapa
      const traceRing = (ring) => {
        let prevLng = ring[0][0], offset = 0;
        const pts = [];
        let minX = Infinity, maxX = -Infinity;
        for (let j = 0; j < ring.length; j++) {
          let lng = ring[j][0] + offset;
          if (lng - prevLng > 180) { lng -= 360; offset -= 360; }
          else if (lng - prevLng < -180) { lng += 360; offset += 360; }
          prevLng = lng;
          const [x, y] = this.project(ring[j][1], lng);
          pts.push([x, y]);
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
        }
        const shifts = [0];
        if (minX < 0) shifts.push(this.w);
        if (maxX > this.w) shifts.push(-this.w);
        for (const sh of shifts) {
          for (let j = 0; j < pts.length; j++) {
            j === 0 ? ctx.moveTo(pts[j][0] + sh, pts[j][1]) : ctx.lineTo(pts[j][0] + sh, pts[j][1]);
          }
          ctx.closePath();
        }
      };

      const feats = window.WORLD_GEOJSON.features;
      for (let i = 0; i < feats.length; i++) {
        const f = feats[i];
        let hash = 0;
        for (const c of f.properties.name) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
        const hue = 95 + (hash % 46);            // verdes/oliva variados
        const light = 30 + (hash % 9);
        ctx.fillStyle = `hsl(${hue}, 30%, ${light}%)`;
        ctx.beginPath();
        const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
        for (const poly of polys) {
          for (const ring of poly) traceRing(ring);
        }
        ctx.fill();
        ctx.stroke();
      }
    }

    setOverlay(overlay) {
      this.overlay = overlay ? { ...overlay, t0: performance.now() } : null;
      this.animate();
    }

    animate() {
      if (this._raf) cancelAnimationFrame(this._raf);
      const loop = () => {
        this.draw();
        // continua animando enquanto houver alvo pulsando ou pino caindo
        if (this.overlay) this._raf = requestAnimationFrame(loop);
      };
      this._raf = requestAnimationFrame(loop);
    }

    // desenha segmento respeitando a volta do mundo (antimeridiano)
    wrappedLine(ctx, x1, y1, x2, y2, progress) {
      let tx = x2;
      if (tx - x1 > this.w / 2) tx -= this.w;
      if (tx - x1 < -this.w / 2) tx += this.w;
      const ex = x1 + (tx - x1) * progress;
      const ey = y1 + (y2 - y1) * progress;
      const shift = x2 - tx; // 0 se não cruza a borda
      for (const off of shift === 0 ? [0] : [0, shift]) {
        ctx.beginPath();
        ctx.moveTo(x1 + off, y1);
        ctx.lineTo(ex + off, ey);
        ctx.stroke();
      }
      return [ex, ey];
    }

    drawPin(ctx, x, y, scale = 1, drop = 1) {
      const s = Math.max(this.h / 260, 3.2) * scale;
      const rise = (1 - easeOutBounce(Math.min(drop, 1))) * -12 * s;
      const py = y + rise;
      ctx.save();
      // sombra no chão
      ctx.fillStyle = `rgba(0,0,0,${0.35 * Math.min(drop, 1)})`;
      ctx.beginPath();
      ctx.ellipse(x, y + s * 0.6, s * 1.6, s * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
      // haste + cabeça
      ctx.beginPath();
      ctx.moveTo(x, py);
      ctx.quadraticCurveTo(x - s * 2.4, py - s * 3.4, x, py - s * 6.4);
      ctx.quadraticCurveTo(x + s * 2.4, py - s * 3.4, x, py);
      ctx.fillStyle = '#ff4d5e';
      ctx.strokeStyle = '#7d0f1c';
      ctx.lineWidth = s * 0.35;
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, py - s * 4.3, s * 1.05, 0, Math.PI * 2);
      ctx.fillStyle = '#ffe9eb';
      ctx.fill();
      ctx.restore();
    }

    drawTarget(ctx, x, y, t) {
      const s = Math.max(this.h / 260, 3.2);
      ctx.save();
      // pulso expandindo
      const pulse = (t % 1200) / 1200;
      ctx.beginPath();
      ctx.arc(x, y, s * (2 + pulse * 5), 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 194, 71, ${0.55 * (1 - pulse)})`;
      ctx.lineWidth = s * 0.5;
      ctx.stroke();
      // alvo
      const rings = [[2.6, '#ffffff'], [1.9, '#ff4d5e'], [1.2, '#ffffff'], [0.55, '#ff4d5e']];
      for (const [r, color] of rings) {
        ctx.beginPath();
        ctx.arc(x, y, s * r, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      }
      ctx.restore();
    }

    draw() {
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.w, this.h);
      ctx.drawImage(this.base, 0, 0);
      const ov = this.overlay;
      if (!ov) return;
      const t = performance.now() - ov.t0;

      if (ov.guess) {
        const [gx, gy] = this.project(ov.guess.lat, ov.guess.lng);
        if (ov.target && t > 250) {
          const [tx, ty] = this.project(ov.target.lat, ov.target.lng);
          const progress = easeOutCubic(Math.min((t - 250) / 550, 1));
          ctx.save();
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
          ctx.lineWidth = Math.max(this.dpr * 1.2, 1.5);
          ctx.setLineDash([6 * this.dpr, 5 * this.dpr]);
          this.wrappedLine(ctx, gx, gy, tx, ty, progress);
          ctx.restore();
          if (progress >= 1) this.drawTarget(ctx, tx, ty, t);
        }
        this.drawPin(ctx, gx, gy, 1, t / 350);
      } else if (ov.target) {
        // tempo esgotado: só revela o alvo
        const [tx, ty] = this.project(ov.target.lat, ov.target.lng);
        this.drawTarget(ctx, tx, ty, t);
      }
    }
  }

  // ---------- elementos ----------
  const $ = (id) => document.getElementById(id);
  const screens = {
    start: $('screen-start'),
    intro: $('screen-intro'),
    game: $('screen-game'),
    summary: $('screen-summary'),
  };
  const show = (name) => {
    Object.values(screens).forEach((s) => s.classList.remove('active'));
    screens[name].classList.add('active');
    if (name === 'game') requestAnimationFrame(() => map.resize());
  };

  const map = new WorldMap($('map'));

  // ---------- estado ----------
  const game = {
    levelIdx: 0,
    roundIdx: 0,
    places: [],
    score: 0,
    rounds: [],          // { place, dist, pts }
    phase: 'idle',       // idle | guessing | reveal
    timerRaf: null,
    timeTotal: 10,
    timeLeft: 10,
    lastTickSec: null,
  };

  const pickPlaces = (level) => {
    const pool = [...level.places];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, ROUNDS_PER_LEVEL);
  };

  const computeScore = (distKm, timeFrac) =>
    Math.round((700 + 300 * timeFrac) * Math.exp(-distKm / 1500));

  const distMessage = (d) => {
    if (d < 150) return ['🎯', 'Na mosca!'];
    if (d < 500) return ['🔥', 'Muito perto!'];
    if (d < 1500) return ['👍', 'Boa! Quase lá.'];
    if (d < 3000) return ['😅', 'Hmm, foi longe...'];
    return ['🙈', 'Outro continente!'];
  };

  // ---------- tela inicial ----------
  function renderStart() {
    const grid = $('level-grid');
    grid.innerHTML = '';
    const unlocked = store.unlocked;
    const best = store.best;
    window.LEVELS.forEach((lv, i) => {
      const tile = document.createElement('button');
      tile.className = 'level-tile';
      const goal = levelGoal(i);
      const b = best[i] || 0;
      if (i + 1 > unlocked) tile.classList.add('locked');
      if (b >= goal) tile.classList.add('done');
      tile.innerHTML = `
        <span class="lt-num">${i + 1 > unlocked ? '🔒' : i + 1}</span>
        <span class="lt-name">${lv.name}</span>
        <span class="lt-best">${b ? fmt(b) : ''}</span>`;
      tile.addEventListener('click', () => {
        if (i + 1 > unlocked) return;
        sfx.tick();
        openIntro(i);
      });
      grid.appendChild(tile);
    });
    const total = best.reduce((a, b) => a + (b || 0), 0);
    $('best-info').innerHTML = total
      ? `Sua melhor campanha soma <strong>${fmt(total)} pts</strong> · nível máximo desbloqueado: <strong>${Math.min(unlocked, 8)}</strong>`
      : 'Primeira vez? Comece pelo nível 1 e desbloqueie o mundo. 🌎';
    $('btn-mute').textContent = store.muted ? '🔇' : '🔊';
  }

  // ---------- fluxo de nível ----------
  function openIntro(idx) {
    game.levelIdx = idx;
    const lv = window.LEVELS[idx];
    $('intro-kicker').textContent = `Nível ${idx + 1} de ${window.LEVELS.length}`;
    $('intro-name').textContent = lv.name;
    $('intro-desc').textContent = lv.desc;
    $('intro-time').textContent = `${lv.time}s`;
    $('intro-goal').textContent = fmt(levelGoal(idx));
    show('intro');
  }

  function startLevel() {
    const lv = window.LEVELS[game.levelIdx];
    game.places = pickPlaces(lv);
    game.roundIdx = 0;
    game.score = 0;
    game.rounds = [];
    $('hud-level').textContent = `Nível ${game.levelIdx + 1} · ${lv.name}`;
    $('hud-score').textContent = '0';
    show('game');
    startRound();
  }

  function startRound() {
    const lv = window.LEVELS[game.levelIdx];
    const place = game.places[game.roundIdx];
    game.phase = 'guessing';
    game.timeTotal = lv.time;
    game.timeLeft = lv.time;
    game.lastTickSec = null;

    $('hud-round').textContent = `Rodada ${game.roundIdx + 1}/${ROUNDS_PER_LEVEL}`;
    $('hud-cat').textContent = CAT_LABEL[place.cat] || place.cat;
    $('hud-place').textContent = place.name;
    // dica de país só nos 2 primeiros níveis
    $('hud-hint').textContent = game.levelIdx < 2 ? `${place.flag} ${place.country}` : '';
    $('result-card').classList.add('hidden');
    $('map').classList.remove('locked');
    map.setOverlay(null);

    const start = performance.now();
    const tick = () => {
      const elapsed = (performance.now() - start) / 1000;
      game.timeLeft = Math.max(0, game.timeTotal - elapsed);
      updateTimerUI();
      if (game.timeLeft <= 0) { onTimeout(); return; }
      game.timerRaf = requestAnimationFrame(tick);
    };
    game.timerRaf = requestAnimationFrame(tick);
  }

  function updateTimerUI() {
    const frac = game.timeLeft / game.timeTotal;
    const fill = $('timerfill');
    fill.style.width = `${frac * 100}%`;
    const hue = Math.round(140 * frac); // verde → vermelho
    fill.style.background = `hsl(${hue}, 75%, 48%)`;
    $('timertext').textContent = game.timeLeft.toFixed(1).replace('.', ',');
    $('timerbar').classList.toggle('urgent', game.timeLeft <= 3 && game.phase === 'guessing');
    const sec = Math.ceil(game.timeLeft);
    if (sec <= 3 && sec !== game.lastTickSec && game.phase === 'guessing') {
      game.lastTickSec = sec;
      sfx.tick();
    }
  }

  function stopTimer() {
    if (game.timerRaf) cancelAnimationFrame(game.timerRaf);
    game.timerRaf = null;
    $('timerbar').classList.remove('urgent');
  }

  function onGuess(lat, lng) {
    if (game.phase !== 'guessing') return;
    game.phase = 'reveal';
    stopTimer();
    const place = game.places[game.roundIdx];
    const dist = haversineKm(lat, lng, place.lat, place.lng);
    const timeFrac = game.timeLeft / game.timeTotal;
    const pts = computeScore(dist, timeFrac);

    map.setOverlay({ guess: { lat, lng }, target: { lat: place.lat, lng: place.lng } });
    $('map').classList.add('locked');
    sfx.plop();
    setTimeout(() => (dist < 1500 ? sfx.good() : sfx.bad()), 750);
    setTimeout(() => showResult(place, dist, pts), 850);
  }

  function onTimeout() {
    if (game.phase !== 'guessing') return;
    game.phase = 'reveal';
    stopTimer();
    game.timeLeft = 0;
    updateTimerUI();
    const place = game.places[game.roundIdx];
    map.setOverlay({ target: { lat: place.lat, lng: place.lng } });
    $('map').classList.add('locked');
    sfx.bad();
    showResult(place, null, 0);
  }

  function showResult(place, dist, pts) {
    game.rounds.push({ place, dist, pts });
    const [emoji, msg] = dist === null ? ['⏰', 'Tempo esgotado!'] : distMessage(dist);
    $('result-emoji').textContent = emoji;
    $('result-msg').textContent = msg;
    $('result-dist').textContent = dist === null
      ? 'Você não cravou o alfinete a tempo.'
      : `Seu palpite ficou a ${fmt(Math.round(dist))} km de ${place.name}.`;
    $('result-pts').textContent = `+${fmt(pts)}`;
    $('result-fact').textContent = `${place.flag} ${place.country} · ${place.fact}`;
    $('btn-next').textContent = game.roundIdx + 1 >= ROUNDS_PER_LEVEL ? 'Ver resultado do nível →' : 'Próxima rodada →';
    $('result-card').classList.remove('hidden');

    // contagem animada dos pontos
    const startScore = game.score;
    game.score += pts;
    const t0 = performance.now();
    const count = () => {
      const t = Math.min((performance.now() - t0) / 600, 1);
      $('hud-score').textContent = fmt(Math.round(startScore + pts * easeOutCubic(t)));
      if (t < 1) requestAnimationFrame(count);
    };
    requestAnimationFrame(count);
  }

  function nextRound() {
    if (game.phase !== 'reveal') return;
    game.roundIdx++;
    if (game.roundIdx >= ROUNDS_PER_LEVEL) endLevel();
    else startRound();
  }

  function endLevel() {
    game.phase = 'idle';
    map.setOverlay(null);
    const idx = game.levelIdx;
    const goal = levelGoal(idx);
    const passed = game.score >= goal;
    const isLast = idx === window.LEVELS.length - 1;

    // persistência
    const best = store.best;
    best[idx] = Math.max(best[idx] || 0, game.score);
    store.best = best;
    if (passed && idx + 2 > store.unlocked) store.unlocked = Math.min(idx + 2, window.LEVELS.length);

    $('summary-badge').textContent = passed ? (isLast ? '🏆' : '🎉') : '😿';
    $('summary-title').textContent = passed
      ? (isLast ? 'Você zerou o jogo!' : `Nível ${idx + 1} concluído!`)
      : 'Não foi dessa vez...';
    $('summary-sub').textContent = passed
      ? (isLast
        ? 'Das ruas de Paris a Funafuti: o mapa-múndi não tem mais segredos para você.'
        : `Você desbloqueou o nível ${idx + 2}: ${window.LEVELS[idx + 1].name}.`)
      : `Faltaram ${fmt(goal - game.score)} pts para a meta. Bora tentar de novo!`;
    $('summary-points').textContent = fmt(game.score);
    $('summary-goal-label').textContent = `Meta do nível: ${fmt(goal)} pts`;

    const fill = $('summary-meter-fill');
    fill.classList.toggle('fail', !passed);
    fill.style.width = '0';
    $('summary-meter-goal').style.left = `${(goal / MAX_LEVEL_PTS) * 100}%`;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => { fill.style.width = `${Math.min(game.score / MAX_LEVEL_PTS, 1) * 100}%`; })
    );

    const list = $('summary-rounds');
    list.innerHTML = '';
    for (const r of game.rounds) {
      const li = document.createElement('li');
      li.innerHTML = `
        <span class="sr-place">${r.place.flag} ${r.place.name}</span>
        <span class="sr-dist">${r.dist === null ? '⏰ tempo' : fmt(Math.round(r.dist)) + ' km'}</span>
        <span class="sr-pts">${fmt(r.pts)}</span>`;
      list.appendChild(li);
    }

    $('btn-summary-next').classList.toggle('hidden', !passed || isLast);
    $('btn-summary-retry').textContent = passed ? 'Jogar de novo' : 'Tentar de novo';
    show('summary');
    passed ? sfx.fanfare() : sfx.bad();
  }

  // ---------- eventos ----------
  $('map').addEventListener('pointerdown', (e) => {
    if (game.phase !== 'guessing') return;
    const rect = map.canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width * map.w;
    const y = (e.clientY - rect.top) / rect.height * map.h;
    const [lat, lng] = map.unproject(x, y);
    onGuess(lat, lng);
  });

  $('btn-play').addEventListener('click', () => {
    sfx.ensure();
    // começa no nível mais alto ainda não concluído (ou o último desbloqueado)
    openIntro(Math.min(store.unlocked, window.LEVELS.length) - 1);
  });
  $('btn-start-level').addEventListener('click', () => { sfx.ensure(); startLevel(); });
  $('btn-intro-back').addEventListener('click', () => { renderStart(); show('start'); });
  $('btn-next').addEventListener('click', nextRound);
  $('btn-how').addEventListener('click', () => $('modal-how').classList.remove('hidden'));
  $('btn-how-close').addEventListener('click', () => $('modal-how').classList.add('hidden'));
  $('modal-how').addEventListener('click', (e) => { if (e.target === $('modal-how')) $('modal-how').classList.add('hidden'); });
  $('btn-mute').addEventListener('click', () => {
    store.muted = !store.muted;
    $('btn-mute').textContent = store.muted ? '🔇' : '🔊';
    sfx.tick();
  });
  $('btn-summary-next').addEventListener('click', () => openIntro(game.levelIdx + 1));
  $('btn-summary-retry').addEventListener('click', () => openIntro(game.levelIdx));
  $('btn-summary-menu').addEventListener('click', () => { renderStart(); show('start'); });

  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && game.phase === 'reveal' && !$('result-card').classList.contains('hidden')) {
      e.preventDefault();
      nextRound();
    }
  });

  // ---------- bootstrap ----------
  renderStart();
  map.resize();
})();
