"""Monta o 'pacote' de efemérides de um período: Sol e Terra vistos de cada
local + elevação da Lua para cada antena da DSN.

São 2 consultas por local + 1 por antena (23 no total com 10 locais). Elas
rodam em paralelo limitado, e cada uma fica em cache em disco."""
import logging
import math
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

from . import analytic, horizons
from .config import HORIZONS_WORKERS, PROVIDER
from .sites import all_sites, dsn_stations, load_mask

log = logging.getLogger(__name__)


def _r(v):
    return None if v is None or math.isnan(v) else round(v, 3)


class _Fetcher:
    """Busca uma série na Horizons ou no modelo analítico, conforme o provedor.
    Em 'auto', depois da primeira falha de rede para de tentar a Horizons
    (evita esperar o timeout 23 vezes)."""

    def __init__(self, provider, times, t0, step_min):
        self.provider = provider
        self.times, self.t0, self.step = times, t0, step_min
        self.horizons_down = False
        self.lock = threading.Lock()
        self.warnings = []

    def get(self, kind, lat, lon, alt_km):
        if self.provider != "analytic" and not self.horizons_down:
            target, center = {"sun": (horizons.SUN, horizons.MOON),
                              "earth": (horizons.EARTH, horizons.MOON),
                              "dsn": (horizons.MOON, horizons.EARTH)}[kind]
            try:
                az, el = horizons.fetch_altaz(target, center, lon, lat, alt_km,
                                              self.t0, len(self.times), self.step)
                return az, el, "horizons"
            except horizons.HorizonsError as e:
                if self.provider == "horizons":
                    raise
                with self.lock:
                    if isinstance(e, horizons.HorizonsUnavailable):
                        self.horizons_down = True
                    self.warnings.append(f"{kind} ({lat:.2f}, {lon:.2f}): {str(e)[:160]}")
                log.warning("Horizons falhou, usando modelo analítico: %s", e)
        az, el = analytic.series(self.times, lat, lon, kind)
        return az, el, "analytic"


def build_bundle(t0, days, step_min, provider=None):
    provider = (provider or PROVIDER).lower()
    n = int(days * 24 * 60 // step_min) + 1
    times = [t0 + timedelta(minutes=i * step_min) for i in range(n)]
    f = _Fetcher(provider, times, t0, step_min)

    sites, stations = all_sites(), dsn_stations()
    jobs = []
    for s in sites:
        jobs.append(("site", s, "sun"))
        jobs.append(("site", s, "earth"))
    for st in stations:
        jobs.append(("dsn", st, "dsn"))

    def run(job):
        _, obj, kind = job
        return job, f.get(kind, obj["lat"], obj["lon"], obj.get("alt_km", 0.0))

    workers = 1 if provider == "analytic" else HORIZONS_WORKERS
    with ThreadPoolExecutor(max_workers=workers) as pool:
        results = list(pool.map(run, jobs))

    out_sites = {s["id"]: {"mask": load_mask(s["id"])} for s in sites}
    dsn_el, used = {}, set()
    for (group, obj, kind), (az, el, src) in results:
        used.add(src)
        if group == "dsn":
            dsn_el[obj["id"]] = [_r(v) for v in el]
        else:
            out_sites[obj["id"]][f"{kind}_el"] = [_r(v) for v in el]
            out_sites[obj["id"]][f"{kind}_az"] = [_r(v) for v in az]
            out_sites[obj["id"]].setdefault("source", {})[kind] = src

    source = "horizons" if used == {"horizons"} else "analytic" if used == {"analytic"} else "mixed"
    return {
        "source": source,
        "provider": provider,
        "start": t0.isoformat().replace("+00:00", "Z"),
        "step_min": step_min,
        "n": n,
        "site_list": sites,
        "dsn": {"stations": stations, "elev": dsn_el},
        "sites": out_sites,
        "warnings": f.warnings[:20],
    }


_mem, _mem_lock = {}, threading.Lock()


def cached_bundle(t0, days, step_min, provider):
    """Mantém em memória os últimos pacotes (o cache em disco cobre reinícios).
    Um pacote montado com o modelo analítico por falha da Horizons não fica
    guardado, para a próxima chamada tentar a Horizons de novo."""
    key = (t0, days, step_min, provider)
    with _mem_lock:
        if key in _mem:
            return _mem[key]
    b = build_bundle(t0, days, step_min, provider)
    fallback = provider != "analytic" and b["source"] != "horizons"
    if not fallback:
        with _mem_lock:
            if len(_mem) >= 16:
                _mem.pop(next(iter(_mem)))
            _mem[key] = b
    return b


def site_series(bundle, site_id):
    s = bundle["sites"][site_id]
    nan = float("nan")

    def fl(xs):
        return [nan if v is None else v for v in xs]

    return {k: fl(s[k]) for k in ("sun_el", "sun_az", "earth_el", "earth_az")}


def dsn_series(bundle):
    nan = float("nan")
    return [[nan if v is None else v for v in xs] for xs in bundle["dsn"]["elev"].values()]
