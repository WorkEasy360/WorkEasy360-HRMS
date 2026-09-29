# Deploying WorkEasy360 to AWS

Two containers and one database:

```
Browser ──HTTPS──> app.example.com  (web: Next.js, port 3000)
        ──HTTPS──> api.example.com  (api: Express, port 4000) ──TLS──> Aurora / RDS PostgreSQL
```

Any container host works (ECS Fargate behind an ALB, App Runner, or Elastic Beanstalk). Both apps ship a `Dockerfile`.

## Option A: single EC2 server (simplest)

`docker-compose.yml` + `Caddyfile` run everything on one instance. Caddy handles HTTPS (Let's Encrypt), so no ALB is needed. The site and API share one domain (`https://DOMAIN` and `https://DOMAIN/api`).

1. Point a DNS A record for your domain at the instance's Elastic IP. Open ports 80 and 443 to the world, and 22 only to your IP.
2. Allow the instance's security group on the database security group (port 5432).
3. On the server: install Docker, copy this folder, `cp .env.production.example .env`, fill it in, then `docker compose up -d --build`.

Sections 1–3 below still apply for the database and environment values. Sections 4–5 are for the ECS/App Runner route.

## Email (Amazon SES)

Used for welcome/"set your password" invites, password reset links, and notifications:
- leave, expense and loan requests go to the approver
- approval or rejection decisions go to the employee
- payslips-ready emails after payroll is processed
- interview scheduling emails to the interviewer
- help desk ticket updates
- announcements

Emails are queued and sent in the background, so a failed email never fails the action that triggered it. If `SES_REGION` is not set, email is off: HR sees temporary passwords on screen, as before.

1. **Verify your domain** in SES (same region as `SES_REGION`), and add the DKIM CNAME records it gives you to your DNS.
2. **Request production access** (SES → Account dashboard). Until approved, SES only delivers to verified addresses. Approval usually takes about a day.
3. **Give the server permission to send:**
   - Create an IAM role for EC2 with this policy, and attach it to the instance (Actions → Security → Modify IAM role):
     ```json
     { "Version": "2012-10-17", "Statement": [{ "Effect": "Allow", "Action": "ses:SendEmail", "Resource": "*" }] }
     ```
   - Set the instance's **metadata response hop limit to 2** (Actions → Instance settings → Modify instance metadata options). Otherwise the app running inside Docker can't read the role's credentials.
4. Set `SES_REGION` and `MAIL_FROM` in `.env`. `MAIL_FROM` must use the verified domain, e.g. `WorkEasy360 <no-reply@yourdomain.com>`.

Recommended: add an SPF record for the domain and a DMARC record (`_dmarc` TXT `v=DMARC1; p=none;`) so emails don't land in spam.

## 1. Database (Aurora PostgreSQL or RDS PostgreSQL)

- Engine **PostgreSQL 14+** (Aurora PostgreSQL-compatible or RDS for PostgreSQL). Create a database named `workeasy360`.
- Put it in **private subnets**. Its security group allows port 5432 **only from the API's security group**.
- Use the **writer / cluster endpoint** in `DATABASE_URL` (the app writes on most requests).
- Enable automated backups (7+ days) and deletion protection.
- Connections: each API container opens up to `connection_limit` connections. Keep `containers × connection_limit` well below the instance's `max_connections`.

## 2. API environment variables (`backend/.env.example`)

| Variable | What to put | Example |
|---|---|---|
| `DATABASE_URL` | Writer endpoint with SSL and a pool size. URL-encode special characters in the password (`@`→`%40`, `#`→`%23`, `/`→`%2F`). | `postgresql://workeasy:PASS@my-cluster.cluster-abc.ap-south-1.rds.amazonaws.com:5432/workeasy360?schema=public&sslmode=require&connection_limit=5` |
| `JWT_ACCESS_SECRET` | New random value, 32+ characters. **Don't reuse the dev one.** | output of the command below |
| `JWT_REFRESH_SECRET` | A *different* random value, 32+ characters | output of the command below |
| `NODE_ENV` | `production` | `production` |
| `PORT` | Port the container listens on | `4000` |
| `CORS_ORIGIN` | Exact web-app origin(s), comma-separated, no trailing slash | `https://app.example.com` |
| `TRUST_PROXY` | Number of proxies in front of the API (1 for ALB / App Runner) | `1` |
| `RUN_MIGRATIONS` | `true` to apply migrations when the container starts | `true` |

Generate each secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Store `DATABASE_URL` and both JWT secrets in **AWS Secrets Manager** (or SSM Parameter Store SecureString) and inject them into the task. Don't put them in the image or in plain task-definition env vars.

## 3. Web environment variable (`frontend/.env.local.example`)

| Variable | What to put | Example |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | Public API URL **including `/api`** | `https://api.example.com/api` |

This value is **built into the JavaScript**, so it must be set **when building** the image, not only at runtime:

```bash
docker build --build-arg NEXT_PUBLIC_API_URL=https://api.example.com/api -t workeasy-web frontend
```

It also sets the Content-Security-Policy `connect-src`. If the API URL changes, rebuild the web image.

## 4. Build and push

```bash
aws ecr create-repository --repository-name workeasy-api
aws ecr create-repository --repository-name workeasy-web
aws ecr get-login-password | docker login --username AWS --password-stdin <acct>.dkr.ecr.<region>.amazonaws.com

docker build -t <acct>.dkr.ecr.<region>.amazonaws.com/workeasy-api:v1 backend
docker build --build-arg NEXT_PUBLIC_API_URL=https://api.example.com/api \
  -t <acct>.dkr.ecr.<region>.amazonaws.com/workeasy-web:v1 frontend
docker push <acct>.dkr.ecr.<region>.amazonaws.com/workeasy-api:v1
docker push <acct>.dkr.ecr.<region>.amazonaws.com/workeasy-web:v1
```

## 5. Run

- **API service:** container port 4000, health check `GET /health` (returns `{"status":"ok"}`), 0.5 vCPU / 1 GB is plenty to start. With `RUN_MIGRATIONS=true` the first start creates all tables. Permissions are seeded automatically on boot.
- **Web service:** container port 3000, health check `GET /login`.
- **HTTPS:** ACM certificates on the load balancer. Redirect HTTP to HTTPS.
- **DNS:** Route 53 records for `app.` and `api.` pointing at the load balancer(s).
- Run **1 API container** to begin with (see "Known limits"). The web service can scale freely.

Migrations can instead run as a one-off task: `npm run migrate:deploy`, with `DATABASE_URL` set.

## 6. First login

Open `https://app.example.com/register` and create your organization. You become its Admin. Then turn on 2FA under Settings → Security.

If someone forgets their password, an HR/Admin user opens their profile (People → Directory) and clicks **Reset password**.

## Pre-launch checklist

- [ ] New JWT secrets generated (not the dev values), stored in Secrets Manager
- [ ] `DATABASE_URL` uses the writer endpoint and `sslmode=require`
- [ ] DB security group only allows the API; DB not publicly accessible
- [ ] `CORS_ORIGIN` = the exact web URL (https, no trailing slash)
- [ ] Web image built with the production `NEXT_PUBLIC_API_URL`
- [ ] HTTPS on both domains, HTTP redirects to HTTPS
- [ ] DB automated backups + deletion protection on
- [ ] CloudWatch log groups for both services (the API logs in Apache "combined" format)
- [ ] Register the first org, then consider blocking `/api/auth/register` at the load balancer if you don't want public sign-ups

## Known limits

- **Rate limiting is in-memory, per container.** With N API containers the effective limit is N× higher. Fine for one or two containers; move to a Redis-backed limiter (ElastiCache) before scaling out further.
- **Login tokens are kept in browser storage.** The strict Content-Security-Policy reduces the risk. Moving the refresh token to an httpOnly cookie is the recommended next hardening step.
- **Email queue is in-memory.** Emails still queued when the API restarts are lost. That's fine for notifications; a lost invite or reset link can simply be sent again.
- **Timesheet entries don't send emails**, since they're logged daily. Approvers see them via the bell in the app.
