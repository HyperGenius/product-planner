/**
 * 品名から図番の初期値を読み取る（Issue #705）。日報の品名から製品を登録するときの初期値にだけ使う。
 *
 * 図番らしき番号は送品の照合（Backend `shipment_matcher._DRAWING_NO`）と同じ「数字5桁以上（前後が数字でない）」。
 * 品名の多くは「φ10×20L SUS100」のような仕様の書き方で図番を含まないので、読み取れないときは空にして
 * 利用者に入れてもらう。番号が2つ以上あるとどれが図番か決められないので空にする。
 */
const DRAWING_NO = /(?<!\d)\d{5,}(?!\d)/g

export function guessProductCode(name: string): string {
  const matches = name.normalize("NFKC").match(DRAWING_NO) ?? []
  const unique = [...new Set(matches)]
  return unique.length === 1 ? unique[0] : ""
}
