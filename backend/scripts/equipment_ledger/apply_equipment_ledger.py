"""
設備台帳（顧客の正典）を設備マスタ `equipments` に反映する運用スクリプト (Issue #486)。

台帳の実データ（製造番号等）はリポジトリに含めない。手元の CSV（`_data/` 配下は git 管理外）を
読み込んで反映する。

反映ルール:
  - 既存レコードは `id` を維持したまま `name` を台帳の名称に更新し、台帳の列を埋める
    （`production_schedules.equipment_id` / `equipment_group_members` の参照を壊さない）
  - 既存レコードと台帳の対応は次の優先順で決める
      1. 既に `ledger_no` が設定済みの設備（再実行・中断後の再実行で同じ設備に当たる）
      2. 対応表（--mapping）の「旧名称 → 台帳番号」
      3. 台帳の名称と同名で `ledger_no` 未設定の設備（該当が1台だけで、台帳にもその名称が1行だけの
         場合に限る。同名の設備が複数あると決められないので対応表での指定を求める）
  - どれにも当たらない台帳の設備は新規登録する（設備グループには所属させない）
  - 台帳に無い既存設備（「汎用設備グループ」等）は変更しない（`ledger_no` は NULL のまま）
  - 呼称 `short_name` は、既に設定済み（画面での手動設定を含む）なら変更しない。未設定なら
    台帳 CSV の `short_name` 列（任意）を設定し、それも無く台帳の名称に変わる設備は旧名称（対応表の
    `current_name`。無ければ現在の設備名）を呼称として残す。画面表示は呼称が優先されるため、
    長い正式名称で表示が冗長にならない
  - 設備名 `name` は一意ではない（台帳に同名の設備がある。Issue #501）。一意なのは表示名
    `COALESCE(short_name, name)` なので、同名の設備を新規登録するときは台帳 CSV の `short_name` 列で
    呼称を指定する（指定しないと表示名の重複でエラーにする）
  - 設備と同名（旧名称・台帳の名称・呼称のいずれか）でメンバーがその設備1台だけの設備グループは、
    設備の表示名（呼称、無ければ台帳の名称）に名称を揃える（初期移行で設備ごとに同名のグループを
    作っているため。ガントチャートはグループ名を表示する）。グループ構成は変更しない。
    旧版のスクリプトで台帳の名称に変えてしまったグループは、再実行で呼称に戻る

`equipments` は表示名 `(tenant_id, COALESCE(short_name, name))`、`equipment_groups` は
`(tenant_id, name)` が UNIQUE のため、表示名・グループ名の入れ替え（A→B, B→A）や玉突きは
一時名（`__ledger_tmp__<id>`。設備は呼称に入れる）を経由して反映する。設備の名称と呼称は
1回の UPDATE でまとめて書き込む（表示名が変わらない名称変更は一時名を経由しない）。

CSV（UTF-8。Excel の BOM 付きも可）:
  台帳 (--csv):      ledger_no,name,maker,model,manufactured_on,serial_no,note[,short_name]
  対応表 (--mapping): current_name,ledger_no

Usage:
    python scripts/equipment_ledger/apply_equipment_ledger.py \\
        --tenant-id <uuid> \\
        --csv scripts/equipment_ledger/_data/ledger.csv \\
        --mapping scripts/equipment_ledger/_data/mapping.csv \\
        [--dry-run] [--env-file PATH]

環境変数 (--env-file 指定ファイル、無ければ backend/.env):
    SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY   # 運用スクリプトのため service role で接続し、tenant_id で明示的に絞る
"""

import argparse
import csv
import os
import sys
import uuid
from collections import Counter
from dataclasses import dataclass, field
from typing import Any, cast

from dotenv import load_dotenv

from supabase import Client, create_client  # type: ignore

TEMP_NAME_PREFIX = "__ledger_tmp__"

# 台帳から equipments へ反映する列
LEDGER_FIELDS = (
    "ledger_no",
    "name",
    "maker",
    "model",
    "manufactured_on",
    "serial_no",
    "note",
)
# 台帳 CSV の列。short_name（呼称）は任意で、呼称が未設定の設備にだけ設定する
LEDGER_CSV_COLUMNS = (*LEDGER_FIELDS, "short_name")
MAPPING_CSV_COLUMNS = ("current_name", "ledger_no")

_EQUIPMENT_SELECT = "id, short_name, " + ", ".join(LEDGER_FIELDS)


class LedgerError(Exception):
    """CLI の利用者に表示するエラー（スタックトレースを出さずに終了する）。"""


@dataclass(frozen=True)
class LedgerEntry:
    """設備台帳の1行"""

    ledger_no: int
    name: str
    maker: str | None = None
    model: str | None = None
    manufactured_on: str | None = None
    serial_no: str | None = None
    note: str | None = None
    short_name: str | None = None

    def as_fields(self) -> dict[str, Any]:
        """台帳の列（呼称を含まない）"""
        return {f: getattr(self, f) for f in LEDGER_FIELDS}

    @property
    def display_name(self) -> str:
        return self.short_name or self.name


@dataclass
class EquipmentChange:
    """既存設備への変更（`changes` は変わる列だけ）"""

    id: int
    current_name: str
    changes: dict[str, Any]


@dataclass
class LedgerPlan:
    """台帳反映の計画。`build_plan()` が作り、`apply_plan()` が実行する。"""

    updates: list[EquipmentChange] = field(default_factory=list)
    inserts: list[LedgerEntry] = field(default_factory=list)
    # (設備ID, 書き込む name / short_name) を実行順に並べたもの（呼称に一時名を経由する場合を含む）
    equipment_name_steps: list[tuple[int, dict[str, Any]]] = field(default_factory=list)
    # グループID → (旧名称, 新名称)
    group_renames: dict[int, tuple[str, str]] = field(default_factory=dict)
    group_rename_steps: list[tuple[int, str]] = field(default_factory=list)
    # 台帳に対応が無く、変更しない既存設備の名称
    untouched_equipments: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def has_changes(self) -> bool:
        return bool(self.updates or self.inserts or self.group_rename_steps)


# ---------------------------------------------------------------------------
# CSV 読み込み
# ---------------------------------------------------------------------------


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


def _parse_ledger_no(value: str | None, where: str) -> int:
    cleaned = _clean(value)
    if cleaned is None:
        raise LedgerError(f"{where}: ledger_no が空です")
    try:
        ledger_no = int(cleaned)
    except ValueError as e:
        raise LedgerError(f"{where}: ledger_no が整数ではありません: {cleaned}") from e
    if ledger_no < 1:
        raise LedgerError(f"{where}: ledger_no は 1 以上にしてください: {ledger_no}")
    return ledger_no


def _read_csv_rows(path: str, required: tuple[str, ...]) -> list[dict[str, str]]:
    if not os.path.exists(path):
        raise LedgerError(f"CSV が見つかりません: {path}")
    # utf-8-sig: Excel で保存した BOM 付き CSV も読めるようにする
    with open(path, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        header = [h.strip() for h in (reader.fieldnames or [])]
        missing = [c for c in required if c not in header]
        if missing:
            raise LedgerError(f"{path}: 必須の列がありません: {', '.join(missing)}")
        return [
            {(k or "").strip(): v for k, v in row.items()}
            for row in reader
            if any(_clean(v) for v in row.values() if isinstance(v, str))
        ]


def load_ledger_csv(path: str) -> list[LedgerEntry]:
    """台帳 CSV を読み込む。台帳番号の重複はエラー（名称は同名の設備があるため重複してよい）。"""
    entries: list[LedgerEntry] = []
    for i, row in enumerate(_read_csv_rows(path, ("ledger_no", "name")), start=2):
        where = f"{os.path.basename(path)} {i}行目"
        name = _clean(row.get("name"))
        if name is None:
            raise LedgerError(f"{where}: name が空です")
        short_name = _clean(row.get("short_name"))
        if name.startswith(TEMP_NAME_PREFIX) or (
            short_name and short_name.startswith(TEMP_NAME_PREFIX)
        ):
            raise LedgerError(
                f"{where}: name / short_name に {TEMP_NAME_PREFIX} は使えません"
            )
        entries.append(
            LedgerEntry(
                ledger_no=_parse_ledger_no(row.get("ledger_no"), where),
                name=name,
                maker=_clean(row.get("maker")),
                model=_clean(row.get("model")),
                manufactured_on=_clean(row.get("manufactured_on")),
                serial_no=_clean(row.get("serial_no")),
                note=_clean(row.get("note")),
                short_name=short_name,
            )
        )
    _raise_if_duplicated([e.ledger_no for e in entries], "台帳の ledger_no")
    return entries


def load_mapping_csv(path: str) -> dict[int, str]:
    """対応表 CSV（旧名称 → 台帳番号）を読み込み、台帳番号 → 旧名称 で返す。"""
    pairs: list[tuple[str, int]] = []
    for i, row in enumerate(_read_csv_rows(path, MAPPING_CSV_COLUMNS), start=2):
        where = f"{os.path.basename(path)} {i}行目"
        current_name = _clean(row.get("current_name"))
        if current_name is None:
            raise LedgerError(f"{where}: current_name が空です")
        pairs.append((current_name, _parse_ledger_no(row.get("ledger_no"), where)))
    _raise_if_duplicated([n for n, _ in pairs], "対応表の current_name")
    _raise_if_duplicated([no for _, no in pairs], "対応表の ledger_no")
    return {no: name for name, no in pairs}


def _raise_if_duplicated(values: list[Any], label: str) -> None:
    duplicated = [str(v) for v, c in Counter(values).items() if c > 1]
    if duplicated:
        raise LedgerError(f"{label} が重複しています: {', '.join(duplicated)}")


# ---------------------------------------------------------------------------
# 計画
# ---------------------------------------------------------------------------


def order_renames(
    current_names: dict[int, str], targets: dict[int, str]
) -> list[tuple[int, str]]:
    """UNIQUE（設備は表示名、グループは名称）を途中で踏まない名称変更の実行順を返す。

    変更先の名前を（変更対象の）別レコードが現に使っている場合だけ、先に一時名へ退避する。
    退避しないものを先に反映して名前を空けてから、退避したものを最終名へ反映する。
    変更先が変更対象外のレコードの名前と衝突する場合は `build_plan()` がエラーにする前提。
    """
    moving = {i: name for i, name in targets.items() if current_names[i] != name}
    owner = {name: i for i, name in current_names.items()}
    blocked = [i for i, name in moving.items() if owner.get(name, i) != i]
    blocked_set = set(blocked)
    steps = [(i, f"{TEMP_NAME_PREFIX}{i}") for i in blocked]
    steps += [(i, name) for i, name in moving.items() if i not in blocked_set]
    steps += [(i, moving[i]) for i in blocked]
    return steps


def _duplicated_final_names(
    current_names: dict[int, str], targets: dict[int, str], extra: list[str]
) -> list[str]:
    final = [targets.get(i, name) for i, name in current_names.items()] + extra
    return [n for n, c in Counter(final).items() if c > 1]


Matched = list[tuple[LedgerEntry, dict[str, Any]]]


def _display_name(equipment: dict[str, Any]) -> str:
    """表示名（呼称、無ければ設備名）。DB の UNIQUE (tenant_id, COALESCE(short_name, name)) と揃える"""
    return equipment.get("short_name") or equipment["name"]


def _find_by_name(name: str, equipments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """対応表の旧名称に当たる設備。表示名の一致（一意）を優先し、無ければ設備名の一致（複数あり得る）"""
    by_display = [e for e in equipments if _display_name(e) == name]
    return by_display or [e for e in equipments if e["name"] == name]


def _resolve_equipment(
    entry: LedgerEntry,
    mapping: dict[int, str],
    by_ledger: dict[int, dict[str, Any]],
    equipments: list[dict[str, Any]],
    ledger_name_counts: Counter[str],
    errors: list[str],
) -> dict[str, Any] | None:
    """台帳の1行に対応する既存設備を決める（モジュール docstring の優先順）。無ければ None"""
    no = entry.ledger_no
    linked = by_ledger.get(no)
    if no not in mapping:
        if linked:
            return linked
        same_name = [
            e for e in equipments if e["name"] == entry.name and not e.get("ledger_no")
        ]
        if not same_name:
            return None
        if len(same_name) > 1 or ledger_name_counts[entry.name] > 1:
            errors.append(
                f"台帳番号 {no}（{entry.name}）に対応する既存の設備を名称から決められません"
                "（同名の設備が複数あります）。対応表で指定してください"
            )
            return None
        return same_name[0]

    old_name = mapping[no]
    named = _find_by_name(old_name, equipments)
    if linked:
        if named and all(e["id"] != linked["id"] for e in named):
            errors.append(
                f"台帳番号 {no} は既に設備「{_display_name(linked)}」に設定済みですが、"
                f"対応表では「{old_name}」が指定されています"
            )
        return linked
    if not named:
        errors.append(
            f"対応表の設備「{old_name}」（台帳番号 {no}）が設備マスタにありません"
        )
        return None
    if len(named) > 1:
        errors.append(
            f"対応表の設備「{old_name}」（台帳番号 {no}）に当たる設備が複数あります。"
            "同名の設備は呼称で指定してください"
        )
        return None
    if named[0].get("ledger_no"):
        errors.append(
            f"設備「{old_name}」は既に台帳番号 {named[0]['ledger_no']} に"
            f"対応付け済みです（対応表では {no}）"
        )
    return named[0]


def _match_ledger(
    ledger: list[LedgerEntry],
    mapping: dict[int, str],
    equipments: list[dict[str, Any]],
    errors: list[str],
) -> Matched:
    by_ledger = {e["ledger_no"]: e for e in equipments if e.get("ledger_no")}
    ledger_name_counts = Counter(e.name for e in ledger)
    matched: Matched = []
    matched_ids: set[int] = set()
    for entry in ledger:
        eq = _resolve_equipment(
            entry, mapping, by_ledger, equipments, ledger_name_counts, errors
        )
        if eq is None:
            continue
        if eq["id"] in matched_ids:
            errors.append(
                f"設備「{_display_name(eq)}」が複数の台帳番号に対応付けられています"
            )
            continue
        matched_ids.add(eq["id"])
        matched.append((entry, eq))
    return matched


def _final_short_name(
    entry: LedgerEntry, eq: dict[str, Any], mapping: dict[int, str]
) -> str | None:
    """反映後の呼称。

    設定済みの呼称は上書きしない（中断で一時名のまま残った呼称は未設定とみなす）。未設定なら台帳 CSV の
    呼称、それも無く台帳の名称に変わる設備は旧名称を呼称にする。旧名称は対応表の旧名称を優先する
    （旧版のスクリプトで設備名が既に台帳の名称へ変わった後の再実行でも、対応表から旧名称を復元できる）。
    """
    current = eq.get("short_name")
    if current and not current.startswith(TEMP_NAME_PREFIX):
        return current
    if entry.short_name:
        return entry.short_name
    old_name = mapping.get(entry.ledger_no) or eq["name"]
    if old_name == entry.name or old_name.startswith(TEMP_NAME_PREFIX):
        return None
    return old_name


def _equipment_name_steps(
    equipments: list[dict[str, Any]], targets: dict[int, dict[str, Any]]
) -> list[tuple[int, dict[str, Any]]]:
    """設備の name / short_name を書き込む順序。表示名の UNIQUE を途中で踏まないようにする。

    表示名が変わらない設備はいつ書いても衝突しないので先に書く。表示名が変わる設備は
    `order_renames()` の順に従い、退避が必要なものは呼称に一時名を入れてから最終値を書く。
    """
    by_id = {e["id"]: e for e in equipments}
    current = {e["id"]: _display_name(e) for e in equipments}
    final = {
        i: f.get("short_name", by_id[i].get("short_name"))
        or f.get("name", by_id[i]["name"])
        for i, f in targets.items()
    }
    steps = [(i, f) for i, f in targets.items() if current[i] == final[i]]
    parked: set[int] = set()
    for i, display in order_renames(current, final):
        if display.startswith(TEMP_NAME_PREFIX):
            parked.add(i)
            steps.append((i, {"short_name": display}))
        elif i in parked:
            # 一時名を入れた呼称を必ず戻す（呼称が変わらない設備でも書く）
            short_name = targets[i].get("short_name", by_id[i].get("short_name"))
            steps.append((i, {**targets[i], "short_name": short_name}))
        else:
            steps.append((i, targets[i]))
    return steps


def _group_rename_targets(
    matched: Matched,
    mapping: dict[int, str],
    groups: list[dict[str, Any]],
    short_names: dict[int, str | None],
    errors: list[str],
) -> dict[int, str]:
    """設備と同名でメンバーがその設備1台だけのグループ → 設備の表示名（呼称、無ければ台帳の名称）"""
    targets: dict[int, str] = {}
    for entry, eq in matched:
        target = short_names.get(eq["id"]) or entry.name
        # 同名とみなすのは「現在の設備名」「対応表の旧名称」（中断後の再実行で設備名だけ先に
        # 変わっている場合）「台帳の名称」（旧版のスクリプトでグループ名を台帳の名称に変えた場合）
        # 「呼称」。一時名のまま中断したグループも拾う
        candidates = {
            eq["name"],
            mapping.get(entry.ledger_no),
            entry.name,
            short_names.get(eq["id"]),
        }
        solo_groups = [
            g
            for g in groups
            if set(g.get("member_ids") or ()) == {eq["id"]}
            and g["name"] != target
            and (g["name"] in candidates or g["name"].startswith(TEMP_NAME_PREFIX))
        ]
        if len(solo_groups) > 1:
            errors.append(
                f"設備「{eq['name']}」と同名の1台グループが複数あります: "
                + ", ".join(g["name"] for g in solo_groups)
            )
        elif solo_groups:
            targets[solo_groups[0]["id"]] = target
    return targets


def build_plan(
    ledger: list[LedgerEntry],
    mapping: dict[int, str],
    equipments: list[dict[str, Any]],
    groups: list[dict[str, Any]],
) -> LedgerPlan:
    """台帳・対応表・現在の設備/グループから反映計画を作る（DB には触らない）。

    Args:
        ledger: 台帳の行
        mapping: 台帳番号 → 既存設備の旧名称
        equipments: 現在の設備（id, name と台帳の列）
        groups: 現在の設備グループ（id, name, member_ids: set[int]）
    """
    errors: list[str] = []
    plan = LedgerPlan()
    ledger_nos = {e.ledger_no for e in ledger}

    errors += [
        f"対応表の台帳番号 {no}（{name}）が台帳にありません"
        for no, name in mapping.items()
        if no not in ledger_nos
    ]
    matched = _match_ledger(ledger, mapping, equipments, errors)
    matched_ids = {eq["id"] for _, eq in matched}
    matched_nos = {entry.ledger_no for entry, _ in matched}

    plan.warnings = [
        f"設備「{_display_name(eq)}」の台帳番号 {eq['ledger_no']} は台帳にありません（変更しません）"
        for eq in equipments
        if eq.get("ledger_no") and eq["ledger_no"] not in ledger_nos
    ]
    plan.inserts = [e for e in ledger if e.ledger_no not in matched_nos]
    plan.untouched_equipments = sorted(
        _display_name(e) for e in equipments if e["id"] not in matched_ids
    )

    # --- 設備の更新と名称・呼称の変更 ---
    # 反映後の呼称（設備ID → 呼称）
    short_names: dict[int, str | None] = {
        e["id"]: e.get("short_name") for e in equipments
    }
    final_names = {e["id"]: e["name"] for e in equipments}
    name_targets: dict[int, dict[str, Any]] = {}
    for entry, eq in matched:
        changes = {k: v for k, v in entry.as_fields().items() if eq.get(k) != v}
        short_name = _final_short_name(entry, eq, mapping)
        short_names[eq["id"]] = short_name
        if short_name != eq.get("short_name"):
            changes["short_name"] = short_name
        if changes:
            plan.updates.append(EquipmentChange(eq["id"], eq["name"], changes))
        if "name" in changes:
            final_names[eq["id"]] = entry.name
        name_fields = {k: v for k, v in changes.items() if k in ("name", "short_name")}
        if name_fields:
            name_targets[eq["id"]] = name_fields

    final_display_names = [
        short_names[i] or name for i, name in final_names.items()
    ] + [e.display_name for e in plan.inserts]
    errors += [
        f"反映後に設備の表示名（呼称、無ければ設備名）「{name}」が重複します"
        "（同名の設備は台帳 CSV の short_name 列で呼称を指定してください。台帳に対応しない"
        "既存設備や設定済みの呼称と重なる場合は対応表・呼称を見直してください）"
        for name, count in Counter(final_display_names).items()
        if count > 1
    ]

    # --- 1対1の同名設備グループの名称変更 ---
    group_current = {g["id"]: g["name"] for g in groups}
    group_targets = _group_rename_targets(matched, mapping, groups, short_names, errors)
    errors += [
        f"反映後に設備グループ名「{name}」が重複します（既に別のグループがその名前を使っています）"
        for name in _duplicated_final_names(group_current, group_targets, [])
    ]

    if errors:
        raise LedgerError("台帳を反映できません:\n  - " + "\n  - ".join(errors))

    plan.equipment_name_steps = _equipment_name_steps(equipments, name_targets)
    plan.group_renames = {
        gid: (group_current[gid], name) for gid, name in group_targets.items()
    }
    plan.group_rename_steps = order_renames(group_current, group_targets)
    return plan


def format_plan(plan: LedgerPlan) -> str:
    """計画を人が読める形にする（--dry-run の出力）"""
    lines: list[str] = []
    lines.append(f"■ 既存設備の更新: {len(plan.updates)} 件")
    for u in plan.updates:
        new_name = u.changes.get("name")
        title = f"{u.current_name} → {new_name}" if new_name else u.current_name
        lines.append(f"  - [id={u.id}] {title}")
        for k, v in u.changes.items():
            if k == "short_name":
                lines.append(f"      short_name（呼称）: {v}")
            elif k != "name":
                lines.append(f"      {k}: {v}")
    lines.append(f"■ 新規登録: {len(plan.inserts)} 件")
    for e in plan.inserts:
        short_name = f"（呼称: {e.short_name}）" if e.short_name else ""
        lines.append(f"  - [台帳番号 {e.ledger_no}] {e.name}{short_name}")
    if plan.inserts:
        lines.append(
            "    ※ 新規登録した設備はどの設備グループにも属しません。"
            "工程で使う場合は設備マスタ画面でグループに追加してください"
        )
    lines.append(
        f"■ 設備グループの名称変更（1台だけの同名グループを呼称に揃える）: {len(plan.group_renames)} 件"
    )
    for gid, (old, new) in plan.group_renames.items():
        lines.append(f"  - [id={gid}] {old} → {new}")
    lines.append(
        f"■ 台帳に対応が無く変更しない設備: {len(plan.untouched_equipments)} 件"
    )
    for name in plan.untouched_equipments:
        lines.append(f"  - {name}")
    for w in plan.warnings:
        lines.append(f"⚠️  {w}")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# DB
# ---------------------------------------------------------------------------


def fetch_current_state(
    client: Client, tenant_id: str
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """テナントの設備と設備グループ（member_ids 付き）を取得する"""
    eq_res = (
        client.table("equipments")
        .select(_EQUIPMENT_SELECT)
        .eq("tenant_id", tenant_id)
        .execute()
    )
    group_res = (
        client.table("equipment_groups")
        .select("id, name, equipment_group_members(equipment_id)")
        .eq("tenant_id", tenant_id)
        .execute()
    )
    groups = [
        {
            "id": g["id"],
            "name": g["name"],
            "member_ids": {
                m["equipment_id"] for m in (g.get("equipment_group_members") or [])
            },
        }
        for g in cast(list[dict[str, Any]], group_res.data or [])
    ]
    return cast(list[dict[str, Any]], eq_res.data or []), groups


def apply_plan(client: Client, tenant_id: str, plan: LedgerPlan) -> None:
    """計画を反映する。

    PostgREST 経由のためトランザクションにはならない。途中で失敗しても再実行で続きから
    反映できるよう、台帳番号を先に書き込み（再実行時は台帳番号で同じ設備に当たる）、
    名称変更はその後に行う。
    """
    equipments = client.table("equipments")
    groups = client.table("equipment_groups")

    # 1. 台帳番号・台帳の列（名称・呼称以外）
    for u in plan.updates:
        fields = {k: v for k, v in u.changes.items() if k not in ("name", "short_name")}
        if fields:
            equipments.update(fields).eq("id", u.id).eq(
                "tenant_id", tenant_id
            ).execute()

    # 2. 設備名・呼称（表示名の UNIQUE を踏まないよう一時名を経由する順序）
    for eq_id, fields in plan.equipment_name_steps:
        equipments.update(fields).eq("id", eq_id).eq("tenant_id", tenant_id).execute()

    # 3. 台帳にあってマスタに無い設備。1台グループは equipments の INSERT トリガーが作る（Issue #512）
    if plan.inserts:
        equipments.insert(
            [
                {**e.as_fields(), "short_name": e.short_name, "tenant_id": tenant_id}
                for e in plan.inserts
            ]
        ).execute()

    # 4. 1台だけの同名設備グループ
    for group_id, name in plan.group_rename_steps:
        groups.update({"name": name}).eq("id", group_id).eq(
            "tenant_id", tenant_id
        ).execute()


def _get_admin_client() -> Client:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    missing = [
        name
        for name, val in [("SUPABASE_URL", url), ("SUPABASE_SERVICE_ROLE_KEY", key)]
        if not val
    ]
    if missing:
        raise LedgerError(f"環境変数が設定されていません: {', '.join(missing)}")
    return create_client(cast(str, url), cast(str, key))


def _validate_tenant(client: Client, tenant_id: str) -> None:
    try:
        uuid.UUID(tenant_id)
    except ValueError as e:
        raise LedgerError(f"テナント ID が UUID 形式ではありません: {tenant_id}") from e
    res = client.table("tenants").select("id").eq("id", tenant_id).execute()
    if not res.data:
        raise LedgerError(f"テナントが見つかりません: {tenant_id}")


def run(args: argparse.Namespace, client: Client | None = None) -> LedgerPlan:
    ledger = load_ledger_csv(args.csv)
    mapping = load_mapping_csv(args.mapping) if args.mapping else {}
    client = client or _get_admin_client()
    _validate_tenant(client, args.tenant_id)

    equipments, groups = fetch_current_state(client, args.tenant_id)
    plan = build_plan(ledger, mapping, equipments, groups)
    print(format_plan(plan))

    if args.dry_run:
        print("\n(--dry-run のため反映していません)")
    elif not plan.has_changes:
        print("\n変更はありません")
    else:
        apply_plan(client, args.tenant_id, plan)
        print("\n✅ 反映しました")
    return plan


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        description="設備台帳 CSV を設備マスタに反映する (Issue #486)"
    )
    parser.add_argument("--tenant-id", required=True, help="反映先テナントの UUID")
    parser.add_argument("--csv", required=True, help="設備台帳 CSV のパス")
    parser.add_argument(
        "--mapping",
        help="対応表 CSV（current_name,ledger_no）のパス。省略時は同名のみ対応付け",
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="変更内容を表示するだけで反映しない"
    )
    parser.add_argument("--env-file", help="環境変数ファイル（既定: backend/.env）")
    args = parser.parse_args(argv)

    load_dotenv(
        args.env_file
        or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".env")
    )
    try:
        run(args)
    except LedgerError as e:
        print(f"エラー: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
