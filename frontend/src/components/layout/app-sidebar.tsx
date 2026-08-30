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
import { logout } from "@/lib/auth-server-actions"
import { useCurrentMember } from "@/hooks/use-tenant-members"
import {
  ORDER_APPROVAL_LOG_VIEWER_ROLES,
  type MemberRole,
} from "@/types/member"

type SubMenuItem = { title: string; url: string; icon: React.ElementType }
type MenuItem = {
  title: string
  icon: React.ElementType
  url?: string
  activePrefix?: string
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
    title: "受注管理",
    url: "/orders",
    icon: ShoppingCart,
  },
  {
    title: "受信メール処理結果",
    url: "/orders/email-intake",
    icon: Inbox,
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
    title: "マスタデータ",
    url: "/master",
    icon: Database,
    activePrefix: "/master",
  },
  {
    title: "設定",
    icon: Settings,
    items: [
      {
        title: "メンバー管理",
        url: "/settings/members",
        icon: Users,
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

  const visibleMenuItems = menuItems.filter((item) => {
    if (!item.allowedRoles) return true
    // ロール未確定の間はロール制御付き項目を表示しない
    if (isMemberLoading || !currentUserRole) return false
    return item.allowedRoles.includes(currentUserRole)
  })

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
                    defaultOpen={item.title === "設定" && pathname.startsWith("/settings")}
                  >
                    <SidebarMenuItem>
                      <CollapsibleTrigger asChild>
                        <SidebarMenuButton
                          asChild={!!item.url}
                          isActive={!!item.url && pathname === item.url}
                        >
                          {item.url ? (
                            <Link href={item.url}>
                              <item.icon className="h-4 w-4" />
                              <span>{item.title}</span>
                              <ChevronDown className="ml-auto h-4 w-4 transition-transform duration-200 group-data-[state=open]:rotate-180" />
                            </Link>
                          ) : (
                            <>
                              <item.icon className="h-4 w-4" />
                              <span>{item.title}</span>
                              <ChevronDown className="ml-auto h-4 w-4 transition-transform duration-200 group-data-[state=open]:rotate-180" />
                            </>
                          )}
                        </SidebarMenuButton>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <SidebarMenuSub>
                          {item.items.map((subItem) => (
                            <SidebarMenuSubItem key={subItem.title}>
                              <SidebarMenuSubButton
                                asChild
                                isActive={pathname === subItem.url}
                              >
                                <Link href={subItem.url}>
                                  <subItem.icon className="h-4 w-4" />
                                  <span>{subItem.title}</span>
                                </Link>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          ))}
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
