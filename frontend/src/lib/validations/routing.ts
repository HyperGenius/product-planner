import { z } from "zod"

/**
 * 1行ごとの工程ルーティングスキーマ
 */
const routingItemSchema = z.object({
  process_name: z.string().min(1, "工程名は必須です"),
  equipment_group_id: z.number().min(1, "設備グループを選択してください"),
  sequence_order: z.number().int().min(1, "順序は1以上の整数です"),
  setup_time_seconds: z.number().int().min(0, "セットアップ時間は0以上です").default(0),
  unit_time_seconds: z.number().min(0, "単位時間は0以上です"),
})

/**
 * 工程ルーティングリスト全体のスキーマ
 * sequence_order の重複をチェック
 */
export const routingListSchema = z.object({
  routings: z.array(routingItemSchema)
    .refine((items) => {
      // sequence_order の重複をチェック
      const orders = items.map(item => item.sequence_order)
      const uniqueOrders = new Set(orders)
      return uniqueOrders.size === orders.length
    }, {
      message: "順序番号が重複しています。異なる番号を指定してください。",
      path: ["routings"] // エラーを表示する場所
    })
})

/**
 * 工程ルーティングリストの型
 */
export type RoutingListInput = z.infer<typeof routingListSchema>
export type RoutingItem = z.infer<typeof routingItemSchema>
