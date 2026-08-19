"use client"

import { useState } from "react"
import { Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import {
  useDeviceTrusts,
  useRegisterDevice,
  useRevokeDevice,
} from "@/hooks/use-device-trust"
import type { DeviceTrust } from "@/types/device"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

function isExpiredOrRevoked(device: DeviceTrust): boolean {
  return !!device.revoked_at || new Date(device.expires_at) <= new Date()
}

/**
 * 信頼済み端末管理ページ
 * URL: /settings/devices
 *
 * 共有端末をこのテナントの信頼済み端末として登録・失効させる（president / platform_admin のみ）。
 * 信頼済み端末上では、ログイン画面でPINによる操作者切り替えが可能になる。
 */
export default function DevicesPage() {
  const [isRevokeDialogOpen, setIsRevokeDialogOpen] = useState(false)
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null)

  const { data: devices, isLoading, error } = useDeviceTrusts()
  const registerMutation = useRegisterDevice()
  const revokeMutation = useRevokeDevice()

  const handleRegister = () => {
    registerMutation.mutate(undefined, {
      onSuccess: () => {
        toast.success("この端末を信頼済み端末として登録しました")
      },
      onError: (err) => {
        toast.error(err.message || "端末の登録に失敗しました")
      },
    })
  }

  const handleOpenRevokeDialog = (deviceId: string) => {
    setSelectedDeviceId(deviceId)
    setIsRevokeDialogOpen(true)
  }

  const handleRevoke = () => {
    if (!selectedDeviceId) return
    revokeMutation.mutate(selectedDeviceId, {
      onSuccess: () => {
        setIsRevokeDialogOpen(false)
        toast.success("端末信頼を失効させました")
      },
      onError: (err) => {
        toast.error(err.message || "失効に失敗しました")
      },
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">端末管理</h1>
          <p className="text-muted-foreground text-sm mt-1">
            信頼済み端末を管理します。信頼済み端末では、ログイン画面でPINによる操作者切り替えが可能になります
          </p>
        </div>
        <Button onClick={handleRegister} disabled={registerMutation.isPending}>
          <Plus className="mr-2 h-4 w-4" />
          {registerMutation.isPending ? "登録中..." : "この端末を信頼済みにする"}
        </Button>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">読み込み中...</p>
      ) : error ? (
        <p className="text-destructive">
          {error.message.includes("403")
            ? "この画面は管理者のみアクセスできます"
            : "端末情報の取得に失敗しました"}
        </p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>端末ID</TableHead>
                <TableHead>登録日時</TableHead>
                <TableHead>有効期限</TableHead>
                <TableHead>状態</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {devices && devices.length > 0 ? (
                devices.map((device) => {
                  const expired = isExpiredOrRevoked(device)
                  return (
                    <TableRow key={device.device_id}>
                      <TableCell className="font-mono text-xs">
                        {device.device_id.slice(0, 12)}…
                      </TableCell>
                      <TableCell>
                        {new Date(device.created_at).toLocaleString("ja-JP")}
                      </TableCell>
                      <TableCell>
                        {new Date(device.expires_at).toLocaleDateString("ja-JP")}
                      </TableCell>
                      <TableCell>
                        {device.revoked_at ? (
                          <Badge variant="outline">失効済み</Badge>
                        ) : expired ? (
                          <Badge variant="outline">期限切れ</Badge>
                        ) : (
                          <Badge>有効</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {!device.revoked_at && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleOpenRevokeDialog(device.device_id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    信頼済み端末がありません
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <AlertDialog open={isRevokeDialogOpen} onOpenChange={setIsRevokeDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>端末信頼を失効させますか？</AlertDialogTitle>
            <AlertDialogDescription>
              この端末ではPINログインが使えなくなります。この操作は取り消せません。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRevoke}
              disabled={revokeMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {revokeMutation.isPending ? "失効中..." : "失効させる"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
