# Secret Manager リソース管理（Terraform）

Issue: #170

## 概要

Gmail OAuth2 認証情報を格納する Secret Manager シークレットリソースを Terraform で定義する。
シークレットの**値投入は手作業**（`gcloud` CLI）で行い、値を Terraform state に含めない。

## 管理対象シークレット

| キー | Secret ID | 用途 |
|---|---|---|
| `client_id` | `gmail-oauth-client-id` | Gmail OAuth2 クライアント ID |
| `client_secret` | `gmail-oauth-client-secret` | Gmail OAuth2 クライアントシークレット |
| `refresh_token` | `gmail-oauth-refresh-token` | Gmail OAuth2 リフレッシュトークン |

## 設計方針

- `google_secret_manager_secret_version` は Terraform で管理しない（値を state に平文保存しないため）
- IAM は `roles/secretmanager.secretAccessor` のみ付与（最小権限）
- シークレット追加は `terraform.tfvars` の `secrets` map に追記するだけで対応可能

## 値の投入・確認

```bash
# 投入
echo -n "VALUE" | gcloud secrets versions add gmail-oauth-client-id --data-file=-
echo -n "VALUE" | gcloud secrets versions add gmail-oauth-client-secret --data-file=-
echo -n "VALUE" | gcloud secrets versions add gmail-oauth-refresh-token --data-file=-

# 確認
gcloud secrets versions access latest --secret="gmail-oauth-client-id"
```

## 関連

- #169: GCP プロジェクト基盤 & Terraform 初期構成
- #171: Gmail OAuth2 refresh_token 取得スクリプト
- `infra/terraform/secrets.tf`
