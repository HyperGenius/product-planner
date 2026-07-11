variable "project" {
  type = object({
    id     = string
    region = string
    number = string
  })
}

variable "apis" {
  type = map(object({
    service = string
  }))
  default = {}
}

variable "secrets" {
  type = map(object({
    secret_id   = string
    description = string
  }))
  default = {}
}

variable "secret_accessor_member" {
  type        = string
  description = "Secret Manager secretAccessor ロールを付与する IAM メンバー (例: serviceAccount:xxx@yyy.iam.gserviceaccount.com)"
}

variable "supabase_project_ref" {
  type        = string
  description = "Supabase プロジェクトの参照ID（ダッシュボードURLの xxxx.supabase.co の xxxx 部分）"
}
