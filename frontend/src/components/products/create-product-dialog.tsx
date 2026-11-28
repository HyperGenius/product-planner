"use client"

import * as React from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SimilarProductsWarning } from "@/components/similar-products-warning"
import { useCreateProduct } from "@/hooks/use-products"
import type { Product, ProductCreate, SimilarProduct } from "@/types/product"

interface CreateProductDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 開いたときの初期値（日報の品名から登録するとき等。Issue #705） */
  initialValues?: Partial<ProductCreate>
  title?: string
  submitLabel?: string
  /** 作成中のボタンの表示 */
  submittingLabel?: string
  /** 入力欄の上に出す、何のために登録するかの表示（日報の品名と顧客先等） */
  context?: React.ReactNode
  /**
   * 作成に成功したとき。Promise を返すと、終わるまで「登録中」のまま待ってから閉じる
   * （作った製品に続けて別名を登録する等）。成功のトーストは呼び出し側で出す
   */
  onCreated: (product: Product) => void | Promise<void>
  /** 渡すと、類似製品の警告の製品を選べる（作らずにその製品を使う）。選んだら呼び出し側が閉じる */
  onSelectSimilar?: (product: SimilarProduct) => void
}

/**
 * 製品の作成ダイアログ（製品マスタ画面と日報の製品の行で共有。Issue #705）。
 * 図番・品名を入力し、似た製品があれば警告する（Issue #516。警告は作成を妨げない）。
 * 作成に失敗したら開いたままトーストを出す。
 */
export function CreateProductDialog({
  open,
  onOpenChange,
  initialValues,
  title = "製品の新規作成",
  submitLabel = "作成",
  submittingLabel = "作成中...",
  context,
  onCreated,
  onSelectSimilar,
}: CreateProductDialogProps) {
  const createMutation = useCreateProduct()
  const [submitting, setSubmitting] = React.useState(false)

  const submit = async (data: ProductCreate) => {
    setSubmitting(true)
    try {
      let product: Product
      try {
        product = await createMutation.mutateAsync(data)
      } catch (error) {
        toast.error("製品の作成に失敗しました")
        console.error(error)
        return
      }
      await onCreated(product)
      onOpenChange(false)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // 作成中に閉じると、作った製品に続く処理（別名の登録）の結果が見えなくなる
        if (!next && submitting) return
        onOpenChange(next)
      }}
    >
      {/* 説明が無いときは aria-describedby を外す（Radix の警告を出さない） */}
      <DialogContent {...(context ? {} : { "aria-describedby": undefined })}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {context && <DialogDescription asChild>{context}</DialogDescription>}
        </DialogHeader>
        {/* 中身は開いている間だけ描画されるので、開くたびに初期値から始まる */}
        <CreateProductForm
          initialValues={initialValues}
          submitLabel={submitting ? submittingLabel : submitLabel}
          submitting={submitting}
          onCancel={() => onOpenChange(false)}
          onSubmit={submit}
          onSelectSimilar={onSelectSimilar}
        />
      </DialogContent>
    </Dialog>
  )
}

function CreateProductForm({
  initialValues,
  submitLabel,
  submitting,
  onCancel,
  onSubmit,
  onSelectSimilar,
}: {
  initialValues?: Partial<ProductCreate>
  submitLabel: string
  submitting: boolean
  onCancel: () => void
  onSubmit: (data: ProductCreate) => void
  onSelectSimilar?: (product: SimilarProduct) => void
}) {
  const [code, setCode] = React.useState(initialValues?.code ?? "")
  const [name, setName] = React.useState(initialValues?.name ?? "")
  const codeId = React.useId()
  const nameId = React.useId()

  const handleSubmit = () => {
    if (!code.trim()) {
      toast.error("図番を入力してください")
      return
    }
    if (!name.trim()) {
      toast.error("品名を入力してください")
      return
    }
    onSubmit({ name: name.trim(), code: code.trim() })
  }

  return (
    <>
      <div className="grid gap-4 py-4">
        <div className="grid gap-2">
          <Label htmlFor={codeId}>図番 *</Label>
          <Input
            id={codeId}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="例: A-001"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={nameId}>品名 *</Label>
          <Input
            id={nameId}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例: 製品A"
          />
        </div>
        <SimilarProductsWarning
          name={name}
          onSelect={onSelectSimilar && !submitting ? onSelectSimilar : undefined}
        />
      </div>
      <DialogFooter>
        <Button variant="outline" disabled={submitting} onClick={onCancel}>
          キャンセル
        </Button>
        <Button onClick={handleSubmit} disabled={submitting}>
          {submitLabel}
        </Button>
      </DialogFooter>
    </>
  )
}
