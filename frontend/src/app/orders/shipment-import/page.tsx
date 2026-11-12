"use client"

import { useRef, useState } from "react"
import Link from "next/link"
import { Info, Upload } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useShipmentFiles, useUploadShipmentFile } from "@/hooks/use-shipment-files"
import { useCurrentMember } from "@/hooks/use-tenant-members"
import { formatDateTimeShort } from "@/lib/order-utils"
import { formatFileSize, validateShipmentFile } from "@/lib/shipment-file-utils"
import { describeShipmentFileParse, formatShipmentPeriod } from "@/lib/shipment-utils"
import { cn } from "@/lib/utils"
import {
  SHIPMENT_FILE_EXTENSIONS,
  SHIPMENT_FILE_UPLOAD_ROLES,
  type ShipmentFileItem,
} from "@/types/shipment-file"

const SOURCE_LABELS = { agent: "共有フォルダ", web: "アップロード" } as const

const PARSE_TONE_CLASS = {
  muted: "text-muted-foreground",
  ok: "text-foreground",
  warn: "text-amber-700",
  error: "text-red-600",
} as const

/**
 * 弥生販売のエクスポートの取り込み状況とアップロード（Issue #662 / #667）
 * URL: /orders/shipment-import
 *
 * 取り込みの本線は、事務PCが共有フォルダへ書き出したファイルを日報エージェント端末が回収する経路。
 * ここは最終取り込み日時・ファイルごとの解析結果（期間・明細の件数・エラー）の確認と、
 * 共有フォルダが使えないときの予備のアップロード。解析は cron が行う（アップロード直後は「解析待ち」）
 */
export default function ShipmentImportPage() {
  const { data, isLoading, isError } = useShipmentFiles()
  const { data: currentMember } = useCurrentMember()
  const upload = useUploadShipmentFile()
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)

  const role = currentMember?.role ?? null
  const canUpload = role !== null && (SHIPMENT_FILE_UPLOAD_ROLES as readonly string[]).includes(role)
  const lastLabel = formatDateTimeShort(data?.last_received_at)

  const handleSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    const reason = validateShipmentFile(file)
    setError(reason)
    if (reason) return
    upload.mutate(file, {
      onSuccess: (result) =>
        toast.success(
          result.status === "stored"
            ? "取り込みました"
            : "同じ内容のファイルは取り込み済みです",
        ),
      onError: () => toast.error("アップロードに失敗しました"),
    })
  }

  return (
    <div className="container mx-auto py-6 px-4">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">弥生の取り込み</h1>
        <p className="text-muted-foreground mt-2">
          弥生販売からエクスポートした「得意先別売上明細表」のファイルの取り込み状況です
        </p>
      </div>

      <div
        role="note"
        className="mb-4 flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900"
      >
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          共有フォルダに保存したファイルは自動で取り込まれます。共有フォルダを使えないときは下のボタンから
          直接アップロードできます。取り込んだ「得意先別売上明細表」は十数分ごとに解析され、
          「送品の消し込み」に弥生の送品数量として表示されます。同じ期間を書き出し直したときは、新しいファイルの内容に置き換わります。
          得意先・商品がアプリの顧客・製品に当たらないときは{" "}
          <Link href="/orders/shipment-names" className="underline">
            弥生の名寄せ
          </Link>
          で対応付けてください
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">
          最終取り込み:{" "}
          <span className="font-medium">
            {isLoading ? "確認中…" : isError ? "取得できませんでした" : (lastLabel ?? "未取り込み")}
          </span>
        </p>
        {canUpload && (
          <div>
            <input
              ref={inputRef}
              type="file"
              accept={SHIPMENT_FILE_EXTENSIONS.join(",")}
              className="hidden"
              aria-label="売上伝票のファイルを選択"
              onChange={handleSelect}
            />
            <Button onClick={() => inputRef.current?.click()} disabled={upload.isPending}>
              <Upload className="mr-2 h-4 w-4" />
              {upload.isPending ? "アップロード中…" : "ファイルをアップロード"}
            </Button>
          </div>
        )}
      </div>
      {error && (
        <p role="alert" className="mb-4 text-sm text-red-600">
          {error}
        </p>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>ファイル名</TableHead>
            <TableHead>取り込み経路</TableHead>
            <TableHead>サイズ</TableHead>
            <TableHead>取り込み日時</TableHead>
            <TableHead>期間</TableHead>
            <TableHead>解析の結果</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data?.files.map((file) => (
            <TableRow key={file.id}>
              <TableCell className="font-medium">{file.file_name}</TableCell>
              <TableCell>
                <Badge variant="outline">{SOURCE_LABELS[file.source]}</Badge>
              </TableCell>
              <TableCell>{formatFileSize(file.size_bytes)}</TableCell>
              <TableCell>{formatDateTimeShort(file.received_at) ?? "－"}</TableCell>
              <TableCell>{formatShipmentPeriod(file) ?? "－"}</TableCell>
              <TableCell>
                <ParseResult file={file} />
              </TableCell>
            </TableRow>
          ))}
          {data && data.files.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground">
                まだ取り込まれたファイルはありません
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}

function ParseResult({ file }: { file: ShipmentFileItem }) {
  const { label, tone } = describeShipmentFileParse(file)
  return <span className={cn("text-sm", PARSE_TONE_CLASS[tone])}>{label}</span>
}
