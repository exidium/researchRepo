# Deploying to a Hetzner VM

One VM in an EU data centre, Docker Compose, Caddy for HTTPS, nightly backups. Decisions D4, D10 and D21 apply.

## One-time setup

1. Create a VM (Ubuntu, 4 GB RAM is plenty) and, if recordings will be large, a Hetzner volume mounted at `/mnt/research-uploads`.
2. Install Docker Engine + Compose plugin and Caddy.
3. Clone the repository to `/srv/research`.
4. `cp deploy/.env.prod.example .env.prod` and set a strong `POSTGRES_PASSWORD`. Point `BACKUP_DIR` at a folder on the volume.
5. If using the volume for uploads, edit `docker-compose.prod.yml` so the `uploads` volume is a bind mount of `/mnt/research-uploads`.
6. Copy `deploy/Caddyfile` to `/etc/caddy/Caddyfile`, set the real hostname, `systemctl reload caddy`.

## Each release

```bash
cd /srv/research && git pull
docker compose -f docker-compose.prod.yml --env-file .env.prod build
docker compose -f docker-compose.prod.yml --env-file .env.prod run --rm migrate
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

## Without a domain

`sslip.io` maps `<ip-with-dashes>.sslip.io` to that IP, so Caddy can obtain a certificate before a real domain exists. The first server uses `2-29-131-182.sslip.io`; replace it with the real hostname in `/etc/caddy/Caddyfile` when the domain is ready.

## First admin user

Until SSO exists, users are created by an admin. The very first one is created from the shell:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod run -T --rm -e USER_PASSWORD='...' migrate pnpm tsx scripts/create-user.ts admin@company.com "Full Name" --admin </dev/null
```

Pass `-T` and `</dev/null` to every `compose run` inside a script: without them the container attaches to stdin and swallows the rest of the script. Further users are created from the Users page in the app. The seed creates the three `*@local` dev users without a password unless `DEV_PASSWORD` is set; never set it on a server.

## First deployment (2026-11-04)

Hetzner CPX32, Helsinki, Ubuntu 26.04, Docker and Caddy from Ubuntu's repositories, `ufw` allowing 22/80/443, `fail2ban`, backup cron at 02:30 to `/srv/research/backups` (local only until an off-site target exists). Repository at `/srv/research`, env in `/srv/research/.env.prod`. Release: `git pull`, `build`, `run -T --rm migrate </dev/null`, `up -d`.

## AI suggestions

Off until a key is configured. To turn them on, add to `/srv/research/.env.prod` and run the release script:

```
ANTHROPIC_API_KEY=sk-ant-...
# optional: AI_MODEL=claude-opus-5-5, AI_AUTO_SUGGEST=off, AI_SUGGESTIONS=off
```

When on, transcript text and the tag list are sent to Anthropic whenever suggestions run (on request, and once automatically for each new in-app transcription). Do not set `AI_PROVIDER=fake` on a server. See D59–D61.

## Backups

`scripts/backup.sh` runs the `backup` service: `pg_dump -Fc` of the database and a tarball of the uploads, both into `BACKUP_DIR`, keeping 14 days. Schedule it with cron at 02:30. Restore: `pg_restore -d research db-YYYY-MM-DD.dump` and untar the uploads into the volume.

## Limits

Caddy's `request_body max_size` and the app's `MAX_RECORDING_BYTES` must agree. The app never buffers uploads in memory.
