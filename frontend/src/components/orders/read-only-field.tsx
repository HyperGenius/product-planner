import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

interface ReadOnlyFieldProps {
  id: string
  label: string
  value: string | null | undefined
  placeholder?: string
  inputClassName?: string
}

/**
 * ラベル + 読み取り専用 Input。注文の確認モーダル・編集モーダルで共有する。
 * `id` は呼び出し側で `useId()` ベースにし、複数ダイアログが同時にあっても重複しないようにする。
 */
export function ReadOnlyField({
  id,
  label,
  value,
  placeholder = "未設定",
  inputClassName,
}: ReadOnlyFieldProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        readOnly
        value={value ?? ""}
        placeholder={placeholder}
        className={cn("cursor-default", inputClassName)}
      />
    </div>
  )
}
