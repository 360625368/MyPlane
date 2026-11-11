#!/usr/bin/env bash
# Deploy Plane on the production host in its own Docker stack.
#
# Public ports match the local dev stack:
#   3010 web app
#   3011 admin (/god-mode/)
#   3012 API (/api/)
# All three ports are the same reverse proxy, so each page calls /api on its own origin.
#
# From a workstation this script SSHes to the server and runs there.
# On the server, run it again with --remote (the SSH path does that for you).
# Pass --build to rebuild images before restarting.
set -euo pipefail

DEPLOY_HOST="${DEPLOY_HOST:-43.156.249.109}"
DEPLOY_USER="${DEPLOY_USER:-ubuntu}"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/plane}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-feat-wiki}"
WEB_PORT=3010
ADMIN_PORT=3011
API_PORT=3012

if [[ "${1:-}" != "--remote" ]]; then
  exec ssh -o BatchMode=yes "${DEPLOY_USER}@${DEPLOY_HOST}" bash -s -- --remote "$@" < "$0"
fi
shift

BUILD=0
for arg in "$@"; do
  case "$arg" in
    --build) BUILD=1 ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done

if [[ ! -f "$DEPLOY_DIR/docker-compose.yml" ]]; then
  sudo mkdir -p "$DEPLOY_DIR"
  sudo chown "$USER:$USER" "$DEPLOY_DIR"
  git clone --depth 1 --branch "$DEPLOY_BRANCH" https://github.com/360625368/MyPlane.git "$DEPLOY_DIR"
fi

cd "$DEPLOY_DIR"

if [[ -d .git ]]; then
  git fetch --depth 1 origin "$DEPLOY_BRANCH"
  git checkout "$DEPLOY_BRANCH"
  git pull --ff-only origin "$DEPLOY_BRANCH"
fi

PUBLIC_HOST="$DEPLOY_HOST"
WEB_URL="http://${PUBLIC_HOST}:${WEB_PORT}"
ADMIN_URL="http://${PUBLIC_HOST}:${ADMIN_PORT}"
API_URL="http://${PUBLIC_HOST}:${API_PORT}"
ORIGINS="${WEB_URL},${ADMIN_URL},${API_URL}"

umask 077
if [[ ! -f .env || ! -f apps/api/.env || ! -f live.env ]]; then
  pg_pass="$(openssl rand -hex 24)"
  mq_pass="$(openssl rand -hex 24)"
  s3_key="$(openssl rand -hex 12)"
  s3_secret="$(openssl rand -hex 24)"
  secret_key="$(openssl rand -hex 32)"
  live_secret="$(openssl rand -hex 32)"
  cat > .env << EOF
POSTGRES_USER=plane
POSTGRES_PASSWORD=${pg_pass}
POSTGRES_DB=plane
PGDATA=/var/lib/postgresql/data
REDIS_HOST=plane-redis
REDIS_PORT=6379
RABBITMQ_HOST=plane-mq
RABBITMQ_PORT=5672
RABBITMQ_USER=plane
RABBITMQ_PASSWORD=${mq_pass}
RABBITMQ_VHOST=plane
LISTEN_HTTP_PORT=${WEB_PORT}
LISTEN_HTTPS_PORT=${ADMIN_PORT}
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=${s3_key}
AWS_SECRET_ACCESS_KEY=${s3_secret}
AWS_S3_ENDPOINT_URL=http://plane-minio:9000
AWS_S3_BUCKET_NAME=uploads
FILE_SIZE_LIMIT=5242880
USE_MINIO=1
EOF
  cat > apps/api/.env << EOF
DEBUG=0
CORS_ALLOWED_ORIGINS=${ORIGINS}
POSTGRES_USER=plane
POSTGRES_PASSWORD=${pg_pass}
POSTGRES_HOST=plane-db
POSTGRES_DB=plane
POSTGRES_PORT=5432
DATABASE_URL=postgresql://plane:${pg_pass}@plane-db:5432/plane
REDIS_HOST=plane-redis
REDIS_PORT=6379
REDIS_URL=redis://plane-redis:6379/
RABBITMQ_HOST=plane-mq
RABBITMQ_PORT=5672
RABBITMQ_USER=plane
RABBITMQ_PASSWORD=${mq_pass}
RABBITMQ_VHOST=plane
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=${s3_key}
AWS_SECRET_ACCESS_KEY=${s3_secret}
AWS_S3_ENDPOINT_URL=http://plane-minio:9000
AWS_S3_BUCKET_NAME=uploads
FILE_SIZE_LIMIT=5242880
SIGNED_URL_EXPIRATION=3600
USE_MINIO=1
WEB_URL=${WEB_URL}
GUNICORN_WORKERS=1
ADMIN_BASE_URL=${ADMIN_URL}
ADMIN_BASE_PATH=/god-mode
SPACE_BASE_URL=${WEB_URL}
SPACE_BASE_PATH=/spaces
APP_BASE_URL=${WEB_URL}
APP_BASE_PATH=/
LIVE_BASE_URL=${WEB_URL}
LIVE_BASE_PATH=/live
LIVE_SERVER_SECRET_KEY=${live_secret}
SECRET_KEY=${secret_key}
MINIO_ENDPOINT_SSL=0
API_KEY_RATE_LIMIT=60/minute
HARD_DELETE_AFTER_DAYS=60
EOF
  cat > live.env << EOF
API_BASE_URL=http://api:8000
CORS_ALLOWED_ORIGINS=${ORIGINS}
LIVE_BASE_PATH=/live
LIVE_SERVER_SECRET_KEY=${live_secret}
REDIS_HOST=plane-redis
REDIS_PORT=6379
REDIS_URL=redis://plane-redis:6379/
EOF
fi
chmod 600 .env apps/api/.env live.env

python3 - "$WEB_URL" "$ADMIN_URL" "$ORIGINS" << 'PY'
import pathlib, sys
web_url, admin_url, origins = sys.argv[1:]
updates = {
    pathlib.Path("apps/api/.env"): {
        "CORS_ALLOWED_ORIGINS": origins,
        "WEB_URL": web_url,
        "APP_BASE_URL": web_url,
        "ADMIN_BASE_URL": admin_url,
        "SPACE_BASE_URL": web_url,
        "LIVE_BASE_URL": web_url,
    },
    pathlib.Path("live.env"): {
        "CORS_ALLOWED_ORIGINS": origins,
    },
    pathlib.Path(".env"): {
        "LISTEN_HTTP_PORT": web_url.rsplit(":", 1)[-1],
    },
}

def upsert(path, mapping):
    lines = path.read_text().splitlines()
    seen = set()
    out = []
    for line in lines:
        key, sep, _value = line.partition("=")
        if sep and key in mapping:
            out.append(f"{key}={mapping[key]}")
            seen.add(key)
        else:
            out.append(line)
    for key, value in mapping.items():
        if key not in seen:
            out.append(f"{key}={value}")
    path.write_text("\n".join(out) + "\n")

for path, mapping in updates.items():
    upsert(path, mapping)
PY

cat > docker-compose.override.yml << EOF
services:
  api:
    image: plane-backend:local
    depends_on:
      - plane-mq
      - plane-minio
    deploy:
      resources:
        limits:
          memory: 512M
  worker:
    image: plane-backend:local
    depends_on:
      - plane-mq
      - plane-minio
    deploy:
      resources:
        limits:
          memory: 384M
  beat-worker:
    image: plane-backend:local
    depends_on:
      - plane-mq
      - plane-minio
    deploy:
      resources:
        limits:
          memory: 256M
  migrator:
    image: plane-backend:local
    deploy:
      resources:
        limits:
          memory: 512M
  web:
    deploy:
      resources:
        limits:
          memory: 128M
  admin:
    deploy:
      resources:
        limits:
          memory: 128M
  space:
    deploy:
      resources:
        limits:
          memory: 128M
  live:
    env_file:
      - ./live.env
    depends_on:
      - api
      - plane-redis
    deploy:
      resources:
        limits:
          memory: 256M
  proxy:
    ports: !override
      - "${WEB_PORT}:${WEB_PORT}"
      - "${ADMIN_PORT}:${ADMIN_PORT}"
      - "${API_PORT}:${API_PORT}"
    environment:
      SITE_ADDRESS: ":${WEB_PORT}, :${ADMIN_PORT}, :${API_PORT}"
      FILE_SIZE_LIMIT: "5242880"
      BUCKET_NAME: uploads
      TRUSTED_PROXIES: 0.0.0.0/0
      CERT_EMAIL: ""
      CERT_ACME_CA: https://acme-v02.api.letsencrypt.org/directory
      CERT_ACME_DNS: ""
    deploy:
      resources:
        limits:
          memory: 128M
  plane-db:
    command: ["postgres", "-c", "max_connections=80", "-c", "shared_buffers=64MB", "-c", "work_mem=4MB"]
    deploy:
      resources:
        limits:
          memory: 320M
  plane-redis:
    command: ["valkey-server", "--save", "", "--appendonly", "no", "--maxmemory", "64mb", "--maxmemory-policy", "allkeys-lru"]
    deploy:
      resources:
        limits:
          memory: 96M
  plane-mq:
    environment:
      RABBITMQ_SERVER_ADDITIONAL_ERL_ARGS: "-rabbit total_memory_available_override_value 268435456"
    deploy:
      resources:
        limits:
          memory: 384M
  plane-minio:
    deploy:
      resources:
        limits:
          memory: 256M
EOF

if [[ "$BUILD" -eq 1 ]]; then
  sudo docker compose build
fi

sudo docker compose up -d --force-recreate --no-deps proxy api worker beat-worker live

echo "Waiting for the API on port ${API_PORT}..."
ready=0
for _ in $(seq 1 60); do
  if curl -fsS --max-time 5 "http://127.0.0.1:${API_PORT}/api/instances/" >/dev/null; then
    ready=1
    break
  fi
  sleep 2
done

if [[ "$ready" -ne 1 ]]; then
  echo "API did not become ready. Recent proxy and API logs:" >&2
  sudo docker compose logs --tail 40 proxy api >&2 || true
  exit 1
fi

curl -fsS --max-time 10 -o /dev/null "http://127.0.0.1:${WEB_PORT}/"
curl -fsS --max-time 10 -o /dev/null "http://127.0.0.1:${ADMIN_PORT}/god-mode/"
echo "Plane is up."
echo "  App:   ${WEB_URL}/"
echo "  Admin: ${ADMIN_URL}/god-mode/"
echo "  API:   ${API_URL}/api/"
