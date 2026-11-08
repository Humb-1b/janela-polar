"""Calcula a máscara de horizonte (elevação do relevo em cada azimute) de um
local a partir de um modelo digital de elevação (DEM) polar do LOLA/LRO.

No polo sul, o relevo decide se há Sol: o Sol fica a poucos graus do horizonte
e uma montanha a 20 km pode bloqueá-lo. Esta máscara troca o "horizonte liso"
do app pelo horizonte real.

Entrada: um GeoTIFF polar estereográfico do polo sul, como os DEMs do LOLA
distribuídos pelo NASA PGDA (pgda.gsfc.nasa.gov) ou pelo PDS Geosciences Node.
Use um que cubra os locais com folga (~150 km ao redor) e resolução de 20–120 m/pixel.

    pip install -r scripts/requirements.txt
    python scripts/horizon_mask_from_dem.py caminho/DEM.tif --all
    python scripts/horizon_mask_from_dem.py caminho/DEM.tif --site mal --obs-height 2

Saída: backend/data/horizon_masks/<id>.csv (az_deg, elev_deg). O backend usa
automaticamente qualquer máscara que encontrar lá.

Aproximações: amostra o pixel mais próximo, ignora o fator de escala da projeção
(<0,2% a 83°S) e trata a Lua como esfera de 1737,4 km para a curvatura.
"""
import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np

R_MOON = 1737400.0
REPO = Path(__file__).resolve().parent.parent


def horizon_mask(sample, to_xy, lat, lon, *, res_m, obs_height_m=2.0, max_dist_m=150_000.0, n_az=360):
    """Núcleo do cálculo, independente de formato de arquivo.

    sample(X, Y) -> alturas em metros (arrays numpy; NaN fora do DEM)
    to_xy(lon, lat) -> coordenadas (x, y) em metros na grade do DEM
    Devolve um array com a elevação do horizonte (graus) para cada azimute 0..n_az-1.
    """
    x0, y0 = to_xy(lon, lat)
    # direções norte e leste locais na grade, por diferenças finitas
    xn, yn = to_xy(lon, lat + 0.01)
    xe, ye = to_xy(lon + 0.01 / math.cos(math.radians(lat)), lat)
    north = np.array([xn - x0, yn - y0])
    east = np.array([xe - x0, ye - y0])
    north /= np.linalg.norm(north)
    east /= np.linalg.norm(east)

    z_here = float(sample(np.array([x0]), np.array([y0]))[0])
    if math.isnan(z_here):
        raise ValueError(f"O local ({lat}, {lon}) está fora do DEM")
    z0 = z_here + obs_height_m

    # passo fino perto do ponto, mais espaçado longe (o relevo distante ocupa ângulos menores)
    near = np.arange(res_m, min(5000.0, max_dist_m), res_m)
    far = np.geomspace(5000.0, max_dist_m, 1500) if max_dist_m > 5000 else np.array([])
    d = np.unique(np.concatenate([near, far]))

    az = np.radians(np.arange(n_az) * 360.0 / n_az)
    dx = np.cos(az)[:, None] * north[0] + np.sin(az)[:, None] * east[0]
    dy = np.cos(az)[:, None] * north[1] + np.sin(az)[:, None] * east[1]
    X = x0 + dx * d[None, :]
    Y = y0 + dy * d[None, :]
    Z = sample(X, Y)
    ang = np.degrees(np.arctan2(Z - z0 - d[None, :] ** 2 / (2 * R_MOON), d[None, :]))
    ang = np.where(np.isnan(ang), -90.0, ang)
    return ang.max(axis=1)


def open_dem(path, units, proj4=None):
    import rasterio
    from pyproj import CRS, Transformer

    ds = rasterio.open(path)
    z = ds.read(1, masked=True).astype("float64").filled(np.nan)
    z = z * (ds.scales[0] or 1.0) + (ds.offsets[0] or 0.0)
    if units == "km":
        z *= 1000.0
    inv = ~ds.transform
    rows, cols = z.shape

    def sample(X, Y):
        c, r = inv * (X, Y)
        r = np.floor(r).astype(int)
        c = np.floor(c).astype(int)
        ok = (r >= 0) & (r < rows) & (c >= 0) & (c < cols)
        out = np.full(np.shape(X), np.nan)
        out[ok] = z[r[ok], c[ok]]
        return out

    crs = CRS.from_proj4(proj4) if proj4 else ds.crs
    if crs is None:
        raise SystemExit("O DEM não informa a projeção. Passe --proj4 (veja --help).")
    geo = CRS.from_proj4(f"+proj=longlat +R={R_MOON} +no_defs")
    tr = Transformer.from_crs(geo, crs, always_xy=True)
    return sample, (lambda lon, lat: tr.transform(lon, lat)), abs(ds.transform.a)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("dem", help="GeoTIFF do DEM polar")
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--site", help="id do local (veja backend/data/sites.json)")
    g.add_argument("--all", action="store_true", help="todos os locais")
    p.add_argument("--obs-height", type=float, default=2.0, help="altura do painel/antena sobre o solo (m)")
    p.add_argument("--max-dist-km", type=float, default=150.0)
    p.add_argument("--units", choices=["m", "km"], default="m", help="unidade das alturas no DEM")
    p.add_argument("--proj4", help='projeção se o arquivo não tiver, ex.: "+proj=stere +lat_0=-90 +lon_0=0 '
                                   '+k=1 +x_0=0 +y_0=0 +R=1737400 +units=m"')
    a = p.parse_args()

    sites = json.loads((REPO / "backend/data/sites.json").read_text(encoding="utf-8"))["sites"]
    if a.site:
        sites = [s for s in sites if s["id"] == a.site]
        if not sites:
            raise SystemExit(f"Local '{a.site}' não existe em sites.json")

    sample, to_xy, res = open_dem(a.dem, a.units, a.proj4)
    out_dir = REPO / "backend/data/horizon_masks"
    out_dir.mkdir(parents=True, exist_ok=True)
    for s in sites:
        try:
            m = horizon_mask(sample, to_xy, s["lat"], s["lon"], res_m=res,
                             obs_height_m=a.obs_height, max_dist_m=a.max_dist_km * 1000)
        except ValueError as e:
            print(f"{s['id']}: {e}, pulando")
            continue
        path = out_dir / f"{s['id']}.csv"
        with path.open("w", encoding="utf-8") as f:
            f.write(f"# máscara de horizonte de {s['name']} gerada de {Path(a.dem).name}\n")
            f.write("az_deg,elev_deg\n")
            for az, el in enumerate(m):
                f.write(f"{az},{el:.3f}\n")
        print(f"{s['id']}: horizonte entre {m.min():.2f}° e {m.max():.2f}° -> {path}")
    print("Pronto. Reinicie o backend para ele carregar as novas máscaras.")


if __name__ == "__main__":
    sys.exit(main())
