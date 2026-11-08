"""Atualiza backend/data/sites.json com o centro OFICIAL de cada região Artemis III,
calculado a partir das grades de navegação publicadas pelo USGS:

    McClernan, M.T. (2024), Down Selected Artemis III Candidate Landing Site
    Navigational Grids. USGS data release, doi:10.5066/P1MEQ6UK
    https://www.sciencebase.gov/catalog/item/671a6fa8d34efed5620f89f8

As grades cobrem cada região candidata (definidas no LROC QuickMap) em
projeção polar estereográfica lunar (LPS). O centro da região é o centro do
retângulo que envolve a grade de 1 km.

Uso:
    1. Baixe os shapefiles da página acima e descompacte numa pasta.
    2. python scripts/sites_from_shapefiles.py pasta_dos_shapefiles            # só compara
       python scripts/sites_from_shapefiles.py pasta_dos_shapefiles --write    # grava sites.json

Não precisa instalar nada: lê .shp e .prj com a biblioteca padrão do Python.
"""
import argparse
import json
import math
import re
import struct
import sys
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SITES_JSON = REPO / "backend" / "data" / "sites.json"
SOURCE = ("USGS, McClernan (2024), doi:10.5066/P1MEQ6UK: centro da grade ACC de 1 km "
          "da região candidata (regiões do LROC QuickMap)")

# nome no arquivo -> id em sites.json (o mais longo primeiro: Mons_Mouton é prefixo de Mons_Mouton_Plateau)
REGIONS = [
    ("mons_mouton_plateau", "mmp"),
    ("peak_near_cabeus_b", "cab"),
    ("de_gerlache_rim_2", "dg2"),
    ("malapert_massif", "mal"),
    ("nobile_rim_1", "nb1"),
    ("nobile_rim_2", "nb2"),
    ("slater_plain", "sla"),
    ("mons_mouton", "mmo"),
    ("haworth", "haw"),
]


# ---------- leitura de shapefile (só polígonos/pontos, só o necessário) ----------

def shp_points(data):
    """Todos os vértices (x, y) de um .shp."""
    pts = []
    pos = 100
    while pos + 8 <= len(data):
        _, length_words = struct.unpack(">ii", data[pos:pos + 8])
        content = data[pos + 8: pos + 8 + length_words * 2]
        pos += 8 + length_words * 2
        if len(content) < 4:
            continue
        stype = struct.unpack("<i", content[:4])[0]
        if stype in (1, 11, 21):  # ponto
            pts.append(struct.unpack("<2d", content[4:20]))
        elif stype in (3, 5, 13, 15, 23, 25):  # linha/polígono
            nparts, npoints = struct.unpack("<2i", content[36:44])
            off = 44 + 4 * nparts
            for i in range(npoints):
                pts.append(struct.unpack("<2d", content[off + 16 * i: off + 16 * i + 16]))
    return pts


# ---------- projeção polar estereográfica (inversa) ----------

def parse_prj(wkt):
    w = wkt.lower()
    if "stereographic" not in w:
        raise SystemExit(f"Projeção não suportada pelo leitor embutido (esperava polar estereográfica):\n{wkt[:300]}")

    def param(*names, default=None):
        for n in names:
            m = re.search(r'parameter\["' + n + r'",\s*(-?[\d.eE+]+)\]', w)
            if m:
                return float(m.group(1))
        return default

    m = re.search(r'spheroid\["[^"]*",\s*([\d.eE+]+)', w) or re.search(r'ellipsoid\["[^"]*",\s*([\d.eE+]+)', w)
    radius = float(m.group(1)) if m else 1737400.0
    lat0 = param("latitude_of_origin", "standard_parallel_1", "latitude_of_center", default=-90.0)
    k0 = param("scale_factor")
    if k0 is None:
        # ESRI "Stereographic_South_Pole" usa paralelo de escala verdadeira em vez de fator de escala
        phi_c = abs(param("standard_parallel_1", default=-90.0))
        k0 = (1 + math.sin(math.radians(phi_c))) / 2
    return {
        "R": radius, "k0": k0, "south": lat0 < 0,
        "lon0": param("central_meridian", "longitude_of_origin", "longitude_of_center", default=0.0),
        "x0": param("false_easting", default=0.0), "y0": param("false_northing", default=0.0),
    }


def inv_polar_stereo(x, y, p):
    dx, dy = x - p["x0"], y - p["y0"]
    rho = math.hypot(dx, dy)
    c = 2 * math.atan(rho / (2 * p["R"] * p["k0"]))
    if p["south"]:
        lat = -(90 - math.degrees(c))
        lon = p["lon0"] + math.degrees(math.atan2(dx, dy))
    else:
        lat = 90 - math.degrees(c)
        lon = p["lon0"] + math.degrees(math.atan2(dx, -dy))
    lon = (lon + 180) % 360 - 180
    return lat, lon


# ---------- principal ----------

def collect(folder):
    """{site_id: {"pts": [...], "prj": wkt}} a partir de .shp de 1 km (pasta ou .zip)."""
    files = {}
    if folder.suffix.lower() == ".zip":
        z = zipfile.ZipFile(folder)
        names = z.namelist()

        def read(n):
            return z.read(n)
    else:
        names = [str(p.relative_to(folder)) for p in folder.rglob("*") if p.is_file()]

        def read(n):
            return (folder / n).read_bytes()

    lower = {n.lower(): n for n in names}
    for n in names:
        base = Path(n).name.lower()
        if not base.endswith(".shp") or "1km" not in base.replace("_", ""):
            continue
        site = next((sid for key, sid in REGIONS if key in base), None)
        if site is None:
            continue
        prj_name = lower.get(n.lower()[:-4] + ".prj")
        if prj_name is None:
            raise SystemExit(f"Falta o .prj de {n}")
        entry = files.setdefault(site, {"pts": [], "prj": read(prj_name).decode("utf-8", "replace"), "files": []})
        entry["pts"] += shp_points(read(n))
        entry["files"].append(Path(n).name)
    return files


def gc_km(lat1, lon1, lat2, lon2):
    a = math.radians
    d = math.acos(min(1, math.sin(a(lat1)) * math.sin(a(lat2)) +
                      math.cos(a(lat1)) * math.cos(a(lat2)) * math.cos(a(lon2 - lon1))))
    return 1737.4 * d


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("folder", type=Path, help="pasta ou .zip com os shapefiles do USGS")
    ap.add_argument("--write", action="store_true", help="grava as coordenadas em sites.json")
    a = ap.parse_args()

    found = collect(a.folder)
    if not found:
        raise SystemExit("Nenhum shapefile de 1 km das regiões Artemis III encontrado nessa pasta.")

    cat = json.loads(SITES_JSON.read_text(encoding="utf-8"))
    by_id = {s["id"]: s for s in cat["sites"]}
    print(f"{'local':26} {'antes':>18} {'oficial':>18} {'Δ km':>6} {'extensão':>12}")
    for sid, e in sorted(found.items()):
        p = parse_prj(e["prj"])
        xs = [q[0] for q in e["pts"]]
        ys = [q[1] for q in e["pts"]]
        cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
        lat, lon = inv_polar_stereo(cx, cy, p)
        s = by_id[sid]
        ext = f"{(max(xs) - min(xs)) / 1000:.0f}×{(max(ys) - min(ys)) / 1000:.0f} km"
        d = gc_km(s["lat"], s["lon"], lat, lon)
        print(f"{s['name']:26} {s['lat']:8.3f},{s['lon']:8.3f} {lat:8.3f},{lon:8.3f} {d:6.1f} {ext:>12}")
        if a.write:
            s["lat"], s["lon"] = round(lat, 3), round(lon, 3)
            s["coord_source"] = SOURCE
            s.pop("coord_status", None)

    missing = [sid for _, sid in REGIONS if sid not in found]
    if missing:
        print("Sem shapefile para:", ", ".join(missing))
    if a.write:
        cat["_comment"] = ("Coordenadas das 9 regiões: centro da grade oficial do USGS (ver coord_source). "
                           "Shackleton é referência e continua aproximada. lon: graus leste. "
                           "alt_km: altitude sobre a esfera de 1737,4 km (0 = desconhecida).")
        SITES_JSON.write_text(json.dumps(cat, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"\nGravado em {SITES_JSON}. Reinicie o backend e apague backend/.cache se quiser refazer as consultas.")
    else:
        print("\nNada foi gravado. Rode de novo com --write para atualizar sites.json.")


if __name__ == "__main__":
    sys.exit(main())
