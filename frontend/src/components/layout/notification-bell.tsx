"use client"

import * as React from "react"
import { Bell } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { useMarkNotificationsRead, useNotifications } from "@/hooks/use-notifications"
import type { Notification, NotificationType } from "@/types/notification"

const NOTIF_TYPE_LABELS: Record<NotificationType, string> = {
  no_product_match: "照合失敗",
  downgrade_skipped: "格下げスキップ",
  draft_conflict_skipped: "重複競合スキップ",
  failed_encrypted: "読み取り不可（暗号化PDF）",
  failed_image: "読み取り不可（画像PDF）",
  non_order_email: "対象外メール",
}

function groupByType(notifications: Notification[]): [NotificationType, Notification[]][] {
  const groups = new Map<NotificationType, Notification[]>()
  for (const notif of notifications) {
    const list = groups.get(notif.notif_type) ?? []
    list.push(notif)
    groups.set(notif.notif_type, list)
  }
  return Array.from(groups.entries())
}

export function NotificationBell() {
  const [open, setOpen] = React.useState(false)
  const { data: notifications = [] } = useNotifications()
  const markRead = useMarkNotificationsRead()

  const unreadCount = notifications.filter((n) => n.read_at === null).length
  const groups = groupByType(notifications)

  // Popoverが開いている間、初回ロード遅延や再フェッチで未読が後から
  // 増えるケースでも取りこぼさず既読化する（isPendingで多重送信を防ぐ）
  React.useEffect(() => {
    if (open && unreadCount > 0 && !markRead.isPending) {
      markRead.mutate()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, unreadCount])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={unreadCount > 0 ? `通知（未読${unreadCount}件）` : "通知"}
        >
          <Bell className="size-5" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -right-1 -top-1 h-4 min-w-4 px-1 text-[10px]"
            >
              {unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b px-4 py-3 font-semibold">通知</div>
        <div className="max-h-96 overflow-y-auto">
          {groups.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              通知はありません
            </div>
          )}
          {groups.map(([notifType, items]) => (
            <div key={notifType} className="border-b last:border-b-0">
              <div className="flex items-center justify-between px-4 py-2 text-sm font-medium text-muted-foreground">
                <span>{NOTIF_TYPE_LABELS[notifType]}</span>
                <span>{items.length}件</span>
              </div>
              <ul>
                {items.map((notif) => (
                  <li key={notif.id}>
                    {notif.link_url ? (
                      <a
                        href={notif.link_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block px-4 py-2 text-sm hover:bg-accent"
                      >
                        <NotificationRow notif={notif} />
                      </a>
                    ) : (
                      <div className="px-4 py-2 text-sm">
                        <NotificationRow notif={notif} />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function NotificationRow({ notif }: { notif: Notification }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="truncate text-muted-foreground">
        {formatDetail(notif)}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">
        {new Date(notif.created_at).toLocaleString("ja-JP", {
          month: "numeric",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })}
      </span>
    </div>
  )
}

function formatDetail(notif: Notification): string {
  const detail = notif.detail
  if (!detail) return "詳細なし"
  const productName = detail.product_name_raw ?? detail.product_number_raw
  if (typeof productName === "string") return productName
  const snippet = detail.body_snippet
  if (typeof snippet === "string") return snippet.slice(0, 40)
  return "詳細を見る"
}
