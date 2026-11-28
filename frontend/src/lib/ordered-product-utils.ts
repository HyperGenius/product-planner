import { formatWorkDate } from "@/lib/daily-report-name-utils"
import type { OrderedProductCandidate } from "@/types/daily-report-names"

/**
 * 日報の名寄せ（製品）で、受注の製品を日報の品名に近い順に並べる (Issue #704)。
 * 並べるだけで、近さで自動確定はしない（#488）。全製品の類似検索（pg_trgm）の閾値で切ると
 * 近さの低い受注の製品が落ちるので、顧客の受注の製品の集合の中で並べる。
 */

/** 文字列を単語に分け、pg_trgm と同じく前に空白2つ・後ろに1つを足した3文字の組の集合にする */
function trigrams(text: string): Set<string> {
  const result = new Set<string>()
  const words = text
    .normalize("NFKC")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
  for (const word of words) {
    if (!word) continue
    const chars = Array.from(`  ${word} `)
    for (let i = 0; i + 3 <= chars.length; i++) {
      result.add(chars.slice(i, i + 3).join(""))
    }
  }
  return result
}

/** 3文字の組の重なり（共通 / 和集合、0〜1）。pg_trgm の similarity() と同じ考え方 */
export function trigramSimilarity(a: string, b: string): number {
  const ta = trigrams(a)
  const tb = trigrams(b)
  if (ta.size === 0 || tb.size === 0) return 0
  let shared = 0
  for (const t of ta) if (tb.has(t)) shared++
  return shared / (ta.size + tb.size - shared)
}

/**
 * 日報の品名に近い順（品名・品番の近いほう）。同じ近さなら API の並び（希望納期の近い順）のまま
 */
export function rankOrderedProducts(
  rawText: string,
  products: readonly OrderedProductCandidate[],
): OrderedProductCandidate[] {
  return products
    .map((product, index) => ({
      product,
      index,
      score: Math.max(
        trigramSimilarity(rawText, product.name),
        product.code ? trigramSimilarity(rawText, product.code) : 0,
      ),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((r) => r.product)
}

/**
 * 受注の製品に添える受注の情報。1注文なら注文番号・数量・希望納期、複数なら注文の数と直近の希望納期
 */
export function orderedProductSummary(product: OrderedProductCandidate): string {
  const deadline = product.nearest_deadline
  if (product.order_count > 1) {
    return [
      `${product.order_count.toLocaleString()}注文`,
      deadline && `直近の希望納期 ${formatWorkDate(deadline)}`,
    ]
      .filter(Boolean)
      .join("・")
  }
  return [
    product.order_number ?? product.customer_order_no,
    product.quantity !== null && `数量 ${product.quantity.toLocaleString()}`,
    deadline && `希望納期 ${formatWorkDate(deadline)}`,
  ]
    .filter(Boolean)
    .join("・")
}
