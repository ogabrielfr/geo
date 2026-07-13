# 📍 Cadê no Mapa?

Jogo **diário** de adivinhar lugares no mapa-múndi, inspirado nos clássicos jogos de geografia do Orkut.

O jogo mostra o nome de um lugar (cidade, capital, ponto turístico ou maravilha natural) e você tem
10 segundos para cravar um alfinete no mapa onde acha que ele fica. A pontuação depende da
**distância em km** do palpite e da **velocidade** — metade dos pontos vem do relógio.

**Todo dia, um desafio novo.** Os lugares são sorteados usando a data como semente, então o desafio
do dia é **o mesmo para todo mundo** — dá para competir com os amigos. Você tem **3 tentativas por
dia**, cada uma começando do nível 1: passou da meta, avança de nível; falhou, a tentativa acaba.
Vale a melhor pontuação do dia. À meia-noite, tudo zera e nasce um desafio novo (só o recorde
histórico sobrevive).

Funciona em desktop e celular. O mapa tem **pan e zoom**: arraste para explorar, faça pinça
(ou use a rolagem do mouse) para aproximar — e **um toque/clique parado crava o palpite**.
No celular o mapa abre grande, preenchendo a tela; o relógio corre enquanto você navega, então
explorar demais custa bônus. Após o palpite, a câmera enquadra automaticamente o seu alfinete e o
lugar certo.

## Como rodar

Não precisa de servidor, build nem internet — é HTML/CSS/JS puro com o mapa embutido:

```
Abra o arquivo index.html no navegador. Pronto.
```

Se preferir servir localmente: `python3 -m http.server` na raiz do projeto e acesse `http://localhost:8000`.

### Publicar no GitHub Pages

Por ser um site estático servido da raiz, a publicação usa o modo **Deploy from a branch** (sem workflow):
em **Settings → Pages → Build and deployment**, escolha **Source: Deploy from a branch** e
**Branch: `main` / `/ (root)`**. O GitHub publica em `https://<usuário>.github.io/geo/` e reconstrói
sozinho a cada push na `main`.

## Regras

- **Desafio diário**: 5 lugares por nível, sorteados de pools de 24 usando a data como semente
  (determinístico — todo jogador vê os mesmos lugares no mesmo dia).
- **3 tentativas por dia**, cada uma começando do nível 1. A tentativa é debitada na primeira
  rodada jogada. Vale a melhor pontuação; à meia-noite local, o progresso do dia zera.
- **5 rodadas por nível**, até **1.000 pts por rodada** (máximo 5.000 por nível).
- **10 segundos por rodada em todos os níveis** — a dificuldade cresce pelos lugares, não pelo relógio.
- Pontuação da rodada: `(500 + 500 × fração_do_tempo_restante) × e^(−distância_km / 1500)`
  — 50% distância, 50% velocidade. Cravar perto mas devagar rende no máximo ~500; perto **e** rápido, até 1.000.
- Cada nível tem uma **meta mínima** para avançar (de 2.000 pts no nível 1 a 3.050 no nível 8);
  falhar a meta encerra a tentativa.
- Tempo esgotado sem palpite = 0 pontos.
- Nos níveis 1 e 2 o jogo mostra o país como dica; do nível 3 em diante, só o nome do lugar.

## Níveis

| # | Nível | Meta | Tema |
|---|-------|------|------|
| 1 | Gigantes do Mapa | 2.000 | Cidades que todo mundo conhece |
| 2 | Capitais Famosas | 2.150 | Capitais do noticiário |
| 3 | Cartões-Postais | 2.300 | Pontos turísticos clássicos |
| 4 | Cidades pelo Mundo | 2.450 | Grandes cidades que não são capitais |
| 5 | Capitais Escondidas | 2.600 | Capitais que pouca gente sabe apontar |
| 6 | Maravilhas Naturais | 2.750 | A natureza não tem endereço |
| 7 | Cantos Remotos | 2.900 | Fim do mundo |
| 8 | Nível Lenda | 3.050 | Capitais que nem o Google acha de primeira |

Cada nível tem um pool de 24 lugares (192 no total) e o desafio do dia sorteia 5 de cada.
Progresso (níveis desbloqueados e recordes) fica salvo no `localStorage` do navegador.

## Estrutura

```
index.html        — telas do jogo (início, intro do nível, jogo, resumo)
css/style.css     — visual completo
js/world-data.js  — mapa-múndi em GeoJSON embutido (Natural Earth 110m, via world-atlas)
js/places.js      — banco com 192 lugares (coordenadas, categoria, bandeira e curiosidade)
js/game.js        — renderização do mapa em canvas, cronômetro, pontuação e fluxo de níveis
```

O mapa usa projeção equiretangular recortada (84° N a 56° S), desenhada em canvas a partir do
GeoJSON — sem tiles, sem dependências externas. Os efeitos sonoros são gerados por WebAudio,
sem arquivos de áudio.

## Créditos

Dados do mapa: [Natural Earth](https://www.naturalearthdata.com/) (domínio público),
empacotados pelo projeto [world-atlas](https://github.com/topojson/world-atlas).
