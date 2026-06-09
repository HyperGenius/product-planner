import { Calendar, Cpu, Layers, Package, Users } from "lucide-react"

export const masterItems = [
  {
    title: "製品マスタ",
    href: "/master/products",
    icon: Package,
    description: "製品・品番の登録と管理",
    accent: "border-t-blue-500",
    iconBg: "bg-blue-50",
    iconColor: "text-blue-600",
  },
  {
    title: "顧客マスタ",
    href: "/master/customers",
    icon: Users,
    description: "顧客情報の登録と管理",
    accent: "border-t-green-500",
    iconBg: "bg-green-50",
    iconColor: "text-green-600",
  },
  {
    title: "設備マスタ",
    href: "/master/equipments",
    icon: Cpu,
    description: "設備・機械の登録と管理",
    accent: "border-t-orange-400",
    iconBg: "bg-orange-50",
    iconColor: "text-orange-500",
  },
  {
    title: "設備グループ",
    href: "/master/equipment-groups",
    icon: Layers,
    description: "設備グループの設定と管理",
    accent: "border-t-purple-500",
    iconBg: "bg-purple-50",
    iconColor: "text-purple-600",
  },
  {
    title: "稼働カレンダー",
    href: "/master/calendar",
    icon: Calendar,
    description: "稼働日・休日のスケジュール設定",
    accent: "border-t-teal-500",
    iconBg: "bg-teal-50",
    iconColor: "text-teal-600",
  },
]
