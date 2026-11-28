"""製品ごとの工程ルートと日報の工程の突き合わせ (Issue #708, Epic #701)。

DB から切り離した純粋なロジック。日報の明細を (顧客先, 商品名, 工程の表記) ごとに集計した行
（RPC `daily_report_product_process_stats`）を名寄せ（`DailyReportNameMatcher`）で照合し、
製品ごとに「工程ルートの工程（左）」と「日報に出てくる工程の表記（右）」を並べる。
DB の読み込みは `daily_report_product_process_service`。

照合結果は保存せず参照のたびに求める（#488）。工程の別名（表記→工程名）はテナント共通なので、
ある製品の画面で登録した別名は他の製品の日報にも効く。

右の表記は次のどれかになる:
* 工程ルートの工程に結び付く（左と同じ行に並べる）
* 工程名に結び付くが、その製品の工程ルートに無い（`off_routing`。実績は未割当 `no_routing_process`）
* 工程名に結び付かない（`unmatched`。工程の別名を登録するか対象外にする）

製品が「合わない」のは次のどれかがあるとき（合わない工程の数 `mismatch_count`）:
* 工程名に結び付かない表記（表記ごとに1つ）
* 工程ルートに無い工程名（工程名ごとに1つ。工程ルートが1件も無い製品は日報の工程がすべてこれになる）
* 日報で追わない工程（#681）なのに日報に実績がある工程ルートの工程（工程ごとに1つ）

工程ルートだけにあって日報に出てこない工程は、検査など日報に書かない工程があるので数えない（#681。
比較の画面では左だけの行として見せる）。

照合の単位は割り付け（`daily_report_allocator`）と揃える: 工程名は前後の空白を除いて比べ、
同じ製品に同じ工程名の行が複数あるときは `sequence_order` の最も小さい行に結び付ける。
日報の品名が製品に結び付いていない明細は、ハブの① 日報の製品をつなぐ に置くのでここには出さない。
"""

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from datetime import date
from typing import Any

from app.services.daily_report_name_matcher import DailyReportNameMatcher


@dataclass(frozen=True)
class ProcessStat:
    """RPC `daily_report_product_process_stats` の1行。"""

    customer_raw: str | None
    product_raw: str
    process_raw: str
    entry_count: int
    last_work_date: date | None


@dataclass(frozen=True)
class RoutingProcess:
    """製品の工程ルートの1行。"""

    id: int
    product_id: int
    sequence_order: int
    process_name: str | None


@dataclass
class ProcessRaw:
    """製品1つ分の日報の工程の表記（前後の空白を除いたもの）。"""

    raw_text: str
    entry_count: int = 0
    last_work_date: date | None = None
    # 結び付くマスタの工程名（1:N）。結び付かなければ None
    process_names: tuple[str, ...] | None = None

    def add(self, entry_count: int, last_work_date: date | None) -> None:
        self.entry_count += entry_count
        if last_work_date is not None and (
            self.last_work_date is None or last_work_date > self.last_work_date
        ):
            self.last_work_date = last_work_date


@dataclass(frozen=True)
class RoutingRow:
    """左: 工程ルートの工程と、それに結び付く日報の表記。"""

    routing_id: int
    sequence_order: int
    process_name: str
    untracked: bool
    raws: list[ProcessRaw]


@dataclass(frozen=True)
class OffRoutingRow:
    """右だけ: 工程名には結び付くが、その製品の工程ルートに無い工程。"""

    process_name: str
    untracked: bool
    raws: list[ProcessRaw]


@dataclass(frozen=True)
class UnmatchedRaw:
    """右だけ: 工程名に結び付かない日報の表記。"""

    raw: ProcessRaw
    # 同じ表記を日報で使っている他の製品の数（工程の別名はテナント共通なので判断材料として見せる）
    other_product_count: int


@dataclass(frozen=True)
class ProductProcessComparison:
    product_id: int
    has_routings: bool
    routings: list[RoutingRow] = field(default_factory=list)
    off_routing: list[OffRoutingRow] = field(default_factory=list)
    unmatched: list[UnmatchedRaw] = field(default_factory=list)

    @property
    def mismatch_count(self) -> int:
        """合わない工程の数（右だけの工程名・表記と、日報で追わないのに実績がある工程）。"""
        return (
            len(self.unmatched)
            + len(self.off_routing)
            + sum(1 for row in self.routings if row.untracked and row.raws)
        )

    @property
    def mismatch_entry_count(self) -> int:
        """合わない工程の日報の明細の数（1つの表記が複数の工程を指しても1回だけ数える）。"""
        raws: dict[str, int] = {}
        for item in self.unmatched:
            raws[item.raw.raw_text] = item.raw.entry_count
        for off in self.off_routing:
            for raw in off.raws:
                raws[raw.raw_text] = raw.entry_count
        for row in self.routings:
            if row.untracked:
                for raw in row.raws:
                    raws[raw.raw_text] = raw.entry_count
        return sum(raws.values())


def _raw_sort_key(raw: ProcessRaw) -> tuple[int, int, str]:
    """明細の多い順（同じ数なら最後に書かれた日が新しい順、表記の順）。"""
    return (
        -raw.entry_count,
        -(raw.last_work_date.toordinal() if raw.last_work_date else 0),
        raw.raw_text,
    )


def _sort_raws(raws: Iterable[ProcessRaw]) -> list[ProcessRaw]:
    return sorted(raws, key=_raw_sort_key)


def aggregate_product_raws(
    stats: Iterable[ProcessStat],
    matcher: DailyReportNameMatcher,
    ignored_process_raws: frozenset[str] = frozenset(),
) -> dict[int, dict[str, ProcessRaw]]:
    """集計行を照合し、製品ごとの工程の表記にまとめる。

    製品に結び付かない明細は除く（ハブの①）。工程名に結び付かない表記のうち「対象外」にした表記
    （`daily_report_ignored_names`、#489）も除く（工程名に結び付く表記は対象外でも照合結果どおり扱う。
    未照合キューの `list_unmatched_names()` と同じ）。顧客・製品・工程の照合は表記の単位で決まるので、
    同じ組の照合は1回で済む。
    """
    by_product: dict[int, dict[str, ProcessRaw]] = {}
    customer_cache: dict[str | None, int | None] = {}
    product_cache: dict[tuple[str, int | None], int | None] = {}
    process_cache: dict[str, tuple[str, ...] | None] = {}
    for stat in stats:
        raw_text = stat.process_raw.strip()
        if not raw_text:
            continue
        if stat.customer_raw not in customer_cache:
            customer = matcher.match_customer(stat.customer_raw)
            customer_cache[stat.customer_raw] = customer.target if customer else None
        customer_id = customer_cache[stat.customer_raw]
        product_key = (stat.product_raw, customer_id)
        if product_key not in product_cache:
            product = matcher.match_product(stat.product_raw, customer_id)
            product_cache[product_key] = product.target if product else None
        product_id = product_cache[product_key]
        if product_id is None:
            continue
        if raw_text not in process_cache:
            process = matcher.match_process(raw_text)
            process_cache[raw_text] = (
                tuple(dict.fromkeys(n.strip() for n in process.target if n.strip()))
                if process
                else None
            )
        process_names = process_cache[raw_text]
        if process_names is None and raw_text in ignored_process_raws:
            continue
        raws = by_product.setdefault(product_id, {})
        raw = raws.setdefault(
            raw_text, ProcessRaw(raw_text=raw_text, process_names=process_names)
        )
        raw.add(stat.entry_count, stat.last_work_date)
    return by_product


def count_products_by_unmatched_raw(
    by_product: Mapping[int, Mapping[str, ProcessRaw]],
) -> dict[str, int]:
    """工程名に結び付かない表記ごとの、その表記を使っている製品の数。"""
    counts: dict[str, int] = {}
    for raws in by_product.values():
        for raw in raws.values():
            if raw.process_names is None:
                counts[raw.raw_text] = counts.get(raw.raw_text, 0) + 1
    return counts


def compare_product_processes(
    product_id: int,
    raws: Mapping[str, ProcessRaw],
    routings: Iterable[RoutingProcess],
    untracked_process_names: Iterable[str] = (),
    products_by_unmatched_raw: Mapping[str, int] | None = None,
) -> ProductProcessComparison:
    """製品1つの工程ルートと日報の工程の表記を並べる。

    `routings` はその製品の工程ルート（他の製品の行が混ざっていても除く）。
    `products_by_unmatched_raw` は `count_products_by_unmatched_raw()` の結果（他の製品の数の算出に使う）。
    """
    untracked = frozenset(n.strip() for n in untracked_process_names if n.strip())
    product_routings = sorted(
        (
            r
            for r in routings
            if r.product_id == product_id and (r.process_name or "").strip()
        ),
        key=lambda r: (r.sequence_order, r.id),
    )
    # 同じ工程名の行が複数あれば、割り付けと同じく sequence_order の最も小さい行に結び付ける
    first_routing_by_name: dict[str, int] = {}
    for routing in product_routings:
        first_routing_by_name.setdefault(
            (routing.process_name or "").strip(), routing.id
        )

    raws_by_routing: dict[int, list[ProcessRaw]] = {}
    raws_by_off_name: dict[str, list[ProcessRaw]] = {}
    unmatched: list[UnmatchedRaw] = []
    counts = products_by_unmatched_raw or {}
    for raw in raws.values():
        if raw.process_names is None:
            unmatched.append(
                UnmatchedRaw(
                    raw=raw,
                    other_product_count=max(counts.get(raw.raw_text, 1) - 1, 0),
                )
            )
            continue
        for name in raw.process_names:
            routing_id = first_routing_by_name.get(name)
            if routing_id is not None:
                raws_by_routing.setdefault(routing_id, []).append(raw)
            else:
                raws_by_off_name.setdefault(name, []).append(raw)

    routing_rows = [
        RoutingRow(
            routing_id=r.id,
            sequence_order=r.sequence_order,
            process_name=(r.process_name or "").strip(),
            untracked=(r.process_name or "").strip() in untracked,
            raws=_sort_raws(raws_by_routing.get(r.id, [])),
        )
        for r in product_routings
    ]
    off_rows = sorted(
        (
            OffRoutingRow(
                process_name=name,
                untracked=name in untracked,
                raws=_sort_raws(items),
            )
            for name, items in raws_by_off_name.items()
        ),
        key=lambda row: (-sum(r.entry_count for r in row.raws), row.process_name),
    )
    return ProductProcessComparison(
        product_id=product_id,
        has_routings=bool(product_routings),
        routings=routing_rows,
        off_routing=off_rows,
        unmatched=sorted(unmatched, key=lambda i: _raw_sort_key(i.raw)),
    )


def compare_all_products(
    by_product: Mapping[int, Mapping[str, ProcessRaw]],
    routings: Iterable[RoutingProcess],
    untracked_process_names: Iterable[str] = (),
) -> list[ProductProcessComparison]:
    """日報に実績がある製品すべての比較（製品 ID の順）。"""
    routings_by_product: dict[int, list[RoutingProcess]] = {}
    for routing in routings:
        routings_by_product.setdefault(routing.product_id, []).append(routing)
    untracked = tuple(untracked_process_names)
    counts = count_products_by_unmatched_raw(by_product)
    return [
        compare_product_processes(
            product_id,
            raws,
            routings_by_product.get(product_id, []),
            untracked,
            counts,
        )
        for product_id, raws in sorted(by_product.items())
    ]


def mismatched_products(
    comparisons: Iterable[ProductProcessComparison],
) -> list[ProductProcessComparison]:
    """合わない製品だけを、合わない工程の明細の多い順に返す（同じ数なら製品 ID の順）。"""
    return sorted(
        (c for c in comparisons if c.mismatch_count > 0),
        key=lambda c: (-c.mismatch_entry_count, c.product_id),
    )


def raw_to_dict(raw: ProcessRaw) -> dict[str, Any]:
    return {
        "raw_text": raw.raw_text,
        "entry_count": raw.entry_count,
        "last_work_date": raw.last_work_date,
    }
