"use client"

import { useEffect, useMemo, useState } from "react"
import {
  diffShippingCounts,
  parseShippingCountSnapshot,
  type ShippingCountChange,
  type ShippingCountSnapshot,
} from "@/lib/shipping-count-history"

/** sessionStorage のキー。値の形を変えたら版を上げる（古い値は `parseShippingCountSnapshot()` が捨てる） */
export const SHIPPING_COUNT_STORAGE_KEY = "product-planner:shipping-hub-counts:v1"

function readStoredSnapshot(): ShippingCountSnapshot | null {
  if (typeof window === "undefined") return null
  try {
    return parseShippingCountSnapshot(window.sessionStorage.getItem(SHIPPING_COUNT_STORAGE_KEY))
  } catch {
    // プライベートウィンドウ・サイトデータのブロック等で読めないときは増減を出さない
    return null
  }
}

function writeStoredSnapshot(serialized: string) {
  try {
    window.sessionStorage.setItem(SHIPPING_COUNT_STORAGE_KEY, serialized)
  } catch {
    // 書けなくても表示は崩さない（次に見たときに増減が出ないだけ）
  }
}

/**
 * 送品の消し込みのハブの、前回見たときからの件数の増減（Issue #694）。
 *
 * 前回の件数は**ハブを開いたときに1回だけ**読み、開いている間は変えない（取り直しで件数が変わっても、開いたときと比べる）。
 * 今の件数は取得し終えるたびに保存し、次にハブを開いたときの比較の元にする。件数は取得し終えるまで null を渡す
 * （サーバーの描画・最初の描画では件数が無いので、読み出した前回の値が描画に出ることはない）
 *
 * @param current 今の件数。取得中・取得に失敗したときは null
 */
export function useShippingCountChanges(
  current: ShippingCountSnapshot | null,
): ShippingCountChange[] {
  const [previous] = useState(readStoredSnapshot)
  const serialized = current ? JSON.stringify(current) : null

  useEffect(() => {
    if (serialized) writeStoredSnapshot(serialized)
  }, [serialized])

  return useMemo(
    () => (previous && current ? diffShippingCounts(previous, current) : []),
    [previous, current],
  )
}
