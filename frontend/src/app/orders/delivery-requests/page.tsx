"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { ja } from "date-fns/locale";
import { toast } from "sonner";
import { Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DELIVERY_REQUEST_KIND_LABELS } from "@/components/orders/order-delivery-requests";
import {
  useOpenDeliveryRequests,
  useResolveDeliveryRequest,
} from "@/hooks/use-order-delivery-requests";
import { useOrderProgressList } from "@/hooks/use-daily-report-progress";
import {
  elapsedSince,
  expectedCompletion,
  finalProcessProgress,
  overdueDays,
  sortDeliveryRequests,
  type DeliveryRequestSort,
} from "@/lib/delivery-request-utils";
import type { OpenDeliveryRequestListItem } from "@/types/order-delivery-request";
import type { ProcessProgress } from "@/types/daily-report-progress";

const formatDate = (value: string) => format(parseISO(value), "M月d日", { locale: ja });

/** 依頼の中身（何を・何個・いつまでに）。本文の抜粋は詳細（クリックで開く）に置く */
function RequestContent({ request }: { request: OpenDeliveryRequestListItem }) {
  return (
    <div className="space-y-1 text-sm">
      <p className="truncate font-medium">
        {request.extracted_product_name ?? "（品名の記載なし）"}
      </p>
      <p className="text-xs text-muted-foreground">
        数量: {request.quantity !== null ? request.quantity.toLocaleString() : "－"}
        {" / "}要望日:{" "}
        {request.requested_date ? formatDate(request.requested_date) : "－"}
      </p>
      {request.body_snippet && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">本文の抜粋</summary>
          <p className="mt-1 whitespace-pre-wrap">{request.body_snippet}</p>
        </details>
      )}
    </div>
  );
}

/** 受注の現状。未紐づけ（order_id なし）は空表示。進捗の行が無い工程は遅れ・未着手にしない */
function OrderStatus({
  request,
  progress,
}: {
  request: OpenDeliveryRequestListItem;
  progress: ProcessProgress | undefined;
}) {
  if (request.order_id === null) {
    return <span className="text-muted-foreground">－</span>;
  }
  const overdue = overdueDays(request.desired_deadline);
  const completion = expectedCompletion(request);
  const quantity = request.order_quantity;
  return (
    <div className="space-y-1 text-xs">
      <p>
        希望納期:{" "}
        {request.desired_deadline ? formatDate(request.desired_deadline) : "－"}
        {overdue !== null && (
          <span className="ml-1 font-medium text-red-600">（{overdue}日超過）</span>
        )}
      </p>
      <p>
        完成見込み: {completion ? formatDate(completion) : "－"}
      </p>
      <p>
        受注数量: {quantity !== null ? quantity.toLocaleString() : "－"}
        {progress && (
          <span className="ml-1">
            （{progress.process_name ?? "最終工程"}{" "}
            {progress.good_qty.toLocaleString()}
            {progress.order_quantity !== null
              ? ` / ${progress.order_quantity.toLocaleString()}`
              : ""}
            ）
          </span>
        )}
      </p>
    </div>
  );
}

/**
 * 督促・分納の依頼（Issue #622）
 * URL: /orders/delivery-requests
 *
 * 顧客から届いた督促・分割納入の依頼のうち未対応のものを、受注に紐づいていないものも含めて並べる。
 * 内容を確認して電話などで対応したら「対応済みにする」を押す。受注の納期・数量は自動では変わらない
 */
export default function DeliveryRequestsPage() {
  const { data, isLoading, isError } = useOpenDeliveryRequests();
  const resolve = useResolveDeliveryRequest();
  const [sort, setSort] = useState<DeliveryRequestSort>("received");

  const requests = useMemo(
    () => sortDeliveryRequests(data ?? [], sort),
    [data, sort],
  );
  // 進捗は表示中の受注をまとめて1リクエストで取る（行ごとに引かない）
  const orderIds = useMemo(
    () =>
      (data ?? [])
        .map((r) => r.order_id)
        .filter((id): id is number => id !== null),
    [data],
  );
  const { data: progressList } = useOrderProgressList(orderIds);
  const progressByOrder = useMemo(() => {
    const byOrder = new Map<number, ProcessProgress[]>();
    progressList?.items.forEach((p) => {
      byOrder.set(p.order_id, [...(byOrder.get(p.order_id) ?? []), p]);
    });
    return byOrder;
  }, [progressList]);

  const handleResolve = (id: string) => {
    resolve.mutate(
      { id, resolved: true },
      { onError: () => toast.error("対応状況を更新できませんでした") },
    );
  };

  return (
    <div className="container mx-auto py-6 px-4">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">督促・分納の依頼</h1>
        <p className="text-muted-foreground mt-2">
          顧客から届いた督促・分割納入の依頼のうち、未対応のものを表示します
        </p>
      </div>

      <div
        role="note"
        className="mb-4 flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900"
      >
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          対応したら「対応済みにする」を押してください。納期・数量・ステータスは自動では変わりません。
          対象の受注が決まらなかった依頼は「未紐づけ」と表示されます
        </p>
      </div>

      {data && data.length > 1 && (
        <div className="mb-3 flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">並び順:</span>
          <Button
            size="sm"
            variant={sort === "received" ? "default" : "outline"}
            onClick={() => setSort("received")}
          >
            受信の新しい順
          </Button>
          <Button
            size="sm"
            variant={sort === "overdue" ? "default" : "outline"}
            onClick={() => setSort("overdue")}
          >
            超過日数の多い順
          </Button>
        </div>
      )}

      {isLoading ? (
        <p className="text-muted-foreground">読み込み中...</p>
      ) : isError ? (
        <p className="text-destructive">依頼を取得できませんでした</p>
      ) : !data || data.length === 0 ? (
        <p className="text-muted-foreground">未対応の依頼はありません</p>
      ) : (
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[110px]">種別</TableHead>
              <TableHead className="w-[140px]">顧客</TableHead>
              <TableHead className="w-[120px]">受注</TableHead>
              <TableHead>内容</TableHead>
              <TableHead className="w-[240px]">受注の現状</TableHead>
              <TableHead className="w-[120px]">受信</TableHead>
              <TableHead className="w-[140px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {requests.map((request) => (
              <TableRow key={request.id}>
                <TableCell>
                  <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">
                    {DELIVERY_REQUEST_KIND_LABELS[request.kind]}
                  </Badge>
                </TableCell>
                <TableCell className="truncate">
                  {request.customer_name ?? "－"}
                </TableCell>
                <TableCell>
                  {request.order_id !== null ? (
                    <Link
                      href={`/orders/${request.order_id}`}
                      className="text-primary underline-offset-2 hover:underline"
                    >
                      {request.order_number ?? `#${request.order_id}`}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">未紐づけ</span>
                  )}
                </TableCell>
                <TableCell>
                  <RequestContent request={request} />
                </TableCell>
                <TableCell>
                  <OrderStatus
                    request={request}
                    progress={
                      request.order_id !== null
                        ? finalProcessProgress(progressByOrder.get(request.order_id))
                        : undefined
                    }
                  />
                </TableCell>
                <TableCell className="text-sm">
                  <p>
                    {format(new Date(request.created_at), "M月d日 HH:mm", {
                      locale: ja,
                    })}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {elapsedSince(request.created_at)}前
                  </p>
                </TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    disabled={resolve.isPending}
                    onClick={() => handleResolve(request.id)}
                  >
                    対応済みにする
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
