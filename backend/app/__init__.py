"""Janela Polar — backend.

    create_app() devolve o app Flask, que serve a API em /api/* e o frontend em /.
"""
import logging

from flask import Flask, jsonify

from .config import FRONTEND_DIR


def create_app():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    app = Flask(__name__, static_folder=str(FRONTEND_DIR), static_url_path="")
    app.json.ensure_ascii = False
    app.json.sort_keys = False

    from .api import bp
    app.register_blueprint(bp)

    @app.after_request
    def cors(resp):
        # libera o frontend hospedado em outro lugar (GitHub Pages, arquivo local)
        resp.headers["Access-Control-Allow-Origin"] = "*"
        return resp

    @app.get("/")
    def index():
        return app.send_static_file("index.html")

    from .horizons import HorizonsError

    @app.errorhandler(HorizonsError)
    def on_horizons(e):
        return jsonify({"error": f"A JPL Horizons não respondeu como esperado: {e}. "
                                 "Use provider=auto para cair no modelo analítico."}), 503

    @app.errorhandler(Exception)
    def on_error(e):
        from werkzeug.exceptions import HTTPException
        if isinstance(e, HTTPException):
            return jsonify({"error": e.description}), e.code
        app.logger.exception("Erro não tratado")
        return jsonify({"error": f"Erro interno: {e}"}), 502

    return app
