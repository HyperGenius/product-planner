import { z } from "zod"

/**
 * 注文フォームのバリデーションスキーマ
 */
export const orderFormSchema = z.object({
  order_no: z.string().min(1, "注文番号は必須です"),
  product_id: z.string().min(1, "製品を選択してください"),
  quantity: z
    .number({ message: "数量は数値で入力してください" })
    .int("数量は整数で入力してください")
    .min(1, "数量は1以上を指定してください"),
  desired_deadline: z.string().optional(),
})

/**
 * 注文フォームの型
 */
export type OrderFormInput = z.infer<typeof orderFormSchema>
