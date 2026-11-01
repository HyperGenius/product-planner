import { describe, expect, it } from "vitest"
import { http, HttpResponse } from "msw"
import { render, screen, userEvent, waitFor } from "@/test-utils/render"
import { server } from "@/test-utils/msw/server"
import { API_BASE } from "@/test-utils/msw/handlers"
import type { Customer, CustomerMergeCounts, CustomerMergePreview } from "@/types/customer"
import { CustomerMergeDialog, mergeCountLines } from "./customer-merge-dialog"

/** 顧客の統合ダイアログ (Issue #610)。顧客名・アドレスはダミー */

function customer(id: number, name: string): Customer {
  return {
    id,
    name,
    status: "active",
    tenant_id: "tenant-1",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  }
}

const COUNTS: CustomerMergeCounts = {
  orders_reassigned: 3,
  attachments_reassigned: 0,
  aliases_reassigned: 2,
  aliases_dropped: 1,
  alias_history_reassigned: 0,
  customer_aliases_reassigned: 0,
  unallocated_actuals_reassigned: 0,
  prompt_history_reassigned: 0,
  contacts_reassigned: 1,
  customers_deleted: 1,
}

function preview(blockers: CustomerMergePreview["blockers"] = []): CustomerMergePreview {
  return {
    keep_customer_id: 1,
    merge_customer_ids: [2],
    merge_customers: [{ id: 2, name: "顧客A社 担当X", alias: null, email: null }],
    counts: COUNTS,
    blockers,
  }
}

function mockApi(blockers: CustomerMergePreview["blockers"] = []) {
  const merges: unknown[] = []
  server.use(
    http.get(`${API_BASE}/customers`, () =>
      HttpResponse.json([customer(1, "顧客A社"), customer(2, "顧客A社 担当X")]),
    ),
    http.post(`${API_BASE}/customers/merge/preview`, () => HttpResponse.json(preview(blockers))),
    http.post(`${API_BASE}/customers/merge`, async ({ request }) => {
      merges.push(await request.json())
      return HttpResponse.json(COUNTS)
    }),
  )
  return merges
}

async function selectCustomers() {
  await userEvent.click(await screen.findByRole("combobox"))
  await userEvent.click(await screen.findByRole("option", { name: /^顧客A社$/ }))
  await userEvent.click(await screen.findByLabelText(/顧客A社 担当X/))
}

describe("mergeCountLines", () => {
  it("0件の項目を出さない", () => {
    expect(mergeCountLines(COUNTS)).toEqual(["注文 3件", "製品の別名 2件", "担当者（メールアドレス） 1件"])
  })
})

describe("CustomerMergeDialog", () => {
  it("プレビューを確認して統合を実行する", async () => {
    const merges = mockApi()
    render(<CustomerMergeDialog open onOpenChange={() => {}} />)

    await selectCustomers()
    expect(await screen.findByText("注文 3件")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "統合する" }))

    await waitFor(() => expect(merges).toHaveLength(1))
    expect(merges[0]).toEqual({ keep_customer_id: 1, merge_customer_ids: [2] })
  })

  it("統合できない理由があると実行できない", async () => {
    const merges = mockApi([
      {
        reason: "order_conflict",
        customer_id: 2,
        customer_name: "顧客A社 担当X",
        order_id: 9,
        order_number: "A-9",
        order_status: "draft",
        conflicting_order_id: 3,
        conflicting_order_number: null,
      },
    ])
    render(<CustomerMergeDialog open onOpenChange={() => {}} />)

    await selectCustomers()
    expect(await screen.findByText(/統合できません/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "統合する" })).toBeDisabled()
    expect(merges).toHaveLength(0)
  })
})
