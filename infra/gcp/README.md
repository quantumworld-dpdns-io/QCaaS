# Hosting QCaaS on GCP Always Free + Neon (target: USD 0 / month)

```
                 Vercel (Hobby, free)                 GCP us-central1 (Always Free)
  browser ───▶  web/ Next.js  ───HTTPS──▶  Caddy :443 on 1× e2-micro VM  ──▶  api   (Python, :8000)
                                             api.<domain> / accounts.<domain>  ──▶  accounts (Go, :8080)
                                                                                     │
                                                              Neon (free tier) ◀─────┘  two Postgres DBs
                                                              GCS bucket (5 GB free)   nightly config backup
```

Everything the compose stack needs runs on **one non-preemptible e2-micro** (the only VM shape in
the Always Free tier), with the databases on **Neon** (serverless Postgres, free tier) and the web
app on Vercel. Terraform creates the GCP resources; Ansible installs Docker and runs
`infra/docker-compose.yml` + `infra/docker-compose.gcp.yml` on the VM.

## What is (and is not) free – read before `apply`

| Item | Always Free allowance | How this setup stays inside it |
|---|---|---|
| Compute | 1 e2-micro / month in **us-central1, us-west1 or us-east1** (non-preemptible) | `variables.tf` rejects any other region; `preemptible = false` |
| Boot disk | 30 GB-month pd-standard | disk is exactly 30 GB pd-standard; journald/docker logs are capped |
| Egress | 1 GB / month from North America (excl. China/Australia) | API responses are small JSON; the web app's static assets come from Vercel, not the VM |
| Cloud Storage | 5 GB-month Standard in a US region, 5k Class A + 50k Class B ops | one bucket, versioning off, 30-day lifecycle; only a nightly config tarball |
| External IPv4 | **Not clearly free.** Google bills in-use external IPv4 addresses (~USD 3–4 / month) but exempts the Free Tier e2-micro's address per the Free Tier page. Check the billing line item after day one; if charged, set `create_static_ip = false` and use the ephemeral address, or front the VM with Cloudflare's free proxy + IPv6. |
| Budget alert | free | `google_billing_budget` with USD 1 budget and thresholds at 1 % (= 1 cent), 50 %, 100 % forecast – GCP does not accept a 0 budget, this is the closest equivalent to 預算提醒 $0 |
| Neon | free tier: 0.5 GB storage, 1 project, autosuspend | two databases in one project (`qcaas_api`, `qcaas_accounts`); both services use tiny pools and `pool_pre_ping` |
| Vercel | Hobby tier | web/ only; set `NEXT_PUBLIC_API_BASE_URL=https://api.<domain>` and `NEXT_PUBLIC_ACCOUNTS_URL=https://accounts.<domain>` |

**Not used on purpose** (all would cost money or leave the free tier): Cloud SQL, load balancers,
Cloud NAT, Cloud Armor, Artifact Registry storage beyond 0.5 GB (images are pulled from GHCR), Cloud
Run for the API (the Qiskit image is ~300 MB and needs >512 MB RAM with a 10 s+ cold start; the
2 M-requests allowance is real, but `min-instances=1` is billed, so a VM fits the "always on,
zero cost" goal better). Cloud Run remains a good fit for the 5 MB Go accounts image if the VM
ever becomes the bottleneck. Firestore/BigQuery are not needed because Neon is the database.

Memory budget on the 1 GB VM: api ≤ 640 MB (127-qubit fake target + Aer), accounts ≤ 96 MB, Caddy
≤ 64 MB, plus a 2 GB swap file created by Ansible. Expect the first request after a restart to
take ~10 s while the backend target loads.

## 0. Prerequisites (local)

* `gcloud` (authenticated: `gcloud auth application-default login`), `terraform ≥ 1.6`, `ansible ≥ 2.15`
* A GCP project with billing linked (Free Tier still requires a billing account) and a **Neon** project
* A domain you control (e.g. `qcaas.example.com`) – `api.` and `accounts.` A records will point at the VM
* An SSH key for the Ansible user: `ssh-keygen -t ed25519 -f ~/.ssh/qcaas_gcp -C qcaas-gcp`

## 1. Neon

1. Create a project (region closest to us-central1, e.g. AWS us-east-2).
2. Create two databases: `qcaas_api` and `qcaas_accounts` (or one database and two roles).
3. Copy the pooled connection strings; both need `?sslmode=require`. The Python API accepts
   `postgresql://…` (it switches to the `psycopg` driver itself); the Go service accepts
   `postgres://…` or `postgresql://…` in `ACCOUNTS_DB_PATH`/`ACCOUNTS_DB_URL`.
4. Tables are created automatically on first start (SQLAlchemy `create_all`, Go migrations).

## 2. Terraform (GCP resources)

```bash
cd infra/gcp/terraform
cp terraform.tfvars.example terraform.tfvars   # edit project_id, billing_account_id, admin_cidrs, ssh_public_key
terraform init
terraform plan
terraform apply
terraform output -raw ansible_inventory > ../ansible/inventory.ini
terraform output vm_external_ip            # create DNS A records: api.<domain>, accounts.<domain>
```

Creates: VPC + subnet, firewall (22 from `admin_cidrs`, 80/443 public), a least-privilege service
account, the e2-micro VM (Debian 12, Shielded VM, OS Login), the GCS bucket, the budget alert.

## 3. Ansible (configure VM, run the stack)

```bash
cd infra/gcp/ansible
ansible-galaxy collection install -r requirements.yml
cp vars/secrets.example.yml vars/secrets.yml      # fill Neon URLs + secrets
ansible-vault encrypt vars/secrets.yml
# edit vars/main.yml: ghcr_owner, domain, acme_email, web_origins, gcs_bucket (terraform output bucket)
ansible-playbook site.yml --ask-vault-pass
```

Roles: `base` (apt, unattended upgrades, fail2ban, 2 GB swap, sysctl, app user), `docker`
(Docker CE + compose plugin, log caps, weekly prune), `qcaas` (compose files, `.env` from vault,
GHCR pull, `docker compose up -d`, health wait through Caddy, nightly backup to GCS).

Redeploy after a new image is published:

```bash
ansible-playbook site.yml -t deploy --ask-vault-pass
```

or trigger `.github/workflows/deploy-gcp.yml` (workflow_dispatch / after the Docker image
workflow) which runs the same tag over SSH using the `GCP_VM_HOST`, `GCP_SSH_PRIVATE_KEY` and
`ANSIBLE_VAULT_PASSWORD` secrets.

## 4. Vercel

Project root `web/`; environment variables per environment:
`NEXT_PUBLIC_API_BASE_URL=https://api.<domain>`, `NEXT_PUBLIC_ACCOUNTS_URL=https://accounts.<domain>`.
Add the production Vercel URL to `web_origins` in `vars/main.yml` (CORS for both services).

## 5. Verify

```bash
curl https://api.<domain>/healthz
curl https://accounts.<domain>/healthz          # "qcaas_api":"ok"
QCAAS_SMOKE_API_KEY=<key from an admin-provisioned account> bash infra/smoke.sh https://api.<domain>
```

Then in the GCP console: Billing → Reports filtered to the project should read USD 0.00 after
24 h except, possibly, the external IPv4 line (see table above).

## Tear down

`ansible-playbook site.yml -t deploy -e '{"compose_state":"absent"}'` is not needed – just
`terraform destroy` (the bucket has `force_destroy` outside production). Neon and Vercel are
deleted from their own consoles.
