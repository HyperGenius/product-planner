import { describe, expect, it } from "vitest"
import type { Order } from "@/types/order"
import { repairFormValuesFromProductionOrder } from "./repair-order"

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 1,
    order_no: "O-1",
    product_id: null,
    customer_id: 3,
    quantity: 11,
    desired_deadline: "2099-11-10",
    status: "draft",
    customer_certainty: null,
    is_scheduled: false,
    source_type: "email",
    tenant_id: "t1",
    created_at: null,
    updated_at: null,
    ...overrides,
  }
}

describe("repairFormValuesFromProductionOrder（Issue #568）", () => {
  it("読み取った品名と数量を件名・作業内容の下書きにし、日付は空にする", () => {
    const values = repairFormValuesFromProductionOrder(
      makeOrder({
        extracted_product_name: " 基板 はんだ補修 ",
        scheduling_start_date: "2099-10-25",
        simulated_deadline: "2099-10-30",
      }),
    )

    expect(values).toEqual({
      orderNo: "O-1",
      customerId: "3",
      workDescription: "基板 はんだ補修 ×11",
      desiredDeadline: "2099-11-10",
      schedulingStartDate: "",
      simulatedDeadline: "",
    })
  })

  it("作業内容が入っていればそれを使う", () => {
    const values = repairFormValuesFromProductionOrder(
      makeOrder({ work_description: "洗浄", extracted_product_name: "部品A" }),
    )

    expect(values.workDescription).toBe("洗浄")
  })

  it("品名も数量も無ければ空にする", () => {
    const values = repairFormValuesFromProductionOrder(
      makeOrder({
        order_no: null,
        customer_id: undefined,
        quantity: null,
        desired_deadline: undefined,
      }),
    )

    expect(values).toEqual({
      orderNo: "",
      customerId: "",
      workDescription: "",
      desiredDeadline: "",
      schedulingStartDate: "",
      simulatedDeadline: "",
    })
  })
})
