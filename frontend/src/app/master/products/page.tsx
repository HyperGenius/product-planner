"use client"

import { useMemo, useState, useEffect, useRef } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { AlertTriangle, Circle, MoreHorizontal, Plus, Search } from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import {
  useProducts,
  useCreateProduct,
  useUpdateProduct,
  useDeleteProduct,
  useToggleProductActive,
} from "@/hooks/use-products"
import { useCurrentMember } from "@/hooks/use-tenant-members"
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
import { ProductNameAliasHistoryDialog } from "@/components/product-name-alias-history-dialog"
import { MasterPagination } from "@/components/master-pagination"

const PAGE_SIZE = 20

type StatusFilter = "all" | "active" | "inactive" | "no_process"
type SortKey = "created_at" | "product_code" | "name"

const SORT_OPTIONS: { label: string; value: SortKey }[] = [
  { label: "並び順: 登録順", value: "created_at" },
  { label: "並び順: 品番順", value: "product_code" },
  { label: "並び順: 製品名順", value: "name" },
]

export default function ProductsPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const sortKey = (searchParams.get("sort") as SortKey) ?? "created_at"
  const page = Number(searchParams.get("page") ?? "1")
  const highlightId = Number(searchParams.get("highlight") ?? "") || null

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isRoutingsDialogOpen, setIsRoutingsDialogOpen] = useState(false)
  const [isAliasHistoryDialogOpen, setIsAliasHistoryDialogOpen] = useState(false)
  const [isToggleActiveDialogOpen, setIsToggleActiveDialogOpen] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [toggleActiveTarget, setToggleActiveTarget] = useState<Product | null>(null)
  const [productName, setProductName] = useState("")
  const [productCode, setProductCode] = useState("")
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")

  const { data: products, isLoading, error } = useProducts()
  const { data: currentMember } = useCurrentMember()
  const isAdmin =
    currentMember?.role === "president" || currentMember?.role === "platform_admin"

  const createMutation = useCreateProduct()
  const updateMutation = useUpdateProduct()
  const deleteMutation = useDeleteProduct()
  const toggleActiveMutation = useToggleProductActive()

  const filteredProducts = useMemo(() => {
    if (!products) return []
    return products
      .filter((p) => {
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
          (statusFilter === "inactive" && !p.is_active) ||
          (statusFilter === "no_process" && !p.has_process)
        return matchesSearch && matchesStatus
      })
      .sort((a, b) => {
        if (sortKey === "created_at") return (a.created_at || "").localeCompare(b.created_at || "")
        if (sortKey === "product_code") return (a.code || "").localeCompare(b.code || "")
        return (a.name || "").localeCompare(b.name || "")
      })
  }, [products, searchQuery, statusFilter, sortKey])

  const pagedProducts = useMemo(() => {
    const offset = (page - 1) * PAGE_SIZE
    return filteredProducts.slice(offset, offset + PAGE_SIZE)
  }, [filteredProducts, page])

  // 検索語・状態フィルタが変わったら1ページ目に戻す（初回マウント時は除く）
  const isFirstFilterRender = useRef(true)
  useEffect(() => {
    if (isFirstFilterRender.current) {
      isFirstFilterRender.current = false
      return
    }
    if (page === 1) return
    const params = new URLSearchParams(searchParams.toString())
    params.set("page", "1")
    router.replace(`/master/products?${params.toString()}`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, statusFilter])

  // highlight パラメータが指すページへ自動移動
  useEffect(() => {
    if (!highlightId || !filteredProducts.length) return
    const idx = filteredProducts.findIndex((p) => p.id === highlightId)
    if (idx === -1) return
    const targetPage = Math.floor(idx / PAGE_SIZE) + 1
    if (targetPage === page) return
    const params = new URLSearchParams(searchParams.toString())
    params.set("page", String(targetPage))
    router.replace(`/master/products?${params.toString()}`)
  }, [highlightId, filteredProducts, page, searchParams, router])

  // highlight 対象行へスクロール
  useEffect(() => {
    if (!highlightId) return
    const el = document.getElementById(`product-row-${highlightId}`)
    if (!el) return
    el.scrollIntoView({ behavior: "smooth", block: "center" })
  }, [highlightId, pagedProducts])

  const handleOpenCreateDialog = () => {
    setProductName("")
    setProductCode("")
    setIsCreateDialogOpen(true)
  }

  const handleOpenEditDialog = (product: Product) => {
    setSelectedProduct(product)
    setProductName(product.name)
    setProductCode(product.code ?? "")
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

  const handleOpenAliasHistoryDialog = (product: Product) => {
    setSelectedProduct(product)
    setIsAliasHistoryDialogOpen(true)
  }

  const handleOpenToggleActiveDialog = (product: Product) => {
    setToggleActiveTarget(product)
    setIsToggleActiveDialogOpen(true)
  }

  const handleConfirmToggleActive = async () => {
    if (!toggleActiveTarget) return
    try {
      await toggleActiveMutation.mutateAsync({
        id: toggleActiveTarget.id,
        is_active: !toggleActiveTarget.is_active,
      })
      toast.success(
        toggleActiveTarget.is_active
          ? `「${toggleActiveTarget.name}」を無効にしました`
          : `「${toggleActiveTarget.name}」を有効にしました`
      )
      setIsToggleActiveDialogOpen(false)
      setToggleActiveTarget(null)
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
      <div className="py-10">
        <div className="text-red-500">
          エラーが発生しました: {error?.message || "不明なエラー"}
        </div>
      </div>
    )
  }

  return (
    <div className="py-10">
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
            <SelectItem value="no_process">工程未登録</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={sortKey}
          onValueChange={(v) => {
            const params = new URLSearchParams(searchParams.toString())
            params.set("sort", v)
            router.push(`?${params.toString()}`)
          }}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
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
                <TableHead className="w-[110px]">工程</TableHead>
                <TableHead className="w-[100px]">状態</TableHead>
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagedProducts.length > 0 ? (
                pagedProducts.map((product) => {
                  const displayCode = product.code || "品番なし"
                  const displayName = product.name || null
                  return (
                    <TableRow
                      key={product.id}
                      id={`product-row-${product.id}`}
                      className={cn(highlightId === product.id && "ring-2 ring-inset ring-primary bg-primary/5")}
                    >
                      <TableCell>
                        <div className="text-xs text-muted-foreground">{displayCode}</div>
                        {displayName ? (
                          <div className="text-sm">{displayName}</div>
                        ) : (
                          <div className="text-sm text-muted-foreground">製品名未設定</div>
                        )}
                      </TableCell>
                      <TableCell>
                        {!product.has_process ? (
                          <div className="flex items-center gap-2">
                            <AlertTriangle className="h-3 w-3 text-orange-500" />
                            <span className="text-sm text-orange-500">未登録</span>
                          </div>
                        ) : product.has_unconfirmed_process ? (
                          <div className="flex items-center gap-2">
                            <AlertTriangle className="h-3 w-3 text-amber-500" />
                            <span className="text-sm text-amber-500">未確定あり</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <Circle className="h-2 w-2 fill-current text-green-500" />
                            <span className="text-sm">確定済み</span>
                          </div>
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
                            <DropdownMenuItem onClick={() => handleOpenAliasHistoryDialog(product)}>
                              表記ゆれ履歴
                            </DropdownMenuItem>
                            {isAdmin && (
                              <DropdownMenuItem onClick={() => handleOpenToggleActiveDialog(product)}>
                                {product.is_active ? "無効化" : "有効化"}
                              </DropdownMenuItem>
                            )}
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
                  <TableCell colSpan={4} className="text-center py-10">
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
      <MasterPagination totalCount={filteredProducts.length} pageSize={PAGE_SIZE} />

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
              <Label htmlFor="edit-code">品番（任意）</Label>
              <Input
                id="edit-code"
                value={productCode}
                onChange={(e) => setProductCode(e.target.value)}
                placeholder="例: A-001"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-name">製品名</Label>
              <Input
                id="edit-name"
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
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

      {/* 有効/無効切り替え確認ダイアログ */}
      <Dialog open={isToggleActiveDialogOpen} onOpenChange={setIsToggleActiveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {toggleActiveTarget?.is_active ? "無効化の確認" : "有効化の確認"}
            </DialogTitle>
            <DialogDescription asChild>
              <div>
                <p>
                  「{[toggleActiveTarget?.code, toggleActiveTarget?.name].filter(Boolean).join("（") + (toggleActiveTarget?.name ? "）" : "")}」を
                  {toggleActiveTarget?.is_active ? "無効化" : "有効化"}しますか？
                </p>
                {toggleActiveTarget?.is_active && (
                  <>
                    <p className="mt-2">無効化すると新規受注時の製品選択に表示されなくなります。</p>
                    <p>既存の受注・生産計画には影響しません。</p>
                  </>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsToggleActiveDialogOpen(false)
                setToggleActiveTarget(null)
              }}
            >
              キャンセル
            </Button>
            <Button
              variant={toggleActiveTarget?.is_active ? "destructive" : "default"}
              onClick={handleConfirmToggleActive}
              disabled={toggleActiveMutation.isPending}
            >
              {toggleActiveMutation.isPending
                ? "処理中..."
                : toggleActiveTarget?.is_active ? "無効化する" : "有効化する"}
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

      {/* 表記ゆれ履歴ダイアログ */}
      <ProductNameAliasHistoryDialog
        product={selectedProduct}
        open={isAliasHistoryDialogOpen}
        onOpenChange={setIsAliasHistoryDialogOpen}
      />
    </div>
  )
}
