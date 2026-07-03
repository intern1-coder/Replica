# AWS EC2 Provisioning Guide — Affinity

One project per instance. Cost-optimized for 5–10 users: **~$8–9/month total**.

**Current production (provisioned 2026-07-03):** region `eu-west-2` (London, UK GDPR), Elastic IP `13.135.142.11`, domain `https://affinity.agentik360.com` (A record `affinity` at agentik360.com's Namecheap DNS), S3 bucket `affinity-media-vlookup-prod`, IAM user `affinity-app`.

| Item | Choice | ~Cost/mo |
|------|--------|----------|
| Instance | t4g.micro (Graviton ARM64, 2 vCPU, 1GB RAM) | $6.50 |
| Storage | 20GB gp3 EBS root volume | $1.60 |
| Uploads | S3 bucket (a few GB + light traffic) | pennies |
| Elastic IP | Free while attached to a running instance | $0 |

Why ARM (Graviton): our Docker images are built for `linux/arm64` (`.github/workflows/build-image.yml`), so Graviton runs them unchanged. Do **not** pick a t3/t2 (x86) instance without also changing the image build platform.

**Escape hatch:** if PDF generation ever runs out of memory, stop the instance → Actions → Instance settings → Change instance type → `t4g.small` (2GB, ~$12/mo) → start. Takes ~2 minutes, nothing to reinstall.

---

## 1. Account Basics

1. Sign in to the AWS console, pick a region close to your users. We use **eu-west-2 (London)** — keeps all data in the UK for GDPR data residency. Stay in this region for everything below.
2. **Billing alarm (do this first):** Billing console → Budgets → Create budget → Monthly cost budget → amount **$10** → add your email. You'll be alerted before any cost surprise.

## 2. Key Pair (SSH)

EC2 console → Key pairs → Create key pair:
- Name: `affinity-key`
- Type: RSA, format: **.pem**
- Download and keep the `.pem` file safe (it cannot be re-downloaded).

**MobaXterm:** the `.pem` works directly — no PuTTY/.ppk conversion needed. Session → SSH → Advanced SSH settings → "Use private key" → select the `.pem`.

## 3. Launch the Instance

EC2 → Launch instance:
- **Name:** `affinity-prod`
- **AMI:** Ubuntu Server 24.04 LTS — **Architecture: 64-bit (Arm)** ← must be Arm
- **Instance type:** `t4g.micro`
- **Key pair:** `affinity-key`
- **Network settings → Edit → Security group** (create new, name `affinity-sg`):
  - SSH (22) — Source: **My IP** (not 0.0.0.0/0)
  - HTTP (80) — Source: 0.0.0.0/0
  - HTTPS (443) — Source: 0.0.0.0/0
  - Nothing else inbound; leave outbound open (default). Never expose port 3000.
- **Storage:** 20 GiB, gp3
- Launch.

Unlike Oracle Ubuntu images, AWS Ubuntu AMIs do not ship restrictive iptables rules — no firewall surgery needed on the host; the Security Group is the firewall (plus optional ufw, see DEPLOY.md §10).

## 4. Elastic IP

EC2 → Elastic IPs → Allocate → Allocate. Then Actions → Associate → pick `affinity-prod`.

This gives the instance a permanent public IP that survives stop/start. Point your DNS **A record** (`yourdomain.com`) at this IP. (No domain yet? You can reach the app at `http://<elastic-ip>` — but Caddy auto-HTTPS and emailed login links require a domain, so get one before production use.)

## 5. S3 Bucket + IAM User (file uploads)

1. S3 console → Create bucket:
   - Name: `affinity-media-<something-unique>` (bucket names are global)
   - Region: same as the instance
   - **Block all public access: ON** (files are served via signed URLs, never public)
2. IAM console → Users → Create user: `affinity-app` (no console access)
3. Attach an inline policy scoped to just this bucket:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::affinity-media-<something-unique>/*"
    },
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": "arn:aws:s3:::affinity-media-<something-unique>"
    }
  ]
}
```

4. User → Security credentials → Create access key (type: "Application running outside AWS"). Copy the **Access key ID** and **Secret access key** into the server's `backend/.env` as `STORAGE_ACCESS_KEY_ID` / `STORAGE_SECRET_ACCESS_KEY`, with `STORAGE_REGION` and `STORAGE_BUCKET_NAME`. Leave `STORAGE_ENDPOINT` unset — native S3 needs none.

## 6. First Login from MobaXterm

Session → SSH:
- Remote host: `<Elastic IP>` · Username: `ubuntu` · Port: 22
- Advanced SSH settings → Use private key → `affinity-key.pem`

Then follow `docs/DEPLOY.md` from §1 (it starts with the mandatory 2GB swap file — do not skip it on this 1GB instance).

## Differences from the old Oracle setup (nothing to carry over)

- No keepalive cron — AWS does not reclaim idle paid instances.
- No OCI CLI / "out of host capacity" retry script — capacity is not an issue.
- No OCI Security List or iptables-persistent fixes — Security Group covers it.
- OCI Object Storage + Customer Secret Keys → S3 + IAM access keys (above).
- Blue-green deploys (`docker-compose.prod.yml`, `scripts/deploy.sh`) are **not used** on this 1GB instance — deploys use the single-container `backend/docker-compose.yml`. Blue-green remains an option if you later resize to ≥2GB.
