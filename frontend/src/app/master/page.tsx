import Link from "next/link"
import { masterItems } from "./constants"

export default function MasterPage() {
  return (
    <div className="py-10">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">マスタデータ</h1>
        <p className="text-muted-foreground">
          各種マスタデータの登録・管理を行います
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {masterItems.map((item) => (
          <Link key={item.href} href={item.href}>
            <div className="flex items-start gap-4 rounded-lg border p-6 transition-colors hover:bg-accent hover:text-accent-foreground">
              <div className="rounded-md bg-muted p-2">
                <item.icon className="h-5 w-5" />
              </div>
              <div>
                <h2 className="font-semibold">{item.title}</h2>
                <p className="text-sm text-muted-foreground">{item.description}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
