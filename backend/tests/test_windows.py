import math
import unittest
from datetime import datetime, timezone

from app import windows

T0 = datetime(2026, 11, 8, tzinfo=timezone.utc)


class TestDisc(unittest.TestCase):
    def test_fraction(self):
        r = windows.SUN_RADIUS_DEG
        self.assertEqual(windows.disc_fraction(5, 0), 1.0)
        self.assertEqual(windows.disc_fraction(-5, 0), 0.0)
        self.assertAlmostEqual(windows.disc_fraction(0, 0), 0.5)
        self.assertGreater(windows.disc_fraction(r / 2, 0), 0.5)
        self.assertEqual(windows.disc_fraction(math.nan, 0), 0.0)

    def test_dip(self):
        self.assertEqual(windows.horizon_dip(0), 0.0)
        # 3 km acima do entorno: horizonte ~3,4° abaixo
        self.assertAlmostEqual(windows.horizon_dip(3000), 3.37, places=1)

    def test_mask(self):
        mask = [0.0] * 360
        mask[90] = 4.0
        self.assertEqual(windows.mask_at(mask, 89.6), 4.0)
        self.assertEqual(windows.mask_at(None, 89.6), 0.0)


class TestEvaluate(unittest.TestCase):
    def series(self, sun, earth):
        n = len(sun)
        return {"sun_el": sun, "sun_az": [0.0] * n, "earth_el": earth, "earth_az": [0.0] * n}

    def test_windows(self):
        sun = [2, 2, 2, -2, -2, 2]
        earth = [3, -1, 3, 3, 3, 3]
        dsn = [[20, 20, 20, 20, 20, 5]]  # última hora sem antena acima de 10°
        r = windows.evaluate(self.series(sun, earth), dsn, t0=T0, step_min=60, margin=0.5)
        s = r["series"]
        self.assertEqual(s["lit"], [True, True, True, False, False, True])
        self.assertEqual(s["dte"], [True, False, True, True, True, False])
        self.assertEqual(s["both"], [True, False, True, False, False, False])
        self.assertEqual(r["stats"]["max_dark_h"], 2)
        self.assertEqual(r["stats"]["max_both_h"], 1)
        ideal = [iv for iv in r["intervals"] if iv["kind"] == "ideal"]
        self.assertEqual([iv["start"] for iv in ideal], ["2026-11-08T00:00:00Z", "2026-11-08T02:00:00Z"])

    def test_terrain_mask_blocks_sun(self):
        mask = [5.0] * 360  # paredão de 5° em todas as direções
        r = windows.evaluate(self.series([2, 2], [3, 3]), [[20, 20]], t0=T0, step_min=60, mask=mask)
        self.assertEqual(r["stats"]["lit"], 0.0)
        self.assertEqual(r["stats"]["dte"], 0.0)

    def test_height_helps(self):
        r = windows.evaluate(self.series([-1, -1], [-1, -1]), [[20, 20]], t0=T0, step_min=60,
                             margin=0.0, height_m=2000)
        self.assertEqual(r["stats"]["energy"], 1.0)


if __name__ == "__main__":
    unittest.main()
