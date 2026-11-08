import tempfile
import unittest
from pathlib import Path
from unittest import mock

import requests

from app import cache, create_app, ephemeris


class TestAPI(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.p = mock.patch.object(cache, "CACHE_DIR", Path(self.tmp.name))
        self.p.start()
        ephemeris._mem.clear()
        self.c = create_app().test_client()

    def tearDown(self):
        self.p.stop()
        self.tmp.cleanup()

    def test_sites(self):
        r = self.c.get("/api/sites")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(r.json["dsn"]), 3)
        self.assertIn("mal", [s["id"] for s in r.json["sites"]])

    def test_bundle_analytic(self):
        r = self.c.get("/api/bundle?start=2026-11-08&days=2&provider=analytic")
        self.assertEqual(r.status_code, 200)
        b = r.json
        self.assertEqual(b["source"], "analytic")
        self.assertEqual(b["n"], 49)
        self.assertEqual(len(b["sites"]["mal"]["sun_el"]), 49)
        self.assertEqual(len(b["dsn"]["elev"]["mdscc"]), 49)

    def test_auto_falls_back_when_horizons_is_down(self):
        with mock.patch("requests.get", side_effect=requests.ConnectionError("sem rede")), \
                mock.patch("time.sleep"):
            r = self.c.get("/api/bundle?start=2026-11-08&days=1&provider=auto")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json["source"], "analytic")
        self.assertTrue(r.json["warnings"])

    def test_horizons_only_reports_error(self):
        with mock.patch("requests.get", side_effect=requests.ConnectionError("sem rede")), \
                mock.patch("time.sleep"):
            r = self.c.get("/api/bundle?start=2026-11-08&days=1&provider=horizons")
        self.assertEqual(r.status_code, 503)
        self.assertIn("Horizons", r.json["error"])

    def test_windows_and_csv(self):
        r = self.c.get("/api/windows?site=mal&start=2026-11-08&days=5&provider=analytic")
        self.assertEqual(r.status_code, 200)
        self.assertIn("score", r.json["stats"])
        r = self.c.get("/api/windows?site=mal&start=2026-11-08&days=5&provider=analytic&format=csv")
        self.assertEqual(r.mimetype, "text/csv")
        self.assertTrue(r.data.decode().startswith("local,tipo"))

    def test_compare(self):
        r = self.c.get("/api/compare?start=2026-11-08&days=5&provider=analytic")
        scores = [x["score"] for x in r.json["ranking"]]
        self.assertEqual(scores, sorted(scores, reverse=True))

    def test_groups_and_subsets(self):
        r = self.c.get("/api/sites")
        self.assertEqual({g["id"] for g in r.json["groups"]}, {"artemis3", "pousos", "apollo"})
        r = self.c.get("/api/bundle?start=2026-11-08&days=1&provider=analytic&sites=a11,mal")
        self.assertEqual(set(r.json["sites"]), {"a11", "mal"})
        self.assertEqual([s["id"] for s in r.json["site_list"]], ["a11", "mal"])
        r = self.c.get("/api/compare?start=2026-11-08&days=2&provider=analytic&group=pousos")
        self.assertIn("ce4", [x["id"] for x in r.json["ranking"]])
        # Chang'e 4 fica no lado oculto: a Terra nunca aparece
        ce4 = next(x for x in r.json["ranking"] if x["id"] == "ce4")
        self.assertEqual(ce4["dte"], 0)
        self.assertEqual(self.c.get("/api/bundle?sites=mal,xyz").status_code, 400)
        self.assertEqual(self.c.get("/api/compare?group=nada").status_code, 400)

    def test_point(self):
        r = self.c.get("/api/point?lat=-85.5&lon=10&start=2026-11-08&days=1&provider=analytic")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(r.json["series"]["sun_el"]), 25)
        self.assertEqual(self.c.get("/api/point?lat=-95&lon=0").status_code, 400)
        self.assertEqual(self.c.get("/api/point?lat=10").status_code, 400)

    def test_validation(self):
        self.assertEqual(self.c.get("/api/bundle?start=ontem").status_code, 400)
        self.assertEqual(self.c.get("/api/bundle?days=500").status_code, 400)
        self.assertEqual(self.c.get("/api/bundle?step=7").status_code, 400)
        self.assertEqual(self.c.get("/api/windows?site=nada").status_code, 400)


if __name__ == "__main__":
    unittest.main()
