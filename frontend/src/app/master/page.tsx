import Link from "next/link"
import { masterItems } from "./constants"

export default function MasterPage() {
  return (
    <div className="py-10">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">マスタデータ</h1>
        <p className="text-muted-foreground mt-1">各種マスタデータの登録・管理を行います</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {masterItems.map((item) => (
          <Link key={item.href} href={item.href} className="group">
            <div
              className={`rounded-lg border-t-4 ${item.accent} border border-border bg-card p-5 shadow-sm transition-colors hover:bg-accent/40 min-h-[120px]`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <p className="text-md font-medium mb-1">{item.title}</p>
                  <p className="text-sm text-muted-foreground/70 leading-relaxed">{item.description}</p>
                </div>
                <div className={`rounded-lg ${item.iconBg} p-2.5 ml-4 shrink-0`}>
                  <item.icon className={`h-5 w-5 ${item.iconColor}`} />
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
