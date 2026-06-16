"""
Gmail OAuth2 refresh_token 取得スクリプト

Usage:
    python scripts/get_gmail_refresh_token.py --credentials path/to/credentials.json

ブラウザが自動で開き、認可後に localhost へリダイレクトされてトークンを取得する。
取得した値を Secret Manager へ投入:
    echo -n "VALUE" | gcloud secrets versions add gmail-oauth-client-id --data-file=-
    echo -n "VALUE" | gcloud secrets versions add gmail-oauth-client-secret --data-file=-
    echo -n "VALUE" | gcloud secrets versions add gmail-oauth-refresh-token --data-file=-
"""

import argparse

from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = ["https://www.googleapis.com/auth/gmail.modify"]


def main() -> None:
    parser = argparse.ArgumentParser(description="Gmail OAuth2 refresh_token を取得する")
    parser.add_argument(
        "--credentials",
        default="credentials.json",
        help="GCP からダウンロードした OAuth2 クライアント認証情報 JSON ファイルのパス",
    )
    args = parser.parse_args()

    flow = InstalledAppFlow.from_client_secrets_file(args.credentials, scopes=SCOPES)

    # port=0 でランダムポートを使用。ブラウザが自動で開く。
    creds = flow.run_local_server(port=0, access_type="offline", prompt="consent")

    print("\n--- Secret Manager へ投入する値 ---")
    print(f"client_id:     {creds.client_id}")
    print(f"client_secret: {creds.client_secret}")
    print(f"refresh_token: {creds.refresh_token}")
    print()


if __name__ == "__main__":
    main()
