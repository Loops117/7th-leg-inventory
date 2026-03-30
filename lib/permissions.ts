import { supabase } from "@/lib/supabaseClient";

const cache = new Map<string, { isSuperAdmin: boolean; permissionCodes: string[] }>();

export async function getCurrentUserPermissions(companyId: string | null): Promise<{
  isSuperAdmin: boolean;
  permissionCodes: string[];
}> {
  const key = companyId ?? "__none__";
  if (cache.has(key)) return cache.get(key)!;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    const result = { isSuperAdmin: false, permissionCodes: [] };
    cache.set(key, result);
    return result;
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_super_admin")
    .eq("id", user.id)
    .single();
  const isSuperAdmin = profile?.is_super_admin === true;
  if (isSuperAdmin) {
    const result = { isSuperAdmin: true, permissionCodes: ["*"] };
    cache.set(key, result);
    return result;
  }
  if (!companyId) {
    const result = { isSuperAdmin: false, permissionCodes: [] };
    cache.set(key, result);
    return result;
  }
  const { data: membership } = await supabase
    .from("company_memberships")
    .select("id")
    .eq("user_id", user.id)
    .eq("company_id", companyId)
    .eq("is_active", true)
    .single();
  if (!membership) {
    const result = { isSuperAdmin: false, permissionCodes: [] };
    cache.set(key, result);
    return result;
  }
  const { data: roleLinks } = await supabase
    .from("user_company_roles")
    .select("role_id")
    .eq("membership_id", membership.id);
  const roleIds = (roleLinks ?? []).map((r) => r.role_id);
  if (roleIds.length === 0) {
    const result = { isSuperAdmin: false, permissionCodes: [] };
    cache.set(key, result);
    return result;
  }
  const { data: permLinks } = await supabase
    .from("role_permissions")
    .select("permission_id")
    .in("role_id", roleIds);
  const permIds = [...new Set((permLinks ?? []).map((p) => p.permission_id))];
  if (permIds.length === 0) {
    const result = { isSuperAdmin: false, permissionCodes: [] };
    cache.set(key, result);
    return result;
  }
  const { data: perms } = await supabase
    .from("permissions")
    .select("code")
    .in("id", permIds);
  const permissionCodes = (perms ?? []).map((p) => p.code);
  const result = { isSuperAdmin: false, permissionCodes };
  cache.set(key, result);
  return result;
}

export function clearPermissionsCache() {
  cache.clear();
}

export function hasPermission(
  permissionCodes: string[],
  code: string
): boolean {
  if (permissionCodes.includes("*")) return true;
  return permissionCodes.includes(code);
}
