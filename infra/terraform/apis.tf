resource "google_project_service" "apis" {
  for_each = var.apis

  project            = var.project.id
  service            = each.value.service
  disable_on_destroy = false
}
