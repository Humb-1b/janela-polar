/* Dados da NASA — tabela de locais com links para a JPL Horizons.
 * A lista de locais repete a de backend/data/sites.json (fonte oficial) para a
 * página funcionar também no GitHub Pages, sem backend. Ao mudar um local lá,
 * mude aqui e em FALLBACK_SITES (js/app.js).
 */
"use strict";
(function () {
const $ = id => document.getElementById(id);
const SITES = [
  ["Artemis III", "Pico perto de Cabeus B", -83.6, -49, true],
  ["Artemis III", "Haworth", -87.0, -4, true],
  ["Artemis III", "Maciço Malapert", -85.9, 3, true],
  ["Artemis III", "Platô Mons Mouton", -84.7, 38, true],
  ["Artemis III", "Mons Mouton", -84.3, 31, true],
  ["Artemis III", "Borda Nobile 1", -85.6, 45, true],
  ["Artemis III", "Borda Nobile 2", -84.3, 60, true],
  ["Artemis III", "Borda de Gerlache 2", -88.4, -64, true],
  ["Artemis III", "Planície Slater", -87.6, 112, true],
  ["referência", "Borda de Shackleton", -89.7, -130, true],
  ["pouso", "IM-1 Odysseus", -80.13, 1.44],
  ["pouso", "IM-2 Athena", -84.7906, 29.1957],
  ["pouso", "Chandrayaan-3", -69.3741, 32.32],
  ["pouso", "Blue Ghost 1", 18.562, 61.81],
  ["pouso", "SLIM", -13.316, 25.251],
  ["pouso", "Chang'e 4", -45.4561, 177.5885],
  ["pouso", "Chang'e 6", -41.6385, -153.9852],
  ["Apollo", "Apollo 11", 0.67416, 23.47314],
  ["Apollo", "Apollo 15", 26.13239, 3.6333],
  ["Apollo", "Apollo 17", 20.1911, 30.7723],
].map(([group, name, lat, lon, approx]) => ({ group, name, lat, lon, approx: !!approx }));

const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const lonE = lon => ((lon % 360) + 360) % 360;
const coordTxt = s => `${Math.abs(s.lat).toFixed(4)}°${s.lat < 0 ? "S" : "N"}, ${lonE(s.lon).toFixed(4)}°L`;

/** Mesmos parâmetros que o backend usa (backend/app/horizons.py), em texto legível. */
function horizonsURL(target, s, start, days, step) {
  const t0 = new Date(start + "T00:00:00Z"), t1 = new Date(t0.getTime() + days * 864e5);
  const d = t => t.toISOString().slice(0, 16).replace("T", " ");
  const p = {
    format: "text", COMMAND: `'${target}'`, OBJ_DATA: "'NO'", MAKE_EPHEM: "'YES'", EPHEM_TYPE: "'OBSERVER'",
    CENTER: "'coord@301'", COORD_TYPE: "'GEODETIC'",
    SITE_COORD: `'${lonE(s.lon).toFixed(6)},${s.lat.toFixed(6)},0'`,
    START_TIME: `'${d(t0)}'`, STOP_TIME: `'${d(t1)}'`, STEP_SIZE: `'${step}'`,
    QUANTITIES: "'4'", ANG_FORMAT: "'DEG'", APPARENT: "'AIRLESS'",
  };
  return "https://ssd.jpl.nasa.gov/api/horizons.api?" + Object.entries(p).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
}

function render() {
  const start = $("hStart").value, days = +$("hDays").value, step = $("hStep").value;
  $("tbl").tBodies[0].innerHTML = SITES.map((s, i) => `<tr>
    <td>${esc(s.name)} <span class="ref">${esc(s.group)}</span></td>
    <td><span class="coord" id="c${i}">${s.approx ? "≈ " : ""}${coordTxt(s)}</span><button class="btn-sm copy" data-i="${i}" type="button">copiar</button></td>
    <td><a href="${horizonsURL("10", s, start, days, step)}" target="_blank" rel="noopener">Sol visto daqui</a></td>
    <td><a href="${horizonsURL("399", s, start, days, step)}" target="_blank" rel="noopener">Terra vista daqui</a></td></tr>`).join("");
}

$("tbl").addEventListener("click", async e => {
  const b = e.target.closest("button.copy"); if (!b) return;
  const s = SITES[+b.dataset.i], txt = `${s.lat}, ${s.lon}`;
  try { await navigator.clipboard.writeText(txt); b.textContent = "copiado ✓"; }
  catch (_) {  // sem acesso à área de transferência: seleciona o texto para copiar à mão
    const r = document.createRange(); r.selectNodeContents($("c" + b.dataset.i));
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); b.textContent = "selecionado";
  }
  setTimeout(() => { b.textContent = "copiar"; }, 1500);
});
["hStart", "hDays", "hStep"].forEach(id => $(id).addEventListener("change", render));
$("hStart").value = new Date().toISOString().slice(0, 10);
render();
})();
