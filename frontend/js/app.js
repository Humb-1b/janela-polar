/* Janela Polar — interface.
 *
 * Fluxo dos dados:
 *   1. Ao abrir ou mudar período/conjunto, calcula tudo no navegador (instantâneo).
 *   2. Pede ao backend os dados da JPL Horizons (/api/bundle e /api/point) e troca quando chegam.
 *   3. Sem backend, tenta um pacote pré-calculado (data/bundle-<início>-<dias>d.json).
 * Todas as fontes produzem o mesmo formato "raw":
 *   { sites: {id: {se, sa, ee, ea, mask}}, dsnEl: [Float32Array por antena] }
 * e as janelas (Sol, contato, ideal) são recalculadas aqui a cada ajuste de controle.
 */
"use strict";
(function () {
const E = window.LunarEngine;
const { D2R, norm, wrap, ephem, topo, discFrac, dsnElevation, horizonDip, SUN_RADIUS_DEG } = E;
const $ = id => document.getElementById(id);
const API_BASE = window.JANELA_API_BASE ?? (location.protocol === "file:" ? "http://localhost:5000" : "");

// localStorage só para conveniências deste navegador (locais e cenários do usuário)
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* sem armazenamento: segue sem salvar */ } },
};

/* ===== Catálogo de reserva (o oficial vem de backend/data/sites.json via /api/sites) ===== */
const NSSDC = "NASA NSSDC";
let GROUPS = [
  { id: "artemis3", name: "Artemis III: regiões candidatas" },
  { id: "pousos", name: "Pousos recentes: CLPS e outros países" },
  { id: "apollo", name: "Apollo" },
];
const FALLBACK_SITES = [
  ["cab", "Pico perto de Cabeus B", "artemis3", -83.6, -49, "Região mais distante do polo; voltada para o lado visível, boa visada da Terra."],
  ["haw", "Haworth", "artemis3", -87.0, -4, "Borda da cratera Haworth, vizinha de regiões permanentemente sombreadas."],
  ["mal", "Maciço Malapert", "artemis3", -85.9, 3, "Maciço alto voltado para a Terra; muito citado como ponto de retransmissão."],
  ["mmp", "Platô Mons Mouton", "artemis3", -84.7, 38, "Platô no topo de Mons Mouton, área alta e relativamente plana."],
  ["mmo", "Mons Mouton", "artemis3", -84.3, 31, "Encostas de Mons Mouton, uma das maiores elevações da região."],
  ["nb1", "Borda Nobile 1", "artemis3", -85.6, 45, "Borda da cratera Nobile, próxima a sombras permanentes."],
  ["nb2", "Borda Nobile 2", "artemis3", -84.3, 60, "Outro trecho da borda de Nobile, mais a leste."],
  ["dg2", "Borda de Gerlache 2", "artemis3", -88.4, -64, "A mais próxima do polo (~50 km), sobre um relevo ~3 km acima do entorno."],
  ["sla", "Planície Slater", "artemis3", -87.6, 112, "Planície do lado oposto à Terra: compare a comunicação com os demais."],
  ["shk", "Borda de Shackleton", "artemis3", -89.7, -130, "Referência clássica de iluminação quase contínua (não está na lista de 9).", true],
  ["im1", "IM-1 Odysseus", "pousos", -80.13, 1.44, "Intuitive Machines, fev/2024 (CLPS). Primeiro pouso comercial dos EUA, perto da cratera Malapert A."],
  ["im2", "IM-2 Athena", "pousos", -84.7906, 29.1957, "Intuitive Machines, mar/2025 (CLPS). Pouso mais ao sul até então, em Mons Mouton; tombou e operou por pouco tempo."],
  ["ch3", "Chandrayaan-3", "pousos", -69.3741, 32.32, "ISRO (Índia), ago/2023. Ponto Shiv Shakti; operou durante um dia lunar."],
  ["bg1", "Blue Ghost 1", "pousos", 18.562, 61.81, "Firefly, mar/2025 (CLPS), Mare Crisium. Operou um dia lunar inteiro e registrou o pôr do Sol."],
  ["slim", "SLIM", "pousos", -13.316, 25.251, "JAXA (Japão), jan/2024. Pousou de lado; os painéis ficaram voltados para o oeste e só geraram energia à tarde."],
  ["ce4", "Chang'e 4", "pousos", -45.4561, 177.5885, "CNSA (China), jan/2019. Primeiro pouso no lado oculto: a Terra nunca aparece, o contato é pelo satélite Queqiao."],
  ["ce6", "Chang'e 6", "pousos", -41.6385, -153.9852, "CNSA (China), jun/2024. Trouxe as primeiras amostras do lado oculto, com retransmissão pelo Queqiao-2."],
  ["a11", "Apollo 11", "apollo", 0.67416, 23.47314, "Jul/1969, Mar da Tranquilidade. Perto do equador: o Sol sobe alto e a Terra fica quase parada no céu."],
  ["a15", "Apollo 15", "apollo", 26.13239, 3.6333, "Jul/1971, Hadley-Apeninos. Primeira missão com o jipe lunar."],
  ["a17", "Apollo 17", "apollo", 20.1911, 30.7723, "Dez/1972, Taurus-Littrow. Último pouso tripulado até hoje."],
].map(([id, name, group, lat, lon, desc, ref]) => ({ id, name, group, lat, lon, desc, ref: !!ref, approx: group === "artemis3" }));

let DSN = [
  { id: "gdscc", name: "Goldstone", lat: 35.4267, lon: -116.89 },
  { id: "mdscc", name: "Madri", lat: 40.4314, lon: -4.2481 },
  { id: "cdscc", name: "Canberra", lat: -35.4014, lon: 148.9817 },
];
const GROUP_TAG = { artemis3: "Artemis III", pousos: "pouso", apollo: "Apollo", custom: "meu local" };

let customSites = store.get("janela.custom", []);
let CATALOG = FALLBACK_SITES.concat(customSites);
let SITES = [];

/* ===== Estado ===== */
const S = {
  group: "artemis3", start: 0, hours: 720, t: 0, sel: "mal",
  mapMode: "polar", layer: { sun: true, earth: false }, sort: { k: "score", dir: -1 },
  ephs: null, raw: null, win: null, stats: null, dsnMask: null, h0: 0.5, src: "local", playing: false,
};
let scenarios = store.get("janela.scenarios", []);

const fmt = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const fmtD = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", day: "2-digit", month: "short" });
const fmtMon = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", month: "short" });
const col = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const num = (v, d = 1) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const todayISO = () => new Date().toISOString().slice(0, 10);
const isoDay = ms => new Date(ms).toISOString().slice(0, 10);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function fmtDur(h) {
  if (h < 48) return `${h} h`;
  const d = Math.floor(h / 24), r = h % 24;
  return r ? `${d} d ${r} h` : `${d} d`;
}
function rgba(hex, a) {
  hex = hex.replace("#", "");
  if (hex.length === 3) hex = hex.split("").map(c => c + c).join("");
  const n = parseInt(hex, 16);
  return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
}
const rgb = hex => { const n = parseInt(hex.replace("#", ""), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
function fmtCoord(s) {
  const la = `${num(Math.abs(s.lat), 2)}°${s.lat < 0 ? "S" : "N"}`, lo = `${num(Math.abs(wrap(s.lon)), 2)}°${wrap(s.lon) < 0 ? "O" : "L"}`;
  return `${s.approx ? "~" : ""}${la} · ${lo}`;
}

/* ===== Conjuntos de locais ===== */
function fillGroups() {
  const opts = GROUPS.map(g => [g.id, g.name]);
  if (customSites.length) opts.push(["custom", "Meus locais"]);
  opts.push(["all", "Todos os locais"]);
  if (!opts.some(o => o[0] === S.group)) S.group = "artemis3";
  $("group").innerHTML = opts.map(([v, l]) => `<option value="${v}"${v === S.group ? " selected" : ""}>${esc(l)}</option>`).join("");
}
function visibleSites() {
  return S.group === "all" ? CATALOG.slice() : CATALOG.filter(s => s.group === S.group);
}
function siteById(id) { return CATALOG.find(s => s.id === id); }

/* ===== Dados ===== */
function readPeriod() {
  const [y, mo, d] = $("start").value.split("-").map(Number);
  S.start = Date.UTC(y, (mo || 1) - 1, d || 1);
  S.hours = +$("dur").value * 24;
}
function periodEphem() {
  const N = S.hours + 1, ephs = new Array(N);
  for (let i = 0; i < N; i++) ephs[i] = ephem(S.start + i * 36e5);
  S.ephs = ephs;
}
function localSeries(site) {
  const N = S.hours + 1, r = { se: new Float32Array(N), sa: new Float32Array(N), ee: new Float32Array(N), ea: new Float32Array(N), mask: null };
  for (let i = 0; i < N; i++) {
    const e = S.ephs[i], a = topo(site.lat, site.lon, e.sun), b = topo(site.lat, site.lon, e.earth);
    r.se[i] = a.el; r.sa[i] = a.az; r.ee[i] = b.el; r.ea[i] = b.az;
  }
  return r;
}
function buildLocalRaw() {
  periodEphem();
  const raw = { sites: {}, dsnEl: DSN.map(st => Float32Array.from(S.ephs, e => dsnElevation(e, st))) };
  for (const s of SITES) raw.sites[s.id] = localSeries(s);
  return raw;
}
function ensureLocal() { for (const s of SITES) if (!S.raw.sites[s.id]) S.raw.sites[s.id] = localSeries(s); }

const F32 = a => Float32Array.from(a, v => v == null ? NaN : v);
function applyBundle(b) {
  if (b.step_min !== 60 || b.n !== S.hours + 1) throw new Error("pacote com período diferente");
  for (const [id, r] of Object.entries(b.sites)) {
    if (!siteById(id)) continue;
    S.raw.sites[id] = { se: F32(r.sun_el), sa: F32(r.sun_az), ee: F32(r.earth_el), ea: F32(r.earth_az), mask: r.mask || null };
  }
  if (b.dsn && b.dsn.elev) S.raw.dsnEl = DSN.map((st, k) => b.dsn.elev[st.id] ? F32(b.dsn.elev[st.id]) : S.raw.dsnEl[k]);
}
function applyPoint(id, p) {
  if (p.n !== S.hours + 1) throw new Error("série com período diferente");
  const r = p.series;
  S.raw.sites[id] = { se: F32(r.sun_el), sa: F32(r.sun_az), ee: F32(r.earth_el), ea: F32(r.earth_az), mask: null };
}
async function fetchJSON(url, ms) {
  const c = new AbortController(), t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { signal: c.signal });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}
const SRC_LABEL = {
  horizons: "Fonte: JPL Horizons (servidor)",
  mixed: "Fonte: Horizons + modelo analítico (servidor)",
  analytic: "Fonte: modelo analítico (servidor)",
  pre: "Fonte: dados pré-calculados",
  local: "Fonte: cálculo no navegador (sem servidor)",
  loading: "Consultando a JPL Horizons… a primeira vez pode levar ~1 min",
};
function setSource(kind, detail) {
  S.src = kind;
  const el = $("src");
  el.dataset.state = kind === "horizons" ? "horizons" : kind === "loading" ? "loading" : "other";
  el.textContent = SRC_LABEL[kind] + (detail ? ` · ${detail}` : "");
  $("csv").hidden = !["horizons", "mixed", "analytic"].includes(kind) || !!(siteById(S.sel) || {}).custom;
}
let loadToken = 0;
async function loadRemote() {
  const token = ++loadToken, date = $("start").value, days = $("dur").value;
  const std = SITES.filter(s => !s.custom), cus = SITES.filter(s => s.custom);
  const q = `start=${date}&days=${days}&step=60`;
  setSource("loading");
  try {
    let kind = null, warn = 0;
    if (std.length) {
      const b = await fetchJSON(`${API_BASE}/api/bundle?${q}&sites=${std.map(s => s.id).join(",")}`, 180000);
      if (token !== loadToken) return;
      applyBundle(b); kind = b.source; warn += (b.warnings || []).length;
    }
    for (const c of cus) {
      const p = await fetchJSON(`${API_BASE}/api/point?${q}&lat=${c.lat}&lon=${c.lon}`, 120000);
      if (token !== loadToken) return;
      applyPoint(c.id, p); kind = kind && kind !== p.source ? "mixed" : p.source;
    }
    setSource(kind || "local", warn ? `${warn} aviso(s)` : "");
  } catch (err) {
    if (token !== loadToken) return;
    try {
      const b = await fetchJSON(`data/bundle-${date}-${days}d.json`, 8000);
      if (token !== loadToken) return;
      applyBundle(b);
      setSource("pre", b.source === "horizons" ? "JPL Horizons" : "modelo analítico");
    } catch (_) {
      if (token !== loadToken) return;
      setSource("local");
      return;
    }
  }
  computeWindows(); renderAll();
}

/* ===== Janelas ===== */
function horizonEff() { return +$("mask").value - horizonDip(+$("hgt").value); }
function computeWindows() {
  const H0 = horizonEff(), dmin = +$("dsn").value, N = S.hours + 1, R = S.raw;
  const dsnMask = new Uint8Array(N);
  for (let i = 0; i < N; i++) { let m = 0; R.dsnEl.forEach((a, k) => { if (a[i] >= dmin) m |= 1 << k; }); dsnMask[i] = m; }
  const win = {}, stats = {};
  for (const s of SITES) {
    const r = R.sites[s.id]; if (!r) continue;
    const mask = r.mask;
    const hz = az => H0 + (mask && !isNaN(az) ? (mask[Math.round(norm(az)) % 360] ?? 0) : 0);
    const fr = new Float32Array(N), ok = new Uint8Array(N), hs = new Float32Array(N), he = new Float32Array(N);
    let en = 0, lit = 0, dte = 0, both = 0, dark = 0, maxDark = 0, w = 0, maxWin = 0, earthSeen = 0;
    for (let i = 0; i < N; i++) {
      hs[i] = hz(r.sa[i]); he[i] = hz(r.ea[i]);
      fr[i] = isNaN(r.se[i]) ? 0 : discFrac(r.se[i], hs[i]);
      const L = fr[i] >= 0.5, up = r.ee[i] > he[i], C = up && dsnMask[i] > 0;
      ok[i] = (L ? 1 : 0) | (C ? 2 : 0);
      en += fr[i]; if (fr[i] > 0) lit++; if (C) dte++; if (L && C) both++; if (up) earthSeen++;
      dark = fr[i] === 0 ? dark + 1 : 0; maxDark = Math.max(maxDark, dark);
      w = (L && C) ? w + 1 : 0; maxWin = Math.max(maxWin, w);
    }
    win[s.id] = { fr, ok, hs, he, mask, hz };
    const En = en / N, D = dte / N;
    stats[s.id] = { energy: En, lit: lit / N, dte: D, both: both / N, maxDark, maxWin, earthSeen: earthSeen / N,
      score: 100 * (0.5 * En + 0.3 * D + 0.2 * (1 - maxDark / N)) };
  }
  S.win = win; S.dsnMask = dsnMask; S.stats = stats; S.h0 = H0;
  if (!win[S.sel] && SITES.length) S.sel = SITES[0].id;
  $("scrub").max = S.hours; if (S.t > S.hours) S.t = 0; $("scrub").value = S.t;
}
const site = id => Object.assign({}, S.raw.sites[id], S.win[id]);

/* ===== Canvas ===== */
function fit(cv) {
  const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
  if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
  const ctx = cv.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

/* ===== Mapa: polar estereográfico ou Lua inteira (equiretangular) ===== */
const off = document.createElement("canvas");
function polarExtent() {
  const pol = SITES.filter(s => s.lat <= -75).map(s => 90 + s.lat);
  return pol.length ? Math.min(16, Math.max(7, Math.ceil(Math.max(...pol)) + 1)) : 8;
}
function projection(w, h) {
  if (S.mapMode === "polar") {
    const C = polarExtent(), cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 26, k = Math.tan(C / 2 * D2R);
    return {
      mode: "polar", C, R, cx, cy,
      fwd(lat, lon) { const r = R * Math.tan((90 + lat) / 2 * D2R) / k; return [cx + r * Math.sin(lon * D2R), cy - r * Math.cos(lon * D2R)]; },
      inv(x, y) { const dx = x - cx, dy = cy - y, r = Math.hypot(dx, dy) / R; return { lat: 2 * Math.atan(r * k) / D2R - 90, lon: Math.atan2(dx, dy) / D2R, inside: r <= 1 }; },
      shows: s => s.lat <= C - 90,
    };
  }
  const pad = 22, x0 = pad, y0 = 10, pw = w - 2 * pad, ph = h - y0 - 22;
  return {
    mode: "global", x0, y0, pw, ph,
    fwd(lat, lon) { return [x0 + (wrap(lon) + 180) / 360 * pw, y0 + (90 - lat) / 180 * ph]; },
    inv(x, y) { const lon = (x - x0) / pw * 360 - 180, lat = 90 - (y - y0) / ph * 180; return { lat, lon, inside: lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90 }; },
    shows: () => true,
  };
}
function drawMap() {
  const cv = $("map");
  cv.style.aspectRatio = S.mapMode === "polar" ? "1 / 1" : "2 / 1";
  const { ctx, w, h } = fit(cv), P = projection(w, h);
  ctx.clearRect(0, 0, w, h);
  // o mapa usa o modelo analítico com horizonte liso (seriam milhares de consultas à Horizons)
  const e = ephem(S.start + S.t * 36e5), H = S.h0;
  const ow = P.mode === "polar" ? 150 : 240, oh = P.mode === "polar" ? 150 : 120;
  off.width = ow; off.height = oh;
  const o = off.getContext("2d"), img = o.createImageData(ow, oh);
  const L = rgb(col("--lit")), Sh = rgb(col("--shade")), Ea = rgb(col("--earth"));
  const Psmall = P.mode === "polar"
    ? (i, j) => { const dx = i + 0.5 - ow / 2, dy = oh / 2 - (j + 0.5), r = Math.hypot(dx, dy) / (ow / 2), k = Math.tan(P.C / 2 * D2R);
                  return { lat: 2 * Math.atan(r * k) / D2R - 90, lon: Math.atan2(dx, dy) / D2R, inside: r <= 1 }; }
    : (i, j) => ({ lat: 90 - (j + 0.5) / oh * 180, lon: (i + 0.5) / ow * 360 - 180, inside: true });
  for (let j = 0; j < oh; j++) for (let i = 0; i < ow; i++) {
    const p = Psmall(i, j), k = (j * ow + i) * 4;
    if (!p.inside) { img.data[k + 3] = 0; continue; }
    let c;
    if (S.layer.sun) { const f = discFrac(topo(p.lat, p.lon, e.sun).el, H); c = [0, 1, 2].map(q => Sh[q] + (L[q] - Sh[q]) * (f > 0 ? 0.35 + 0.65 * f : 0.08)); }
    else c = [0, 1, 2].map(q => Sh[q] + (L[q] - Sh[q]) * 0.3);
    if (S.layer.earth && topo(p.lat, p.lon, e.earth).el > H) c = [0, 1, 2].map(q => c[q] * 0.55 + Ea[q] * 0.45);
    img.data[k] = c[0]; img.data[k + 1] = c[1]; img.data[k + 2] = c[2]; img.data[k + 3] = 255;
  }
  o.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.strokeStyle = col("--grid"); ctx.fillStyle = col("--muted"); ctx.lineWidth = 1; ctx.font = "11px " + col("--f-mono");
  if (P.mode === "polar") {
    const { cx, cy, R } = P;
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.clip(); ctx.drawImage(off, cx - R, cy - R, 2 * R, 2 * R); ctx.restore();
    for (let la = -89; la > P.C - 90; la--) { const [, y] = P.fwd(la, 0); ctx.beginPath(); ctx.arc(cx, cy, cy - y, 0, 7); ctx.stroke(); }
    ctx.textAlign = "left";
    for (let la = -88; la > P.C - 90; la -= 2) { const [x, y] = P.fwd(la, 15); ctx.fillText(Math.abs(la) + "°S", x + 3, y - 3); }
    for (let lo = 0; lo < 360; lo += 30) {
      const [x, y] = P.fwd(P.C - 90, lo); ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke();
      const r = R + 14, lx = cx + r * Math.sin(lo * D2R), ly = cy - r * Math.cos(lo * D2R), v = wrap(lo);
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(v === 0 ? "0°" : v === 180 ? "180°" : Math.abs(v) + "°" + (v > 0 ? "L" : "O"), lx, ly);
    }
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.strokeStyle = col("--line"); ctx.stroke();
    const arrow = (lon, c, label) => {
      const p1 = [cx + (R - 4) * Math.sin(lon * D2R), cy - (R - 4) * Math.cos(lon * D2R)], p2 = [cx + (R - 30) * Math.sin(lon * D2R), cy - (R - 30) * Math.cos(lon * D2R)];
      ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(...p1); ctx.lineTo(...p2); ctx.stroke(); ctx.beginPath(); ctx.arc(...p1, 6, 0, 7); ctx.fill();
      ctx.font = "600 11px " + col("--f-mono"); ctx.textAlign = "center";
      ctx.fillText(label, cx + (R - 44) * Math.sin(lon * D2R), cy - (R - 44) * Math.cos(lon * D2R)); ctx.lineWidth = 1;
    };
    arrow(e.sun.lon, col("--sun"), "SOL"); arrow(e.earth.lon, col("--earth"), "TERRA");
    $("mapTitle").textContent = `Polo sul lunar · ${90 - P.C}°S–90°S`;
  } else {
    const { x0, y0, pw, ph } = P;
    ctx.drawImage(off, x0, y0, pw, ph);
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    for (let lo = -180; lo <= 180; lo += 30) {
      const [x] = P.fwd(0, lo === 180 ? 179.999 : lo); ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y0 + ph); ctx.stroke();
      if (lo % 60 === 0) ctx.fillText(lo === 0 ? "0°" : Math.abs(lo) + "°" + (lo > 0 ? "L" : "O"), x, y0 + ph + 4);
    }
    ctx.textAlign = "right"; ctx.textBaseline = "middle";
    for (let la = -60; la <= 60; la += 30) { const [, y] = P.fwd(la, 0); ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + pw, y); ctx.stroke(); ctx.fillText(Math.abs(la) + (la ? (la > 0 ? "N" : "S") : ""), x0 - 3, y); }
    ctx.strokeStyle = col("--line"); ctx.strokeRect(x0, y0, pw, ph);
    const mark = (lat, lon, c, label) => {
      const [x, y] = P.fwd(lat, lon); ctx.beginPath(); ctx.arc(x, y, 6, 0, 7); ctx.fillStyle = c; ctx.fill();
      ctx.font = "600 11px " + col("--f-mono"); ctx.textAlign = "center"; ctx.textBaseline = "bottom"; ctx.fillText(label, x, y - 8);
    };
    mark(e.sun.lat, e.sun.lon, col("--sun"), "SOL A PINO"); mark(e.earth.lat, e.earth.lon, col("--earth"), "TERRA A PINO");
    $("mapTitle").textContent = "Lua inteira · lado visível no centro";
  }
  // locais
  ctx.textBaseline = "middle";
  for (const s of SITES) {
    if (!P.shows(s) || !S.win[s.id]) continue;
    const [x, y] = P.fwd(s.lat, s.lon), sel = s.id === S.sel, ok = S.win[s.id].ok[S.t];
    const c = ok === 3 ? col("--both") : ok === 1 ? col("--sun") : ok === 2 ? col("--earth") : col("--muted");
    ctx.beginPath(); ctx.arc(x, y, sel ? 8 : 5.5, 0, 7); ctx.fillStyle = c; ctx.fill(); ctx.lineWidth = sel ? 2.5 : 1.5; ctx.strokeStyle = col("--bg"); ctx.stroke();
    if (sel) { ctx.beginPath(); ctx.arc(x, y, 13, 0, 7); ctx.strokeStyle = col("--fg"); ctx.lineWidth = 1.5; ctx.stroke(); }
    ctx.font = (sel ? "600 12px " : "11px ") + col("--f-body"); const right = x < w * 0.72; ctx.textAlign = right ? "left" : "right";
    const tx = x + (right ? 12 : -12); ctx.lineJoin = "round"; ctx.lineWidth = 3; ctx.strokeStyle = rgba(col("--panel"), 0.85);
    ctx.strokeText(s.name, tx, y); ctx.fillStyle = col("--fg"); ctx.fillText(s.name, tx, y); ctx.lineWidth = 1;
  }
  cv._proj = P;
}
function siteAt(ev) {
  const cv = $("map"), P = cv._proj; if (!P) return null;
  const r = cv.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top;
  let best = null, bd = 22;
  for (const s of SITES) { if (!P.shows(s)) continue; const [sx, sy] = P.fwd(s.lat, s.lon), d = Math.hypot(sx - x, sy - y); if (d < bd) { bd = d; best = s; } }
  return best;
}
$("map").addEventListener("click", ev => { const s = siteAt(ev); if (s) { S.sel = s.id; renderAll(); } });
$("map").addEventListener("mousemove", ev => { $("map").style.cursor = siteAt(ev) ? "pointer" : "crosshair"; });
function setMapMode(m) {
  S.mapMode = m;
  $("mPolar").setAttribute("aria-pressed", m === "polar"); $("mGlobal").setAttribute("aria-pressed", m === "global");
  if (S.win) drawMap();
}
$("mPolar").onclick = () => setMapMode("polar");
$("mGlobal").onclick = () => setMapMode("global");
$("tSun").onclick = () => { S.layer.sun = !S.layer.sun; $("tSun").setAttribute("aria-pressed", S.layer.sun); drawMap(); };
$("tEarth").onclick = () => { S.layer.earth = !S.layer.earth; $("tEarth").setAttribute("aria-pressed", S.layer.earth); drawMap(); };

/* ===== Horizonte ===== */
function drawHorizon() {
  const cv = $("horizon"), { ctx, w, h } = fit(cv), D = site(S.sel), pad = { l: 34, r: 8, t: 8, b: 20 };
  let hi = 10;
  for (let i = 0; i < D.se.length; i += 3) if (D.se[i] > hi) hi = D.se[i];
  for (let i = 0; i < D.ee.length; i += 3) if (D.ee[i] > hi) hi = D.ee[i];
  hi = Math.min(90, Math.ceil((hi + 2) / 5) * 5); const lo = -8;
  const X = a => pad.l + a / 360 * (w - pad.l - pad.r), Y = v => pad.t + (hi - v) / (hi - lo) * (h - pad.t - pad.b);
  ctx.clearRect(0, 0, w, h);
  const prof = []; for (let a = 0; a <= 360; a += 2) prof.push([X(a), Y(Math.max(lo, Math.min(hi, D.hz(a))))]);
  ctx.beginPath(); ctx.moveTo(pad.l, Y(lo)); prof.forEach(([x, y]) => ctx.lineTo(x, y)); ctx.lineTo(w - pad.r, Y(lo)); ctx.closePath();
  ctx.fillStyle = rgba(col("--shade"), 0.55); ctx.fill();
  ctx.strokeStyle = col("--grid"); ctx.fillStyle = col("--muted"); ctx.font = "10px " + col("--f-mono"); ctx.textAlign = "right"; ctx.textBaseline = "middle";
  const st = hi > 40 ? 20 : hi > 20 ? 10 : 4;
  for (let v = Math.ceil(lo / st) * st; v <= hi; v += st) { ctx.beginPath(); ctx.moveTo(pad.l, Y(v)); ctx.lineTo(w - pad.r, Y(v)); ctx.stroke(); ctx.fillText(v + "°", pad.l - 4, Y(v)); }
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  [["N", 0], ["L", 90], ["S", 180], ["O", 270], ["N", 360]].forEach(([t, a]) => ctx.fillText(t, X(a), h - pad.b + 4));
  ctx.setLineDash([4, 3]); ctx.strokeStyle = col("--fg"); ctx.beginPath(); prof.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke(); ctx.setLineDash([]);
  const track = (el, az, c) => { ctx.fillStyle = rgba(c, 0.35); for (let i = 0; i < el.length; i += 2) { const v = el[i]; if (v < lo || v > hi) continue; ctx.fillRect(X(az[i]) - 1, Y(v) - 1, 2, 2); } };
  track(D.se, D.sa, col("--sun")); track(D.ee, D.ea, col("--earth"));
  const ppd = (h - pad.t - pad.b) / (hi - lo);
  const dot = (el, az, c, r) => { if (el < lo || el > hi) return; ctx.beginPath(); ctx.arc(X(az), Y(el), r, 0, 7); ctx.fillStyle = c; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = col("--panel"); ctx.stroke(); };
  dot(D.se[S.t], D.sa[S.t], col("--sun"), Math.max(5, SUN_RADIUS_DEG * ppd)); dot(D.ee[S.t], D.ea[S.t], col("--earth"), Math.max(5, 0.95 * ppd));
}

/* ===== Linha do tempo ===== */
function drawTimeline() {
  const cv = $("timeline"), { ctx, w, h } = fit(cv), D = site(S.sel), N = S.hours + 1, pad = { l: 38, r: 10, t: 10, b: 88 };
  let lo = -6, hi = 4;
  for (let i = 0; i < N; i++) if (!isNaN(D.se[i])) { hi = Math.max(hi, D.se[i], D.ee[i]); lo = Math.min(lo, D.se[i], D.ee[i], D.hs[i] - 2); }
  hi = Math.ceil(hi + 1); lo = Math.max(-90, Math.floor(lo - 1));
  const X = i => pad.l + i / (N - 1) * (w - pad.l - pad.r), Y = v => pad.t + (hi - v) / (hi - lo) * (h - pad.t - pad.b);
  ctx.clearRect(0, 0, w, h);
  ctx.font = "10px " + col("--f-mono"); ctx.fillStyle = col("--muted"); ctx.strokeStyle = col("--grid"); ctx.textAlign = "right"; ctx.textBaseline = "middle";
  const span = hi - lo, st = span > 120 ? 30 : span > 60 ? 20 : span > 16 ? 4 : 2;
  for (let v = Math.ceil(lo / st) * st; v <= hi; v += st) { ctx.beginPath(); ctx.moveTo(pad.l, Y(v)); ctx.lineTo(w - pad.r, Y(v)); ctx.stroke(); ctx.fillText(v + "°", pad.l - 5, Y(v)); }
  const days = S.hours / 24, every = days > 45 ? 10 : days > 20 ? 5 : 2; ctx.textAlign = "center"; ctx.textBaseline = "top";
  for (let d = 0; d <= days; d += every) { const x = X(d * 24); ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, h - pad.b + 64); ctx.stroke(); ctx.fillText(fmtD.format(S.start + d * 864e5), x, h - 18); }
  ctx.setLineDash([4, 3]); ctx.strokeStyle = col("--fg"); ctx.beginPath(); for (let i = 0; i < N; i++) { const x = X(i), y = Y(D.hs[i]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke(); ctx.setLineDash([]);
  const line = (arr, c) => { ctx.beginPath(); for (let i = 0; i < N; i++) { const x = X(i), y = Y(arr[i]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.strokeStyle = c; ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1; };
  line(D.ee, col("--earth")); line(D.se, col("--sun"));
  const rf = S.ret ? S.ret.flags : new Uint8Array(N);
  const rows = [["Sol", i => D.ok[i] & 1, col("--sun")], ["DTE", i => D.ok[i] & 2, col("--earth")], ["Ambos", i => D.ok[i] === 3, col("--both")], ["Volta", i => rf[i], col("--fg")]];
  const cw = (w - pad.l - pad.r) / (N - 1);
  rows.forEach(([lab, f, c], r) => {
    const y = h - pad.b + 8 + r * 14; ctx.fillStyle = col("--panel-2"); ctx.fillRect(pad.l, y, w - pad.l - pad.r, 10); ctx.fillStyle = c;
    let s0 = -1;
    for (let i = 0; i <= N; i++) { const on = i < N && f(i); if (on && s0 < 0) s0 = i; if (!on && s0 >= 0) { ctx.fillRect(X(s0), y, Math.max(1, X(i - 1) - X(s0) + cw), 10); s0 = -1; } }
    ctx.fillStyle = col("--muted"); ctx.textAlign = "right"; ctx.textBaseline = "middle"; ctx.fillText(lab, pad.l - 5, y + 5);
  });
  const cx = X(S.t); ctx.strokeStyle = col("--fg"); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(cx, pad.t); ctx.lineTo(cx, h - pad.b + 64); ctx.stroke(); ctx.lineWidth = 1;
  [[D.se[S.t], col("--sun")], [D.ee[S.t], col("--earth")]].forEach(([v, c]) => { ctx.beginPath(); ctx.arc(cx, Y(v), 4.5, 0, 7); ctx.fillStyle = c; ctx.fill(); ctx.strokeStyle = col("--panel"); ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1; });
  cv._geo = { pad, w, N };
}
let dragging = false;
function tlSet(ev) {
  const g = $("timeline")._geo, r = $("timeline").getBoundingClientRect(), x = ev.clientX - r.left;
  S.t = Math.round(Math.max(0, Math.min(1, (x - g.pad.l) / (g.w - g.pad.l - g.pad.r))) * (g.N - 1)); $("scrub").value = S.t; renderTime();
}
$("timeline").addEventListener("pointerdown", e => { dragging = true; $("timeline").setPointerCapture(e.pointerId); tlSet(e); });
$("timeline").addEventListener("pointermove", e => { if (dragging) tlSet(e); });
$("timeline").addEventListener("pointerup", () => { dragging = false; });

/* ===== Janelas de volta =====
 * Para decolar da Lua e voltar, a equipe quer Sol (energia, visibilidade) e contato
 * direto com a Terra durante a subida e o encontro em órbita. Uma janela de volta é
 * um trecho de "janela ideal" com pelo menos a duração mínima escolhida. */
function returnWindows(D) {
  const N = D.ok.length, minH = +$("retMin").value, flags = new Uint8Array(N), runs = [];
  let a = -1;
  for (let i = 0; i <= N; i++) {
    const on = i < N && D.ok[i] === 3;
    if (on && a < 0) a = i;
    if (!on && a >= 0) { if (i - a >= minH) { runs.push({ a, b: i, open: i === N }); flags.fill(1, a, i); } a = -1; }
  }
  return { flags, runs, minH };
}
function returnPanel(D, t, N, sunEv) {
  const R = S.ret, next = R.runs.filter(r => r.b > t).slice(0, 3);
  const day = 864e5;
  $("retList").innerHTML = next.map(r => {
    const inside = r.a <= t, startMs = S.start + Math.max(r.a, t) * 36e5, left = r.b - Math.max(r.a, t);
    const when = inside ? "agora" : `${fmt.format(S.start + r.a * 36e5)} UTC`;
    const dur = inside ? `restam ${fmtDur(left)}${r.open ? "+" : ""}` : `${fmtDur(r.b - r.a)}${r.open ? "+" : ""} de janela`;
    return `<li><span class="when">${when}</span><span class="det">${dur} · chegada à Terra entre ${fmtD.format(startMs + 3 * day)} e ${fmtD.format(startMs + 5 * day)}</span>`
      + `<button class="btn-sm" data-t="${Math.max(r.a, t)}" type="button">ver na linha do tempo</button></li>`;
  }).join("");
  let note;
  if (!next.length) note = `Nenhuma janela de volta de ${R.minH} h até o fim do período. Diminua a duração mínima ou aumente o período.`;
  else if (sunEv.cur && sunEv.dt != null) {
    const sunset = t + sunEv.dt, before = R.runs.filter(r => r.b > t && r.a < sunset);
    note = before.length
      ? `O Sol se põe em ${fmtDur(sunEv.dt)}. A última janela antes da noite termina em ${fmt.format(S.start + Math.min(before[before.length - 1].b, sunset) * 36e5)} UTC: depois disso, ficar significa esperar o fim da escuridão.`
      : `O Sol se põe em ${fmtDur(sunEv.dt)} e não há janela de volta completa antes disso.`;
  } else if (!sunEv.cur) note = "Está escuro agora: a próxima janela só abre depois que o Sol voltar.";
  else note = "O Sol não se põe até o fim do período.";
  $("retNote").innerHTML = `${note} A viagem de volta leva de ~3 dias (rápida) a ~5 dias (econômica): veja em <a href="terra-lua.html" style="color:var(--earth)">Da Terra à Lua</a>.`;
}
$("retList").addEventListener("click", e => { const b = e.target.closest("button[data-t]"); if (!b) return; S.t = +b.dataset.t; $("scrub").value = S.t; renderTime(); });
$("retMin").addEventListener("change", () => renderTime());

/* ===== Painel do local ===== */
function nextChange(flag, t, N) {
  const cur = flag(t);
  for (let i = t + 1; i < N; i++) if (flag(i) !== cur) return { cur, dt: i - t, at: i };
  return { cur, dt: null };
}
function explain(s, D, t) {
  const el = D.se[t], f = D.fr[t], up = D.ee[t] > D.he[t], st = S.stats[s.id], parts = [];
  if (f > 0 && el > 0) {
    const sh = 1.8 / Math.tan(Math.max(el, 0.05) * D2R);
    parts.push(`O Sol está a ${num(el)}° acima do horizonte. Uma pessoa de 1,8 m faria uma sombra de ${sh >= 100 ? Math.round(sh).toLocaleString("pt-BR") : num(sh)} m.`);
    if (el < 10 && Math.abs(s.lat) > 75) parts.push("Com o Sol tão baixo, os painéis solares precisam ficar quase na vertical.");
  } else if (el > -SUN_RADIUS_DEG - 1) {
    parts.push("O Sol está bem na linha do horizonte, escondido pela margem ou pelo relevo.");
  } else {
    parts.push(`Está escuro: o Sol está ${num(-el)}° abaixo do horizonte, e a temperatura despenca.`);
  }
  if (up) parts.push(S.dsnMask[t] ? "A Terra está no céu e uma antena da DSN vê a Lua: dá para falar direto com a Terra."
    : "A Terra está no céu, mas nenhuma antena da DSN está virada para a Lua agora.");
  else if (st.earthSeen === 0) parts.push("A Terra não aparece aqui em todo o período: o contato precisa de um satélite retransmissor.");
  else parts.push("A Terra está abaixo do horizonte: sem contato direto até ela nascer de novo.");
  return parts.join(" ");
}
function panel() {
  const s = siteById(S.sel), D = site(s.id), st = S.stats[s.id], t = S.t, ok = D.ok[t], N = S.hours + 1;
  $("sName").textContent = s.name; $("tlName").textContent = s.name;
  $("sCoords").textContent = fmtCoord(s);
  const stx = [["Escuro e sem contato", "--muted"], ["Só Sol", "--sun"], ["Só contato com a Terra", "--earth"], ["Janela ideal: Sol + Terra", "--both"]][ok];
  $("sStatus").textContent = stx[0]; $("sStatus").style.color = `var(${stx[1]})`;
  $("sExplain").textContent = explain(s, D, t);
  $("rSun").textContent = `${num(D.se[t], 2)}° / ${Math.round(D.sa[t])}°`;
  $("rSunD").textContent = `${Math.round(D.fr[t] * 100)}% do disco acima do horizonte efetivo`;
  $("rEarth").textContent = `${num(D.ee[t], 2)}° / ${Math.round(D.ea[t])}°`;
  $("rEarthD").textContent = D.ee[t] > D.he[t] ? (S.dsnMask[t] ? "Visível e coberta pela DSN" : "Visível, mas sem estação DSN") : "Abaixo do horizonte";
  // contagem regressiva: pôr/nascer do Sol e da Terra
  const sunEv = nextChange(i => D.fr[i] >= 0.5, t, N);
  $("rSunEvL").textContent = sunEv.cur ? "Pôr do Sol" : "Nascer do Sol";
  $("rSunEv").textContent = sunEv.dt == null ? (sunEv.cur ? "não se põe" : "não nasce") : `em ${fmtDur(sunEv.dt)}`;
  $("rSunEvD").textContent = sunEv.dt == null ? "até o fim do período" : fmt.format(S.start + sunEv.at * 36e5) + " UTC";
  const earthEv = nextChange(i => D.ee[i] > D.he[i], t, N);
  $("rEarthEvL").textContent = earthEv.cur ? "Pôr da Terra" : "Nascer da Terra";
  if (st.earthSeen === 0) { $("rEarthEv").textContent = "nunca visível"; $("rEarthEvD").textContent = "a Terra fica abaixo do horizonte o tempo todo"; }
  else {
    $("rEarthEv").textContent = earthEv.dt == null ? (earthEv.cur ? "não se põe" : "não nasce") : `em ${fmtDur(earthEv.dt)}`;
    $("rEarthEvD").textContent = earthEv.dt == null ? "até o fim do período" : fmt.format(S.start + earthEv.at * 36e5) + " UTC";
  }
  let nx = -1, len = 0;
  for (let i = t; i < N; i++) { if (D.ok[i] === 3) { if (nx < 0) nx = i; len++; } else if (nx >= 0) break; }
  if (nx < 0) { $("rNext").textContent = "nenhuma"; $("rNextD").textContent = "no restante do período"; }
  else { $("rNext").textContent = nx === t ? "agora" : `em ${fmtDur(nx - t)}`; $("rNextD").textContent = `${fmt.format(S.start + nx * 36e5)} · dura ${fmtDur(len)}${nx + len >= N ? "+" : ""}`; }
  $("rDark").textContent = fmtDur(st.maxDark);
  returnPanel(D, t, N, sunEv);
  $("dsnChips").innerHTML = DSN.map((d, k) => `<span class="chip ${S.dsnMask[t] >> k & 1 ? "on" : ""}">${esc(d.name)}</span>`).join("");
  $("sNote").textContent = (s.desc || "") + (D.mask ? " Horizonte com relevo real (máscara de terreno)." : "") + (s.approx ? " Coordenada aproximada." : "");
  $("nowLbl").textContent = fmt.format(S.start + t * 36e5) + " UTC";
  $("rmSite").hidden = !s.custom;
  const q = new URLSearchParams({ site: s.id, start: $("start").value, days: $("dur").value, step: 60, margin: $("mask").value, height: $("hgt").value, dsn_min: $("dsn").value, format: "csv" });
  $("csv").href = `${API_BASE}/api/windows?${q}`;
  $("csv").hidden = !["horizons", "mixed", "analytic"].includes(S.src) || !!s.custom;
}

/* ===== Tabela comparativa ===== */
const COLS = [["name", "Local"], ["energy", "Energia solar"], ["lit", "Com Sol"], ["dte", "Contato DTE"], ["both", "Sol + DTE"], ["maxDark", "Noite mais longa"], ["maxWin", "Maior janela ideal"], ["score", "Índice"]];
const bar = (v, c) => `<span class="bar"><i><b style="width:${(v * 100).toFixed(1)}%;background:var(${c})"></b></i>${(v * 100).toFixed(0)}%</span>`;
function table() {
  $("tbl").tHead.innerHTML = "<tr>" + COLS.map(([k, l]) => `<th tabindex="0" data-k="${k}" class="${S.sort.k === k ? "sorted" : ""}" aria-sort="${S.sort.k === k ? (S.sort.dir > 0 ? "ascending" : "descending") : "none"}">${l}${S.sort.k === k ? (S.sort.dir > 0 ? " ↑" : " ↓") : ""}</th>`).join("") + "</tr>";
  const rows = SITES.filter(s => S.stats[s.id]).map(s => ({ s, ...S.stats[s.id] })).sort((a, b) => {
    const k = S.sort.k, va = k === "name" ? a.s.name : a[k], vb = k === "name" ? b.s.name : b[k];
    return (va > vb ? 1 : va < vb ? -1 : 0) * S.sort.dir;
  });
  const tag = s => s.ref ? "referência" : S.group === "all" || s.custom ? GROUP_TAG[s.group] : "";
  $("tbl").tBodies[0].innerHTML = rows.map(r => `<tr tabindex="0" data-id="${r.s.id}" class="${r.s.id === S.sel ? "sel" : ""}">
    <td>${esc(r.s.name)}${tag(r.s) ? `<span class="ref">${tag(r.s)}</span>` : ""}</td>
    <td class="num">${bar(r.energy, "--sun")}</td><td class="num">${bar(r.lit, "--sun")}</td><td class="num">${bar(r.dte, "--earth")}</td><td class="num">${bar(r.both, "--both")}</td>
    <td class="num" style="color:${r.maxDark > 240 ? "var(--warn)" : "inherit"}">${fmtDur(r.maxDark)}</td><td class="num">${fmtDur(r.maxWin)}</td><td class="num"><b>${r.score.toFixed(0)}</b></td></tr>`).join("");
}
$("tbl").addEventListener("click", e => {
  const th = e.target.closest("th");
  if (th) { const k = th.dataset.k; S.sort = S.sort.k === k ? { k, dir: -S.sort.dir } : { k, dir: k === "name" || k === "maxDark" ? 1 : -1 }; table(); return; }
  const tr = e.target.closest("tr[data-id]"); if (tr) { S.sel = tr.dataset.id; renderAll(); }
});
$("tbl").addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.target.click(); } });

/* ===== Locais personalizados ===== */
$("customForm").addEventListener("submit", e => {
  e.preventDefault();
  const name = $("cName").value.trim(), lat = parseFloat($("cLat").value), lon = parseFloat($("cLon").value);
  if (!name) return void ($("cErr").textContent = "Dê um nome ao local.");
  if (!(lat >= -90 && lat <= 90)) return void ($("cErr").textContent = "A latitude precisa estar entre −90 (polo sul) e 90.");
  if (!(lon >= -180 && lon <= 360)) return void ($("cErr").textContent = "A longitude precisa estar entre −180 e 360 (graus leste).");
  $("cErr").textContent = "";
  const s = { id: "u" + Date.now().toString(36), name, group: "custom", lat, lon: wrap(lon), desc: "Local adicionado por você.", custom: true };
  customSites.push(s); store.set("janela.custom", customSites);
  CATALOG.push(s); S.group = "custom"; S.sel = s.id; fillGroups();
  $("cName").value = ""; $("cLat").value = ""; $("cLon").value = "";
  changeGroup();
});
$("rmSite").onclick = () => {
  const id = S.sel;
  customSites = customSites.filter(s => s.id !== id); store.set("janela.custom", customSites);
  CATALOG = CATALOG.filter(s => s.id !== id);
  if (S.group === "custom" && !customSites.length) S.group = "artemis3";
  fillGroups(); changeGroup();
};

/* ===== Cenários fixados ===== */
$("pin").onclick = () => {
  const s = siteById(S.sel), st = S.stats[s.id];
  scenarios.push({
    id: Date.now().toString(36), siteId: s.id, name: s.name, start: $("start").value, days: +$("dur").value,
    params: { mask: +$("mask").value, hgt: +$("hgt").value, dsn: +$("dsn").value },
    stats: { energy: st.energy, dte: st.dte, both: st.both, maxDark: st.maxDark, maxWin: st.maxWin, score: st.score }, src: S.src,
  });
  store.set("janela.scenarios", scenarios); renderScenarios();
  $("pin").textContent = "Fixado ✓"; setTimeout(() => { $("pin").textContent = "Fixar cenário"; }, 1400);
};
const SC_COLS = [["energy", "Energia solar", 1], ["dte", "Contato DTE", 1], ["both", "Sol + DTE", 1], ["maxDark", "Noite mais longa", -1], ["maxWin", "Maior janela ideal", 1], ["score", "Índice", 1]];
function renderScenarios() {
  const has = scenarios.length > 0;
  $("pinsEmpty").hidden = has; $("pinsWrap").hidden = !has; $("clearPins").hidden = !has;
  if (!has) return;
  const best = {};
  for (const [k, , dir] of SC_COLS) best[k] = dir > 0 ? Math.max(...scenarios.map(x => x.stats[k])) : Math.min(...scenarios.map(x => x.stats[k]));
  const cell = (k, v) => {
    const txt = k === "maxDark" || k === "maxWin" ? fmtDur(v) : k === "score" ? v.toFixed(0) : (v * 100).toFixed(0) + "%";
    return `<td class="num${scenarios.length > 1 && v === best[k] ? " best" : ""}">${txt}</td>`;
  };
  $("pins").tHead.innerHTML = "<tr><th>Local</th><th>Início</th><th>Período</th>" + SC_COLS.map(c => `<th>${c[1]}</th>`).join("") + "<th>Fonte</th><th></th></tr>";
  $("pins").tBodies[0].innerHTML = scenarios.map(x => `<tr data-id="${x.id}">
    <td>${esc(x.name)}</td><td class="num">${fmtD.format(Date.parse(x.start + "T00:00:00Z"))}</td><td class="num">${x.days} d</td>
    ${SC_COLS.map(([k]) => cell(k, x.stats[k])).join("")}
    <td>${x.src === "horizons" ? "Horizons" : x.src === "pre" ? "pré-calculado" : "analítico"}</td>
    <td class="act"><button class="btn-sm" data-act="open">Abrir</button><button class="btn-sm" data-act="del" aria-label="Remover cenário">×</button></td></tr>`).join("");
}
$("pins").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  const id = b.closest("tr").dataset.id, x = scenarios.find(s => s.id === id);
  if (b.dataset.act === "del") { scenarios = scenarios.filter(s => s.id !== id); store.set("janela.scenarios", scenarios); renderScenarios(); return; }
  const s = siteById(x.siteId);
  if (!s) { b.textContent = "local removido"; return; }
  $("start").value = x.start; $("dur").value = String(x.days);
  $("mask").value = x.params.mask; $("hgt").value = x.params.hgt; $("dsn").value = x.params.dsn; labels();
  if (!visibleSites().some(v => v.id === s.id)) { S.group = s.custom ? "custom" : s.group; fillGroups(); }
  S.sel = s.id; changeGroup(true);
  window.scrollTo({ top: 0, behavior: "smooth" });
});
$("clearPins").onclick = () => { scenarios = []; store.set("janela.scenarios", scenarios); renderScenarios(); };

/* ===== Planejador: melhor data de pouso ===== */
let planCache = { key: "", ephs: null, dsnEl: null };
function runPlanner() {
  const dur = Math.min(60, Math.max(1, +$("planDur").value || 14)), months = +$("planMonths").value, crit = $("planCrit").value;
  const [y, m, d] = ($("planStart").value || todayISO()).split("-").map(Number), start = Date.UTC(y, m - 1, d);
  const days = Math.round(months * 30.44), win = Math.round(dur * 24), H = days * 24 + win + 1;
  const key = `${start}|${H}`;
  if (planCache.key !== key) {
    const ephs = new Array(H); for (let i = 0; i < H; i++) ephs[i] = ephem(start + i * 36e5);
    planCache = { key, ephs, dsnEl: DSN.map(st => Float32Array.from(ephs, e => dsnElevation(e, st))) };
  }
  const { ephs, dsnEl } = planCache, H0 = horizonEff(), dmin = +$("dsn").value;
  const dsnOK = new Uint8Array(H); for (let i = 0; i < H; i++) dsnOK[i] = dsnEl.some(a => a[i] >= dmin) ? 1 : 0;
  const rows = SITES.slice(0, 20), vals = new Float32Array(rows.length * days), bestDay = [];
  rows.forEach((s, r) => {
    const mask = S.raw && S.raw.sites[s.id] ? S.raw.sites[s.id].mask : null;
    const hz = az => H0 + (mask ? (mask[Math.round(norm(az)) % 360] ?? 0) : 0);
    const P = new Float64Array(H + 1);
    for (let i = 0; i < H; i++) {
      const e = ephs[i];
      let v;
      if (crit === "dte") { const b = topo(s.lat, s.lon, e.earth); v = b.el > hz(b.az) && dsnOK[i]; }
      else {
        const a = topo(s.lat, s.lon, e.sun), L = discFrac(a.el, hz(a.az)) >= 0.5;
        if (crit === "sun") v = L;
        else { const b = topo(s.lat, s.lon, e.earth); v = L && b.el > hz(b.az) && dsnOK[i]; }
      }
      P[i + 1] = P[i] + (v ? 1 : 0);
    }
    let bi = 0, bv = -1;
    for (let dd = 0; dd < days; dd++) { const a = dd * 24, v = (P[a + win] - P[a]) / win; vals[r * days + dd] = v; if (v > bv + 1e-9) { bv = v; bi = dd; } }
    bestDay.push(bi);
  });
  S.plan = { rows, days, vals, bestDay, start, dur, crit };
  $("planInfo").textContent = "Passe o mouse sobre o mapa para ver os valores.";
  drawPlanner();
}
function drawPlanner() {
  const P = S.plan; if (!P) return;
  const cv = $("planner"), labW = Math.min(170, Math.max(90, cv.getBoundingClientRect().width * 0.28));
  cv.style.height = `${P.rows.length * 22 + 34}px`;
  const { ctx, w, h } = fit(cv), top = 6, rh = 22, cw = (w - labW - 6) / P.days;
  ctx.clearRect(0, 0, w, h);
  const base = rgb(col("--panel-2")), hot = rgb(col("--both"));
  P.rows.forEach((s, r) => {
    const y = top + r * rh;
    ctx.fillStyle = s.id === S.sel ? col("--fg") : col("--muted"); ctx.font = (s.id === S.sel ? "600 " : "") + "12px " + col("--f-body");
    ctx.textAlign = "right"; ctx.textBaseline = "middle";
    let name = s.name; while (ctx.measureText(name).width > labW - 10 && name.length > 4) name = name.slice(0, -2) + "…";
    ctx.fillText(name, labW - 8, y + rh / 2);
    for (let d = 0; d < P.days; d++) {
      const v = P.vals[r * P.days + d], g = Math.pow(v, 0.8);
      ctx.fillStyle = `rgb(${base.map((b, q) => Math.round(b + (hot[q] - b) * g)).join(",")})`;
      ctx.fillRect(labW + d * cw, y + 2, Math.ceil(cw), rh - 4);
    }
    const bx = labW + (P.bestDay[r] + 0.5) * cw;
    ctx.beginPath(); ctx.arc(bx, y + rh / 2, 3.5, 0, 7); ctx.fillStyle = col("--fg"); ctx.fill();
  });
  ctx.fillStyle = col("--muted"); ctx.strokeStyle = col("--grid"); ctx.font = "10px " + col("--f-mono"); ctx.textAlign = "left"; ctx.textBaseline = "top";
  const yb = top + P.rows.length * rh;
  for (let d = 0; d < P.days; d++) {
    const dt = new Date(P.start + d * 864e5);
    if (dt.getUTCDate() === 1 || d === 0) { const x = labW + d * cw; ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, yb + 4); ctx.stroke(); ctx.fillText(d === 0 ? fmtD.format(dt) : fmtMon.format(dt), x + 2, yb + 6); }
  }
  if (S.planHover) {
    const { r, d } = S.planHover; ctx.strokeStyle = col("--fg"); ctx.lineWidth = 1.5;
    ctx.strokeRect(labW + d * cw, top + r * rh + 1, Math.max(2, cw), rh - 2); ctx.lineWidth = 1;
  }
  cv._geo = { labW, top, rh, cw };
}
function planCell(ev) {
  const P = S.plan, g = $("planner")._geo; if (!P || !g) return null;
  const rc = $("planner").getBoundingClientRect(), x = ev.clientX - rc.left, y = ev.clientY - rc.top;
  const r = Math.floor((y - g.top) / g.rh), d = Math.floor((x - g.labW) / g.cw);
  return r >= 0 && r < P.rows.length && d >= 0 && d < P.days ? { r, d } : null;
}
const CRIT_TXT = { both: "com Sol e contato direto", sun: "com Sol", dte: "com contato direto" };
$("planner").addEventListener("mousemove", ev => {
  const c = planCell(ev); S.planHover = c; drawPlanner();
  if (!c) return;
  const P = S.plan, v = P.vals[c.r * P.days + c.d];
  $("planInfo").textContent = `${P.rows[c.r].name}, pouso em ${fmtD.format(P.start + c.d * 864e5)}: ${Math.round(v * 100)}% dos ${num(P.dur, P.dur % 1 ? 1 : 0)} dias ${CRIT_TXT[P.crit]}`;
});
$("planner").addEventListener("mouseleave", () => { S.planHover = null; drawPlanner(); });
$("planner").addEventListener("click", ev => {
  const c = planCell(ev); if (!c) return;
  const P = S.plan;
  $("start").value = isoDay(P.start + c.d * 864e5);
  $("dur").value = P.dur <= 14 ? "14" : P.dur <= 30 ? "30" : P.dur <= 60 ? "60" : "90";
  S.sel = P.rows[c.r].id;
  reloadPeriod(); window.scrollTo({ top: 0, behavior: "smooth" });
});
let planTimer = null;
function schedulePlanner() { clearTimeout(planTimer); planTimer = setTimeout(runPlanner, 250); }
["planStart", "planDur", "planMonths", "planCrit"].forEach(id => $(id).addEventListener("change", schedulePlanner));

/* ===== Orquestração ===== */
function labels() {
  $("maskO").textContent = num(+$("mask").value) + "°"; $("hgtO").textContent = $("hgt").value + " m"; $("dsnO").textContent = $("dsn").value + "°";
}
function renderTime() { S.ret = returnWindows(site(S.sel)); drawMap(); drawHorizon(); drawTimeline(); panel(); }
function renderAll() { renderTime(); table(); }
function firstIdealMoment() {
  const w = S.win[S.sel]; if (!w) return;
  for (let i = 0; i <= S.hours; i++) if (w.ok[i] === 3) { S.t = i; break; }
  $("scrub").value = S.t;
}
function autoMapMode() { setMapMode(SITES.every(s => s.lat <= -75) ? "polar" : "global"); }
let reloadTimer = null;
// Mudou o período: mostra na hora o cálculo local e pede os dados oficiais ao servidor.
function reloadPeriod() {
  loadToken++; // descarta respostas de buscas anteriores
  readPeriod(); S.raw = buildLocalRaw(); computeWindows(); renderAll();
  clearTimeout(reloadTimer); reloadTimer = setTimeout(loadRemote, 400);
}
// Mudou o conjunto de locais (ou abriu um cenário).
function changeGroup(periodChanged) {
  loadToken++;
  SITES = visibleSites();
  if (!SITES.some(s => s.id === S.sel)) S.sel = SITES[0].id;
  if (periodChanged) { readPeriod(); S.raw = buildLocalRaw(); } else ensureLocal();
  autoMapMode(); computeWindows(); renderAll(); schedulePlanner();
  clearTimeout(reloadTimer); reloadTimer = setTimeout(loadRemote, 200);
}
$("group").addEventListener("change", () => { S.group = $("group").value; changeGroup(); });
["start", "dur"].forEach(id => $(id).addEventListener("change", reloadPeriod));
["mask", "hgt", "dsn"].forEach(id => $(id).addEventListener("input", () => { labels(); computeWindows(); renderAll(); schedulePlanner(); }));
$("scrub").addEventListener("input", () => { S.t = +$("scrub").value; renderTime(); });
let timer = null;
$("play").onclick = () => {
  S.playing = !S.playing; $("play").setAttribute("aria-pressed", S.playing); $("play").textContent = S.playing ? "❚❚ Pausar" : "▶ Animar";
  if (S.playing) timer = setInterval(() => { S.t = (S.t + 2) % (S.hours + 1); $("scrub").value = S.t; renderTime(); }, 70);
  else clearInterval(timer);
};
new ResizeObserver(() => { renderTime(); drawPlanner(); }).observe(document.querySelector(".wrap"));
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { renderAll(); drawPlanner(); });

async function loadCatalog() {
  try {
    const c = await fetchJSON(`${API_BASE}/api/sites`, 4000);
    GROUPS = c.groups && c.groups.length ? c.groups : GROUPS;
    DSN = c.dsn.map(d => ({ id: d.id, name: d.name, lat: d.lat, lon: d.lon }));
    CATALOG = c.sites.map(s => ({ id: s.id, name: s.name, group: s.group, lat: s.lat, lon: s.lon, desc: s.desc || "", ref: !!s.ref, approx: s.coord_status === "aproximada" }))
      .concat(customSites);
    fillGroups(); SITES = visibleSites(); ensureLocal();
    return true;
  } catch (_) { return false; }
}

// Abre com o cálculo local (instantâneo) e troca pelos dados do servidor quando chegarem.
(async function init() {
  $("start").value = todayISO(); $("planStart").value = todayISO();
  fillGroups(); SITES = visibleSites(); labels(); readPeriod();
  S.raw = buildLocalRaw(); autoMapMode(); computeWindows(); firstIdealMoment(); setSource("local");
  renderAll(); renderScenarios(); runPlanner();
  if (await loadCatalog()) { computeWindows(); renderAll(); }
  loadRemote();
})();
})();
