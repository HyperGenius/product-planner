"use client"

import { useSearchParams, useRouter } from "next/navigation"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"

interface MasterPaginationProps {
  totalCount: number
  pageSize: number
}

export function MasterPagination({ totalCount, pageSize }: MasterPaginationProps) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const page = Number(searchParams.get("page") ?? "1")
  const totalPages = Math.ceil(totalCount / pageSize)

  if (totalCount <= pageSize) return null

  const navigate = (next: number) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set("page", String(next))
    router.push(`?${params.toString()}`)
  }

  const start = (page - 1) * pageSize + 1
  const end = Math.min(page * pageSize, totalCount)

  return (
    <div className="flex items-center justify-between mt-4">
      <p className="text-sm text-muted-foreground">
        {totalCount}件中 {start}〜{end}件
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate(page - 1)}
          disabled={page <= 1}
        >
          <ChevronLeft className="h-4 w-4" />
          前へ
        </Button>
        <span className="text-sm text-muted-foreground tabular-nums">
          {page} / {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate(page + 1)}
          disabled={page >= totalPages}
        >
          次へ
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
