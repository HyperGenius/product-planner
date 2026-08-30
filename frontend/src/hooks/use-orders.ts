"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ApiError, apiClient } from "@/lib/api-client"
import { createClient } from "@/utils/supabase/client"
import type {
  EmailIntakeResult,
  ManualEmailIntakeRequest,
  ManualEmailIntakeResponse,
  Order,
  OrderApprovalLog,
  OrderAttachment,
  OrderBulkApproveResponse,
  OrderCreate,
  OrderSimulateRequest,
  OrderSimulateResponse,
  OrderSplitRequest,
  OrderSplitResponse,
} from "@/types/order"

// クエリキーを定数化
const ORDERS_QUERY_KEY = ["orders"]

/**
 * 注文一覧を取得するフック
 */
export function useOrders() {
  return useQuery<Order[]>({
    queryKey: ORDERS_QUERY_KEY,
    queryFn: () => apiClient<Order[]>("/orders"),
  })
}

/**
 * 注文をシミュレーションするフック
 */
export function useSimulateOrder() {
  return useMutation({
    mutationFn: (data: OrderSimulateRequest) =>
      apiClient<OrderSimulateResponse>("/orders/simulate", {
        method: "POST",
        body: JSON.stringify(data),
      }),
  })
}

/**
 * 注文を作成するフック
 */
export function useCreateOrder() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: OrderCreate) =>
      apiClient<Order>("/orders", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      // 注文一覧を再取得
      queryClient.invalidateQueries({ queryKey: ORDERS_QUERY_KEY })
    },
  })
}

/**
 * 自動パースできない受注メールを、本文（source_raw）・添付ファイル付きで手動起票するフック
 * （Issue #358）。1メールから複数明細（分納）をまとめて `source_type='email'` で起票する。
 *
 * multipart/form-data を送るため apiClient（JSON 固定）は使わず直接 fetch する。
 */
export function useCreateEmailOrderIntake() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      payload,
      files,
    }: {
      payload: ManualEmailIntakeRequest
      files: File[]
    }): Promise<ManualEmailIntakeResponse> => {
      const supabase = createClient()
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) {
        throw new Error("Unauthorized")
      }
      const tenantId =
        typeof window !== "undefined"
          ? localStorage.getItem("currentTenantId")
          : null

      const formData = new FormData()
      formData.append("payload", JSON.stringify(payload))
      for (const file of files) {
        formData.append("files", file, file.name)
      }

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/orders/email-intake`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            ...(tenantId && { "x-tenant-id": tenantId }),
          },
          body: formData,
        },
      )

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as {
          detail?: unknown
        }
        // FastAPI の 422（ValidationError）は detail が配列になり、ApiError では
        // 文字列でない detail が 'API Request Failed' に潰れてしまう。
        // 表示用に detail をメッセージ文字列へ正規化してから ApiError に渡す。
        if (Array.isArray(errorData.detail)) {
          const message =
            errorData.detail
              .map((d) =>
                d && typeof d === "object" && "msg" in d
                  ? String((d as { msg: unknown }).msg)
                  : String(d),
              )
              .join(" / ") || "入力内容を確認してください"
          throw new ApiError(response.status, { ...errorData, detail: message })
        }
        throw new ApiError(response.status, errorData)
      }
      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ORDERS_QUERY_KEY })
    },
  })
}

/**
 * 注文を更新するフック
 */
export function useUpdateOrder() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<OrderCreate> }) =>
      apiClient<Order>(`/orders/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ORDERS_QUERY_KEY })
    },
  })
}

/**
 * 注文を承認するフック（president限定）
 * スケジュールを作成し、注文ステータスをconfirmedにする
 */
export function useConfirmOrder() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (orderId: number) =>
      apiClient(`/orders/${orderId}/confirm`, {
        method: "POST",
      }),
    onSuccess: () => {
      // 注文一覧とスケジュール一覧を再取得
      queryClient.invalidateQueries({ queryKey: ORDERS_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: ["schedules"] })
    },
  })
}

/**
 * 下書き注文の承認依頼を送信するフック（order_handler限定）
 * 注文ステータスを draft -> pending_approval にする
 */
export function useRequestApproval() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (orderId: number) =>
      apiClient<Order>(`/orders/${orderId}/request-approval`, {
        method: "POST",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ORDERS_QUERY_KEY })
    },
  })
}

/**
 * 承認待ちの注文を差し戻すフック（president限定）
 * 注文ステータスを pending_approval -> draft に差し戻す（理由は任意）
 */
export function useRejectOrder() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, reason }: { id: number; reason?: string }) =>
      apiClient<Order>(`/orders/${id}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason: reason ?? null }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ORDERS_QUERY_KEY })
    },
  })
}

/**
 * 承認依頼を取り下げるフック（order_handler限定）
 * 誤って送信した承認依頼を自分で取り消し、注文ステータスを pending_approval -> draft に戻す
 */
export function useWithdrawApproval() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (orderId: number) =>
      apiClient<Order>(`/orders/${orderId}/withdraw-approval`, {
        method: "POST",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ORDERS_QUERY_KEY })
    },
  })
}

/**
 * 確定済の注文を送品済みにするフック（president / order_handler）
 * 注文ステータスを confirmed -> shipped にする
 */
export function useShipOrder() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (orderId: number) =>
      apiClient<Order>(`/orders/${orderId}/ship`, {
        method: "POST",
      }),
    onSuccess: (_data, orderId) => {
      queryClient.invalidateQueries({ queryKey: ORDERS_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: ["orders", orderId] })
    },
  })
}

/**
 * 複数の承認待ち注文をまとめて承認するフック（president限定）
 */
export function useApproveOrdersBulk() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (orderIds: number[]) =>
      apiClient<OrderBulkApproveResponse>("/orders/approve-bulk", {
        method: "POST",
        body: JSON.stringify({ order_ids: orderIds }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ORDERS_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: ["schedules"] })
    },
  })
}

/**
 * 承認ワークフロー（承認依頼送信・承認・差し戻し・取り下げ）の監査ログを取得するフック
 * （iso_officer / president / platform_admin のみ閲覧可）
 *
 * 呼び出し側は、閲覧権限を持つロールであることが確定してから
 * `enabled: true` を渡すこと。閲覧不可ロール（order_handler等）で
 * 常時リクエストしてしまうと、成功しない403アクセスがAPIに飛び続けてしまう。
 */
export function useApprovalLogs(options?: { enabled?: boolean }) {
  return useQuery<OrderApprovalLog[]>({
    queryKey: ["orders", "approval-logs"],
    queryFn: () => apiClient<OrderApprovalLog[]>("/orders/approval-logs"),
    enabled: options?.enabled ?? true,
  })
}

/**
 * 受信した受注メール（order_attachments のステージング行）ごとの処理結果一覧を取得するフック
 * （Issue #357）。起票0件・スキップ理由・元PDFリンクをまとめて確認できる。
 */
export function useEmailIntakeResults() {
  return useQuery<EmailIntakeResult[]>({
    queryKey: ["orders", "email-intake-results"],
    queryFn: () =>
      apiClient<EmailIntakeResult[]>("/orders/email-intake-results"),
    refetchInterval: 1000 * 60,
  })
}

/**
 * 承認ワークフローの監査ログをCSVとしてダウンロードする
 * （JSONを返さないエンドポイントのため apiClient は使わず直接fetchする）
 */
export async function downloadApprovalLogsCsv(): Promise<void> {
  const supabase = createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) {
    throw new Error("Unauthorized")
  }
  const tenantId =
    typeof window !== "undefined" ? localStorage.getItem("currentTenantId") : null

  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/orders/approval-logs/export`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(tenantId && { "x-tenant-id": tenantId }),
      },
    },
  )
  if (!response.ok) {
    throw new Error("承認履歴のCSV出力に失敗しました")
  }

  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = "approval_logs.csv"
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/**
 * 注文を削除するフック
 */
export function useDeleteOrder() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (orderId: number) =>
      apiClient(`/orders/${orderId}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ORDERS_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: ["schedules"] })
    },
  })
}

/**
 * 注文を1件取得するフック
 */
export function useOrder(orderId: number) {
  return useQuery<Order>({
    queryKey: ["orders", orderId],
    queryFn: () => apiClient<Order>(`/orders/${orderId}`),
    enabled: !!orderId,
  })
}

/**
 * 注文に紐づく添付ファイル一覧を取得するフック
 */
export function useOrderAttachments(orderId: number) {
  return useQuery<OrderAttachment[]>({
    queryKey: ["orders", orderId, "attachments"],
    queryFn: () => apiClient<OrderAttachment[]>(`/orders/${orderId}/attachments`),
    enabled: !!orderId,
  })
}

/**
 * 誤って1件にマージされた下書き注文を、同じソースを参照するN件の下書きに分割するフック
 */
export function useSplitOrder() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: OrderSplitRequest }) =>
      apiClient<OrderSplitResponse>(`/orders/${id}/split`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ORDERS_QUERY_KEY })
    },
  })
}

/**
 * 既存の注文IDでシミュレーションを実行するフック
 */
export function useSimulateOrderById() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (orderId: number) =>
      apiClient<OrderSimulateResponse>(`/orders/${orderId}/simulate`, {
        method: "POST",
      }),
    onSuccess: (_data, orderId) => {
      queryClient.invalidateQueries({ queryKey: ["orders", orderId] })
    },
  })
}
