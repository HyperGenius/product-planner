-- 1. Create Test User
INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password, 
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, 
    created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change
) VALUES (
    '00000000-0000-0000-0000-000000000000',
    '11111111-1111-1111-1111-111111111111',
    'authenticated', 'authenticated',
    'test@example.com',
    '$2a$10$.Ulu3FXi6elgYxA/bwIjYuYBYi05tEYmknOuBfeIb1VE1D.KNzxhe',  -- ハッシュ化されたパスワード
    now(), '{"provider":"email","providers":["email"]}', '{}',
    now(), now(), '', '', '', ''
) ON CONFLICT (id) DO NOTHING;

-- 2. Identity
INSERT INTO auth.identities (
    id,
    user_id,
    identity_data,
    provider,
    provider_id,
    last_sign_in_at,
    created_at,
    updated_at
) VALUES (
    '11111111-1111-1111-1111-111111111111', -- pkey用
    '11111111-1111-1111-1111-111111111111', -- auth.usersのID
    format('{"sub":"%s","email":"%s"}', '11111111-1111-1111-1111-111111111111', 'test@example.com')::jsonb,
    'email',
    '11111111-1111-1111-1111-111111111111', -- provider_idとしてuser_idと同じものを指定
    now(), now(), now()
) ON CONFLICT (provider_id, provider) DO NOTHING;

-- 3. Tenants & Members
INSERT INTO public.tenants (id, name)
VALUES ('22222222-2222-2222-2222-222222222222', 'Test Tenant')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.organization_members (user_id, tenant_id, role)
VALUES ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'admin')
ON CONFLICT (user_id, tenant_id) DO NOTHING;