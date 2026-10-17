"use client"

import { useState, type ReactNode } from "react"
import { ScanSearch } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
  /** 一覧の下に出す補助の操作（仕様を指定して探す） */
  children?: ReactNode
}

/** 絞り込みの比較用。全角半角・英字の大小・空白の違いを無視する */
function normalizeFilter(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/\s+/g, "")
}

function matchesFilter(group: ProductMergeGroup, filter: string): boolean {
  if (filter === "") return true
  const haystack = normalizeFilter([formatMergeSpec(group), ...group.product_names].join(" "))
  return haystack.includes(filter)
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
  children,
}: MergeGroupListProps) {
  const { data, isFetching, isError, refetch } = useProductMergeGroups()
  const [filterText, setFilterText] = useState("")
  const allGroups = data?.groups ?? []
  const filter = normalizeFilter(filterText)
  const groups = allGroups.filter((group) => matchesFilter(group, filter))

  return (
    <section className="space-y-3 rounded-md border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">① 重複の組を探す</h2>
          <p className="text-sm text-muted-foreground">
            品名の直径・長さ・材質が同じ製品が2件以上ある組を一覧にします。組を選ぶと下の「② 統合する」に候補が出ます。
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
      ) : data === undefined ? (
        <p className="py-2 text-sm text-muted-foreground">
          {isFetching
            ? "抽出中..."
            : "「候補を抽出」を押すと、重複している組が一覧に出ます。"}
        </p>
      ) : allGroups.length === 0 ? (
        <p className="text-sm text-muted-foreground">重複の候補はありません</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              <span>{allGroups.length}組</span>
              <span className="ml-2 text-xs">（統合できる組 → 件数の多い順）</span>
            </p>
            <Input
              aria-label="組を絞り込む"
              className="w-[220px]"
              placeholder="品名・仕様で絞り込む（例: BSW150）"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
            />
          </div>
          {groups.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              条件に一致する組がありません
            </p>
          ) : (
            <ul className="max-h-[28rem] divide-y overflow-y-auto rounded-md border">
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
          )}
        </>
      )}
      {children}
    </section>
  )
}
