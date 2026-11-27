"use client"

import { PageHelp, PageHelpSection } from "@/components/page-help"
import { SHIPMENT_UNMATCHED_DAYS } from "@/hooks/use-shipments"
import { ORDER_REVIEW_CAUSES, ORDER_REVIEW_CAUSE_META } from "@/lib/shipping-review-utils"

/**
 * 送品の消し込みのヘルプ（Issue #692）。判定条件・データの出どころ・状態の移り変わり・設計上の原則は画面に書かず、
 * ここにまとめる（docs/ui-writing-guidelines.md の2章・7章）
 */
export function ShippingHelp() {
  return (
    <PageHelp title="送品の消し込み">
      <PageHelpSection title="片付ける順">
        <p>
          未登録の得意先・商品と、送り先の受注を決められない明細を先に片付けてから、① → ② → ③
          の順に進めます。
        </p>
      </PageHelpSection>
      <PageHelpSection title="① 送品済みにする">
        <p>
          確定済・生産中の注文のうち、弥生の売上明細の数量（分納・赤伝を合算）が受注数量に達したものです。
          送品の記録は弥生が正なので、自動では送品済みにしません。内容を見て1件ずつ押してください（社長・受注担当）。
        </p>
      </PageHelpSection>
      <PageHelpSection title="② 出荷を確かめる">
        <p>
          弥生の数量が受注数量に届いていない注文のうち、最終工程が完了した・納期を過ぎた・納期まで7日未満のものです。
          納期は希望納期、無ければ完成見込みです。
        </p>
        <p>
          弥生でまだ確かめられていないので、ここでは送品済みにしません。弥生に計上された明細が取り込まれると①に移ります。
        </p>
        <p>
          「弥生の送品」の「未計上」は、弥生にこの注文の明細が1つも無いことを表します。納期が取り込んだ明細の最新の売上日より後の注文は、
          まだ弥生に載っていないのが当然なので「取り込み待ち」と出し、一覧の後ろに並べます。
        </p>
      </PageHelpSection>
      <PageHelpSection title="③ 受注を起票する">
        <p>
          得意先・商品はアプリに登録済みなのに、対応する受注が無い弥生の明細です。得意先・商品コードごとにまとめ、
          弥生の表記は最新の明細の値を出しています。
        </p>
      </PageHelpSection>
      <PageHelpSection title="未登録の得意先・商品">
        <p>
          弥生の得意先・商品をアプリの顧客・製品に名寄せすると、その明細が受注と結び付き、①や③の件数が変わります。
        </p>
      </PageHelpSection>
      <PageHelpSection title="送り先の受注を決められない明細">
        <p>
          同じ顧客・製品の受注が複数あり、どの受注の送品か決まらない明細です。決まらない間は、その数量は受注に入らないため、
          ①に進めません。受注の顧客注文番号・希望納期が弥生の備考と合うと決まります。
        </p>
      </PageHelpSection>
      <PageHelpSection title="日報が未入力の出荷済み注文">
        <p>
          弥生の送品数量が、日報で追う最後の工程の良品数を超えている注文です。原因ごとに出しています。
        </p>
        <ul className="list-disc space-y-1 pl-5">
          {ORDER_REVIEW_CAUSES.map((cause) => (
            <li key={cause}>
              <span className="font-medium text-foreground">
                {ORDER_REVIEW_CAUSE_META[cause].label}
              </span>
              : {ORDER_REVIEW_CAUSE_META[cause].hint}
            </li>
          ))}
        </ul>
        <p>直したマスタは、次の日報の集計の後に反映されます。</p>
      </PageHelpSection>
      <PageHelpSection title="データの範囲と鮮度">
        <p>
          弥生の明細は、取り込んだ明細の最新の売上日から{SHIPMENT_UNMATCHED_DAYS}日分を見ています。
          件数が多いときは一部だけを数え、件数に「以上」と付けます。
        </p>
        <p>
          画面上部の「弥生」は取り込んだ売上明細の最新の売上日、「日報」は日報の進捗を集計した時刻です。
        </p>
      </PageHelpSection>
    </PageHelp>
  )
}
