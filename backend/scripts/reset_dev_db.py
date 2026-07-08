"""
開発用ローカルSupabaseの初期化スクリプト.

以下を順に実行し、クリーンな状態のデモデータ入りローカル環境を用意します:
  1. supabase db reset  — ローカルDBをマイグレーション済みの状態にリセット
  2. supabase start     — ローカルSupabaseスタックを起動（既に起動中ならスキップされる）
  3. seed_scenario.py   — シナリオデータを投入

Usage:
    python scripts/reset_dev_db.py                  # standard_demo を投入
    python scripts/reset_dev_db.py <シナリオ名>       # 任意のシナリオを投入

Note:
    ローカルの `supabase` CLI が PATH 上にインストールされている必要があります。
    `supabase db reset` はローカルDBの全データを消去します。
"""

import argparse
import subprocess
import sys
from pathlib import Path

from seed_scenario import seed_scenario

PROJECT_ROOT = Path(__file__).resolve().parents[2]


def run_supabase_command(args: list[str], description: str) -> None:
    print(f"\n{'=' * 60}")
    print(f"🚀 {description}")
    print(f"{'=' * 60}")

    result = subprocess.run(["supabase", *args], cwd=PROJECT_ROOT)
    if result.returncode != 0:
        raise RuntimeError(
            f"'supabase {' '.join(args)}' failed (exit code {result.returncode})"
        )


def reset_dev_db(scenario_name: str) -> None:
    run_supabase_command(
        ["db", "reset"], "Resetting local Supabase DB (supabase db reset)"
    )
    run_supabase_command(["start"], "Starting local Supabase stack (supabase start)")

    print(f"\n{'=' * 60}")
    print(f"🚀 Seeding scenario data ({scenario_name})")
    print(f"{'=' * 60}")
    seed_scenario(scenario_name)

    print(f"\n{'=' * 60}")
    print("✅ Dev DB reset and seeding completed!")
    print(f"{'=' * 60}\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Reset local Supabase DB, start the stack, and seed demo data"
    )
    parser.add_argument(
        "scenario",
        nargs="?",
        default="standard_demo",
        help="Name of the scenario directory to seed (default: standard_demo)",
    )
    args = parser.parse_args()

    try:
        reset_dev_db(args.scenario)
    except (RuntimeError, FileNotFoundError, ValueError) as e:
        print(f"\n❌ Error: {e}")
        sys.exit(1)
