import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

interface ListPageLayoutProps {
  title: string
  /** 見出しの下の説明 */
  description?: ReactNode
  /** 見出しの横に置くページのヘルプ（`PageHelp`。画面に書かない仕組みの説明の置き場所） */
  help?: ReactNode
  /** 見出しの右に置く操作（新規作成のボタン等） */
  actions?: ReactNode
  /**
   * 本文。案内・ツールバー（タブ・絞り込み）と、残りの高さを使う一覧（`ScrollTable` 等）を縦に並べる。
   * 一覧の領域には `min-h-0 flex-1`（`ScrollTable` は既定で付く）、`Tabs` / `TabsContent` で包むときはそれらにも付ける
   */
  children: ReactNode
  className?: string
}

/**
 * 一覧が中心の画面の外枠（Issue #671）。ページを画面の高さに収め、ページ全体ではなく一覧の中だけをスクロールさせる。
 *
 * 高さ = 画面 − レイアウトのヘッダー（3.75rem、`authenticated-layout.tsx` の `h-15`）− 上下の余白（3rem、同 `py-6`）。
 * レイアウトの値を変えたらここも合わせる。余白はレイアウトが持つので、使う画面では `py-6 px-4` を付けない。
 * 縦が低い画面（タブレットの縦向き等）で一覧が最低の高さを下回るときは、はみ出した分だけページ側がスクロールする
 */
export function ListPageLayout({
  title,
  description,
  help,
  actions,
  children,
  className,
}: ListPageLayoutProps) {
  return (
    <div className={cn("container mx-auto flex h-[calc(100dvh-6.75rem)] min-w-0 flex-col gap-4", className)}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
            {help}
          </div>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3">{children}</div>
    </div>
  )
}
