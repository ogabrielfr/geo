# 📍 Cadê no Mapa?

Jogo de adivinhar lugares no mapa-múndi, inspirado nos clássicos jogos de geografia do Orkut.

O jogo mostra o nome de um lugar (cidade, capital, ponto turístico ou maravilha natural) e você tem
até 10 segundos para cravar um alfinete no mapa onde acha que ele fica. A pontuação depende da
**distância em km** do palpite e da **velocidade** do clique.

## Como rodar

Não precisa de servidor, build nem internet — é HTML/CSS/JS puro com o mapa embutido:

```
Abra o arquivo index.html no navegador. Pronto.
```

Se preferir servir localmente: `python3 -m http.server` na raiz do projeto e acesse `http://localhost:8000`.
O jogo também funciona direto no GitHub Pages (basta apontar o Pages para a raiz do repositório).

## Regras

- **5 rodadas por nível**, até **1.000 pts por rodada** (máximo 5.000 por nível).
- Pontuação da rodada: `(700 + 300 × fração_do_tempo_restante) × e^(−distância_km / 1500)`
  — errar por menos de 150 km já rende quase o máximo da parte de distância.
- Cada nível tem uma **meta mínima** para desbloquear o próximo (de 2.000 pts no nível 1 a 3.400 no nível 8).
- O tempo por rodada **diminui** conforme o nível: 10 s no primeiro, 5 s no último.
- Tempo esgotado = 0 pontos na rodada.
- Nos níveis 1 e 2 o jogo mostra o país como dica; do nível 3 em diante, só o nome do lugar.

## Níveis

| # | Nível | Tempo | Meta | Tema |
|---|-------|-------|------|------|
| 1 | Gigantes do Mapa | 10 s | 2.000 | Cidades que todo mundo conhece |
| 2 | Capitais Famosas | 9 s | 2.200 | Capitais do noticiário |
| 3 | Cartões-Postais | 8 s | 2.400 | Pontos turísticos clássicos |
| 4 | Cidades pelo Mundo | 7 s | 2.600 | Grandes cidades que não são capitais |
| 5 | Capitais Escondidas | 7 s | 2.800 | Capitais que pouca gente sabe apontar |
| 6 | Maravilhas Naturais | 6 s | 3.000 | A natureza não tem endereço |
| 7 | Cantos Remotos | 6 s | 3.200 | Fim do mundo |
| 8 | Nível Lenda | 5 s | 3.400 | Capitais que nem o Google acha de primeira |

Cada nível tem um pool de 12 lugares e sorteia 5 a cada partida — dá para rejogar sem decorar a sequência.
Progresso (níveis desbloqueados e recordes) fica salvo no `localStorage` do navegador.

## Estrutura

```
index.html        — telas do jogo (início, intro do nível, jogo, resumo)
css/style.css     — visual completo
js/world-data.js  — mapa-múndi em GeoJSON embutido (Natural Earth 110m, via world-atlas)
js/places.js      — banco com 96 lugares (coordenadas, categoria, bandeira e curiosidade)
js/game.js        — renderização do mapa em canvas, cronômetro, pontuação e fluxo de níveis
```

O mapa usa projeção equiretangular recortada (84° N a 56° S), desenhada em canvas a partir do
GeoJSON — sem tiles, sem dependências externas. Os efeitos sonoros são gerados por WebAudio,
sem arquivos de áudio.

## Créditos

Dados do mapa: [Natural Earth](https://www.naturalearthdata.com/) (domínio público),
empacotados pelo projeto [world-atlas](https://github.com/topojson/world-atlas).
