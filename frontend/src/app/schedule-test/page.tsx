"use client"

import React, { useState } from "react"
import { GanttChart } from "@/components/schedule/gantt-chart"
import { Schedule, GanttViewMode } from "@/types/schedule"
import { Button } from "@/components/ui/button"

/**
 * ガントチャートのテストページ
 * ダミーデータを用いて表示を確認
 */
export default function ScheduleTestPage() {
  const [viewMode, setViewMode] = useState<GanttViewMode>('Day')
  const [colorMode, setColorMode] = useState<'product' | 'process'>('product')

  // ダミーデータ
  const dummySchedules: Schedule[] = [
    {
      id: 1,
      order_id: 1,
      process_routing_id: 1,
      equipment_id: 1,
      start_datetime: new Date(2024, 0, 10, 9, 0).toISOString(),
      end_datetime: new Date(2024, 0, 10, 12, 0).toISOString(),
      order_number: 'ORD-001',
      product_name: '製品A',
      process_name: '切削',
      equipment_name: '設備1',
    },
    {
      id: 2,
      order_id: 1,
      process_routing_id: 2,
      equipment_id: 2,
      start_datetime: new Date(2024, 0, 10, 13, 0).toISOString(),
      end_datetime: new Date(2024, 0, 10, 16, 0).toISOString(),
      order_number: 'ORD-001',
      product_name: '製品A',
      process_name: '組立',
      equipment_name: '設備2',
    },
    {
      id: 3,
      order_id: 2,
      process_routing_id: 3,
      equipment_id: 1,
      start_datetime: new Date(2024, 0, 11, 9, 0).toISOString(),
      end_datetime: new Date(2024, 0, 11, 11, 0).toISOString(),
      order_number: 'ORD-002',
      product_name: '製品B',
      process_name: '切削',
      equipment_name: '設備1',
    },
    {
      id: 4,
      order_id: 2,
      process_routing_id: 4,
      equipment_id: 3,
      start_datetime: new Date(2024, 0, 11, 14, 0).toISOString(),
      end_datetime: new Date(2024, 0, 11, 16, 30).toISOString(),
      order_number: 'ORD-002',
      product_name: '製品B',
      process_name: '検査',
      equipment_name: '設備3',
    },
    {
      id: 5,
      order_id: 3,
      process_routing_id: 5,
      equipment_id: 4,
      start_datetime: new Date(2024, 0, 12, 10, 0).toISOString(),
      end_datetime: new Date(2024, 0, 12, 15, 0).toISOString(),
      order_number: 'ORD-003',
      product_name: '製品C',
      process_name: '塗装',
      equipment_name: '設備4',
    },
  ]

  return (
    <div className="container mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">ガントチャート テスト</h1>
      
      {/* コントロールパネル */}
      <div className="mb-6 flex gap-4 items-center">
        <div className="flex gap-2">
          <span className="font-semibold">表示モード:</span>
          <Button
            variant={viewMode === 'Day' ? 'default' : 'outline'}
            onClick={() => setViewMode('Day')}
            size="sm"
          >
            日
          </Button>
          <Button
            variant={viewMode === 'Week' ? 'default' : 'outline'}
            onClick={() => setViewMode('Week')}
            size="sm"
          >
            週
          </Button>
          <Button
            variant={viewMode === 'Month' ? 'default' : 'outline'}
            onClick={() => setViewMode('Month')}
            size="sm"
          >
            月
          </Button>
        </div>

        <div className="flex gap-2">
          <span className="font-semibold">色分け:</span>
          <Button
            variant={colorMode === 'product' ? 'default' : 'outline'}
            onClick={() => setColorMode('product')}
            size="sm"
          >
            製品別
          </Button>
          <Button
            variant={colorMode === 'process' ? 'default' : 'outline'}
            onClick={() => setColorMode('process')}
            size="sm"
          >
            工程別
          </Button>
        </div>
      </div>

      {/* ガントチャート */}
      <div className="border rounded-lg p-4 bg-white">
        <GanttChart
          tasks={dummySchedules}
          viewMode={viewMode}
          colorMode={colorMode}
        />
      </div>

      {/* データ表示 */}
      <div className="mt-6">
        <h2 className="text-xl font-semibold mb-3">ダミーデータ</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse border">
            <thead>
              <tr className="bg-gray-100">
                <th className="border p-2">ID</th>
                <th className="border p-2">注文番号</th>
                <th className="border p-2">製品名</th>
                <th className="border p-2">工程名</th>
                <th className="border p-2">設備名</th>
                <th className="border p-2">開始時刻</th>
                <th className="border p-2">終了時刻</th>
              </tr>
            </thead>
            <tbody>
              {dummySchedules.map((schedule) => (
                <tr key={schedule.id}>
                  <td className="border p-2">{schedule.id}</td>
                  <td className="border p-2">{schedule.order_number}</td>
                  <td className="border p-2">{schedule.product_name}</td>
                  <td className="border p-2">{schedule.process_name}</td>
                  <td className="border p-2">{schedule.equipment_name}</td>
                  <td className="border p-2">
                    {new Date(schedule.start_datetime).toLocaleString('ja-JP')}
                  </td>
                  <td className="border p-2">
                    {new Date(schedule.end_datetime).toLocaleString('ja-JP')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
