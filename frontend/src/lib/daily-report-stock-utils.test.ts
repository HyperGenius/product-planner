import { describe, expect, it } from "vitest"
import type { ProcessProgress } from "@/types/daily-report-progress"
import type {
  StockAssignment,
  StockEstimate,
  StockEstimates,
  StockFeedback,
  StockSourceEntry,
} from "@/types/daily-report-stock"
import {
  distinctRawValues,
  feedbackSummary,
  feedbackWithoutEstimates,
  initialStockAssignmentForm,
  isAssignmentPending,
  plannedSourceUsage,
  shouldShowStockHint,
  stockAssignmentWarnings,
  stockProcessRows,
  suggestedStockQty,
  groupStockByConsumer,
  initialStockFeedbackForm,
  stockConsumedByLabel,
  toStockAssignmentInput,
  toStockFeedbackInput,
  type StockAssignmentForm,
  type StockFeedbackForm,
} from "./daily-report-stock-utils"

/** 日報からの作り置きの推定の表示ロジック (Issue #591)。製品はダミー値 */

function feedback(overrides: Partial<StockFeedback>): StockFeedback {
  return {
    product_id: 1,
    product_name: "テスト製品A",
    product_code: null,
    kind: "stock_process",
    process_name: "プレス",
    baseline_qty: null,
    baseline_date: null,
    note: null,
    updated_by: "u1",
    updated_at: "2026-10-29T01:00:00Z",
    ...overrides,
  }
}

const FORM: StockFeedbackForm = {
  kind: "stock_process",
  processName: "プレス",
  baselineQty: "",
  baselineDate: "2026-10-29",
  note: "",
}

describe("daily-report-stock-utils", () => {
  it("推定数が何で減るかを出す", () => {
    expect(stockConsumedByLabel({ next_process_name: "カシメ" })).toBe("「カシメ」で使うと減ります")
    expect(stockConsumedByLabel({ next_process_name: null })).toBe(
      "日報の最後の工程なので、送品で減ります",
    )
  })

  it("推定を消費先の工程ごとにまとめる（グループは推定数の多い行の順、行は入力の順）", () => {
    const item = (product_id: number, next: string | null, qty: number): StockEstimate => ({
      product_id,
      product_name: null,
      product_code: null,
      process_name: "プレス",
      next_process_name: next,
      qty,
      last_movement_date: null,
    })
    const groups = groupStockByConsumer([
      item(1, null, 500),
      item(2, "検査", 300),
      item(3, null, 200),
      item(4, "検査", 100),
    ])
    expect(groups.map((g) => [g.nextProcessName, g.items.map((i) => i.product_id)])).toEqual([
      [null, [1, 3]],
      ["検査", [2, 4]],
    ])
    expect(groupStockByConsumer([])).toEqual([])
  })

  it("指摘の内容を要約する", () => {
    expect(feedbackSummary(feedback({ kind: "not_stocked", process_name: null }))).toBe(
      "作り置きしていない",
    )
    expect(feedbackSummary(feedback({}))).toBe("「プレス」の後に作り置き")
    expect(
      feedbackSummary(feedback({ baseline_qty: 1200, baseline_date: "2026-09-30" })),
    ).toBe("「プレス」の後に作り置き（2026/09/30 時点で 1,200 個）")
  })

  it("推定が出ていない製品の指摘だけを返す", () => {
    const data: StockEstimates = {
      computed_at: null,
      items: [
        {
          product_id: 1,
          product_name: "テスト製品A",
          product_code: null,
          process_name: "プレス",
          next_process_name: null,
          qty: 10,
          last_movement_date: "2026-10-01",
        },
      ],
      feedback: [feedback({ product_id: 1 }), feedback({ product_id: 2, kind: "not_stocked" })],
    }

    expect(feedbackWithoutEstimates(data).map((f) => f.product_id)).toEqual([2])
  })

  it("既存の指摘があればフォームの初期値にする", () => {
    const defaults = { processName: "カシメ", today: "2026-10-29" }
    expect(initialStockFeedbackForm(undefined, defaults)).toEqual({
      ...FORM,
      processName: "カシメ",
    })
    expect(
      initialStockFeedbackForm(
        feedback({ baseline_qty: 5, baseline_date: "2026-10-01", note: "棚" }),
        defaults,
      ),
    ).toEqual({
      kind: "stock_process",
      processName: "プレス",
      baselineQty: "5",
      baselineDate: "2026-10-01",
      note: "棚",
    })
  })

  describe("toStockFeedbackInput", () => {
    it("作り置きしていない: 工程・数は送らない", () => {
      expect(toStockFeedbackInput({ ...FORM, kind: "not_stocked", baselineQty: "3", note: " 試作 " })).toEqual({
        input: { kind: "not_stocked", note: "試作" },
      })
    })

    it("数が空欄なら基準値なし", () => {
      expect(toStockFeedbackInput(FORM)).toEqual({
        input: {
          kind: "stock_process",
          process_name: "プレス",
          baseline_qty: null,
          baseline_date: null,
          note: null,
        },
      })
    })

    it("数を入れたら基準日と一緒に送る", () => {
      expect(toStockFeedbackInput({ ...FORM, baselineQty: " 12 " }).input).toMatchObject({
        baseline_qty: 12,
        baseline_date: "2026-10-29",
      })
    })

    it.each([
      [{ processName: " " }, "工程を選んでください"],
      [{ baselineQty: "-1" }, "数は0以上の整数で入力してください"],
      [{ baselineQty: "1.5" }, "数は0以上の整数で入力してください"],
      [{ baselineQty: "3", baselineDate: "" }, "数えた日を入力してください"],
    ])("入力の誤り %o", (patch, error) => {
      expect(toStockFeedbackInput({ ...FORM, ...patch })).toEqual({ error })
    })
  })
})

describe("作り置きの引き当て (Issue #624)", () => {
  describe("initialStockAssignmentForm", () => {
    it("工程ルートで最も後の工程の推定を選び、数は推定数と受注数量の小さい方", () => {
      const data = {
        stock_estimates: [
          { process_name: "カシメ", next_process_name: "クグシ", qty: 28, last_movement_date: null },
          { process_name: "クグシ", next_process_name: null, qty: 8222, last_movement_date: null },
        ],
      }
      expect(initialStockAssignmentForm(data, 5000)).toEqual({
        processName: "クグシ",
        qty: "5000",
        note: "",
      })
      expect(initialStockAssignmentForm(data, 10000).qty).toBe("8222")
    })

    it("推定が無ければ、未割当の日報のある工程のうち工程ルートで最も後の工程を選ぶ（Issue #673）", () => {
      const data = {
        stock_estimates: [],
        process_names: ["プレス", "カシメ", "クグシ"],
        candidate_totals: { プレス: { count: 1, qty: 10 }, カシメ: { count: 2, qty: 300 } },
      }
      expect(initialStockAssignmentForm(data, 100)).toEqual({
        processName: "カシメ",
        qty: "100",
        note: "",
      })
    })

    it("推定が無ければ空欄", () => {
      expect(initialStockAssignmentForm({ stock_estimates: [] }, 100)).toEqual({
        processName: "",
        qty: "",
        note: "",
      })
    })
  })

  describe("toStockAssignmentInput", () => {
    const FORM: StockAssignmentForm = { processName: "クグシ", qty: "5000", note: " 棚の分 " }

    it("工程・数・メモを API の入力にする", () => {
      expect(toStockAssignmentInput(FORM, 5000)).toEqual({
        input: { process_name: "クグシ", qty: 5000, note: "棚の分" },
      })
      expect(toStockAssignmentInput({ ...FORM, note: " " }, 5000).input?.note).toBeNull()
    })

    it.each<[Partial<StockAssignmentForm>, string]>([
      [{ processName: " " }, "工程を選んでください"],
      [{ qty: "" }, "数は1以上の整数で入力してください"],
      [{ qty: "0" }, "数は1以上の整数で入力してください"],
      [{ qty: "1.5" }, "数は1以上の整数で入力してください"],
      [{ qty: "5001" }, "数は受注数量（5,000）以下にしてください"],
    ])("入力の誤り %o", (patch, error) => {
      expect(toStockAssignmentInput({ ...FORM, ...patch }, 5000)).toEqual({ error })
    })
  })
})

describe("作り置きの引き当てのダイアログ (Issue #673)", () => {
  const ASSIGNMENT: StockAssignment = {
    id: "a-1",
    order_id: 1,
    process_name: "カシメ",
    qty: 7,
    assigned_on: "2026-11-02",
    note: null,
    updated_by: "u1",
    updated_at: "2026-11-02T01:00:00Z",
    sources: [],
  }
  const DATA = {
    process_names: ["プレス", "カシメ", "クグシ"],
    stock_estimates: [
      { process_name: "クグシ", next_process_name: null, qty: 8222, last_movement_date: null },
    ],
    candidate_totals: { プレス: { count: 3, qty: 60 }, クグシ: { count: 1, qty: 10 } },
    assignments: [ASSIGNMENT],
  }
  const entry = (overrides: Partial<StockSourceEntry>): StockSourceEntry => ({
    entry_id: 1,
    work_date: "2026-10-20",
    product_raw: "テスト製品",
    customer_raw: "A社",
    equipment_raw: null,
    qty: 10,
    ...overrides,
  })

  describe("suggestedStockQty", () => {
    it.each<[string, number, string]>([
      // 推定があれば推定と受注数量の小さい方
      ["クグシ", 5000, "5000"],
      ["クグシ", 10000, "8222"],
      // 推定が無ければ未割当の日報の合計
      ["プレス", 5000, "60"],
      // 登録済みの引き当てがあればその数
      ["カシメ", 5000, "7"],
      ["", 5000, ""],
    ])("%s（受注数量 %d）→ %s", (processName, orderQuantity, expected) => {
      expect(suggestedStockQty(DATA, processName, orderQuantity)).toBe(expected)
    })

    it("推定も未割当も無ければ空欄", () => {
      expect(suggestedStockQty({ ...DATA, assignments: [] }, "カシメ", 100)).toBe("")
    })
  })

  describe("stockProcessRows", () => {
    it("工程ルートの順に全工程の行を作り、次の工程・実績・登録済みを付ける", () => {
      const rows = stockProcessRows(DATA, [
        { process_name: "プレス", good_qty: 5 },
        { process_name: "プレス", good_qty: 8 },
      ])
      expect(rows).toEqual([
        {
          processName: "プレス",
          nextProcessName: "カシメ",
          estimateQty: null,
          candidateCount: 3,
          candidateQty: 60,
          actualQty: 8,
          assignedQty: null,
          hasStock: true,
        },
        {
          processName: "カシメ",
          nextProcessName: "クグシ",
          estimateQty: null,
          candidateCount: 0,
          candidateQty: 0,
          actualQty: null,
          assignedQty: 7,
          hasStock: false,
        },
        {
          processName: "クグシ",
          nextProcessName: null,
          estimateQty: 8222,
          candidateCount: 1,
          candidateQty: 10,
          actualQty: null,
          assignedQty: null,
          hasStock: true,
        },
      ])
    })
  })

  describe("plannedSourceUsage", () => {
    const entries = [{ qty: 30 }, { qty: 50 }, { qty: 20 }]

    it.each<[string, number[]]>([
      ["60", [30, 30, 0]],
      ["200", [30, 50, 20]],
      ["0", [0, 0, 0]],
      ["", [0, 0, 0]],
      ["1.5", [0, 0, 0]],
    ])("%s 個を新しい順に割り振る", (qty, expected) => {
      expect(plannedSourceUsage(entries, qty)).toEqual(expected)
    })
  })

  describe("distinctRawValues", () => {
    it("重複と空欄を除いて出てきた順に並べる", () => {
      const entries = [
        entry({ product_raw: "B" }),
        entry({ product_raw: " A " }),
        entry({ product_raw: "B" }),
        entry({ product_raw: null }),
        entry({ product_raw: " " }),
      ]
      expect(distinctRawValues(entries, "product_raw")).toEqual(["B", "A"])
    })
  })

  describe("stockAssignmentWarnings", () => {
    const BASE = {
      qtyText: "10",
      candidateQty: 10,
      usedEntries: [{ customer_id: 1 }],
      orderCustomerId: 1,
      existingQty: null,
    }

    it("問題が無ければ注意なし", () => {
      expect(stockAssignmentWarnings(BASE)).toEqual([])
    })

    it("数が未割当の合計を超える", () => {
      expect(stockAssignmentWarnings({ ...BASE, qtyText: "11" })).toEqual([
        "未割当の日報は合計 10 個です。集計で充てられるのは 10 個までです",
      ])
      expect(stockAssignmentWarnings({ ...BASE, candidateQty: 0, usedEntries: [] })).toEqual([
        "この工程に未割当の日報はありません。日報が取り込まれるまで、集計では作り置きを充てられません",
      ])
    })

    it("充てる明細の顧客が受注の顧客と違う（照合できない明細・顧客不明の受注は比べない）", () => {
      const message =
        "日報の顧客先が受注の顧客と違う明細があります。顧客先の誤記なら、このまま引き当ててかまいません"
      expect(stockAssignmentWarnings({ ...BASE, usedEntries: [{ customer_id: 2 }] })).toEqual([message])
      expect(stockAssignmentWarnings({ ...BASE, usedEntries: [{ customer_id: null }, {}] })).toEqual([])
      expect(
        stockAssignmentWarnings({ ...BASE, usedEntries: [{ customer_id: 2 }], orderCustomerId: null }),
      ).toEqual([])
    })

    it("登録済みを上書きする", () => {
      expect(stockAssignmentWarnings({ ...BASE, existingQty: 1200 })).toEqual([
        "登録済みの引き当て（1,200 個）を上書きします",
      ])
    })
  })
})

describe("引き当てのカードと進捗の案内 (Issue #673)", () => {
  describe("isAssignmentPending", () => {
    it.each<[string, string | null, boolean]>([
      ["2026-11-02T04:00:00Z", "2026-11-02T03:00:00Z", true],
      ["2026-11-02T02:00:00Z", "2026-11-02T03:00:00Z", false],
      // タイムゾーンの表記が違っても時刻で比べる
      ["2026-11-02T11:30:00+09:00", "2026-11-02T03:00:00Z", false],
      ["2026-11-02T02:00:00Z", null, true],
    ])("登録 %s・集計 %s → 反映待ち %s", (updatedAt, computedAt, expected) => {
      expect(isAssignmentPending({ updated_at: updatedAt }, computedAt)).toBe(expected)
    })
  })

  describe("shouldShowStockHint", () => {
    const PROGRESS = {
      computed_at: "2026-11-02T03:00:00Z",
      processes: [
        { process_name: "プレス", good_qty: 0, status: "not_started" as const },
        { process_name: "検査", good_qty: 0, status: "not_started" as const },
      ] as ProcessProgress[],
    }
    const STOCK = {
      computed_at: "2026-11-02T03:00:00Z",
      assignable: true,
      process_names: ["プレス", "検査"],
      stock_estimates: [],
      candidate_totals: { 検査: { count: 1, qty: 10 } },
      assignments: [] as StockAssignment[],
    }
    const PENDING: StockAssignment = {
      id: "a-1",
      order_id: 1,
      process_name: "検査",
      qty: 10,
      assigned_on: "2026-11-02",
      note: null,
      updated_by: "u1",
      updated_at: "2026-11-02T04:00:00Z",
      sources: [],
    }

    it("実績の無い工程があり、引き当てられるもの（未割当の日報だけでも）があれば出す", () => {
      expect(shouldShowStockHint(PROGRESS, STOCK)).toBe(true)
    })

    it.each<[string, Parameters<typeof shouldShowStockHint>[0], Parameters<typeof shouldShowStockHint>[1]]>([
      ["進捗が未取得", undefined, STOCK],
      ["引き当てが未取得", PROGRESS, undefined],
      ["進捗が未集計", { ...PROGRESS, computed_at: null }, STOCK],
      ["引き当てられない受注", PROGRESS, { ...STOCK, assignable: false }],
      [
        "すべての工程に実績がある",
        {
          ...PROGRESS,
          processes: PROGRESS.processes.map((p) => ({ ...p, status: "in_progress" as const })),
        },
        STOCK,
      ],
      ["引き当てられるものが無い", PROGRESS, { ...STOCK, candidate_totals: {} }],
      ["反映待ちの引き当てがある", PROGRESS, { ...STOCK, assignments: [PENDING] }],
    ])("%s なら出さない", (_label, progress, stock) => {
      expect(shouldShowStockHint(progress, stock)).toBe(false)
    })

    it("反映済みの引き当てだけなら、まだ実績の無い工程があれば出す", () => {
      const reflected = { ...PENDING, updated_at: "2026-11-02T02:00:00Z" }
      expect(shouldShowStockHint(PROGRESS, { ...STOCK, assignments: [reflected] })).toBe(true)
    })
  })
})
