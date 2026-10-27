"""工程の前倒し・後ろ倒しの計算のテスト (Issue #582)。

2026-11-02 は月曜日。稼働時間は 9:00-17:00（昼休憩 12:00-13:00、1日7時間）。
"""

from datetime import date, datetime

import pytest
from app.services.schedule_shift_service import (
    OtherSegment,
    ProcessSchedule,
    Segment,
    find_overlaps,
    plan_process_shift,
)
from app.utils.calendar import JST, CalendarConfig

EQUIP_PRESS = 101
EQUIP_INSPECT = 102


def _dt(day: int, hour: int, minute: int = 0, month: int = 11) -> datetime:
    return datetime(2026, month, day, hour, minute, tzinfo=JST)


def _process(
    routing_id: int,
    sequence: int,
    segments: list[tuple[datetime, datetime]],
    equipment_id: int | None = EQUIP_PRESS,
) -> ProcessSchedule:
    return ProcessSchedule(
        process_routing_id=routing_id,
        sequence_order=sequence,
        segments=tuple(Segment(s, e, equipment_id) for s, e in segments),
    )


def _after(plan, routing_id: int) -> list[tuple[datetime, datetime]]:
    process = next(p for p in plan.processes if p.process_routing_id == routing_id)
    return [(s.start, s.end) for s in process.after]


# 工程1（月 9-12）→ 工程2（月 13-17 と 火 9-12、7時間）→ 工程3（水 9-10）
PROCESSES = [
    _process(1, 1, [(_dt(2, 9), _dt(2, 12))]),
    _process(2, 2, [(_dt(2, 13), _dt(2, 17)), (_dt(3, 9), _dt(3, 12))], EQUIP_INSPECT),
    _process(3, 3, [(_dt(4, 9), _dt(4, 10))]),
]


@pytest.mark.unit
class TestPlanProcessShift:
    def test_postpone_moves_target_and_later_processes(self):
        plan = plan_process_shift(PROCESSES, 2, 1)

        assert [p.process_routing_id for p in plan.processes] == [2, 3]
        # 開始は翌稼働日の同じ時刻。所要時間 7 時間を稼働時間に詰めて配置し直す
        assert _after(plan, 2) == [(_dt(3, 13), _dt(3, 17)), (_dt(4, 9), _dt(4, 12))]
        assert _after(plan, 3) == [(_dt(5, 9), _dt(5, 10))]
        assert plan.stopped_at_previous is False

    def test_keeps_equipment(self):
        plan = plan_process_shift(PROCESSES, 2, 1)

        assert {s.equipment_id for s in plan.processes[0].after} == {EQUIP_INSPECT}

    def test_skips_weekend(self):
        # 金曜の工程を後ろ倒しすると土日を跳ばして月曜へ
        processes = [_process(1, 1, [(_dt(6, 9), _dt(6, 11))])]

        plan = plan_process_shift(processes, 1, 1)

        assert _after(plan, 1) == [(_dt(9, 9), _dt(9, 11))]

    def test_skips_tenant_holiday(self):
        config = CalendarConfig(holidays={date(2026, 11, 3)})

        plan = plan_process_shift(PROCESSES, 3, -1, config)

        # 水曜の工程3を前倒し: 火曜は休日なので月曜…だが前工程（工程2）の終了で止まる
        assert plan.stopped_at_previous is True

    def test_relays_across_holiday(self):
        # 工程2を後ろ倒し: 火曜 13:00 から始め、水曜が休日なので残りは木曜へ
        config = CalendarConfig(holidays={date(2026, 11, 4)})

        plan = plan_process_shift(PROCESSES, 2, 1, config)

        assert _after(plan, 2) == [(_dt(3, 13), _dt(3, 17)), (_dt(5, 9), _dt(5, 12))]

    def test_working_saturday_counts(self):
        config = CalendarConfig(workdays={date(2026, 11, 7)})
        processes = [_process(1, 1, [(_dt(6, 9), _dt(6, 11))])]

        plan = plan_process_shift(processes, 1, 1, config)

        assert _after(plan, 1) == [(_dt(7, 9), _dt(7, 11))]

    def test_advance_does_not_move_previous_processes(self):
        plan = plan_process_shift(PROCESSES, 3, -1)

        assert [p.process_routing_id for p in plan.processes] == [3]

    def test_advance_stops_at_previous_end(self):
        # 工程2を前倒し: 月曜の前は前の週の金曜だが、前工程（工程1）は月曜 12:00 に終わる
        plan = plan_process_shift(PROCESSES, 2, -1)

        assert plan.stopped_at_previous is True
        # 前工程の終了（昼休憩中）から稼働時間に乗せる
        assert _after(plan, 2) == [(_dt(2, 13), _dt(2, 17)), (_dt(3, 9), _dt(3, 12))]

    def test_advance_within_slack(self):
        processes = [
            _process(1, 1, [(_dt(2, 9), _dt(2, 12))]),
            _process(2, 2, [(_dt(4, 9), _dt(4, 11))]),
        ]

        plan = plan_process_shift(processes, 2, -1)

        assert plan.stopped_at_previous is False
        assert _after(plan, 2) == [(_dt(3, 9), _dt(3, 11))]

    def test_later_process_does_not_start_before_previous_end(self):
        # データ不整合で後工程が前工程の途中から始まっていても、後工程は前の工程の終了より前に置かない
        processes = [
            _process(1, 1, [(_dt(2, 9), _dt(2, 17))]),
            _process(2, 2, [(_dt(2, 10), _dt(2, 11))]),
        ]

        plan = plan_process_shift(processes, 1, 1)

        assert _after(plan, 1) == [(_dt(3, 9), _dt(3, 17))]
        assert _after(plan, 2) == [(_dt(4, 9), _dt(4, 10))]

    def test_gap_filled_segments_are_packed(self):
        # 他の注文の隙間に詰めて飛び飛びになった工程は、所要時間（2時間）を保って詰めて配置し直す
        processes = [
            _process(1, 1, [(_dt(2, 9), _dt(2, 10)), (_dt(2, 15), _dt(2, 16))])
        ]

        plan = plan_process_shift(processes, 1, 1)

        assert _after(plan, 1) == [(_dt(3, 9), _dt(3, 11))]

    def test_duration_excludes_break(self):
        # 11:00-14:00 は休憩を除いて2時間
        processes = [_process(1, 1, [(_dt(2, 11), _dt(2, 14))])]

        plan = plan_process_shift(processes, 1, 1)

        assert _after(plan, 1) == [(_dt(3, 11), _dt(3, 14))]

    def test_segment_outside_work_hours_keeps_working_part(self):
        # 手動調整で 16:00-19:00 に置かれた区間は、稼働時間に当たる1時間だけを所要時間とする
        processes = [_process(1, 1, [(_dt(2, 16), _dt(2, 19))])]

        plan = plan_process_shift(processes, 1, 1)

        assert _after(plan, 1) == [(_dt(3, 16), _dt(3, 17))]

    def test_milestone_moves_time_only(self):
        processes = [
            _process(1, 1, [(_dt(2, 9), _dt(2, 12))]),
            _process(2, 2, [(_dt(2, 12), _dt(2, 12))], equipment_id=None),
        ]

        plan = plan_process_shift(processes, 1, 2)

        assert _after(plan, 1) == [(_dt(4, 9), _dt(4, 12))]
        # 時刻 12:00（昼休憩）は休憩明けに乗せる
        assert _after(plan, 2) == [(_dt(4, 13), _dt(4, 13))]
        assert plan.processes[1].is_milestone is True

    def test_utc_input(self):
        # DB の値は UTC で届く。JST の稼働時間で扱う
        processes = [
            ProcessSchedule(
                1,
                1,
                (
                    Segment(
                        datetime.fromisoformat("2026-11-02T00:00:00+00:00"),
                        datetime.fromisoformat("2026-11-02T02:00:00+00:00"),
                    ),
                ),
            )
        ]

        plan = plan_process_shift(processes, 1, 1)

        assert _after(plan, 1) == [(_dt(3, 9), _dt(3, 11))]

    def test_zero_days_is_rejected(self):
        with pytest.raises(ValueError):
            plan_process_shift(PROCESSES, 2, 0)

    def test_unknown_process_is_rejected(self):
        with pytest.raises(ValueError):
            plan_process_shift(PROCESSES, 99, 1)


@pytest.mark.unit
class TestFindOverlaps:
    def _other(self, schedule_id, equipment_id, start, end, order_id=900):
        return OtherSegment(schedule_id, order_id, equipment_id, start, end)

    def test_finds_overlap_on_same_equipment(self):
        plan = plan_process_shift(PROCESSES, 2, 1)
        others = [
            self._other(1, EQUIP_INSPECT, _dt(3, 15), _dt(3, 16)),
            # 設備が違う
            self._other(2, EQUIP_PRESS, _dt(3, 15), _dt(3, 16)),
            # 終了と開始が接するだけは重ならない
            self._other(3, EQUIP_INSPECT, _dt(4, 12), _dt(4, 14)),
        ]

        overlaps = find_overlaps(plan, others)

        assert [(o.process_routing_id, o.other.schedule_id) for o in overlaps] == [
            (2, 1)
        ]

    def test_ignores_milestones(self):
        processes = [_process(1, 1, [(_dt(2, 10), _dt(2, 10))])]
        plan = plan_process_shift(processes, 1, 1)

        assert (
            find_overlaps(plan, [self._other(1, EQUIP_PRESS, _dt(3, 9), _dt(3, 12))])
            == []
        )

    def test_reports_each_other_segment_once(self):
        plan = plan_process_shift(PROCESSES, 2, 1)
        # 工程2の両方の区間にかかる長い区間
        others = [self._other(1, EQUIP_INSPECT, _dt(3, 9), _dt(4, 17))]

        assert len(find_overlaps(plan, others)) == 1
