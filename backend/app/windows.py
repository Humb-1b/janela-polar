"""Cálculo das janelas de iluminação e de comunicação direta com a Terra (DTE).

Regras (as mesmas do frontend):
- Horizonte efetivo no azimute az = máscara do terreno(az) + margem − depressão pela altura.
- Fração do disco solar visível = área do disco (raio ~0,267°) acima desse horizonte.
- "Com Sol" quando ao menos metade do disco está acima do horizonte.
- DTE quando a Terra está acima do horizonte local E ao menos uma antena da DSN
  vê a Lua acima da elevação mínima.
- "Janela ideal" = Sol e DTE ao mesmo tempo.
"""
import math
from datetime import timedelta

from .analytic import MOON_RADIUS_KM

SUN_RADIUS_DEG = 0.2666  # raio angular médio do Sol a 1 UA


def horizon_dip(height_m):
    """Quanto o horizonte geométrico 'desce' para um ponto `height_m` acima do entorno."""
    if height_m <= 0:
        return 0.0
    return math.degrees(math.acos(MOON_RADIUS_KM / (MOON_RADIUS_KM + height_m / 1000.0)))


def mask_at(mask, az):
    if not mask:
        return 0.0
    return mask[int(round(az)) % 360]


def disc_fraction(el, horizon):
    if math.isnan(el):
        return 0.0
    d = (el - horizon) / SUN_RADIUS_DEG
    if d >= 1:
        return 1.0
    if d <= -1:
        return 0.0
    return (math.pi - math.acos(d) + d * math.sqrt(1 - d * d)) / math.pi


def _runs(flags):
    """[(início, fim_exclusivo), ...] dos trechos em que flags é verdadeiro."""
    out, start = [], None
    for i, f in enumerate(flags):
        if f and start is None:
            start = i
        elif not f and start is not None:
            out.append((start, i))
            start = None
    if start is not None:
        out.append((start, len(flags)))
    return out


def evaluate(site_series, dsn_elevs, *, t0, step_min, margin=0.5, height_m=0.0, dsn_min=10.0, mask=None):
    """site_series: dict com sun_el, sun_az, earth_el, earth_az (listas do mesmo tamanho).
    dsn_elevs: lista de listas (uma por estação) com a elevação da Lua."""
    base = margin - horizon_dip(height_m)
    se, sa = site_series["sun_el"], site_series["sun_az"]
    ee, ea = site_series["earth_el"], site_series["earth_az"]
    n = len(se)

    frac, lit, dte = [], [], []
    for i in range(n):
        f = disc_fraction(se[i], base + mask_at(mask, sa[i]))
        dsn_ok = any(not math.isnan(st[i]) and st[i] >= dsn_min for st in dsn_elevs)
        earth_up = not math.isnan(ee[i]) and ee[i] > base + mask_at(mask, ea[i])
        frac.append(f)
        lit.append(f >= 0.5)
        dte.append(earth_up and dsn_ok)
    both = [a and b for a, b in zip(lit, dte)]

    hours = step_min / 60.0
    dark_runs = _runs([f == 0.0 for f in frac])
    both_runs = _runs(both)
    max_dark = max((b - a for a, b in dark_runs), default=0)
    stats = {
        "energy": sum(frac) / n,                       # fração média do disco visível
        "lit": sum(1 for f in frac if f > 0) / n,      # tempo com algum Sol
        "dte": sum(dte) / n,
        "both": sum(both) / n,
        "max_dark_h": max_dark * hours,
        "max_both_h": max((b - a for a, b in both_runs), default=0) * hours,
    }
    stats["score"] = 100 * (0.5 * stats["energy"] + 0.3 * stats["dte"] + 0.2 * (1 - max_dark / n))

    def iv(runs, kind):
        return [{
            "kind": kind,
            "start": (t0 + timedelta(minutes=a * step_min)).isoformat().replace("+00:00", "Z"),
            "end": (t0 + timedelta(minutes=(b - 1) * step_min)).isoformat().replace("+00:00", "Z"),
            "hours": (b - a) * hours,
            "open_end": b == n,
        } for a, b in runs]

    intervals = iv(_runs(lit), "sol") + iv(_runs(dte), "dte") + iv(both_runs, "ideal")
    intervals.sort(key=lambda x: (x["start"], x["kind"]))
    return {"stats": stats, "intervals": intervals,
            "series": {"frac": frac, "lit": lit, "dte": dte, "both": both}}
