# Ponto de entrada para produção:
#   gunicorn --workers 2 --threads 4 --timeout 180 --bind 0.0.0.0:8000 wsgi:app
from app import create_app

app = create_app()
