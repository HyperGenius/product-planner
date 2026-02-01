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
      <SidebarInset className="relative">
        
        {/* トリガーボタンを絶対配置 */}
        <div className="absolute -left-1 top-1/14 z-50 -translate-y-1/2 pl-1">
          <SidebarTrigger className="bg-background shadow-md border rounded-r-lg" />
        </div>

        <header className="flex h-15 shrink-0 items-center gap-2 border-b px-4">
          {/* パンくずリストなど、ヘッダーに残したい要素があればここに記述 */}
          <div className="font-semibold">Dashboard</div> 
        </header>

        <div className="flex flex-1 flex-col px-4 py-6 space-y-6">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
