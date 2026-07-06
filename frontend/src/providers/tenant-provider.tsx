/* frontend/src/providers/tenant-provider.tsx */
'use client'

import { createContext, useContext, useEffect, useState } from 'react'

type TenantContextType = {
    tenantId: string | null
    setTenantId: (id: string) => void
}

const TenantContext = createContext<TenantContextType | undefined>(undefined)

/**
 * アプリ全体で現在のテナント情報を管理する
 * @param children 
 */
export function TenantProvider({ children }: { children: React.ReactNode }) {
    const [tenantId, setTenantIdState] = useState<string | null>(null)

    // マウント時に localStorage から復元
    // localStorage はSSR時に存在しないため、レンダー中ではなくエフェクトでの読み込みが必須
    // (サーバーは常に null を返す必要があり、ハイドレーション後にのみ復元できる)
    useEffect(() => {
        const stored = localStorage.getItem('currentTenantId')
        // eslint-disable-next-line react-hooks/set-state-in-effect -- SSR非対応のlocalStorage同期のため意図的
        if (stored) setTenantIdState(stored)
    }, [])

    const setTenantId = (id: string) => {
        localStorage.setItem('currentTenantId', id)
        setTenantIdState(id)
    }

    return (
        <TenantContext.Provider value={{ tenantId, setTenantId }}>
            {children}
        </TenantContext.Provider>
    )
}

/**
 * TenantProviderでラップされたコンポーネントからテナント情報を取得する
 * @returns 
 */
export const useTenant = () => {
    const context = useContext(TenantContext)
    if (context === undefined) {
        throw new Error('useTenant must be used within a TenantProvider')
    }
    return context
}