#!/usr/bin/env bash
# Start Plane from source. Infrastructure runs as local processes, not Docker.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
PREFIX="$ROOT/.runtime/conda"
DATA="$ROOT/.runtime/data"
LOG="$ROOT/.runtime/logs"
PY="$ROOT/apps/api/.venv/bin/python"
CELERY="$ROOT/apps/api/.venv/bin/celery"

# Local ports. 3000 is already taken by another app on this machine.
WEB_APP_PORT=3010
ADMIN_PORT=3011
API_PORT=3012

mkdir -p "$DATA/pg" "$DATA/redis" "$DATA/rabbitmq" "$DATA/minio" "$LOG"

if [[ ! -x "$PREFIX/bin/postgres" ]]; then
  echo "Missing local Postgres. Install the conda runtime under .runtime/conda first." >&2
  exit 1
fi

export MAMBA_ROOT_PREFIX="$PREFIX"
eval "$("$ROOT/.runtime/bin/micromamba" shell hook --shell bash)"
micromamba activate "$PREFIX"

# Postgres
if [[ ! -f "$DATA/pg/PG_VERSION" ]]; then
  PWFILE="$(mktemp)"
  printf 'plane' > "$PWFILE"
  initdb -D "$DATA/pg" -U plane --pwfile="$PWFILE" --auth-local=trust --auth-host=scram-sha-256 --encoding=UTF8 --locale=C
  rm -f "$PWFILE"
  cat >> "$DATA/pg/postgresql.conf" <<'EOF'
listen_addresses = '127.0.0.1'
port = 5432
EOF
fi

if ! pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then
  pg_ctl -D "$DATA/pg" -l "$LOG/postgres.log" -w start
fi
PGPASSWORD=plane psql -h 127.0.0.1 -U plane -d postgres -tc "SELECT 1 FROM pg_database WHERE datname='plane'" | grep -q 1 \
  || PGPASSWORD=plane createdb -h 127.0.0.1 -U plane plane

# Redis on 6380 because 6379 is already used on this machine
if ! lsof -nP -iTCP:6380 -sTCP:LISTEN >/dev/null 2>&1; then
  redis-server --bind 127.0.0.1 --port 6380 --dir "$DATA/redis" --dbfilename dump.rdb \
    --daemonize yes --logfile "$LOG/redis.log"
fi

# RabbitMQ
if ! lsof -nP -iTCP:5672 -sTCP:LISTEN >/dev/null 2>&1; then
  cat > "$ROOT/.runtime/rabbitmq.conf" <<'EOF'
listeners.tcp.default = 127.0.0.1:5672
default_user = plane
default_pass = plane
default_vhost = plane
management.tcp.port = 15672
management.tcp.ip = 127.0.0.1
deprecated_features.permit.transient_nonexcl_queues = true
EOF
  printf '[rabbitmq_management].\n' > "$ROOT/.runtime/enabled_plugins"
  export RABBITMQ_CONFIG_FILE="$ROOT/.runtime/rabbitmq"
  export RABBITMQ_ENABLED_PLUGINS_FILE="$ROOT/.runtime/enabled_plugins"
  export RABBITMQ_MNESIA_BASE="$DATA/rabbitmq"
  export RABBITMQ_LOG_BASE="$LOG"
  rabbitmq-server -detached
  for _ in $(seq 1 60); do
    rabbitmq-diagnostics -q ping && break
    sleep 1
  done
fi

# MinIO
if [[ ! -x "$ROOT/.runtime/bin/minio" ]]; then
  echo "Missing $ROOT/.runtime/bin/minio" >&2
  exit 1
fi
if ! lsof -nP -iTCP:9000 -sTCP:LISTEN >/dev/null 2>&1; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/apps/api/.env"
  set +a
  export MINIO_ROOT_USER="$AWS_ACCESS_KEY_ID"
  export MINIO_ROOT_PASSWORD="$AWS_SECRET_ACCESS_KEY"
  nohup "$ROOT/.runtime/bin/minio" server "$DATA/minio" \
    --address 127.0.0.1:9000 --console-address 127.0.0.1:9090 \
    > "$LOG/minio.log" 2>&1 &
  for _ in $(seq 1 30); do
    curl -sf "http://127.0.0.1:9000/minio/health/live" >/dev/null && break
    sleep 1
  done
fi

# API processes
set -a
# shellcheck disable=SC1091
source "$ROOT/apps/api/.env"
set +a
export DJANGO_SETTINGS_MODULE=plane.settings.local
# The checked-in env files still mention the upstream ports. This machine uses the ports above.
export APP_BASE_URL="http://localhost:${WEB_APP_PORT}"
export ADMIN_BASE_URL="http://localhost:${ADMIN_PORT}"
export WEB_URL="http://localhost:${API_PORT}"
export API_BASE_URL="http://localhost:${API_PORT}"
export WEB_BASE_URL="http://localhost:${WEB_APP_PORT}"
export CORS_ALLOWED_ORIGINS="http://localhost:${WEB_APP_PORT},http://localhost:${ADMIN_PORT},http://localhost:3002,http://localhost:3100"
export VITE_API_BASE_URL="http://localhost:${API_PORT}"
export VITE_WEB_BASE_URL="http://localhost:${WEB_APP_PORT}"
export VITE_ADMIN_BASE_URL="http://localhost:${ADMIN_PORT}"
export WEB_APP_PORT ADMIN_PORT API_PORT
cd "$ROOT/apps/api"
"$PY" manage.py wait_for_db --settings=plane.settings.local
"$PY" manage.py migrate --settings=plane.settings.local
SIG="$( (hostname; sysctl -n hw.model 2>/dev/null || true) | shasum -a 256 | awk '{print $1}')"
export MACHINE_SIGNATURE="$SIG"
"$PY" manage.py register_instance "$SIG" --settings=plane.settings.local
"$PY" manage.py configure_instance --settings=plane.settings.local
"$PY" manage.py create_bucket --settings=plane.settings.local
"$PY" manage.py clear_cache --settings=plane.settings.local

if ! lsof -nP -iTCP:"$API_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  nohup "$PY" manage.py runserver "127.0.0.1:${API_PORT}" --settings=plane.settings.local \
    > "$LOG/api.log" 2>&1 &
fi
if ! pgrep -f "celery -A plane worker" >/dev/null 2>&1; then
  # threads: the prefork pool on macOS receives tasks and never executes them.
  nohup "$CELERY" -A plane worker -l info --pool=threads --concurrency=4 > "$LOG/worker.log" 2>&1 &
fi
if ! pgrep -f "celery -A plane beat" >/dev/null 2>&1; then
  nohup "$CELERY" -A plane beat -l info > "$LOG/beat.log" 2>&1 &
fi

# Web apps. package.json dev scripts read WEB_APP_PORT and ADMIN_PORT.
unset PREFIX
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
nvm use 22.23.3 >/dev/null
cd "$ROOT"
if ! lsof -nP -iTCP:"$WEB_APP_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  nohup pnpm dev > "$LOG/web.log" 2>&1 &
fi

echo "Plane is starting."
echo "  Admin setup: http://localhost:${ADMIN_PORT}/god-mode/"
echo "  App:         http://localhost:${WEB_APP_PORT}/"
echo "  API:         http://localhost:${API_PORT}/"
echo "Logs: $LOG"
