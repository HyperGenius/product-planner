"use client"

import type { ReactNode } from "react"
import { CircleHelp } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

interface PageHelpProps {
  /** ダイアログの見出し（ページ名） */
  title: string
  children: ReactNode
}

/**
 * ページのヘルプ（見出しの横の「?」）。仕組み・判定条件・データの出どころ・状態の移り変わりなど、
 * 画面に書かない説明の置き場所（docs/ui-writing-guidelines.md の7章）。
 * タブレットで読めるよう、ツールチップ・ポップオーバーにせずダイアログで開く
 */
export function PageHelp({ title, children }: PageHelpProps) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label="ヘルプを開く"
          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <CircleHelp className="h-5 w-5" />
        </button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[85dvh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1 text-sm">{children}</div>
      </DialogContent>
    </Dialog>
  )
}

/** ヘルプの中の1項目（見出し＋本文） */
export function PageHelpSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-4 last:mb-0">
      <h3 className="mb-1 font-semibold">{title}</h3>
      <div className="space-y-1 text-muted-foreground">{children}</div>
    </section>
  )
}
