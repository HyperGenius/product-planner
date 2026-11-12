# backend/app/services/shipment_matcher.py
"""弥生の売上明細の名寄せと受注への突合 (Issue #667, #662 フェーズ2)。

DB から切り離した純粋なロジック。マスタ・受注・辞書のスナップショット（`ShipmentSnapshot`）と
`shipment_entries` の行を受け取り、得意先 → 顧客、(得意先, 商品コード) → 製品を照合して、
明細を受注へ突き合わせる。読み込みは `shipment_matching_service`。

照合の結果は保存せず、参照のたびに求める（辞書・受注の変更を再計算なしで反映するため。
日報の名寄せ #488 と同じ考え方）。**自動では送品済みにしない**（#557）。ここでは送品の候補を示すだけ。

得意先 → 顧客（1対多。商流で弥生の得意先＝請求先と受注の顧客＝注文元が違うことがある）:
  1. 辞書（`shipment_customer_links`）。登録があれば辞書だけを使う
  2. 得意先名と顧客名・通称の一致（法人格・空白・長音とハイフン類を無視）。一意のときだけ

(得意先, 商品コード) → 製品。弥生の商品コードは製品マスタの図番（`products.code`）と一致しない
（本番で確認済み）ので、コードでは照合しない:
  1. 辞書（`shipment_product_links`）
  2. 品名に入っている図番らしき番号（数字5桁以上）が、製品の図番・品名・別名に含まれる
  3. `parse_product_spec()` の直径・長さが同じで、材質が先頭一致
  2・3 は**得意先に対応する顧客の受注にある製品**に絞り、一意のときだけ照合する。類似度の候補では
  照合しない。候補が複数のときは名寄せの画面に候補として出すだけにする。

明細 → 受注（未送品の受注。下書き・承認待ちも含む）:
  1. 備考の注文番号が `orders.customer_order_no` と一致する受注
  2. 備考の `M/D納期分` / `N月末納期分` が希望納期（`orders.deadline_date`）と一致する受注
  3. どちらも無ければ、顧客＋製品の未送品の受注が1件だけのとき（受注日より前の売上は充当しない）
  候補が複数なら確定しない（並べて示す）。分納は受注ごとに数量を合算する。
"""

import calendar
import re
import unicodedata
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Literal

from app.services.customer_matching_service import normalize_company_name
from app.services.product_spec_parser import ProductSpec, parse_product_spec

# 送品の候補にする受注のステータス（未送品）。下書き・承認待ちは送品の消し込みには出ないが、
# 弥生の送品を当てておかないと、同じ顧客・製品の別の受注に誤って当たる
OPEN_ORDER_STATUSES = frozenset(
    {"draft", "pending_approval", "confirmed", "in_progress"}
)

CustomerMethod = Literal["link", "name"]
ProductMethod = Literal["link", "drawing_no", "spec"]
OrderMatchMethod = Literal["order_no", "deadline", "single_open_order"]
EntryStatus = Literal[
    "matched",
    "ambiguous",
    "no_order",
    "unmatched_customer",
    "unmatched_product",
    "ignored",
]

_WHITESPACE = re.compile(r"\s+")
# 図番らしき番号: 数字5桁以上（前後が数字でない）
_DRAWING_NO = re.compile(r"(?<!\d)\d{5,}(?!\d)")
# 備考の納期分: `10/20納期分`・`10月20日納期分`・`10月末納期分`（NFKC 後）
_DEADLINE_DAY = re.compile(r"(\d{1,2})\s*[/月]\s*(\d{1,2})\s*日?\s*納期")
_DEADLINE_MONTH_END = re.compile(r"(\d{1,2})\s*月\s*末\s*納期")
# 備考の注文番号らしい値: 英数字とハイフンで、数字を含む4文字以上
_ORDER_NO_TOKEN = re.compile(r"[A-Za-z0-9][A-Za-z0-9\-]{3,}")


def normalize_code(value: str | None) -> str:
    """得意先コード・商品コード・注文番号の比較キー。全角半角・空白・英字の大小を無視する。"""
    if not value:
        return ""
    return _WHITESPACE.sub("", unicodedata.normalize("NFKC", value)).upper()


def _nfkc(value: str | None) -> str:
    return unicodedata.normalize("NFKC", value or "")


# ---------------------------------------------------------------------------
# 備考の読み取り
# ---------------------------------------------------------------------------


def _closest_year_date(month: int, day: int | None, sales_date: date) -> date | None:
    """月日（day=None は月末）に、売上日に最も近い年を当てる（1月の売上の `12/20` は前年）。"""
    best: date | None = None
    for year in (sales_date.year - 1, sales_date.year, sales_date.year + 1):
        d = day if day is not None else calendar.monthrange(year, month)[1]
        try:
            candidate = date(year, month, d)
        except ValueError:
            continue
        if best is None or abs((candidate - sales_date).days) < abs(
            (best - sales_date).days
        ):
            best = candidate
    return best


def parse_note_deadlines(note: str | None, sales_date: date) -> list[date]:
    """備考の `M/D納期分` / `N月末納期分` を日付にする（重複を除き出現順）。"""
    text = _nfkc(note)
    found: list[date] = []
    for m in _DEADLINE_DAY.finditer(text):
        month, day = int(m.group(1)), int(m.group(2))
        if 1 <= month <= 12:
            d = _closest_year_date(month, day, sales_date)
            if d is not None and d not in found:
                found.append(d)
    for m in _DEADLINE_MONTH_END.finditer(text):
        month = int(m.group(1))
        if 1 <= month <= 12:
            d = _closest_year_date(month, None, sales_date)
            if d is not None and d not in found:
                found.append(d)
    return found


def parse_note_order_nos(note: str | None) -> list[str]:
    """備考の注文番号らしい値（正規化済み）。納期分の記述は除いてから拾う。"""
    text = _DEADLINE_MONTH_END.sub(" ", _DEADLINE_DAY.sub(" ", _nfkc(note)))
    tokens: list[str] = []
    for m in _ORDER_NO_TOKEN.finditer(text):
        token = m.group(0).strip("-")
        if any(c.isdigit() for c in token) and len(token) >= 4:
            key = normalize_code(token)
            if key not in tokens:
                tokens.append(key)
    return tokens


# ---------------------------------------------------------------------------
# スナップショット
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class CustomerInfo:
    id: int
    name: str
    alias: str | None = None
    status: str | None = None


@dataclass(frozen=True)
class ProductInfo:
    id: int
    name: str
    code: str | None = None
    # 別名辞書（product_name_aliases）の表記
    aliases: tuple[str, ...] = ()


@dataclass(frozen=True)
class OrderInfo:
    id: int
    customer_id: int | None
    product_id: int | None
    quantity: int | None
    status: str
    deadline_date: date | None = None
    # 受注日（order_date の JST 暦日）
    order_date: date | None = None
    customer_order_no: str | None = None


@dataclass
class ShipmentSnapshot:
    customers: list[CustomerInfo] = field(default_factory=list)
    products: list[ProductInfo] = field(default_factory=list)
    # 生産の受注（修理等は製品を持たないので含めない）。全ステータス
    orders: list[OrderInfo] = field(default_factory=list)
    # 得意先コード（正規化済み）→ 顧客 ID の集合
    customer_links: dict[str, set[int]] = field(default_factory=dict)
    # (得意先コード, 商品コード)（正規化済み）→ 製品 ID
    product_links: dict[tuple[str, str], int] = field(default_factory=dict)
    ignored_customers: set[str] = field(default_factory=set)
    ignored_products: set[tuple[str, str]] = field(default_factory=set)


@dataclass(frozen=True)
class CustomerResolution:
    customer_ids: frozenset[int]
    method: CustomerMethod | None


@dataclass(frozen=True)
class ProductResolution:
    product_id: int | None
    method: ProductMethod | None
    # 一意に決まらなかったときの候補（得意先に対応する顧客の受注にある製品）
    candidate_ids: tuple[int, ...] = ()


@dataclass(frozen=True)
class CrossCustomerCandidate:
    """商流の推定: 得意先の顧客の受注には無いが、別の顧客の受注に出ている製品。"""

    product_id: int
    customer_ids: tuple[int, ...]


@dataclass
class EntryMatch:
    entry: dict[str, Any]
    status: EntryStatus
    customer_ids: frozenset[int] = frozenset()
    product_id: int | None = None
    order_id: int | None = None
    method: OrderMatchMethod | None = None
    # 確定できなかったとき（ambiguous）の候補の受注
    candidate_order_ids: tuple[int, ...] = ()


@dataclass
class OrderShipment:
    """受注1件の弥生の送品（分納を合算）。"""

    order_id: int
    shipped_qty: int = 0
    last_sales_date: date | None = None
    entries: list[EntryMatch] = field(default_factory=list)
    # 複数の受注に当たって確定できなかった明細のうち、この受注が候補に入っているもの
    ambiguous_entries: list[EntryMatch] = field(default_factory=list)


def _entry_sales_date(entry: dict[str, Any]) -> date:
    value = entry["sales_date"]
    return value if isinstance(value, date) else date.fromisoformat(str(value))


def _contains_number(text: str, number: str) -> bool:
    return re.search(rf"(?<!\d){re.escape(number)}(?!\d)", text) is not None


def _material_matches(a: str, b: str) -> bool:
    if not a or not b:
        return a == b
    return a.startswith(b) or b.startswith(a)


class ShipmentMatcher:
    def __init__(self, snapshot: ShipmentSnapshot) -> None:
        self._snapshot = snapshot
        self._products = {p.id: p for p in snapshot.products}
        self._customer_by_name: dict[str, list[CustomerInfo]] = {}
        for customer in snapshot.customers:
            for raw in (customer.name, customer.alias):
                key = normalize_company_name(raw) if raw else ""
                if key and customer not in self._customer_by_name.get(key, []):
                    self._customer_by_name.setdefault(key, []).append(customer)
        # 顧客 → その顧客の受注にある製品
        self._products_by_customer: dict[int, set[int]] = {}
        # (顧客, 製品) → 未送品の受注
        self._open_orders: dict[tuple[int, int], list[OrderInfo]] = {}
        # 顧客 → 注文番号（正規化）→ 未送品の受注
        self._open_orders_by_no: dict[int, dict[str, list[OrderInfo]]] = {}
        for order in snapshot.orders:
            if order.customer_id is None or order.product_id is None:
                continue
            self._products_by_customer.setdefault(order.customer_id, set()).add(
                order.product_id
            )
            if order.status not in OPEN_ORDER_STATUSES:
                continue
            self._open_orders.setdefault(
                (order.customer_id, order.product_id), []
            ).append(order)
            order_no = normalize_code(order.customer_order_no)
            if order_no:
                self._open_orders_by_no.setdefault(order.customer_id, {}).setdefault(
                    order_no, []
                ).append(order)
        self._spec_cache: dict[int, ProductSpec | None] = {}

    # --- 得意先 → 顧客 ---------------------------------------------------

    def resolve_customer(
        self, customer_code: str, customer_name: str | None
    ) -> CustomerResolution:
        links = self._snapshot.customer_links.get(normalize_code(customer_code))
        if links:
            return CustomerResolution(frozenset(links), "link")
        key = normalize_company_name(customer_name) if customer_name else ""
        candidates = self._customer_by_name.get(key, []) if key else []
        ids = {c.id for c in candidates}
        if len(ids) != 1:
            ids = {c.id for c in candidates if c.status != "draft"}
        if len(ids) == 1:
            return CustomerResolution(frozenset(ids), "name")
        return CustomerResolution(frozenset(), None)

    def suggest_customers_by_name(self, customer_name: str | None) -> list[int]:
        """得意先名の一部が顧客名・通称に含まれる（またはその逆）顧客。候補の表示専用。"""
        key = normalize_company_name(customer_name) if customer_name else ""
        if len(key) < 2:
            return []
        found: list[int] = []
        for name_key, customers in self._customer_by_name.items():
            if len(name_key) < 2 or not (key in name_key or name_key in key):
                continue
            for customer in customers:
                if customer.id not in found:
                    found.append(customer.id)
        return found

    # --- (得意先, 商品コード) → 製品 ---------------------------------------

    def _spec(self, product: ProductInfo) -> ProductSpec | None:
        if product.id not in self._spec_cache:
            self._spec_cache[product.id] = parse_product_spec(product.name)
        return self._spec_cache[product.id]

    def _candidate_products(
        self, product_name: str | None, pool: Iterable[int]
    ) -> tuple[list[int], ProductMethod | None]:
        """品名から製品を探す（図番 → 仕様）。(候補, 決め手)。候補が無ければ ([], None)。"""
        products = [self._products[i] for i in sorted(set(pool)) if i in self._products]
        name = _nfkc(product_name)
        numbers = _DRAWING_NO.findall(name)
        if numbers:
            hits = [
                p.id
                for p in products
                if any(
                    _contains_number(_nfkc(text), number)
                    for number in numbers
                    for text in (p.code, p.name, *p.aliases)
                    if text
                )
            ]
            if hits:
                return hits, "drawing_no"
        spec = parse_product_spec(name) if name else None
        if spec is None:
            return [], None
        hits = []
        for p in products:
            other = self._spec(p)
            if (
                other is not None
                and other.diameter == spec.diameter
                and other.length == spec.length
                and _material_matches(other.material_key, spec.material_key)
            ):
                hits.append(p.id)
        return (hits, "spec") if hits else ([], None)

    def _pool_for(self, customer_ids: Iterable[int]) -> set[int]:
        pool: set[int] = set()
        for customer_id in customer_ids:
            pool |= self._products_by_customer.get(customer_id, set())
        return pool

    def resolve_product(
        self,
        customer_code: str,
        product_code: str,
        product_name: str | None,
        customer_ids: frozenset[int],
    ) -> ProductResolution:
        linked = self._snapshot.product_links.get(
            (normalize_code(customer_code), normalize_code(product_code))
        )
        if linked is not None:
            return ProductResolution(linked, "link")
        if not customer_ids:
            return ProductResolution(None, None)
        hits, method = self._candidate_products(
            product_name, self._pool_for(customer_ids)
        )
        if len(hits) == 1:
            return ProductResolution(hits[0], method)
        return ProductResolution(None, None, tuple(hits))

    def cross_customer_candidates(
        self, product_name: str | None, exclude_customer_ids: frozenset[int]
    ) -> list[CrossCustomerCandidate]:
        """得意先の顧客以外の受注から、品名に合う製品を探す（商流の推定。自動では確定しない）。"""
        other_customers = [
            c for c in self._products_by_customer if c not in exclude_customer_ids
        ]
        hits, _ = self._candidate_products(
            product_name, self._pool_for(other_customers)
        )
        result = []
        for product_id in hits:
            owners = tuple(
                sorted(
                    c
                    for c in other_customers
                    if product_id in self._products_by_customer[c]
                )
            )
            result.append(CrossCustomerCandidate(product_id, owners))
        return result

    # --- 明細 → 受注 -------------------------------------------------------

    def is_ignored(self, customer_code: str, product_code: str) -> bool:
        customer_key = normalize_code(customer_code)
        return (
            customer_key in self._snapshot.ignored_customers
            or (customer_key, normalize_code(product_code))
            in self._snapshot.ignored_products
        )

    def match_entry(self, entry: dict[str, Any]) -> EntryMatch:
        customer_code = entry["customer_code"]
        product_code = entry["product_code"]
        if self.is_ignored(customer_code, product_code):
            return EntryMatch(entry, "ignored")
        customer = self.resolve_customer(customer_code, entry.get("customer_name"))
        if not customer.customer_ids:
            return EntryMatch(entry, "unmatched_customer")
        product = self.resolve_product(
            customer_code,
            product_code,
            entry.get("product_name"),
            customer.customer_ids,
        )
        if product.product_id is None:
            return EntryMatch(entry, "unmatched_product", customer.customer_ids)

        result = EntryMatch(
            entry, "no_order", customer.customer_ids, product.product_id
        )
        self._match_order(result, product.product_id, customer.customer_ids)
        return result

    def _match_order(
        self, result: EntryMatch, product_id: int, customer_ids: frozenset[int]
    ) -> None:
        entry = result.entry
        sales_date = _entry_sales_date(entry)
        note = entry.get("note")
        deadlines = parse_note_deadlines(note, sales_date)
        deadline = deadlines[0] if len(deadlines) == 1 else None
        open_orders = [
            o
            for customer_id in sorted(customer_ids)
            for o in self._open_orders.get((customer_id, product_id), [])
        ]

        order_nos = parse_note_order_nos(note)
        if order_nos:
            by_no = [
                o
                for customer_id in sorted(customer_ids)
                for no in order_nos
                for o in self._open_orders_by_no.get(customer_id, {}).get(no, [])
                if o.product_id == product_id
            ]
            if by_no:
                if len(by_no) > 1 and deadline is not None:
                    narrowed = [o for o in by_no if o.deadline_date == deadline]
                    by_no = narrowed or by_no
                self._settle(result, by_no, "order_no")
                return

        if deadlines:
            if deadline is None:
                # 1行に複数の納期分が書かれていると、どの受注の分か決められない
                hits = [o for o in open_orders if o.deadline_date in deadlines]
            else:
                hits = [o for o in open_orders if o.deadline_date == deadline]
            self._settle(result, hits, "deadline")
            return

        eligible = [
            o for o in open_orders if o.order_date is None or o.order_date <= sales_date
        ]
        self._settle(result, eligible, "single_open_order")

    @staticmethod
    def _settle(
        result: EntryMatch, orders: list[OrderInfo], method: OrderMatchMethod
    ) -> None:
        ids = sorted({o.id for o in orders})
        if len(ids) == 1:
            result.status = "matched"
            result.order_id = ids[0]
            result.method = method
        elif ids:
            result.status = "ambiguous"
            result.candidate_order_ids = tuple(ids)
        else:
            result.status = "no_order"


def summarize_by_order(matches: Iterable[EntryMatch]) -> dict[int, OrderShipment]:
    """受注ごとに弥生の送品数量を合算する（分納・赤伝を足し引きする）。"""
    shipments: dict[int, OrderShipment] = {}

    def get(order_id: int) -> OrderShipment:
        if order_id not in shipments:
            shipments[order_id] = OrderShipment(order_id)
        return shipments[order_id]

    for match in matches:
        sales_date = _entry_sales_date(match.entry)
        if match.status == "matched" and match.order_id is not None:
            shipment = get(match.order_id)
            shipment.entries.append(match)
            shipment.shipped_qty += match.entry.get("quantity") or 0
            if (
                shipment.last_sales_date is None
                or sales_date > shipment.last_sales_date
            ):
                shipment.last_sales_date = sales_date
        elif match.status == "ambiguous":
            for order_id in match.candidate_order_ids:
                get(order_id).ambiguous_entries.append(match)
    return shipments
