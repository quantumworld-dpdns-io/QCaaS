# QCaaS on GCP Always Free tier.
#
# What this provisions (all inside the Always Free allowances when used as documented):
#   * 1 x e2-micro VM in an eligible US region (us-central1 / us-west1 / us-east1),
#     30 GB pd-standard boot disk, Debian 12, Docker installed by Ansible afterwards.
#   * VPC firewall: 22 from your admin CIDR, 80/443 from anywhere.
#   * A regional Standard-class Cloud Storage bucket (5 GB free in US regions) for
#     compose backups / logs.
#   * Optional: a $0-threshold budget alert on the billing account (spec: 開帳時就設預算提醒 $0).
#
# NOT provisioned: any database (Neon hosts Postgres for both services), Cloud SQL, load
# balancers, Cloud NAT, static IPs beyond the one attached to the VM. See README.md for the
# free-tier caveats (egress 1 GB/month from NA, external IPv4 pricing).

terraform {
  required_version = ">= 1.6"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
  # Remote state (optional). Create the bucket once, then uncomment:
  # backend "gcs" {
  #   bucket = "<project>-tfstate"
  #   prefix = "qcaas"
  # }
}

provider "google" {
  project = var.project_id
  region  = var.region
  zone    = var.zone
}

locals {
  labels = {
    app         = "qcaas"
    environment = var.environment
    managed_by  = "terraform"
  }
}

# ---- APIs -------------------------------------------------------------------------------
resource "google_project_service" "apis" {
  for_each = toset([
    "compute.googleapis.com",
    "storage.googleapis.com",
    "billingbudgets.googleapis.com",
    "monitoring.googleapis.com",
    "logging.googleapis.com",
  ])
  service            = each.key
  disable_on_destroy = false
}

# ---- Network ----------------------------------------------------------------------------
resource "google_compute_network" "vpc" {
  name                    = "${var.name}-vpc"
  auto_create_subnetworks = false
  depends_on              = [google_project_service.apis]
}

resource "google_compute_subnetwork" "subnet" {
  name          = "${var.name}-subnet"
  ip_cidr_range = "10.10.0.0/24"
  region        = var.region
  network       = google_compute_network.vpc.id
}

resource "google_compute_firewall" "ssh" {
  name          = "${var.name}-allow-ssh"
  network       = google_compute_network.vpc.name
  source_ranges = var.admin_cidrs
  target_tags   = ["${var.name}-vm"]
  allow {
    protocol = "tcp"
    ports    = ["22"]
  }
}

resource "google_compute_firewall" "web" {
  name          = "${var.name}-allow-web"
  network       = google_compute_network.vpc.name
  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["${var.name}-vm"]
  allow {
    protocol = "tcp"
    ports    = ["80", "443"]
  }
}

# ---- Service account (least privilege: logging/monitoring + bucket objects) -------------
resource "google_service_account" "vm" {
  account_id   = "${var.name}-vm"
  display_name = "QCaaS VM service account"
}

resource "google_project_iam_member" "vm_logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.vm.email}"
}

resource "google_project_iam_member" "vm_monitoring" {
  project = var.project_id
  role    = "roles/monitoring.metricWriter"
  member  = "serviceAccount:${google_service_account.vm.email}"
}

# ---- VM (Always Free: e2-micro, 30 GB pd-standard, eligible US region) ------------------
resource "google_compute_address" "vm" {
  # An external IPv4 attached to a running VM. NOTE: Google bills external IPv4 addresses
  # since 2024; the Always Free e2-micro allowance covers the instance itself - verify the
  # IPv4 line item in Billing after the first day, or set create_static_ip = false to use an
  # ephemeral address (changes on stop/start; update DNS/Ansible inventory accordingly).
  count  = var.create_static_ip ? 1 : 0
  name   = "${var.name}-ip"
  region = var.region
}

resource "google_compute_instance" "vm" {
  name         = "${var.name}-vm"
  machine_type = "e2-micro"
  zone         = var.zone
  tags         = ["${var.name}-vm"]
  labels       = local.labels

  boot_disk {
    initialize_params {
      image  = "debian-cloud/debian-12"
      size   = 30 # GB - exactly the free pd-standard allowance
      type   = "pd-standard"
      labels = local.labels
    }
  }

  network_interface {
    subnetwork = google_compute_subnetwork.subnet.id
    access_config {
      nat_ip = var.create_static_ip ? google_compute_address.vm[0].address : null
    }
  }

  service_account {
    email  = google_service_account.vm.email
    scopes = ["cloud-platform"]
  }

  metadata = {
    enable-oslogin = "TRUE" # ssh via `gcloud compute ssh`; Ansible uses the same identity
    ssh-keys       = var.ssh_public_key != "" ? "${var.ssh_user}:${var.ssh_public_key}" : null
  }

  scheduling {
    automatic_restart   = true
    on_host_maintenance = "MIGRATE"
    preemptible         = false # the free e2-micro must be non-preemptible
  }

  shielded_instance_config {
    enable_secure_boot          = true
    enable_vtpm                 = true
    enable_integrity_monitoring = true
  }

  allow_stopping_for_update = true
  depends_on                = [google_project_service.apis]
}

# ---- Storage (Standard class, US region: 5 GB-month free) --------------------------------
resource "google_storage_bucket" "data" {
  name                        = "${var.project_id}-${var.name}-data"
  location                    = upper(var.region)
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  force_destroy               = var.environment != "production"
  labels                      = local.labels

  versioning {
    enabled = false # versions count against the 5 GB allowance
  }
  lifecycle_rule {
    condition {
      age = 30
    }
    action {
      type = "Delete"
    }
  }
}

resource "google_storage_bucket_iam_member" "vm_objects" {
  bucket = google_storage_bucket.data.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.vm.email}"
}

# ---- $0 budget alert (spec: 預算提醒 $0) ----------------------------------------------------
resource "google_billing_budget" "zero" {
  count           = var.billing_account_id != "" ? 1 : 0
  billing_account = var.billing_account_id
  display_name    = "${var.name}-zero-budget"

  budget_filter {
    projects = ["projects/${data.google_project.this.number}"]
  }

  amount {
    specified_amount {
      currency_code = "USD"
      units         = "1" # budgets must be >0; alert at 1% (= $0.01) and every step above
    }
  }

  threshold_rules {
    threshold_percent = 0.01
  }
  threshold_rules {
    threshold_percent = 0.5
  }
  threshold_rules {
    threshold_percent = 1.0
    spend_basis       = "FORECASTED_SPEND"
  }

  all_updates_rule {
    monitoring_notification_channels = var.budget_notification_channels
    disable_default_iam_recipients   = false # billing admins still get e-mail
  }
  depends_on = [google_project_service.apis]
}

data "google_project" "this" {
  project_id = var.project_id
}
