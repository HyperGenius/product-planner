/* frontend/src/app/login/page.tsx */
'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import { fetchMyTenantId } from '@/lib/auth-actions'
import { fetchDeviceStatus, getStoredDeviceId, pinLogin } from '@/lib/device-auth-client'
import type { DeviceMemberOption } from '@/types/device'
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

const PIN_PATTERN = /^\d{4}$/

export default function LoginPage() {
    const [email, setEmail] = useState(DEFAULT_USER || '')
    const [password, setPassword] = useState(DEFAULT_PASSWORD || '')
    const [loading, setLoading] = useState(false)

    // 信頼済み端末・PINログイン関連の状態
    const [deviceId, setDeviceId] = useState<string | null>(null)
    const [trustedMembers, setTrustedMembers] = useState<DeviceMemberOption[] | null>(null)
    const [selectedMember, setSelectedMember] = useState<DeviceMemberOption | null>(null)
    const [pin, setPin] = useState('')
    const [usePasswordFallback, setUsePasswordFallback] = useState(false)

    useEffect(() => {
        const storedDeviceId = getStoredDeviceId()
        if (!storedDeviceId) return

        setDeviceId(storedDeviceId)
        fetchDeviceStatus(storedDeviceId)
            .then((status) => {
                if (status.trusted && status.members.length > 0) {
                    setTrustedMembers(status.members)
                }
            })
            .catch(() => {
                // 端末状態の取得に失敗した場合はID/PWフォームにフォールバックする
            })
    }, [])

    const finishLogin = async (userId: string) => {
        const tenantId = await fetchMyTenantId(userId)

        if (!tenantId) {
            throw new Error('所属するテナントが見つかりません。管理者に連絡してください。')
        }

        localStorage.setItem('currentTenantId', tenantId)

        toast.success('ログイン成功', {
            description: 'ダッシュボードへ移動します',
        })

        window.location.href = '/'
    }

    const handlePinLogin = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!deviceId || !selectedMember) return
        setLoading(true)

        try {
            const { access_token, refresh_token } = await pinLogin(deviceId, selectedMember.user_id, pin)

            const supabase = createClient()
            const { error: setSessionError } = await supabase.auth.setSession({
                access_token,
                refresh_token,
            })
            if (setSessionError) throw setSessionError

            await finishLogin(selectedMember.user_id)
        } catch (error) {
            console.error(error)
            toast.error('ログイン失敗', {
                description: error instanceof Error ? error.message : 'PINが正しくありません',
            })
        } finally {
            setLoading(false)
        }
    }

    const handlePasswordLogin = async (e: React.FormEvent) => {
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

            await finishLogin(authData.user.id)
        } catch (error) {
            console.error(error)
            toast.error('ログイン失敗', {
                description: error instanceof Error ? error.message : '認証に失敗しました',
            })
        } finally {
            setLoading(false)
        }
    }

    // 信頼済み端末でPINログインを表示するかどうか
    const showPinLogin = trustedMembers && trustedMembers.length > 0 && !usePasswordFallback

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
            <div className="flex w-full max-w-4xl rounded-2xl shadow-2xl overflow-hidden" style={{ minHeight: '560px' }}>
                {/* Left branding panel */}
                <div className="hidden lg:flex lg:w-1/2 flex-col justify-between bg-[#1a2744] text-white p-10">
                    <div>
                        <div className="flex items-center gap-3 mb-10">
                            <div className="w-8 h-8 bg-white/10 rounded-lg flex items-center justify-center">
                                <ClipboardList className="w-4 h-4 text-white" />
                            </div>
                            <span className="text-lg font-semibold tracking-wide">ProductPlanner</span>
                        </div>

                        <h2 className="text-2xl font-bold leading-snug mb-3">
                            製造業の生産計画を、<br />もっとシンプルに。
                        </h2>
                        <p className="text-white/60 text-sm leading-relaxed mb-8">
                            受注から納期管理・設備スケジューリングまで、<br />
                            現場の実務に即した統合プラットフォーム。
                        </p>

                        <ul className="space-y-4">
                            {FEATURES.map(({ icon: Icon, label }) => (
                                <li key={label} className="flex items-center gap-3">
                                    <div className="w-7 h-7 rounded-md bg-white/10 flex items-center justify-center shrink-0">
                                        <Icon className="w-3.5 h-3.5 text-white/80" />
                                    </div>
                                    <span className="text-sm text-white/80">{label}</span>
                                </li>
                            ))}
                        </ul>
                    </div>

                    <p className="text-white/30 text-xs">
                        © {new Date().getFullYear()} ProductPlanner. All rights reserved.
                    </p>
                </div>

                {/* Right login form */}
                <div className="flex flex-1 flex-col items-center justify-center bg-white px-8 py-10">
                    {/* Mobile logo */}
                    <div className="flex items-center gap-2 mb-8 lg:hidden">
                        <div className="w-8 h-8 bg-[#1a2744] rounded-lg flex items-center justify-center">
                            <ClipboardList className="w-4 h-4 text-white" />
                        </div>
                        <span className="text-lg font-semibold text-[#1a2744]">ProductPlanner</span>
                    </div>

                    <div className="w-full max-w-sm">
                        {showPinLogin ? (
                            <>
                                <div className="mb-7">
                                    <h1 className="text-2xl font-bold text-gray-900">ログイン</h1>
                                    <p className="mt-1 text-sm text-gray-500">
                                        名前を選択してPINを入力してください
                                    </p>
                                </div>

                                {!selectedMember ? (
                                    <div className="space-y-2">
                                        {trustedMembers!.map((member) => (
                                            <button
                                                key={member.user_id}
                                                type="button"
                                                onClick={() => setSelectedMember(member)}
                                                className="w-full text-left px-4 py-3 rounded-md border border-gray-300 hover:border-[#1a2744] hover:bg-gray-50 transition-colors"
                                            >
                                                {member.full_name ?? '（氏名未設定）'}
                                            </button>
                                        ))}
                                    </div>
                                ) : (
                                    <form onSubmit={handlePinLogin} className="space-y-5">
                                        <div className="space-y-1.5">
                                            <Label htmlFor="pin" className="text-sm font-medium text-gray-700">
                                                {selectedMember.full_name ?? '（氏名未設定）'} のPIN
                                            </Label>
                                            <Input
                                                id="pin"
                                                type="password"
                                                inputMode="numeric"
                                                maxLength={4}
                                                placeholder="••••"
                                                value={pin}
                                                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                                                autoFocus
                                                required
                                            />
                                        </div>
                                        <Button
                                            type="submit"
                                            className="w-full bg-[#1a2744] hover:bg-[#243460] text-white font-medium py-2.5"
                                            disabled={loading || !PIN_PATTERN.test(pin)}
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
                                        <button
                                            type="button"
                                            className="w-full text-center text-sm text-gray-500 hover:text-gray-700"
                                            onClick={() => { setSelectedMember(null); setPin('') }}
                                        >
                                            戻る
                                        </button>
                                    </form>
                                )}

                                <p className="mt-7 text-center text-xs text-gray-400">
                                    <button
                                        type="button"
                                        className="underline hover:text-gray-600"
                                        onClick={() => setUsePasswordFallback(true)}
                                    >
                                        パスワードでログイン
                                    </button>
                                </p>
                            </>
                        ) : (
                            <>
                                <div className="mb-7">
                                    <h1 className="text-2xl font-bold text-gray-900">ログイン</h1>
                                    <p className="mt-1 text-sm text-gray-500">
                                        アカウント情報を入力してください
                                    </p>
                                </div>

                                <form onSubmit={handlePasswordLogin} className="space-y-5">
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

                                {trustedMembers && trustedMembers.length > 0 && (
                                    <p className="mt-7 text-center text-xs text-gray-400">
                                        <button
                                            type="button"
                                            className="underline hover:text-gray-600"
                                            onClick={() => setUsePasswordFallback(false)}
                                        >
                                            PINでログイン
                                        </button>
                                    </p>
                                )}

                                <p className="mt-2 text-center text-xs text-gray-400">
                                    アカウントをお持ちでない方は管理者にお問い合わせください
                                </p>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}
