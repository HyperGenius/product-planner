"use client"

import { useState } from "react"
import { Plus, Pencil, Trash2 } from "lucide-react"
import { toast } from "sonner"
import {
  useCustomers,
  useCreateCustomer,
  useUpdateCustomer,
  useDeleteCustomer,
} from "@/hooks/use-customers"
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
 * 顧客マスタ画面
 * URL: /master/customers
 */
export default function CustomersPage() {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [customerName, setCustomerName] = useState("")
  const [customerAlias, setCustomerAlias] = useState("")
  const [representativeName, setRepresentativeName] = useState("")
  const [phoneNumber, setPhoneNumber] = useState("")
  const [email, setEmail] = useState("")

  // データ取得・操作のフック
  const { data: customers, isLoading, error } = useCustomers()
  const createMutation = useCreateCustomer()
  const updateMutation = useUpdateCustomer()
  const deleteMutation = useDeleteCustomer()

  // 作成ダイアログを開く
  const handleOpenCreateDialog = () => {
    setCustomerName("")
    setCustomerAlias("")
    setRepresentativeName("")
    setPhoneNumber("")
    setEmail("")
    setIsCreateDialogOpen(true)
  }

  // 編集ダイアログを開く
  const handleOpenEditDialog = (customer: Customer) => {
    setSelectedCustomer(customer)
    setCustomerName(customer.name)
    setCustomerAlias(customer.alias || "")
    setRepresentativeName(customer.representative_name || "")
    setPhoneNumber(customer.phone_number || "")
    setEmail(customer.email || "")
    setIsEditDialogOpen(true)
  }

  // 削除ダイアログを開く
  const handleOpenDeleteDialog = (customer: Customer) => {
    setSelectedCustomer(customer)
    setIsDeleteDialogOpen(true)
  }

  // 顧客を作成
  const handleCreate = async () => {
    if (!customerName.trim()) {
      toast.error("顧客名を入力してください")
      return
    }

    try {
      await createMutation.mutateAsync({
        name: customerName,
        alias: customerAlias || undefined,
        representative_name: representativeName || undefined,
        phone_number: phoneNumber || undefined,
        email: email || undefined,
      })
      toast.success("顧客を作成しました")
      setIsCreateDialogOpen(false)
      setCustomerName("")
      setCustomerAlias("")
      setRepresentativeName("")
      setPhoneNumber("")
      setEmail("")
    } catch (error) {
      toast.error("顧客の作成に失敗しました")
      console.error(error)
    }
  }

  // 顧客を更新
  const handleUpdate = async () => {
    if (!selectedCustomer) return

    if (!customerName.trim()) {
      toast.error("顧客名を入力してください")
      return
    }

    try {
      await updateMutation.mutateAsync({
        id: selectedCustomer.id,
        data: {
          name: customerName,
          alias: customerAlias || undefined,
          representative_name: representativeName || undefined,
          phone_number: phoneNumber || undefined,
          email: email || undefined,
        },
      })
      toast.success("顧客を更新しました")
      setIsEditDialogOpen(false)
      setCustomerName("")
      setCustomerAlias("")
      setRepresentativeName("")
      setPhoneNumber("")
      setEmail("")
      setSelectedCustomer(null)
    } catch (error) {
      toast.error("顧客の更新に失敗しました")
      console.error(error)
    }
  }

  // 顧客を削除
  const handleDelete = async () => {
    if (!selectedCustomer) return

    try {
      await deleteMutation.mutateAsync(selectedCustomer.id)
      toast.success("顧客を削除しました")
      setIsDeleteDialogOpen(false)
      setSelectedCustomer(null)
    } catch (error) {
      toast.error("顧客の削除に失敗しました")
      console.error(error)
    }
  }

  if (error) {
    return (
      <div className="container mx-auto py-10">
        <div className="text-red-500">
          エラーが発生しました: {error?.message || "不明なエラー"}
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">顧客マスタ</h1>
          <p className="text-muted-foreground">
            顧客の一覧表示、作成、編集、削除を行います
          </p>
        </div>
        <Button onClick={handleOpenCreateDialog}>
          <Plus className="mr-2 h-4 w-4" />
          新規作成
        </Button>
      </div>

      {isLoading ? (
        <div className="text-center py-10">読み込み中...</div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[100px]">ID</TableHead>
                <TableHead>顧客名</TableHead>
                <TableHead>通称</TableHead>
                <TableHead>代表者名</TableHead>
                <TableHead>電話番号</TableHead>
                <TableHead>Email</TableHead>
                <TableHead className="w-[120px] text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers && customers.length > 0 ? (
                customers.map((customer) => (
                  <TableRow key={customer.id}>
                    <TableCell className="font-medium">{customer.id}</TableCell>
                    <TableCell>{customer.name}</TableCell>
                    <TableCell>{customer.alias || "-"}</TableCell>
                    <TableCell>{customer.representative_name || "-"}</TableCell>
                    <TableCell>{customer.phone_number || "-"}</TableCell>
                    <TableCell>{customer.email || "-"}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => handleOpenEditDialog(customer)}
                          aria-label={`${customer.name}を編集`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => handleOpenDeleteDialog(customer)}
                          aria-label={`${customer.name}を削除`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-10">
                    顧客がありません
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* 作成ダイアログ */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>顧客の新規作成</DialogTitle>
            <DialogDescription>
              新しい顧客を作成します。必要な情報を入力してください。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="create-name">顧客名 *</Label>
              <Input
                id="create-name"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="例: 株式会社サンプル"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="create-alias">通称</Label>
              <Input
                id="create-alias"
                value={customerAlias}
                onChange={(e) => setCustomerAlias(e.target.value)}
                placeholder="例: サンプル社"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="create-representative">代表者名</Label>
              <Input
                id="create-representative"
                value={representativeName}
                onChange={(e) => setRepresentativeName(e.target.value)}
                placeholder="例: 山田太郎"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="create-phone">電話番号</Label>
              <Input
                id="create-phone"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="例: 03-1234-5678"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="create-email">Email</Label>
              <Input
                id="create-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="例: contact@example.com"
              />
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
              {createMutation.isPending ? "作成中..." : "作成"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 編集ダイアログ */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>顧客の編集</DialogTitle>
            <DialogDescription>
              顧客情報を編集します。変更したい項目を修正してください。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-name">顧客名 *</Label>
              <Input
                id="edit-name"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="例: 株式会社サンプル"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-alias">通称</Label>
              <Input
                id="edit-alias"
                value={customerAlias}
                onChange={(e) => setCustomerAlias(e.target.value)}
                placeholder="例: サンプル社"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-representative">代表者名</Label>
              <Input
                id="edit-representative"
                value={representativeName}
                onChange={(e) => setRepresentativeName(e.target.value)}
                placeholder="例: 山田太郎"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-phone">電話番号</Label>
              <Input
                id="edit-phone"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="例: 03-1234-5678"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-email">Email</Label>
              <Input
                id="edit-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="例: contact@example.com"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsEditDialogOpen(false)}
            >
              キャンセル
            </Button>
            <Button
              onClick={handleUpdate}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? "更新中..." : "更新"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 削除確認ダイアログ */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>顧客の削除</DialogTitle>
            <DialogDescription>
              本当に「{selectedCustomer?.name}」を削除しますか？
              この操作は取り消せません。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsDeleteDialogOpen(false)}
            >
              キャンセル
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "削除中..." : "削除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
