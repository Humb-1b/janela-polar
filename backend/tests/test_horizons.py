import json
import math
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

from app import cache, horizons

FIX = Path(__file__).parent / "fixtures" / "horizons_sun_from_moon.txt"
T0 = datetime(2026, 11, 8, tzinfo=timezone.utc)


class FakeResp:
    def __init__(self, payload, status=200):
        self.status_code = status
        self._p = payload
        self.text = json.dumps(payload)

    def json(self):
        return self._p


class TestParse(unittest.TestCase):
    def test_parse_fixture(self):
        rows = horizons.parse_observer_csv(FIX.read_text(encoding="utf-8"))
        self.assertEqual(len(rows), 4)
        t, az, el = rows[0]
        self.assertEqual(t, T0)
        self.assertAlmostEqual(az, 251.123456)
        self.assertAlmostEqual(el, 1.234567)
        self.assertTrue(math.isnan(rows[3][2]))  # "n.a." vira NaN

    def test_error_text(self):
        with self.assertRaises(horizons.HorizonsError) as ctx:
            horizons.parse_observer_csv("Cannot use print-quantity 4 with this observer\n")
        self.assertIn("Cannot", str(ctx.exception))

    def test_params(self):
        p = horizons.build_params("10", "301", -64.0, -88.4, 0, T0, T0, 60)
        self.assertEqual(p["CENTER"], "'coord@301'")
        self.assertEqual(p["SITE_COORD"], "'296.000000,-88.400000,0.0000'")  # longitude oeste vira 0–360
        self.assertEqual(p["QUANTITIES"], "'4'")
        self.assertEqual(p["STEP_SIZE"], "'60 m'")


class TestFetch(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.patch = mock.patch.object(cache, "CACHE_DIR", Path(self.tmp.name))
        self.patch.start()

    def tearDown(self):
        self.patch.stop()
        self.tmp.cleanup()

    def test_fetch_and_cache(self):
        payload = {"signature": {"version": "1.2"}, "result": FIX.read_text(encoding="utf-8")}
        with mock.patch("requests.get", return_value=FakeResp(payload)) as g:
            az, el = horizons.fetch_altaz("10", "301", 3.0, -85.9, 0, T0, 3, 60)
            self.assertEqual(len(az), 3)
            self.assertAlmostEqual(el[2], 1.2656)
            horizons.fetch_altaz("10", "301", 3.0, -85.9, 0, T0, 3, 60)
            self.assertEqual(g.call_count, 1)  # a segunda veio do cache

    def test_api_error(self):
        with mock.patch("requests.get", return_value=FakeResp({"error": "bad COMMAND"})):
            with self.assertRaises(horizons.HorizonsError):
                horizons.fetch_altaz("x", "301", 3.0, -85.9, 0, T0, 3, 60)

    def test_unavailable(self):
        import requests
        with mock.patch("requests.get", side_effect=requests.ConnectionError("sem rede")), \
                mock.patch("time.sleep"):
            with self.assertRaises(horizons.HorizonsUnavailable):
                horizons.fetch_altaz("10", "301", 3.0, -85.9, 0, T0, 3, 60)


if __name__ == "__main__":
    unittest.main()
