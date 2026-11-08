// Roda com:  node --test frontend/tests/*.test.mjs
// Confere que o motor JavaScript bate com o Python (backend/tests/test_analytic.py).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const E = createRequire(import.meta.url)("../js/engine.js");
const close = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b} ± ${tol}`);

test("Shackleton, 2026-10-26 04:12 UTC: mesmo resultado do motor Python", () => {
  const e = E.ephem(Date.UTC(2026, 9, 26, 4, 12));
  const sun = E.topo(-89.7, -130, e.sun), earth = E.topo(-89.7, -130, e.earth);
  close(sun.el, 1.2479, 5e-4);
  close(sun.az, 125.92, 0.05);
  close(earth.el, 5.5382, 5e-4);
});

test("Chang'e 4 (lado oculto) nunca vê a Terra", () => {
  for (let d = 0; d < 30; d++) {
    const e = E.ephem(Date.UTC(2026, 10, 1) + d * 864e5);
    assert.ok(E.topo(-45.4561, 177.5885, e.earth).el < 0);
  }
});

test("fração do disco solar", () => {
  assert.equal(E.discFrac(5, 0), 1);
  assert.equal(E.discFrac(-5, 0), 0);
  close(E.discFrac(0, 0), 0.5, 1e-12);
});
