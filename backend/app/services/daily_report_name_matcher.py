"""日報の表記をマスタに照合する名寄せ (Issue #488, 親Issue #485)。

DB から切り離した純粋なロジック。マスタと別名辞書のスナップショット（`NameMatchingSnapshot`）を
受け取り、日報の明細（`daily_report_entries`）の設備・工程・顧客・製品の表記を照合する。
スナップショットの読み込みは `daily_report_name_matching_service.load_snapshot()`。

照合結果は明細に保存せず、割り付け（#490）・未照合一覧の取得のたびに都度解決する。
辞書やマスタの変更が過去の明細にもそのまま反映されるようにするため。

照合の順序（いずれも別名辞書が最優先。誤った自動照合を辞書で上書きできるようにする）:
* 設備: 別名辞書 → 「N号機」の N と `equipments.ledger_no` → 設備名・呼称の一致
* 工程: 別名辞書（1:N）→ `process_routings.process_name` の一致
* 顧客: 別名辞書 → `customers.name` / `alias` の一致（法人格・記号を無視）
* 製品: `product_name_aliases`（顧客単位。顧客が照合できたときだけ）→ 製品名・品番の一致
  → 正規化（`normalize_product_name()`）後の一致

一致する候補が複数あるとき（正規化で別の製品が同じ表記になる等）は照合しない。
pg_trgm の類似候補（`match_products()`）も使わない。誤った自動照合で他の受注に実績が
付くのを避けるため、類似候補は未照合キュー（#489）での提示にだけ使う。

別名辞書のキーは日報の表記そのもの（前後の空白のみ除去）。日報の設備・工程・顧客は
`リスト` シートの選択肢から入力されるので、表記の揺れは選択肢の数に限られる。
"""

import re
import unicodedata
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from typing import Any, Literal

from app.services.customer_matching_service import normalize_company_name

MatchMethod = Literal["alias", "ledger_no", "exact", "normalized"]
NameKind = Literal["equipment", "process", "customer", "product"]

_WHITESPACE = re.compile(r"\s+")
# 日報の「使用設備No」は `〇〇t N号機` / `〇〇溶接機 N号機` の形
_LEDGER_NO = re.compile(r"(\d+)号機")
# 製品名の正規化: 径の記号は有無が揺れるので消し、掛け算・区切りの記号はそれぞれ1文字に寄せる。
# NFKC・小文字化の後に適用する（`Φ`→`φ`、`＊`→`*`、`，`→`,`、`ｘ`→`x` は NFKC 等で寄っている）。
_DIAMETER_MARKS = re.compile(r"[φϕøØ⌀]")
_TIMES_MARKS = re.compile(r"[x×✕✖*∗]")
_SEPARATOR_MARKS = re.compile(r"[+,.]")
# 長音記号「ー」はカタカナの一部なので含めない
_HYPHEN_MARKS = re.compile(r"[‐‑‒–—―−]")


def normalize_name_key(value: str) -> str:
    """設備名・工程名の比較キー。全角半角（NFKC）・空白・英字の大小を無視する。"""
    return _WHITESPACE.sub("", unicodedata.normalize("NFKC", value)).lower()


def normalize_product_name(value: str) -> str:
    """製品名・品番の比較キー。

    全角半角（NFKC）・英字の大小・空白・径の記号（`φ`/`Φ`）の有無・掛け算の記号
    （`x`/`×`/`*`）・区切りの記号（`+`/`,`/`.`）・ハイフンの字形の違いを無視する。
    例: `ＡＢ－１２　φ６×２０` と `ab-12 6x20` は同じキーになる。
    """
    text = normalize_name_key(value)
    text = _DIAMETER_MARKS.sub("", text)
    text = _TIMES_MARKS.sub("x", text)
    text = _SEPARATOR_MARKS.sub("+", text)
    return _HYPHEN_MARKS.sub("-", text)


def extract_equipment_ledger_no(value: str) -> int | None:
    """`200t 3号機` → 3。「N号機」が無い・番号が複数あって決まらない場合は None。"""
    text = _WHITESPACE.sub("", unicodedata.normalize("NFKC", value))
    numbers = {int(n) for n in _LEDGER_NO.findall(text)}
    if len(numbers) != 1:
        return None
    number = next(iter(numbers))
    return number if number > 0 else None


@dataclass(frozen=True)
class EquipmentRef:
    id: int
    name: str
    short_name: str | None = None
    ledger_no: int | None = None


@dataclass(frozen=True)
class CustomerRef:
    id: int
    name: str
    alias: str | None = None
    # 'draft' はメール起票で自動作成された下書き顧客。照合の候補が複数のときは下書き以外を優先する
    status: str | None = None


@dataclass(frozen=True)
class ProductRef:
    id: int
    name: str
    code: str | None = None
    is_active: bool = True


@dataclass
class NameMatchingSnapshot:
    """照合に使うマスタと別名辞書（1テナント分）。"""

    equipments: list[EquipmentRef] = field(default_factory=list)
    customers: list[CustomerRef] = field(default_factory=list)
    products: list[ProductRef] = field(default_factory=list)
    # process_routings.process_name の重複を除いた一覧
    process_names: list[str] = field(default_factory=list)
    # 日報の表記（前後の空白除去済み）→ 照合先
    equipment_aliases: dict[str, int] = field(default_factory=dict)
    process_aliases: dict[str, list[str]] = field(default_factory=dict)
    customer_aliases: dict[str, int] = field(default_factory=dict)
    # (customer_id, 日報の表記) → product_id（product_name_aliases は顧客単位、#349）
    product_aliases: dict[tuple[int, str], int] = field(default_factory=dict)


@dataclass(frozen=True)
class NameMatch:
    target: Any
    method: MatchMethod


@dataclass(frozen=True)
class EntryMatch:
    """明細1行の照合結果。照合できなかった項目は None。"""

    equipment_id: int | None
    customer_id: int | None
    product_id: int | None
    # マスタの工程名（1:N）。照合できなければ None
    process_names: list[str] | None


def _unique(ids: Iterable[int]) -> int | None:
    distinct = set(ids)
    return next(iter(distinct)) if len(distinct) == 1 else None


def _index(
    items: Iterable[Any], *keys: Callable[[Any], str | None]
) -> dict[str, list[Any]]:
    index: dict[str, list[Any]] = {}
    for item in items:
        seen: set[str] = set()
        for key_of in keys:
            key = key_of(item)
            if key and key not in seen:
                seen.add(key)
                index.setdefault(key, []).append(item)
    return index


class DailyReportNameMatcher:
    def __init__(self, snapshot: NameMatchingSnapshot) -> None:
        self._snapshot = snapshot
        self._equipment_by_ledger_no: dict[int, list[EquipmentRef]] = {}
        for equipment in snapshot.equipments:
            if equipment.ledger_no is not None:
                self._equipment_by_ledger_no.setdefault(equipment.ledger_no, []).append(
                    equipment
                )
        self._equipment_by_name = _index(
            snapshot.equipments,
            lambda e: normalize_name_key(e.name),
            lambda e: normalize_name_key(e.short_name) if e.short_name else None,
        )
        self._process_by_name = _index(
            snapshot.process_names, lambda name: normalize_name_key(name)
        )
        self._customer_by_name = _index(
            snapshot.customers,
            lambda c: normalize_company_name(c.name),
            lambda c: normalize_company_name(c.alias) if c.alias else None,
        )
        self._product_by_exact = _index(
            snapshot.products,
            lambda p: p.name.strip(),
            lambda p: p.code.strip() if p.code else None,
        )
        self._product_by_normalized = _index(
            snapshot.products,
            lambda p: normalize_product_name(p.name),
            lambda p: normalize_product_name(p.code) if p.code else None,
        )

    def match_equipment(self, raw: str | None) -> NameMatch | None:
        text = (raw or "").strip()
        if not text:
            return None
        if text in self._snapshot.equipment_aliases:
            return NameMatch(self._snapshot.equipment_aliases[text], "alias")
        ledger_no = extract_equipment_ledger_no(text)
        if ledger_no is not None:
            equipment_id = _unique(
                e.id for e in self._equipment_by_ledger_no.get(ledger_no, [])
            )
            # 番号が台帳に無い場合は名前の一致も見ない（別の設備に誤って付けない）
            return (
                NameMatch(equipment_id, "ledger_no")
                if equipment_id is not None
                else None
            )
        equipment_id = _unique(
            e.id for e in self._equipment_by_name.get(normalize_name_key(text), [])
        )
        return NameMatch(equipment_id, "exact") if equipment_id is not None else None

    def match_process(self, raw: str | None) -> NameMatch | None:
        text = (raw or "").strip()
        if not text:
            return None
        if text in self._snapshot.process_aliases:
            return NameMatch(list(self._snapshot.process_aliases[text]), "alias")
        names = self._process_by_name.get(normalize_name_key(text), [])
        # 全角半角違い等で同じキーになるマスタの工程名が複数あれば、どれか決められない
        if len(names) == 1:
            return NameMatch([names[0]], "exact")
        return None

    def match_customer(self, raw: str | None) -> NameMatch | None:
        text = (raw or "").strip()
        if not text:
            return None
        if text in self._snapshot.customer_aliases:
            return NameMatch(self._snapshot.customer_aliases[text], "alias")
        key = normalize_company_name(text)
        if not key:
            return None
        candidates = self._customer_by_name.get(key, [])
        customer_id = _unique(c.id for c in candidates)
        if customer_id is None:
            customer_id = _unique(c.id for c in candidates if c.status != "draft")
        return NameMatch(customer_id, "exact") if customer_id is not None else None

    def match_product(
        self, raw: str | None, customer_id: int | None
    ) -> NameMatch | None:
        text = (raw or "").strip()
        if not text:
            return None
        if customer_id is not None:
            alias_product_id = self._snapshot.product_aliases.get((customer_id, text))
            if alias_product_id is not None:
                return NameMatch(alias_product_id, "alias")
        product_id = self._pick_product(self._product_by_exact.get(text, []))
        if product_id is not None:
            return NameMatch(product_id, "exact")
        key = normalize_product_name(text)
        if not key:
            return None
        product_id = self._pick_product(self._product_by_normalized.get(key, []))
        return NameMatch(product_id, "normalized") if product_id is not None else None

    @staticmethod
    def _pick_product(candidates: list[ProductRef]) -> int | None:
        product_id = _unique(p.id for p in candidates)
        if product_id is None:
            # 廃番（is_active=false）の製品と同じ表記の現役製品があれば現役を採る
            product_id = _unique(p.id for p in candidates if p.is_active)
        return product_id

    def match_entry(self, entry: dict[str, Any]) -> EntryMatch:
        """`daily_report_entries` の1行（`*_raw` 列を持つ dict）を照合する。"""
        equipment = self.match_equipment(entry.get("equipment_raw"))
        customer = self.match_customer(entry.get("customer_raw"))
        customer_id = customer.target if customer else None
        product = self.match_product(entry.get("product_raw"), customer_id)
        process = self.match_process(entry.get("process_raw"))
        return EntryMatch(
            equipment_id=equipment.target if equipment else None,
            customer_id=customer_id,
            product_id=product.target if product else None,
            process_names=process.target if process else None,
        )

    def is_matched(
        self, kind: NameKind, raw: str, customer_raw: str | None = None
    ) -> bool:
        """表記が照合できるか。製品は顧客先の表記（`customer_raw`）も合わせて判定する。"""
        if kind == "equipment":
            return self.match_equipment(raw) is not None
        if kind == "process":
            return self.match_process(raw) is not None
        if kind == "customer":
            return self.match_customer(raw) is not None
        customer = self.match_customer(customer_raw)
        return (
            self.match_product(raw, customer.target if customer else None) is not None
        )
