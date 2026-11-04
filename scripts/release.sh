#!/bin/sh
# Production release, run ON the server from /srv/research: pull, build app and worker, migrate, restart.
#   ssh root@<server> /srv/research/scripts/release.sh
set -e
cd "$(dirname "$0")/.."
C="docker compose -f docker-compose.prod.yml --env-file .env.prod"
git pull -q
echo "at $(git rev-parse --short HEAD)"
$C build app worker </dev/null > build.log 2>&1 || { tail -20 build.log; exit 1; }
$C --profile tools build migrate </dev/null >> build.log 2>&1
$C --profile tools run -T --rm migrate </dev/null 2>&1 | grep -E "applied|up to date|rror" | tail -2
$C up -d app worker </dev/null 2>&1 | tail -1
sleep 6
$C ps --format "table {{.Service}}\t{{.Status}}" </dev/null
