"use client"

import { useState } from "react"
import { toast } from "sonner"
import { useSetMyPin } from "@/hooks/use-member-pin"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const PIN_PATTERN = /^\d{4}$/

/**
 * 自分自身のPIN設定ページ
 * URL: /settings/pin
 *
 * 共有端末を信頼済み端末として登録した後、この端末上でPINログイン（パスワード不要）
 * を使うために、各メンバーが自分自身のPINをここで設定する。ロール制限はない。
 */
export default function PinSettingsPage() {
  const [pin, setPin] = useState("")
  const [confirmPin, setConfirmPin] = useState("")
  const setPinMutation = useSetMyPin()

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (!PIN_PATTERN.test(pin)) {
      toast.error("PINは4桁の数字で入力してください")
      return
    }
    if (pin !== confirmPin) {
      toast.error("PINが一致しません")
      return
    }

    setPinMutation.mutate(pin, {
      onSuccess: () => {
        toast.success("PINを設定しました")
        setPin("")
        setConfirmPin("")
      },
      onError: (err) => {
        toast.error(err.message || "PINの設定に失敗しました")
      },
    })
  }

  return (
    <div className="space-y-6 max-w-sm">
      <div>
        <h1 className="text-2xl font-bold">PIN設定</h1>
        <p className="text-muted-foreground text-sm mt-1">
          信頼済み端末（共有端末）でパスワードなしでログインするための4桁PINを設定します
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="pin">新しいPIN（4桁）</Label>
          <Input
            id="pin"
            type="password"
            inputMode="numeric"
            maxLength={4}
            placeholder="••••"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm-pin">PIN（確認）</Label>
          <Input
            id="confirm-pin"
            type="password"
            inputMode="numeric"
            maxLength={4}
            placeholder="••••"
            value={confirmPin}
            onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ""))}
          />
        </div>
        <Button type="submit" disabled={setPinMutation.isPending}>
          {setPinMutation.isPending ? "設定中..." : "PINを設定"}
        </Button>
      </form>
    </div>
  )
}
