#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="dc-bot"
REPO_URL="${REPO_URL:-https://github.com/CCA3370/DC-Bot.git}"
REPO_REF="${REPO_REF:-main}"
APP_DIR="${APP_DIR:-/opt/dc-bot}"
CONFIG_DIR="${CONFIG_DIR:-/etc/dc-bot}"
STATE_DIR="${STATE_DIR:-/var/lib/dc-bot}"
COMPOSE_ENV_FILE="${COMPOSE_ENV_FILE:-${APP_DIR}/.env.compose}"
LEGACY_SERVICE_NAME="${LEGACY_SERVICE_NAME:-dc-bot.service}"
YES="0"
FORCE="0"

usage() {
  cat <<'EOF'
Usage:
  sudo -E bash /tmp/deploy-dcbot.sh [--yes] [--force]

Environment variables:
  DISCORD_TOKEN             Required unless prompted interactively
  DISCORD_GUILD_ID          Optional initial Discord guild/server ID; can be set in the admin dashboard
  NAPCAT_ENDPOINT           Default: http://127.0.0.1:3000
  NAPCAT_ACCESS_TOKEN       Optional
  ADMIN_HOST                Default: 0.0.0.0
  ADMIN_PORT                Default: 8787
  ADMIN_PASSWORD            Required unless prompted interactively
  ADMIN_SESSION_SECRET      Auto-generated when empty
  REPO_URL                  Default: https://github.com/CCA3370/DC-Bot.git
  REPO_REF                  Default: main
  APP_DIR                   Default: /opt/dc-bot
  CONFIG_DIR                Default: /etc/dc-bot
  STATE_DIR                 Default: /var/lib/dc-bot

Examples:
  sudo -E bash /tmp/deploy-dcbot.sh
  sudo DISCORD_TOKEN='xxx' ADMIN_PASSWORD='change-this' bash /tmp/deploy-dcbot.sh --yes
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
    fail "Please run as root, for example: sudo -E bash /tmp/deploy-dcbot.sh"
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

parse_env_value() {
  local value="$1"
  if [[ "${value}" == \"*\" && "${value}" == *\" ]]; then
    value="${value:1:${#value}-2}"
    value="${value//\\\"/\"}"
    value="${value//\\\\/\\}"
  fi
  printf '%s' "${value}"
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
  read -r -p "Deploy ${APP_NAME} from ${REPO_URL}@${REPO_REF} to ${APP_DIR} with Docker Compose? [y/N] " answer
  case "${answer}" in
    y|Y|yes|YES)
      ;;
    *)
      fail "Deployment cancelled"
      ;;
  esac
}

install_system_packages() {
  log "Installing base Debian packages"
  apt-get update
  apt-get install -y ca-certificates curl gnupg git openssl
}

install_docker_engine() {
  log "Installing Docker Engine and Compose plugin from Docker apt repository"
  local codename="${VERSION_CODENAME:-bookworm}"
  local arch
  arch="$(dpkg --print-architecture)"

  apt-get remove -y docker.io docker-doc docker-compose podman-docker containerd runc || true

  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc

  cat > /etc/apt/sources.list.d/docker.list <<EOF
deb [arch=${arch} signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian ${codename} stable
EOF

  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
  docker version >/dev/null
  docker compose version >/dev/null
}

ensure_dirs() {
  log "Creating application, configuration, and state directories"
  install -d -m 0755 "$(dirname "${APP_DIR}")"
  install -d -m 0700 "${CONFIG_DIR}"
  install -d -m 0750 "${STATE_DIR}" "${STATE_DIR}/media-cache"
  chown -R 10001:10001 "${STATE_DIR}"
}

quote_env_value() {
  local value="$1"
  value="${value//$'\n'/}"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '"%s"' "${value}"
}

write_env_file() {
  log "Writing ${CONFIG_DIR}/dc-bot.env"
  local env_file="${CONFIG_DIR}/dc-bot.env"

  : "${DISCORD_GUILD_ID:=}"
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
SQLITE_PATH=$(quote_env_value "/app/data/dc-bot.sqlite")
MEDIA_CACHE_DIR=$(quote_env_value "/app/media-cache")
DC_BOT_STATE_DIR=$(quote_env_value "${STATE_DIR}")
DC_BOT_MEDIA_CACHE_DIR=$(quote_env_value "${STATE_DIR}/media-cache")
MAX_IMAGE_BYTES=$(quote_env_value "${MAX_IMAGE_BYTES}")
DISCORD_ATTACHMENT_TIMEOUT_MS=$(quote_env_value "${DISCORD_ATTACHMENT_TIMEOUT_MS}")
JOB_RETRY_BASE_SECONDS=$(quote_env_value "${JOB_RETRY_BASE_SECONDS}")
JOB_RETRY_MAX_SECONDS=$(quote_env_value "${JOB_RETRY_MAX_SECONDS}")
EOF
  chmod 0600 "${env_file}"
}

remove_legacy_systemd_unit() {
  if ! command -v systemctl >/dev/null 2>&1; then
    return
  fi

  if systemctl list-unit-files "${LEGACY_SERVICE_NAME}" >/dev/null 2>&1; then
    log "Stopping legacy systemd service ${LEGACY_SERVICE_NAME}"
    systemctl stop "${LEGACY_SERVICE_NAME}" || true
    systemctl disable "${LEGACY_SERVICE_NAME}" || true
  fi

  if [[ -f "/etc/systemd/system/${LEGACY_SERVICE_NAME}" ]]; then
    rm -f "/etc/systemd/system/${LEGACY_SERVICE_NAME}"
    systemctl daemon-reload
  fi
}

app_dir_has_entries() {
  shopt -s nullglob dotglob
  local entries=("${APP_DIR}"/*)
  shopt -u nullglob dotglob
  ((${#entries[@]} > 0))
}

prepare_app_dir_for_git_clone() {
  if [[ -e "${APP_DIR}" && ! -d "${APP_DIR}" ]]; then
    fail "${APP_DIR} exists but is not a directory"
  fi

  if [[ ! -d "${APP_DIR}" || -d "${APP_DIR}/.git" ]]; then
    return
  fi

  if app_dir_has_entries; then
    local backup_dir="${APP_DIR}.pre-git.$(date +%Y%m%d%H%M%S)"
    log "Moving existing non-git application directory to ${backup_dir}"
    mv "${APP_DIR}" "${backup_dir}"
  else
    rmdir "${APP_DIR}"
  fi
}

checkout_repo_ref() {
  cd "${APP_DIR}"
  git fetch --prune --tags origin

  if ! git diff --quiet || ! git diff --cached --quiet; then
    fail "${APP_DIR} has uncommitted git changes; resolve them before deploying"
  fi

  git clean -fd

  if git show-ref --verify --quiet "refs/remotes/origin/${REPO_REF}"; then
    git checkout -B "${REPO_REF}" "origin/${REPO_REF}"
  elif git show-ref --verify --quiet "refs/tags/${REPO_REF}"; then
    git checkout --detach "refs/tags/${REPO_REF}"
  else
    git checkout --detach "${REPO_REF}"
  fi

  git clean -fd
}

pull_application_from_github() {
  prepare_app_dir_for_git_clone

  if [[ -d "${APP_DIR}/.git" ]]; then
    log "Updating application repository in ${APP_DIR}"
    git -C "${APP_DIR}" remote set-url origin "${REPO_URL}"
    checkout_repo_ref
    return
  fi

  log "Cloning ${REPO_URL} to ${APP_DIR}"
  git clone "${REPO_URL}" "${APP_DIR}"
  checkout_repo_ref
}

sync_compose_env_file() {
  log "Writing Compose env file ${COMPOSE_ENV_FILE}"
  install -d -m 0755 "$(dirname "${COMPOSE_ENV_FILE}")"
  install -m 0600 "${CONFIG_DIR}/dc-bot.env" "${COMPOSE_ENV_FILE}"
}

compose() {
  docker compose --env-file "${COMPOSE_ENV_FILE}" -f "${APP_DIR}/docker-compose.yml" "$@"
}

deploy_compose_stack() {
  log "Validating Compose configuration"
  compose config >/dev/null

  log "Building Docker image"
  compose build

  log "Starting Docker Compose stack"
  compose up -d --remove-orphans
}

health_check() {
  local url="http://127.0.0.1:${ADMIN_PORT:-8787}/api/auth/me"
  log "Checking admin API: ${url}"

  for _ in $(seq 1 30); do
    if curl -fsS "${url}" >/dev/null; then
      return
    fi
    sleep 1
  done

  compose ps
  compose logs --tail=100 dc-bot || true
  fail "Admin API did not become healthy at ${url}"
}

print_summary() {
  cat <<EOF

Deployment completed.

Docker Compose:
  cd ${APP_DIR}
  docker compose --env-file ${COMPOSE_ENV_FILE} ps
  docker compose --env-file ${COMPOSE_ENV_FILE} logs -f dc-bot

Admin:
  http://<server-ip>:${ADMIN_PORT:-8787}

Files:
  Application: ${APP_DIR}
  Repository: ${REPO_URL}@${REPO_REF}
  Environment: ${CONFIG_DIR}/dc-bot.env
  Compose env: ${COMPOSE_ENV_FILE}
  Data: ${STATE_DIR}
  Media cache: ${STATE_DIR}/media-cache

NapCat:
  This script does not install NapCat. Install and configure NapCat on this Debian host.
  The container uses host networking, so default NAPCAT_ENDPOINT is http://127.0.0.1:3000.

Next manual checks:
  1. Confirm NapCat OneBot HTTP is reachable from the dc-bot container.
  2. Log in to the admin dashboard with ADMIN_PASSWORD.
  3. Set the Discord guild/server ID in the dashboard.
  4. Sync Discord sources.
  5. Add QQ groups and channel routes.
  6. Test NapCat connection and send a test message.
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
  install_docker_engine
  ensure_dirs
  write_env_file
  remove_legacy_systemd_unit
  pull_application_from_github
  sync_compose_env_file
  deploy_compose_stack
  health_check
  print_summary
}

main "$@"
