"""Faz UMA consulta real à JPL Horizons e compara com o modelo analítico.
Rode isto primeiro para confirmar que a Horizons aceita as consultas do app.

    python scripts/horizons_probe.py
    python scripts/horizons_probe.py --site shk --save backend/tests/fixtures/real_sun_shk.txt

Se a Horizons recusar a consulta (por exemplo, mudando o nome de alguma
coluna), a mensagem dela aparece aqui e o ajuste fica em backend/app/horizons.py.
"""
import argparse
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "backend"))

from app import analytic, horizons  # noqa: E402
from app.sites import get_site  # noqa: E402


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--site", default="mal")
    p.add_argument("--start", default=datetime.now(timezone.utc).strftime("%Y-%m-%d"))
    p.add_argument("--hours", type=int, default=6)
    p.add_argument("--save", help="salva o texto bruto da resposta (útil como fixture de teste)")
    a = p.parse_args()

    s = get_site(a.site)
    t0 = datetime.strptime(a.start, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    t1 = t0 + timedelta(hours=a.hours)
    params = horizons.build_params(horizons.SUN, horizons.MOON, s["lon"], s["lat"], s.get("alt_km", 0), t0, t1, 60)
    print(f"Consultando a Horizons: Sol visto de {s['name']} ({s['lat']}, {s['lon']})…")
    text = horizons._request(params)
    if a.save:
        Path(a.save).write_text(text, encoding="utf-8")
        print("Resposta bruta salva em", a.save)
    rows = horizons.parse_observer_csv(text)

    print(f"\n{'UTC':17} {'Horizons el/az':>18} {'Analítico el/az':>18} {'Δel':>7}")
    for t, az, el in rows:
        e = analytic.ephem(t)
        q = analytic.topo(s["lat"], s["lon"], e["sun"])
        print(f"{t:%Y-%m-%d %H:%M} {el:8.3f}/{az:8.2f} {q['el']:8.3f}/{q['az']:8.2f} {el - q['el']:7.3f}")
    print("\nDiferenças de até ~0,3° são esperadas (o modelo analítico é simplificado).")


if __name__ == "__main__":
    main()
