"use client"

import type { ReactNode } from "react"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { SourceEmailPanel } from "@/components/orders/source-email-panel"
import type { Order } from "@/types/order"

interface OrderDialogLayoutProps {
  order: Order
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  /** 右側（メール起票でない注文は全幅）に並べる項目 */
  children: ReactNode
  footer: ReactNode
}

/**
 * 注文の編集モーダル（EditOrderDialog）と確認モーダル（OrderViewDialog）の外枠。
 * メール起票の注文は左に参照元メールを出す2カラム、それ以外は1カラムに切り替える。
 * 両モーダルの見た目を揃えるため、幅・余白はここでだけ決める（Issue #527）。
 */
export function OrderDialogLayout({
  order,
  open,
  onOpenChange,
  title,
  children,
  footer,
}: OrderDialogLayoutProps) {
  const hasSourceEmail = order.source_type === "email" && !!order.source_raw

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={
          hasSourceEmail
            ? "flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-[820px]"
            : "sm:max-w-[480px]"
        }
      >
        <DialogHeader className={hasSourceEmail ? "px-6 pb-4 pt-6" : undefined}>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className={hasSourceEmail ? "flex min-h-0 flex-1 border-t" : undefined}>
          {hasSourceEmail && (
            <SourceEmailPanel
              order={order}
              className="w-[300px] shrink-0 space-y-4 overflow-y-auto border-r bg-muted/30 p-5"
            />
          )}

          <div
            className={
              hasSourceEmail
                ? "flex-1 space-y-4 overflow-y-auto p-5"
                : "space-y-4 py-2"
            }
          >
            {children}
          </div>
        </div>

        <DialogFooter className={hasSourceEmail ? "border-t px-6 py-4" : undefined}>
          {footer}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
