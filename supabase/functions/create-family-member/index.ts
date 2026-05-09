// Rush HQ — create-family-member edge function
// ==============================================
// One-stop server endpoint that the Admin page calls when a parent
// adds a member. The function:
//
//   1. Verifies the caller is signed in AND has role = 'parent' in
//      family_members. (RLS already enforces this on the table writes
//      below, but we want to fail loudly here rather than letting an
//      unauthenticated POST waste an invite-email send.)
//   2. Validates the payload.
//   3. If `email` + `invite` is set: creates the auth user via
//      supabase.auth.admin.inviteUserByEmail. Resend (configured as
//      Supabase custom SMTP) delivers the invite. The redirect lands
//      on /reset-password where the user sets their own password.
//   4. If `email` only (no invite): creates the auth user with a
//      preset password (the caller passes it in `password`). Useful
//      for testing.
//   5. If neither: just inserts a family_members row with no auth_user_id.
//      Useful for kids without sign-ins.
//   6. Inserts the family_members row and links auth_user_id.
//
// Returns: { id: <new family_members.id>, auth_user_id?: ... }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";

interface CreatePayload {
  short_name: string;
  full_name: string;
  email?: string;
  role: "parent" | "helper" | "child";
  member_type: "parent" | "helper" | "child";
  /** When true and `email` is set, sends an invite email instead of
   *  using a preset password. */
  invite?: boolean;
  /** Used when `invite` is false. */
  password?: string;
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_URL = Deno.env.get("APP_URL") ?? "https://rushhq.co";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (req.method !== "POST") {
    return jsonRes({ error: "Method not allowed" }, 405);
  }

  // 1. Verify caller is a signed-in parent.
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) {
    return jsonRes({ error: "Missing bearer token" }, 401);
  }

  // Validate the caller's JWT. `auth.getUser()` no longer reads the
  // Authorization header automatically in @supabase/auth-js@2.70+; pass
  // the token in directly.
  const jwt = auth.replace(/^Bearer\s+/i, "").trim();
  const userClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const { data: who, error: whoErr } = await userClient.auth.getUser(jwt);
  if (whoErr || !who?.user) {
    console.error("[create-family-member] auth.getUser failed:", whoErr);
    return jsonRes(
      {
        error: "Invalid token",
        detail: whoErr?.message ?? "no user",
      },
      401,
    );
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: caller, error: callerErr } = await admin
    .from("family_members")
    .select("id, role")
    .eq("auth_user_id", who.user.id)
    .maybeSingle();
  if (callerErr) {
    return jsonRes({ error: "Caller lookup failed: " + callerErr.message }, 500);
  }
  if (!caller || caller.role !== "parent") {
    return jsonRes({ error: "Only parents can add members" }, 403);
  }

  // 2. Parse + validate payload.
  let body: CreatePayload;
  try {
    body = (await req.json()) as CreatePayload;
  } catch {
    return jsonRes({ error: "Invalid JSON body" }, 400);
  }

  const shortName = (body.short_name ?? "").trim();
  const fullName = (body.full_name ?? "").trim();
  const email = (body.email ?? "").trim().toLowerCase();
  const role = body.role;
  const memberType = body.member_type;
  const invite = !!body.invite;
  const password = (body.password ?? "").trim();

  if (!shortName || shortName.length > 40) {
    return jsonRes({ error: "Short name is required (max 40 chars)" }, 400);
  }
  if (!fullName || fullName.length > 120) {
    return jsonRes({ error: "Full name is required (max 120 chars)" }, 400);
  }
  if (!["parent", "helper", "child"].includes(role)) {
    return jsonRes({ error: "Invalid role" }, 400);
  }
  if (!["parent", "helper", "child"].includes(memberType)) {
    return jsonRes({ error: "Invalid member type" }, 400);
  }
  if (email && !/.+@.+\..+/.test(email)) {
    return jsonRes({ error: "Invalid email address" }, 400);
  }
  if (email && !invite && password.length < 10) {
    return jsonRes({ error: "Password must be at least 10 characters" }, 400);
  }

  // 3. Optionally create the auth user.
  let authUserId: string | null = null;
  if (email) {
    if (invite) {
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${APP_URL}/reset-password`,
        data: { short_name: shortName, full_name: fullName },
      });
      if (error || !data?.user) {
        return jsonRes(
          { error: "Could not send invite: " + (error?.message ?? "unknown") },
          400,
        );
      }
      authUserId = data.user.id;
    } else {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { short_name: shortName, full_name: fullName },
      });
      if (error || !data?.user) {
        return jsonRes(
          { error: "Could not create auth user: " + (error?.message ?? "unknown") },
          400,
        );
      }
      authUserId = data.user.id;
    }
  }

  // 4. Insert family_members row.
  const { data: inserted, error: insertErr } = await admin
    .from("family_members")
    .insert({
      auth_user_id: authUserId,
      short_name: shortName,
      full_name: fullName,
      email: email || null,
      role,
      member_type: memberType,
      active: true,
    })
    .select("id, auth_user_id")
    .single();

  if (insertErr || !inserted) {
    // If we created an auth user but the family_members insert blew up,
    // delete the auth user so we don't leave orphans behind.
    if (authUserId) {
      await admin.auth.admin.deleteUser(authUserId).catch(() => {});
    }
    return jsonRes(
      { error: "Could not insert family member: " + (insertErr?.message ?? "unknown") },
      500,
    );
  }

  return jsonRes({
    id: inserted.id,
    auth_user_id: inserted.auth_user_id,
    invited: invite && !!email,
  });
});
