# Máscaras de horizonte

Um arquivo `<id-do-local>.csv` por local, com a elevação do relevo (graus) em cada azimute:

```
# comentário opcional
az_deg,elev_deg
0,1.250
1,1.310
...
```

Qualquer resolução de azimute serve (o backend interpola para 1°). Gere com
`scripts/horizon_mask_from_dem.py` a partir de um DEM do LOLA. Sem arquivo, o
local usa horizonte liso (0°).
