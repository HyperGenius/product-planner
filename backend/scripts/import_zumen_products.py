"""
図面管理アプリ「ズメーン」のエクスポート CSV を使い、対象テナントの既存 products の
`code` にズメーンの図番を書き込む 1 回限りのスクリプト（Issue #352 方針転換）。

products のカラムの意味を以下に固定する（カラムリネームは行わない）:
    products.code = ズメーンの「図番」（テナント内で一意な識別子）
    products.name = ズメーンの「品名」

## このスクリプトがやること / やらないこと

ズメーン側・products 側ともに表記の揺れが多く、機械的に完全同期するのは危険なため、
**Tier 1（正規化した完全一致）で突合できた既存 products のみ `code` に図番を書き込む**。

  - やる  : 正規化一致した既存行の `code` を図番（CSV の正規表記）に更新
  - やらない: 品名 (`name`) の同期、CSV にしか無い図番の新規 INSERT、
             曖昧一致（pg_trgm 等）の適用

Tier 1 で一致しなかったものは「必要が発生した段階で個別に更新」する運用とし、
現段階での完全同期は行わない。

## 正規化ルール（両サイドに同じものを適用）

    upper( regexp_replace( normalize(値, NFKC), '\\s', '', 'g' ) )

  - NFKC: 全角英数・記号・カナ幅・全角スペースを標準形へ
  - 空白（半角/全角/タブ）を全除去
  - 大文字化
  - ハイフン・サフィックス（`xA`, `-Gr`, `F` 等）は保持（消すと別製品を誤結合するため）

## 突合と適用の条件

CSV 取り込み対象行 = 図番が非空 かつ 品名が非空 かつ CSV 内で図番が
（下記の正規化キーで）一意。正規化後に同一となる図番（例: `A-001` と `Ａ-００１`）が
複数あると、同じ製品に複数の incoming 行が対応して UPDATE が非決定的になるため、
CSV 側も正規化キーで重複判定して除外する。

各対象行の正規化図番 `zn` について、対象テナントの products を次で突合する:

  - by_code: 既存 `code` の正規化 == `zn`
  - by_name: 既存 `name` の正規化 == `zn`

適用対象（`code` を図番へ更新）とするのは、次をすべて満たす 1:1 対応のみ:

  - `zn` にマッチする既存製品が 1 件だけ（複数マッチは曖昧として除外・レポート）
  - その既存製品にマッチする図番が 1 件だけ（同上）
  - by_code、または（by_name かつ既存 `code` が NULL/空）
    ※ by_name だが `code` が別に設定済みの行は、意図せぬ上書きを避け除外・レポート
  - 図番を `code` に入れても他製品の既存 `code` と衝突しない（衝突は除外・レポート）

## DB 接続

CLAUDE.md「本番 Supabase への接続」に従い `supabase db query --db-url ...`
（session pooler 経由）を用いる。--execute を付けない限り読み取り専用の診断クエリのみ発行する。
本番適用は dry-run レポートをユーザーに提示し、承認を得てから行うこと。

Usage:
    # dry-run（レポートのみ。DB へは SELECT だけ）
    python scripts/import_zumen_products.py \\
        --csv ~/Downloads/zume-n_data_list_202608291337.csv \\
        --tenant-id <uuid> \\
        --db-url "postgresql://postgres.<ref>:<url-encoded-pw>@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres"

    # 本番適用（承認後）
    python scripts/import_zumen_products.py --csv ... --tenant-id <uuid> --db-url "..." --execute
"""

import argparse
import csv
import re
import subprocess
import sys
import tempfile
import unicodedata
import uuid
from collections import Counter
from dataclasses import dataclass

# 突合 SQL は取り込み対象行を 1 文の VALUES (...) に展開する。ズメーンのエクスポートは
# 通常数百件で、その規模なら問題にならないが、想定外に巨大な CSV を 1 文で流し込んで
# 文サイズ・タイムアウト・性能劣化を招かないよう安全弁を設ける。超過時は CSV を分割し、
# 図番の重複がまたがらない単位で複数回に分けて実行すること。
MAX_IMPORTABLE_ROWS = 5000


@dataclass
class Row:
    zuban: str
    hinmei: str
    customer: str
    url: str


@dataclass
class ParsedCsv:
    importable: list[Row]
    empty_zuban: list[Row]
    empty_hinmei: list[Row]  # 図番はあるが品名が空
    dup_groups: dict[str, list[Row]]  # {正規化図番キー: 重複行}


def _sql_str(value: str) -> str:
    """SQL の単一引用符リテラルにエスケープする。"""
    return "'" + value.replace("'", "''") + "'"


def _norm_key(value: str) -> str:
    """_norm() の SQL 正規化（NFKC → 空白除去 → 大文字化）を Python 側で再現する。

    CSV 内で「正規化後に同一」となる図番を重複として検出するために使う。
    SQL 側と同じく NFKC → 空白除去 の順（NFKC で全角スペース等が半角化される）。
    """
    return re.sub(r"\s", "", unicodedata.normalize("NFKC", value)).upper()


def _norm(expr: str) -> str:
    """SQL 式 expr の正規化表現（NFKC → 空白除去 → 大文字化）を返す。"""
    return (
        f"upper(regexp_replace(normalize(coalesce({expr}, ''), NFKC), '\\s', '', 'g'))"
    )


def parse_csv(path: str) -> ParsedCsv:
    """CSV を読み、取り込み対象と各保留カテゴリに振り分ける。"""
    with open(path, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        raw = [
            Row(
                zuban=(r.get("図番") or "").strip(),
                hinmei=(r.get("品名") or "").strip(),
                customer=(r.get("顧客名") or "").strip(),
                url=(r.get("URL") or "").strip(),
            )
            for r in reader
        ]

    empty_zuban = [r for r in raw if not r.zuban]
    with_zuban = [r for r in raw if r.zuban]

    # 生文字列ではなく正規化キーで重複判定する（正規化後に衝突する図番を除外）
    norm_counts = Counter(_norm_key(r.zuban) for r in with_zuban)
    dup_groups: dict[str, list[Row]] = {}
    empty_hinmei: list[Row] = []
    importable: list[Row] = []
    for r in with_zuban:
        key = _norm_key(r.zuban)
        if norm_counts[key] > 1:
            dup_groups.setdefault(key, []).append(r)
        elif not r.hinmei:
            empty_hinmei.append(r)
        else:
            importable.append(r)

    return ParsedCsv(importable, empty_zuban, empty_hinmei, dup_groups)


def _values_clause(rows: list[Row]) -> str:
    """VALUES (zuban, hinmei), ... 本体を組み立てる。"""
    return ",\n    ".join(f"({_sql_str(r.zuban)}, {_sql_str(r.hinmei)})" for r in rows)


def _match_cte(rows: list[Row], tenant_id: str) -> str:
    """突合結果を組み立てる共通 CTE 群（末尾セミコロンなし）。

    公開する名前:
      inc         : CSV 取り込み対象（zuban, hinmei, 正規化 zn）
      prod        : 対象テナントの products（id, code, name, 正規化 cn / nn）
      raw_match   : prod × inc の全マッチ（by_code / by_name フラグ付き）
      amb_zuban   : 1 図番が複数製品にマッチ（曖昧）
      amb_prod    : 1 製品が複数図番にマッチ（曖昧）
      name_code_set : by_name だが既存 code が設定済み（上書き回避で除外）
      good        : 曖昧・上書き回避を除いた 1:1 の適用候補
      conflict    : 図番を code に入れると他製品の既存 code と衝突
      applicable  : 実際に code を更新する対象
    """
    tid = f"'{tenant_id}'::uuid"
    values = _values_clause(rows)
    return f"""\
WITH incoming(zuban, hinmei) AS (
  VALUES
    {values}
),
inc AS (
  SELECT zuban, hinmei, {_norm("zuban")} AS zn
  FROM incoming
),
prod AS (
  SELECT id, code, name,
         {_norm("code")} AS cn,
         {_norm("name")} AS nn
  FROM products
  WHERE tenant_id = {tid}
),
raw_match AS (
  SELECT p.id AS product_id, p.code AS old_code, p.name AS old_name,
         i.zuban, i.hinmei, i.zn,
         (p.cn <> '' AND p.cn = i.zn) AS by_code,
         (p.nn <> '' AND p.nn = i.zn) AS by_name
  FROM prod p
  JOIN inc i
    ON (p.cn <> '' AND p.cn = i.zn)
    OR (p.nn <> '' AND p.nn = i.zn)
),
amb_zuban AS (
  SELECT zn FROM raw_match GROUP BY zn HAVING count(DISTINCT product_id) > 1
),
amb_prod AS (
  SELECT product_id FROM raw_match GROUP BY product_id HAVING count(DISTINCT zn) > 1
),
name_code_set AS (
  SELECT * FROM raw_match
  WHERE by_name AND NOT by_code AND coalesce(old_code, '') <> ''
),
good AS (
  SELECT rm.* FROM raw_match rm
  WHERE rm.zn NOT IN (SELECT zn FROM amb_zuban)
    AND rm.product_id NOT IN (SELECT product_id FROM amb_prod)
    AND (rm.by_code OR coalesce(rm.old_code, '') = '')
),
conflict AS (
  SELECT DISTINCT g.product_id
  FROM good g
  JOIN products p2
    ON p2.tenant_id = {tid} AND p2.id <> g.product_id AND p2.code = g.zuban
),
applicable AS (
  SELECT * FROM good WHERE product_id NOT IN (SELECT product_id FROM conflict)
)"""


def build_diagnostic_sql(rows: list[Row], tenant_id: str) -> str:
    cte = _match_cte(rows, tenant_id)
    return (
        "\n\n".join(
            [
                f"""\
-- === サマリ ===
{cte}
SELECT
  (SELECT count(*) FROM applicable)                       AS will_update_code,
  (SELECT count(*) FROM applicable WHERE by_code)         AS  _via_code_match,
  (SELECT count(*) FROM applicable WHERE NOT by_code)     AS  _via_name_match,
  (SELECT count(DISTINCT zn) FROM amb_zuban)              AS ambiguous_zuban,
  (SELECT count(DISTINCT product_id) FROM amb_prod)       AS ambiguous_product,
  (SELECT count(*) FROM name_code_set)                    AS name_match_but_code_set,
  (SELECT count(*) FROM conflict)                         AS code_conflict,
  (SELECT count(*) FROM inc WHERE zn NOT IN (SELECT zn FROM raw_match)) AS csv_unmatched,
  (SELECT count(*) FROM prod WHERE id NOT IN (SELECT product_id FROM raw_match)) AS existing_unmatched;""",
                f"""\
-- === code を更新する対象（old_code -> new_code。name は変更しない） ===
{cte}
SELECT product_id, old_code, new_code, csv_hinmei, current_name, match_kind
FROM (
  SELECT product_id, old_code, zuban AS new_code, hinmei AS csv_hinmei,
         old_name AS current_name,
         CASE WHEN by_code THEN 'code' ELSE 'name' END AS match_kind
  FROM applicable
) s
ORDER BY match_kind, product_id;""",
                f"""\
-- === 曖昧: 1 図番が複数の既存製品にマッチ（適用しない・要確認） ===
{cte}
SELECT rm.zn, rm.zuban, rm.product_id, rm.old_code, rm.old_name
FROM raw_match rm
WHERE rm.zn IN (SELECT zn FROM amb_zuban)
ORDER BY rm.zn, rm.product_id;""",
                f"""\
-- === 曖昧: 1 既存製品が複数の図番にマッチ（適用しない・要確認） ===
{cte}
SELECT rm.product_id, rm.old_code, rm.old_name, rm.zuban
FROM raw_match rm
WHERE rm.product_id IN (SELECT product_id FROM amb_prod)
ORDER BY rm.product_id, rm.zuban;""",
                f"""\
-- === name が図番と一致するが code が別に設定済み（上書き回避・要確認） ===
{cte}
SELECT product_id, old_code, old_name, zuban AS csv_zuban, hinmei AS csv_hinmei
FROM name_code_set
ORDER BY product_id;""",
                f"""\
-- === 図番を code に入れると他製品の既存 code と衝突（適用しない・要確認） ===
{cte}
SELECT g.product_id, g.old_code, g.old_name, g.zuban AS would_be_code
FROM good g
WHERE g.product_id IN (SELECT product_id FROM conflict)
ORDER BY g.product_id;""",
                f"""\
-- === CSV にあるが既存製品と突合できなかった図番（今回は取り込まない） ===
{cte}
SELECT i.zuban, i.hinmei
FROM inc i
WHERE i.zn NOT IN (SELECT zn FROM raw_match)
ORDER BY i.zuban;""",
                f"""\
-- === CSV と突合できなかった既存製品（変更しない・参考） ===
{cte}
SELECT p.id, p.code, p.name
FROM prod p
WHERE p.id NOT IN (SELECT product_id FROM raw_match)
ORDER BY p.code NULLS FIRST, p.name;""",
            ]
        )
        + "\n"
    )


def build_apply_sql(rows: list[Row], tenant_id: str) -> str:
    cte = _match_cte(rows, tenant_id)
    return f"""\
BEGIN;

{cte}
UPDATE products p
SET code = a.zuban
FROM applicable a
WHERE p.id = a.product_id
  AND p.code IS DISTINCT FROM a.zuban;

COMMIT;
"""


def run_query(db_url: str, sql: str) -> None:
    """supabase db query を実行し、結果をそのまま標準出力へ流す。"""
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".sql", encoding="utf-8", delete=True
    ) as tf:
        tf.write(sql)
        tf.flush()
        print(
            f"\n$ supabase db query --db-url <hidden> -f <tmp.sql ({len(sql)} chars)>\n"
        )
        result = subprocess.run(
            ["supabase", "db", "query", "--db-url", db_url, "-f", tf.name],
            check=False,
        )
    if result.returncode != 0:
        print(f"\n✗ supabase db query が終了コード {result.returncode} で失敗しました")
        sys.exit(result.returncode)


def print_skip_report(parsed: ParsedCsv) -> None:
    print("\n──────── 取り込み対象から外れた CSV 行（参考） ────────")
    print(f"\n[図番が空] {len(parsed.empty_zuban)} 件")
    for r in parsed.empty_zuban:
        print(f"  - 顧客={r.customer!r} 品名={r.hinmei!r} {r.url}")

    print(f"\n[図番はあるが品名が空] {len(parsed.empty_hinmei)} 件")
    for r in parsed.empty_hinmei:
        print(f"  - 顧客={r.customer!r} 図番={r.zuban!r} {r.url}")

    dup_rows = sum(len(v) for v in parsed.dup_groups.values())
    print(
        f"\n[CSV 内で図番が重複（正規化後）] {len(parsed.dup_groups)} グループ / {dup_rows} 行"
    )
    for key, rows in sorted(parsed.dup_groups.items()):
        variants = sorted({r.zuban for r in rows})
        print(f"  正規化キー={key!r} ×{len(rows)}  実表記={variants}")
        for r in rows:
            print(
                f"      顧客={r.customer!r} 図番={r.zuban!r} 品名={r.hinmei!r} {r.url}"
            )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", required=True, help="ズメーンのエクスポート CSV パス")
    parser.add_argument("--tenant-id", required=True, help="対象テナントの UUID")
    parser.add_argument(
        "--db-url",
        required=True,
        help="session pooler の接続 URL（CLAUDE.md 参照。パスワードは percent-encode）",
    )
    parser.add_argument(
        "--execute",
        action="store_true",
        help="指定時のみ UPDATE を実行する（既定は dry-run＝SELECT のみ）",
    )
    args = parser.parse_args()

    try:
        uuid.UUID(args.tenant_id)
    except ValueError:
        parser.error(f"--tenant-id が UUID 形式ではありません: {args.tenant_id!r}")

    parsed = parse_csv(args.csv)
    importable = parsed.importable

    print("======== ズメーン CSV 突合サマリ ========")
    print(f"CSV: {args.csv}")
    print(f"対象テナント: {args.tenant_id}")
    print(f"突合候補（図番・品名あり・図番一意）: {len(importable)} 行")
    print(f"図番が空: {len(parsed.empty_zuban)} 行")
    print(f"図番はあるが品名が空: {len(parsed.empty_hinmei)} 行")
    print(
        f"図番重複: {len(parsed.dup_groups)} グループ / "
        f"{sum(len(v) for v in parsed.dup_groups.values())} 行"
    )

    print_skip_report(parsed)

    if not importable:
        print("\n突合候補が 0 行です。終了します。")
        return

    if len(importable) > MAX_IMPORTABLE_ROWS:
        sys.exit(
            f"突合候補が {len(importable)} 行あり、上限 {MAX_IMPORTABLE_ROWS} を超えています。"
            " 1 文の SQL が過大になるため、CSV を分割し"
            "（同じ図番が別ファイルにまたがらないように）複数回に分けて実行してください。"
        )

    print("\n──────── DB 現状に対する診断（読み取りのみ） ────────")
    run_query(args.db_url, build_diagnostic_sql(importable, args.tenant_id))

    if not args.execute:
        print(
            "\n[dry-run] --execute が無いため書き込みは行いませんでした。\n"
            "上記レポートを確認・承認のうえ、--execute を付けて再実行してください。"
        )
        return

    print("\n──────── code の更新を実行します（--execute） ────────")
    run_query(args.db_url, build_apply_sql(importable, args.tenant_id))
    print("\n✓ 完了。products を SELECT して結果を目視確認してください。")


if __name__ == "__main__":
    main()
