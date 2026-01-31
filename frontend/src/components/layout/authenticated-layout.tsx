/* frontend/src/components/layout/authenticated-layout.tsx */
"use client"

import * as React from "react"
import { SidebarProvider, SidebarTrigger, SidebarInset } from "@/components/ui/sidebar"
import { AppSidebar } from "./app-sidebar"
import { Separator } from "@/components/ui/separator"

interface AuthenticatedLayoutProps {
  children: React.ReactNode
  user: {
    email?: string
    id: string
  } | null
}

/**
 * アプリケーションの認証済みレイアウトコンポーネント
 * SidebarProviderで全体をラップして状態を共有可能にする
 */
export function AuthenticatedLayout({ children, user }: AuthenticatedLayoutProps) {
  return (
    <SidebarProvider style={{ overflowX: 'hidden'}}>
      {/* サイドバー本体 */}
      <AppSidebar user={user} />
      {/* メインエリア */}
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-6" />
        </header>
        <div className="flex flex-1 flex-col">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
