/* frontend/src/components/layout/app-sidebar.tsx */
"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  LayoutDashboard,
  ShoppingCart,
  Database,
  LogOut,
  User,
  ChevronDown,
  Calendar,
  Users,
  Settings,
  ClipboardList,
  Laptop,
  KeyRound,
  Inbox,
  MailCheck,
  FileCheck,
  Stamp,
  Truck,
} from "lucide-react"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { masterItems } from "@/app/master/constants"
import { logout } from "@/lib/auth-server-actions"
import { useCurrentMember } from "@/hooks/use-tenant-members"
import { useSidebarBadgeCounts, type SidebarBadgeKey } from "@/hooks/use-sidebar-badge-counts"
import {
  ORDER_APPROVAL_LOG_VIEWER_ROLES,
  type MemberRole,
} from "@/types/member"

type SubMenuItem = {
  title: string
  url: string
  icon: React.ElementType
  /** 指定した場合、このロールを持つメンバーにのみ表示する */
  allowedRoles?: MemberRole[]
  /** 件数バッジ。`roles` のメンバーにだけ出す（自分が操作する画面にだけ出す方針。Epic #553） */
  badge?: { key: SidebarBadgeKey; roles: MemberRole[] }
}
type MenuItem = {
  title: string
  icon: React.ElementType
  /** サブメニューを持つ項目では、親の項目を押したときの行き先（開閉はシェブロンで行う） */
  url?: string
  /** 一致判定の接頭辞。サブメニューを持つ項目では、このパス配下を開いたときに初めから展開する */
  activePrefix?: string
  /** サブメニューを初めから展開する */
  defaultOpen?: boolean
  items?: SubMenuItem[]
  /** 指定した場合、このロールを持つメンバーにのみメニュー項目を表示する */
  allowedRoles?: MemberRole[]
}

const menuItems: MenuItem[] = [
  {
    title: "ダッシュボード",
    url: "/",
    icon: LayoutDashboard,
  },
  {
    // 親はロールにかかわらず「すべての注文」を開き、作業の画面へはサブメニューから入る（Epic #553）
    title: "受注管理",
    url: "/orders",
    icon: ShoppingCart,
    defaultOpen: true,
    items: [
      {
        title: "起票の確認",
        url: "/orders/intake",
        icon: FileCheck,
        badge: { key: "intake_drafts", roles: ["order_handler", "iso_officer"] },
      },
      {
        // 承認は社長だけの操作なので、件数バッジも社長にだけ出す（Issue #556）
        title: "承認",
        url: "/orders/approval",
        icon: Stamp,
        badge: { key: "pending_approval", roles: ["president"] },
      },
      {
        // 送品済みにできるのは社長・受注担当なので、候補の件数もこの2ロールにだけ出す（Issue #557）
        title: "送品の消し込み",
        url: "/orders/shipping",
        icon: Truck,
        badge: { key: "shipping_candidates", roles: ["president", "order_handler"] },
      },
      {
        title: "受信メール処理結果",
        url: "/orders/email-intake",
        icon: Inbox,
      },
    ],
  },
  {
    title: "生産スケジュール",
    url: "/schedule",
    icon: Calendar,
  },
  {
    title: "承認監査ログ",
    url: "/orders/approval-logs",
    icon: ClipboardList,
    allowedRoles: ORDER_APPROVAL_LOG_VIEWER_ROLES,
  },
  {
    // マスタの一覧はマスタ画面のカード・タブと同じ定義から組む
    title: "マスタデータ",
    url: "/master",
    icon: Database,
    activePrefix: "/master",
    items: masterItems.map((master) => ({
      title: master.title,
      url: master.href,
      icon: master.icon,
    })),
  },
  {
    title: "設定",
    icon: Settings,
    activePrefix: "/settings",
    items: [
      {
        title: "メンバー管理",
        url: "/settings/members",
        icon: Users,
      },
      {
        title: "社内転送者",
        url: "/settings/internal-senders",
        icon: MailCheck,
      },
      {
        title: "端末管理",
        url: "/settings/devices",
        icon: Laptop,
      },
      {
        title: "PIN設定",
        url: "/settings/pin",
        icon: KeyRound,
      },
    ],
  },
]

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  user: {
    email?: string
    id: string
  } | null
}

export function AppSidebar({ user, ...props }: AppSidebarProps) {
  const pathname = usePathname()
  const [isLoggingOut, setIsLoggingOut] = React.useState(false)
  const { data: currentMember, isLoading: isMemberLoading } = useCurrentMember()
  const currentUserRole = currentMember?.role ?? null

  const isAllowed = (allowedRoles?: MemberRole[]) => {
    if (!allowedRoles) return true
    // ロール未確定の間はロール制御付き項目を表示しない
    if (isMemberLoading || !currentUserRole) return false
    return allowedRoles.includes(currentUserRole)
  }

  const visibleMenuItems = menuItems
    .filter((item) => isAllowed(item.allowedRoles))
    .map((item) =>
      item.items ? { ...item, items: item.items.filter((sub) => isAllowed(sub.allowedRoles)) } : item
    )

  // そのロールに出すバッジの種類だけ件数を取得する（出すバッジが無いロールは注文を取得しない）
  const badgeKeys = visibleMenuItems.flatMap((item) =>
    (item.items ?? []).flatMap((sub) =>
      sub.badge && currentUserRole && sub.badge.roles.includes(currentUserRole) ? [sub.badge.key] : []
    )
  )
  const badgeCounts = useSidebarBadgeCounts(badgeKeys)

  const handleLogout = async () => {
    setIsLoggingOut(true)
    try {
      await logout()
    } catch (error) {
      console.error("ログアウトエラー:", error)
      setIsLoggingOut(false)
    }
  }

  return (
    <Sidebar {...props}>
      <SidebarHeader className="border-b px-4 py-4">
        <h2 className="text-lg font-bold">Product Planner</h2>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>メニュー</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleMenuItems.map((item) =>
                item.items ? (
                  <Collapsible
                    key={item.title}
                    defaultOpen={
                      item.defaultOpen ||
                      (!!item.activePrefix && pathname.startsWith(item.activePrefix))
                    }
                  >
                    <SidebarMenuItem>
                      {item.url ? (
                        // 親の項目はリンク、開閉は右端のシェブロンで行う（押すたびに閉じないように）
                        <>
                          <SidebarMenuButton asChild isActive={pathname === item.url}>
                            <Link href={item.url}>
                              <item.icon className="h-4 w-4" />
                              <span>{item.title}</span>
                            </Link>
                          </SidebarMenuButton>
                          <CollapsibleTrigger asChild>
                            <SidebarMenuAction
                              className="data-[state=open]:rotate-180"
                              aria-label={`${item.title}のサブメニューを開閉`}
                            >
                              <ChevronDown />
                            </SidebarMenuAction>
                          </CollapsibleTrigger>
                        </>
                      ) : (
                        <CollapsibleTrigger asChild>
                          <SidebarMenuButton>
                            <item.icon className="h-4 w-4" />
                            <span>{item.title}</span>
                            <ChevronDown className="ml-auto h-4 w-4 transition-transform duration-200 group-data-[state=open]:rotate-180" />
                          </SidebarMenuButton>
                        </CollapsibleTrigger>
                      )}
                      <CollapsibleContent>
                        <SidebarMenuSub>
                          {item.items.map((subItem) => {
                            const badgeCount =
                              subItem.badge &&
                              currentUserRole &&
                              subItem.badge.roles.includes(currentUserRole)
                                ? badgeCounts[subItem.badge.key]
                                : undefined
                            return (
                              <SidebarMenuSubItem key={subItem.title}>
                                <SidebarMenuSubButton
                                  asChild
                                  // 配下の画面（製品マスタの統合 /master/products/merge 等）でも選択中にする
                                  isActive={
                                    pathname === subItem.url ||
                                    pathname.startsWith(`${subItem.url}/`)
                                  }
                                >
                                  <Link href={subItem.url}>
                                    <subItem.icon className="h-4 w-4" />
                                    <span className="truncate">{subItem.title}</span>
                                    {badgeCount !== undefined && badgeCount > 0 && (
                                      <span
                                        className="ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-medium tabular-nums text-primary-foreground"
                                        aria-label={`${badgeCount}件`}
                                      >
                                        {badgeCount}
                                      </span>
                                    )}
                                  </Link>
                                </SidebarMenuSubButton>
                              </SidebarMenuSubItem>
                            )
                          })}
                        </SidebarMenuSub>
                      </CollapsibleContent>
                    </SidebarMenuItem>
                  </Collapsible>
                ) : (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={
                        item.activePrefix
                          ? pathname.startsWith(item.activePrefix)
                          : pathname === item.url
                      }
                    >
                      <Link href={item.url!}>
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t p-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-sm">
            <User className="h-4 w-4" />
            <span className="truncate">{user?.email || "Guest"}</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleLogout}
            disabled={isLoggingOut}
            className="w-full"
          >
            <LogOut className="mr-2 h-4 w-4" />
            {isLoggingOut ? "ログアウト中..." : "ログアウト"}
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
