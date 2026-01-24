/* frontend/src/app/login/page.tsx */
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import { fetchMyTenantId } from '@/lib/auth-actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from "sonner"

const DEFAULT_USER = process.env.NODE_ENV === 'development' ? process.env.NEXT_PUBLIC_TEST_USER : ''
const DEFAULT_PASSWORD = process.env.NODE_ENV === 'development' ? process.env.NEXT_PUBLIC_TEST_PASSWORD : ''

export default function LoginPage() {
    const router = useRouter()
    const [email, setEmail] = useState(DEFAULT_USER || '')
    const [password, setPassword] = useState(DEFAULT_PASSWORD || '')
    const [loading, setLoading] = useState(false)

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)

        const supabase = createClient()

        try {
            // 1. Supabase Auth でログイン
            const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
                email,
                password,
            })

            if (authError) throw authError
            if (!authData.user) throw new Error('ユーザー情報の取得に失敗しました')

            // 2. 所属テナントIDを取得
            const tenantId = await fetchMyTenantId(authData.user.id)

            if (!tenantId) {
                throw new Error('所属するテナントが見つかりません。管理者に連絡してください。')
            }

            // 3. LocalStorage に保存 (apiClientで使用するため)
            // ※ APIクライアント側で 'currentTenantId' というキーを参照するように実装済み
            localStorage.setItem('currentTenantId', tenantId)

            toast.success('ログイン成功', {
                description: 'ダッシュボードへ移動します',
            })

            // 4. リダイレクト (ルーターキャッシュをクリアして遷移)
            router.refresh()
            router.push('/master/equipment-groups') // 最初の画面へ

        } catch (error: any) {
            console.error(error)
            toast.error('ログイン失敗', {
                description: error.message || '認証に失敗しました',
            })
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="flex h-screen items-center justify-center">
            <form onSubmit={handleLogin} className="w-full max-w-sm space-y-4 p-8 border rounded-lg shadow-sm">
                <h1 className="text-2xl font-bold text-center mb-6">ログイン</h1>

                <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                        id="email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                    />
                </div>

                <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <Input
                        id="password"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                    />
                </div>

                <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? 'ログイン中...' : 'ログイン'}
                </Button>
            </form>
        </div>
    )
}