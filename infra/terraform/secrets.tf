resource "google_secret_manager_secret" "gmail" {
  for_each  = var.secrets
  secret_id = each.value.secret_id

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_iam_member" "accessor" {
  for_each  = var.secrets
  secret_id = google_secret_manager_secret.gmail[each.key].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = var.secret_accessor_member
}
