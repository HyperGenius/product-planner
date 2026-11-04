"use client";

import Link from "next/link";
import { format } from "date-fns";
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
              <TableHead className="w-[160px]">顧客</TableHead>
              <TableHead className="w-[140px]">受注</TableHead>
              <TableHead className="w-[130px]">受信日</TableHead>
              <TableHead>内容</TableHead>
              <TableHead className="w-[140px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((request) => (
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
                <TableCell className="text-sm">
                  {format(new Date(request.created_at), "M月d日 HH:mm", {
                    locale: ja,
                  })}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {request.extracted_product_name && (
                    <p className="truncate text-sm text-foreground">
                      {request.extracted_product_name}
                    </p>
                  )}
                  {request.body_snippet && (
                    <p className="line-clamp-2 whitespace-pre-wrap">
                      {request.body_snippet}
                    </p>
                  )}
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
