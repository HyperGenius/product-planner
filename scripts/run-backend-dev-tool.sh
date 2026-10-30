#!/usr/bin/env bash
# pre-commit のフックから、backend の venv に入っている開発ツール（ruff / mypy）を呼ぶ（Issue #606）。
#
# 版は backend/requirements-dev.txt だけで持ち、CI と同じ版・同じ依存（アプリの依存の型を含む）で動かす。
# venv の版が requirements-dev.txt と違うときは、黙って違う版で通さずに失敗させる。
#
# 使い方: run-backend-dev-tool.sh [--in-backend] <tool> [args...]
#   --in-backend: backend/ に移動してから実行する（mypy を CI と同じ `cd backend && mypy .` で動かすため）
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
backend_dir="$repo_root/backend"

in_backend=false
if [ "${1:-}" = "--in-backend" ]; then
    in_backend=true
    shift
fi
tool="${1:?使い方: run-backend-dev-tool.sh [--in-backend] <tool> [args...]}"
shift

# backend/.venv を優先し、無ければ有効にしている venv を使う（PATH 上のグローバルなツールは使わない）
exe=""
for venv in "$backend_dir/.venv" "${VIRTUAL_ENV:-}"; do
    if [ -n "$venv" ] && [ -x "$venv/bin/$tool" ]; then
        exe="$venv/bin/$tool"
        break
    fi
done
if [ -z "$exe" ]; then
    echo "$tool が backend の venv に見つかりません。次のコマンドで venv を作ってください:" >&2
    echo "  cd backend && uv venv -p 3.14 && uv pip install -r requirements-dev.txt" >&2
    exit 1
fi

expected="$(sed -n "s/^$tool==\([^[:space:]#]*\).*/\1/p" "$backend_dir/requirements-dev.txt")"
if [ -z "$expected" ]; then
    echo "backend/requirements-dev.txt に $tool の版（${tool}==x.y.z）がありません" >&2
    exit 1
fi
# ruff は "ruff 0.17.3"、mypy は "mypy 2.4.1 (compiled: yes)" を出す
actual="$("$exe" --version | awk '{print $2}')"
if [ "$actual" != "$expected" ]; then
    echo "$exe の版（${actual}）が backend/requirements-dev.txt（${expected}）と違います。次のコマンドで入れ直してください:" >&2
    echo "  cd backend && uv pip install -r requirements-dev.txt" >&2
    exit 1
fi

if [ "$in_backend" = true ]; then
    cd "$backend_dir"
fi
exec "$exe" "$@"
