/* frontend/src/lib/auth-actions.ts */
import { createClient } from '@/utils/supabase/client'

/**
 * ログイン中のユーザーが所属する最初のテナントIDを取得する
 */
export async function fetchMyTenantId(userId: string): Promise<string | null> {
    const supabase = createClient()

    // RLSにより、自分の所属データのみが取得できる
    const { data, error } = await supabase
        .from('organization_members')
        .select('tenant_id')
        .eq('user_id', userId)
        .limit(1)
        .single()

    if (error) {
        console.error('Failed to fetch tenant: %s, user_id: %s', error.message, userId)
        return null
    }

    return data?.tenant_id || null
}