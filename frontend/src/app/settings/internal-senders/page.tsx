"use client"

import { useState } from "react"
import { Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { ApiError } from "@/lib/api-client"
import {
  useCreateInternalSender,
  useDeleteInternalSender,
  useInternalSenders,
} from "@/hooks/use-internal-senders"
import type { InternalSender } from "@/types/internal-sender"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

/**
 * 社内転送者の管理ページ（Issue #521）
 * URL: /settings/internal-senders
 *
 * 社長など、FAX・ファイル共有で受けた注文書を受注取り込み用アドレスへ転送してくる
 * 社内のメールアドレスを登録する（president / platform_admin のみ）。
 * 登録したアドレスからのメールは差出人で顧客を作らず、注文書の会社名・FAX 番号から
 * 顧客を決める。決まらなければ顧客不明（受注一覧で「顧客不明」）で起票する。
 */
export default function InternalSendersPage() {
  const [email, setEmail] = useState("")
  const [deleteTarget, setDeleteTarget] = useState<InternalSender | null>(null)

  const { data: senders, isLoading, error } = useInternalSenders()
  const createMutation = useCreateInternalSender()
  const deleteMutation = useDeleteInternalSender()

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault()
    const value = email.trim()
    if (!value) {
      toast.error("メールアドレスを入力してください")
      return
    }
    createMutation.mutate(
      { email: value },
      {
        onSuccess: () => {
          setEmail("")
          toast.success("社内転送者を登録しました")
        },
        onError: (err) => {
          if (err instanceof ApiError && err.errorCode === "duplicate_internal_sender") {
            toast.error("このメールアドレスは既に登録されています")
          } else if (err instanceof ApiError && err.status === 422) {
            toast.error("メールアドレスの形式が正しくありません")
          } else {
            toast.error("社内転送者の登録に失敗しました")
          }
        },
      }
    )
  }

  // 確認ダイアログは削除の完了を待って閉じる（失敗時は開いたまま残す）
  const handleDelete = () => {
    if (!deleteTarget) return
    deleteMutation.mutate(deleteTarget.id, {
      onSuccess: () => {
        setDeleteTarget(null)
        toast.success("社内転送者の登録を解除しました")
      },
      onError: () => {
        toast.error("登録の解除に失敗しました")
      },
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">社内転送者</h1>
        <p className="text-muted-foreground text-sm mt-1">
          FAX やファイル共有で受けた注文書を、受注取り込み用のアドレスへ転送してくる社内のメールアドレスを登録します。
          登録したアドレスから届いたメールは、差出人ではなく注文書に書かれた会社名・FAX 番号から顧客を決めます。
          決まらない場合は「顧客不明」で起票されるので、受注の編集から顧客を選んでください。
        </p>
      </div>

      <form onSubmit={handleCreate} className="flex max-w-xl items-end gap-2">
        <div className="grid flex-1 gap-2">
          <Label htmlFor="internal-sender-email">メールアドレス</Label>
          <Input
            id="internal-sender-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="例: president@example.com"
          />
        </div>
        <Button type="submit" disabled={createMutation.isPending}>
          <Plus className="mr-2 h-4 w-4" />
          {createMutation.isPending ? "登録中..." : "登録"}
        </Button>
      </form>

      {isLoading ? (
        <p className="text-muted-foreground">読み込み中...</p>
      ) : error ? (
        <p className="text-destructive">
          {error instanceof ApiError && error.status === 403
            ? "この画面は管理者のみアクセスできます"
            : "社内転送者の取得に失敗しました"}
        </p>
      ) : (
        <div className="max-w-xl rounded-md border">
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead>メールアドレス</TableHead>
                <TableHead className="w-[180px]">登録日時</TableHead>
                <TableHead className="w-[64px] text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {senders && senders.length > 0 ? (
                senders.map((sender) => (
                  <TableRow key={sender.id}>
                    <TableCell className="truncate">{sender.email}</TableCell>
                    <TableCell>{new Date(sender.created_at).toLocaleString("ja-JP")}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeleteTarget(sender)}
                        aria-label={`${sender.email}の登録を解除`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground">
                    社内転送者は登録されていません
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>社内転送者の登録を解除しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.email} から届いたメールは、差出人のアドレスで顧客を照合・作成するようになります。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "解除中..." : "解除する"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
