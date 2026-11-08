"""Testa scripts/sites_from_shapefiles.py com shapefiles sintéticos em projeção polar estereográfica."""
import math
import struct
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
import sites_from_shapefiles as sfs  # noqa: E402

R = 1737400.0
PRJ = ('PROJCS["Moon_South_Pole_Stereographic",GEOGCS["Moon",DATUM["D_Moon",SPHEROID["Moon",1737400.0,0.0]],'
       'PRIMEM["Reference_Meridian",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Stereographic_South_Pole"],'
       'PARAMETER["False_Easting",0.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",0.0],'
       'PARAMETER["Standard_Parallel_1",-90.0],UNIT["Meter",1.0]]')


def fwd(lat, lon):
    rho = 2 * R * math.tan(math.pi / 4 + math.radians(lat) / 2)
    return rho * math.sin(math.radians(lon)), rho * math.cos(math.radians(lon))


def write_grid(path, cx, cy, half_km, x_range=None):
    """Grade de quadrados de 1 km centrada em (cx, cy). x_range limita a uma fatia (quadrantes)."""
    recs = []
    cells = range(-half_km, half_km)
    for i in cells:
        if x_range and not (x_range[0] <= i < x_range[1]):
            continue
        for j in cells:
            x0, y0 = cx + i * 1000, cy + j * 1000
            ring = [(x0, y0), (x0, y0 + 1000), (x0 + 1000, y0 + 1000), (x0 + 1000, y0), (x0, y0)]
            content = struct.pack("<i4d2i", 5, x0, y0, x0 + 1000, y0 + 1000, 1, 5) + struct.pack("<i", 0)
            content += b"".join(struct.pack("<2d", *p) for p in ring)
            recs.append(content)
    body = b"".join(struct.pack(">2i", n + 1, len(c) // 2) + c for n, c in enumerate(recs))
    header = struct.pack(">7i", 9994, 0, 0, 0, 0, 0, (100 + len(body)) // 2) + struct.pack("<2i", 1000, 5)
    header += struct.pack("<8d", 0, 0, 0, 0, 0, 0, 0, 0)
    path.write_bytes(header + body)
    path.with_suffix(".prj").write_text(PRJ)


class TestSitesFromShapefiles(unittest.TestCase):
    def test_centers_and_prefix_matching(self):
        with tempfile.TemporaryDirectory() as d:
            d = Path(d)
            write_grid(d / "Malapert_Massif_1km_Grid.shp", *fwd(-85.9, 3.0), 8)
            write_grid(d / "Mons_Mouton_1km_Grid.shp", *fwd(-84.3, 31.0), 8)
            # Mons Mouton Plateau em dois "quadrantes" que juntos formam a região
            cx, cy = fwd(-84.7, 38.0)
            write_grid(d / "Mons_Mouton_Plateau_1km_Grid_Left.shp", cx, cy, 8, x_range=(-8, 0))
            write_grid(d / "Mons_Mouton_Plateau_1km_Grid_Right.shp", cx, cy, 8, x_range=(0, 8))
            write_grid(d / "Malapert_Massif_100m_Grid.shp", *fwd(-80.0, 90.0), 2)  # deve ser ignorado

            found = sfs.collect(d)
            self.assertEqual(set(found), {"mal", "mmo", "mmp"})
            self.assertEqual(len(found["mmp"]["files"]), 2)
            for sid, (lat, lon) in {"mal": (-85.9, 3.0), "mmo": (-84.3, 31.0), "mmp": (-84.7, 38.0)}.items():
                e = found[sid]
                p = sfs.parse_prj(e["prj"])
                xs = [q[0] for q in e["pts"]]
                ys = [q[1] for q in e["pts"]]
                got = sfs.inv_polar_stereo((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, p)
                self.assertAlmostEqual(got[0], lat, places=4)
                self.assertAlmostEqual(got[1], lon, places=4)

    def test_inverse_projection_west_longitude(self):
        p = sfs.parse_prj(PRJ)
        lat, lon = sfs.inv_polar_stereo(*fwd(-88.4, -64.0), p)
        self.assertAlmostEqual(lat, -88.4, places=6)
        self.assertAlmostEqual(lon, -64.0, places=6)


if __name__ == "__main__":
    unittest.main()
