#!/usr/bin/env bash
# 本番 Supabase へマイグレーションを適用する（セッションプーラー経由）。
#
# direct connection（db.<ref>.supabase.co）は名前解決できず、`--linked` は Management API の
# 一時ロール作成で失敗することがあるため、`--db-url` でプーラーへ直接つなぐ（CLAUDE.md 参照）。
# パスワードは URL に埋め込むので percent-encode する（記号を含む値でも壊れない）。
#
# 使い方: scripts/supabase-db-push-prod.sh [supabase db push のオプション...]
#   --dry-run       適用せず対象の版だけ表示する（本番へ流す前に必ず先に実行する）
#   --include-all   履歴に無い古い版も流す（古い日付の版が後から入ったときだけ）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/backend/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE がありません" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

if [ -z "${SUPABASE_PROJECT_ID:-}" ] || [ -z "${SUPABASE_DB_PASSWORD:-}" ]; then
  echo "ERROR: backend/.env に SUPABASE_PROJECT_ID / SUPABASE_DB_PASSWORD が必要です" >&2
  exit 1
fi

ENCODED_PASSWORD="$(python3 -c 'import os, urllib.parse; print(urllib.parse.quote(os.environ["SUPABASE_DB_PASSWORD"], safe=""))')"
DB_URL="postgresql://postgres.${SUPABASE_PROJECT_ID}:${ENCODED_PASSWORD}@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres"

cd "$ROOT/supabase"
exec supabase db push "$@" --db-url "$DB_URL"
