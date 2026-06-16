"""
Gmail OAuth2 refresh_token 取得スクリプト

Usage:
    python scripts/get_gmail_refresh_token.py --credentials path/to/credentials.json

取得した値を Secret Manager へ投入:
    echo -n "VALUE" | gcloud secrets versions add gmail-oauth-client-id --data-file=-
    echo -n "VALUE" | gcloud secrets versions add gmail-oauth-client-secret --data-file=-
    echo -n "VALUE" | gcloud secrets versions add gmail-oauth-refresh-token --data-file=-
"""

import argparse

from google_auth_oauthlib.flow import Flow

SCOPES = ["https://www.googleapis.com/auth/gmail.modify"]


def main() -> None:
    parser = argparse.ArgumentParser(description="Gmail OAuth2 refresh_token を取得する")
    parser.add_argument(
        "--credentials",
        default="credentials.json",
        help="GCP からダウンロードした OAuth2 クライアント認証情報 JSON ファイルのパス",
    )
    args = parser.parse_args()

    flow = Flow.from_client_secrets_file(
        args.credentials,
        scopes=SCOPES,
        redirect_uri="urn:ietf:wg:oauth:2.0:oob",
    )

    auth_url, _ = flow.authorization_url(
        access_type="offline",
        prompt="consent",
    )

    print("\n以下の URL をブラウザで開き、認可してください:\n")
    print(auth_url)
    print()

    code = input("認可後に表示されたコードを貼り付けてください: ").strip()
    flow.fetch_token(code=code)

    creds = flow.credentials
    print("\n--- Secret Manager へ投入する値 ---")
    print(f"client_id:     {creds.client_id}")
    print(f"client_secret: {creds.client_secret}")
    print(f"refresh_token: {creds.refresh_token}")
    print()


if __name__ == "__main__":
    main()
