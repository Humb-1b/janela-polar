# Janela Polar

Ferramenta para comparar locais de pouso no polo sul da Lua: **quando há Sol** para gerar energia e **quando a Terra está acima do horizonte** para comunicação direta (DTE) com a Deep Space Network. Projeto para o desafio do NASA Space Apps Challenge 2026.

**O que dá para fazer:**

- Escolher entre as 9 regiões candidatas da Artemis III, pousos recentes (IM-1, IM-2, Blue Ghost 1, Chandrayaan-3, SLIM, Chang'e 4 e 6), as Apollo 11, 15 e 17, ou digitar qualquer coordenada.
- Ver o Sol e a Terra em relação ao horizonte de cada local, num mapa polar ou da Lua inteira, numa vista do horizonte e numa linha do tempo animada.
- Saber quanto falta para o pôr do Sol e para o pôr da Terra, a elevação do Sol e o tamanho da sombra de uma pessoa naquele momento.
- Comparar locais no mesmo período, numa tabela com energia solar, tempo de contato direto, noite mais longa e um índice.
- Encontrar a melhor data de pouso: um mapa de calor mostra, para cada dia dos próximos meses, que fração da missão teria Sol e contato.
- Fixar cenários (local + data) e compará-los lado a lado. Serve, por exemplo, para comparar o plano original com as alternativas depois de um atraso.
- Explicações em linguagem simples para educadores e para o público.
- **Da Terra à Lua** (`terra-lua.html`): vista de cima da Terra e da órbita da Lua em anéis de distância, com as bases de lançamento do Kennedy, de Wallops, de Vandenberg e de Alcântara girando com a Terra. Simula a viagem (rápida, ~3 dias, ou econômica, ~5 dias), mostra o gráfico tempo × distância e compara as bases: empurrão da rotação da Terra, inclinação mínima e se a Lua está no céu.

As posições do Sol e da Terra vêm da **JPL Horizons API** (efeméride DE441, a mesma usada pela JPL em planejamento de missões). Se a Horizons não responder, o app continua funcionando com um modelo analítico embutido e mostra qual fonte está em uso.

**Versão online:** https://humb-1b.github.io/janela-polar/ (sem instalar nada; dados pré-calculados da Horizons, renovados todo dia)

## Rodando em 2 minutos

Requisitos: Python 3.10+ e Git.

```bash
git clone https://github.com/Humb-1b/janela-polar.git
cd janela-polar/backend
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python -m app                      # abre em http://127.0.0.1:5000
```

O servidor entrega a página e a API juntos. A **primeira** consulta de um período faz 2 chamadas à Horizons por local, mais 3 para as antenas da DSN, e leva de 30 s a 1 min; depois tudo vem do cache em `backend/.cache/`.

Antes de tudo, confirme que a Horizons aceita as consultas do app:

```bash
python scripts/horizons_probe.py          # da raiz do repositório
```

Ele mostra a elevação do Sol em Malapert pela Horizons e pelo modelo analítico, lado a lado. Diferenças de até ~0,3° são normais.

## Estrutura

```
janela-polar/
├── backend/                  API em Flask
│   ├── app/
│   │   ├── __init__.py       create_app(): monta o Flask, CORS e serve o frontend
│   │   ├── __main__.py       `python -m app` (servidor de desenvolvimento)
│   │   ├── api.py            rotas /api/* (validação de parâmetros e respostas)
│   │   ├── horizons.py       cliente da JPL Horizons: monta a consulta, lê o CSV, repete em falha
│   │   ├── analytic.py       modelo analítico (Meeus) para uso offline
│   │   ├── ephemeris.py      junta tudo num "pacote": Sol e Terra por local + Lua por antena DSN
│   │   ├── windows.py        regras das janelas: fração do disco solar, DTE, estatísticas, índice
│   │   ├── sites.py          lê sites.json e as máscaras de horizonte
│   │   ├── cache.py          cache em disco das respostas da Horizons
│   │   └── config.py         variáveis de ambiente
│   ├── data/
│   │   ├── sites.json        locais candidatos + antenas DSN (fonte única dos locais)
│   │   └── horizon_masks/    máscaras de relevo opcionais (<id>.csv)
│   ├── tests/                testes (unittest; também rodam com pytest)
│   ├── wsgi.py               entrada para gunicorn em produção
│   └── requirements.txt
├── frontend/                 sem etapa de build: HTML, CSS e JS puros
│   ├── index.html            estrutura da página
│   ├── css/app.css           visual (cores com tema claro e escuro)
│   ├── js/engine.js          cálculos astronômicos (mesma matemática de backend/app/analytic.py)
│   ├── js/app.js             interface: mapas, painel, linha do tempo, planejador, cenários
│   ├── terra-lua.html        página Da Terra à Lua (bases de lançamento e viagem)
│   ├── js/terra-lua.js       simulação dessa página (usa js/engine.js)
│   ├── tests/engine.test.mjs testa o motor JS contra os valores do Python (node --test)
│   ├── config.js             endereço do backend quando hospedado separado
│   └── data/                 pacotes pré-calculados (gerados por scripts/precompute.py)
├── scripts/
│   ├── horizons_probe.py     testa uma consulta real à Horizons
│   ├── precompute.py         gera frontend/data/bundle-*.json para uso sem backend
│   ├── sites_from_shapefiles.py  centro oficial das regiões a partir das grades do USGS
│   └── horizon_mask_from_dem.py  calcula o horizonte real de cada local a partir de um DEM do LOLA
├── docs/api.md               referência da API com exemplos
├── Dockerfile
└── .github/workflows/tests.yml   roda os testes a cada push
```

## Como os dados fluem

```
navegador ──GET /api/bundle?start=…&days=30──▶ Flask
                                               │  para cada local: Sol (10) e Terra (399) vistos de coord@301
                                               │  para cada antena DSN: Lua (301) vista de coord@399
                                               ▼
                                   JPL Horizons API ──▶ cache em disco
                                               │ (se falhar: modelo analítico + aviso)
                                               ▼
navegador ◀── séries horárias de elevação/azimute ── calcula janelas ao mover os controles
```

O frontend tenta três fontes, nesta ordem, e o selo no topo da página diz qual está em uso:

1. **API** (`/api/bundle`): dados da Horizons.
2. **Arquivo pré-calculado** (`frontend/data/bundle-AAAA-MM-DD-30d.json`): para GitHub Pages ou se a internet cair.
3. **Cálculo no navegador**: modelo analítico, sempre disponível.

O mapa de iluminação e o planejador de datas usam sempre o modelo analítico: precisariam de milhares de pontos ou de meses de dados por local, e seria pesado consultar a Horizons para tudo isso.

Locais personalizados e cenários fixados ficam guardados só no navegador de quem os criou (localStorage).

## A consulta à Horizons

Cada série é uma efeméride de observador com azimute e elevação (quantidade 4) para um ponto na superfície:

```
https://ssd.jpl.nasa.gov/api/horizons.api?format=json
  &COMMAND='10'                 Sol (Terra = '399', Lua = '301')
  &EPHEM_TYPE='OBSERVER'
  &CENTER='coord@301'           observador na superfície da Lua
  &COORD_TYPE='GEODETIC'
  &SITE_COORD='3,-85.9,0'       longitude leste, latitude, altitude (km)
  &START_TIME='2026-11-08 00:00'&STOP_TIME='2026-12-08 00:00'&STEP_SIZE='60 m'
  &QUANTITIES='4'&ANG_FORMAT='DEG'&CSV_FORMAT='YES'&APPARENT='AIRLESS'
```

A API é pública e não pede chave. A JPL pede uso moderado, por isso o backend faz no máximo 2 consultas ao mesmo tempo (`HORIZONS_WORKERS`) e guarda tudo em cache.

## Configuração

| Variável | Padrão | Para quê |
|---|---|---|
| `JANELA_PROVIDER` | `auto` | `auto` (Horizons, com reserva analítica), `horizons` (só Horizons; erro 503 se falhar) ou `analytic` (offline) |
| `HORIZONS_TIMEOUT` | `60` | segundos por consulta |
| `HORIZONS_WORKERS` | `2` | consultas simultâneas |
| `JANELA_CACHE_DIR` | `backend/.cache` | onde guardar as respostas |

## Testes

```bash
cd backend
pip install -r requirements-dev.txt
python -m pytest            # ou: python -m unittest discover -s tests -t .
```

O motor JavaScript tem seus próprios testes (Node 18+):

```bash
node --test frontend/tests/*.test.mjs
```

Os testes não acessam a internet: a Horizons é simulada. `tests/fixtures/horizons_sun_from_moon.txt` é uma amostra **sintética** no formato da Horizons. Troque por uma resposta real assim que puderem:

```bash
python scripts/horizons_probe.py --save backend/tests/fixtures/real_sun_mal.txt
```

## Relevo real (o maior ganho de precisão)

Sem máscara, cada local tem horizonte liso. No polo isso superestima o Sol, porque montanhas a dezenas de km bloqueiam um Sol que fica a 1–2° de altura. Para usar o relevo:

1. Baixe um DEM polar estereográfico do polo sul em GeoTIFF (LOLA, via [NASA PGDA](https://pgda.gsfc.nasa.gov/) ou PDS Geosciences Node), cobrindo ~150 km ao redor dos locais.
2. Gere as máscaras:
   ```bash
   pip install -r scripts/requirements.txt
   python scripts/horizon_mask_from_dem.py caminho/DEM.tif --all
   ```
3. Reinicie o backend. O painel do local passa a mostrar o perfil do relevo no gráfico do horizonte.

## Antes do dia da apresentação

- Rode `python scripts/precompute.py --start <data> --days 30` para as datas que vão mostrar. O app funciona mesmo sem internet.
- Troque as coordenadas aproximadas pelas oficiais. A NASA não publica uma tabela com os centros, mas o USGS publicou as
  grades de navegação de cada região ([doi:10.5066/P1MEQ6UK](https://doi.org/10.5066/P1MEQ6UK)). Baixe os shapefiles e rode:
  ```bash
  python scripts/sites_from_shapefiles.py pasta_ou_zip_dos_shapefiles           # compara
  python scripts/sites_from_shapefiles.py pasta_ou_zip_dos_shapefiles --write   # grava em sites.json
  ```

## Deploy

**Tudo junto (Render, Railway, Fly.io):** use o `Dockerfile` da raiz. O app escuta na porta `$PORT` (padrão 8000).

```bash
docker build -t janela-polar .
docker run -p 8000:8000 janela-polar
```

**GitHub Pages (já configurado):** `.github/workflows/pages.yml` publica a pasta `frontend/` a cada envio para a `main` e todo dia às 03:17 UTC. Antes de publicar, gera com a Horizons o pacote dos 30 dias a partir do dia (UTC), então a versão online mostra dados da NASA para quem abrir com a data de hoje. Para outras datas, ela usa o cálculo do navegador. Para publicar de novo na hora: aba **Actions → publicar no GitHub Pages → Run workflow**.

**Separado:** frontend no GitHub Pages (publique a pasta `frontend/`) e backend em outro serviço. Coloque a URL do backend em `frontend/config.js`.

## Limitações conhecidas

- Coordenadas das regiões Artemis III aproximadas.
- O modelo analítico ignora nutação e libração física (erro de ~0,1–0,3°).
- O raio do disco solar é fixo em 0,2666° (varia ±1,7% ao longo do ano).
- Os locais de pouso de outras missões são a posição do módulo segundo a NASA NSSDC; as regiões Artemis III ainda estão aproximadas.
- A visibilidade das antenas DSN no modo analítico é geocêntrica (erro de até ~1° pela paralaxe da Lua). Com a Horizons é topocêntrica.

## Créditos dos dados

JPL Horizons (NASA/JPL Solar System Dynamics). Regiões candidatas Artemis III: NASA (out/2024). Locais de pouso de outras missões: NASA NSSDC, Lunar Artifacts. Algoritmos analíticos: J. Meeus, *Astronomical Algorithms*, 2ª ed.
