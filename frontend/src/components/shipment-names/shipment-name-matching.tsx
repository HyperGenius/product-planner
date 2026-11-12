"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { Info, Plus, X } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { CustomerPicker, TargetCombobox } from "@/components/daily-report-names/target-pickers"
import { useCustomers } from "@/hooks/use-customers"
import { useProducts } from "@/hooks/use-products"
import {
  useAddShipmentCustomerLink,
  useAddShipmentIgnored,
  useDeleteShipmentCustomerLink,
  useDeleteShipmentIgnored,
  useSetShipmentProductLink,
  useShipmentCustomers,
  useShipmentProducts,
} from "@/hooks/use-shipments"
import { useCurrentMember } from "@/hooks/use-tenant-members"
import { formatDeadlineShort, getCustomerDisplayName } from "@/lib/order-utils"
import {
  customerItemState,
  NAME_STATE_LABELS,
  PRODUCT_AUTO_METHOD_LABELS,
  productItemState,
  type ShipmentNameState,
} from "@/lib/shipment-utils"
import { cn } from "@/lib/utils"
import type { Customer } from "@/types/customer"
import type { Product } from "@/types/product"
import {
  SHIPMENT_NAME_EDITOR_ROLES,
  type ShipmentCustomerItem,
  type ShipmentProductItem,
} from "@/types/shipment"

const STATE_CLASS: Record<ShipmentNameState, string> = {
  linked: "bg-green-100 text-green-800 hover:bg-green-100",
  auto: "bg-blue-100 text-blue-800 hover:bg-blue-100",
  unmatched: "bg-red-100 text-red-800 hover:bg-red-100",
  ignored: "bg-slate-100 text-slate-600 hover:bg-slate-100",
}

type ViewFilter = "unmatched" | "all"

function StateBadge({ state }: { state: ShipmentNameState }) {
  return <Badge className={cn("whitespace-nowrap", STATE_CLASS[state])}>{NAME_STATE_LABELS[state]}</Badge>
}

function productLabel(productId: number, products?: Product[]): string {
  const product = products?.find((p) => p.id === productId)
  if (!product) return `製品 #${productId}`
  return product.code ? `${product.name}（${product.code}）` : product.name
}

/** 失敗時のトースト。409 等の文言はバックエンドの message を出す */
function onMutationError(error: Error) {
  toast.error(error.message && error.message !== "API Request Failed" ? error.message : "登録に失敗しました")
}

function CountAndDate({ count, date }: { count: number; date: string }) {
  return (
    <div className="flex flex-col leading-tight text-sm tabular-nums">
      <span>{count.toLocaleString("ja-JP")}行</span>
      <span className="text-xs text-muted-foreground">{formatDeadlineShort(date)} 売上</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 得意先
// ---------------------------------------------------------------------------

function CustomerRow({
  item,
  customers,
  canEdit,
}: {
  item: ShipmentCustomerItem
  customers?: Customer[]
  canEdit: boolean
}) {
  const addLink = useAddShipmentCustomerLink()
  const deleteLink = useDeleteShipmentCustomerLink()
  const addIgnored = useAddShipmentIgnored()
  const deleteIgnored = useDeleteShipmentIgnored()
  const state = customerItemState(item)
  const pending = addLink.isPending || deleteLink.isPending || addIgnored.isPending || deleteIgnored.isPending
  const linkedIds = new Set(item.links.map((l) => l.customer_id))

  const link = (customerId: number) =>
    addLink.mutate(
      { customer_code: item.customer_code, customer_id: customerId },
      {
        onSuccess: () => toast.success(`${getCustomerDisplayName(customerId, customers)} をひも付けました`),
        onError: onMutationError,
      },
    )

  // 商流の推定を先に、名前の一部一致を後に。ひも付け済みの顧客は出さない
  const suggestions = [
    ...item.flow_candidates.map((c) => ({
      id: c.customer_id,
      hint: `商流の推定・${c.entry_count}行`,
    })),
    ...item.name_candidate_ids.map((id) => ({ id, hint: "名前が似ている" })),
  ].filter((s, i, all) => !linkedIds.has(s.id) && all.findIndex((x) => x.id === s.id) === i)

  return (
    <TableRow>
      <TableCell className="align-top">
        <div className="flex flex-col leading-tight">
          <span className="font-medium">{item.customer_name ?? "（名前なし）"}</span>
          <span className="text-xs text-muted-foreground">コード {item.customer_code}</span>
        </div>
      </TableCell>
      <TableCell className="align-top">
        <CountAndDate count={item.entry_count} date={item.last_sales_date} />
      </TableCell>
      <TableCell className="align-top">
        <StateBadge state={state} />
      </TableCell>
      <TableCell className="align-top">
        <div className="flex flex-wrap gap-1">
          {item.links.map((l) => (
            <Badge key={l.id} variant="outline" className="gap-1 font-normal">
              {getCustomerDisplayName(l.customer_id, customers)}
              {canEdit && (
                <button
                  type="button"
                  aria-label={`${getCustomerDisplayName(l.customer_id, customers)} のひも付けを外す`}
                  className="rounded hover:bg-muted"
                  disabled={pending}
                  onClick={() => deleteLink.mutate(l.id, { onError: onMutationError })}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </Badge>
          ))}
          {item.links.length === 0 && item.auto_customer_id !== null && (
            <span className="text-sm">
              {getCustomerDisplayName(item.auto_customer_id, customers)}
              <span className="ml-1 text-xs text-muted-foreground">（得意先名で自動）</span>
            </span>
          )}
        </div>
        {item.unmatched_entry_count > 0 && state !== "ignored" && (
          <p className="mt-1 text-xs text-amber-700">
            製品が決まらない行 {item.unmatched_entry_count}行
          </p>
        )}
      </TableCell>
      <TableCell className="align-top">
        <div className="flex flex-wrap gap-1">
          {suggestions.map((s) => (
            <Button
              key={s.id}
              size="sm"
              variant="outline"
              className="h-7 gap-1 px-2 text-xs"
              disabled={!canEdit || pending}
              onClick={() => link(s.id)}
              title={s.hint}
            >
              <Plus className="h-3 w-3" />
              {getCustomerDisplayName(s.id, customers)}
              <span className="text-muted-foreground">（{s.hint}）</span>
            </Button>
          ))}
          {suggestions.length === 0 && <span className="text-xs text-muted-foreground">-</span>}
        </div>
      </TableCell>
      <TableCell className="align-top text-right">
        {canEdit && (
          <div className="flex flex-wrap justify-end gap-1">
            <CustomerPicker
              triggerLabel="顧客を追加"
              ariaLabel={`得意先 ${item.customer_code} に顧客を追加`}
              disabled={pending}
              onSelect={(id) => link(id)}
            />
            {item.ignored_id ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => deleteIgnored.mutate(item.ignored_id!, { onError: onMutationError })}
              >
                対象外を解除
              </Button>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() =>
                  addIgnored.mutate(
                    { kind: "customer", customer_code: item.customer_code },
                    { onError: onMutationError },
                  )
                }
              >
                対象外にする
              </Button>
            )}
          </div>
        )}
      </TableCell>
    </TableRow>
  )
}

// ---------------------------------------------------------------------------
// 商品
// ---------------------------------------------------------------------------

function ProductRow({
  item,
  customers,
  products,
  canEdit,
}: {
  item: ShipmentProductItem
  customers?: Customer[]
  products?: Product[]
  canEdit: boolean
}) {
  const setLink = useSetShipmentProductLink()
  const addIgnored = useAddShipmentIgnored()
  const deleteIgnored = useDeleteShipmentIgnored()
  const state = productItemState(item)
  const pending = setLink.isPending || addIgnored.isPending || deleteIgnored.isPending

  const link = (productId: number, customerId?: number) =>
    setLink.mutate(
      {
        customer_code: item.customer_code,
        product_code: item.product_code,
        product_id: productId,
        customer_id: customerId,
      },
      {
        onSuccess: () => toast.success(`${productLabel(productId, products)} に対応付けました`),
        onError: onMutationError,
      },
    )

  const currentProductId = item.link?.product_id ?? item.auto_product_id
  const allOptions = (products ?? [])
    .filter((p) => p.is_active)
    .map((p) => ({ id: p.id, label: p.name, hint: p.code ?? undefined, keywords: [p.code ?? ""] }))
  const candidateOptions = item.candidate_product_ids.map((id) => ({
    id,
    label: productLabel(id, products),
  }))

  return (
    <TableRow>
      <TableCell className="align-top">
        <div className="flex flex-col leading-tight">
          <span className="font-medium">{item.product_name ?? "（品名なし）"}</span>
          <span className="text-xs text-muted-foreground">
            コード {item.product_code}・{item.customer_name ?? item.customer_code}
          </span>
        </div>
      </TableCell>
      <TableCell className="align-top">
        <CountAndDate count={item.entry_count} date={item.last_sales_date} />
      </TableCell>
      <TableCell className="align-top">
        <StateBadge state={state} />
      </TableCell>
      <TableCell className="align-top">
        {currentProductId !== null ? (
          <div className="flex flex-col leading-tight text-sm">
            <span>{productLabel(currentProductId, products)}</span>
            {!item.link && item.auto_method && (
              <span className="text-xs text-muted-foreground">
                {PRODUCT_AUTO_METHOD_LABELS[item.auto_method]}
              </span>
            )}
          </div>
        ) : item.customer_ids.length === 0 && !item.customer_ignored ? (
          <span className="text-xs text-amber-700">得意先の顧客が未登録です</span>
        ) : (
          <span className="text-xs text-muted-foreground">-</span>
        )}
      </TableCell>
      <TableCell className="align-top">
        <div className="flex flex-wrap gap-1">
          {item.cross_customer_candidates.map((c) => {
            const customerId = c.customer_ids[0]
            const customerNames = c.customer_ids.map((id) => getCustomerDisplayName(id, customers)).join("・")
            return (
              <Button
                key={`cross-${c.product_id}`}
                size="sm"
                variant="outline"
                className="h-auto gap-1 px-2 py-1 text-left text-xs"
                disabled={!canEdit || pending || customerId === undefined}
                title="この得意先は別の会社の注文を請け負っている（商流）とみなし、得意先にその顧客もひも付けます"
                onClick={() => link(c.product_id, customerId)}
              >
                <Plus className="h-3 w-3 shrink-0" />
                <span>
                  {productLabel(c.product_id, products)}
                  <span className="block text-muted-foreground">{customerNames} の受注にあり（商流の推定）</span>
                </span>
              </Button>
            )
          })}
          {item.cross_customer_candidates.length === 0 && candidateOptions.length === 0 && (
            <span className="text-xs text-muted-foreground">-</span>
          )}
          {candidateOptions.length > 0 && (
            <span className="text-xs text-muted-foreground">似た製品 {candidateOptions.length}件（右の選択から）</span>
          )}
        </div>
      </TableCell>
      <TableCell className="align-top text-right">
        {canEdit && !item.customer_ignored && (
          <div className="flex flex-wrap justify-end gap-1">
            <TargetCombobox
              groups={[
                { heading: "この得意先の受注にある候補", options: candidateOptions },
                { heading: "すべての製品", options: allOptions },
              ]}
              triggerLabel={item.link ? "製品を変更" : "製品を選択"}
              searchPlaceholder="製品名・品番で検索..."
              emptyText="製品が見つかりません"
              ariaLabel={`商品 ${item.product_code} の製品を選択`}
              selectedId={currentProductId}
              disabled={pending}
              onSelect={(id) => link(id)}
            />
            {item.ignored_id ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => deleteIgnored.mutate(item.ignored_id!, { onError: onMutationError })}
              >
                対象外を解除
              </Button>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() =>
                  addIgnored.mutate(
                    {
                      kind: "product",
                      customer_code: item.customer_code,
                      product_code: item.product_code,
                    },
                    { onError: onMutationError },
                  )
                }
              >
                対象外にする
              </Button>
            )}
          </div>
        )}
      </TableCell>
    </TableRow>
  )
}

// ---------------------------------------------------------------------------
// 画面
// ---------------------------------------------------------------------------

function ListFrame({
  isLoading,
  isError,
  rowCount,
  emptyText,
  header,
  children,
}: {
  isLoading: boolean
  isError: boolean
  rowCount: number
  emptyText: string
  header: React.ReactNode
  children: React.ReactNode
}) {
  if (isLoading) return <p className="p-8 text-center text-muted-foreground">読み込み中...</p>
  if (isError) return <p className="p-8 text-center text-red-600">取得できませんでした</p>
  if (rowCount === 0) return <p className="p-8 text-center text-muted-foreground">{emptyText}</p>
  return (
    <div className="rounded-lg border bg-card">
      <Table>
        <TableHeader>{header}</TableHeader>
        <TableBody>{children}</TableBody>
      </Table>
    </div>
  )
}

/**
 * 弥生の名寄せ（Issue #667）。弥生の得意先 → 顧客、(得意先, 商品コード) → 製品を対応付ける。
 *
 * 対応は現場に一覧を出してもらわず、ここで直して覚える。商流（弥生の得意先＝請求先と、受注の顧客＝
 * 注文元が違う）に備え、1つの得意先に複数の顧客をひも付けられる。受注の顧客は書き換えない。
 * 推定の候補（商流・似た製品）は示すだけで、自動では確定しない
 */
export function ShipmentNameMatching() {
  const customersQuery = useShipmentCustomers()
  const productsQuery = useShipmentProducts()
  const { data: customers } = useCustomers()
  const { data: products } = useProducts()
  const { data: currentMember } = useCurrentMember()
  const role = currentMember?.role ?? null
  const canEdit = role !== null && (SHIPMENT_NAME_EDITOR_ROLES as readonly string[]).includes(role)
  const [filter, setFilter] = useState<ViewFilter>("unmatched")

  const customerItems = useMemo(() => customersQuery.data ?? [], [customersQuery.data])
  const productItems = useMemo(() => productsQuery.data ?? [], [productsQuery.data])
  const unmatchedCustomers = customerItems.filter((i) => customerItemState(i) === "unmatched")
  const unmatchedProducts = productItems.filter((i) => productItemState(i) === "unmatched")
  const visibleCustomers = filter === "unmatched" ? unmatchedCustomers : customerItems
  const visibleProducts = filter === "unmatched" ? unmatchedProducts : productItems

  return (
    <div className="container mx-auto py-6 px-4">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">弥生の名寄せ</h1>
        <p className="text-muted-foreground mt-2">
          弥生の売上明細の得意先・商品を、アプリの顧客・製品に対応付けます
        </p>
      </div>

      <div
        role="note"
        className="mb-4 flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900"
      >
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          対応付けると、次からの取り込みにも使われ、「
          <Link href="/orders/shipping" className="underline">
            送品の消し込み
          </Link>
          」に弥生の送品数量が出ます。弥生の得意先（請求先）と注文書の会社が違う場合は、得意先に注文書の会社を追加してください（受注の顧客は変わりません）。
          送料など商品ではない行は「対象外にする」を押してください
        </p>
      </div>

      <Tabs defaultValue="customers">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <TabsList>
            <TabsTrigger value="customers">得意先（未照合 {unmatchedCustomers.length}）</TabsTrigger>
            <TabsTrigger value="products">商品（未照合 {unmatchedProducts.length}）</TabsTrigger>
          </TabsList>
          <Tabs value={filter} onValueChange={(v) => setFilter(v as ViewFilter)}>
            <TabsList>
              <TabsTrigger value="unmatched">未照合のみ</TabsTrigger>
              <TabsTrigger value="all">すべて</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <TabsContent value="customers">
          <ListFrame
            isLoading={customersQuery.isLoading}
            isError={customersQuery.isError}
            rowCount={visibleCustomers.length}
            emptyText={filter === "unmatched" ? "未照合の得意先はありません" : "弥生の売上明細はまだありません"}
            header={
              <TableRow>
                <TableHead>得意先</TableHead>
                <TableHead>明細</TableHead>
                <TableHead>状態</TableHead>
                <TableHead>顧客</TableHead>
                <TableHead>候補</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            }
          >
            {visibleCustomers.map((item) => (
              <CustomerRow key={item.code_key} item={item} customers={customers} canEdit={canEdit} />
            ))}
          </ListFrame>
        </TabsContent>

        <TabsContent value="products">
          <ListFrame
            isLoading={productsQuery.isLoading}
            isError={productsQuery.isError}
            rowCount={visibleProducts.length}
            emptyText={filter === "unmatched" ? "未照合の商品はありません" : "弥生の売上明細はまだありません"}
            header={
              <TableRow>
                <TableHead>商品</TableHead>
                <TableHead>明細</TableHead>
                <TableHead>状態</TableHead>
                <TableHead>製品</TableHead>
                <TableHead>候補</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            }
          >
            {visibleProducts.map((item) => (
              <ProductRow
                key={`${item.customer_code_key}/${item.product_code_key}`}
                item={item}
                customers={customers}
                products={products}
                canEdit={canEdit}
              />
            ))}
          </ListFrame>
        </TabsContent>
      </Tabs>
    </div>
  )
}
