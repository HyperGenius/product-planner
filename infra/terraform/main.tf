terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
    supabase = {
      source  = "supabase/supabase"
      version = "~> 1.0"
    }
  }

  backend "gcs" {}
}

provider "google" {
  project = var.project.id
  region  = var.project.region
}

# access_token は SUPABASE_ACCESS_TOKEN 環境変数から取得する（tfvars に平文で書かない）
provider "supabase" {}
