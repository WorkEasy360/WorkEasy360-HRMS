# Production deployment — single EC2 host

```
Browser ──HTTPS──> nginx (EC2, :443) ──> web:3000   Next.js
                                    └──> api:4000   Express, everything under /api/
api ──TLS (~150 ms)──> shared Aurora PostgreSQL (eu-north-1), schema hrms, role hrms_app
api ──> Amazon SES (ap-south-1), via the EC2 instance role
```

- One EC2 host (ap-south-1) runs Docker Compose: `api`, `web`, `nginx`, `certbot`. Only nginx publishes ports 80/443.
- Images are built by GitHub Actions and pulled from GHCR (`ghcr.io/<owner>/hrms-{api,web}:<commit sha>`). The host never builds and never holds source code.
- The database is the **shared** Aurora cluster. This app owns only schema `hrms` and connects only as `hrms_app`. It never touches `public` (another product) or `helpdesk`.
- Settings live only in `~/hrms/deploy/.env` on the host (chmod 600). Nothing secret is in git.

## Files

| Path | Purpose |
|---|---|
| `docker-compose.prod.yml` | The stack. `migrate` is a one-off profile, never started by `up`. |
| `nginx/templates/default.conf.template` | `/api/` → api, everything else → web, ACME challenge on :80. |
| `scripts/bootstrap-ec2.sh` | One-time host setup: Docker, Compose, 2 GB swap. |
| `scripts/init-letsencrypt.sh` | First TLS certificate (renewal is automatic). |
| `scripts/deploy.sh` | Preflight → pull → `prisma migrate deploy` → `up -d` → wait for healthy. |
| `scripts/check-migrations.sh` | Refuses migrations touching `public`/`helpdesk`, extensions, roles, grants. |
| `sql/01-create-role-and-schema.sql` | Creates `hrms_app` + schema `hrms`. Run once as the admin. |
| `.env.example` | Template for the host's `.env`. |

## One-time setup

1. **Host:** `sudo bash scripts/bootstrap-ec2.sh` (Docker, Compose, swap).
2. **Database** (admin password needed only here). Generate the app password on the host, then run the SQL in a throwaway container:
   ```bash
   cd ~/hrms/deploy
   APP_PW=$(openssl rand -hex 24)
   read -rs PGPASSWORD; export PGPASSWORD          # admin password, not echoed
   docker run --rm -i -e PGPASSWORD -v "$PWD/sql:/sql:ro" postgres:18-alpine \
     psql "host=<writer-endpoint> port=5432 dbname=postgres user=postgres sslmode=require" \
     -v pw="$APP_PW" -v db=postgres -f /sql/01-create-role-and-schema.sql
   unset PGPASSWORD
   ```
   Put `APP_PW` into `DATABASE_URL` in `.env`.
3. **`.env`:** `cp .env.example .env && chmod 600 .env`, then fill it in. Generate the JWT secrets on the host with `openssl rand -base64 48`.
4. **Certificate:** `bash scripts/init-letsencrypt.sh` (DNS for `DOMAIN` must point at the Elastic IP; `<ip-with-dashes>.sslip.io` works without DNS).
5. **GitHub:** add the secrets and the variable below, then push to `main`.

### Deploying from GitHub

`.github/workflows/deploy.yml` runs on every push to `main` (or by hand: Actions → Deploy → Run workflow). Deploys run one at a time.

- **Secrets** (Settings → Secrets and variables → Actions → Secrets):
  - `EC2_HOST`: the Elastic IP
  - `EC2_USER`: `ubuntu`
  - `EC2_SSH_KEY`: the deploy private key, the whole file including the BEGIN/END lines
- **Variable** (same page → Variables): `DOMAIN`, the public hostname. It is baked into the web bundle, so changing it means re-running the workflow.
- **Deploy key:** an ed25519 key used only by GitHub. Its `.pub` is in `~/.ssh/authorized_keys` on the host. Password SSH login is off.
- **Security group:** port 22 must accept `0.0.0.0/0`, because GitHub's runners have no fixed IPs.

The host logs in to GHCR with the workflow's own short-lived token during the rollout and logs out afterwards, so no registry credentials are stored on the host.

**Rollback:** re-run an older successful run (Actions → Deploy → that run → Re-run all jobs). On the host you can also run `IMAGE_TAG=<sha> docker compose -f docker-compose.prod.yml up -d api web`. Migrations are forward-only.

## First organization

1. With `ALLOW_PUBLIC_REGISTRATION=true`, open `https://DOMAIN/register` and create the organization. You become its Admin.
2. Then close sign-up: set `ALLOW_PUBLIC_REGISTRATION=false` in `.env`, and run `docker compose -f docker-compose.prod.yml up -d api`.
3. Add employees under People → Directory.
   - **Without SES** (default): HR sees a one-time temporary password to hand over.
   - **With SES:** employees get a "set your password" email.

## Email (SES)

`SES_REGION` is left unset until SES is ready; until then the app uses the temporary-password fallback. To turn email on:

1. Verify the sender domain in SES in ap-south-1 (DKIM records in DNS), and get production access.
2. Allow the instance role to send: add `ses:SendEmail` on `arn:aws:ses:ap-south-1:<account>:identity/<domain>` to the role's policy.
3. In `.env`, set `SES_REGION=ap-south-1` and `MAIL_FROM="WorkEasy360 HRMS <no-reply@<domain>>"`, then run `docker compose -f docker-compose.prod.yml up -d api`.

## Operating

```bash
cd ~/hrms/deploy
C="docker compose -f docker-compose.prod.yml"
$C ps                                  # status + health
$C logs -f --tail=200 api              # logs (rotated, 10 MB x 5)
curl -s https://$(grep ^DOMAIN= .env | cut -d= -f2)/api/health   # {"status":"ok","database":"up"}
```

- **Never** run `prisma migrate dev`, `migrate reset`, `db push` or any seed against Aurora. Releases only run `prisma migrate deploy`, as the `migrate` service.
- **Latency:** the database is ~150 ms away (Mumbai → Stockholm). Pages make a few sequential queries each, so expect them to feel a little slow. Transactions are allowed 30 s (`DB_TRANSACTION_TIMEOUT_MS`).
- **Backups** are Aurora's (automated backups / PITR on the cluster). The host is stateless apart from the TLS certificates.
- **State kept in memory** (lost on restart, which is harmless): sign-in rate-limit counters and the outgoing email queue.
