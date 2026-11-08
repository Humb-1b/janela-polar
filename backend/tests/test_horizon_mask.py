"""Testa o núcleo de scripts/horizon_mask_from_dem.py com um relevo sintético."""
import math
import sys
import unittest
from pathlib import Path

try:
    import numpy as np
except ImportError:  # numpy só é necessário para o script de máscara
    np = None

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))

R = 1737400.0


def polar_stereo(lon, lat):
    rho = 2 * R * math.tan(math.pi / 4 + math.radians(lat) / 2)
    return rho * math.sin(math.radians(lon)), rho * math.cos(math.radians(lon))


@unittest.skipIf(np is None, "numpy não instalado")
class TestHorizonMask(unittest.TestCase):
    def test_hill_to_the_east(self):
        from horizon_mask_from_dem import horizon_mask
        lat, lon = -85.9, 3.0
        # morro de 1000 m, raio de 1 km, centrado 10 km a leste do local
        dlon = math.degrees(10_000 / (R * math.cos(math.radians(lat))))
        hx, hy = polar_stereo(lon + dlon, lat)

        def sample(X, Y):
            return np.where(np.hypot(X - hx, Y - hy) < 1000, 1000.0, 0.0)

        m = horizon_mask(sample, polar_stereo, lat, lon, res_m=20, obs_height_m=0, max_dist_m=30_000)
        expected = math.degrees(math.atan((1000 - 9000 ** 2 / (2 * R)) / 9000))  # borda mais próxima a ~9 km
        self.assertAlmostEqual(m[90], expected, delta=0.4)
        self.assertLess(m[270], 0.05)  # oeste livre
        self.assertLess(m[0], 0.05)    # norte livre
        self.assertLess(m[180], 0.05)  # sul livre


if __name__ == "__main__":
    unittest.main()
