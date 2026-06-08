"use client"

import { useMemo, useState } from "react"
import { Circle, MoreHorizontal, Plus, Search } from "lucide-react"
import { toast } from "sonner"
import {
  useProducts,
  useCreateProduct,
  useUpdateProduct,
  useDeleteProduct,
  useToggleProductActive,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
import { ProductRoutingsDialog } from "@/components/product-routings-dialog"

type StatusFilter = "all" | "active" | "inactive"

export default function ProductsPage() {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isRoutingsDialogOpen, setIsRoutingsDialogOpen] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [productName, setProductName] = useState("")
  const [productCode, setProductCode] = useState("")
  const [productType, setProductType] = useState("")
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")

  const { data: products, isLoading, error } = useProducts()
  const createMutation = useCreateProduct()
  const updateMutation = useUpdateProduct()
  const deleteMutation = useDeleteProduct()
  const toggleActiveMutation = useToggleProductActive()

  const filteredProducts = useMemo(() => {
    if (!products) return []
    return products.filter((p) => {
      const displayCode = p.code || p.name
      const displayName = p.code ? p.name : null
      const q = searchQuery.toLowerCase()
      const matchesSearch =
        !q ||
        displayCode.toLowerCase().includes(q) ||
        (displayName?.toLowerCase().includes(q) ?? false)
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" && p.is_active) ||
        (statusFilter === "inactive" && !p.is_active)
      return matchesSearch && matchesStatus
    })
  }, [products, searchQuery, statusFilter])

  const handleOpenCreateDialog = () => {
    setProductName("")
    setProductCode("")
    setProductType("")
    setIsCreateDialogOpen(true)
  }

  const handleOpenEditDialog = (product: Product) => {
    setSelectedProduct(product)
    setProductName(product.name)
    setProductCode(product.code)
    setProductType(product.type)
    setIsEditDialogOpen(true)
  }

  const handleOpenDeleteDialog = (product: Product) => {
    setSelectedProduct(product)
    setIsDeleteDialogOpen(true)
  }

  const handleOpenRoutingsDialog = (product: Product) => {
    setSelectedProduct(product)
    setIsRoutingsDialogOpen(true)
  }

  const handleToggleActive = async (product: Product) => {
    try {
      await toggleActiveMutation.mutateAsync({
        id: product.id,
        is_active: !product.is_active,
      })
      toast.success(
        product.is_active ? `「${product.name}」を無効にしました` : `「${product.name}」を有効にしました`
      )
    } catch {
      toast.error("状態の更新に失敗しました")
    }
  }

  const handleCreate = async () => {
    if (!productName.trim()) {
      toast.error("品番を入力してください")
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
    } catch (error) {
      toast.error("製品の作成に失敗しました")
      console.error(error)
    }
  }

  const handleUpdate = async () => {
    if (!selectedProduct) return
    if (!productName.trim()) {
      toast.error("品番を入力してください")
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
      setSelectedProduct(null)
    } catch (error) {
      toast.error("製品の更新に失敗しました")
      console.error(error)
    }
  }

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

      <div className="flex gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="品番・製品名で検索..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <SelectTrigger className="w-[120px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">すべて</SelectItem>
            <SelectItem value="active">有効</SelectItem>
            <SelectItem value="inactive">無効</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="text-center py-10">読み込み中...</div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>品番 / 製品名</TableHead>
                <TableHead className="w-[100px]">状態</TableHead>
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredProducts.length > 0 ? (
                filteredProducts.map((product) => {
                  const displayCode = product.code || product.name
                  const displayName = product.code ? product.name : null
                  return (
                    <TableRow key={product.id}>
                      <TableCell>
                        <div className="font-mono text-sm">{displayCode}</div>
                        {displayName ? (
                          <div className="text-xs text-muted-foreground">{displayName}</div>
                        ) : (
                          <div className="text-xs text-muted-foreground italic">製品名未設定</div>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Circle
                            className={`h-2 w-2 fill-current ${
                              product.is_active ? "text-green-500" : "text-gray-400"
                            }`}
                          />
                          <span className="text-sm">
                            {product.is_active ? "有効" : "無効"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-sm">
                              <MoreHorizontal className="h-4 w-4" />
                              <span className="sr-only">操作メニュー</span>
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleOpenEditDialog(product)}>
                              編集
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleOpenRoutingsDialog(product)}>
                              工程管理
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleToggleActive(product)}
                              disabled={toggleActiveMutation.isPending}
                            >
                              {product.is_active ? "無効化" : "有効化"}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => handleOpenDeleteDialog(product)}
                            >
                              削除
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  )
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={3} className="text-center py-10">
                    {searchQuery || statusFilter !== "all"
                      ? "条件に一致する製品がありません"
                      : "製品がありません"}
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
              <Label htmlFor="create-name">品番 *</Label>
              <Input
                id="create-name"
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                placeholder="例: A-001"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="create-code">製品名（任意）</Label>
              <Input
                id="create-code"
                value={productCode}
                onChange={(e) => setProductCode(e.target.value)}
                placeholder="例: 製品A"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
              キャンセル
            </Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending}>
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
              <Label htmlFor="edit-name">品番 *</Label>
              <Input
                id="edit-name"
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                placeholder="例: A-001"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-code">製品名（任意）</Label>
              <Input
                id="edit-code"
                value={productCode}
                onChange={(e) => setProductCode(e.target.value)}
                placeholder="例: 製品A"
              />
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
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>製品の削除</DialogTitle>
            <DialogDescription>
              本当に「{selectedProduct?.code || selectedProduct?.name}」を削除しますか？
              この操作は取り消せません。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>
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

      {/* 工程管理ダイアログ */}
      <ProductRoutingsDialog
        product={selectedProduct}
        open={isRoutingsDialogOpen}
        onOpenChange={setIsRoutingsDialogOpen}
      />
    </div>
  )
}
