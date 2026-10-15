"""製品の品名から (接頭辞, 直径, 長さ, 材質) を読み取る（Issue #515）。

フィルター製品の品名は「直径×長さ 材質」の形（例: `φ10.0×20L SUS100`）だが、
φ の位置（数字の前／後）・`×` の字形・`L` の位置（`×20L` / `×L20`）・全角半角・空白・
材質の括弧が揺れて同一製品が複数レコードに分かれている。重複の統合（#515）と
新規登録・編集時の類似警告（#516）で同じ仕様の製品を見つけるために使う。

日報の製品照合の正規化 `normalize_product_name()`（daily_report_name_matcher）とは別物。
あちらは照合キーを作るだけで `L` の位置・接頭辞を吸収しない。

Storage・DB から切り離した純粋関数に保つ。
"""

import re
import unicodedata
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation

# NFKC 後の文字で判定する（全角 `Ｘ` → `X`、`＊` → `*`、`ϕ` → `φ` になる）
_PHI = "φΦØø⌀"
_TIMES = "×xX*✕"
_NUMBER = r"\d+(?:\.\d+)?"

_SPEC_PATTERN = re.compile(
    rf"""
    ^(?P<prefix>.*?)
    (?:
        [{_PHI}]\s*(?P<d1>{_NUMBER})
      | (?<![\d.])(?P<d2>{_NUMBER})\s*[{_PHI}]
    )
    \s*[{_TIMES}]\s*
    (?:
        [Ll]\s*(?P<l1>{_NUMBER})
      | (?P<l2>{_NUMBER})(?:\s*[Ll])?
    )
    (?P<material>.*)$
    """,
    re.VERBOSE | re.DOTALL,
)

# 材質の比較で無視する文字（NFKC 後）: 空白・ハイフン類・括弧類
_MATERIAL_IGNORED = re.compile(r"[\s\-‐‑‒–—―−()\[\]{}「」『』【】〔〕<>]")
_WHITESPACE = re.compile(r"\s+")


@dataclass(frozen=True)
class ProductSpec:
    """品名から読み取った仕様。

    - prefix: 品名の先頭にある会社名らしき接頭辞（表示用。前後の空白を除いたもの）。無ければ ""
    - prefix_key: 接頭辞の比較用キー（NFKC・空白除去・英字大文字化）
    - diameter / length: 数値として比べる（`Decimal("14.5") == Decimal("14.50")`）
    - material: 材質の表示用（前後の空白を除いたもの）
    - material_key: 材質の比較用キー（`normalize_material()`）
    """

    prefix: str
    prefix_key: str
    diameter: Decimal
    length: Decimal
    material: str
    material_key: str

    def same_size_and_material(self, other: "ProductSpec") -> bool:
        return (
            self.diameter == other.diameter
            and self.length == other.length
            and self.material_key == other.material_key
        )


def normalize_material(text: str) -> str:
    """材質を比較用のキーにする。全角半角・英字の大小・空白・ハイフン・括弧を無視する。"""
    return _MATERIAL_IGNORED.sub("", unicodedata.normalize("NFKC", text)).upper()


def _normalize_prefix(text: str) -> str:
    return _WHITESPACE.sub("", text).upper()


def _to_decimal(text: str) -> Decimal | None:
    try:
        return Decimal(text)
    except InvalidOperation:
        return None


def parse_product_spec(name: str) -> ProductSpec | None:
    """品名を (接頭辞, 直径, 長さ, 材質) に分ける。「直径×長さ」の形でなければ None。"""
    normalized = unicodedata.normalize("NFKC", name).strip()
    match = _SPEC_PATTERN.match(normalized)
    if not match:
        return None

    diameter = _to_decimal(match.group("d1") or match.group("d2"))
    length = _to_decimal(match.group("l1") or match.group("l2"))
    if diameter is None or length is None:
        return None

    prefix = match.group("prefix").strip()
    material = match.group("material").strip()
    return ProductSpec(
        prefix=prefix,
        prefix_key=_normalize_prefix(prefix),
        diameter=diameter,
        length=length,
        material=material,
        material_key=normalize_material(material),
    )


def format_decimal(value: Decimal) -> str:
    """`Decimal("14.50")` → `"14.5"`、`Decimal("10.0")` → `"10"`（指数表記にしない）。"""
    return format(value.normalize(), "f")
