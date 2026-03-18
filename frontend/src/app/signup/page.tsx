'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/utils/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'

export default function SignupPage() {
    const router = useRouter()
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [tenantName, setTenantName] = useState('')
    const [loading, setLoading] = useState(false)

    const validate = (): string | null => {
        if (!email.trim()) return 'メールアドレスを入力してください'
        if (!password) return 'パスワードを入力してください'
        if (password.length < 8) return 'パスワードは8文字以上で入力してください'
        if (!tenantName.trim()) return '会社名を入力してください'
        return null
    }

    const handleSignup = async (e: React.FormEvent) => {
        e.preventDefault()

        const validationError = validate()
        if (validationError) {
            toast.error('入力エラー', { description: validationError })
            return
        }

        setLoading(true)
        const supabase = createClient()

        try {
            const { error } = await supabase.auth.signUp({
                email: email.trim(),
                password,
                options: {
                    data: {
                        tenant_name: tenantName.trim(),
                    },
                },
            })

            if (error) throw error

            toast.success('登録完了', {
                description: 'アカウントを作成しました。ダッシュボードへ移動します。',
            })

            router.refresh()
            router.push('/')
        } catch (error: unknown) {
            const message =
                error instanceof Error ? error.message : '登録に失敗しました'
            const description = /already registered/i.test(message)
                ? 'このメールアドレスはすでに登録されています'
                : message
            toast.error('登録失敗', { description })
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="flex h-screen items-center justify-center">
            <form
                onSubmit={handleSignup}
                className="w-full max-w-sm space-y-4 p-8 border rounded-lg shadow-sm"
            >
                <h1 className="text-2xl font-bold text-center mb-6">新規登録</h1>

                <div className="space-y-2">
                    <Label htmlFor="tenantName">会社名</Label>
                    <Input
                        id="tenantName"
                        type="text"
                        value={tenantName}
                        onChange={(e) => setTenantName(e.target.value)}
                        placeholder="例: 株式会社〇〇製作所"
                        required
                    />
                </div>

                <div className="space-y-2">
                    <Label htmlFor="email">メールアドレス</Label>
                    <Input
                        id="email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="example@company.com"
                        required
                    />
                </div>

                <div className="space-y-2">
                    <Label htmlFor="password">パスワード</Label>
                    <Input
                        id="password"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="8文字以上"
                        required
                    />
                </div>

                <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? '登録中...' : '登録する'}
                </Button>

                <p className="text-center text-sm text-muted-foreground">
                    すでにアカウントをお持ちの方は{' '}
                    <Link href="/login" className="underline underline-offset-4 hover:text-primary">
                        ログイン
                    </Link>
                </p>
            </form>
        </div>
    )
}
