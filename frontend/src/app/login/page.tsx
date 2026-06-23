/* frontend/src/app/login/page.tsx */
'use client'

import { useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import { fetchMyTenantId } from '@/lib/auth-actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from "sonner"
import { ClipboardList, CalendarCheck, BarChart3, Loader2 } from 'lucide-react'

const DEFAULT_USER = process.env.NODE_ENV === 'development' ? process.env.NEXT_PUBLIC_TEST_USER : ''
const DEFAULT_PASSWORD = process.env.NODE_ENV === 'development' ? process.env.NEXT_PUBLIC_TEST_PASSWORD : ''

const FEATURES = [
    { icon: ClipboardList, label: '受注・納期の一元管理' },
    { icon: CalendarCheck, label: '設備別生産スケジューリング' },
    { icon: BarChart3, label: 'ガントチャートで進捗を可視化' },
]

export default function LoginPage() {
    const [email, setEmail] = useState(DEFAULT_USER || '')
    const [password, setPassword] = useState(DEFAULT_PASSWORD || '')
    const [loading, setLoading] = useState(false)

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)

        const supabase = createClient()

        try {
            const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
                email,
                password,
            })

            if (authError) throw authError
            if (!authData.user) throw new Error('ユーザー情報の取得に失敗しました')

            const tenantId = await fetchMyTenantId(authData.user.id)

            if (!tenantId) {
                throw new Error('所属するテナントが見つかりません。管理者に連絡してください。')
            }

            localStorage.setItem('currentTenantId', tenantId)

            toast.success('ログイン成功', {
                description: 'ダッシュボードへ移動します',
            })

            window.location.href = '/'

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
        <div className="flex min-h-screen">
            {/* Left branding panel */}
            <div className="hidden lg:flex lg:w-1/2 flex-col justify-between bg-[#1a2744] text-white p-12">
                <div>
                    <div className="flex items-center gap-3 mb-12">
                        <div className="w-9 h-9 bg-white/10 rounded-lg flex items-center justify-center">
                            <ClipboardList className="w-5 h-5 text-white" />
                        </div>
                        <span className="text-xl font-semibold tracking-wide">ProductPlanner</span>
                    </div>

                    <div className="max-w-sm">
                        <h2 className="text-3xl font-bold leading-snug mb-4">
                            製造業の生産計画を、<br />もっとシンプルに。
                        </h2>
                        <p className="text-white/60 text-sm leading-relaxed mb-10">
                            受注から納期管理・設備スケジューリングまで、<br />
                            現場の実務に即した統合プラットフォーム。
                        </p>

                        <ul className="space-y-5">
                            {FEATURES.map(({ icon: Icon, label }) => (
                                <li key={label} className="flex items-center gap-4">
                                    <div className="w-8 h-8 rounded-md bg-white/10 flex items-center justify-center shrink-0">
                                        <Icon className="w-4 h-4 text-white/80" />
                                    </div>
                                    <span className="text-sm text-white/80">{label}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>

                <p className="text-white/30 text-xs">
                    © {new Date().getFullYear()} ProductPlanner. All rights reserved.
                </p>
            </div>

            {/* Right login form */}
            <div className="flex flex-1 flex-col items-center justify-center bg-gray-50 px-6 py-12">
                {/* Mobile logo */}
                <div className="flex items-center gap-2 mb-10 lg:hidden">
                    <div className="w-8 h-8 bg-[#1a2744] rounded-lg flex items-center justify-center">
                        <ClipboardList className="w-4 h-4 text-white" />
                    </div>
                    <span className="text-lg font-semibold text-[#1a2744]">ProductPlanner</span>
                </div>

                <div className="w-full max-w-sm">
                    <div className="mb-8">
                        <h1 className="text-2xl font-bold text-gray-900">ログイン</h1>
                        <p className="mt-1 text-sm text-gray-500">
                            アカウント情報を入力してください
                        </p>
                    </div>

                    <form onSubmit={handleLogin} className="space-y-5">
                        <div className="space-y-1.5">
                            <Label htmlFor="email" className="text-sm font-medium text-gray-700">
                                メールアドレス
                            </Label>
                            <Input
                                id="email"
                                type="email"
                                placeholder="example@company.com"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="bg-white border-gray-300 focus:border-[#1a2744] focus:ring-[#1a2744]"
                                required
                            />
                        </div>

                        <div className="space-y-1.5">
                            <Label htmlFor="password" className="text-sm font-medium text-gray-700">
                                パスワード
                            </Label>
                            <Input
                                id="password"
                                type="password"
                                placeholder="••••••••"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="bg-white border-gray-300 focus:border-[#1a2744] focus:ring-[#1a2744]"
                                required
                            />
                        </div>

                        <Button
                            type="submit"
                            className="w-full bg-[#1a2744] hover:bg-[#243460] text-white font-medium py-2.5 mt-2"
                            disabled={loading}
                        >
                            {loading ? (
                                <span className="flex items-center gap-2">
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    ログイン中...
                                </span>
                            ) : (
                                'ログイン'
                            )}
                        </Button>
                    </form>

                    <p className="mt-8 text-center text-xs text-gray-400">
                        アカウントをお持ちでない方は管理者にお問い合わせください
                    </p>
                </div>
            </div>
        </div>
    )
}
