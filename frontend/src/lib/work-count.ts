/**
 * ハブ・作業の一覧のページに出す件数（送品の消し込み #692、日報の実績 #707）。
 * 取得中は「－」、取得に失敗したら「取得できませんでした」にし、途中の件数を出さない
 */

/** 作業の件数。`value` は取得中・取得に失敗したときは null */
export interface WorkCount {
  value: number | null
  isError: boolean
  /** 一覧が上限で切られていて、実際はこの件数より多い（「以上」と付ける） */
  atLeast?: boolean
}

/** 件数の表示（単位付き）。取得中は「－」、取得に失敗したら「取得できませんでした」 */
export function formatWorkCount(count: WorkCount, unit: string): string {
  if (count.isError) return "取得できませんでした"
  if (count.value === null) return "－"
  return `${count.value}${unit}${count.atLeast ? "以上" : ""}`
}
