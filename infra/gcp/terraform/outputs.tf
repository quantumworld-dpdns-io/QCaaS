output "vm_name" {
  value = google_compute_instance.vm.name
}

output "vm_zone" {
  value = google_compute_instance.vm.zone
}

output "vm_external_ip" {
  value = google_compute_instance.vm.network_interface[0].access_config[0].nat_ip
}

output "bucket" {
  value = google_storage_bucket.data.name
}

output "ssh_user" {
  value = var.ssh_user
}

# Ready-to-use Ansible inventory (write with: terraform output -raw ansible_inventory > ../ansible/inventory.ini)
output "ansible_inventory" {
  value = <<-EOT
    [qcaas]
    ${google_compute_instance.vm.network_interface[0].access_config[0].nat_ip} ansible_user=${var.ssh_user} ansible_ssh_private_key_file=~/.ssh/qcaas_gcp

    [qcaas:vars]
    ansible_python_interpreter=/usr/bin/python3
  EOT
}
