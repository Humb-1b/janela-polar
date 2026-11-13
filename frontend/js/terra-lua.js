/* Da Terra à Lua — simulação de tempo × distância a partir de bases de lançamento.
 *
 * Usa js/engine.js (o mesmo motor do Janela Polar) para a posição da Lua:
 * ascensão reta, declinação, distância geocêntrica e tempo sidéreo.
 * A viagem é uma elipse de Kepler só com a gravidade da Terra, saindo da órbita de
 * espera (perigeu) no instante do lançamento e cruzando a distância da Lua na chegada.
 * Nada aqui altera o restante do site.
 */
"use strict";
(function () {
const { D2R, ephem, norm, wrap } = window.LunarEngine;
const $ = id => document.getElementById(id);
const MU = 398600.4418;      // km³/s² (Terra)
const RE = 6378.137;         // km, raio equatorial da Terra
const C_KMS = 299792.458;    // velocidade da luz, km/s
const V_EQ = 465.1;          // m/s, velocidade do chão no equador
const SPAN_H = 720;          // 30 dias de simulação

// Coordenadas das plataformas (graus; longitude leste positiva)
const SITES = [
  { id: "ksc", name: "Kennedy, LC-39A", org: "NASA", short: "Kennedy", lat: 28.60833, lon: -80.60444,
    desc: "Plataforma do Saturno V da Apollo e do SLS da Artemis, na Flórida." },
  { id: "wal", name: "Wallops, Pad 0A", org: "NASA", short: "Wallops", lat: 37.8337, lon: -75.4881,
    desc: "Base da NASA na Virgínia, de onde partiu a sonda lunar LADEE em 2013." },
  { id: "vdb", name: "Vandenberg, SLC-4", org: "usada pela NASA", short: "Vandenberg", lat: 34.633, lon: -120.613,
    desc: "Base da Força Espacial dos EUA na Califórnia, usada pela NASA sobretudo para órbitas polares." },
  { id: "alc", name: "Alcântara", org: "Brasil", short: "Alcântara", lat: -2.33944, lon: -44.4175,
    desc: "Centro de Lançamento de Alcântara, no Maranhão, a pouco mais de 2° do equador." },
];

const S = { t0: 0, tau: 0, site: "ksc", moon: null, tr: null, playing: false };

const col = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const num = (v, d = 1) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const km = v => Math.round(v).toLocaleString("pt-BR");
const fmt = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const fmtD = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", day: "2-digit", month: "short" });
const sd = x => Math.sin(x * D2R), cd = x => Math.cos(x * D2R);
function fmtDur(h) {
  h = Math.round(h);
  if (h < 48) return `${h} h`;
  const d = Math.floor(h / 24), r = h % 24;
  return r ? `${d} d ${r} h` : `${d} d`;
}
function fit(cv) {
  const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
  if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
  const ctx = cv.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}
const site = () => SITES.find(s => s.id === S.site);

/* ===== Astronomia ===== */
function sunRA(ms) {
  const T = (ms / 864e5 + 2440587.5 - 2451545) / 36525;
  const L0 = 280.46646 + 36000.76983 * T, M = 357.52911 + 35999.05029 * T;
  const lam = L0 + 1.914602 * sd(M) + 0.019993 * sd(2 * M), eps = 23.4393;
  return norm(Math.atan2(cd(eps) * sd(lam), cd(lam)) / D2R);
}
/** Lua vista de uma base na Terra: elevação (graus) e distância (km). */
function moonFromSite(e, s) {
  const th = e.gmst + s.lon, ux = cd(s.lat) * cd(th), uy = cd(s.lat) * sd(th), uz = sd(s.lat);
  const d = e.earth.dist, mx = d * cd(e.dec) * cd(e.ra), my = d * cd(e.dec) * sd(e.ra), mz = d * sd(e.dec);
  const vx = mx - RE * ux, vy = my - RE * uy, vz = mz - RE * uz, n = Math.hypot(vx, vy, vz);
  return { el: Math.asin((vx * ux + vy * uy + vz * uz) / n) / D2R, dist: n };
}
function nextMoonrise(s, ms) {
  if (moonFromSite(ephem(ms), s).el > 0) return 0;
  for (let m = 10; m <= 30 * 60; m += 10) if (moonFromSite(ephem(ms + m * 6e4), s).el > 0) return m / 60;
  return null;
}

/* ===== Trajetória (elipse de Kepler) ===== */
function ellipse(rp, ra, rTarget) {
  const a = (rp + ra) / 2, e = (ra - rp) / (ra + rp), n = Math.sqrt(MU / (a * a * a));
  const Earr = Math.acos(Math.max(-1, Math.min(1, (1 - rTarget / a) / e)));
  const tof = (Earr - e * Math.sin(Earr)) / n;
  const nuArr = 2 * Math.atan(Math.sqrt((1 + e) / (1 - e)) * Math.tan(Earr / 2));
  const dv = Math.sqrt(MU * (2 / rp - 1 / a)) - Math.sqrt(MU / rp);
  return { rp, ra, a, e, n, tof, Earr, nuArr, dv };
}
function transfer(rp, rTarget, kind) {
  if (kind === "hohmann") return ellipse(rp, rTarget, rTarget);
  // rápida: apogeu além da Lua, ajustado para cruzar a distância dela em ~72 h
  const goal = 72 * 3600;
  let lo = rTarget * 1.0001, hi = rTarget * 60;
  if (ellipse(rp, hi, rTarget).tof > goal) return ellipse(rp, hi, rTarget);
  for (let k = 0; k < 60; k++) { const mid = (lo + hi) / 2; if (ellipse(rp, mid, rTarget).tof > goal) lo = mid; else hi = mid; }
  return ellipse(rp, hi, rTarget);
}
function craftAt(tr, tSec) {
  if (tSec < 0 || tSec > tr.tof) return null;
  const M = tr.n * tSec; let E = M;
  for (let k = 0; k < 12; k++) E -= (E - tr.e * Math.sin(E) - M) / (1 - tr.e * Math.cos(E));
  return { r: tr.a * (1 - tr.e * Math.cos(E)), nu: 2 * Math.atan(Math.sqrt((1 + tr.e) / (1 - tr.e)) * Math.tan(E / 2)) };
}

/* ===== Cálculo ao mudar os parâmetros ===== */
function readLaunch() {
  const [d, t] = $("launch").value.split("T"), [y, mo, da] = d.split("-").map(Number), [hh, mm] = (t || "00:00").split(":").map(Number);
  return Date.UTC(y, mo - 1, da, hh, mm || 0);
}
function compute() {
  S.t0 = readLaunch();
  const N = SPAN_H + 1, dist = new Float64Array(N), ra = new Float64Array(N);
  for (let i = 0; i < N; i++) { const e = ephem(S.t0 + i * 36e5); dist[i] = e.earth.dist; ra[i] = e.ra; }
  let peri = Infinity, apo = 0; for (const v of dist) { peri = Math.min(peri, v); apo = Math.max(apo, v); }
  S.moon = { dist, ra, peri, apo };
  // a distância da Lua na chegada depende da hora da chegada: itera até estabilizar
  const rp = RE + +$("park").value, kind = $("traj").value;
  let rT = dist[0], tr = null;
  for (let k = 0; k < 6; k++) { tr = transfer(rp, rT, kind); rT = ephem(S.t0 + tr.tof * 1000).earth.dist; }
  tr = transfer(rp, rT, kind);
  const eArr = ephem(S.t0 + tr.tof * 1000);
  tr.raArr = eArr.ra; tr.distArr = eArr.earth.dist;
  tr.omega = eArr.ra - tr.nuArr / D2R;  // direção do perigeu na vista de cima
  S.tr = tr;
}

/* ===== Vista de cima ===== */
function drawOrbit() {
  const cv = $("orbit"), { ctx, w, h } = fit(cv), cx = w / 2, cy = h / 2;
  const R = Math.min(w, h) / 2 - 28, maxKm = 420000, k = R / maxKm;
  const P = (ang, r) => [cx + r * k * cd(ang), cy - r * k * sd(ang)];
  const ms = S.t0 + S.tau * 36e5, e = ephem(ms), tr = S.tr;
  ctx.clearRect(0, 0, w, h);
  ctx.font = "10px " + col("--f-mono"); ctx.lineWidth = 1;
  const sa = sunRA(ms);
  // anéis de distância
  for (let d = 100000; d <= 400000; d += 100000) {
    ctx.strokeStyle = col("--grid"); ctx.beginPath(); ctx.arc(cx, cy, d * k, 0, 7); ctx.stroke();
    ctx.fillStyle = col("--muted"); ctx.textAlign = "left"; ctx.textBaseline = "bottom";
    ctx.fillText(`${d / 1000} mil km`, cx + 4, cy - d * k - 2);
  }
  ctx.setLineDash([5, 4]); ctx.strokeStyle = rgba(col("--lit"), 0.7);
  for (const [d, lab] of [[S.moon.peri, "perigeu"], [S.moon.apo, "apogeu"]]) {
    ctx.beginPath(); ctx.arc(cx, cy, d * k, 0, 7); ctx.stroke();
    ctx.fillStyle = col("--muted"); ctx.textAlign = "left"; ctx.textBaseline = lab === "apogeu" ? "bottom" : "top";
    const ang = sa > 0 && sa < 90 ? 135 : 45;  // lado oposto ao Sol quando ele está no alto à direita
    ctx.textAlign = ang === 45 ? "left" : "right";
    const txt = w < 500 ? `${lab} ${km(d / 1000)} mil` : `${lab} ${km(d / 1000)} mil km`;
    let tx = cx + d * k * cd(ang) + (ang === 45 ? 4 : -4);
    const tw = ctx.measureText(txt).width;
    if (ang === 45 && tx + tw > w - 2) tx = w - 2 - tw;
    if (ang === 135 && tx - tw < 2) tx = 2 + tw;
    ctx.fillText(txt, tx, cy - d * k * sd(ang) + (lab === "apogeu" ? -2 : 2));
  }
  ctx.setLineDash([]);
  // caminho da Lua nos 30 dias
  ctx.strokeStyle = rgba(col("--lit"), 0.35); ctx.lineWidth = 1.5; ctx.beginPath();
  for (let i = 0; i <= SPAN_H; i += 2) { const [x, y] = P(S.moon.ra[i], S.moon.dist[i]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
  ctx.stroke(); ctx.lineWidth = 1;
  // direção do Sol
  const [sx, sy] = [cx + (R + 6) * cd(sa), cy - (R + 6) * sd(sa)], [sx2, sy2] = [cx + (R - 26) * cd(sa), cy - (R - 26) * sd(sa)];
  ctx.strokeStyle = col("--sun"); ctx.fillStyle = col("--sun"); ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(sx2, sy2); ctx.lineTo(sx, sy); ctx.stroke(); ctx.beginPath(); ctx.arc(sx, sy, 6, 0, 7); ctx.fill(); ctx.lineWidth = 1;
  ctx.font = "600 11px " + col("--f-mono"); ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText("SOL", cx + (R - 40) * cd(sa), cy - (R - 40) * sd(sa));
  // trajetória da nave
  const pathPt = E => { const r = tr.a * (1 - tr.e * Math.cos(E)), nu = 2 * Math.atan(Math.sqrt((1 + tr.e) / (1 - tr.e)) * Math.tan(E / 2)); return P(tr.omega + nu / D2R, r); };
  const tSec = S.tau * 3600, cs = craftAt(tr, tSec);
  ctx.strokeStyle = col("--craft"); ctx.lineWidth = 2; ctx.setLineDash([4, 4]); ctx.beginPath();
  for (let j = 0; j <= 120; j++) { const [x, y] = pathPt(tr.Earr * j / 120); j ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
  ctx.stroke(); ctx.setLineDash([]);
  if (cs) {  // trecho já percorrido
    const Enow = 2 * Math.atan(Math.sqrt((1 - tr.e) / (1 + tr.e)) * Math.tan(cs.nu / 2));
    ctx.beginPath(); for (let j = 0; j <= 60; j++) { const [x, y] = pathPt(Enow * j / 60); j ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke();
  }
  ctx.lineWidth = 1;
  // Lua na chegada (fantasma) e Lua agora
  const [gx, gy] = P(tr.raArr, tr.distArr);
  ctx.strokeStyle = col("--lit"); ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.arc(gx, gy, 9, 0, 7); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = col("--muted"); ctx.font = "11px " + col("--f-body"); ctx.textBaseline = "middle";
  const gl = "Lua na chegada", gw = ctx.measureText(gl).width, right = gx + 14 + gw < w;
  ctx.textAlign = right ? "left" : "right"; ctx.fillText(gl, gx + (right ? 14 : -14), gy + (gy < 20 ? 12 : 0));
  const [mx, my] = P(e.ra, e.earth.dist);
  ctx.beginPath(); ctx.arc(mx, my, 8, 0, 7); ctx.fillStyle = col("--lit"); ctx.fill(); ctx.strokeStyle = col("--bg"); ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1;
  ctx.fillStyle = col("--fg"); ctx.font = "600 12px " + col("--f-body"); ctx.textAlign = mx > cx ? "left" : "right";
  ctx.fillText("Lua", mx + (mx > cx ? 13 : -13), my);
  if (cs) {
    const [nx, ny] = P(tr.omega + cs.nu / D2R, cs.r);
    ctx.beginPath(); ctx.arc(nx, ny, 5.5, 0, 7); ctx.fillStyle = col("--craft"); ctx.fill(); ctx.strokeStyle = col("--bg"); ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1;
  }
  // Terra (ampliada) com lado iluminado e bases girando com ela
  const re = Math.max(16, R * 0.075);
  ctx.beginPath(); ctx.arc(cx, cy, re, 0, 7); ctx.fillStyle = col("--shade"); ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy, re, -(sa + 90) * D2R, -(sa - 90) * D2R); ctx.closePath(); ctx.fillStyle = rgba(col("--earth"), 0.85); ctx.fill();
  ctx.strokeStyle = col("--line"); ctx.beginPath(); ctx.arc(cx, cy, re, 0, 7); ctx.stroke();
  for (const s of SITES) {
    const th = e.gmst + s.lon, rr = re * cd(s.lat), x = cx + rr * cd(th), y = cy - rr * sd(th), sel = s.id === S.site;
    ctx.beginPath(); ctx.arc(x, y, sel ? 4.5 : 3, 0, 7); ctx.fillStyle = sel ? col("--fg") : col("--muted"); ctx.fill();
    if (sel) {
      ctx.strokeStyle = col("--earth"); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 7, 0, 7); ctx.stroke(); ctx.lineWidth = 1;
      const lx = cx + (re + 16) * cd(th), ly = cy - (re + 16) * sd(th);
      ctx.font = "600 11px " + col("--f-body"); ctx.textAlign = lx >= cx ? "left" : "right"; ctx.fillStyle = col("--fg");
      ctx.lineJoin = "round"; ctx.lineWidth = 3; ctx.strokeStyle = rgba(col("--panel"), 0.85); ctx.strokeText(s.short, lx, ly); ctx.fillText(s.short, lx, ly); ctx.lineWidth = 1;
    }
  }
}
function rgba(hex, a) {
  hex = hex.replace("#", ""); if (hex.length === 3) hex = hex.split("").map(c => c + c).join("");
  const n = parseInt(hex, 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
}

/* ===== Gráfico tempo × distância ===== */
function drawChart() {
  const cv = $("dist"), { ctx, w, h } = fit(cv), pad = { l: 78, r: 12, t: 14, b: 26 }, N = SPAN_H + 1, tr = S.tr;
  const X = hr => pad.l + hr / SPAN_H * (w - pad.l - pad.r), Y = v => pad.t + (1 - v / 420000) * (h - pad.t - pad.b);
  ctx.clearRect(0, 0, w, h);
  ctx.font = "10px " + col("--f-mono"); ctx.strokeStyle = col("--grid"); ctx.fillStyle = col("--muted");
  ctx.textAlign = "right"; ctx.textBaseline = "middle";
  for (let v = 0; v <= 400000; v += 100000) { ctx.beginPath(); ctx.moveTo(pad.l, Y(v)); ctx.lineTo(w - pad.r, Y(v)); ctx.stroke(); ctx.fillText(v ? `${v / 1000} mil km` : "Terra", pad.l - 6, Y(v)); }
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  const narrow = w < 640, stepD = narrow ? 10 : 5;
  for (let d = 0; d <= 30; d += stepD) {
    const x = X(d * 24); ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, h - pad.b); ctx.stroke();
    ctx.textAlign = d === 30 ? "right" : d === 0 ? "left" : "center";
    ctx.fillText(d && !narrow ? `${d} d · ${fmtD.format(S.t0 + d * 864e5)}` : fmtD.format(S.t0 + d * 864e5), x, h - pad.b + 6);
  }
  // Lua
  ctx.strokeStyle = col("--lit"); ctx.lineWidth = 2.5; ctx.beginPath();
  for (let i = 0; i < N; i++) { const x = X(i), y = Y(S.moon.dist[i]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke(); ctx.lineWidth = 1;
  // perigeus e apogeus (extremos locais)
  ctx.font = "10px " + col("--f-mono"); ctx.fillStyle = col("--muted"); ctx.textAlign = "center";
  for (let i = 24; i < N - 24; i++) {
    const v = S.moon.dist[i]; let mn = true, mxx = true;
    for (let j = i - 24; j <= i + 24; j++) { if (S.moon.dist[j] < v) mn = false; if (S.moon.dist[j] > v) mxx = false; }
    if (mn) { ctx.textBaseline = "top"; ctx.fillText(`perigeu ${km(v / 1000)} mil`, X(i), Y(v) + 6); i += 24; }
    else if (mxx) { ctx.textBaseline = "bottom"; ctx.fillText(`apogeu ${km(v / 1000)} mil`, X(i), Y(v) - 6); i += 24; }
  }
  // nave
  const tofH = tr.tof / 3600;
  ctx.strokeStyle = col("--craft"); ctx.lineWidth = 2.5; ctx.beginPath();
  for (let j = 0; j <= 200; j++) { const t = tr.tof * j / 200, c = craftAt(tr, t); const x = X(t / 3600), y = Y(c.r); j ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
  ctx.stroke(); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(X(tofH), Y(tr.distArr), 5, 0, 7); ctx.fillStyle = col("--craft"); ctx.fill();
  ctx.fillStyle = col("--fg"); ctx.font = "600 11px " + col("--f-body"); ctx.textAlign = "left"; ctx.textBaseline = "bottom";
  ctx.fillText(`chegada em ${fmtDur(tofH)}`, X(tofH) + 8, Y(tr.distArr) - 8);
  // cursor
  const cxp = X(S.tau); ctx.strokeStyle = col("--fg"); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(cxp, pad.t); ctx.lineTo(cxp, h - pad.b); ctx.stroke(); ctx.lineWidth = 1;
  cv._geo = { pad, w };
}
let dragging = false;
function chartSet(ev) {
  const g = $("dist")._geo, r = $("dist").getBoundingClientRect(), x = ev.clientX - r.left;
  S.tau = Math.round(Math.max(0, Math.min(1, (x - g.pad.l) / (g.w - g.pad.l - g.pad.r))) * SPAN_H * 2) / 2;
  $("scrub").value = S.tau; renderTime();
}
$("dist").addEventListener("pointerdown", e => { dragging = true; $("dist").setPointerCapture(e.pointerId); chartSet(e); });
$("dist").addEventListener("pointermove", e => { if (dragging) chartSet(e); });
$("dist").addEventListener("pointerup", () => { dragging = false; });

/* ===== Painel e tabela ===== */
function panel() {
  const s = site(), ms = S.t0 + S.tau * 36e5, e = ephem(ms), tr = S.tr, d = e.earth.dist, ms_site = moonFromSite(e, s);
  $("sName").textContent = `${s.name} (${s.org})`;
  $("sCoords").textContent = `${num(Math.abs(s.lat), 2)}°${s.lat < 0 ? "S" : "N"} · ${num(Math.abs(s.lon), 2)}°${s.lon < 0 ? "O" : "L"}`;
  $("nowLbl").textContent = `${fmt.format(ms)} UTC · ${fmtDur(S.tau)} após o lançamento`;
  const pos = (d - S.moon.peri) / (S.moon.apo - S.moon.peri);
  $("rDist").textContent = `${km(d)} km`;
  $("rDistD").textContent = `a luz leva ${num(d / C_KMS, 2)} s · ${pos < 0.25 ? "perto do perigeu" : pos > 0.75 ? "perto do apogeu" : "entre perigeu e apogeu"}`;
  $("rSite").textContent = ms_site.el > 0 ? `no céu, ${num(ms_site.el)}°` : `abaixo, ${num(ms_site.el)}°`;
  $("rSiteD").textContent = `a ${km(ms_site.dist)} km da base`;
  const c = craftAt(tr, S.tau * 3600), tofH = tr.tof / 3600;
  if (c) { $("rCraft").textContent = `${km(c.r)} km`; $("rCraftD").textContent = `${Math.round(100 * (c.r - tr.rp) / (tr.distArr - tr.rp))}% do caminho até a distância da Lua`; }
  else { $("rCraft").textContent = "chegou"; $("rCraftD").textContent = "fase de órbita lunar fora da simulação"; }
  $("rArr").textContent = `em ${fmtDur(tofH)}`;
  $("rArrD").textContent = `${fmt.format(S.t0 + tr.tof * 1000)} UTC · Lua a ${km(tr.distArr)} km`;
  $("rDv").textContent = `${num(tr.dv, 2)} km/s`;
  const v = V_EQ * cd(s.lat), vK = V_EQ * cd(SITES[0].lat);
  $("rRot").textContent = `${Math.round(v)} m/s`;
  $("rRotD").textContent = s.id === "ksc" ? "referência para comparar as bases" : `${v >= vK ? "+" : "−"}${Math.round(Math.abs(v - vK))} m/s em relação ao Kennedy`;
  const traj = $("traj").value === "fast" ? "rápida" : "econômica";
  $("explain").textContent = `${s.desc} Neste momento a Lua está a ${km(d)} km da Terra e ${ms_site.el > 0 ? `aparece no céu da base, a ${num(ms_site.el)}° de altura` : "está abaixo do horizonte da base"}. `
    + `Uma nave lançada daqui na trajetória ${traj} chega em ${fmtDur(tofH)}, quando a Lua estará a ${km(tr.distArr)} km.`;
}
function table() {
  const ms = S.t0 + S.tau * 36e5, e = ephem(ms), vK = V_EQ * cd(SITES[0].lat);
  $("tbl").tBodies[0].innerHTML = SITES.map(s => {
    const m = moonFromSite(e, s), v = V_EQ * cd(s.lat), rise = m.el > 0 ? 0 : nextMoonrise(s, ms);
    return `<tr tabindex="0" data-id="${s.id}" class="${s.id === S.site ? "sel" : ""}">
      <td>${s.name} <span class="ref">${s.org}</span></td>
      <td class="num">${num(Math.abs(s.lat), 2)}°${s.lat < 0 ? "S" : "N"}</td>
      <td class="num">${Math.round(v)} m/s${s.id === "ksc" ? "" : ` (${v >= vK ? "+" : "−"}${Math.round(Math.abs(v - vK))})`}</td>
      <td class="num">${num(Math.abs(s.lat), 1)}°</td>
      <td class="num ${m.el > 0 ? "yes" : "no"}">${m.el > 0 ? `sim, ${num(m.el)}°` : `não, ${num(m.el)}°`}</td>
      <td class="num">${km(m.dist)} km</td>
      <td class="num">${rise === 0 ? "já está no céu" : rise == null ? "—" : `em ${fmtDur(rise)}`}</td></tr>`;
  }).join("");
}
$("tbl").addEventListener("click", e => { const tr = e.target.closest("tr[data-id]"); if (tr) { S.site = tr.dataset.id; $("site").value = S.site; renderAll(); } });
$("tbl").addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.target.click(); } });

/* ===== Orquestração ===== */
let tableTimer = null;
function renderTime() {
  drawOrbit(); drawChart(); panel();
  clearTimeout(tableTimer); tableTimer = setTimeout(table, S.playing ? 400 : 60);  // a tabela procura o nascer da Lua: atualiza com folga
}
function renderAll() { renderTime(); table(); }
function recompute() { $("parkO").textContent = `${$("park").value} km`; compute(); renderAll(); }

$("site").innerHTML = SITES.map(s => `<option value="${s.id}">${s.name} (${s.org})</option>`).join("");
$("site").addEventListener("change", () => { S.site = $("site").value; renderAll(); });
$("launch").addEventListener("change", () => { S.tau = 0; $("scrub").value = 0; recompute(); });
["traj", "park"].forEach(id => $(id).addEventListener("input", recompute));
$("scrub").addEventListener("input", () => { S.tau = +$("scrub").value; renderTime(); });
let timer = null;
$("play").onclick = () => {
  S.playing = !S.playing; $("play").setAttribute("aria-pressed", S.playing); $("play").textContent = S.playing ? "❚❚ Pausar" : "▶ Animar";
  if (S.playing) {
    if (S.tau >= SPAN_H) S.tau = 0;
    timer = setInterval(() => {
      S.tau = Math.min(SPAN_H, S.tau + 1); $("scrub").value = S.tau; renderTime();
      if (S.tau >= SPAN_H) $("play").click();
    }, 50);
  } else { clearInterval(timer); table(); }
};
new ResizeObserver(() => renderTime()).observe(document.querySelector(".wrap"));
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", renderAll);

// Abre com o lançamento na hora cheia atual (UTC) e a nave a meio caminho, para a vista já mostrar a viagem
const now = new Date(); now.setUTCMinutes(0, 0, 0);
$("launch").value = now.toISOString().slice(0, 16);
recompute();
S.tau = Math.round(S.tr.tof / 3600 / 2); $("scrub").value = S.tau; renderAll();
})();
