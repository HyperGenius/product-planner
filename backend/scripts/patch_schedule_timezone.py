"""
production_schedules のタイムゾーン不具合(Issue #282)を修正するデータパッチスクリプト。

不具合の内容:
    scheduler_logic.py が実行ホストのローカルタイムゾーンで「現在時刻」を取得し、
    calendar.py の稼働時間判定(9:00-17:00)がその時刻をJSTの壁時計時刻とみなして
    計算していたため、ホストがUTCで動作している場合は本来のJST稼働時間より
    9時間遅い時刻がUTCとしてそのまま保存されてしまっていた。
    (例: 本来 JST 9:00 = UTC 00:00 であるべきところ、UTC 09:00 として保存された)

このスクリプトは、影響を受けた production_schedules の start_datetime / end_datetime から
9時間を差し引くことで、正しいUTC値(JST基準)に補正する。

Usage:
    # 対象レコードの確認のみ（DBは変更しない）
    python scripts/patch_schedule_timezone.py --env-file scripts/.env.cloud

    # 実際に補正を適用する
    python scripts/patch_schedule_timezone.py --env-file scripts/.env.cloud --apply
"""

import argparse
import os
import sys
from datetime import datetime, timedelta

from dotenv import load_dotenv

from supabase import create_client

SHIFT = timedelta(hours=9)


def _get_admin_client(env_file: str):
    load_dotenv(env_file)
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        missing = [
            v
            for v, val in [("SUPABASE_URL", url), ("SUPABASE_SERVICE_ROLE_KEY", key)]
            if not val
        ]
        print(
            f"エラー: 環境変数が設定されていません: {', '.join(missing)}",
            file=sys.stderr,
        )
        sys.exit(1)
    return create_client(url, key)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--env-file",
        default="scripts/.env.cloud",
        help="Supabase接続情報を含む.envファイルのパス",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="指定した場合のみ実際にDBを更新する（未指定の場合はドライラン）",
    )
    args = parser.parse_args()

    client = _get_admin_client(args.env_file)

    res = (
        client.table("production_schedules")
        .select("id,start_datetime,end_datetime")
        .order("id")
        .execute()
    )
    rows = res.data or []
    print(f"対象レコード数: {len(rows)}")

    for row in rows:
        old_start = datetime.fromisoformat(row["start_datetime"])
        old_end = datetime.fromisoformat(row["end_datetime"])
        new_start = old_start - SHIFT
        new_end = old_end - SHIFT

        print(
            f"id={row['id']}: "
            f"start {old_start.isoformat()} -> {new_start.isoformat()}, "
            f"end {old_end.isoformat()} -> {new_end.isoformat()}"
        )

        if args.apply:
            client.table("production_schedules").update(
                {
                    "start_datetime": new_start.isoformat(),
                    "end_datetime": new_end.isoformat(),
                }
            ).eq("id", row["id"]).execute()

    if args.apply:
        print("補正を適用しました。")
    else:
        print("ドライランです。--apply を付けて実行すると実際に更新されます。")


if __name__ == "__main__":
    main()
