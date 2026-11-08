FROM python:3.12-slim

WORKDIR /srv
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend backend
COPY frontend frontend

WORKDIR /srv/backend
ENV PORT=8000 JANELA_PROVIDER=auto
EXPOSE 8000
# timeout alto: a primeira consulta de um período faz 23 chamadas à Horizons
CMD gunicorn --workers 2 --threads 4 --timeout 180 --bind 0.0.0.0:${PORT} wsgi:app
