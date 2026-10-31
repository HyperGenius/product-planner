# Backend の lint・整形・型チェック（pre-commit と CI）

コミット時の pre-commit と CI（`.github/workflows/ci-backend.yml`）で、ruff / mypy を**同じ版・同じ依存**で動かす（Issue #606）。

## 版の持ち方

- ruff / mypy の版は `backend/requirements-dev.txt` の `==` だけで持つ（Issue #604 で固定）
- CI は `uv pip install -r requirements.txt -r requirements-dev.txt` で入れたものを使う
- pre-commit（`.pre-commit-config.yaml`）は `repo: local` のフックで、`scripts/run-backend-dev-tool.sh` 経由で
  **backend の venv（`backend/.venv`、無ければ有効にしている venv）に入っている** ruff / mypy を呼ぶ。
  フックごとの `rev` は持たない

以前は pre-commit のフック（`astral-sh/ruff-pre-commit` / `pre-commit/mirrors-mypy`）が `rev` で別に版を持っていて、
CI と版がずれていた（ruff 0.14.10 と 0.17.3 で整形結果が違った）。また mirrors-mypy は pre-commit が作る独立した
環境で動き、`additional_dependencies` に書いたもの以外（`anthropic` 等）は `ignore_missing_imports` で `Any` 扱いに
なるため、CI の mypy で出る型エラー（PR #603 の `httpx2.Request`）がコミット時に出なかった。

## `scripts/run-backend-dev-tool.sh`

- venv のツールの `--version` と `requirements-dev.txt` の版を比べ、違えば失敗する（venv が古いまま違う版で通さない）。
  `requirements-dev.txt` を更新したら `cd backend && uv pip install -r requirements-dev.txt` で入れ直す
- venv にツールが無ければ失敗する（PATH 上のグローバルなツールにはフォールバックしない）
- `--in-backend` を付けると `backend/` に移動してから実行する

## 各フックと CI の対応

| フック | pre-commit の実行 | CI の実行 |
| --- | --- | --- |
| `ruff` | ルートから `ruff check --fix --config=backend/pyproject.toml <変更ファイル>` | ルートから `ruff check --config=backend/pyproject.toml backend/` |
| `ruff-format` | ルートから `ruff format --config=backend/pyproject.toml <変更ファイル>` | ルートから `ruff format --check --config=backend/pyproject.toml backend/` |
| `mypy` | `backend/` で `mypy .`（変更ファイルを渡さない） | `backend/` で `mypy .` |

- ruff はリポジトリルートから実行する（`cd backend` すると isort の first-party 判定が変わる）
- mypy は変更ファイルだけを渡すと、そのファイルを import している別のファイルの型エラーを見落とすので、
  CI と同じく全体を見る。`backend/` 配下の `.py` / `.pyi` / `pyproject.toml` / `requirements*.txt` が変わったときだけ走る
  （`backend/scripts/` は `pyproject.toml` の `exclude` で対象外）。所要時間はキャッシュ（`backend/.mypy_cache`）が無いと約7秒、あれば1秒未満
- CI の `ruff format --check` は、`--no-verify` 等で pre-commit を通さずに入った未整形のコードを検出するため
