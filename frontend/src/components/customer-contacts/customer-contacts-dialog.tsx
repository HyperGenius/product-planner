"use client"

import { useState } from "react"
import { Trash2 } from "lucide-react"
import { toast } from "sonner"
import { ApiError } from "@/lib/api-client"
import {
  useCreateCustomerContact,
  useCustomerContacts,
  useDeleteCustomerContact,
} from "@/hooks/use-customer-contacts"
import { useCurrentMember } from "@/hooks/use-tenant-members"
import { CUSTOMER_CONTACT_EDITOR_ROLES } from "@/types/member"
import type { Customer } from "@/types/customer"
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

/**
 * 重複したアドレスの 409 から、画面に出す文言を取り出す。
 * detail はバックエンドからの外部入力なので、文字列であることを確かめてから使う
 */
function duplicateMessage(error: unknown): string | null {
  if (!(error instanceof ApiError) || error.errorCode !== "duplicate_contact_email") {
    return null
  }
  const detail = error.data.detail as Record<string, unknown>
  return typeof detail.message === "string"
    ? detail.message
    : "このメールアドレスは既に登録されています"
}

interface Props {
  customer: Customer | null
  onOpenChange: (open: boolean) => void
}

/**
 * 顧客の担当者（メールアドレス）の一覧・追加・削除ダイアログ（Issue #611）
 *
 * 追加・削除は事務担当者のみ（Backend `_CONTACT_EDITOR_ROLES` と揃える）。
 * 担当者は Gmail 取り込みで差出人から顧客を突合するのに使う
 */
export function CustomerContactsDialog({ customer, onOpenChange }: Props) {
  return (
    <Dialog open={customer != null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        {customer && <ContactsBody key={customer.id} customer={customer} />}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            閉じる
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ContactsBody({ customer }: { customer: Customer }) {
  const [email, setEmail] = useState("")
  const [contactName, setContactName] = useState("")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const { data: contacts, isLoading, error } = useCustomerContacts(customer.id)
  const createMutation = useCreateCustomerContact(customer.id)
  const deleteMutation = useDeleteCustomerContact(customer.id)
  const { data: currentMember } = useCurrentMember()
  const canEdit =
    currentMember != null && CUSTOMER_CONTACT_EDITOR_ROLES.includes(currentMember.role)

  const handleAdd = async () => {
    const trimmed = email.trim()
    if (!trimmed) {
      setErrorMessage("メールアドレスを入力してください")
      return
    }
    setErrorMessage(null)
    try {
      await createMutation.mutateAsync({
        email: trimmed,
        contact_name: contactName.trim() || null,
      })
      toast.success("担当者を追加しました")
      setEmail("")
      setContactName("")
    } catch (e) {
      const duplicate = duplicateMessage(e)
      if (duplicate) {
        // 登録先の顧客名を含む文言を、入力欄の近くに出し続ける
        setErrorMessage(duplicate)
      } else if (e instanceof ApiError && e.status === 422) {
        setErrorMessage("メールアドレスの形式が正しくありません")
      } else {
        toast.error("担当者の追加に失敗しました")
        console.error(e)
      }
    }
  }

  const handleDelete = async (contactId: string) => {
    try {
      await deleteMutation.mutateAsync(contactId)
      toast.success("担当者を削除しました")
    } catch (e) {
      toast.error("担当者の削除に失敗しました")
      console.error(e)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{customer.name}の担当者</DialogTitle>
        <DialogDescription>
          このアドレスから届いた注文メールは、この顧客の注文として取り込まれます。
          同じアドレスを複数の顧客に登録することはできません。
        </DialogDescription>
      </DialogHeader>

      {error ? (
        <div className="text-sm text-red-500">担当者の取得に失敗しました</div>
      ) : isLoading ? (
        <div className="py-4 text-center text-sm">読み込み中...</div>
      ) : (
        <div className="rounded-md border">
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[200px]">登録名</TableHead>
                <TableHead>メールアドレス</TableHead>
                {canEdit && <TableHead className="w-[60px]" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {contacts && contacts.length > 0 ? (
                contacts.map((contact) => (
                  <TableRow key={contact.id}>
                    <TableCell className="truncate">{contact.contact_name || "-"}</TableCell>
                    <TableCell className="truncate">{contact.email}</TableCell>
                    {canEdit && (
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => handleDelete(contact.id)}
                          disabled={deleteMutation.isPending}
                          aria-label={`${contact.email}を削除`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={canEdit ? 3 : 2} className="py-6 text-center">
                    担当者が登録されていません
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {canEdit && (
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="contact-email">メールアドレス *</Label>
              <Input
                id="contact-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="例: buyer@example.com"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="contact-name">登録名</Label>
              <Input
                id="contact-name"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="例: 購買 太郎"
              />
            </div>
          </div>
          {errorMessage && (
            <p role="alert" className="text-sm text-red-500">
              {errorMessage}
            </p>
          )}
          <div className="flex justify-end">
            <Button onClick={handleAdd} disabled={createMutation.isPending}>
              {createMutation.isPending ? "追加中..." : "追加"}
            </Button>
          </div>
        </div>
      )}
    </>
  )
}
