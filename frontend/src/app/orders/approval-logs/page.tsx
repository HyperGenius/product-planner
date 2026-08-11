"use client"

import { useState } from "react"
import { Download, ShieldAlert } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useApprovalLogs, downloadApprovalLogsCsv } from "@/hooks/use-orders"
import { useCurrentMember } from "@/hooks/use-tenant-members"
import type { OrderApprovalLog } from "@/types/order"
import { ORDER_APPROVAL_LOG_VIEWER_ROLES } from "@/types/member"

const ACTION_LABELS: Record<OrderApprovalLog["action"], string> = {
  request_approval: "承認依頼送信",
  approve: "承認",
  reject: "差し戻し",
  withdraw: "取り下げ",
}

const ACTION_BADGE_VARIANTS: Record<
  OrderApprovalLog["action"],
  "default" | "secondary" | "outline"
> = {
  request_approval: "secondary",
  approve: "default",
  reject: "outline",
  withdraw: "outline",
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("ja-JP")
}

/**
 * 承認ワークフロー監査ログ閲覧ページ
 * URL: /orders/approval-logs
 * 閲覧・出力のみ提供し、編集・承認操作は一切行わない（iso_officer / president / platform_admin 限定）
 */
export default function ApprovalLogsPage() {
  const { data: currentMember, isLoading: isMemberLoading } = useCurrentMember()
  const currentUserRole = currentMember?.role ?? null
  const canView =
    !!currentUserRole &&
    ORDER_APPROVAL_LOG_VIEWER_ROLES.includes(currentUserRole)

  const { data: logs, isLoading, isError } = useApprovalLogs({
    enabled: !isMemberLoading && canView,
  })
  const [isExporting, setIsExporting] = useState(false)

  const handleExport = async () => {
    setIsExporting(true)
    try {
      await downloadApprovalLogsCsv()
    } catch {
      toast.error("CSV出力に失敗しました")
    } finally {
      setIsExporting(false)
    }
  }

  if (isMemberLoading) {
    return (
      <div className="p-6">
        <Skeleton className="h-8 w-64" />
      </div>
    )
  }

  if (!canView) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-12 text-center text-muted-foreground">
        <ShieldAlert className="h-8 w-8" />
        <p>この画面は iso_officer / president / platform_admin のみ閲覧できます。</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">承認監査ログ</h1>
          <p className="text-sm text-muted-foreground">
            承認依頼送信・承認・差し戻し・取り下げの各操作の記録です。閲覧・出力のみで編集はできません。
          </p>
        </div>
        <Button onClick={handleExport} disabled={isExporting} variant="outline">
          <Download className="mr-2 h-4 w-4" />
          {isExporting ? "出力中..." : "CSV出力"}
        </Button>
      </div>

      {isLoading && (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      )}

      {isError && (
        <p className="text-sm text-destructive">監査ログの取得に失敗しました。</p>
      )}

      {!isLoading && !isError && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>注文番号</TableHead>
              <TableHead>操作</TableHead>
              <TableHead>操作者</TableHead>
              <TableHead>理由</TableHead>
              <TableHead>操作日時</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(logs ?? []).length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  監査ログはまだありません
                </TableCell>
              </TableRow>
            ) : (
              (logs ?? []).map((log) => (
                <TableRow key={log.id}>
                  <TableCell>{log.order_number ?? `#${log.order_id}`}</TableCell>
                  <TableCell>
                    <Badge variant={ACTION_BADGE_VARIANTS[log.action]}>
                      {ACTION_LABELS[log.action]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {log.actor_full_name ?? log.actor_email ?? log.actor_user_id}
                  </TableCell>
                  <TableCell>{log.reason ?? "-"}</TableCell>
                  <TableCell>{formatDateTime(log.created_at)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
