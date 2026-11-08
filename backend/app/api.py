"""Rotas HTTP. Documentação com exemplos em docs/api.md."""
import csv
import io
from datetime import datetime, timezone

from flask import Blueprint, Response, jsonify, request

from . import ephemeris, windows
from .config import ALLOWED_STEPS_MIN, MAX_DAYS, PROVIDER
from .sites import dsn_stations, get_site, load_mask, select_sites, site_groups

bp = Blueprint("api", __name__, url_prefix="/api")


class BadRequest(ValueError):
    pass


def _arg_float(name, default, lo, hi):
    raw = request.args.get(name)
    if raw is None or raw == "":
        return default
    try:
        v = float(raw)
    except ValueError:
        raise BadRequest(f"'{name}' precisa ser um número (recebi '{raw}')") from None
    if not lo <= v <= hi:
        raise BadRequest(f"'{name}' precisa estar entre {lo} e {hi}")
    return v


def _period():
    raw = request.args.get("start") or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    try:
        t0 = datetime.strptime(raw, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except ValueError:
        raise BadRequest(f"'start' precisa estar no formato AAAA-MM-DD (recebi '{raw}')") from None
    days = int(_arg_float("days", 30, 1, MAX_DAYS))
    step = int(_arg_float("step", 60, 1, 1440))
    if step not in ALLOWED_STEPS_MIN:
        raise BadRequest(f"'step' precisa ser um destes valores em minutos: {ALLOWED_STEPS_MIN}")
    provider = (request.args.get("provider") or PROVIDER).lower()
    if provider not in ("auto", "horizons", "analytic"):
        raise BadRequest("'provider' precisa ser auto, horizons ou analytic")
    return t0, days, step, provider


def _sites():
    """?sites=mal,haw ou ?group=apollo. Sem nenhum: todos os locais."""
    raw = request.args.get("sites", "")
    ids = [x.strip() for x in raw.split(",") if x.strip()]
    group = request.args.get("group") or None
    try:
        return select_sites(ids, group)
    except KeyError as e:
        raise BadRequest(f"Local ou grupo desconhecido: {e.args[0]}. Veja /api/sites.") from None


def _window_params():
    return {
        "margin": _arg_float("margin", 0.5, -2, 10),
        "height_m": _arg_float("height", 0, 0, 5000),
        "dsn_min": _arg_float("dsn_min", 10, 0, 45),
    }


@bp.errorhandler(BadRequest)
def _bad(e):
    return jsonify({"error": str(e)}), 400


@bp.get("/health")
def health():
    return jsonify({"ok": True, "provider": PROVIDER})


@bp.get("/sites")
def sites():
    data = [dict(s, has_mask=load_mask(s["id"]) is not None) for s in select_sites()]
    return jsonify({"groups": site_groups(), "sites": data, "dsn": dsn_stations()})


@bp.get("/bundle")
def bundle():
    """Séries brutas (Sol, Terra, DSN) do período. É o que o frontend usa."""
    t0, days, step, provider = _period()
    return jsonify(ephemeris.cached_bundle(t0, days, step, provider, _sites()))


@bp.get("/point")
def point():
    """Séries do Sol e da Terra para uma coordenada qualquer: ?lat=-85.5&lon=10."""
    lat = _arg_float("lat", None, -90, 90)
    lon = _arg_float("lon", None, -180, 360)
    if lat is None or lon is None:
        raise BadRequest("Informe 'lat' (−90 a 90) e 'lon' (graus leste, −180 a 360)")
    t0, days, step, provider = _period()
    return jsonify(ephemeris.point_series(t0, days, step, provider, lat, lon))


def _evaluate(b, site_id, t0, step, wp):
    return windows.evaluate(ephemeris.site_series(b, site_id), ephemeris.dsn_series(b),
                            t0=t0, step_min=step, mask=b["sites"][site_id]["mask"], **wp)


@bp.get("/windows")
def site_windows():
    """Intervalos de Sol, DTE e janela ideal de um local. ?format=csv para planilha."""
    site_id = request.args.get("site", "")
    site = get_site(site_id)
    if site is None:
        raise BadRequest(f"Local '{site_id}' não existe. Veja /api/sites para os ids.")
    t0, days, step, provider = _period()
    wp = _window_params()
    b = ephemeris.cached_bundle(t0, days, step, provider, [site])
    res = _evaluate(b, site_id, t0, step, wp)

    if request.args.get("format") == "csv":
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["local", "tipo", "inicio_utc", "fim_utc", "horas", "continua_apos_periodo"])
        for iv in res["intervals"]:
            w.writerow([site["name"], iv["kind"], iv["start"], iv["end"], f"{iv['hours']:.2f}",
                        "sim" if iv["open_end"] else "não"])
        name = f"janelas-{site_id}-{t0:%Y%m%d}-{days}d.csv"
        return Response(buf.getvalue(), mimetype="text/csv",
                        headers={"Content-Disposition": f'attachment; filename="{name}"'})

    return jsonify({"site": site, "source": b["source"], "params": wp,
                    "stats": res["stats"], "intervals": res["intervals"], "warnings": b["warnings"]})


@bp.get("/compare")
def compare():
    """Ranking dos locais no período, com as mesmas métricas da tabela do app."""
    t0, days, step, provider = _period()
    wp = _window_params()
    sites = _sites()
    b = ephemeris.cached_bundle(t0, days, step, provider, sites)
    rows = []
    for s in sites:
        st = _evaluate(b, s["id"], t0, step, wp)["stats"]
        rows.append({"id": s["id"], "name": s["name"], **{k: round(v, 4) for k, v in st.items()}})
    rows.sort(key=lambda r: -r["score"])
    return jsonify({"source": b["source"], "params": wp, "ranking": rows, "warnings": b["warnings"]})
