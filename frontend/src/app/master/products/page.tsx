"use client"

import { useState } from "react"
import { Plus, Pencil, Trash2 } from "lucide-react"
import { toast } from "sonner"
import {
  useProducts,
  useCreateProduct,
  useUpdateProduct,
  useDeleteProduct,
} from "@/hooks/use-products"
import type { Product } from "@/types/product"
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
 * 製品マスタ画面
 * URL: /master/products
 */
export default function ProductsPage() {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [productName, setProductName] = useState("")
  const [productCode, setProductCode] = useState("")
  const [productType, setProductType] = useState("")

  // データ取得・操作のフック
  const { data: products, isLoading, error } = useProducts()
  const createMutation = useCreateProduct()
  const updateMutation = useUpdateProduct()
  const deleteMutation = useDeleteProduct()

  // 作成ダイアログを開く
  const handleOpenCreateDialog = () => {
    setProductName("")
    setProductCode("")
    setProductType("")
    setIsCreateDialogOpen(true)
  }

  // 編集ダイアログを開く
  const handleOpenEditDialog = (product: Product) => {
    setSelectedProduct(product)
    setProductName(product.name)
    setProductCode(product.code)
    setProductType(product.type)
    setIsEditDialogOpen(true)
  }

  // 削除ダイアログを開く
  const handleOpenDeleteDialog = (product: Product) => {
    setSelectedProduct(product)
    setIsDeleteDialogOpen(true)
  }

  // 製品を作成
  const handleCreate = async () => {
    if (!productName.trim()) {
      toast.error("製品名を入力してください")
      return
    }
    if (!productCode.trim()) {
      toast.error("製品コードを入力してください")
      return
    }
    if (!productType.trim()) {
      toast.error("種別を入力してください")
      return
    }

    try {
      await createMutation.mutateAsync({
        name: productName,
        code: productCode,
        type: productType,
      })
      toast.success("製品を作成しました")
      setIsCreateDialogOpen(false)
      setProductName("")
      setProductCode("")
      setProductType("")
    } catch (error) {
      toast.error("製品の作成に失敗しました")
      console.error(error)
    }
  }

  // 製品を更新
  const handleUpdate = async () => {
    if (!selectedProduct) return

    if (!productName.trim()) {
      toast.error("製品名を入力してください")
      return
    }
    if (!productCode.trim()) {
      toast.error("製品コードを入力してください")
      return
    }
    if (!productType.trim()) {
      toast.error("種別を入力してください")
      return
    }

    try {
      await updateMutation.mutateAsync({
        id: selectedProduct.id,
        data: {
          name: productName,
          code: productCode,
          type: productType,
        },
      })
      toast.success("製品を更新しました")
      setIsEditDialogOpen(false)
      setProductName("")
      setProductCode("")
      setProductType("")
      setSelectedProduct(null)
    } catch (error) {
      toast.error("製品の更新に失敗しました")
      console.error(error)
    }
  }

  // 製品を削除
  const handleDelete = async () => {
    if (!selectedProduct) return

    try {
      await deleteMutation.mutateAsync(selectedProduct.id)
      toast.success("製品を削除しました")
      setIsDeleteDialogOpen(false)
      setSelectedProduct(null)
    } catch (error) {
      toast.error("製品の削除に失敗しました")
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
          <h1 className="text-3xl font-bold tracking-tight">製品マスタ</h1>
          <p className="text-muted-foreground">
            製品の一覧表示、作成、編集、削除を行います
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
                <TableHead>製品コード</TableHead>
                <TableHead>製品名</TableHead>
                <TableHead>種別</TableHead>
                <TableHead className="w-[150px] text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products && products.length > 0 ? (
                products.map((product) => (
                  <TableRow key={product.id}>
                    <TableCell className="font-medium">{product.id}</TableCell>
                    <TableCell>{product.code}</TableCell>
                    <TableCell>{product.name}</TableCell>
                    <TableCell>{product.type}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => handleOpenEditDialog(product)}
                          aria-label={`${product.name}を編集`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => handleOpenDeleteDialog(product)}
                          aria-label={`${product.name}を削除`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-10">
                    製品がありません
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
            <DialogTitle>製品の新規作成</DialogTitle>
            <DialogDescription>
              新しい製品を作成します。必要な情報を入力してください。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="create-name">製品名 *</Label>
              <Input
                id="create-name"
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                placeholder="例: 製品A"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="create-code">製品コード *</Label>
              <Input
                id="create-code"
                value={productCode}
                onChange={(e) => setProductCode(e.target.value)}
                placeholder="例: PROD-001"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="create-type">種別 *</Label>
              <Input
                id="create-type"
                value={productType}
                onChange={(e) => setProductType(e.target.value)}
                placeholder="例: standard, custom, repair"
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
            <DialogTitle>製品の編集</DialogTitle>
            <DialogDescription>
              製品情報を編集します。変更したい項目を修正してください。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-name">製品名 *</Label>
              <Input
                id="edit-name"
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                placeholder="例: 製品A"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-code">製品コード *</Label>
              <Input
                id="edit-code"
                value={productCode}
                onChange={(e) => setProductCode(e.target.value)}
                placeholder="例: PROD-001"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-type">種別 *</Label>
              <Input
                id="edit-type"
                value={productType}
                onChange={(e) => setProductType(e.target.value)}
                placeholder="例: standard, custom, repair"
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
            <DialogTitle>製品の削除</DialogTitle>
            <DialogDescription>
              本当に「{selectedProduct?.name}」を削除しますか？
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
