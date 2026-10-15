"use client"

import { ScanSearch } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useProductMergeGroups } from "@/hooks/use-product-merge"
import { cn } from "@/lib/utils"
import { formatMergeSpec, mergeSpecKey } from "@/lib/product-merge-utils"
import type { ProductMergeGroup } from "@/types/product"

interface MergeGroupListProps {
  /** 選択中（候補一覧に出している）組のキー（`mergeSpecKey()`） */
  activeKey: string | null
  /** この画面で統合を実行した組のキー。再抽出するまで一覧に印を付ける */
  mergedKeys: ReadonlySet<string>
  onSelect: (group: ProductMergeGroup) => void
  /** 「候補を抽出」を押したとき（再抽出で統合済みの印を消すため） */
  onExtract: () => void
  disabled?: boolean
}

/**
 * 重複の候補の抽出（Issue #515）。「候補を抽出」を押したときだけ、品名の直径・長さ・材質が同じ製品が
 * 2件以上ある組をバックエンドで求める。組を選ぶと直径・長さ・材質を入れて候補一覧を開く。
 */
export function MergeGroupList({
  activeKey,
  mergedKeys,
  onSelect,
  onExtract,
  disabled = false,
}: MergeGroupListProps) {
  const { data, isFetching, isError, refetch } = useProductMergeGroups()
  const groups = data?.groups ?? []

  return (
    <section className="space-y-3 rounded-md border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">重複の候補の抽出</h2>
          <p className="text-sm text-muted-foreground">
            品名の直径・長さ・材質が同じ製品が2件以上ある組を一覧にします。組を選ぶと下の候補一覧に出します。
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            onExtract()
            refetch()
          }}
          disabled={isFetching || disabled}
        >
          <ScanSearch className="mr-2 h-4 w-4" />
          {isFetching ? "抽出中..." : "候補を抽出"}
        </Button>
      </div>

      {isError ? (
        <p className="text-sm text-destructive">候補の抽出に失敗しました</p>
      ) : data === undefined ? null : groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">重複の候補はありません</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{groups.length}組</p>
          <ul className="max-h-80 divide-y overflow-y-auto rounded-md border">
            {groups.map((group) => {
              const key = mergeSpecKey(group)
              return (
                <li key={key}>
                  <button
                    type="button"
                    className={cn(
                      "w-full px-3 py-2 text-left hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50",
                      key === activeKey && "bg-primary/5"
                    )}
                    disabled={disabled}
                    onClick={() => onSelect(group)}
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-medium">{formatMergeSpec(group)}</span>
                      <Badge variant="secondary">{group.product_count}件</Badge>
                      {!group.mergeable && <Badge variant="outline">接頭辞違いのみ</Badge>}
                      {mergedKeys.has(key) && <Badge>統合を実行済み</Badge>}
                    </div>
                    <p className="mt-0.5 line-clamp-2 break-all text-xs text-muted-foreground">
                      {group.product_names.join(" / ")}
                    </p>
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </section>
  )
}
