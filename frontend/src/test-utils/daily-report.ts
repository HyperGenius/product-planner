import { FORBIDDEN_UI_TEXT } from "@/test-utils/shipping"

/**
 * 日報の実績の画面に出さない語（Issue #702、docs/ui-writing-guidelines.md の5章）。
 * 送品の消し込みと共通の内部語に、日報の割り付けの内部語（割り付け・未割当）・類似度・キューを足す。
 * ヘルプ（開いたときだけ描画される）は対象外
 */
export const DAILY_REPORT_FORBIDDEN_UI_TEXT = new RegExp(
  `${FORBIDDEN_UI_TEXT.source}|割り付|割付|未割当|類似度|キュー`,
)
