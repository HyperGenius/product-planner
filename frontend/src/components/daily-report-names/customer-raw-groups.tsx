"use client"

import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  unmatchedNameKey,
  type CustomerRawGroup,
  type CustomerRawGroups,
} from "@/lib/daily-report-name-utils"
import {
  DAILY_REPORT_PREREQUISITE_PRODUCT_UNIT,
  DAILY_REPORT_WORK_META,
  dailyReportPageHref,
} from "@/lib/daily-report-worklist-utils"
import type { UnmatchedName } from "@/types/daily-report-names"
import { KIND_LIST_CLASS, kindColorStyle } from "./kind-tabs"
import { UnmatchedNameRow } from "./unmatched-name-list"

const productCountLabel = (count: number) => `${count}${DAILY_REPORT_PREREQUISITE_PRODUCT_UNIT}`

/**
 * 未登録の日報の顧客先ごとのまとまり（Issue #703）。顧客先の行に [顧客を選ぶ] を1つ置き、その下に顧客先の製品を並べる。
 * 製品の行の操作は「対象外」だけ（顧客先が決まるまで製品は結び付けられない）。顧客を選ぶと製品は①へ移る
 */
export function UnregisteredCustomerGroups({
  groups,
  canEdit,
  emptyMessage,
}: {
  groups: CustomerRawGroups["unregistered"]
  canEdit: boolean
  emptyMessage: string
}) {
  if (groups.length === 0) {
    return (
      <p
        className="rounded-lg border border-t-4 border-t-[var(--kind-color)] bg-card py-8 text-center text-sm text-muted-foreground"
        style={kindColorStyle("customer")}
      >
        {emptyMessage}
      </p>
    )
  }
  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <UnregisteredCustomerGroup
          key={unmatchedNameKey(group.customer)}
          group={group}
          canEdit={canEdit}
        />
      ))}
    </div>
  )
}

function UnregisteredCustomerGroup({
  group,
  canEdit,
}: {
  group: Extract<CustomerRawGroup, { type: "unregistered" }>
  canEdit: boolean
}) {
  const router = useRouter()
  // 登録後は一覧を取り直してこのまとまりが消えるので、品名の数は登録前のまとまりから数える
  const productCount = group.products.length
  const onMapped = (targetLabel: string) => {
    const message = `顧客先「${group.customerRaw}」を${targetLabel}に結び付けました`
    if (productCount === 0) {
      toast.success(message)
      return
    }
    toast.success(message, {
      description: `${productCountLabel(productCount)}を製品に結び付けられるようになりました`,
      action: {
        label: DAILY_REPORT_WORK_META.products.label,
        onClick: () => router.push(dailyReportPageHref("products")),
      },
    })
  }

  return (
    <section
      aria-label={`顧客先「${group.customerRaw}」`}
      className={KIND_LIST_CLASS}
      style={kindColorStyle("customer")}
    >
      <ul className="divide-y">
        <UnmatchedNameRow
          item={group.customer}
          canEdit={canEdit}
          summary={productCountLabel(productCount)}
          onMapped={onMapped}
        />
        {productCount > 0 && (
          <li>
            <GroupProducts products={group.products} canEdit={canEdit} />
          </li>
        )}
      </ul>
    </section>
  )
}

/**
 * 顧客を選べない製品のまとまり（顧客先が空欄・対象外にした顧客先、Issue #703）。製品は対象外にだけできる
 */
export function UnresolvedCustomerGroups({
  groups,
  canEdit,
}: {
  groups: CustomerRawGroups["unresolved"]
  canEdit: boolean
}) {
  return (
    <div className="space-y-3">
      {groups.map((group) => {
        const heading =
          group.type === "blank" ? "顧客先が空欄" : `対象外にした顧客先「${group.customerRaw}」`
        return (
          <section
            key={group.type === "blank" ? "blank" : JSON.stringify(group.customerRaw)}
            aria-label={heading}
            className={KIND_LIST_CLASS}
            style={kindColorStyle("product")}
          >
            <h3 className="flex flex-wrap items-baseline gap-x-3 px-3 py-2 font-medium">
              <span className="break-all">{heading}</span>
              <span className="text-sm tabular-nums">
                {productCountLabel(group.products.length)}
              </span>
            </h3>
            <GroupProducts products={group.products} canEdit={canEdit} />
          </section>
        )
      })}
    </div>
  )
}

/** まとまりの中の製品の行。顧客先は見出しに出しているので行には出さない */
function GroupProducts({
  products,
  canEdit,
}: {
  products: readonly UnmatchedName[]
  canEdit: boolean
}) {
  return (
    <ul aria-label="日報の製品" className="divide-y border-t bg-muted/20 pl-6">
      {products.map((product) => (
        <UnmatchedNameRow
          key={unmatchedNameKey(product)}
          item={product}
          canEdit={canEdit}
          showCustomerRaw={false}
        />
      ))}
    </ul>
  )
}
