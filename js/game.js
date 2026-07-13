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
  // espaço do mapa: coordenadas fixas independentes de zoom/tela
  const MAP_W = 1000;
  const MAP_H = MAP_W / MAP_ASPECT;

  const CAT_LABEL = {
    capital: '⭐ Capital',
    cidade: '🏙️ Cidade',
    turistico: '🗿 Ponto turístico',
    natureza: '🏞️ Natureza',
  };

  const levelGoal = (i) => Math.round(MAX_LEVEL_PTS * (0.4 + i * 0.03) / 50) * 50;
  const MAX_ATTEMPTS = 3;

  const fmt = (n) => n.toLocaleString('pt-BR');
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

  // ---------- desafio diário ----------
  // A data local vira a "chave do dia": ela reseta o progresso à meia-noite
  // e semeia o sorteio dos lugares — todo mundo joga o mesmo desafio no dia.
  const dayKey = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const challengeNum = () =>
    Math.floor((new Date(`${dayKey()}T00:00:00`) - new Date('2026-01-01T00:00:00')) / 864e5) + 1;

  const hashStr = (s) => {
    let h = 1779033703 ^ s.length;
    for (let i = 0; i < s.length; i++) {
      h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return h >>> 0;
  };
  // PRNG determinístico (mulberry32)
  const mulberry32 = (a) => () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // ---------- persistência ----------
  const store = {
    // progresso do dia: {day, used, best, bestLevel, passed[]} — descartado quando vira o dia
    get daily() {
      try {
        const d = JSON.parse(localStorage.getItem('cnm_daily') || 'null');
        if (d && d.day === dayKey()) return d;
      } catch { /* estado corrompido: recomeça */ }
      return { day: dayKey(), used: 0, best: 0, bestLevel: 0, passed: [] };
    },
    set daily(v) { localStorage.setItem('cnm_daily', JSON.stringify(v)); },
    // recorde histórico (sobrevive à virada do dia)
    get record() {
      try { return JSON.parse(localStorage.getItem('cnm_record') || 'null') || { score: 0, day: '' }; }
      catch { return { score: 0, day: '' }; }
    },
    set record(v) { localStorage.setItem('cnm_record', JSON.stringify(v)); },
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
  const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

  /* ---------- renderizador do mapa com pan/zoom ----------
   * O mapa vive em coordenadas próprias (MAP_W × MAP_H). A "view"
   * {z, tx, ty} converte para pixels do canvas: tela = mapa·z + t.
   * Gestos: 1 dedo arrasta (pan), pinça dá zoom, toque parado crava;
   * no desktop, rolagem do mouse dá zoom e o clique parado crava.
   */
  class WorldMap {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.dpr = 1; this.w = 0; this.h = 0;
      this.view = { z: 1, tx: 0, ty: 0 };
      this.zMin = 1; this.zCover = 1; this.zMax = 1;
      this.coarse = window.matchMedia('(pointer: coarse)').matches;
      this.overlay = null;   // { guess:{lat,lng}, target:{lat,lng}, t0 }
      this.anim = null;      // animação da view { from, to, t0, dur }
      this.onTap = null;     // callback (lat, lng)
      this.pointers = new Map();
      this.pinch = null;
      this._raf = null;
      this.paths = this.buildPaths();
      this.bindEvents();
      window.addEventListener('resize', () => this.resize());
    }

    // lat/lng → coordenadas do mapa (fixas)
    project(lat, lng) {
      return [(lng + 180) / 360 * MAP_W, (LAT_TOP - lat) / LAT_SPAN * MAP_H];
    }
    toScreen(mx, my) {
      const v = this.view;
      return [mx * v.z + v.tx, my * v.z + v.ty];
    }
    fromScreen(sx, sy) {
      const v = this.view;
      return [(sx - v.tx) / v.z, (sy - v.ty) / v.z];
    }
    unproject(sx, sy) {
      const [mx, my] = this.fromScreen(sx, sy);
      const lng = clamp(mx / MAP_W * 360 - 180, -180, 180);
      const lat = clamp(LAT_TOP - my / MAP_H * LAT_SPAN, LAT_BOTTOM, LAT_TOP);
      return [lat, lng];
    }

    // pré-constrói um Path2D por país em coordenadas do mapa, com
    // longitudes "desembrulhadas" no antimeridiano e cópia deslocada
    // para cobrir a borda oposta
    buildPaths() {
      const traceRing = (path, ring) => {
        let prev = ring[0][0], off = 0;
        const pts = [];
        let minX = Infinity, maxX = -Infinity;
        for (const [lngRaw, lat] of ring) {
          let lng = lngRaw + off;
          if (lng - prev > 180) { lng -= 360; off -= 360; }
          else if (lng - prev < -180) { lng += 360; off += 360; }
          prev = lng;
          const [x, y] = this.project(lat, lng);
          pts.push([x, y]);
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
        }
        const shifts = [0];
        if (minX < 0) shifts.push(MAP_W);
        if (maxX > MAP_W) shifts.push(-MAP_W);
        for (const s of shifts) {
          pts.forEach(([x, y], i) => (i ? path.lineTo(x + s, y) : path.moveTo(x + s, y)));
          path.closePath();
        }
      };
      return window.WORLD_GEOJSON.features.map((f) => {
        let hash = 0;
        for (const c of f.properties.name) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
        const path = new Path2D();
        const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
        for (const poly of polys) for (const ring of poly) traceRing(path, ring);
        return { path, fill: `hsl(${95 + (hash % 46)}, 30%, ${30 + (hash % 9)}%)` };
      });
    }

    resize() {
      const box = this.canvas.parentElement.getBoundingClientRect();
      if (box.width < 10 || box.height < 10) return;
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.w = Math.round(box.width * this.dpr);
      this.h = Math.round(box.height * this.dpr);
      this.canvas.width = this.w;
      this.canvas.height = this.h;
      this.zMin = Math.min(this.w / MAP_W, this.h / MAP_H);   // mundo inteiro visível
      this.zCover = Math.max(this.w / MAP_W, this.h / MAP_H); // preenche a tela
      this.zMax = this.zMin * 20;
      this.resetView();
    }

    // visão inicial: celular (toque) abre preenchendo a tela; desktop, mundo inteiro
    resetView() {
      this.anim = null;
      const z = this.coarse ? this.zCover : this.zMin;
      this.view.z = z;
      this.view.tx = (this.w - MAP_W * z) / 2;
      this.view.ty = (this.h - MAP_H * z) / 2;
      this.clampView();
      this.requestDraw();
    }

    clampView() {
      const v = this.view, W = MAP_W * v.z, H = MAP_H * v.z;
      v.tx = W <= this.w ? (this.w - W) / 2 : clamp(v.tx, this.w - W, 0);
      v.ty = H <= this.h ? (this.h - H) / 2 : clamp(v.ty, this.h - H, 0);
    }

    zoomAt(sx, sy, factor) {
      this.anim = null;
      const v = this.view;
      const z = clamp(v.z * factor, this.zMin, this.zMax);
      const k = z / v.z;
      v.tx = sx - (sx - v.tx) * k;
      v.ty = sy - (sy - v.ty) * k;
      v.z = z;
      this.clampView();
      this.requestDraw();
    }

    panBy(dx, dy) {
      this.anim = null;
      this.view.tx += dx;
      this.view.ty += dy;
      this.clampView();
      this.requestDraw();
    }

    // anima a view para enquadrar um conjunto de pontos {lat,lng}
    fitTo(points, { bottomPad = 0 } = {}) {
      const coords = points.map((p) => this.project(p.lat, p.lng));
      let minX = Math.min(...coords.map((c) => c[0])), maxX = Math.max(...coords.map((c) => c[0]));
      let minY = Math.min(...coords.map((c) => c[1])), maxY = Math.max(...coords.map((c) => c[1]));
      // caixa mínima para não dar zoom infinito em pontos próximos
      const minBox = MAP_W * 0.12;
      if (maxX - minX < minBox) { const c = (minX + maxX) / 2; minX = c - minBox / 2; maxX = c + minBox / 2; }
      if (maxY - minY < minBox / MAP_ASPECT) { const c = (minY + maxY) / 2; minY = c - minBox / MAP_ASPECT / 2; maxY = c + minBox / MAP_ASPECT / 2; }
      const pad = 40 * this.dpr;
      const availW = this.w - 2 * pad;
      const availH = this.h - 2 * pad - bottomPad;
      const z = clamp(Math.min(availW / (maxX - minX), availH / (maxY - minY)), this.zMin, this.zMax);
      const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
      const to = { z, tx: this.w / 2 - cx * z, ty: (this.h - bottomPad) / 2 - cy * z };
      // aplica o mesmo clamp do alvo antes de animar
      const save = { ...this.view };
      Object.assign(this.view, to); this.clampView(); const clamped = { ...this.view };
      Object.assign(this.view, save);
      this.anim = { from: { ...this.view }, to: clamped, t0: performance.now(), dur: 550 };
      this.requestDraw();
    }

    // ---------- gestos ----------
    bindEvents() {
      const c = this.canvas;
      const pos = (e) => {
        const r = c.getBoundingClientRect();
        return [(e.clientX - r.left) * this.dpr, (e.clientY - r.top) * this.dpr];
      };

      c.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        try { c.setPointerCapture(e.pointerId); } catch { /* ok */ }
        const [x, y] = pos(e);
        this.pointers.set(e.pointerId, { x, y, sx: x, sy: y, moved: false, pinched: false, t0: performance.now() });
        if (this.pointers.size === 2) {
          const [a, b] = [...this.pointers.values()];
          a.pinched = b.pinched = true;
          this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
        }
      });

      c.addEventListener('pointermove', (e) => {
        const p = this.pointers.get(e.pointerId);
        if (!p) return;
        const [x, y] = pos(e);
        const dx = x - p.x, dy = y - p.y;
        p.x = x; p.y = y;
        if (Math.hypot(x - p.sx, y - p.sy) > 8 * this.dpr) p.moved = true;
        if (this.pointers.size === 1) {
          if (p.moved) this.panBy(dx, dy);
        } else if (this.pinch) {
          const [a, b] = [...this.pointers.values()];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
          this.panBy(cx - this.pinch.cx, cy - this.pinch.cy);
          if (this.pinch.d > 0) this.zoomAt(cx, cy, d / this.pinch.d);
          this.pinch = { d, cx, cy };
        }
      });

      const up = (e) => {
        const p = this.pointers.get(e.pointerId);
        if (!p) return;
        this.pointers.delete(e.pointerId);
        if (this.pointers.size < 2) this.pinch = null;
        // toque/clique parado e curto = palpite
        if (!p.moved && !p.pinched && performance.now() - p.t0 < 600 && this.onTap) {
          const [lat, lng] = this.unproject(p.x, p.y);
          this.onTap(lat, lng);
        }
      };
      c.addEventListener('pointerup', up);
      c.addEventListener('pointercancel', (e) => { this.pointers.delete(e.pointerId); this.pinch = null; });

      c.addEventListener('wheel', (e) => {
        e.preventDefault();
        const [x, y] = pos(e);
        this.zoomAt(x, y, Math.exp(-e.deltaY * 0.0018));
      }, { passive: false });
    }

    // ---------- desenho ----------
    requestDraw() {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => {
        this._raf = null;
        this.draw();
        if (this.overlay || this.anim) this.requestDraw(); // pulso do alvo / animação da view
      });
    }

    stepAnim() {
      if (!this.anim) return;
      const a = this.anim;
      const t = Math.min((performance.now() - a.t0) / a.dur, 1);
      const k = easeInOut(t);
      this.view.z = a.from.z + (a.to.z - a.from.z) * k;
      this.view.tx = a.from.tx + (a.to.tx - a.from.tx) * k;
      this.view.ty = a.from.ty + (a.to.ty - a.from.ty) * k;
      if (t >= 1) this.anim = null;
    }

    drawPin(ctx, x, y, drop = 1) {
      const s = Math.max(3.6 * this.dpr, 4);
      const rise = (1 - easeOutBounce(Math.min(drop, 1))) * -12 * s;
      const py = y + rise;
      ctx.save();
      ctx.fillStyle = `rgba(0,0,0,${0.35 * Math.min(drop, 1)})`;
      ctx.beginPath();
      ctx.ellipse(x, y + s * 0.6, s * 1.6, s * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
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
      const s = Math.max(3.6 * this.dpr, 4);
      ctx.save();
      const pulse = (t % 1200) / 1200;
      ctx.beginPath();
      ctx.arc(x, y, s * (2 + pulse * 5), 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 194, 71, ${0.55 * (1 - pulse)})`;
      ctx.lineWidth = s * 0.5;
      ctx.stroke();
      const rings = [[2.6, '#ffffff'], [1.9, '#ff4d5e'], [1.2, '#ffffff'], [0.55, '#ff4d5e']];
      for (const [r, color] of rings) {
        ctx.beginPath();
        ctx.arc(x, y, s * r, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      }
      ctx.restore();
    }

    // linha tracejada respeitando a volta do mundo
    wrappedLine(ctx, x1, y1, x2, y2, progress) {
      const wrapW = MAP_W * this.view.z;
      let tx = x2;
      if (tx - x1 > wrapW / 2) tx -= wrapW;
      if (tx - x1 < -wrapW / 2) tx += wrapW;
      const ex = x1 + (tx - x1) * progress;
      const ey = y1 + (y2 - y1) * progress;
      const shift = x2 - tx;
      for (const off of shift === 0 ? [0] : [0, shift]) {
        ctx.beginPath();
        ctx.moveTo(x1 + off, y1);
        ctx.lineTo(ex + off, ey);
        ctx.stroke();
      }
    }

    setOverlay(overlay) {
      this.overlay = overlay ? { ...overlay, t0: performance.now() } : null;
      this.requestDraw();
    }

    draw() {
      this.stepAnim();
      const ctx = this.ctx, v = this.view;
      // fundo fora do mapa: mais escuro, para delimitar a área jogável
      ctx.fillStyle = '#081527';
      ctx.fillRect(0, 0, this.w, this.h);

      // oceano (retângulo do mapa na tela)
      const [x0, y0] = this.toScreen(0, 0);
      const [x1, y1] = this.toScreen(MAP_W, MAP_H);
      const sea = ctx.createLinearGradient(0, y0, 0, y1);
      sea.addColorStop(0, '#0c2240');
      sea.addColorStop(1, '#123156');
      ctx.fillStyle = sea;
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);

      // graticule a cada 30°
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, y0, x1 - x0, y1 - y0);
      ctx.clip();
      ctx.strokeStyle = 'rgba(150, 190, 235, 0.07)';
      ctx.lineWidth = 1;
      for (let lng = -150; lng <= 150; lng += 30) {
        const [gx] = this.toScreen(...this.project(0, lng));
        ctx.beginPath(); ctx.moveTo(gx, y0); ctx.lineTo(gx, y1); ctx.stroke();
      }
      for (let lat = -30; lat <= 60; lat += 30) {
        const [, gy] = this.toScreen(...this.project(lat, 0));
        ctx.beginPath(); ctx.moveTo(x0, gy); ctx.lineTo(x1, gy); ctx.stroke();
      }
      ctx.restore();

      // países (Path2D em coordenadas do mapa, transformados pela view)
      ctx.save();
      ctx.translate(v.tx, v.ty);
      ctx.scale(v.z, v.z);
      ctx.strokeStyle = 'rgba(8, 20, 38, 0.9)';
      ctx.lineWidth = Math.max(0.6, this.dpr * 0.5) / v.z;
      for (const p of this.paths) {
        ctx.fillStyle = p.fill;
        ctx.fill(p.path);
        ctx.stroke(p.path);
      }
      ctx.restore();

      // sobreposição: alfinete, alvo e linha (em pixels de tela)
      const ov = this.overlay;
      if (!ov) return;
      const t = performance.now() - ov.t0;
      if (ov.guess) {
        const [gx, gy] = this.toScreen(...this.project(ov.guess.lat, ov.guess.lng));
        if (ov.target && t > 250) {
          const [tx, ty] = this.toScreen(...this.project(ov.target.lat, ov.target.lng));
          const progress = easeOutCubic(Math.min((t - 250) / 550, 1));
          ctx.save();
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
          ctx.lineWidth = Math.max(this.dpr * 1.2, 1.5);
          ctx.setLineDash([6 * this.dpr, 5 * this.dpr]);
          this.wrappedLine(ctx, gx, gy, tx, ty, progress);
          ctx.restore();
          if (progress >= 1) this.drawTarget(ctx, tx, ty, t);
        }
        this.drawPin(ctx, gx, gy, t / 350);
      } else if (ov.target) {
        const [tx, ty] = this.toScreen(...this.project(ov.target.lat, ov.target.lng));
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
    roundStartAt: 0,     // proteção contra toques acidentais logo no início
    attemptScore: 0,     // total acumulado da tentativa (todos os níveis)
    attemptNum: 1,       // 1..3
    attemptCounted: false, // a tentativa só é debitada na 1ª rodada jogada
  };

  // sorteio determinístico: mesma data + mesmo nível = mesmos 5 lugares,
  // para qualquer jogador, em qualquer aparelho
  const pickPlaces = (level, levelIdx) => {
    const rng = mulberry32(hashStr(`${dayKey()}#${levelIdx}`));
    const pool = [...level.places];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, ROUNDS_PER_LEVEL);
  };

  // 50% distância + 50% velocidade: cravar perto e devagar rende no máx. ~500;
  // perto E rápido chega a 1.000
  const computeScore = (distKm, timeFrac) =>
    Math.round((500 + 500 * timeFrac) * Math.exp(-distKm / 1500));

  const distMessage = (d) => {
    if (d < 150) return ['🎯', 'Na mosca!'];
    if (d < 500) return ['🔥', 'Muito perto!'];
    if (d < 1500) return ['👍', 'Boa! Quase lá.'];
    if (d < 3000) return ['😅', 'Hmm, foi longe...'];
    return ['🙈', 'Outro continente!'];
  };

  // ---------- tela inicial (painel do desafio do dia) ----------
  function renderStart() {
    const daily = store.daily;
    const left = MAX_ATTEMPTS - daily.used;
    const d = new Date();
    $('daily-num').textContent = `🌍 Desafio #${challengeNum()}`;
    $('daily-date').textContent = d.toLocaleDateString('pt-BR');
    $('daily-tries').textContent = '🎯'.repeat(left) + '✖'.repeat(daily.used);
    $('daily-best').textContent = daily.best ? fmt(daily.best) : '—';
    $('daily-record').textContent = store.record.score ? fmt(store.record.score) : '—';

    // grade de níveis: mostra até onde você chegou HOJE (só visual)
    const grid = $('level-grid');
    grid.innerHTML = '';
    window.LEVELS.forEach((lv, i) => {
      const tile = document.createElement('div');
      tile.className = 'level-tile';
      const done = !!daily.passed[i];
      const reached = i <= daily.bestLevel;
      if (done) tile.classList.add('done');
      if (!reached && !done) tile.classList.add('locked');
      tile.innerHTML = `
        <span class="lt-num">${done || reached ? i + 1 : '🔒'}</span>
        <span class="lt-name">${lv.name}</span>
        <span class="lt-best"></span>`;
      grid.appendChild(tile);
    });

    const play = $('btn-play');
    if (left > 0) {
      play.disabled = false;
      play.textContent = daily.used === 0 ? '▶ Jogar o desafio de hoje' : `▶ Nova tentativa (resta${left > 1 ? 'm' : ''} ${left})`;
      $('best-info').innerHTML = daily.used === 0
        ? 'Todo dia, um desafio novo — o mesmo para todo mundo. Você tem <strong>3 tentativas</strong>, do nível 1 até onde aguentar. 🌎'
        : `Melhor de hoje: <strong>${fmt(daily.best)} pts</strong>. Cada tentativa recomeça do nível 1 — vale a melhor!`;
    } else {
      play.disabled = true;
      play.textContent = '⏳ Tentativas esgotadas';
      const mid = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
      const mins = Math.ceil((mid - d) / 60000);
      $('best-info').innerHTML = `Você fez <strong>${fmt(daily.best)} pts</strong> hoje. Novo desafio em <strong>${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}</strong>. 🌙`;
    }
    $('btn-mute').textContent = store.muted ? '🔇' : '🔊';
  }

  // ---------- tentativa (campanha do nível 1 em diante) ----------
  function startAttempt() {
    const daily = store.daily;
    if (daily.used >= MAX_ATTEMPTS) { renderStart(); return; }
    game.attemptScore = 0;
    game.attemptCounted = false;
    game.attemptNum = daily.used + 1;
    openIntro(0);
  }

  // ---------- fluxo de nível ----------
  function openIntro(idx) {
    game.levelIdx = idx;
    const lv = window.LEVELS[idx];
    $('intro-kicker').textContent = `Nível ${idx + 1} de ${window.LEVELS.length} · Tentativa ${game.attemptNum}/${MAX_ATTEMPTS}`;
    $('intro-name').textContent = lv.name;
    $('intro-desc').textContent = lv.desc;
    $('intro-time').textContent = `${lv.time}s`;
    $('intro-goal').textContent = fmt(levelGoal(idx));
    show('intro');
  }

  function startLevel() {
    // debita a tentativa na primeira rodada de fato jogada (voltar da
    // tela de intro não gasta tentativa; recarregar no meio, sim)
    if (!game.attemptCounted) {
      const daily = store.daily;
      if (daily.used >= MAX_ATTEMPTS) { renderStart(); show('start'); return; }
      daily.used++;
      store.daily = daily;
      game.attemptCounted = true;
    }
    const lv = window.LEVELS[game.levelIdx];
    game.places = pickPlaces(lv, game.levelIdx);
    game.roundIdx = 0;
    game.score = 0;
    game.rounds = [];
    $('hud-level').textContent = `Nível ${game.levelIdx + 1}/8 · ${lv.name}`;
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
    game.roundStartAt = performance.now();

    $('hud-round').textContent = `Rodada ${game.roundIdx + 1}/${ROUNDS_PER_LEVEL}`;
    $('hud-cat').textContent = CAT_LABEL[place.cat] || place.cat;
    $('hud-place').textContent = place.name;
    // dica de país só nos 2 primeiros níveis
    $('hud-hint').textContent = game.levelIdx < 2 ? `${place.flag} ${place.country}` : '';
    $('result-card').classList.add('hidden');
    map.setOverlay(null);
    map.resetView();

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

  // enquadra palpite + alvo sem esconder atrás do cartão de resultado
  const revealPad = () => ({ bottomPad: (map.coarse ? 260 : 120) * map.dpr });

  function onGuess(lat, lng) {
    if (game.phase !== 'guessing') return;
    game.phase = 'reveal';
    stopTimer();
    const place = game.places[game.roundIdx];
    const dist = haversineKm(lat, lng, place.lat, place.lng);
    const timeFrac = game.timeLeft / game.timeTotal;
    const pts = computeScore(dist, timeFrac);

    map.setOverlay({ guess: { lat, lng }, target: { lat: place.lat, lng: place.lng } });
    map.fitTo([{ lat, lng }, { lat: place.lat, lng: place.lng }], revealPad());
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
    map.fitTo([{ lat: place.lat, lng: place.lng }], revealPad());
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
    game.attemptScore += game.score;

    // persistência do dia + recorde histórico
    const daily = store.daily;
    if (passed) {
      daily.passed[idx] = true;
      daily.bestLevel = Math.max(daily.bestLevel, Math.min(idx + 1, window.LEVELS.length - 1));
    }
    daily.best = Math.max(daily.best, game.attemptScore);
    store.daily = daily;
    if (game.attemptScore > store.record.score) store.record = { score: game.attemptScore, day: dayKey() };

    const left = MAX_ATTEMPTS - daily.used;
    const attemptOver = !passed || isLast;

    $('summary-badge').textContent = passed ? (isLast ? '🏆' : '🎉') : '😿';
    $('summary-title').textContent = passed
      ? (isLast ? 'Você zerou o desafio de hoje!' : `Nível ${idx + 1} concluído!`)
      : `Fim da tentativa ${game.attemptNum}...`;
    $('summary-sub').textContent = passed
      ? (isLast
        ? 'Das ruas de Paris a Funafuti: o mapa de hoje não tem mais segredos.'
        : `Valendo! Próxima parada: nível ${idx + 2}, ${window.LEVELS[idx + 1].name}.`)
      : `Faltaram ${fmt(goal - game.score)} pts para a meta do nível ${idx + 1}.` +
        (left > 0 ? ` Você ainda tem ${left} tentativa${left > 1 ? 's' : ''} hoje.` : ' Amanhã tem desafio novo!');
    $('summary-points').textContent = fmt(game.score);
    $('summary-goal-label').textContent = `Meta do nível: ${fmt(goal)} pts`;
    $('summary-attempt').textContent = `Total da tentativa: ${fmt(game.attemptScore)} pts` +
      (attemptOver && game.attemptScore >= daily.best && daily.used > 1 ? ' · melhor de hoje! 🏅' : '');

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

    // campanha: passou (e não é o último) → próximo nível;
    // falhou ou zerou → nova tentativa, se ainda houver
    $('btn-summary-next').classList.toggle('hidden', !passed || isLast);
    const retry = $('btn-summary-retry');
    retry.classList.toggle('hidden', !attemptOver || left <= 0);
    retry.textContent = isLast && passed
      ? `Melhorar pontuação (resta${left > 1 ? 'm' : ''} ${left})`
      : `Nova tentativa (resta${left > 1 ? 'm' : ''} ${left})`;
    show('summary');
    passed ? sfx.fanfare() : sfx.bad();
  }

  // ---------- eventos ----------
  map.onTap = (lat, lng) => {
    if (game.phase !== 'guessing') return;
    // ignora toques "fantasma" logo após a rodada começar (ex.: dedo que
    // ainda estava descendo no botão "Próxima rodada")
    if (performance.now() - game.roundStartAt < 300) return;
    onGuess(lat, lng);
  };

  $('btn-zoom-in').addEventListener('click', () => map.zoomAt(map.w / 2, map.h / 2, 1.6));
  $('btn-zoom-out').addEventListener('click', () => map.zoomAt(map.w / 2, map.h / 2, 1 / 1.6));

  $('btn-play').addEventListener('click', () => { sfx.ensure(); startAttempt(); });
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
  $('btn-summary-retry').addEventListener('click', () => { sfx.ensure(); startAttempt(); });
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

  // gancho de depuração/testes
  window.__CNM = { map, game };
})();
