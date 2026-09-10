"use client"

import Link from "next/link"
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FileText,
  type LucideIcon,
  Mail,
  MinusCircle,
  XCircle,
} from "lucide-react"
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
import { useCurrentMember } from "@/hooks/use-tenant-members"
import type { EmailIntakeOutcome, EmailIntakeResult } from "@/types/order"

/**
 * `order_parse_log.reason` の日本語ラベル。処理結果の観点は `outcome`（起票/スキップ/失敗）に
 * 固定したため一覧の主表示には使わないが、従属テキストで理由の内訳を出すのに使う（Issue #422）。
 */
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
  failed_no_attachment: "添付なし",
}

interface OutcomeMeta {
  label: string
  icon: LucideIcon
  badgeVariant: "secondary" | "outline" | "destructive"
  iconClassName: string
}

/**
 * 処理結果の3値（Issue #422）ごとの見た目。値が増えたら型エラーで気づけるよう
 * `Record<EmailIntakeOutcome, T>` で全ケースを明示する（CLAUDE.md / PR #409）。
 */
const OUTCOME_META: Record<EmailIntakeOutcome, OutcomeMeta> = {
  created: {
    label: "起票",
    icon: CheckCircle2,
    badgeVariant: "secondary",
    iconClassName: "text-emerald-600",
  },
  skipped: {
    label: "スキップ",
    icon: MinusCircle,
    badgeVariant: "outline",
    iconClassName: "text-muted-foreground",
  },
  failed: {
    label: "失敗",
    icon: XCircle,
    badgeVariant: "destructive",
    iconClassName: "text-destructive",
  },
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("ja-JP")
}

function reasonLabel(reason: string): string {
  return REASON_LABELS[reason] ?? reason
}

/**
 * 受信受注メールの処理結果一覧ページ
 * URL: /orders/email-intake
 *
 * 受信した受注メール（order_attachments のステージング行）ごとに、処理結果を
 * 「起票 / スキップ / 失敗」の3値（サーバー導出の `outcome`）に固定して1列で表示する
 * （Issue #422）。件数・理由・元ファイルは従属情報として同じセル内に添える。
 * 「パース成功なのにスキップ理由あり・起票0件」のような観点のブレをなくすのが主目的。
 */
export default function EmailIntakeResultsPage() {
  const { data: results, isLoading, isError } = useEmailIntakeResults()
  const { data: currentMember } = useCurrentMember()
  // Gmail へのアクセス権は platform_admin しか持たないため、元メールへのリンクは
  // platform_admin にのみ表示する（PDF の署名付きURLは全メンバーに表示する）。
  const canViewGmailLink = currentMember?.role === "platform_admin"

  return (
    <div className="flex flex-col gap-4 p-6">
      <div>
        <h1 className="text-xl font-bold">受信受注メールの処理結果</h1>
        <p className="text-sm text-muted-foreground">
          自動パースされた受注メールごとの結果を「起票 / スキップ / 失敗」で確認できます。
          <span className="font-medium text-foreground">失敗</span>
          は手動起票・再送などの対応が必要です。
          <span className="font-medium text-foreground">スキップ</span>
          （既存注文と重複・対象外メール）は基本的に対応不要です。
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
                <TableHead>結果</TableHead>
                <TableHead>受信日時</TableHead>
                <TableHead>顧客</TableHead>
                <TableHead>ファイル</TableHead>
                <TableHead>元メール/PDF</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(results ?? []).length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-center text-muted-foreground"
                  >
                    受信受注メールはまだありません
                  </TableCell>
                </TableRow>
              ) : (
                (results ?? []).map((row) => (
                  <EmailIntakeRow
                    key={row.id}
                    row={row}
                    showGmailLink={canViewGmailLink}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

function OutcomeCell({ row }: { row: EmailIntakeResult }) {
  const meta = OUTCOME_META[row.outcome]
  const Icon = meta.icon
  const reasons = row.parse_log_reasons.map(reasonLabel)

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant={meta.badgeVariant} className="gap-1">
          <Icon className={meta.iconClassName} aria-hidden />
          {row.outcome === "created"
            ? `${meta.label} ${row.created_order_count}件`
            : meta.label}
        </Badge>
        {row.needs_attention && (
          <Badge
            variant="outline"
            className="gap-1 border-amber-300 bg-amber-50 text-amber-700"
          >
            <AlertTriangle className="text-amber-600" aria-hidden />
            要確認
          </Badge>
        )}
      </div>

      <OutcomeDetail row={row} reasons={reasons} />
    </div>
  )
}

/**
 * バッジの下に添える従属テキスト。起票された注文へのリンク・スキップ/失敗理由の内訳・
 * 空の下書きの注意書きなど、一覧のデフォルト表示では圧縮したい情報をここにまとめる。
 */
function OutcomeDetail({
  row,
  reasons,
}: {
  row: EmailIntakeResult
  reasons: string[]
}) {
  const orderLinks =
    row.created_order_ids.length > 0 ? (
      <span className="text-xs text-muted-foreground">
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
    ) : null

  if (row.outcome === "created") {
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {orderLinks}
        {reasons.length > 0 && (
          <span className="text-xs text-amber-700">{reasons.join(" / ")}</span>
        )}
      </div>
    )
  }

  if (row.outcome === "failed") {
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-xs text-destructive">
          {reasons.length > 0 ? reasons.join(" / ") : "処理を完了できませんでした"}
        </span>
        {row.empty_draft && (
          <span className="text-xs text-muted-foreground">
            空の下書きを起票済み {orderLinks}
          </span>
        )}
      </div>
    )
  }

  // skipped
  return (
    <span className="text-xs text-muted-foreground">
      {reasons.length > 0
        ? reasons.join(" / ")
        : "新規起票なし（全明細が既存注文と重複、または既存注文の更新のみ）"}
    </span>
  )
}

function EmailIntakeRow({
  row,
  showGmailLink,
}: {
  row: EmailIntakeResult
  showGmailLink: boolean
}) {
  const gmailLinkVisible = showGmailLink && Boolean(row.gmail_url)
  return (
    <TableRow>
      <TableCell>
        <OutcomeCell row={row} />
      </TableCell>
      <TableCell className="whitespace-nowrap align-top">
        {formatDateTime(row.received_at)}
      </TableCell>
      <TableCell className="align-top">{row.customer_name ?? "-"}</TableCell>
      <TableCell className="max-w-48 truncate align-top">
        {row.has_attachment ? (row.original_filename ?? "PDF") : "（添付なし）"}
      </TableCell>
      <TableCell className="align-top">
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
          {gmailLinkVisible && (
            <a
              href={row.gmail_url ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              <Mail className="h-3.5 w-3.5" />
              メール
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
          {!row.signed_url && !gmailLinkVisible && "-"}
        </div>
      </TableCell>
    </TableRow>
  )
}
