"use client"

import * as React from "react"
import { toValidCoverageCard, type CoverageCard } from "@/lib/daily-report-coverage-utils"

function subscribe(onChange: () => void) {
  window.addEventListener("hashchange", onChange)
  return () => window.removeEventListener("hashchange", onChange)
}

const getSnapshot = () => window.location.hash
const getServerSnapshot = () => ""

/**
 * 照合状況で選択中のカードを URL のハッシュに持つ (Issue #639)。
 * 共有・ブックマーク・ブラウザの戻る操作で復元できる。ハッシュは `toValidCoverageCard()` で検証する。
 */
export function useCoverageCard(): [CoverageCard, (card: CoverageCard) => void] {
  const hash = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const select = React.useCallback((card: CoverageCard) => {
    window.location.hash = card
  }, [])
  return [toValidCoverageCard(hash), select]
}
