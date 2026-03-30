import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabaseServiceRole";

type Body = {
  companyId: string;
  email: string;
  mode: "invite_email" | "set_password";
  /** Required when mode is set_password */
  password?: string;
  /** When true, user can sign in without confirming email (admin-created accounts). */
  skipEmailVerification?: boolean;
  roleIds?: string[];
};

function getSiteUrl(request: Request): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  const vercel = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null;
  if (vercel) return vercel;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? "http";
  if (host) return `${proto}://${host}`;
  return "http://localhost:3000";
}

async function assertCallerCanManageCompanyInvites(
  accessToken: string,
  companyId: string
): Promise<{ userId: string } | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;

  const authed = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: got, error } = await authed.auth.getUser(accessToken);
  if (error || !got.user) return null;

  const admin = createServiceRoleClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("is_super_admin")
    .eq("id", got.user.id)
    .maybeSingle();
  if (profile?.is_super_admin === true) return { userId: got.user.id };

  const { data: mem } = await admin
    .from("company_memberships")
    .select("id")
    .eq("user_id", got.user.id)
    .eq("company_id", companyId)
    .eq("is_active", true)
    .maybeSingle();
  if (!mem) return null;
  return { userId: got.user.id };
}

async function validateRoleIdsForCompany(
  admin: ReturnType<typeof createServiceRoleClient>,
  companyId: string,
  roleIds: string[]
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data: roles, error } = await admin
    .from("roles")
    .select("id, company_id")
    .in("id", roleIds)
    .eq("is_active", true);
  if (error) return { ok: false, message: error.message };
  if (!roles || roles.length !== roleIds.length) {
    return { ok: false, message: "One or more role IDs are invalid or inactive." };
  }
  for (const r of roles) {
    if (r.company_id != null && r.company_id !== companyId) {
      return { ok: false, message: "Roles must belong to this company or be global templates." };
    }
  }
  return { ok: true };
}

async function ensureMembershipAndRoles(
  admin: ReturnType<typeof createServiceRoleClient>,
  userId: string,
  companyId: string,
  roleIds: string[] | undefined
) {
  const { data: existing } = await admin
    .from("company_memberships")
    .select("id, is_active")
    .eq("user_id", userId)
    .eq("company_id", companyId)
    .maybeSingle();

  let membershipId: string;
  if (existing) {
    membershipId = existing.id;
    if (!existing.is_active) {
      await admin.from("company_memberships").update({ is_active: true }).eq("id", membershipId);
    }
  } else {
    const { data: inserted, error } = await admin
      .from("company_memberships")
      .insert({
        user_id: userId,
        company_id: companyId,
        is_active: true,
        default_company: false,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    membershipId = inserted!.id;
  }

  if (roleIds && roleIds.length > 0) {
    await admin.from("user_company_roles").delete().eq("membership_id", membershipId);
    await admin.from("user_company_roles").insert(
      roleIds.map((role_id) => ({ membership_id: membershipId, role_id }))
    );
  }
}

async function profileIdByEmail(
  admin: ReturnType<typeof createServiceRoleClient>,
  email: string
): Promise<string | null> {
  const { data } = await admin.from("profiles").select("id").ilike("email", email).maybeSingle();
  return data?.id ?? null;
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { companyId, email, mode, password, skipEmailVerification, roleIds } = body;
  if (!companyId || !email?.trim()) {
    return NextResponse.json({ error: "companyId and email are required" }, { status: 400 });
  }
  if (mode !== "invite_email" && mode !== "set_password") {
    return NextResponse.json({ error: "mode must be invite_email or set_password" }, { status: 400 });
  }
  if (mode === "set_password" && (!password || password.length < 6)) {
    return NextResponse.json(
      { error: "password is required and must be at least 6 characters for set_password mode" },
      { status: 400 }
    );
  }

  const authHeader = request.headers.get("authorization");
  const accessToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!accessToken) {
    return NextResponse.json({ error: "Missing Authorization Bearer token" }, { status: 401 });
  }

  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Server misconfiguration";
    return NextResponse.json(
      {
        error: `${msg}. Add SUPABASE_SERVICE_ROLE_KEY to your environment (server-only, never expose to the client).`,
      },
      { status: 503 }
    );
  }

  const caller = await assertCallerCanManageCompanyInvites(accessToken, companyId);
  if (!caller) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (roleIds && roleIds.length > 0) {
    const v = await validateRoleIdsForCompany(admin, companyId, roleIds);
    if (!v.ok) return NextResponse.json({ error: v.message }, { status: 400 });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const siteUrl = getSiteUrl(request);
  const redirectTo = `${siteUrl}/auth/callback`;

  try {
    if (mode === "invite_email") {
      const { data: invited, error: invErr } = await admin.auth.admin.inviteUserByEmail(
        normalizedEmail,
        { redirectTo }
      );

      if (invErr) {
        const msg = invErr.message?.toLowerCase() ?? "";
        if (msg.includes("already been registered") || msg.includes("already registered")) {
          const existingId = await profileIdByEmail(admin, normalizedEmail);
          if (!existingId) {
            return NextResponse.json(
              { error: "User exists but profile not found; contact support." },
              { status: 409 }
            );
          }
          await ensureMembershipAndRoles(admin, existingId, companyId, roleIds);
          return NextResponse.json({
            ok: true,
            message: "User already had an account; added to this company.",
            userId: existingId,
          });
        }
        return NextResponse.json({ error: invErr.message }, { status: 400 });
      }

      const userId = invited.user.id;
      await ensureMembershipAndRoles(admin, userId, companyId, roleIds);
      return NextResponse.json({
        ok: true,
        message: "Invite email sent. They can set a password from the link.",
        userId,
      });
    }

    const confirm = skipEmailVerification !== false;
    const { data: created, error: crErr } = await admin.auth.admin.createUser({
      email: normalizedEmail,
      password: password!,
      email_confirm: confirm,
    });

    if (crErr) {
      const msg = crErr.message?.toLowerCase() ?? "";
      if (msg.includes("already been registered") || msg.includes("already registered")) {
        const existingId = await profileIdByEmail(admin, normalizedEmail);
        if (!existingId) {
          return NextResponse.json({ error: crErr.message }, { status: 400 });
        }
        await ensureMembershipAndRoles(admin, existingId, companyId, roleIds);
        if (password && password.length >= 6) {
          await admin.auth.admin.updateUserById(existingId, {
            password,
            email_confirm: confirm,
          });
        }
        return NextResponse.json({
          ok: true,
          message: "User already existed; updated password/confirmation if allowed and added to company.",
          userId: existingId,
        });
      }
      return NextResponse.json({ error: crErr.message }, { status: 400 });
    }

    const userId = created.user.id;
    await ensureMembershipAndRoles(admin, userId, companyId, roleIds);
    return NextResponse.json({
      ok: true,
      message: confirm
        ? "User created; they can log in with the password you set."
        : "User created; they must confirm email before signing in.",
      userId,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
