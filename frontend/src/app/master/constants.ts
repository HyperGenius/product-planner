import { Calendar, Cpu, Package, Users } from "lucide-react"

export const masterItems = [
  {
    title: "製品マスタ",
    href: "/master/products",
    icon: Package,
    description: "製品・品番登録",
    accent: "border-t-blue-500",
    iconBg: "bg-blue-50",
    iconColor: "text-blue-600",
  },
  {
    title: "顧客マスタ",
    href: "/master/customers",
    icon: Users,
    description: "顧客情報登録",
    accent: "border-t-green-500",
    iconBg: "bg-green-50",
    iconColor: "text-green-600",
  },
  {
    title: "設備マスタ",
    href: "/master/equipments",
    icon: Cpu,
    description: "設備・機械登録 / グループ管理",
    accent: "border-t-orange-400",
    iconBg: "bg-orange-50",
    iconColor: "text-orange-500",
  },
  {
    title: "稼働カレンダー",
    href: "/master/calendar",
    icon: Calendar,
    description: "稼働日・休日設定",
    accent: "border-t-teal-500",
    iconBg: "bg-teal-50",
    iconColor: "text-teal-600",
  },
]
