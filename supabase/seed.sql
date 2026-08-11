-- テストユーザーは3名分作成する（承認ワークフロー Issue #325 / 監査ログ Issue #326 の動作確認用）。
-- いずれもパスワードは Test123!（backend/.env.sample の TEST_USER_PASS と同じ
-- bcryptハッシュを共有しているため、パスワード自体はハッシュ化前の平文で共通）。
--   test@example.com          … president（承認・却下、承認監査ログの閲覧を行う）
--   order_handler@example.com … order_handler（承認依頼の送信を行う。監査ログは閲覧不可）
--   iso_officer@example.com   … iso_officer（承認監査ログの閲覧・CSV出力のみ行う）

-- 1. Create Test Users
INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change
) VALUES
(
    '00000000-0000-0000-0000-000000000000',
    '11111111-1111-1111-1111-111111111111',
    'authenticated', 'authenticated',
    'test@example.com',
    '$2a$10$.Ulu3FXi6elgYxA/bwIjYuYBYi05tEYmknOuBfeIb1VE1D.KNzxhe',  -- ハッシュ化されたパスワード (Test123!)
    now(), '{"provider":"email","providers":["email"]}', '{}',
    now(), now(), '', '', '', ''
),
(
    '00000000-0000-0000-0000-000000000000',
    '33333333-3333-3333-3333-333333333333',
    'authenticated', 'authenticated',
    'order_handler@example.com',
    '$2a$10$.Ulu3FXi6elgYxA/bwIjYuYBYi05tEYmknOuBfeIb1VE1D.KNzxhe',  -- ハッシュ化されたパスワード (Test123!)
    now(), '{"provider":"email","providers":["email"]}', '{}',
    now(), now(), '', '', '', ''
),
(
    '00000000-0000-0000-0000-000000000000',
    '44444444-4444-4444-4444-444444444444',
    'authenticated', 'authenticated',
    'iso_officer@example.com',
    '$2a$10$.Ulu3FXi6elgYxA/bwIjYuYBYi05tEYmknOuBfeIb1VE1D.KNzxhe',  -- ハッシュ化されたパスワード (Test123!)
    now(), '{"provider":"email","providers":["email"]}', '{}',
    now(), now(), '', '', '', ''
)
ON CONFLICT (id) DO NOTHING;

-- 2. Identities
INSERT INTO auth.identities (
    id,
    user_id,
    identity_data,
    provider,
    provider_id,
    last_sign_in_at,
    created_at,
    updated_at
) VALUES
(
    '11111111-1111-1111-1111-111111111111', -- pkey用
    '11111111-1111-1111-1111-111111111111', -- auth.usersのID
    format('{"sub":"%s","email":"%s"}', '11111111-1111-1111-1111-111111111111', 'test@example.com')::jsonb,
    'email',
    '11111111-1111-1111-1111-111111111111', -- provider_idとしてuser_idと同じものを指定
    now(), now(), now()
),
(
    '33333333-3333-3333-3333-333333333333', -- pkey用
    '33333333-3333-3333-3333-333333333333', -- auth.usersのID
    format('{"sub":"%s","email":"%s"}', '33333333-3333-3333-3333-333333333333', 'order_handler@example.com')::jsonb,
    'email',
    '33333333-3333-3333-3333-333333333333', -- provider_idとしてuser_idと同じものを指定
    now(), now(), now()
),
(
    '44444444-4444-4444-4444-444444444444', -- pkey用
    '44444444-4444-4444-4444-444444444444', -- auth.usersのID
    format('{"sub":"%s","email":"%s"}', '44444444-4444-4444-4444-444444444444', 'iso_officer@example.com')::jsonb,
    'email',
    '44444444-4444-4444-4444-444444444444', -- provider_idとしてuser_idと同じものを指定
    now(), now(), now()
)
ON CONFLICT (provider_id, provider) DO NOTHING;

-- 3. Tenants & Members
INSERT INTO public.tenants (id, name)
VALUES ('22222222-2222-2222-2222-222222222222', 'Test Tenant')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.organization_members (user_id, tenant_id, role)
VALUES
    ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'president'),
    ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 'order_handler'),
    ('44444444-4444-4444-4444-444444444444', '22222222-2222-2222-2222-222222222222', 'iso_officer')
ON CONFLICT (user_id, tenant_id) DO NOTHING;

-- 4. Profiles（承認監査ログ画面 (Issue #326) で操作者の氏名・メールを表示するため）
INSERT INTO public.profiles (id, full_name, email)
VALUES
    ('11111111-1111-1111-1111-111111111111', '社長 太郎', 'test@example.com'),
    ('33333333-3333-3333-3333-333333333333', '受注 花子', 'order_handler@example.com'),
    ('44444444-4444-4444-4444-444444444444', 'ISO 次郎', 'iso_officer@example.com')
ON CONFLICT (id) DO NOTHING;