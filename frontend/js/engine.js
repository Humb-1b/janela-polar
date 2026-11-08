/* Motor analítico de efemérides: Sol e Terra vistos de qualquer ponto da Lua.
 *
 * Séries de J. Meeus, "Astronomical Algorithms" (2ª ed.): Lua cap. 47 (termos
 * principais), Sol cap. 25, coordenadas selenográficas e libração cap. 53.
 * Erro típico de 0,1–0,3°. É a mesma matemática de backend/app/analytic.py;
 * frontend/tests/engine.test.mjs confere que os dois concordam.
 *
 * Usado para: o mapa de iluminação, o planejador de datas e como reserva
 * quando não há servidor. Funciona no navegador (window.LunarEngine) e no Node.
 */
(function (root) {
  "use strict";
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const MOON_RADIUS_KM = 1737.4;
  const SUN_RADIUS_DEG = 0.2666;      // raio angular médio do Sol
  const INC = 1.54242;                // inclinação do equador lunar sobre a eclíptica

  const sd = x => Math.sin(x * D2R), cd = x => Math.cos(x * D2R);
  const norm = a => { a %= 360; return a < 0 ? a + 360 : a; };
  const wrap = a => { a = norm(a); return a > 180 ? a - 360 : a; };

  function moonGeo(T) {
    const Lp = norm(218.3164477 + 481267.88123421 * T), D = norm(297.8501921 + 445267.1114034 * T),
      M = norm(357.5291092 + 35999.0502909 * T), Mp = norm(134.9633964 + 477198.8675055 * T),
      F = norm(93.2720950 + 483202.0175233 * T), Om = norm(125.0445479 - 1934.1362891 * T),
      E = 1 - 0.002516 * T, s = sd, c = cd;
    const L = 6288774 * s(Mp) + 1274027 * s(2 * D - Mp) + 658314 * s(2 * D) + 213618 * s(2 * Mp)
      - 185116 * E * s(M) - 114332 * s(2 * F) + 58793 * s(2 * D - 2 * Mp) + 57066 * E * s(2 * D - M - Mp)
      + 53322 * s(2 * D + Mp) + 45758 * E * s(2 * D - M) - 40923 * E * s(M - Mp) - 34720 * s(D)
      - 30383 * E * s(M + Mp) + 15327 * s(2 * D - 2 * F) - 12528 * s(Mp + 2 * F) + 10980 * s(Mp - 2 * F)
      + 10675 * s(4 * D - Mp) + 10034 * s(3 * Mp) + 8548 * s(4 * D - 2 * Mp) - 7888 * E * s(2 * D + M - Mp)
      - 6766 * E * s(2 * D + M) - 5163 * s(D - Mp);
    const B = 5128122 * s(F) + 280602 * s(Mp + F) + 277693 * s(Mp - F) + 173237 * s(2 * D - F)
      + 55413 * s(2 * D - Mp + F) + 46271 * s(2 * D - Mp - F) + 32573 * s(2 * D + F) + 17198 * s(2 * Mp + F)
      + 9266 * s(2 * D + Mp - F) + 8822 * s(2 * Mp - F) + 8216 * E * s(2 * D - M - F)
      + 4324 * s(2 * D - 2 * Mp - F) + 4200 * s(2 * D + Mp + F);
    const R = -20905355 * c(Mp) - 3699111 * c(2 * D - Mp) - 2955968 * c(2 * D) - 569925 * c(2 * Mp)
      + 48888 * E * c(M) - 3149 * c(2 * F) + 246158 * c(2 * D - 2 * Mp) - 152138 * E * c(2 * D - M - Mp)
      - 170733 * c(2 * D + Mp) - 204586 * E * c(2 * D - M) - 129620 * E * c(M - Mp) + 108743 * c(D)
      + 104755 * E * c(M + Mp) + 10321 * c(2 * D - 2 * F) + 79661 * c(Mp - 2 * F) - 34782 * c(4 * D - Mp)
      - 23210 * c(3 * Mp) - 21636 * c(4 * D - 2 * Mp) + 24208 * E * c(2 * D + M - Mp)
      + 30824 * E * c(2 * D + M) - 8379 * c(D - Mp);
    return { lam: norm(Lp + L / 1e6), bet: B / 1e6, dist: 385000.56 + R / 1000, F, Om };
  }

  function sunGeo(T) {
    const L0 = norm(280.46646 + 36000.76983 * T), M = norm(357.52911 + 35999.05029 * T);
    const C = (1.914602 - 0.004817 * T) * sd(M) + 0.019993 * sd(2 * M) + 0.000289 * sd(3 * M);
    const e = 0.016708634, v = M + C;
    return { lam: norm(L0 + C), dist: 149597870.7 * 1.000001018 * (1 - e * e) / (1 + e * cd(v)) };
  }

  function selen(lam, bet, mo) {
    const W = lam - mo.Om;
    const A = Math.atan2(sd(W) * cd(bet) * cd(INC) - sd(bet) * sd(INC), cd(W) * cd(bet)) * R2D;
    return { lon: wrap(A - mo.F), lat: Math.asin(-sd(W) * cd(bet) * sd(INC) - sd(bet) * cd(INC)) * R2D };
  }

  /** Posições selenográficas do Sol e da Terra (+ RA/Dec geocêntricos da Lua) no instante ms (UTC). */
  function ephem(ms) {
    const jd = ms / 864e5 + 2440587.5, T = (jd - 2451545) / 36525;
    const mo = moonGeo(T), su = sunGeo(T);
    const earth = selen(mo.lam, mo.bet, mo); earth.dist = mo.dist;
    const r = mo.dist / su.dist, lamH = su.lam + 180 + r * R2D * cd(mo.bet) * sd(su.lam - mo.lam);
    const sun = selen(lamH, r * mo.bet, mo); sun.dist = su.dist;
    const eps = 23.4393 - 0.013 * T;
    const ra = Math.atan2(sd(mo.lam) * cd(eps) - Math.tan(mo.bet * D2R) * sd(eps), cd(mo.lam)) * R2D;
    const dec = Math.asin(sd(mo.bet) * cd(eps) + cd(mo.bet) * sd(eps) * sd(mo.lam)) * R2D;
    const gmst = norm(280.46061837 + 360.98564736629 * (jd - 2451545));
    return { earth, sun, ra, dec, gmst };
  }

  /** Elevação e azimute de um corpo visto de (lat, lon) na superfície lunar, com paralaxe. */
  function topo(lat, lon, body) {
    const bx = body.dist * cd(body.lat) * cd(body.lon), by = body.dist * cd(body.lat) * sd(body.lon), bz = body.dist * sd(body.lat);
    const ux = cd(lat) * cd(lon), uy = cd(lat) * sd(lon), uz = sd(lat);
    const vx = bx - MOON_RADIUS_KM * ux, vy = by - MOON_RADIUS_KM * uy, vz = bz - MOON_RADIUS_KM * uz, n = Math.hypot(vx, vy, vz);
    const up = (vx * ux + vy * uy + vz * uz) / n, ea = (-vx * sd(lon) + vy * cd(lon)) / n,
      no = (-vx * sd(lat) * cd(lon) - vy * sd(lat) * sd(lon) + vz * cd(lat)) / n;
    return { el: Math.asin(Math.max(-1, Math.min(1, up))) * R2D, az: norm(Math.atan2(ea, no) * R2D) };
  }

  /** Fração do disco solar acima de um horizonte na elevação h (graus). */
  function discFrac(el, h) {
    const d = (el - h) / SUN_RADIUS_DEG;
    if (d >= 1) return 1;
    if (d <= -1) return 0;
    return (Math.PI - Math.acos(d) + d * Math.sqrt(1 - d * d)) / Math.PI;
  }

  /** Elevação aproximada da Lua para uma estação na Terra (geocêntrica, erro de até ~1°). */
  function dsnElevation(e, st) {
    const H = e.gmst + st.lon - e.ra;
    return Math.asin(sd(st.lat) * sd(e.dec) + cd(st.lat) * cd(e.dec) * cd(H)) * R2D;
  }

  /** Quanto o horizonte desce para um ponto height_m acima do entorno. */
  function horizonDip(heightM) {
    return heightM > 0 ? Math.acos(MOON_RADIUS_KM / (MOON_RADIUS_KM + heightM / 1000)) * R2D : 0;
  }

  const api = { D2R, R2D, MOON_RADIUS_KM, SUN_RADIUS_DEG, norm, wrap, ephem, topo, discFrac, dsnElevation, horizonDip };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.LunarEngine = api;
})(typeof window !== "undefined" ? window : globalThis);
