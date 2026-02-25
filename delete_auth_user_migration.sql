-- ============================================
-- Migration: Admin function to delete auth users
-- Allows proper user deletion from client app
-- ============================================

-- RPC function to delete auth user (SECURITY DEFINER = runs with DB owner privileges)
CREATE OR REPLACE FUNCTION delete_auth_user(target_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Delete from auth.users (cascades to related auth tables)
  DELETE FROM auth.users WHERE id = target_user_id;
END;
$$;

-- Revoke public access, grant only to authenticated users
-- (app-level role check happens in JS before calling this)
REVOKE ALL ON FUNCTION delete_auth_user(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delete_auth_user(UUID) TO authenticated;

-- ============================================
-- IMMEDIATE FIX: Delete orphaned auth user
-- so it can be re-created via admin panel
-- ============================================
DELETE FROM auth.users WHERE id = 'd057443e-bc7f-418a-b781-d8ca4315c9f2';
