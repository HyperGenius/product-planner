"use client"

import { useState, type FormEvent } from "react"
import Link from "next/link"
import { AlertTriangle, ArrowLeft, Search } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  useMergeProducts,
  useProductMergeCandidates,
  useProductMergePreview,
} from "@/hooks/use-product-merge"
import { useCurrentMember } from "@/hooks/use-tenant-members"
import { ApiError } from "@/lib/api-client"
import { blockerMessage, selectMergeProductIds } from "@/lib/product-merge-utils"
import { PRODUCT_MERGE_ROLES } from "@/types/member"
import type {
  ProductMergeCandidatesParams,
  ProductMergeCandidatesResponse,
} from "@/types/product"
import { MergeCandidateTable } from "./merge-candidate-table"
import { MergeConfirmDialog } from "./merge-confirm-dialog"

/**
 * 重複製品の統合画面（Issue #515）。表記ゆれで重複登録された製品を、直径・長さ・材質で探して
 * 残す1件に統合する。初回の整理で使う想定で、1グループずつ人が確認して実行する。
 */
export function ProductMerge() {
  const { data: member, isLoading } = useCurrentMember()
  const canMerge = member != null && PRODUCT_MERGE_ROLES.includes(member.role)

  return (
    <div className="space-y-6 py-10">
      <div>
        <Link
          href="/master/products"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          製品マスタ
        </Link>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">重複製品の統合</h1>
        <p className="text-muted-foreground">
          品名の表記ゆれで重複登録された製品を1件にまとめます。受注・スケジュール・別名は残す製品へ付け替わり、統合した製品と工程は削除されます。
        </p>
      </div>
      {isLoading ? (
        <div className="py-10 text-center">読み込み中...</div>
      ) : canMerge ? (
        <ProductMergeWorkspace />
      ) : (
        <p className="text-sm text-muted-foreground">
          製品の統合は社長・プラットフォーム管理者が行えます。
        </p>
      )}
    </div>
  )
}

interface Selection {
  source: ProductMergeCandidatesResponse | undefined
  keepId: number | null
  excludedIds: ReadonlySet<number>
}

/** 全角の数字・記号を半角にして前後の空白を除く */
function normalizeInput(value: string): string {
  return value.normalize("NFKC").trim()
}

function isPositiveNumber(value: string): boolean {
  return /^\d+(\.\d+)?$/.test(value) && Number(value) > 0
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    const detail = error.data.detail
    if (typeof detail === "string") return detail
    if (detail && typeof detail === "object" && !Array.isArray(detail)) {
      const message = (detail as Record<string, unknown>).message
      if (typeof message === "string") return message
    }
  }
  return fallback
}

function ProductMergeWorkspace() {
  const [form, setForm] = useState({ diameter: "", length: "", material: "" })
  const [params, setParams] = useState<ProductMergeCandidatesParams | null>(null)
  const [isConfirmOpen, setIsConfirmOpen] = useState(false)

  const candidatesQuery = useProductMergeCandidates(params)
  const data = candidatesQuery.data

  // 候補が変わったら（検索し直し・統合後の再取得）残す製品を初期選択に戻す
  const [selection, setSelection] = useState<Selection>({
    source: undefined,
    keepId: null,
    excludedIds: new Set(),
  })
  if (selection.source !== data) {
    setSelection({
      source: data,
      keepId: data?.default_keep_product_id ?? null,
      excludedIds: new Set(),
    })
  }

  const candidates = data?.candidates ?? []
  const keep = candidates.find((c) => c.id === selection.keepId) ?? null
  const mergeIds = selectMergeProductIds(candidates, selection.keepId, selection.excludedIds)
  const mergeProducts = candidates.filter((c) => mergeIds.includes(c.id))
  const request =
    keep !== null && mergeIds.length > 0
      ? { keep_product_id: keep.id, merge_product_ids: mergeIds }
      : null

  const previewQuery = useProductMergePreview(request)
  const preview = request ? previewQuery.data : undefined
  const blockers = preview?.blockers ?? []
  const mergeMutation = useMergeProducts()
  const canExecute =
    request !== null && preview !== undefined && !previewQuery.isFetching && blockers.length === 0

  const diameter = normalizeInput(form.diameter)
  const length = normalizeInput(form.length)
  const canSearch = isPositiveNumber(diameter) && isPositiveNumber(length)

  const handleSearch = (e: FormEvent) => {
    e.preventDefault()
    if (!canSearch) return
    setParams({ diameter, length, material: normalizeInput(form.material) })
  }

  const handleExcludedChange = (id: number, excluded: boolean) => {
    setSelection((prev) => {
      const next = new Set(prev.excludedIds)
      if (excluded) next.add(id)
      else next.delete(id)
      return { ...prev, excludedIds: next }
    })
  }

  const handleConfirm = async () => {
    if (!request) return
    try {
      const counts = await mergeMutation.mutateAsync(request)
      toast.success(`${counts.products_deleted}件の製品を統合しました`)
      setIsConfirmOpen(false)
      setSelection((prev) => ({ ...prev, keepId: null, excludedIds: new Set() }))
    } catch (error) {
      toast.error(errorMessage(error, "製品の統合に失敗しました"))
      if (error instanceof ApiError && error.status === 409) {
        // 実行前の再検証で止まった・他の操作と競合した: 最新の状況を出し直す
        setIsConfirmOpen(false)
        candidatesQuery.refetch()
        previewQuery.refetch()
      }
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleSearch} className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="merge-diameter">直径 *</Label>
          <Input
            id="merge-diameter"
            inputMode="decimal"
            className="w-[110px]"
            placeholder="例: 10.0"
            value={form.diameter}
            onChange={(e) => setForm({ ...form, diameter: e.target.value })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="merge-length">長さ *</Label>
          <Input
            id="merge-length"
            inputMode="decimal"
            className="w-[110px]"
            placeholder="例: 20"
            value={form.length}
            onChange={(e) => setForm({ ...form, length: e.target.value })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="merge-material">材質</Label>
          <Input
            id="merge-material"
            className="w-[160px]"
            placeholder="例: SUS100"
            value={form.material}
            onChange={(e) => setForm({ ...form, material: e.target.value })}
          />
        </div>
        <Button type="submit" disabled={!canSearch}>
          <Search className="mr-2 h-4 w-4" />
          候補を検索
        </Button>
      </form>
      <p className="text-xs text-muted-foreground">
        φ の位置・× の字形・全角半角・空白・材質の括弧の違いは区別せずに探します。無効な製品も候補に含みます。
      </p>

      {params === null ? null : candidatesQuery.isLoading ? (
        <div className="py-10 text-center">読み込み中...</div>
      ) : candidatesQuery.isError ? (
        <p className="text-sm text-destructive">候補の取得に失敗しました</p>
      ) : candidates.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          条件に一致する製品がありません
        </p>
      ) : (
        <>
          {data?.default_keep_product_id === null && (
            <p className="text-sm text-muted-foreground">
              工程の登録状況が同じ候補が複数あるため、残す製品を選んでください。
            </p>
          )}
          <MergeCandidateTable
            candidates={candidates}
            keepId={selection.keepId}
            excludedIds={selection.excludedIds}
            onKeepChange={(id) =>
              setSelection((prev) => ({ ...prev, keepId: id, excludedIds: new Set() }))
            }
            onExcludedChange={handleExcludedChange}
            disabled={mergeMutation.isPending}
          />

          {blockers.length > 0 && (
            <div
              role="alert"
              className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
            >
              <p className="flex items-center gap-1.5 font-medium text-destructive">
                <AlertTriangle className="h-4 w-4" />
                統合できない理由があります
              </p>
              <ul className="list-disc space-y-0.5 pl-5">
                {blockers.map((b, i) => (
                  <li key={i}>
                    「{b.product_name}」: {blockerMessage(b)}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">
                受注の製品・納期の付け替えや工程の登録を手作業で行ってから、もう一度お試しください。該当の製品のチェックを外すと、それ以外を統合できます。
              </p>
            </div>
          )}
          {previewQuery.isError && request !== null && (
            <p className="text-sm text-destructive">
              {errorMessage(previewQuery.error, "統合内容の確認に失敗しました")}
            </p>
          )}

          <div className="flex items-center justify-end gap-3">
            {keep === null ? (
              <span className="text-sm text-muted-foreground">残す製品を選んでください</span>
            ) : mergeIds.length === 0 ? (
              <span className="text-sm text-muted-foreground">統合する製品がありません</span>
            ) : null}
            <Button
              variant="destructive"
              disabled={!canExecute || mergeMutation.isPending}
              onClick={() => setIsConfirmOpen(true)}
            >
              {mergeIds.length > 0 ? `${mergeIds.length}件を統合` : "統合"}
            </Button>
          </div>
        </>
      )}

      {keep !== null && preview !== undefined && (
        <MergeConfirmDialog
          open={isConfirmOpen}
          onOpenChange={setIsConfirmOpen}
          keep={keep}
          mergeProducts={mergeProducts}
          preview={preview}
          isPending={mergeMutation.isPending}
          onConfirm={handleConfirm}
        />
      )}
    </div>
  )
}
