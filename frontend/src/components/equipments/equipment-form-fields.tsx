"use client"

import type { EquipmentFormValues, LedgerFormValues } from "@/lib/equipment-utils"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

interface SchedulingParamFieldsProps {
  guardTime: string
  minSlot: string
  maxFragments: string
  onGuardTimeChange: (v: string) => void
  onMinSlotChange: (v: string) => void
  onMaxFragmentsChange: (v: string) => void
  idPrefix: string
}

/** スケジューリング設定（設備・設備グループ共通）。空欄はグローバル設定を使う */
export function SchedulingParamFields({
  guardTime, minSlot, maxFragments,
  onGuardTimeChange, onMinSlotChange, onMaxFragmentsChange,
  idPrefix,
}: SchedulingParamFieldsProps) {
  return (
    <div className="space-y-3 border-t pt-3">
      <p className="text-xs font-medium text-muted-foreground">
        スケジューリング設定（空欄 = グローバル設定を使用）
      </p>
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-guard`}>ガードタイム（分）</Label>
        <Input
          id={`${idPrefix}-guard`}
          type="number"
          min={0}
          value={guardTime}
          onChange={(e) => onGuardTimeChange(e.target.value)}
          placeholder="デフォルト使用中"
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-min-slot`}>最低時間スロット（分）</Label>
        <Input
          id={`${idPrefix}-min-slot`}
          type="number"
          min={0}
          value={minSlot}
          onChange={(e) => onMinSlotChange(e.target.value)}
          placeholder="デフォルト使用中"
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-max-frag`}>最大断片数</Label>
        <Input
          id={`${idPrefix}-max-frag`}
          type="number"
          min={1}
          value={maxFragments}
          onChange={(e) => onMaxFragmentsChange(e.target.value)}
          placeholder="デフォルト使用中"
        />
      </div>
    </div>
  )
}

const LEDGER_TEXT_FIELDS: { key: Exclude<keyof LedgerFormValues, "ledgerNo">; label: string; placeholder: string }[] = [
  { key: "maker", label: "メーカー", placeholder: "" },
  { key: "model", label: "型式", placeholder: "" },
  { key: "manufacturedOn", label: "製造年月", placeholder: "例: 1993年5月" },
  { key: "serialNo", label: "製造番号", placeholder: "" },
  { key: "note", label: "備考", placeholder: "" },
]

interface LedgerFieldsProps {
  values: LedgerFormValues
  onChange: (values: LedgerFormValues) => void
  idPrefix: string
}

/** 設備台帳（顧客の正典）の情報。台帳に無い設備は台帳番号を空欄にする（Issue #486） */
function LedgerFields({ values, onChange, idPrefix }: LedgerFieldsProps) {
  return (
    <div className="space-y-3 border-t pt-3">
      <p className="text-xs font-medium text-muted-foreground">
        設備台帳（台帳に無い設備は台帳番号を空欄）
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-2">
          <Label htmlFor={`${idPrefix}-ledger-no`}>台帳番号</Label>
          <Input
            id={`${idPrefix}-ledger-no`}
            type="number"
            min={1}
            value={values.ledgerNo}
            onChange={(e) => onChange({ ...values, ledgerNo: e.target.value })}
            placeholder="例: 3"
          />
        </div>
        {LEDGER_TEXT_FIELDS.map(({ key, label, placeholder }) => (
          <div key={key} className={key === "note" ? "col-span-2 grid gap-2" : "grid gap-2"}>
            <Label htmlFor={`${idPrefix}-${key}`}>{label}</Label>
            <Input
              id={`${idPrefix}-${key}`}
              value={values[key]}
              onChange={(e) => onChange({ ...values, [key]: e.target.value })}
              placeholder={placeholder}
              autoComplete="off"
            />
          </div>
        ))}
      </div>
    </div>
  )
}

interface EquipmentFormFieldsProps {
  values: EquipmentFormValues
  onChange: (values: EquipmentFormValues) => void
  idPrefix: string
}

/** 設備の作成・編集フォーム（設備名・呼称・設備台帳・スケジューリング設定） */
export function EquipmentFormFields({ values, onChange, idPrefix }: EquipmentFormFieldsProps) {
  const set = (patch: Partial<EquipmentFormValues>) => onChange({ ...values, ...patch })
  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-name`}>設備名（正式名称）</Label>
        <Input
          id={`${idPrefix}-name`}
          value={values.name}
          onChange={(e) => set({ name: e.target.value })}
          placeholder="例: 25Tシングルクランクプレス"
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-short-name`}>呼称</Label>
        <Input
          id={`${idPrefix}-short-name`}
          value={values.shortName}
          onChange={(e) => set({ shortName: e.target.value })}
          placeholder="例: ワシノ25t"
          autoComplete="off"
        />
        <p className="text-xs text-muted-foreground">
          ガントチャート等の表示に使う短い名前です。空欄なら設備名を表示します。
          同じ設備名の設備が既にある場合は、区別できる呼称を入力してください
        </p>
      </div>
      <LedgerFields values={values.ledger} onChange={(ledger) => set({ ledger })} idPrefix={idPrefix} />
      <SchedulingParamFields
        guardTime={values.guardTime}
        minSlot={values.minSlot}
        maxFragments={values.maxFragments}
        onGuardTimeChange={(guardTime) => set({ guardTime })}
        onMinSlotChange={(minSlot) => set({ minSlot })}
        onMaxFragmentsChange={(maxFragments) => set({ maxFragments })}
        idPrefix={idPrefix}
      />
    </div>
  )
}
