"use client"

import { ListPlus } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { productLabel, type ProductWithoutRoutings } from "@/lib/daily-report-coverage-utils"

/**
 * 日報に実績があるのに工程ルートが1件も無い製品 (Issue #542)。
 * 工程を登録すると、次の集計から割り付けの対象になる。
 */
export function ProductsWithoutRoutings({
  products,
  canOpenRouting,
  onEditRouting,
}: {
  products: ProductWithoutRoutings[]
  canOpenRouting: (productId: number) => boolean
  onEditRouting: (productId: number) => void
}) {
  if (products.length === 0) return null

  return (
    <section className="space-y-2" aria-labelledby="products-without-routings">
      <div>
        <h2 id="products-without-routings" className="text-lg font-semibold">
          工程ルートが無い製品
          <Badge variant="secondary" className="ml-2 align-middle">
            {products.length}
          </Badge>
        </h2>
        <p className="text-sm text-muted-foreground">
          日報に実績があるのに、工程が1件も登録されていない製品です。工程を登録すると次の集計から割り付けの対象になります。
        </p>
      </div>
      <ul className="divide-y rounded-lg border bg-card">
        {products.map((product) => (
          <li
            key={product.product_id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5"
          >
            <div className="min-w-[min(100%,16rem)] flex-1 space-y-1">
              <p className="break-all font-medium">{productLabel(product)}</p>
              <p className="text-xs text-muted-foreground">
                日報に出てきた工程: {product.process_names.join("、")}
              </p>
            </div>
            <span className="text-sm tabular-nums">
              {product.qty.toLocaleString()} 個
              <span className="ml-1 text-xs text-muted-foreground">
                {product.row_count.toLocaleString()} 行
              </span>
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={!canOpenRouting(product.product_id)}
              onClick={() => onEditRouting(product.product_id)}
            >
              <ListPlus />
              工程を登録
            </Button>
          </li>
        ))}
      </ul>
    </section>
  )
}
