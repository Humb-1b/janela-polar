"""Gera um pacote de efemérides estático em frontend/data/ para o app funcionar
sem backend (GitHub Pages) ou se a internet falhar no dia da apresentação.

    python scripts/precompute.py --start 2026-11-08 --days 30
    python scripts/precompute.py --start 2026-11-08 --days 30 --provider analytic   # offline

O frontend procura automaticamente data/bundle-<início>-<dias>d.json quando a API não responde.
"""
import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "backend"))

from app.ephemeris import build_bundle  # noqa: E402


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--start", required=True, help="AAAA-MM-DD (UTC)")
    p.add_argument("--days", type=int, default=30, choices=[14, 30, 60, 90])
    p.add_argument("--provider", default="horizons", choices=["horizons", "auto", "analytic"])
    a = p.parse_args()

    t0 = datetime.strptime(a.start, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    print(f"Montando pacote {a.start} + {a.days} dias via {a.provider} (23 consultas)…")
    b = build_bundle(t0, a.days, 60, a.provider)
    out = REPO / "frontend" / "data" / f"bundle-{a.start}-{a.days}d.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(b, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Fonte: {b['source']}. Salvo em {out} ({out.stat().st_size // 1024} KB)")
    for w in b["warnings"]:
        print("  aviso:", w)


if __name__ == "__main__":
    main()
