"use client"

import { useState, useMemo, useCallback } from "react"
import { toast } from "sonner"
import { useEquipments } from "@/hooks/use-equipments"
import {
    useEquipmentGroupMembers,
    useAddEquipmentToGroup,
    useRemoveEquipmentFromGroup,
} from "@/hooks/use-equipment-group-members"
import type { EquipmentGroup } from "@/lib/hooks/use-equipment-groups"

export function useEquipmentAssignment(group: EquipmentGroup | null) {
    const [selectedUnassigned, setSelectedUnassigned] = useState<Set<number>>(new Set())
    const [selectedAssigned, setSelectedAssigned] = useState<Set<number>>(new Set())

    // データ取得
    const { data: allEquipments, isLoading: isLoadingEquipments } = useEquipments()
    const { data: assignedEquipments, isLoading: isLoadingMembers } = useEquipmentGroupMembers(
        group?.id ?? 0
    )

    // 操作用ミューテーション
    const addMutation = useAddEquipmentToGroup()
    const removeMutation = useRemoveEquipmentFromGroup()

    // 未所属設備と所属設備のリストを計算
    const { unassignedEquipments, assigned } = useMemo(() => {
        if (!allEquipments || !assignedEquipments) {
            return { unassignedEquipments: [], assigned: [] }
        }

        const assignedIds = new Set(assignedEquipments.map((eq) => eq.id))
        const unassigned = allEquipments.filter((eq) => !assignedIds.has(eq.id))

        return {
            unassignedEquipments: unassigned,
            assigned: assignedEquipments,
        }
    }, [allEquipments, assignedEquipments])

    // 選択状態の操作
    const toggleUnassignedSelection = useCallback((equipmentId: number) => {
        setSelectedUnassigned((prev) => {
            const newSelection = new Set(prev)
            if (newSelection.has(equipmentId)) {
                newSelection.delete(equipmentId)
            } else {
                newSelection.add(equipmentId)
            }
            return newSelection
        })
    }, [])

    const toggleAssignedSelection = useCallback((equipmentId: number) => {
        setSelectedAssigned((prev) => {
            const newSelection = new Set(prev)
            if (newSelection.has(equipmentId)) {
                newSelection.delete(equipmentId)
            } else {
                newSelection.add(equipmentId)
            }
            return newSelection
        })
    }, [])

    const resetSelections = useCallback(() => {
        setSelectedUnassigned(new Set())
        setSelectedAssigned(new Set())
    }, [])

    // 設備を追加
    const handleAddEquipments = useCallback(async () => {
        if (!group || selectedUnassigned.size === 0) return

        try {
            const promises = Array.from(selectedUnassigned).map((equipmentId) =>
                addMutation.mutateAsync({ groupId: group.id, equipmentId })
            )
            await Promise.all(promises)
            toast.success(`${selectedUnassigned.size}件の設備を追加しました`)
            setSelectedUnassigned(new Set())
        } catch (error) {
            toast.error("設備の追加に失敗しました")
            console.error(error)
        }
    }, [group, selectedUnassigned, addMutation])

    // 設備を削除
    const handleRemoveEquipments = useCallback(async () => {
        if (!group || selectedAssigned.size === 0) return

        try {
            const promises = Array.from(selectedAssigned).map((equipmentId) =>
                removeMutation.mutateAsync({ groupId: group.id, equipmentId })
            )
            await Promise.all(promises)
            toast.success(`${selectedAssigned.size}件の設備を削除しました`)
            setSelectedAssigned(new Set())
        } catch (error) {
            toast.error("設備の削除に失敗しました")
            console.error(error)
        }
    }, [group, selectedAssigned, removeMutation])

    const isLoading = isLoadingEquipments || isLoadingMembers
    const isPending = addMutation.isPending || removeMutation.isPending

    return {
        unassignedEquipments,
        assigned,
        selectedUnassigned,
        selectedAssigned,
        toggleUnassignedSelection,
        toggleAssignedSelection,
        handleAddEquipments,
        handleRemoveEquipments,
        resetSelections,
        isLoading,
        isPending,
    }
}
