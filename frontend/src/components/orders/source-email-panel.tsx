"use client"

import { AlertTriangle, Download, Mail, Paperclip } from "lucide-react"
import { useOrderAttachments } from "@/hooks/use-orders"
import { useCustomers } from "@/hooks/use-customers"
import { getCustomerName, splitSubjectAndBody } from "@/lib/order-utils"
import type { Order } from "@/types/order"

interface SourceEmailPanelProps {
  order: Order
  className?: string
}

/**
 * メール起点の注文について、件名・本文・添付ファイル一覧を表示するパネル。
 * EditOrderDialog / SplitOrderDialog から共通利用する。
 */
export function SourceEmailPanel({ order, className }: SourceEmailPanelProps) {
  const { data: attachments, isLoading: attachmentsLoading } = useOrderAttachments(order.id)
  const { data: customers, isLoading: customersLoading } = useCustomers()
  const { subject, body } = splitSubjectAndBody(order.source_raw)

  return (
    <div className={className}>
      <div className="flex items-center gap-1.5 text-sm font-medium">
        <Mail className="h-4 w-4" />
        参照元メール
      </div>

      {subject && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">件名</p>
          <p className="text-sm font-medium break-words">{subject}</p>
        </div>
      )}

      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">顧客</p>
        <p className="text-sm font-medium">
          {customersLoading ? (
            <span className="text-muted-foreground">読み込み中...</span>
          ) : order.customer_id ? (
            getCustomerName(order.customer_id, customers)
          ) : (
            <span className="text-muted-foreground">未設定</span>
          )}
        </p>
      </div>

      {body && (
        <div className="rounded-md border bg-background p-3">
          <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words text-xs text-muted-foreground">
            {body}
          </pre>
        </div>
      )}

      <div className="space-y-1.5 border-t pt-3">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Paperclip className="h-3.5 w-3.5" />
          添付ファイル
        </p>
        {attachmentsLoading ? (
          <p className="text-xs text-muted-foreground">読み込み中...</p>
        ) : attachments && attachments.length > 0 ? (
          <ul className="space-y-1.5">
            {attachments.map((att) => (
              <li key={att.id} className="text-xs">
                {att.parse_status === "failed_no_attachment" ? (
                  <span className="text-muted-foreground">添付ファイルなし</span>
                ) : att.parse_status === "failed_encrypted" ||
                  att.parse_status === "failed_image" ? (
                  <span className="flex items-center gap-1 text-amber-600">
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                    自動読み取り不可
                    {att.signed_url && (
                      <a
                        href={att.signed_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-1 underline text-primary"
                      >
                        {att.original_filename}
                      </a>
                    )}
                  </span>
                ) : (
                  <a
                    href={att.signed_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-primary underline"
                  >
                    <Download className="h-3 w-3 shrink-0" />
                    {att.original_filename}
                  </a>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">添付ファイルなし</p>
        )}
      </div>
    </div>
  )
}
