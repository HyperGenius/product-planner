/* frontend/src/components/equipment-list.tsx */
"use client"

import { Equipment } from "@/types/equipment"

interface EquipmentListProps {
    title: string
    equipments: Equipment[]
    selectedIds: Set<number>
    onToggle: (id: number) => void
    isLoading: boolean
    emptyMessage?: string
}

/**
 * 設備リストコンポーネント
 * @param title リストのタイトル
 * @param equipments 設備のリスト
 * @param selectedIds 選択された設備のIDのセット
 * @param onToggle 設備の選択状態を切り替える関数
 * @param isLoading 読み込み中かどうか
 * @param emptyMessage 空の場合に表示するメッセージ
 * @returns 設備リストコンポーネント
 */
export function EquipmentList({
    title,
    equipments,
    selectedIds,
    onToggle,
    isLoading,
    emptyMessage = "設備はありません",
}: EquipmentListProps) {
    return (
        <div className="border rounded-lg p-4 h-full flex flex-col">
            <h3 className="font-semibold mb-3 text-sm">{title}</h3>
            <div className="space-y-1 flex-1 overflow-y-auto min-h-0">
                {isLoading ? (
                    <p className="text-sm text-muted-foreground text-center py-4">読み込み中...</p>
                ) : equipments.length > 0 ? (
                    equipments.map((equipment) => (
                        <div
                            key={equipment.id}
                            className={`p-2 rounded cursor-pointer hover:bg-accent transition-colors ${selectedIds.has(equipment.id) ? "bg-accent" : ""
                                }`}
                            onClick={() => onToggle(equipment.id)}
                        >
                            <div className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    checked={selectedIds.has(equipment.id)}
                                    onChange={() => onToggle(equipment.id)}
                                    className="cursor-pointer"
                                    onClick={(e) => e.stopPropagation()}
                                />
                                <span className="text-sm">{equipment.name}</span>
                            </div>
                        </div>
                    ))
                ) : (
                    <p className="text-sm text-muted-foreground text-center py-4">{emptyMessage}</p>
                )}
            </div>
        </div>
    )
}
