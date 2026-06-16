# scripts/ ディレクトリ

運用・セットアップ用のユーティリティスクリプト置き場。本番コード（`backend/`）には含めない一回性・手動実行系の処理を管理する。

## 依存ライブラリのインストール

```bash
pip install -r scripts/requirements.txt
```

## スクリプト一覧

| ファイル | 用途 | 関連 Issue |
|---|---|---|
| `get_gmail_refresh_token.py` | Gmail OAuth2 の refresh_token を取得して標準出力に表示 | #171 |

## スクリプトの追加ルール

- 引数は `argparse` で定義し、`--help` で使い方が分かるようにする
- 認証情報・シークレット値はファイルに書き出さず標準出力に出力する
- 依存ライブラリは `scripts/requirements.txt` に追加する
- このドキュメントのスクリプト一覧に追記する
