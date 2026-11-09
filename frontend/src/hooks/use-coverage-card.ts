"use client"

import { useLocationHash } from "@/hooks/use-location-hash"
import { toValidCoverageCard, type CoverageCard } from "@/lib/daily-report-coverage-utils"

/**
 * 照合状況で選択中のカードを URL のハッシュに持つ (Issue #639)。
 * 共有・ブックマーク・ブラウザの戻る操作で復元できる。ハッシュは `toValidCoverageCard()` で検証する。
 */
export function useCoverageCard(): [CoverageCard, (card: CoverageCard) => void] {
  const [hash, setHash] = useLocationHash()
  return [toValidCoverageCard(hash), setHash]
}
