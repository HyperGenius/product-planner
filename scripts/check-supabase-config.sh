#!/usr/bin/env bash
# pre-commit のフックから、supabase/config.toml を Supabase CLI に読ませて検証する。
#
# CI の Deploy Migrations（`supabase db push`）は最新の CLI を使い、非推奨になったセクション
# （例: [inbucket] → [local_smtp]）を「no longer supported」で拒否して失敗する。手元の CLI は警告
# （`WARN: config section ... is deprecated`）を出すだけで終了コード 0 なので、コミット前には気づけない。
# そのため、警告も失敗として扱う。
#
# - supabase CLI が無い環境は、確かめられないのでスキップする（コミットを止めない）
# - CLI は `status` で設定を読む。Docker が動いていないなど設定と無関係な理由で失敗したときもスキップする
set -uo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root" || exit 1

if ! command -v supabase >/dev/null 2>&1; then
    echo "supabase CLI が無いため supabase/config.toml の検証をスキップしました" >&2
    exit 0
fi

output="$(supabase status 2>&1 >/dev/null)"
status=$?
combined="$output"
if [ $status -ne 0 ]; then
    # 失敗時は JSON のエラーが標準出力に出ることがあるので、もう一度まとめて取る
    combined="$(supabase status 2>&1)"
fi

problems="$(printf '%s\n' "$combined" | grep -E 'WARN: config|no longer supported|ConfigLoadError|failed to read config|failed to parse' || true)"
if [ -n "$problems" ]; then
    echo "supabase/config.toml に問題があります（CI の Deploy Migrations が失敗します）:" >&2
    printf '%s\n' "$problems" >&2
    exit 1
fi

if [ $status -ne 0 ]; then
    echo "supabase status が失敗したため supabase/config.toml の検証をスキップしました（設定の問題ではありません）:" >&2
    printf '%s\n' "$combined" | head -3 >&2
fi
exit 0
