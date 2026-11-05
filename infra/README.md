# Deploying GMS on AWS

One production stack serves every gym (multi-tenant). Each gym gets its own login, data,
branding and member app at `https://<your-domain>/m/<gym-slug>`.

```
Internet ──HTTPS──▶ Application Load Balancer (ACM certificate, HTTP→HTTPS redirect)
                          │  only the ALB can reach the app
                          ▼
                 ECS Fargate · 2+ tasks of the GMS container (auto-scales on CPU)
                          │  only the app can reach the DB · TLS verified with the RDS CA
                          ▼
                 RDS PostgreSQL 16 (private subnets, encrypted, 14 days of backups)
Secrets Manager → DB password, encryption key, AI key, WhatsApp tokens
CloudWatch     → logs (30 days), Container Insights, alarms by email
```

## Monthly cost at launch (eu-central-1, on-demand, approximate)

| Item | Cost |
|---|---|
| 2 × Fargate tasks (0.5 vCPU, 1 GB) | ~$36 |
| Application Load Balancer | ~$20 |
| RDS db.t4g.micro + 20 GB gp3 (single AZ) | ~$15 |
| Secrets Manager, CloudWatch, ECR, public IPv4 addresses | ~$12 |
| **Total** | **≈ $80–85 / month** |

That is covered by two Pro gyms ($59 each). Turn on `db_multi_az` (+$15) once you have
around ten paying gyms.

## First deployment (about 45 minutes)

Prerequisites on your computer: an AWS account, the AWS CLI (`aws configure`), Terraform ≥ 1.6, Docker.

1. **Configure**
   ```bash
   cd infra/terraform
   cp terraform.tfvars.example terraform.tfvars   # set domain_name, superadmin_email, alarm_email
   terraform init
   ```
2. **Create the image registry first** and push the first image:
   ```bash
   terraform apply -target=aws_ecr_repository.app
   cd ../.. && ./scripts/deploy.sh || true   # the push works; the ECS restart fails until step 3 exists
   ```
3. **Create everything else**
   ```bash
   cd infra/terraform && terraform apply
   ```
   - Domain on Route 53 (`route53_zone_id` set): DNS and the certificate are automatic.
   - Domain elsewhere: while `apply` waits on the certificate, create the CNAME records from the
     `certificate_validation_records` output at your DNS provider, then a CNAME from your domain to
     `load_balancer_dns`.
4. **Sign in** at `https://<domain>` with `superadmin_email` and the password from
   `terraform output -raw superadmin_password`. Create your first gym from **Platform → New gym**.
5. **Optional keys** — AWS console → Secrets Manager → `gms-prod/app` → *Retrieve secret value* → *Edit*:
   - `ANTHROPIC_API_KEY` turns on the free-form AI (Ask your gym in Arabic/Arabizi/French, smarter member bot, win-back drafts). Without it GMS uses its offline mode.
   - `WHATSAPP_TOKEN`, `WHATSAPP_APP_SECRET` for automatic WhatsApp (see below).
   Then redeploy: `./scripts/deploy.sh` (tasks read secrets at start).

## Everyday operations

| Task | Command |
|---|---|
| Deploy a new version | `./scripts/deploy.sh` (or push to `main` with the GitHub Action) |
| Follow logs | `aws logs tail /ecs/gms-prod --follow` |
| Open a shell in a task | `aws ecs execute-command --cluster gms-prod --task <id> --container app --interactive --command sh` |
| Fill a gym with demo data (sales demo) | Platform → New gym → *Fill with demo data*, or in a task shell: `node seed-demo.js` |
| Restore the database | RDS console → Automated backups → *Restore to point in time* (any second of the last 14 days) |
| Roll back a bad deploy | Automatic (ECS circuit breaker). Manually: `terraform apply -var image_tag=<previous tag>` |

Database migrations run automatically at start-up, protected by a Postgres lock so several tasks can start at once.

## GitHub Actions (optional)

`.github/workflows/ci-deploy.yml` tests every push (TypeScript check + API tests against a real Postgres)
and deploys `main`. Create an IAM role trusted by GitHub's OIDC provider with permissions
`ecr:*` on the `gms` repository and `ecs:UpdateService`/`ecs:DescribeServices` on the cluster,
then store its ARN as the repository secret `AWS_DEPLOY_ROLE_ARN`.

## WhatsApp Business Platform (automatic messages)

Default mode needs nothing: messages wait in **Messages** and reception sends each one in a tap.
For fully automatic reminders and the 24/7 member assistant, per gym:

1. In Meta Business Manager, create a WhatsApp Business account and add the gym's number (a number not already used in the WhatsApp app).
2. Create two message templates, category *Utility*, languages English and Arabic, each with 3 variables `{{1}}` name, `{{2}}` gym, `{{3}}` date:
   - `gms_renewal_reminder`: “Hi {{1}}, your membership at {{2}} ends on {{3}}. Reply here or pass by reception to renew.”
   - `gms_winback`: “Hi {{1}}, we miss you at {{2}}! Your membership ended on {{3}}. Come back this week, we'll take care of you.”
3. Webhook: callback URL `https://<domain>/api/webhooks/whatsapp`, verify token = `WHATSAPP_VERIFY_TOKEN` from the secret, subscribe to `messages`.
4. In GMS → Settings → WhatsApp, paste the gym's *Phone number ID* and its access token (stored encrypted).

## Security checklist (already done in code and infrastructure)

- Passwords and PINs hashed with scrypt; sessions are random tokens stored hashed, HttpOnly + Secure + SameSite cookies.
- Brute-force protection on staff and member logins; CSRF protection (origin check + JSON-only API).
- Every query is parameterised; every business query is scoped to the signed-in gym (tested).
- Role-based access: owner, manager, reception, coach; super-admin for the platform.
- Strict security headers (CSP, HSTS, frame-ancestors none); WhatsApp webhook signature verified.
- Per-gym WhatsApp tokens encrypted with AES-256-GCM; secrets live in Secrets Manager, never in the image.
- Database encrypted at rest, private, TLS-only (`rds.force_ssl=1`) with certificate verification.
- Audit log of sensitive actions (payments voided, freezes beyond limits, staff changes…).
