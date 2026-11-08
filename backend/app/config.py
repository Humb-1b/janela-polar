"""Configuração lida de variáveis de ambiente, com padrões que funcionam sem nada configurado."""
import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = BACKEND_DIR.parent
DATA_DIR = BACKEND_DIR / "data"
FRONTEND_DIR = Path(os.environ.get("JANELA_FRONTEND_DIR", REPO_DIR / "frontend"))
CACHE_DIR = Path(os.environ.get("JANELA_CACHE_DIR", BACKEND_DIR / ".cache"))

# auto      -> tenta a JPL Horizons; se falhar, usa o modelo analítico e avisa
# horizons  -> só Horizons (erro se ela não responder)
# analytic  -> só o modelo analítico (offline, ~0,1–0,3° de erro)
PROVIDER = os.environ.get("JANELA_PROVIDER", "auto").lower()

HORIZONS_URL = os.environ.get("HORIZONS_URL", "https://ssd.jpl.nasa.gov/api/horizons.api")
HORIZONS_TIMEOUT = float(os.environ.get("HORIZONS_TIMEOUT", "60"))
# A JPL pede uso moderado; 2 consultas simultâneas é um bom limite.
HORIZONS_WORKERS = max(1, int(os.environ.get("HORIZONS_WORKERS", "2")))
HORIZONS_RETRIES = int(os.environ.get("HORIZONS_RETRIES", "3"))

MAX_DAYS = 120
ALLOWED_STEPS_MIN = (10, 15, 30, 60, 120)
