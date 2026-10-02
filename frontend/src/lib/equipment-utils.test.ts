import { describe, expect, it } from "vitest"

import { ApiError } from "@/lib/api-client"
import type { Equipment } from "@/types/equipment"

import {
  EMPTY_EQUIPMENT_FORM,
  EMPTY_LEDGER_FORM,
  equipmentDetailLabel,
  equipmentDisplayName,
  equipmentFormFromEquipment,
  equipmentSearchKeywords,
  equipmentSaveErrorMessage,
  ledgerFormFromEquipment,
  parseEquipmentForm,
  parseLedgerForm,
  sortEquipments,
} from "./equipment-utils"

const eq = (id: number, name: string, ledger_no: number | null = null): Equipment => ({
  id,
  name,
  ledger_no,
  tenant_id: "t",
  created_at: "",
  updated_at: "",
})

describe("sortEquipments", () => {
  const equipments = [eq(1, "汎用設備グループ"), eq(2, "30t 10号機", 10), eq(3, "15t 2号機", 2), eq(4, "カシメ汎用")]

  it("台帳番号順（数値順）で、台帳番号の無い設備は末尾に名称順で並ぶ", () => {
    expect(sortEquipments(equipments, "ledger_no").map((e) => e.id)).toEqual([3, 2, 4, 1])
  })

  it("設備名順で並ぶ", () => {
    expect(sortEquipments(equipments, "name").map((e) => e.name)).toEqual(
      [...equipments.map((e) => e.name)].sort((a, b) => a.localeCompare(b, "ja"))
    )
  })

  it("呼称順は呼称（無ければ設備名）で並ぶ", () => {
    const withShortNames = [
      { ...eq(1, "25Tシングルクランクプレス"), short_name: "ワシノ25t" },
      { ...eq(2, "アマダ15t"), short_name: null },
      { ...eq(3, "15Tシングルクランクプレス"), short_name: "コマツ15t" },
    ]
    expect(sortEquipments(withShortNames, "short_name").map((e) => e.id)).toEqual([2, 3, 1])
  })

  it("元の配列を変更しない", () => {
    const before = equipments.map((e) => e.id)
    sortEquipments(equipments, "ledger_no")
    expect(equipments.map((e) => e.id)).toEqual(before)
  })
})

describe("equipmentDisplayName", () => {
  it("呼称があれば呼称、無ければ設備名", () => {
    expect(equipmentDisplayName({ name: "25Tシングルクランクプレス", short_name: "ワシノ25t" })).toBe("ワシノ25t")
    expect(equipmentDisplayName({ name: "カシメ汎用", short_name: null })).toBe("カシメ汎用")
    expect(equipmentDisplayName({ name: "カシメ汎用" })).toBe("カシメ汎用")
    expect(equipmentDisplayName({ name: "カシメ汎用", short_name: "" })).toBe("カシメ汎用")
  })
})

describe("parseLedgerForm", () => {
  it("空欄は null になる", () => {
    expect(parseLedgerForm(EMPTY_LEDGER_FORM)).toEqual({
      ok: true,
      value: {
        ledger_no: null,
        maker: null,
        model: null,
        manufactured_on: null,
        serial_no: null,
        note: null,
      },
    })
  })

  it("前後の空白を除去し、台帳番号を数値にする", () => {
    const result = parseLedgerForm({ ...EMPTY_LEDGER_FORM, ledgerNo: " 3 ", manufacturedOn: " S.53年11月 " })
    expect(result).toMatchObject({ ok: true, value: { ledger_no: 3, manufactured_on: "S.53年11月" } })
  })

  it.each(["0", "-1", "1.5", "abc"])("台帳番号 %s はエラー", (ledgerNo) => {
    expect(parseLedgerForm({ ...EMPTY_LEDGER_FORM, ledgerNo }).ok).toBe(false)
  })

  it("ledgerFormFromEquipment と往復できる", () => {
    const equipment = { ...eq(1, "15t 1号機", 1), maker: "メーカーA", note: "備考" }
    expect(parseLedgerForm(ledgerFormFromEquipment(equipment))).toMatchObject({
      ok: true,
      value: { ledger_no: 1, maker: "メーカーA", note: "備考", model: null },
    })
  })
})

describe("equipmentDetailLabel", () => {
  it("呼称があるときは正式名称・メーカー・製造番号を補足に出す（同名の設備を見分ける）", () => {
    const equipment = {
      ...eq(1, "15Tシングルクランクプレス", 1),
      short_name: "A15t(1)",
      maker: "メーカーA",
      serial_no: "S-1",
    }
    expect(equipmentDetailLabel(equipment)).toBe("15Tシングルクランクプレス ／ メーカーA ／ 製造No.S-1")
  })

  it("呼称が無ければ正式名称は表示名と同じなので出さない", () => {
    expect(equipmentDetailLabel({ ...eq(1, "自動組立機"), maker: "メーカーB" })).toBe("メーカーB")
    expect(equipmentDetailLabel(eq(1, "自動組立機"))).toBeNull()
  })
})

describe("equipmentSearchKeywords", () => {
  it("正式名称・呼称・メーカー・製造番号を検索対象にする", () => {
    const equipment = { ...eq(1, "15Tプレス"), short_name: "A15t(1)", maker: "メーカーA" }
    expect(equipmentSearchKeywords(equipment)).toEqual(["15Tプレス", "A15t(1)", "メーカーA"])
  })
})

describe("equipmentSaveErrorMessage", () => {
  it("409 の error コードで文言を出し分ける", () => {
    const ledger = new ApiError(409, { detail: { error: "duplicate_ledger_no" } })
    const displayName = new ApiError(409, { detail: { error: "duplicate_display_name" } })
    expect(equipmentSaveErrorMessage(ledger, "失敗")).toContain("台帳番号")
    expect(equipmentSaveErrorMessage(displayName, "失敗")).toContain("呼称を入力して区別")
  })

  it("それ以外は既定の文言", () => {
    expect(equipmentSaveErrorMessage(new Error("x"), "失敗")).toBe("失敗")
    expect(equipmentSaveErrorMessage(new ApiError(500, {}), "失敗")).toBe("失敗")
  })
})

describe("equipmentFormFromEquipment / parseEquipmentForm", () => {
  it("設備の値をフォームに入れて、そのまま API のペイロードへ戻せる", () => {
    const equipment: Equipment = {
      ...eq(1, "25Tシングルクランクプレス", 1),
      short_name: "プレス25t",
      maker: "メーカーA",
      model: "M-25",
      manufactured_on: "1993年5月",
      serial_no: "S-001",
      note: null,
      guard_time_minutes: 30,
      min_slot_minutes: null,
      max_fragments: 2,
    }
    const form = equipmentFormFromEquipment(equipment)
    expect(form).toMatchObject({ name: "25Tシングルクランクプレス", shortName: "プレス25t", guardTime: "30", minSlot: "", maxFragments: "2" })
    expect(parseEquipmentForm(form)).toEqual({
      ok: true,
      value: {
        name: "25Tシングルクランクプレス",
        short_name: "プレス25t",
        guard_time_minutes: 30,
        min_slot_minutes: null,
        max_fragments: 2,
        ledger_no: 1,
        maker: "メーカーA",
        model: "M-25",
        manufactured_on: "1993年5月",
        serial_no: "S-001",
        note: null,
      },
    })
  })

  it("空欄の呼称は null にする", () => {
    const result = parseEquipmentForm({ ...EMPTY_EQUIPMENT_FORM, name: "プレス", shortName: "  " })
    expect(result.ok && result.value.short_name).toBeNull()
  })

  it("設備名が空・台帳番号が不正ならエラー", () => {
    expect(parseEquipmentForm({ ...EMPTY_EQUIPMENT_FORM, name: " " })).toEqual({
      ok: false,
      error: "設備名を入力してください",
    })
    const invalidLedger = { ...EMPTY_EQUIPMENT_FORM, name: "プレス", ledger: { ...EMPTY_LEDGER_FORM, ledgerNo: "0" } }
    expect(parseEquipmentForm(invalidLedger).ok).toBe(false)
  })
})
