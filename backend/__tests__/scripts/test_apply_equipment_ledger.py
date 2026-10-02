"""
apply_equipment_ledger.py のユニットテスト (Issue #486)

呼称（short_name）の引き継ぎ・同名の設備（Issue #501）も含む。計画（build_plan）は純粋関数なので、
計画をインメモリの設備・グループに順に適用する簡易シミュレータで「id が維持される」
「UNIQUE（設備は表示名 COALESCE(short_name, name)、グループは名称）を途中で踏まない」
「再実行で変更が出ない（冪等）」を確認する。フィクスチャは全てダミー値。
"""

import argparse
import sys
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.equipment_ledger.apply_equipment_ledger import (
    TEMP_NAME_PREFIX,
    LedgerEntry,
    LedgerError,
    LedgerPlan,
    apply_plan,
    build_plan,
    load_ledger_csv,
    load_mapping_csv,
    order_renames,
    run,
)

TENANT_ID = "00000000-0000-0000-0000-000000000001"


def _eq(id_: int, name: str, **ledger: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "id": id_,
        "name": name,
        "short_name": None,
        "ledger_no": None,
        "maker": None,
        "model": None,
        "manufactured_on": None,
        "serial_no": None,
        "note": None,
    }
    return {**base, **ledger}


def _group(id_: int, name: str, *member_ids: int) -> dict[str, Any]:
    return {"id": id_, "name": name, "member_ids": set(member_ids)}


def _simulate(
    plan: LedgerPlan,
    equipments: list[dict[str, Any]],
    groups: list[dict[str, Any]],
) -> None:
    """apply_plan と同じ順序でインメモリに適用し、各ステップで UNIQUE を検証する"""
    by_id = {e["id"]: e for e in equipments}

    def assert_unique(names: list[str]) -> None:
        assert len(names) == len(set(names)), names

    def assert_unique_display_names() -> None:
        assert_unique([e.get("short_name") or e["name"] for e in equipments])

    for u in plan.updates:
        by_id[u.id].update(
            {k: v for k, v in u.changes.items() if k not in ("name", "short_name")}
        )
    for eq_id, fields in plan.equipment_name_steps:
        by_id[eq_id].update(fields)
        assert_unique_display_names()
    next_id = max(by_id, default=0) + 1
    for entry in plan.inserts:
        equipments.append(
            {"id": next_id, **entry.as_fields(), "short_name": entry.short_name}
        )
        next_id += 1
        assert_unique_display_names()
    group_by_id = {g["id"]: g for g in groups}
    for group_id, name in plan.group_rename_steps:
        group_by_id[group_id]["name"] = name
        assert_unique([g["name"] for g in groups])


LEDGER = [
    LedgerEntry(1, "15t 1号機", maker="メーカーA", model="M-15", serial_no="S-1"),
    LedgerEntry(2, "15t 2号機", maker="メーカーA", model="M-15", serial_no="S-2"),
    LedgerEntry(3, "30t 3号機", maker="メーカーB", manufactured_on="S.53年11月"),
]


class TestBuildPlan:
    def _state(self) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        equipments = [
            _eq(101, "メーカーA15t-1"),
            _eq(102, "メーカーA15t-2"),
            _eq(103, "汎用設備グループ"),
        ]
        groups = [
            _group(201, "メーカーA15t-1", 101),
            _group(202, "メーカーA15t-2", 102),
            _group(203, "汎用設備グループ", 101, 102, 103),
        ]
        return equipments, groups

    def test_renames_keeping_id_and_fills_ledger_columns(self):
        equipments, groups = self._state()
        mapping = {1: "メーカーA15t-1", 2: "メーカーA15t-2"}

        plan = build_plan(LEDGER, mapping, equipments, groups)
        _simulate(plan, equipments, groups)

        by_id = {e["id"]: e for e in equipments}
        assert by_id[101]["name"] == "15t 1号機"
        # 旧名称は呼称として残す
        assert by_id[101]["short_name"] == "メーカーA15t-1"
        assert by_id[101]["ledger_no"] == 1
        assert by_id[101]["serial_no"] == "S-1"
        assert by_id[102]["name"] == "15t 2号機"
        # 台帳に無い設備は変更しない
        assert by_id[103] == _eq(103, "汎用設備グループ")
        assert plan.untouched_equipments == ["汎用設備グループ"]

    def test_inserts_ledger_entries_missing_from_master(self):
        equipments, groups = self._state()
        plan = build_plan(
            LEDGER, {1: "メーカーA15t-1", 2: "メーカーA15t-2"}, equipments, groups
        )

        assert [e.ledger_no for e in plan.inserts] == [3]

    def test_single_member_groups_keep_short_name(self):
        """1台だけの同名グループは呼称（＝旧名称）のまま。長い台帳の名称にしない"""
        equipments, groups = self._state()
        plan = build_plan(
            LEDGER, {1: "メーカーA15t-1", 2: "メーカーA15t-2"}, equipments, groups
        )
        _simulate(plan, equipments, groups)

        assert plan.group_renames == {}
        names = {g["id"]: g["name"] for g in groups}
        assert names == {
            201: "メーカーA15t-1",
            202: "メーカーA15t-2",
            203: "汎用設備グループ",
        }
        # メンバー構成は変えない
        assert groups[2]["member_ids"] == {101, 102, 103}

    def test_keeps_existing_short_name(self):
        """呼称が設定済み（画面での手動設定等）なら上書きせず、1台グループをその呼称に揃える"""
        equipments = [_eq(101, "旧A", short_name="A号")]
        groups = [_group(201, "旧A", 101)]

        plan = build_plan(LEDGER[:1], {1: "旧A"}, equipments, groups)
        _simulate(plan, equipments, groups)

        assert "short_name" not in plan.updates[0].changes
        assert equipments[0]["short_name"] == "A号"
        assert groups[0]["name"] == "A号"

    def test_no_short_name_when_name_is_unchanged(self):
        """台帳の名称と同名で対応付いた設備は呼称を設定しない"""
        equipments = [_eq(101, "15t 1号機")]

        plan = build_plan(LEDGER[:1], {}, equipments, [])

        assert "short_name" not in plan.updates[0].changes

    def test_restores_short_name_after_previous_version_run(self):
        """旧版のスクリプトで台帳の名称に変わった設備・グループは、対応表から呼称を復元し
        グループ名を呼称に戻す"""
        equipments = [
            _eq(
                101,
                "15t 1号機",
                ledger_no=1,
                maker="メーカーA",
                model="M-15",
                serial_no="S-1",
            )
        ]
        groups = [_group(201, "15t 1号機", 101), _group(202, "共有", 101, 102)]

        plan = build_plan(LEDGER[:1], {1: "メーカーA15t-1"}, equipments, groups)
        _simulate(plan, equipments, groups)

        assert plan.equipment_name_steps == [(101, {"short_name": "メーカーA15t-1"})]
        assert equipments[0]["short_name"] == "メーカーA15t-1"
        assert {g["id"]: g["name"] for g in groups} == {
            201: "メーカーA15t-1",
            202: "共有",
        }

    def test_rejects_short_name_collision(self):
        equipments = [_eq(101, "旧A"), _eq(102, "その他", short_name="旧A")]

        with pytest.raises(LedgerError, match="表示名.*「旧A」が重複"):
            build_plan(LEDGER[:1], {1: "旧A"}, equipments, [])

    def test_does_not_rename_group_with_other_name(self):
        equipments = [_eq(101, "旧A")]
        groups = [_group(201, "切断", 101)]

        plan = build_plan(LEDGER[:1], {1: "旧A"}, equipments, groups)

        assert plan.group_renames == {}

    def test_rerun_is_noop(self):
        equipments, groups = self._state()
        mapping = {1: "メーカーA15t-1", 2: "メーカーA15t-2"}
        _simulate(build_plan(LEDGER, mapping, equipments, groups), equipments, groups)

        plan = build_plan(LEDGER, mapping, equipments, groups)

        assert not plan.has_changes

    def test_resumes_after_interruption_before_rename(self):
        """台帳番号だけ書き込まれた状態から再実行すると、名称変更とグループ名変更が続く"""
        equipments = [_eq(101, "メーカーA15t-1", ledger_no=1, maker="メーカーA")]
        groups = [_group(201, "メーカーA15t-1", 101)]

        plan = build_plan(LEDGER[:1], {1: "メーカーA15t-1"}, equipments, groups)
        _simulate(plan, equipments, groups)

        assert equipments[0]["name"] == "15t 1号機"
        assert equipments[0]["short_name"] == "メーカーA15t-1"
        assert groups[0]["name"] == "メーカーA15t-1"

    def test_resumes_group_rename_from_temp_name(self):
        equipments = [_eq(101, "15t 1号機", ledger_no=1)]
        groups = [_group(201, f"{TEMP_NAME_PREFIX}201", 101)]

        plan = build_plan(
            [LedgerEntry(1, "15t 1号機")], {1: "旧名"}, equipments, groups
        )

        assert plan.group_renames == {201: (f"{TEMP_NAME_PREFIX}201", "旧名")}

    def test_swapping_names_keeps_display_names(self):
        """名称の入れ替えでも旧名称が呼称に残り表示名は変わらないので、一時名を経由しない"""
        equipments = [_eq(101, "B"), _eq(102, "A")]
        groups = [_group(201, "B", 101), _group(202, "A", 102)]
        ledger = [LedgerEntry(1, "A"), LedgerEntry(2, "B")]

        plan = build_plan(ledger, {1: "B", 2: "A"}, equipments, groups)
        _simulate(plan, equipments, groups)

        assert {e["id"]: e["name"] for e in equipments} == {101: "A", 102: "B"}
        assert {e["id"]: e["short_name"] for e in equipments} == {101: "B", 102: "A"}
        # グループ名は呼称（＝旧名称）のまま
        assert {g["id"]: g["name"] for g in groups} == {201: "B", 202: "A"}
        assert plan.equipment_name_steps == [
            (101, {"name": "A", "short_name": "B"}),
            (102, {"name": "B", "short_name": "A"}),
        ]

    def test_swapping_display_names_goes_through_temp_short_name(self):
        """台帳 CSV の呼称で表示名が入れ替わる場合は、呼称に一時名を入れて UNIQUE を避ける"""
        equipments = [_eq(101, "P"), _eq(102, "Q")]
        groups = [_group(201, "P", 101), _group(202, "Q", 102)]
        ledger = [
            LedgerEntry(1, "15T", short_name="Q"),
            LedgerEntry(2, "15T", short_name="P"),
        ]

        plan = build_plan(ledger, {1: "P", 2: "Q"}, equipments, groups)
        _simulate(plan, equipments, groups)

        assert {e["id"]: (e["name"], e["short_name"]) for e in equipments} == {
            101: ("15T", "Q"),
            102: ("15T", "P"),
        }
        assert any(
            str(f.get("short_name", "")).startswith(TEMP_NAME_PREFIX)
            for _, f in plan.equipment_name_steps
        )
        # 1台グループも新しい呼称に揃う（グループ名の入れ替えも一時名を経由する）
        assert {g["id"]: g["name"] for g in groups} == {201: "Q", 202: "P"}

    def test_restores_short_name_after_parking_equipment_without_short_name(self):
        """呼称の無い設備を一時名で退避した場合も、最後に呼称を元（NULL）に戻す"""
        equipments = [
            _eq(101, f"{TEMP_NAME_PREFIX}101", ledger_no=1),
            _eq(102, "A", ledger_no=2),
        ]
        ledger = [LedgerEntry(1, "A"), LedgerEntry(2, "B", short_name="Z")]

        plan = build_plan(ledger, {}, equipments, [])
        _simulate(plan, equipments, [])

        assert {e["id"]: (e["name"], e["short_name"]) for e in equipments} == {
            101: ("A", None),
            102: ("B", "Z"),
        }

    def test_resumes_from_temp_short_name(self):
        """呼称が一時名のまま中断した設備は、再実行で呼称を設定し直す"""
        equipments = [_eq(101, "旧A", short_name=f"{TEMP_NAME_PREFIX}101", ledger_no=1)]

        plan = build_plan(
            [LedgerEntry(1, "15T", short_name="A号")], {1: "旧A"}, equipments, []
        )
        _simulate(plan, equipments, [])

        assert (equipments[0]["name"], equipments[0]["short_name"]) == ("15T", "A号")

    def test_auto_matches_same_name_without_mapping(self):
        equipments = [_eq(101, "15t 1号機")]

        plan = build_plan(LEDGER[:1], {}, equipments, [])

        assert plan.inserts == []
        assert plan.updates[0].id == 101
        assert plan.updates[0].changes["ledger_no"] == 1
        assert "name" not in plan.updates[0].changes

    @pytest.mark.parametrize(
        ("mapping", "equipments", "message"),
        [
            ({1: "存在しない"}, [_eq(101, "旧A")], "設備マスタにありません"),
            ({9: "旧A"}, [_eq(101, "旧A")], "台帳にありません"),
            (
                {1: "旧A"},
                [_eq(101, "旧A"), _eq(102, "旧B", ledger_no=1)],
                "既に設備「旧B」に設定済み",
            ),
            (
                {1: "旧A"},
                [_eq(101, "旧A", ledger_no=5)],
                "既に台帳番号 5 に対応付け済み",
            ),
            # 新規登録する設備の表示名が、台帳に対応しない既存設備と重なる
            ({}, [_eq(102, "15t 1号機", ledger_no=7)], "表示名.*重複"),
        ],
    )
    def test_rejects_inconsistent_input(self, mapping, equipments, message):
        with pytest.raises(LedgerError, match=message):
            build_plan(LEDGER[:1], mapping, equipments, [])

    def test_rejects_group_name_collision(self):
        equipments = [_eq(101, "旧A", short_name="A号")]
        groups = [_group(201, "旧A", 101), _group(202, "A号", 101, 102)]

        with pytest.raises(LedgerError, match="設備グループ名"):
            build_plan(LEDGER[:1], {1: "旧A"}, equipments, groups)


class TestSameNameEquipments:
    """台帳に同名の設備がある場合（Issue #501）。設備名は一意ではなく、表示名で区別する"""

    SAME_NAME_LEDGER = [
        LedgerEntry(1, "15Tプレス", maker="メーカーA", serial_no="S-1"),
        LedgerEntry(2, "15Tプレス", maker="メーカーA", serial_no="S-2"),
    ]

    def test_existing_equipments_become_same_name(self):
        """対応表で対応付けた設備は旧名称が呼称に残るので、同名になっても区別できる"""
        equipments = [_eq(101, "A15t(1)"), _eq(102, "A15t(2)")]

        plan = build_plan(
            self.SAME_NAME_LEDGER, {1: "A15t(1)", 2: "A15t(2)"}, equipments, []
        )
        _simulate(plan, equipments, [])

        assert {e["id"]: (e["name"], e["short_name"]) for e in equipments} == {
            101: ("15Tプレス", "A15t(1)"),
            102: ("15Tプレス", "A15t(2)"),
        }

    def test_inserts_same_name_with_short_names_from_csv(self):
        ledger = [
            LedgerEntry(1, "15Tプレス", short_name="A15t(1)"),
            LedgerEntry(2, "15Tプレス", short_name="A15t(2)"),
        ]
        equipments: list[dict[str, Any]] = []

        plan = build_plan(ledger, {}, equipments, [])
        _simulate(plan, equipments, [])

        assert [(e["name"], e["short_name"]) for e in equipments] == [
            ("15Tプレス", "A15t(1)"),
            ("15Tプレス", "A15t(2)"),
        ]

    def test_rejects_same_name_inserts_without_short_name(self):
        with pytest.raises(
            LedgerError, match="表示名.*「15Tプレス」が重複.*short_name"
        ):
            build_plan(self.SAME_NAME_LEDGER, {}, [], [])

    def test_csv_short_name_does_not_overwrite_existing_one(self):
        equipments = [_eq(101, "旧A", short_name="A号")]

        plan = build_plan(
            [LedgerEntry(1, "15Tプレス", short_name="別名")], {1: "旧A"}, equipments, []
        )

        assert "short_name" not in plan.updates[0].changes

    def test_rejects_auto_match_when_master_has_same_names(self):
        """同名の設備が複数あると名称だけでは対応を決められない"""
        equipments = [
            _eq(101, "15Tプレス", short_name="a"),
            _eq(102, "15Tプレス", short_name="b"),
        ]

        with pytest.raises(LedgerError, match="名称から決められません"):
            build_plan(self.SAME_NAME_LEDGER[:1], {}, equipments, [])

    def test_rejects_auto_match_when_ledger_has_same_names(self):
        """台帳に同名の行が複数あると、既存の同名設備がどの行に当たるか決められない"""
        equipments = [_eq(101, "15Tプレス")]

        with pytest.raises(LedgerError, match="名称から決められません"):
            build_plan(self.SAME_NAME_LEDGER, {}, equipments, [])

    def test_mapping_resolves_by_short_name(self):
        """対応表の旧名称は表示名（呼称）でも引ける。同名の設備を呼称で指定できる"""
        equipments = [
            _eq(101, "15Tプレス", short_name="a"),
            _eq(102, "15Tプレス", short_name="b"),
        ]

        plan = build_plan(self.SAME_NAME_LEDGER, {1: "a", 2: "b"}, equipments, [])
        _simulate(plan, equipments, [])

        assert {e["id"]: e["ledger_no"] for e in equipments} == {101: 1, 102: 2}

    def test_rejects_ambiguous_mapping_name(self):
        equipments = [
            _eq(101, "15Tプレス", short_name="a"),
            _eq(102, "15Tプレス", short_name="b"),
        ]

        with pytest.raises(LedgerError, match="当たる設備が複数"):
            build_plan(self.SAME_NAME_LEDGER[:1], {1: "15Tプレス"}, equipments, [])


class TestOrderRenames:
    def test_chain(self):
        current = {1: "A", 2: "B", 3: "C"}
        steps = order_renames(current, {1: "B", 2: "C", 3: "D"})

        names = dict(current)
        for i, name in steps:
            assert name not in {n for j, n in names.items() if j != i}
            names[i] = name
        assert names == {1: "B", 2: "C", 3: "D"}


class TestLoadCsv:
    def test_ledger_csv_with_bom_and_blank_cells(self, tmp_path):
        path = tmp_path / "ledger.csv"
        path.write_text(
            "ledger_no,name,maker,model,manufactured_on,serial_no,note\n"
            " 1 , 15t 1号機 ,メーカーA,,1993年5月,,\n"
            ",,,,,,\n",
            encoding="utf-8-sig",
        )

        entries = load_ledger_csv(str(path))

        assert entries == [
            LedgerEntry(1, "15t 1号機", maker="メーカーA", manufactured_on="1993年5月")
        ]

    def test_ledger_csv_allows_duplicate_names_with_short_name(self, tmp_path):
        path = tmp_path / "ledger.csv"
        path.write_text(
            "ledger_no,name,short_name\n1,15Tプレス,A15t(1)\n2,15Tプレス,\n",
            encoding="utf-8",
        )

        assert load_ledger_csv(str(path)) == [
            LedgerEntry(1, "15Tプレス", short_name="A15t(1)"),
            LedgerEntry(2, "15Tプレス"),
        ]

    def test_ledger_csv_rejects_duplicate_ledger_no(self, tmp_path):
        path = tmp_path / "ledger.csv"
        path.write_text("ledger_no,name\n1,A\n1,B\n", encoding="utf-8")

        with pytest.raises(LedgerError, match="ledger_no が重複"):
            load_ledger_csv(str(path))

    def test_ledger_csv_rejects_missing_column(self, tmp_path):
        path = tmp_path / "ledger.csv"
        path.write_text("no,name\n1,A\n", encoding="utf-8")

        with pytest.raises(LedgerError, match="必須の列"):
            load_ledger_csv(str(path))

    def test_mapping_csv(self, tmp_path):
        path = tmp_path / "mapping.csv"
        path.write_text("current_name,ledger_no\n旧A,1\n旧B,2\n", encoding="utf-8")

        assert load_mapping_csv(str(path)) == {1: "旧A", 2: "旧B"}

    def test_mapping_csv_rejects_duplicate_name(self, tmp_path):
        path = tmp_path / "mapping.csv"
        path.write_text("current_name,ledger_no\n旧A,1\n旧A,2\n", encoding="utf-8")

        with pytest.raises(LedgerError, match="current_name が重複"):
            load_mapping_csv(str(path))


class TestApplyPlan:
    def test_scopes_every_write_to_tenant(self):
        client = MagicMock()
        plan = build_plan(
            LEDGER,
            {1: "旧A"},
            [_eq(101, "旧A")],
            [_group(201, "旧A", 101)],
        )

        apply_plan(client, TENANT_ID, plan)

        table = client.table.return_value
        # update(...).eq("id", ...).eq("tenant_id", TENANT_ID)
        tenant_filters = [
            c for c in table.update.return_value.eq.return_value.eq.call_args_list
        ]
        assert tenant_filters
        assert all(c.args == ("tenant_id", TENANT_ID) for c in tenant_filters)
        inserted = table.insert.call_args.args[0]
        assert {row["ledger_no"] for row in inserted} == {2, 3}
        assert all(row["tenant_id"] == TENANT_ID for row in inserted)


class TestRun:
    def _client(self) -> MagicMock:
        client = MagicMock()
        tables: dict[str, MagicMock] = {
            n: MagicMock() for n in ("tenants", "equipments", "equipment_groups")
        }
        tables[
            "tenants"
        ].select.return_value.eq.return_value.execute.return_value.data = [
            {"id": TENANT_ID}
        ]
        tables[
            "equipments"
        ].select.return_value.eq.return_value.execute.return_value.data = [
            _eq(101, "旧A")
        ]
        tables[
            "equipment_groups"
        ].select.return_value.eq.return_value.execute.return_value.data = [
            {
                "id": 201,
                "name": "旧A",
                "equipment_group_members": [{"equipment_id": 101}],
            }
        ]
        client.table.side_effect = lambda name: tables[name]
        client.tables = tables
        return client

    def _args(self, tmp_path, dry_run: bool) -> argparse.Namespace:
        ledger = tmp_path / "ledger.csv"
        ledger.write_text("ledger_no,name\n1,15t 1号機\n", encoding="utf-8")
        mapping = tmp_path / "mapping.csv"
        mapping.write_text("current_name,ledger_no\n旧A,1\n", encoding="utf-8")
        return argparse.Namespace(
            tenant_id=TENANT_ID, csv=str(ledger), mapping=str(mapping), dry_run=dry_run
        )

    def test_dry_run_does_not_write(self, tmp_path, capsys):
        client = self._client()

        plan = run(self._args(tmp_path, dry_run=True), client=client)

        assert plan.has_changes
        client.tables["equipments"].update.assert_not_called()
        client.tables["equipment_groups"].update.assert_not_called()
        out = capsys.readouterr().out
        assert "旧A → 15t 1号機" in out
        assert "--dry-run" in out

    def test_applies_without_dry_run(self, tmp_path):
        client = self._client()

        run(self._args(tmp_path, dry_run=False), client=client)

        client.tables["equipments"].update.assert_any_call({"ledger_no": 1})
        # 名称と呼称は1回の UPDATE でまとめて書く（表示名「旧A」は変わらない）
        client.tables["equipments"].update.assert_any_call(
            {"name": "15t 1号機", "short_name": "旧A"}
        )
        # 1台グループは呼称（＝旧名称）と同名なので変更しない
        client.tables["equipment_groups"].update.assert_not_called()

    def test_rejects_invalid_tenant_id(self, tmp_path):
        args = self._args(tmp_path, dry_run=True)
        args.tenant_id = "not-a-uuid"

        with pytest.raises(LedgerError, match="UUID"):
            run(args, client=self._client())
