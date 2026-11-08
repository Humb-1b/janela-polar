"""Servidor de desenvolvimento:  python -m app  (dentro de backend/)."""
import argparse

from . import create_app

p = argparse.ArgumentParser(description="Janela Polar — servidor de desenvolvimento")
p.add_argument("--host", default="127.0.0.1")
p.add_argument("--port", type=int, default=5000)
p.add_argument("--debug", action="store_true")
a = p.parse_args()
create_app().run(host=a.host, port=a.port, debug=a.debug, threaded=True)
