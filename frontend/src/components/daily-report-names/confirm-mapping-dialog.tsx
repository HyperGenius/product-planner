"use client"

import { ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { NAME_KIND_LABELS, type NameKind } from "@/types/daily-report-names"
import { ProductOrderStatus } from "./customer-open-orders"

/** 確認待ちの操作。行ごとに1つだけ持つ (Issue #645) */
export type PendingNameAction =
  | {
      type: "map"
      kind: NameKind
      rawText: string
      /** 製品のときだけ。別名は顧客単位なので、どの顧客先の表記かを見せる */
      customerRaw?: string | null
      targetLabel: string
      /** 類似候補から選んだときだけ（0〜1） */
      score?: number
      /** 製品のときだけ。選んだ製品の、その顧客の受注状況を見せる (Issue #646) */
      productRef?: { customerId: number; productId: number }
    }
  | { type: "ignore"; kind: NameKind; rawText: string; customerRaw?: string | null }

interface ConfirmMappingDialogProps {
  pending: PendingNameAction | null
  busy: boolean
  onConfirm: () => void
  /** キャンセル・背景クリック・Esc。実行中は呼ばれない */
  onCancel: () => void
}

/**
 * 未照合キューの対応付け・対象外の確認ダイアログ (Issue #645)。
 * 確定ボタンは `AlertDialogAction` ではなく通常の `Button`（クリックで勝手に閉じず、
 * ミューテーションの完了後に呼び出し側が閉じる。失敗時は開いたまま）。
 */
export function ConfirmMappingDialog({
  pending,
  busy,
  onConfirm,
  onCancel,
}: ConfirmMappingDialogProps) {
  const isMap = pending?.type === "map"
  return (
    <AlertDialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open && !busy) onCancel()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {isMap ? "この対応付けで登録しますか？" : "この表記を対象外にしますか？"}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              {pending && (
                <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-sm text-foreground">
                  <p className="text-xs text-muted-foreground">
                    {NAME_KIND_LABELS[pending.kind]}
                    {pending.kind === "product" && `（顧客先: ${pending.customerRaw ?? "空欄"}）`}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="break-all font-medium">{pending.rawText}</span>
                    {pending.type === "map" ? (
                      <>
                        <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="break-all font-medium">{pending.targetLabel}</span>
                        {pending.score !== undefined && (
                          <span className="text-xs text-muted-foreground">
                            類似度 {Math.round(pending.score * 100)}%
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">→ 対象外</span>
                    )}
                  </div>
                </div>
              )}
              {pending?.type === "map" && pending.productRef && (
                <ProductOrderStatus
                  customerId={pending.productRef.customerId}
                  productId={pending.productRef.productId}
                />
              )}
              <p>
                {isMap
                  ? "過去・今後の日報にも自動で反映されます（集計は10〜15分ごと）。"
                  : "未照合の一覧に出なくなります。元に戻すには「対象外」タブから解除します。"}
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button variant="outline" disabled={busy} onClick={onCancel}>
            キャンセル
          </Button>
          <Button disabled={busy} onClick={onConfirm}>
            {busy ? "登録中..." : isMap ? "登録する" : "対象外にする"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
