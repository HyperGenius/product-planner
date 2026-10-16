"use client"

import Link from "next/link"
import { AlertTriangle, ExternalLink } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { useSimilarProducts } from "@/hooks/use-products"
import type { SimilarProduct } from "@/types/product"

/** 入力が止まってから類似製品を問い合わせるまでの待ち時間 */
export const SIMILAR_PRODUCTS_DEBOUNCE_MS = 400

interface Props {
  /** 入力中の品名 */
  name: string
  /** 編集中の製品の ID（新規作成は null）。一覧から除く */
  excludeId?: number | null
  /** 編集時の元の品名。品名を変更していない間は警告しない */
  originalName?: string
}

function routingStatus(product: SimilarProduct): string {
  if (!product.has_process) return "工程未登録"
  if (product.has_unconfirmed_process) return "工程あり（未確定）"
  return "工程あり"
}

/**
 * 製品の新規作成・編集ダイアログの「似た製品があります」警告（Issue #516）。
 * 警告は登録・保存を妨げない（ボタンの活性には関与しない）。
 */
export function SimilarProductsWarning({
  name,
  excludeId = null,
  originalName,
}: Props) {
  const trimmed = name.trim()
  const debounced = useDebouncedValue(trimmed, SIMILAR_PRODUCTS_DEBOUNCE_MS)
  const isOriginal = (value: string) =>
    originalName !== undefined && value === originalName.trim()
  // 問い合わせの可否は問い合わせる品名（デバウンス後）で決める。入力中の値で決めると、
  // デバウンス待ちの間に元の品名で問い合わせてしまう
  const { data } = useSimilarProducts(debounced, excludeId, !isOriginal(debounced))

  // デバウンス待ちの間や品名を戻した直後に、古い結果を出さない
  if (isOriginal(trimmed) || trimmed !== debounced) return null
  const products = data?.products ?? []
  if (products.length === 0) return null

  return (
    <div
      role="alert"
      className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
    >
      <p className="flex items-center gap-1.5 font-medium">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        似た製品があります（直径・長さ・材質が同じ）
      </p>
      <p className="mt-1 text-xs">
        重複登録でないか確認してください。このまま登録・保存もできます。
      </p>
      <ul className="mt-2 space-y-1.5">
        {products.map((product) => (
          <li
            key={product.id}
            className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded bg-white/70 px-2 py-1.5"
          >
            {product.prefix_differs && (
              <Badge variant="destructive" className="shrink-0">
                接頭辞: {product.prefix || "なし"}
              </Badge>
            )}
            <span className="font-medium">{product.name}</span>
            <span className="text-xs text-muted-foreground">
              図番: {product.code ?? "未設定"}
            </span>
            <span className="text-xs text-muted-foreground">
              {routingStatus(product)}
            </span>
            {!product.is_active && <Badge variant="secondary">無効</Badge>}
            <Link
              href={`/master/products?highlight=${product.id}`}
              target="_blank"
              rel="noreferrer"
              className="ml-auto inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline"
            >
              製品マスタで開く
              <ExternalLink className="h-3 w-3" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
