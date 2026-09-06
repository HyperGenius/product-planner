"use client"

import { useState } from "react"
import {
  Plus,
  Pencil,
  Trash2,
  Copy,
  RefreshCw,
  KeyRound,
  Lock,
} from "lucide-react"
import { toast } from "sonner"
import {
  useTenantMembers,
  useCreateTenantMember,
  useUpdateTenantMember,
  useDeleteTenantMember,
  useResetMemberPassword,
} from "@/hooks/use-tenant-members"
import { useResetMemberPin } from "@/hooks/use-member-pin"
import type { TenantMember, MemberRole } from "@/types/member"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
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

const ROLE_LABELS: Record<MemberRole, string> = {
  president: "社長",
  iso_officer: "ISO担当",
  order_handler: "受注担当",
  platform_admin: "プラットフォーム管理者",
}

const ROLE_BADGE_VARIANTS: Record<MemberRole, "default" | "secondary" | "outline"> = {
  president: "default",
  iso_officer: "outline",
  order_handler: "secondary",
  platform_admin: "outline",
}

/**
 * パスワードをセキュアにランダム生成するユーティリティ
 * 英字大小・数字・記号を含む12文字
 */
function generatePassword(): string {
  const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
  const lower = "abcdefghijklmnopqrstuvwxyz"
  const digits = "0123456789"
  const symbols = "!@#$%^&*"
  const all = upper + lower + digits + symbols

  const getRandom = (chars: string) =>
    chars[Math.floor(Math.random() * chars.length)]

  // 各種類から最低1文字を確保
  const required = [
    getRandom(upper),
    getRandom(lower),
    getRandom(digits),
    getRandom(symbols),
  ]

  // 残り8文字をランダムに埋める
  const rest = Array.from({ length: 8 }, () => getRandom(all))

  // シャッフルして返す
  return [...required, ...rest]
    .sort(() => Math.random() - 0.5)
    .join("")
}

/**
 * テナントメンバー管理ページ
 * URL: /settings/members
 */
export default function MembersPage() {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isPinResetDialogOpen, setIsPinResetDialogOpen] = useState(false)
  const [isPasswordResetDialogOpen, setIsPasswordResetDialogOpen] =
    useState(false)
  const [selectedMember, setSelectedMember] = useState<TenantMember | null>(null)
  const [createdPassword, setCreatedPassword] = useState<string | null>(null)
  // パスワードリセット用: 送信する新パスワードと、リセット完了後に表示する値
  const [pwResetNewPassword, setPwResetNewPassword] = useState("")
  const [pwResetResult, setPwResetResult] = useState<string | null>(null)

  // 追加フォームの状態
  const [newEmail, setNewEmail] = useState("")
  const [newFullName, setNewFullName] = useState("")
  const [newRole, setNewRole] = useState<MemberRole>("order_handler")
  const [newPassword, setNewPassword] = useState("")

  // 編集フォームの状態
  const [editFullName, setEditFullName] = useState("")
  const [editRole, setEditRole] = useState<MemberRole>("order_handler")

  const { data: members, isLoading, error } = useTenantMembers()
  const createMutation = useCreateTenantMember()
  const updateMutation = useUpdateTenantMember()
  const deleteMutation = useDeleteTenantMember()
  const resetPinMutation = useResetMemberPin()
  const resetPasswordMutation = useResetMemberPassword()

  // 追加ダイアログを開く
  const handleOpenCreateDialog = () => {
    setNewEmail("")
    setNewFullName("")
    setNewRole("order_handler")
    setNewPassword(generatePassword())
    setCreatedPassword(null)
    setIsCreateDialogOpen(true)
  }

  // 編集ダイアログを開く
  const handleOpenEditDialog = (member: TenantMember) => {
    setSelectedMember(member)
    setEditFullName(member.full_name ?? "")
    setEditRole(member.role)
    setIsEditDialogOpen(true)
  }

  // 削除ダイアログを開く
  const handleOpenDeleteDialog = (member: TenantMember) => {
    setSelectedMember(member)
    setIsDeleteDialogOpen(true)
  }

  // PINリセットダイアログを開く
  const handleOpenPinResetDialog = (member: TenantMember) => {
    setSelectedMember(member)
    setIsPinResetDialogOpen(true)
  }

  // パスワードリセットダイアログを開く
  const handleOpenPasswordResetDialog = (member: TenantMember) => {
    setSelectedMember(member)
    setPwResetNewPassword(generatePassword())
    setPwResetResult(null)
    setIsPasswordResetDialogOpen(true)
  }

  // メンバー追加
  const handleCreate = () => {
    if (!newEmail || !newFullName || !newPassword) {
      toast.error("すべての項目を入力してください")
      return
    }
    createMutation.mutate(
      { email: newEmail, password: newPassword, full_name: newFullName, role: newRole },
      {
        onSuccess: () => {
          setCreatedPassword(newPassword)
          toast.success("メンバーを追加しました")
        },
        onError: (err) => {
          toast.error(err.message || "メンバーの追加に失敗しました")
        },
      }
    )
  }

  // メンバー更新
  const handleUpdate = () => {
    if (!selectedMember) return
    updateMutation.mutate(
      {
        userId: selectedMember.user_id,
        data: { full_name: editFullName, role: editRole },
      },
      {
        onSuccess: () => {
          setIsEditDialogOpen(false)
          toast.success("メンバー情報を更新しました")
        },
        onError: (err) => {
          toast.error(err.message || "更新に失敗しました")
        },
      }
    )
  }

  // メンバー削除
  const handleDelete = () => {
    if (!selectedMember) return
    deleteMutation.mutate(selectedMember.user_id, {
      onSuccess: () => {
        setIsDeleteDialogOpen(false)
        toast.success("メンバーを削除しました")
      },
      onError: (err) => {
        toast.error(err.message || "削除に失敗しました")
      },
    })
  }

  // PINリセット（共有端末でのPINログインを本人が再設定するまで無効化する）
  const handleResetPin = () => {
    if (!selectedMember) return
    resetPinMutation.mutate(selectedMember.user_id, {
      onSuccess: () => {
        setIsPinResetDialogOpen(false)
        toast.success("PINをリセットしました")
      },
      onError: (err) => {
        toast.error(err.message || "PINのリセットに失敗しました")
      },
    })
  }

  // パスワードリセット（新パスワードを再設定し、本人へ共有するため一度だけ表示する）
  const handleResetPassword = () => {
    if (!selectedMember || !pwResetNewPassword) return
    resetPasswordMutation.mutate(
      { userId: selectedMember.user_id, password: pwResetNewPassword },
      {
        onSuccess: (data) => {
          setPwResetResult(data.new_password)
          toast.success("パスワードをリセットしました")
        },
        onError: (err) => {
          toast.error(err.message || "パスワードのリセットに失敗しました")
        },
      }
    )
  }

  // クリップボードにコピー
  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text)
    toast.success("クリップボードにコピーしました")
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">メンバー管理</h1>
          <p className="text-muted-foreground text-sm mt-1">
            テナントのメンバーを管理します
          </p>
        </div>
        <Button onClick={handleOpenCreateDialog}>
          <Plus className="mr-2 h-4 w-4" />
          メンバーを追加
        </Button>
      </div>

      {/* メンバー一覧テーブル */}
      {isLoading ? (
        <p className="text-muted-foreground">読み込み中...</p>
      ) : error ? (
        <p className="text-destructive">
          {error.message.includes("403")
            ? "この画面は管理者のみアクセスできます"
            : "メンバー情報の取得に失敗しました"}
        </p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>氏名</TableHead>
                <TableHead>メールアドレス</TableHead>
                <TableHead>権限</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members && members.length > 0 ? (
                members.map((member) => (
                  <TableRow key={member.user_id}>
                    <TableCell>{member.full_name ?? "—"}</TableCell>
                    <TableCell>{member.email}</TableCell>
                    <TableCell>
                      <Badge variant={ROLE_BADGE_VARIANTS[member.role]}>
                        {ROLE_LABELS[member.role]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          title="編集"
                          onClick={() => handleOpenEditDialog(member)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="パスワードをリセット"
                          title="パスワードをリセット"
                          onClick={() => handleOpenPasswordResetDialog(member)}
                        >
                          <Lock className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="PINをリセット"
                          onClick={() => handleOpenPinResetDialog(member)}
                        >
                          <KeyRound className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleOpenDeleteDialog(member)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    メンバーがいません
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* メンバー追加ダイアログ */}
      <Dialog
        open={isCreateDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setIsCreateDialogOpen(false)
            setCreatedPassword(null)
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>メンバーを追加</DialogTitle>
            <DialogDescription>
              新しいメンバーのアカウントを発行します
            </DialogDescription>
          </DialogHeader>

          {createdPassword ? (
            /* 登録完了後にパスワードを表示 */
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                メンバーを追加しました。以下のパスワードを対象者に共有してください（この画面を閉じると確認できなくなります）。
              </p>
              <div className="flex items-center gap-2 rounded-md border bg-muted p-3">
                <code className="flex-1 text-sm font-mono break-all">
                  {createdPassword}
                </code>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleCopy(createdPassword)}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <DialogFooter>
                <Button onClick={() => { setIsCreateDialogOpen(false); setCreatedPassword(null) }}>
                  閉じる
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="new-full-name">氏名</Label>
                <Input
                  id="new-full-name"
                  placeholder="山田 太郎"
                  value={newFullName}
                  onChange={(e) => setNewFullName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-email">メールアドレス</Label>
                <Input
                  id="new-email"
                  type="email"
                  placeholder="example@company.com"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-role">権限</Label>
                <Select
                  value={newRole}
                  onValueChange={(v) => setNewRole(v as MemberRole)}
                >
                  <SelectTrigger id="new-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="order_handler">受注担当</SelectItem>
                    <SelectItem value="iso_officer">ISO担当</SelectItem>
                    <SelectItem value="president">社長</SelectItem>
                    <SelectItem value="platform_admin">プラットフォーム管理者</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-password">初期パスワード</Label>
                <div className="flex gap-2">
                  <Input
                    id="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="font-mono"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => setNewPassword(generatePassword())}
                    title="パスワードを再生成"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => handleCopy(newPassword)}
                    title="コピー"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setIsCreateDialogOpen(false)}
                >
                  キャンセル
                </Button>
                <Button
                  onClick={handleCreate}
                  disabled={createMutation.isPending}
                >
                  {createMutation.isPending ? "追加中..." : "追加"}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* メンバー編集ダイアログ */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>メンバーを編集</DialogTitle>
            <DialogDescription>氏名と権限を変更できます</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-full-name">氏名</Label>
              <Input
                id="edit-full-name"
                value={editFullName}
                onChange={(e) => setEditFullName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-role">権限</Label>
              <Select
                value={editRole}
                onValueChange={(v) => setEditRole(v as MemberRole)}
              >
                <SelectTrigger id="edit-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="order_handler">受注担当</SelectItem>
                  <SelectItem value="iso_officer">ISO担当</SelectItem>
                  <SelectItem value="president">社長</SelectItem>
                  <SelectItem value="platform_admin">プラットフォーム管理者</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
              キャンセル
            </Button>
            <Button onClick={handleUpdate} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "更新中..." : "更新"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 削除確認ダイアログ */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>メンバーを削除しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              {selectedMember?.full_name ?? selectedMember?.email}{" "}
              をテナントから削除します。この操作は取り消せません。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? "削除中..." : "削除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* パスワードリセットダイアログ */}
      <Dialog
        open={isPasswordResetDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setIsPasswordResetDialogOpen(false)
            setPwResetResult(null)
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>パスワードをリセット</DialogTitle>
            <DialogDescription>
              {selectedMember?.full_name ?? selectedMember?.email} の新しいパスワードを発行します
            </DialogDescription>
          </DialogHeader>

          {pwResetResult ? (
            /* リセット完了後に新パスワードを表示 */
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                パスワードをリセットしました。以下の新しいパスワードを対象者に共有してください（この画面を閉じると確認できなくなります）。
              </p>
              <div className="flex items-center gap-2 rounded-md border bg-muted p-3">
                <code className="flex-1 text-sm font-mono break-all">
                  {pwResetResult}
                </code>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="コピー"
                  title="コピー"
                  onClick={() => handleCopy(pwResetResult)}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <DialogFooter>
                <Button
                  onClick={() => {
                    setIsPasswordResetDialogOpen(false)
                    setPwResetResult(null)
                  }}
                >
                  閉じる
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                対象メンバーのパスワードを下記に置き換えます。PINは変更されません。
              </p>
              <div className="space-y-2">
                <Label htmlFor="pw-reset-password">新しいパスワード</Label>
                <div className="flex gap-2">
                  <Input
                    id="pw-reset-password"
                    value={pwResetNewPassword}
                    onChange={(e) => setPwResetNewPassword(e.target.value)}
                    className="font-mono"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => setPwResetNewPassword(generatePassword())}
                    aria-label="パスワードを再生成"
                    title="パスワードを再生成"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => handleCopy(pwResetNewPassword)}
                    aria-label="コピー"
                    title="コピー"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setIsPasswordResetDialogOpen(false)}
                >
                  キャンセル
                </Button>
                <Button
                  onClick={handleResetPassword}
                  disabled={
                    resetPasswordMutation.isPending ||
                    pwResetNewPassword.length < 8
                  }
                >
                  {resetPasswordMutation.isPending
                    ? "リセット中..."
                    : "リセット"}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* PINリセット確認ダイアログ */}
      <AlertDialog open={isPinResetDialogOpen} onOpenChange={setIsPinResetDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>PINをリセットしますか？</AlertDialogTitle>
            <AlertDialogDescription>
              {selectedMember?.full_name ?? selectedMember?.email} の共有端末PINログインを無効化します。
              本人が新しいPINを設定するまで、共有端末上でのPINログインは利用できなくなります（パスワードでのログインは引き続き可能です）。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleResetPin}
              disabled={resetPinMutation.isPending}
            >
              {resetPinMutation.isPending ? "リセット中..." : "リセット"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
