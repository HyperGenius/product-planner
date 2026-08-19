/* frontend/src/lib/api-client.ts */
import { createClient } from '@/utils/supabase/client'

type FetchOptions = RequestInit & {
    headers?: Record<string, string>
}

export class ApiError extends Error {
    status: number
    data: Record<string, unknown>

    constructor(status: number, data: Record<string, unknown>) {
        super(typeof data.detail === 'string' ? data.detail : 'API Request Failed')
        this.name = 'ApiError'
        this.status = status
        this.data = data
    }

    // FastAPI は {"detail": {"error": "..."}} の形で返すため detail.error を参照する
    get errorCode(): string | undefined {
        const detail = this.data.detail
        if (detail && typeof detail === 'object' && 'error' in detail) {
            return (detail as Record<string, unknown>).error as string
        }
        return undefined
    }
}

/**
 * カスタムAPIクライアント
 * AuthorizationヘッダーにJWTトークンを付与し、テナントIDをヘッダー(x-tenant-id)に付与する
 * @param endpoint APIエンドポイント
 * @param options Fetch APIのオプション
 * @returns APIレスポンス
 */
export async function apiClient<T>(endpoint: string, options: FetchOptions = {}): Promise<T> {
    const supabase = createClient()

    // 1. セッション（JWTトークン）の取得
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token

    if (!token) {
        // ログインしていない場合はログイン画面へリダイレクトなどの処理
        throw new Error('Unauthorized')
    }

    // 2. テナントIDの取得
    // ※MVP段階では、ユーザーの所属テーブル(organization_members)から最初の1つを取得するか、
    // ログイン時にlocalStorageに保存した値を使用します。
    // ここでは仮に 'currentTenantId' というキーでlocalStorageにあると仮定します。
    const tenantId = typeof window !== 'undefined'
        ? localStorage.getItem('currentTenantId')
        : null

    // 必須ヘッダーの構築
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...(tenantId && { 'x-tenant-id': tenantId }),
        ...options.headers,
    }

    // 3. APIリクエスト実行
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}${endpoint}`, {
        ...options,
        headers,
    })

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new ApiError(response.status, errorData)
    }

    // 204 No Content 等、ボディを持たないレスポンスは response.json() が
    // "Unexpected end of JSON input" で失敗するため、先に空ボディを判定する
    if (response.status === 204 || response.headers.get('content-length') === '0') {
        return undefined as T
    }

    return response.json()
}