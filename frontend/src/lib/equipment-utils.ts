/* frontend/src/lib/equipment-utils.ts */
import { ApiError } from "@/lib/api-client"
import type { Equipment, EquipmentLedgerFields } from "@/types/equipment"

/** `short_name` は表示名（呼称、無ければ設備名）の順 */
export type EquipmentSortKey = "ledger_no" | "short_name" | "name"

/**
 * 画面表示用の設備名。呼称（`short_name`）があれば呼称、無ければ設備名（台帳の正式名称）。
 * Backend の `equipment_display_name()` と揃える
 */
export function equipmentDisplayName(equipment: Pick<Equipment, "name" | "short_name">): string {
  return equipment.short_name || equipment.name
}

const compareName = (a: Equipment, b: Equipment) => a.name.localeCompare(b.name, "ja")
const compareDisplayName = (a: Equipment, b: Equipment) =>
  equipmentDisplayName(a).localeCompare(equipmentDisplayName(b), "ja")

/**
 * 設備一覧の並び替え（Issue #486）。
 * 台帳番号順では台帳番号の無い設備（「汎用設備グループ」等）を末尾に名称順で並べる。
 */
export function sortEquipments(equipments: Equipment[], key: EquipmentSortKey): Equipment[] {
  const sorted = [...equipments]
  if (key === "name") return sorted.sort(compareName)
  if (key === "short_name") return sorted.sort(compareDisplayName)
  return sorted.sort((a, b) => {
    const an = a.ledger_no ?? null
    const bn = b.ledger_no ?? null
    if (an !== null && bn !== null && an !== bn) return an - bn
    if (an === null && bn !== null) return 1
    if (an !== null && bn === null) return -1
    return compareName(a, b)
  })
}

/** 編集ダイアログの台帳欄の入力値（input の value なので全て文字列） */
export interface LedgerFormValues {
  ledgerNo: string
  maker: string
  model: string
  manufacturedOn: string
  serialNo: string
  note: string
}

export const EMPTY_LEDGER_FORM: LedgerFormValues = {
  ledgerNo: "",
  maker: "",
  model: "",
  manufacturedOn: "",
  serialNo: "",
  note: "",
}

export function ledgerFormFromEquipment(equipment: Equipment): LedgerFormValues {
  return {
    ledgerNo: equipment.ledger_no != null ? String(equipment.ledger_no) : "",
    maker: equipment.maker ?? "",
    model: equipment.model ?? "",
    manufacturedOn: equipment.manufactured_on ?? "",
    serialNo: equipment.serial_no ?? "",
    note: equipment.note ?? "",
  }
}

const optionalText = (value: string) => (value.trim() === "" ? null : value.trim())

export type LedgerFormParseResult =
  | { ok: true; value: Required<EquipmentLedgerFields> }
  | { ok: false; error: string }

/**
 * 台帳欄の入力値を API のペイロードへ変換する。空欄は null（台帳に無い設備は台帳番号 null）。
 * 台帳番号は 1 以上の整数のみ受け付ける（Backend の `ge=1` と揃える）。
 */
export function parseLedgerForm(form: LedgerFormValues): LedgerFormParseResult {
  const ledgerNoText = form.ledgerNo.trim()
  let ledgerNo: number | null = null
  if (ledgerNoText !== "") {
    if (!/^\d+$/.test(ledgerNoText) || Number(ledgerNoText) < 1) {
      return { ok: false, error: "台帳番号は1以上の整数で入力してください" }
    }
    ledgerNo = Number(ledgerNoText)
  }
  return {
    ok: true,
    value: {
      ledger_no: ledgerNo,
      maker: optionalText(form.maker),
      model: optionalText(form.model),
      manufactured_on: optionalText(form.manufacturedOn),
      serial_no: optionalText(form.serialNo),
      note: optionalText(form.note),
    },
  }
}

/** 設備の作成・更新失敗時のトースト文言。重複（409）はどの項目が重複したかを出し分ける */
export function equipmentSaveErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.errorCode === "duplicate_ledger_no") return "同じ台帳番号の設備が既に登録されています"
    if (error.errorCode === "duplicate_short_name") return "同じ呼称の設備が既に登録されています"
    if (error.errorCode === "duplicate_equipment_name") return "同じ名前の設備が既に登録されています"
  }
  return fallback
}
