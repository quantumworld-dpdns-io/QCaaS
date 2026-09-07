variable "project_id" {
  description = "GCP project id"
  type        = string
}

variable "billing_account_id" {
  description = "Billing account id (XXXXXX-XXXXXX-XXXXXX) for the $0 budget alert. Empty = skip."
  type        = string
  default     = ""
}

variable "budget_notification_channels" {
  description = "Monitoring notification channel ids for budget alerts (optional)"
  type        = list(string)
  default     = []
}

variable "name" {
  description = "Resource name prefix"
  type        = string
  default     = "qcaas"
}

variable "environment" {
  type    = string
  default = "production"
}

variable "region" {
  description = "Must be an Always Free e2-micro region: us-central1, us-west1 or us-east1"
  type        = string
  default     = "us-central1"
  validation {
    condition     = contains(["us-central1", "us-west1", "us-east1"], var.region)
    error_message = "The free e2-micro is only available in us-central1, us-west1 and us-east1."
  }
}

variable "zone" {
  type    = string
  default = "us-central1-a"
}

variable "admin_cidrs" {
  description = "CIDRs allowed to SSH (your office / home IP). Never 0.0.0.0/0 in production."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "ssh_user" {
  type    = string
  default = "qcaas"
}

variable "ssh_public_key" {
  description = "Public key for the Ansible user (contents of ~/.ssh/qcaas_gcp.pub). Empty = OS Login only."
  type        = string
  default     = ""
}

variable "create_static_ip" {
  description = "Reserve a static external IPv4 (stable DNS) instead of an ephemeral one"
  type        = bool
  default     = true
}
