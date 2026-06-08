"use client"

import { useMemo, useState } from "react"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts"
import { useWeeklyConfirmations } from "@/hooks/use-admin-metrics"
import { format } from "date-fns"
import { ja } from "date-fns/locale"

export default function AdminPage() {
  const { data, isLoading, error } = useWeeklyConfirmations()
  const [selectedTenantId, setSelectedTenantId] = useState<string>("all")

  const tenants = useMemo(() => {
    if (!data) return []
    const map = new Map<string, string>()
    for (const row of data) {
      map.set(row.tenant_id, row.tenant_name)
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }))
  }, [data])

  const chartData = useMemo(() => {
    if (!data) return []

    const weekMap = new Map<string, number>()
    const filtered =
      selectedTenantId === "all"
        ? data
        : data.filter((row) => row.tenant_id === selectedTenantId)

    for (const row of filtered) {
      weekMap.set(row.week_start, (weekMap.get(row.week_start) ?? 0) + row.count)
    }

    return Array.from(weekMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week_start, count]) => ({
        week: format(new Date(week_start), "M/d週", { locale: ja }),
        count,
      }))
  }, [data, selectedTenantId])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
        読み込み中...
      </div>
    )
  }

  if (error) {
    const is403 = error.message?.includes("403") || error.message?.includes("プラットフォーム管理者")
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center">
        <p className="text-sm text-destructive font-medium">
          {is403 ? "アクセス権限がありません（プラットフォーム管理者専用）" : error.message}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">週次納期確認件数</h1>
          <p className="text-sm text-muted-foreground mt-1">直近12週のテナント別納期確認数</p>
        </div>
        <select
          value={selectedTenantId}
          onChange={(e) => setSelectedTenantId(e.target.value)}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="all">全テナント合計</option>
          {tenants.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      <div className="rounded-xl border bg-card p-6">
        {chartData.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
            データがありません
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="week"
                tick={{ fontSize: 12 }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                width={32}
              />
              <Tooltip
                formatter={(value) => [`${value}件`, "納期確認数"]}
                labelFormatter={(label) => `${label}`}
              />
              <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={48} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {selectedTenantId === "all" && tenants.length > 0 && (
        <div className="rounded-xl border bg-card p-6">
          <h2 className="text-sm font-medium mb-4">テナント別サマリー（直近12週合計）</h2>
          <div className="grid gap-3">
            {tenants.map((tenant) => {
              const total = data!
                .filter((row) => row.tenant_id === tenant.id)
                .reduce((sum, row) => sum + row.count, 0)
              return (
                <div key={tenant.id} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{tenant.name}</span>
                  <span className="font-medium tabular-nums">{total}件</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
