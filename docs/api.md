# API do Janela Polar

Todas as rotas são `GET`, respondem JSON (exceto o CSV) e aceitam CORS de qualquer origem.

## Parâmetros comuns

| Parâmetro | Padrão | Valores |
|---|---|---|
| `start` | hoje (UTC) | `AAAA-MM-DD` |
| `days` | `30` | 1 a 120 |
| `step` | `60` | minutos: 10, 15, 30, 60 ou 120 (o frontend usa 60) |
| `provider` | `JANELA_PROVIDER` | `auto`, `horizons`, `analytic` |

Parâmetros das janelas (em `/windows` e `/compare`):

| Parâmetro | Padrão | Significado |
|---|---|---|
| `margin` | `0.5` | margem do horizonte em graus, somada à máscara de relevo |
| `height` | `0` | altura do ponto sobre o entorno, em metros (abaixa o horizonte) |
| `dsn_min` | `10` | elevação mínima da Lua numa antena DSN para contar contato |

Erros de parâmetro voltam com `400` e `{"error": "mensagem"}`. Se `provider=horizons` e a Horizons falhar, volta `503`.

## `GET /api/health`

```json
{"ok": true, "provider": "auto"}
```

## `GET /api/sites`

Locais e antenas, com `has_mask` dizendo se há máscara de relevo.

## `GET /api/bundle`

Séries brutas do período. É o que o frontend consome.

```
/api/bundle?start=2026-11-08&days=30
```

```json
{
  "source": "horizons",          // horizons | analytic | mixed
  "start": "2026-11-08T00:00:00Z",
  "step_min": 60,
  "n": 721,                      // número de instantes (início e fim inclusos)
  "site_list": [ {"id": "mal", "name": "Maciço Malapert", "lat": -85.9, "lon": 3.0, ...} ],
  "dsn": {
    "stations": [ {"id": "gdscc", "name": "Goldstone", ...} ],
    "elev": {"gdscc": [12.3, ...], "mdscc": [...], "cdscc": [...]}
  },
  "sites": {
    "mal": {
      "sun_el": [1.93, ...], "sun_az": [81.2, ...],
      "earth_el": [0.55, ...], "earth_az": [354.1, ...],
      "mask": null,              // ou 360 elevações do relevo, uma por grau de azimute
      "source": {"sun": "horizons", "earth": "horizons"}
    }
  },
  "warnings": []
}
```

O instante `i` é `start + i × step_min`. Valores ausentes vêm como `null`.

## `GET /api/windows`

Intervalos e estatísticas de um local.

```
/api/windows?site=mal&start=2026-11-08&days=30&margin=0.5&height=0&dsn_min=10
```

```json
{
  "site": {...},
  "source": "horizons",
  "stats": {
    "energy": 0.55,      // fração média do disco solar visível
    "lit": 0.58,         // fração do tempo com algum Sol
    "dte": 0.58,         // fração do tempo com contato direto
    "both": 0.50,        // Sol + contato
    "max_dark_h": 206,   // noite mais longa, em horas
    "max_both_h": 48,    // maior janela ideal contínua, em horas
    "score": 60.1
  },
  "intervals": [
    {"kind": "sol", "start": "2026-11-15T08:00:00Z", "end": "2026-12-02T03:00:00Z", "hours": 404, "open_end": false},
    {"kind": "dte", ...},
    {"kind": "ideal", ...}
  ]
}
```

`end` é o último instante dentro do intervalo. `open_end: true` quer dizer que o intervalo continua depois do fim do período.

Com `&format=csv` devolve uma planilha (é o botão "Baixar janelas (CSV)" do app).

## `GET /api/compare`

Ranking de todos os locais com as mesmas métricas, ordenado pelo índice.

```
/api/compare?start=2026-11-08&days=30
```

O índice é `100 × (0,5 × energy + 0,3 × dte + 0,2 × (1 − noite mais longa / período))`. Os pesos estão em `backend/app/windows.py` e em `computeWindows()` no frontend.
