/** Global role name that only `profiles.is_super_admin` users may assign or remove. */
export function isRestrictedSuperAdminRoleName(name: string): boolean {
  return name.trim().toLowerCase() === "super admin";
}
