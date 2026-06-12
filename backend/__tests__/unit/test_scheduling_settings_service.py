"""
get_effective_params の優先度解決ロジックのユニットテスト
"""

from unittest.mock import MagicMock

import pytest
from app.models.common.scheduling_settings import SchedulingParams
from app.services.scheduling_settings_service import get_effective_params


def _make_repos(
    global_row: dict | None,
    group_row: dict | None,
    equip_row: dict | None,
) -> tuple[MagicMock, MagicMock]:
    settings_repo = MagicMock()
    settings_repo.get.return_value = global_row
    equipment_repo = MagicMock()
    equipment_repo.get_group_by_id.return_value = group_row
    equipment_repo.get_by_id.return_value = equip_row
    return settings_repo, equipment_repo


@pytest.mark.unit
class TestGetEffectiveParams:
    """get_effective_params の優先度解決ロジック"""

    def test_equipment_takes_priority_over_group_and_global(self) -> None:
        """設備 > グループ > グローバルの順で優先される"""
        settings_repo, equipment_repo = _make_repos(
            global_row={
                "guard_time_minutes": 10,
                "min_slot_minutes": 20,
                "max_fragments": 5,
            },
            group_row={
                "guard_time_minutes": 5,
                "min_slot_minutes": 10,
                "max_fragments": 3,
            },
            equip_row={
                "guard_time_minutes": 1,
                "min_slot_minutes": 2,
                "max_fragments": 1,
            },
        )
        result = get_effective_params(
            equipment_id=1,
            group_id=1,
            tenant_id="t1",
            settings_repo=settings_repo,
            equipment_repo=equipment_repo,
        )
        assert result == SchedulingParams(
            guard_time_minutes=1, min_slot_minutes=2, max_fragments=1
        )

    def test_group_takes_priority_when_equipment_is_none(self) -> None:
        """設備設定が None のときグループ値が優先される"""
        settings_repo, equipment_repo = _make_repos(
            global_row={
                "guard_time_minutes": 10,
                "min_slot_minutes": 20,
                "max_fragments": 5,
            },
            group_row={
                "guard_time_minutes": 5,
                "min_slot_minutes": 10,
                "max_fragments": 3,
            },
            equip_row={
                "guard_time_minutes": None,
                "min_slot_minutes": None,
                "max_fragments": None,
            },
        )
        result = get_effective_params(
            equipment_id=1,
            group_id=1,
            tenant_id="t1",
            settings_repo=settings_repo,
            equipment_repo=equipment_repo,
        )
        assert result == SchedulingParams(
            guard_time_minutes=5, min_slot_minutes=10, max_fragments=3
        )

    def test_global_used_when_equipment_and_group_both_none(self) -> None:
        """設備・グループともに None のときグローバル値が使われる"""
        settings_repo, equipment_repo = _make_repos(
            global_row={
                "guard_time_minutes": 10,
                "min_slot_minutes": 20,
                "max_fragments": 5,
            },
            group_row=None,
            equip_row=None,
        )
        result = get_effective_params(
            equipment_id=None,
            group_id=None,
            tenant_id="t1",
            settings_repo=settings_repo,
            equipment_repo=equipment_repo,
        )
        assert result == SchedulingParams(
            guard_time_minutes=10, min_slot_minutes=20, max_fragments=5
        )

    def test_params_resolved_independently(self) -> None:
        """各パラメータは独立して解決される（guard は設備、max_fragments はグループ）"""
        settings_repo, equipment_repo = _make_repos(
            global_row={
                "guard_time_minutes": 10,
                "min_slot_minutes": 20,
                "max_fragments": 5,
            },
            group_row={
                "guard_time_minutes": None,
                "min_slot_minutes": None,
                "max_fragments": 3,
            },
            equip_row={
                "guard_time_minutes": 1,
                "min_slot_minutes": None,
                "max_fragments": None,
            },
        )
        result = get_effective_params(
            equipment_id=1,
            group_id=1,
            tenant_id="t1",
            settings_repo=settings_repo,
            equipment_repo=equipment_repo,
        )
        assert result.guard_time_minutes == 1  # 設備
        assert result.min_slot_minutes == 20  # グローバル（設備・グループともに None）
        assert result.max_fragments == 3  # グループ（設備は None）

    def test_default_values_when_all_rows_are_none(self) -> None:
        """全て None のときデフォルト値（guard=0, min_slot=0, max_frag=10）が使われる"""
        settings_repo, equipment_repo = _make_repos(
            global_row=None,
            group_row=None,
            equip_row=None,
        )
        result = get_effective_params(
            equipment_id=None,
            group_id=None,
            tenant_id="t1",
            settings_repo=settings_repo,
            equipment_repo=equipment_repo,
        )
        assert result == SchedulingParams(
            guard_time_minutes=0, min_slot_minutes=0, max_fragments=10
        )
