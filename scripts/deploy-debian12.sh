#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="dc-bot"
APP_USER="${APP_USER:-dc-bot}"
APP_GROUP="${APP_GROUP:-dc-bot}"
APP_DIR="${APP_DIR:-/opt/dc-bot}"
CONFIG_DIR="${CONFIG_DIR:-/etc/dc-bot}"
STATE_DIR="${STATE_DIR:-/var/lib/dc-bot}"
SERVICE_NAME="${SERVICE_NAME:-dc-bot.service}"
NODE_MAJOR="${NODE_MAJOR:-22}"
PNPM_VERSION="${PNPM_VERSION:-10.33.0}"
RUN_TESTS="${RUN_TESTS:-1}"
YES="0"
FORCE="0"

usage() {
  cat <<'EOF'
Usage:
  sudo -E bash scripts/deploy-debian12.sh [--yes] [--force]

Environment variables:
  DISCORD_TOKEN             Required unless prompted interactively
  DISCORD_GUILD_ID          Default: 1331633353648111697
  NAPCAT_ENDPOINT           Default: http://127.0.0.1:3000
  NAPCAT_ACCESS_TOKEN       Optional
  ADMIN_HOST                Default: 0.0.0.0
  ADMIN_PORT                Default: 8787
  ADMIN_PASSWORD            Required unless prompted interactively
  ADMIN_SESSION_SECRET      Auto-generated when empty
  RUN_TESTS                 Default: 1, set 0 to skip pnpm test

Examples:
  sudo -E bash scripts/deploy-debian12.sh
  sudo DISCORD_TOKEN='xxx' ADMIN_PASSWORD='change-this' bash scripts/deploy-debian12.sh --yes
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes|-y)
      YES="1"
      shift
      ;;
    --force)
      FORCE="1"
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 2
      ;;
  esac
done

log() {
  printf '[deploy] %s\n' "$*"
}

fail() {
  printf '[deploy] ERROR: %s\n' "$*" >&2
  exit 1
}

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    fail "Please run as root, for example: sudo -E bash scripts/deploy-debian12.sh"
  fi
}

check_debian12() {
  if [[ ! -r /etc/os-release ]]; then
    fail "/etc/os-release was not found"
  fi

  # shellcheck disable=SC1091
  source /etc/os-release
  if [[ "${ID:-}" != "debian" || "${VERSION_ID:-}" != "12" ]]; then
    if [[ "${FORCE}" != "1" ]]; then
      fail "This script targets Debian 12. Detected ${PRETTY_NAME:-unknown}. Use --force to override."
    fi
    log "Continuing on ${PRETTY_NAME:-unknown} because --force was provided"
  fi
}

load_existing_env_file() {
  local env_file="${CONFIG_DIR}/dc-bot.env"
  if [[ ! -r "${env_file}" ]]; then
    return
  fi

  log "Loading existing configuration from ${env_file}"
  while IFS= read -r line || [[ -n "${line}" ]]; do
    [[ -z "${line}" || "${line}" =~ ^[[:space:]]*# ]] && continue
    [[ "${line}" != *=* ]] && continue
    local key="${line%%=*}"
    local value="${line#*=}"
    [[ "${key}" =~ ^[A-Z0-9_]+$ ]] || continue
    if [[ -z "${!key+x}" ]]; then
      value="$(parse_env_value "${value}")"
      printf -v "${key}" '%s' "${value}"
      export "${key}"
    fi
  done < "${env_file}"
}

parse_env_value() {
  local value="$1"
  if [[ "${value}" == \"*\" && "${value}" == *\" ]]; then
    value="${value:1:${#value}-2}"
    value="${value//\\\"/\"}"
    value="${value//\\\\/\\}"
  fi
  printf '%s' "${value}"
}

prompt_secret() {
  local var_name="$1"
  local prompt="$2"
  local value="${!var_name:-}"
  if [[ -n "${value}" ]]; then
    return
  fi
  if [[ "${YES}" == "1" ]]; then
    fail "${var_name} is required in --yes mode"
  fi
  read -r -s -p "${prompt}: " value
  printf '\n'
  if [[ -z "${value}" ]]; then
    fail "${var_name} cannot be empty"
  fi
  printf -v "${var_name}" '%s' "${value}"
  export "${var_name}"
}

confirm() {
  if [[ "${YES}" == "1" ]]; then
    return
  fi
  local answer
  read -r -p "Deploy DC-Bot to ${APP_DIR} and restart ${SERVICE_NAME}? [y/N] " answer
  case "${answer}" in
    y|Y|yes|YES)
      ;;
    *)
      fail "Deployment cancelled"
      ;;
  esac
}

version_major() {
  local version="$1"
  version="${version#v}"
  printf '%s' "${version%%.*}"
}

install_system_packages() {
  log "Installing Debian packages"
  apt-get update
  apt-get install -y ca-certificates curl gnupg git rsync build-essential python3 pkg-config openssl
}

install_node_if_needed() {
  local current_major="0"
  if command -v node >/dev/null 2>&1; then
    current_major="$(version_major "$(node --version)")"
  fi

  if (( current_major >= NODE_MAJOR )); then
    log "Node.js $(node --version) is already installed"
    return
  fi

  log "Installing Node.js ${NODE_MAJOR}.x from NodeSource"
  local setup_script="/tmp/nodesource_setup_${NODE_MAJOR}.x.sh"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" -o "${setup_script}"
  bash "${setup_script}"
  apt-get install -y nodejs
  rm -f "${setup_script}"

  current_major="$(version_major "$(node --version)")"
  if (( current_major < NODE_MAJOR )); then
    fail "Node.js ${NODE_MAJOR}+ is required, installed $(node --version)"
  fi
}

install_pnpm() {
  log "Preparing pnpm ${PNPM_VERSION}"
  corepack enable
  corepack prepare "pnpm@${PNPM_VERSION}" --activate
  pnpm --version
}

ensure_user_and_dirs() {
  log "Creating service user and directories"
  if ! getent group "${APP_GROUP}" >/dev/null; then
    groupadd --system "${APP_GROUP}"
  fi
  if ! id "${APP_USER}" >/dev/null 2>&1; then
    useradd --system --gid "${APP_GROUP}" --home-dir "${STATE_DIR}" --shell /usr/sbin/nologin "${APP_USER}"
  fi

  install -d -m 0755 "${APP_DIR}"
  install -d -m 0750 -o root -g "${APP_GROUP}" "${CONFIG_DIR}"
  install -d -m 0750 -o "${APP_USER}" -g "${APP_GROUP}" "${STATE_DIR}" "${STATE_DIR}/media-cache"
}

write_env_file() {
  log "Writing ${CONFIG_DIR}/dc-bot.env"
  local env_file="${CONFIG_DIR}/dc-bot.env"

  : "${DISCORD_GUILD_ID:=1331633353648111697}"
  : "${NAPCAT_ENDPOINT:=http://127.0.0.1:3000}"
  : "${NAPCAT_ACCESS_TOKEN:=}"
  : "${ADMIN_HOST:=0.0.0.0}"
  : "${ADMIN_PORT:=8787}"
  : "${MAX_IMAGE_BYTES:=10485760}"
  : "${DISCORD_ATTACHMENT_TIMEOUT_MS:=15000}"
  : "${JOB_RETRY_BASE_SECONDS:=30}"
  : "${JOB_RETRY_MAX_SECONDS:=3600}"

  if [[ -z "${ADMIN_SESSION_SECRET:-}" ]]; then
    ADMIN_SESSION_SECRET="$(openssl rand -base64 48 | tr -d '\n')"
  fi

  umask 077
  cat > "${env_file}" <<EOF
DISCORD_TOKEN=$(quote_env_value "${DISCORD_TOKEN}")
DISCORD_GUILD_ID=$(quote_env_value "${DISCORD_GUILD_ID}")
NAPCAT_ENDPOINT=$(quote_env_value "${NAPCAT_ENDPOINT}")
NAPCAT_ACCESS_TOKEN=$(quote_env_value "${NAPCAT_ACCESS_TOKEN}")
ADMIN_HOST=$(quote_env_value "${ADMIN_HOST}")
ADMIN_PORT=$(quote_env_value "${ADMIN_PORT}")
ADMIN_PASSWORD=$(quote_env_value "${ADMIN_PASSWORD}")
ADMIN_SESSION_SECRET=$(quote_env_value "${ADMIN_SESSION_SECRET}")
SQLITE_PATH=$(quote_env_value "${STATE_DIR}/dc-bot.sqlite")
MEDIA_CACHE_DIR=$(quote_env_value "${STATE_DIR}/media-cache")
MAX_IMAGE_BYTES=$(quote_env_value "${MAX_IMAGE_BYTES}")
DISCORD_ATTACHMENT_TIMEOUT_MS=$(quote_env_value "${DISCORD_ATTACHMENT_TIMEOUT_MS}")
JOB_RETRY_BASE_SECONDS=$(quote_env_value "${JOB_RETRY_BASE_SECONDS}")
JOB_RETRY_MAX_SECONDS=$(quote_env_value "${JOB_RETRY_MAX_SECONDS}")
EOF
  chown root:"${APP_GROUP}" "${env_file}"
  chmod 0640 "${env_file}"
}

quote_env_value() {
  local value="$1"
  value="${value//$'\n'/}"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '"%s"' "${value}"
}

sync_application() {
  local script_dir repo_root
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  repo_root="$(cd "${script_dir}/.." && pwd)"

  log "Syncing application from ${repo_root} to ${APP_DIR}"
  if systemctl list-unit-files "${SERVICE_NAME}" >/dev/null 2>&1; then
    systemctl stop "${SERVICE_NAME}" || true
  fi

  rsync -a --delete \
    --exclude '.git/' \
    --exclude '.env' \
    --exclude '.env.local' \
    --exclude 'node_modules/' \
    --exclude '.pnpm-store/' \
    --exclude 'dist/' \
    --exclude 'data/' \
    --exclude 'media-cache/' \
    --exclude '*.log' \
    "${repo_root}/" "${APP_DIR}/"
}

install_application_dependencies() {
  log "Installing application dependencies"
  cd "${APP_DIR}"
  pnpm install --frozen-lockfile
}

verify_and_build() {
  cd "${APP_DIR}"
  if [[ "${RUN_TESTS}" == "1" ]]; then
    log "Running tests"
    pnpm test
  else
    log "Skipping tests because RUN_TESTS=${RUN_TESTS}"
  fi

  log "Building application"
  pnpm build
}

write_systemd_unit() {
  log "Writing /etc/systemd/system/${SERVICE_NAME}"
  cat > "/etc/systemd/system/${SERVICE_NAME}" <<EOF
[Unit]
Description=DC-Bot Discord to QQ bridge
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_GROUP}
WorkingDirectory=${APP_DIR}
Environment=NODE_ENV=production
EnvironmentFile=${CONFIG_DIR}/dc-bot.env
ExecStart=/usr/bin/node ${APP_DIR}/dist/server/index.js
Restart=on-failure
RestartSec=5
TimeoutStopSec=20
KillSignal=SIGTERM
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=full
ReadWritePaths=${STATE_DIR}

[Install]
WantedBy=multi-user.target
EOF
}

start_service() {
  log "Enabling and starting ${SERVICE_NAME}"
  systemctl daemon-reload
  systemctl enable "${SERVICE_NAME}"
  systemctl restart "${SERVICE_NAME}"
  sleep 2
  systemctl --no-pager --full status "${SERVICE_NAME}" || true
}

health_check() {
  local url="http://127.0.0.1:${ADMIN_PORT}/api/auth/me"
  log "Checking admin API: ${url}"
  curl -fsS "${url}" >/dev/null
}

print_summary() {
  cat <<EOF

Deployment completed.

Service:
  systemctl status ${SERVICE_NAME}
  journalctl -u ${SERVICE_NAME} -f

Admin:
  http://<server-ip>:${ADMIN_PORT}

Files:
  Application: ${APP_DIR}
  Environment: ${CONFIG_DIR}/dc-bot.env
  Data: ${STATE_DIR}

Next manual checks:
  1. Log in to the admin dashboard with ADMIN_PASSWORD.
  2. Sync Discord sources.
  3. Add QQ groups and channel routes.
  4. Test NapCat connection and send a test message.
EOF
}

main() {
  require_root
  check_debian12
  load_existing_env_file
  prompt_secret DISCORD_TOKEN "Discord bot token"
  prompt_secret ADMIN_PASSWORD "Admin dashboard password"
  confirm
  install_system_packages
  install_node_if_needed
  install_pnpm
  ensure_user_and_dirs
  write_env_file
  sync_application
  install_application_dependencies
  verify_and_build
  write_systemd_unit
  start_service
  health_check
  print_summary
}

main "$@"
