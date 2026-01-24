-- Fix infinite recursion in organization_members policy
-- Previous policy caused infinite recursion because it queried organization_members within the policy check
-- The fix is to use the security definer function `is_tenant_member` which bypasses RLS

drop policy "Users can view members in their tenants" on organization_members;

create policy "Users can view members in their tenants"
  on organization_members for select
  using (
    -- View own record
    user_id = auth.uid() 
    or
    -- View members of tenants I belong to (using security definer to break recursion)
    is_tenant_member(tenant_id)
  );
