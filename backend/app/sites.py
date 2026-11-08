"""Locais candidatos, estações da DSN e máscaras de horizonte opcionais."""
import csv
import json
from functools import lru_cache

from .config import DATA_DIR


@lru_cache(maxsize=1)
def _catalog():
    return json.loads((DATA_DIR / "sites.json").read_text(encoding="utf-8"))


def all_sites():
    return _catalog()["sites"]


def dsn_stations():
    return _catalog()["dsn"]


def get_site(site_id):
    for s in all_sites():
        if s["id"] == site_id:
            return s
    return None


@lru_cache(maxsize=None)
def load_mask(site_id):
    """Lê data/horizon_masks/<id>.csv (colunas az_deg, elev_deg) e devolve
    uma lista de 360 elevações do horizonte, uma por grau de azimute.
    Devolve None se o arquivo não existir (horizonte liso)."""
    path = DATA_DIR / "horizon_masks" / f"{site_id}.csv"
    if not path.exists():
        return None
    pts = []
    with path.open(encoding="utf-8") as f:
        for row in csv.reader(f):
            if not row or row[0].strip().startswith(("#", "az")):
                continue
            pts.append((float(row[0]) % 360.0, float(row[1])))
    if not pts:
        return None
    pts.sort()
    # interpolação linear circular para 0..359
    out = []
    n = len(pts)
    for az in range(360):
        hi = next((i for i, p in enumerate(pts) if p[0] >= az), 0)
        a1, e1 = pts[hi]
        a0, e0 = pts[hi - 1]  # hi-1 = -1 dá a volta no círculo
        span = (a1 - a0) % 360.0 or 360.0
        t = ((az - a0) % 360.0) / span if n > 1 else 0.0
        out.append(round(e0 + (e1 - e0) * t, 3))
    return out
