"use client"

import { useEffect } from "react"
import { toast } from "sonner"

/** 一括処理が途中で中断されたことを、次にこの画面を開いたときに知らせるための印（localStorage） */
export const BULK_INTERRUPTED_STORAGE_KEY = "bulk-operation-interrupted"

export interface BulkProgress {
  /** 処理の名前（例: 「一括承認」）。中断の通知文に使う */
  label: string
  done: number
  total: number
}

interface InterruptedMark {
  label: string
  done: number
  total: number
}

function writeMark(mark: InterruptedMark) {
  try {
    window.localStorage.setItem(BULK_INTERRUPTED_STORAGE_KEY, JSON.stringify(mark))
  } catch {
    // ストレージ無効の端末では次回の通知を諦める（離脱時の確認ダイアログは別に出る）
  }
}

/** 保存値は別の版・端末が書いたものかもしれない外部入力なので、形を確かめてから使う */
function readMark(): InterruptedMark | null {
  try {
    const raw = window.localStorage.getItem(BULK_INTERRUPTED_STORAGE_KEY)
    if (!raw) return null
    window.localStorage.removeItem(BULK_INTERRUPTED_STORAGE_KEY)
    const v: unknown = JSON.parse(raw)
    if (!v || typeof v !== "object") return null
    const { label, done, total } = v as Record<string, unknown>
    if (typeof label !== "string" || !Number.isInteger(done) || !Number.isInteger(total)) return null
    return { label, done: done as number, total: total as number }
  } catch {
    return null
  }
}

/**
 * 一括処理（注文を1件ずつ API へ送るループ）の離脱対策（タブを閉じる・リロードするとループが止まり、残りは処理されない）。
 *
 * - 実行中（`progress` が非 null）は、タブを閉じる・リロードする前にブラウザの確認ダイアログを出す
 *   （`beforeunload`。アプリ内の画面遷移ではループは止まらないので対象外）
 * - それでも離脱された場合は途中までの件数を残し、次にこの画面を開いたとき toast で知らせる
 *   （`pagehide`。離脱の瞬間にはページが消えるので toast は出せない）
 *
 * 1件ごとに確定するので、処理済みの注文はそのまま有効で、残りが未処理になるだけ（半端な状態は残らない）。
 */
export function useBulkLeaveGuard(progress: BulkProgress | null) {
  // 前回の離脱で中断された一括処理があれば知らせる（開いた直後に1回）
  useEffect(() => {
    const mark = readMark()
    if (!mark) return
    const remaining = Math.max(mark.total - mark.done, 0)
    toast.warning(
      `前回の${mark.label}は画面を閉じたため途中で中断されました（${mark.done} / ${mark.total}件まで処理済み）。` +
        `残り ${remaining}件は未処理です。一覧で状態を確認してください`,
      { duration: Infinity, closeButton: true },
    )
  }, [])

  const active = progress !== null
  const label = progress?.label
  const done = progress?.done
  const total = progress?.total
  useEffect(() => {
    if (!active || label === undefined || done === undefined || total === undefined) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      // 古いブラウザは returnValue の設定が必要
      e.returnValue = ""
    }
    const onPageHide = () => writeMark({ label, done, total })
    window.addEventListener("beforeunload", onBeforeUnload)
    window.addEventListener("pagehide", onPageHide)
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload)
      window.removeEventListener("pagehide", onPageHide)
    }
  }, [active, label, done, total])
}
