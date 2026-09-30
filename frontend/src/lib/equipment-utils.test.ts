import { describe, expect, it } from "vitest"

import { ApiError } from "@/lib/api-client"
import type { Equipment } from "@/types/equipment"

import {
  EMPTY_LEDGER_FORM,
  equipmentSaveErrorMessage,
  ledgerFormFromEquipment,
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

  it("元の配列を変更しない", () => {
    const before = equipments.map((e) => e.id)
    sortEquipments(equipments, "ledger_no")
    expect(equipments.map((e) => e.id)).toEqual(before)
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

describe("equipmentSaveErrorMessage", () => {
  it("409 の error コードで文言を出し分ける", () => {
    const ledger = new ApiError(409, { detail: { error: "duplicate_ledger_no" } })
    const name = new ApiError(409, { detail: { error: "duplicate_equipment_name" } })
    expect(equipmentSaveErrorMessage(ledger, "失敗")).toContain("台帳番号")
    expect(equipmentSaveErrorMessage(name, "失敗")).toContain("名前")
  })

  it("それ以外は既定の文言", () => {
    expect(equipmentSaveErrorMessage(new Error("x"), "失敗")).toBe("失敗")
    expect(equipmentSaveErrorMessage(new ApiError(500, {}), "失敗")).toBe("失敗")
  })
})
