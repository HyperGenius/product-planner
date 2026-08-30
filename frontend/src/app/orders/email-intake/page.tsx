"use client"

import Link from "next/link"
import { ExternalLink, FileText, Mail } from "lucide-react"
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
import { useEmailIntakeResults } from "@/hooks/use-orders"
import type { EmailIntakeResult } from "@/types/order"

const PARSE_STATUS_LABELS: Record<string, string> = {
  pending: "処理待ち",
  success: "パース成功",
  failed_encrypted: "読み取り不可（暗号化PDF）",
  failed_image: "読み取り不可（画像PDF）",
  failed_no_attachment: "添付なし",
}

const REASON_LABELS: Record<string, string> = {
  no_product_match: "品番照合失敗",
  downgrade_skipped: "格下げスキップ",
  draft_conflict_skipped: "重複競合スキップ",
  multi_order_suspected: "複数受注の疑い",
  no_order_created: "起票0件（全明細が重複）",
  non_order_email: "対象外メール",
  invalid_quantity: "数量不正",
  failed_encrypted: "暗号化PDF",
  failed_image: "画像PDF",
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("ja-JP")
}

/**
 * 受信受注メールの処理結果一覧ページ
 * URL: /orders/email-intake
 *
 * 受信した受注メール（order_attachments のステージング行）ごとに、受信日時・顧客・
 * parse_status・そのメールから新規起票された注文件数・スキップ/失敗理由・
 * 元PDF/本文リンクを一覧で表示する（Issue #357）。
 * 「パース成功・起票0件」のケースを、メーラーを開かずに追跡できるようにするのが主目的。
 */
export default function EmailIntakeResultsPage() {
  const { data: results, isLoading, isError } = useEmailIntakeResults()

  return (
    <div className="flex flex-col gap-4 p-6">
      <div>
        <h1 className="text-xl font-bold">受信受注メールの処理結果</h1>
        <p className="text-sm text-muted-foreground">
          自動パースされた受注メールごとの起票件数・スキップ/失敗理由・元ファイルを一覧で確認できます。
          「パース成功・起票0件」（全明細が既存注文と重複）のメールもここで追跡できます。
        </p>
      </div>

      {isLoading && (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      )}

      {isError && (
        <p className="text-sm text-destructive">処理結果の取得に失敗しました。</p>
      )}

      {!isLoading && !isError && (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>受信日時</TableHead>
                <TableHead>顧客</TableHead>
                <TableHead>ファイル</TableHead>
                <TableHead>パース状態</TableHead>
                <TableHead>起票件数</TableHead>
                <TableHead>スキップ/失敗理由</TableHead>
                <TableHead>元メール/PDF</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(results ?? []).length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="text-center text-muted-foreground"
                  >
                    受信受注メールはまだありません
                  </TableCell>
                </TableRow>
              ) : (
                (results ?? []).map((row) => (
                  <EmailIntakeRow key={row.id} row={row} />
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

function parseStatusVariant(
  parseStatus: string,
): "secondary" | "outline" | "destructive" {
  if (parseStatus === "success") return "secondary"
  if (parseStatus === "pending") return "outline"
  return "destructive"
}

function EmailIntakeRow({ row }: { row: EmailIntakeResult }) {
  const zeroCreated = row.created_order_count === 0
  const parseSucceeded = row.parse_status === "success"

  return (
    <TableRow>
      <TableCell className="whitespace-nowrap">
        {formatDateTime(row.received_at)}
      </TableCell>
      <TableCell>{row.customer_name ?? "-"}</TableCell>
      <TableCell className="max-w-48 truncate">
        {row.has_attachment ? (row.original_filename ?? "PDF") : "（添付なし）"}
      </TableCell>
      <TableCell>
        <Badge variant={parseStatusVariant(row.parse_status)}>
          {PARSE_STATUS_LABELS[row.parse_status] ?? row.parse_status}
        </Badge>
      </TableCell>
      <TableCell>
        {zeroCreated ? (
          <Badge
            variant="outline"
            className="border-orange-300 bg-orange-50 text-orange-700"
          >
            起票0件
          </Badge>
        ) : (
          <span>
            {row.created_order_count}件
            {row.created_order_ids.length > 0 && (
              <span className="ml-2 text-xs text-muted-foreground">
                {row.created_order_ids.map((id, i) => (
                  <span key={id}>
                    {i > 0 && ", "}
                    <Link
                      href={`/orders/${id}`}
                      className="underline hover:text-foreground"
                    >
                      #{id}
                    </Link>
                  </span>
                ))}
              </span>
            )}
          </span>
        )}
      </TableCell>
      <TableCell>
        {row.parse_log_reasons.length === 0 ? (
          parseSucceeded && zeroCreated ? (
            <span className="text-xs text-muted-foreground">
              新規起票なし（全明細が既存注文と重複、または既存注文の更新のみ）
            </span>
          ) : (
            "-"
          )
        ) : (
          <div className="flex flex-wrap gap-1">
            {row.parse_log_reasons.map((reason, i) => (
              <Badge key={`${reason}-${i}`} variant="outline">
                {REASON_LABELS[reason] ?? reason}
              </Badge>
            ))}
          </div>
        )}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-3">
          {row.signed_url && (
            <a
              href={row.signed_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              <FileText className="h-3.5 w-3.5" />
              PDF
            </a>
          )}
          {row.gmail_url && (
            <a
              href={row.gmail_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              <Mail className="h-3.5 w-3.5" />
              メール
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
          {!row.signed_url && !row.gmail_url && "-"}
        </div>
      </TableCell>
    </TableRow>
  )
}
