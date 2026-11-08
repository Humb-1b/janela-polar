"""Modelo analítico (offline) das posições do Sol e da Terra vistas da Lua.

Séries de Jean Meeus, "Astronomical Algorithms" (2ª ed.): Lua cap. 47
(termos principais), Sol cap. 25, libração/coordenadas selenográficas cap. 53.
Erro típico de 0,1–0,3° em elevação: bom para triagem e para funcionar sem
internet. Para números oficiais, use a Horizons (horizons.py).
É a mesma matemática do frontend (frontend/index.html), para os dois concordarem.
"""
import math
from datetime import datetime, timezone

D2R = math.pi / 180.0
R2D = 180.0 / math.pi
MOON_RADIUS_KM = 1737.4
_INC = 1.54242  # inclinação do equador lunar sobre a eclíptica


def _sd(x):
    return math.sin(x * D2R)


def _cd(x):
    return math.cos(x * D2R)


def _norm(a):
    return a % 360.0


def _wrap(a):
    a = _norm(a)
    return a - 360.0 if a > 180.0 else a


def _moon_geo(T):
    Lp = _norm(218.3164477 + 481267.88123421 * T)
    D = _norm(297.8501921 + 445267.1114034 * T)
    M = _norm(357.5291092 + 35999.0502909 * T)
    Mp = _norm(134.9633964 + 477198.8675055 * T)
    F = _norm(93.2720950 + 483202.0175233 * T)
    Om = _norm(125.0445479 - 1934.1362891 * T)
    E = 1 - 0.002516 * T
    s, c = _sd, _cd
    L = (6288774 * s(Mp) + 1274027 * s(2 * D - Mp) + 658314 * s(2 * D) + 213618 * s(2 * Mp)
         - 185116 * E * s(M) - 114332 * s(2 * F) + 58793 * s(2 * D - 2 * Mp)
         + 57066 * E * s(2 * D - M - Mp) + 53322 * s(2 * D + Mp) + 45758 * E * s(2 * D - M)
         - 40923 * E * s(M - Mp) - 34720 * s(D) - 30383 * E * s(M + Mp) + 15327 * s(2 * D - 2 * F)
         - 12528 * s(Mp + 2 * F) + 10980 * s(Mp - 2 * F) + 10675 * s(4 * D - Mp) + 10034 * s(3 * Mp)
         + 8548 * s(4 * D - 2 * Mp) - 7888 * E * s(2 * D + M - Mp) - 6766 * E * s(2 * D + M)
         - 5163 * s(D - Mp))
    B = (5128122 * s(F) + 280602 * s(Mp + F) + 277693 * s(Mp - F) + 173237 * s(2 * D - F)
         + 55413 * s(2 * D - Mp + F) + 46271 * s(2 * D - Mp - F) + 32573 * s(2 * D + F)
         + 17198 * s(2 * Mp + F) + 9266 * s(2 * D + Mp - F) + 8822 * s(2 * Mp - F)
         + 8216 * E * s(2 * D - M - F) + 4324 * s(2 * D - 2 * Mp - F) + 4200 * s(2 * D + Mp + F))
    R = (-20905355 * c(Mp) - 3699111 * c(2 * D - Mp) - 2955968 * c(2 * D) - 569925 * c(2 * Mp)
         + 48888 * E * c(M) - 3149 * c(2 * F) + 246158 * c(2 * D - 2 * Mp)
         - 152138 * E * c(2 * D - M - Mp) - 170733 * c(2 * D + Mp) - 204586 * E * c(2 * D - M)
         - 129620 * E * c(M - Mp) + 108743 * c(D) + 104755 * E * c(M + Mp) + 10321 * c(2 * D - 2 * F)
         + 79661 * c(Mp - 2 * F) - 34782 * c(4 * D - Mp) - 23210 * c(3 * Mp) - 21636 * c(4 * D - 2 * Mp)
         + 24208 * E * c(2 * D + M - Mp) + 30824 * E * c(2 * D + M) - 8379 * c(D - Mp))
    return {"lam": _norm(Lp + L / 1e6), "bet": B / 1e6, "dist": 385000.56 + R / 1000.0, "F": F, "Om": Om}


def _sun_geo(T):
    L0 = _norm(280.46646 + 36000.76983 * T)
    M = _norm(357.52911 + 35999.05029 * T)
    C = (1.914602 - 0.004817 * T) * _sd(M) + 0.019993 * _sd(2 * M) + 0.000289 * _sd(3 * M)
    e = 0.016708634
    v = M + C
    return {"lam": _norm(L0 + C), "dist": 149597870.7 * 1.000001018 * (1 - e * e) / (1 + e * _cd(v))}


def _selen(lam, bet, mo):
    W = lam - mo["Om"]
    A = math.atan2(_sd(W) * _cd(bet) * _cd(_INC) - _sd(bet) * _sd(_INC), _cd(W) * _cd(bet)) * R2D
    lat = math.asin(-_sd(W) * _cd(bet) * _sd(_INC) - _sd(bet) * _cd(_INC)) * R2D
    return {"lon": _wrap(A - mo["F"]), "lat": lat}


def _jd(t):
    return t.timestamp() / 86400.0 + 2440587.5


def ephem(t):
    """Posições selenográficas do Sol e da Terra + RA/Dec geocêntricos da Lua no instante t."""
    jd = _jd(t)
    T = (jd - 2451545.0) / 36525.0
    mo, su = _moon_geo(T), _sun_geo(T)
    earth = _selen(mo["lam"], mo["bet"], mo)
    earth["dist"] = mo["dist"]
    r = mo["dist"] / su["dist"]
    lam_h = su["lam"] + 180 + r * R2D * _cd(mo["bet"]) * _sd(su["lam"] - mo["lam"])
    sun = _selen(lam_h, r * mo["bet"], mo)
    sun["dist"] = su["dist"]
    eps = 23.4393 - 0.013 * T
    ra = math.atan2(_sd(mo["lam"]) * _cd(eps) - math.tan(mo["bet"] * D2R) * _sd(eps), _cd(mo["lam"])) * R2D
    dec = math.asin(_sd(mo["bet"]) * _cd(eps) + _cd(mo["bet"]) * _sd(eps) * _sd(mo["lam"])) * R2D
    gmst = _norm(280.46061837 + 360.98564736629 * (jd - 2451545.0))
    return {"earth": earth, "sun": sun, "ra": ra, "dec": dec, "gmst": gmst}


def topo(lat, lon, body):
    """Elevação/azimute de um corpo visto de (lat, lon) na Lua, com paralaxe."""
    d = body["dist"]
    bx = d * _cd(body["lat"]) * _cd(body["lon"])
    by = d * _cd(body["lat"]) * _sd(body["lon"])
    bz = d * _sd(body["lat"])
    ux, uy, uz = _cd(lat) * _cd(lon), _cd(lat) * _sd(lon), _sd(lat)
    vx, vy, vz = bx - MOON_RADIUS_KM * ux, by - MOON_RADIUS_KM * uy, bz - MOON_RADIUS_KM * uz
    n = math.sqrt(vx * vx + vy * vy + vz * vz)
    up = (vx * ux + vy * uy + vz * uz) / n
    east = (-vx * _sd(lon) + vy * _cd(lon)) / n
    north = (-vx * _sd(lat) * _cd(lon) - vy * _sd(lat) * _sd(lon) + vz * _cd(lat)) / n
    return {"el": math.asin(max(-1.0, min(1.0, up))) * R2D, "az": _norm(math.atan2(east, north) * R2D)}


def moon_elevation_from_earth(e, lat, lon):
    """Elevação geocêntrica aproximada da Lua para uma estação na Terra (sem paralaxe, ~1°)."""
    H = e["gmst"] + lon - e["ra"]
    return math.asin(_sd(lat) * _sd(e["dec"]) + _cd(lat) * _cd(e["dec"]) * _cd(H)) * R2D


def series(times, lat=None, lon=None, kind="sun"):
    """kind: 'sun' | 'earth' (vistos de lat/lon na Lua) ou 'dsn' (Lua vista da estação lat/lon)."""
    az, el = [], []
    for t in times:
        e = ephem(t)
        if kind == "dsn":
            az.append(math.nan)
            el.append(moon_elevation_from_earth(e, lat, lon))
        else:
            p = topo(lat, lon, e[kind])
            az.append(p["az"])
            el.append(p["el"])
    return az, el


def utc(y, m, d, h=0, mi=0):
    return datetime(y, m, d, h, mi, tzinfo=timezone.utc)
