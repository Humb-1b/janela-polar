"""Cliente da JPL Horizons API (https://ssd-api.jpl.nasa.gov/doc/horizons.html).

Pedimos uma efeméride de OBSERVADOR com a quantidade 4 (azimute e elevação
aparentes) para um ponto definido por coordenadas na superfície de um corpo:

    CENTER='coord@301'   -> observador na Lua (301)
    CENTER='coord@399'   -> observador na Terra (399), usado para as antenas da DSN
    SITE_COORD='lon_leste,lat,alt_km'

Alvos: '10' = Sol, '399' = Terra, '301' = Lua. Não precisa de chave de API.
"""
import math
import time
from datetime import datetime, timedelta, timezone

import requests

from . import cache
from .config import HORIZONS_RETRIES, HORIZONS_TIMEOUT, HORIZONS_URL

SUN, EARTH, MOON = "10", "399", "301"

_MONTHS = {m: i for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], 1)}


class HorizonsError(RuntimeError):
    """A Horizons respondeu, mas com erro ou num formato inesperado."""


class HorizonsUnavailable(HorizonsError):
    """Não foi possível falar com a Horizons (rede, timeout, 5xx)."""


def _q(v):
    # a API espera valores entre aspas simples
    return f"'{v}'"


def build_params(target, center_body, lon_e, lat, alt_km, start, stop, step_min):
    return {
        "format": "json",
        "COMMAND": _q(target),
        "OBJ_DATA": _q("NO"),
        "MAKE_EPHEM": _q("YES"),
        "EPHEM_TYPE": _q("OBSERVER"),
        "CENTER": _q(f"coord@{center_body}"),
        "COORD_TYPE": _q("GEODETIC"),
        "SITE_COORD": _q(f"{lon_e % 360.0:.6f},{lat:.6f},{alt_km:.4f}"),
        "START_TIME": _q(start.strftime("%Y-%m-%d %H:%M")),
        "STOP_TIME": _q(stop.strftime("%Y-%m-%d %H:%M")),
        "STEP_SIZE": _q(f"{int(step_min)} m"),
        "QUANTITIES": _q("4"),
        "ANG_FORMAT": _q("DEG"),
        "APPARENT": _q("AIRLESS"),
        "CSV_FORMAT": _q("YES"),
        "TIME_DIGITS": _q("MINUTES"),
        "EXTRA_PREC": _q("YES"),
    }


def _parse_time(s):
    # "2026-Nov-08 00:00" (às vezes com segundos)
    date, _, clock = s.strip().partition(" ")
    y, mon, d = date.split("-")
    parts = clock.split(":")
    h, m = int(parts[0]), int(parts[1])
    sec = float(parts[2]) if len(parts) > 2 else 0.0
    return datetime(int(y), _MONTHS[mon], int(d), h, m, tzinfo=timezone.utc) + timedelta(seconds=sec)


def _num(s):
    s = s.strip()
    if not s or s.lower() in ("n.a.", "na"):
        return math.nan
    return float(s)


def parse_observer_csv(text):
    """Extrai [(datetime, azimute, elevação), ...] do texto de resultado da Horizons."""
    if "$$SOE" not in text:
        msg = text.strip().splitlines()
        tail = " ".join(msg[-6:]) if msg else "(resposta vazia)"
        raise HorizonsError(f"Horizons não devolveu efeméride: {tail[:400]}")
    head, rest = text.split("$$SOE", 1)
    body = rest.split("$$EOE", 1)[0]

    header = next((ln for ln in reversed(head.splitlines()) if "Date" in ln and "," in ln), None)
    if header is None:
        raise HorizonsError("Cabeçalho da tabela não encontrado")
    cols = [c.strip().lower() for c in header.split(",")]
    try:
        i_az = next(i for i, c in enumerate(cols) if c.startswith("azi"))
        i_el = next(i for i, c in enumerate(cols) if c.startswith("elev"))
    except StopIteration:
        raise HorizonsError(f"Colunas de azimute/elevação ausentes: {header.strip()}") from None

    rows = []
    for ln in body.splitlines():
        if not ln.strip():
            continue
        parts = ln.split(",")
        rows.append((_parse_time(parts[0]), _num(parts[i_az]), _num(parts[i_el])))
    if not rows:
        raise HorizonsError("Tabela de efeméride vazia")
    return rows


def _request(params, session=None):
    get = (session or requests).get
    last = None
    for attempt in range(HORIZONS_RETRIES):
        try:
            r = get(HORIZONS_URL, params=params, timeout=HORIZONS_TIMEOUT)
        except requests.RequestException as e:
            last = e
        else:
            if r.status_code == 503 or r.status_code >= 500:
                last = HorizonsUnavailable(f"HTTP {r.status_code}")
            elif r.status_code != 200:
                raise HorizonsError(f"HTTP {r.status_code}: {r.text[:300]}")
            else:
                data = r.json()
                if "error" in data:
                    raise HorizonsError(str(data["error"])[:400])
                return data.get("result", "")
        time.sleep(1.5 * (attempt + 1))
    raise HorizonsUnavailable(f"Horizons indisponível: {last}")


def fetch_altaz(target, center_body, lon_e, lat, alt_km, start, n, step_min, session=None):
    """Azimutes e elevações de `target` vistos do ponto dado, em `n` instantes
    a partir de `start` (UTC), a cada `step_min` minutos. Usa cache em disco."""
    stop = start + timedelta(minutes=step_min * (n - 1))
    params = build_params(target, center_body, lon_e, lat, alt_km, start, stop, step_min)
    key = {"p": params, "n": n}
    hit = cache.get(key)
    if hit is not None:
        return hit["az"], hit["el"]

    rows = parse_observer_csv(_request(params, session))
    if len(rows) < n:
        raise HorizonsError(f"Esperava {n} linhas, recebi {len(rows)}")
    rows = rows[:n]
    if abs((rows[0][0] - start).total_seconds()) > 60:
        raise HorizonsError(f"Primeira linha em {rows[0][0]}, esperava {start}")
    az = [r[1] for r in rows]
    el = [r[2] for r in rows]
    cache.put(key, {"az": az, "el": el})
    return az, el
