"use client"

import { PageHelp, PageHelpSection } from "@/components/page-help"
import { DEFAULT_PERIOD_MONTHS } from "@/lib/daily-report-coverage-utils"
import { STOCK_LABEL } from "@/lib/daily-report-stock-utils"
import { DAILY_REPORT_HUB_TITLE } from "@/lib/daily-report-worklist-utils"

/**
 * 日報の実績のヘルプ（Issue #707）。判定条件・データの出どころ・状態の移り変わり・設計上の原則は画面に書かず、
 * ここにまとめる（docs/ui-writing-guidelines.md の2章・7章）。ハブと各ページで共有する
 */
export function DailyReportHelp() {
  return (
    <PageHelp title={DAILY_REPORT_HUB_TITLE}>
      <PageHelpSection title="片付ける順">
        <p>
          日報の実績を受注の進捗に結び付けるには、日報の顧客先 → 製品 → 工程の順にアプリの顧客・製品・工程と結び付けます。
          顧客先が決まらないと製品を結び付けられず、製品が決まらないと工程ルートと比べられないので、前提 → ① → ② → ③
          の順に進めます。
        </p>
        <p>日報の表記・実績は、前提・①②③・参考のどれか1か所にだけ数えています。</p>
      </PageHelpSection>
      <PageHelpSection title="日報の顧客先（前提）">
        <p>
          日報の顧客先の表記のうち、アプリの顧客に結び付いていないものです。製品の結び付けは顧客ごとなので、
          顧客先が決まっていない日報の製品（顧客先が未登録・空欄・対象外）もここに置き、①には数えません。
        </p>
      </PageHelpSection>
      <PageHelpSection title="① 日報の製品をつなぐ">
        <p>
          顧客先が決まっている日報の製品の表記のうち、製品マスタに結び付いていないものです。顧客先と商品名の組ごとに1行です。
          1回結び付けると、過去・今後の日報にも反映されます。
        </p>
      </PageHelpSection>
      <PageHelpSection title="② 製品の工程を日報に合わせる">
        <p>
          製品の工程ルートが無い製品、日報の工程が工程ルートに無い製品、日報で追わない工程に実績がある製品です。製品ごとに1行です。
        </p>
        <p>
          工程マスタに無い日報の工程名もここに置きます。工程名の結び付けは製品によらず共通です。
        </p>
      </PageHelpSection>
      <PageHelpSection title="③ 受注の無い製造を確かめる">
        <p>
          製品・工程まで結び付いたのに、受注に割り付けられなかった実績です。製品・工程名・理由ごとに1行で、
          現場に聞くことを添えています。
        </p>
      </PageHelpSection>
      <PageHelpSection title="期間">
        <p>
          ②③は加工日が直近{DEFAULT_PERIOD_MONTHS}か月（今月を含む）の実績で数えます。②③のページで期間を変えると、そのページの件数も変わります。
          加工日が空欄の実績は期間にかかわらず含めます。①・前提は期間で絞りません。
        </p>
      </PageHelpSection>
      <PageHelpSection title={`${STOCK_LABEL}（参考）`}>
        <p>
          受注に割り付いていない、作っておいた品物の推定数です。日報からの推定で、正確な数は目指していません。
          工程ごとに、次の工程で使われたら減り、最後の工程なら送品で減るとみなしています。現場の実態と違うところは「違う」で直してください。
        </p>
      </PageHelpSection>
      <PageHelpSection title="結び付いた割合（参考）">
        <p>
          日報の良品数のうち、受注の工程に割り付けられた数の割合です。1行が2つの工程にまたがる表記（「カシメ、仕上げ加工」など）は工程ごとに数えます。
        </p>
      </PageHelpSection>
      <PageHelpSection title="反映のタイミング">
        <p>
          日報の取り込み後、10〜15分ごとに集計します。結び付け・工程の変更・{STOCK_LABEL}の指摘は、次の集計で②③と{STOCK_LABEL}に反映されます。
          ①・前提は結び付けたときにすぐ変わります。
        </p>
      </PageHelpSection>
      <PageHelpSection title="日報の設備">
        <p>
          設備は受注の進捗の計算に使わないので、ここには数えません。設備の表記は「登録済みの対応付け・対象外」のページで結び付けます。
        </p>
      </PageHelpSection>
    </PageHelp>
  )
}
