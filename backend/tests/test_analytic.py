import unittest

from app import analytic


class TestAnalytic(unittest.TestCase):
    def test_matches_frontend_engine(self):
        # Valores do motor JavaScript do frontend para o mesmo instante e local
        # (Shackleton, 2026-10-26 04:12 UTC). Os dois motores precisam concordar.
        e = analytic.ephem(analytic.utc(2026, 10, 26, 4, 12))
        sun = analytic.topo(-89.7, -130, e["sun"])
        earth = analytic.topo(-89.7, -130, e["earth"])
        self.assertAlmostEqual(sun["el"], 1.2479, places=3)
        self.assertAlmostEqual(sun["az"], 125.92, places=1)
        self.assertAlmostEqual(earth["el"], 5.5382, places=3)

    def test_subsolar_latitude_is_small(self):
        # O Sol nunca sai mais de ~1,6° do equador lunar
        for d in range(1, 29, 3):
            e = analytic.ephem(analytic.utc(2026, 11, d))
            self.assertLess(abs(e["sun"]["lat"]), 1.7)
            self.assertLess(abs(e["earth"]["lat"]), 7.0)  # libração em latitude


if __name__ == "__main__":
    unittest.main()
