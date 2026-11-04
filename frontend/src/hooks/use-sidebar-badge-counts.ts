"use client";

import { useOrders } from "@/hooks/use-orders";
import { useOpenDeliveryRequests } from "@/hooks/use-order-delivery-requests";
import { useShippingRows } from "@/hooks/use-orders-shipping";
import { getIntakeCategory } from "@/lib/order-utils";

/**
 * サイドバーのサブメニューに出す件数バッジの種類（Epic #553）。
 * 種類を足すとき（#557 送品の消し込み等）は、ここと `useSidebarBadgeCounts()` を揃えて更新する
 *
 * - `intake_drafts`: 「起票の確認」の下書き（Issue #555）
 * - `pending_approval`: 「承認」の承認待ち（Issue #556）
 * - `shipping_candidates`: 「送品の消し込み」の候補（Issue #557）
 * - `delivery_requests`: 「督促・分納の依頼」の未対応（Issue #622。注文は取得しない）
 */
export type SidebarBadgeKey =
  | "intake_drafts"
  | "pending_approval"
  | "shipping_candidates"
  | "delivery_requests";

/**
 * サイドバーの件数バッジの値。`keys` が空（そのロールにバッジを出す項目が無い）なら注文を取得しない
 *
 * @param keys 出すバッジの種類
 */
export function useSidebarBadgeCounts(
  keys: readonly SidebarBadgeKey[],
): Partial<Record<SidebarBadgeKey, number>> {
  const needsOrders = keys.some((k) => k !== "delivery_requests");
  const needsDeliveryRequests = keys.includes("delivery_requests");
  // 一覧と同じクエリキーで取り、バッジを出さないロールでは取得しない
  const deliveryRequests = useOpenDeliveryRequests({
    enabled: needsDeliveryRequests,
  });
  const { data: orders } = useOrders({ enabled: needsOrders });
  // 候補の判定には日報の進捗が要る。画面と同じクエリキーで取り、バッジを出さないロールでは取得しない
  const needsShipping = keys.includes("shipping_candidates");
  const shipping = useShippingRows(needsShipping ? orders : undefined);

  // 他の画面で取得済みの注文がキャッシュにあっても、求められていないバッジは返さない
  const counts: Partial<Record<SidebarBadgeKey, number>> = {};
  if (needsDeliveryRequests && deliveryRequests.data) {
    counts.delivery_requests = deliveryRequests.data.length;
  }
  if (!needsOrders || !orders) return counts;
  if (keys.includes("intake_drafts")) {
    counts.intake_drafts = orders.filter(
      (o) => getIntakeCategory(o) !== null,
    ).length;
  }
  if (keys.includes("pending_approval")) {
    counts.pending_approval = orders.filter(
      (o) => o.status === "pending_approval",
    ).length;
  }
  // 進捗が届く前に数えると、最終工程が完了した注文が抜けた件数が一瞬出る
  if (needsShipping && !shipping.isProgressLoading) {
    counts.shipping_candidates = shipping.candidateRows.length;
  }
  return counts;
}
