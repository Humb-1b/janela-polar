"""Cache em disco para respostas da Horizons.

Efemérides não mudam: a mesma consulta sempre devolve o mesmo resultado
(a menos que a JPL troque a efeméride base), então guardamos para sempre.
Apague a pasta .cache para forçar novas consultas."""
import hashlib
import json
import os
import tempfile

from .config import CACHE_DIR

CACHE_VERSION = "v1"


def _path(key_obj):
    raw = json.dumps([CACHE_VERSION, key_obj], sort_keys=True).encode()
    return CACHE_DIR / f"{hashlib.sha256(raw).hexdigest()[:32]}.json"


def get(key_obj):
    p = _path(key_obj)
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def put(key_obj, value):
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    p = _path(key_obj)
    # escrita atômica para não corromper o cache com duas threads
    fd, tmp = tempfile.mkstemp(dir=CACHE_DIR, suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(value, f)
    os.replace(tmp, p)
