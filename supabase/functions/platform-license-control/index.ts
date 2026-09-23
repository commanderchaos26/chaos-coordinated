import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await callerClient.auth.getUser();
  const caller = userData?.user;
  if (userError || !caller) return json({ error: "unauthorized" }, 401);

  const { data: platformOwner } = await admin
    .from("platform_owner_grants")
    .select("user_id,enabled")
    .eq("user_id", caller.id)
    .eq("enabled", true)
    .maybeSingle();
  if (!platformOwner) return json({ error: "platform_owner_required" }, 403);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const companyId = String(body.company_id ?? "");
  const action = String(body.action ?? "status");
  if (!companyId) return json({ error: "company_id_required" }, 400);

  const { data: company, error: companyError } = await admin
    .from("companies")
    .select("id,name,status,suspended_at,suspended_by_user_id,suspension_reason")
    .eq("id", companyId)
    .maybeSingle();
  if (companyError) return json({ error: "company_lookup_failed", detail: companyError.message }, 500);
  if (!company) return json({ error: "company_not_found" }, 404);

  if (action === "status") {
    return json({
      ok: true,
      authorized: true,
      company: {
        id: company.id,
        name: company.name,
        status: company.status,
        suspended_at: company.suspended_at,
        suspension_reason: company.suspension_reason,
      },
    });
  }

  if (action !== "set_status") return json({ error: "unsupported_action" }, 400);

  const nextStatus = String(body.status ?? "");
  if (!["active", "suspended"].includes(nextStatus)) {
    return json({ error: "invalid_status" }, 400);
  }

  const reason = String(body.reason ?? "").trim();
  if (nextStatus === "suspended" && !reason) {
    return json({ error: "suspension_reason_required" }, 400);
  }

  const beforeStatus = String(company.status);
  if (beforeStatus === nextStatus) {
    return json({
      ok: true,
      idempotent: true,
      company: {
        id: company.id,
        name: company.name,
        status: company.status,
        suspended_at: company.suspended_at,
        suspension_reason: company.suspension_reason,
      },
    });
  }

  const patch = nextStatus === "suspended"
    ? {
        status: "suspended",
        suspended_at: new Date().toISOString(),
        suspended_by_user_id: caller.id,
        suspension_reason: reason,
        updated_at: new Date().toISOString(),
      }
    : {
        status: "active",
        suspended_at: null,
        suspended_by_user_id: null,
        suspension_reason: null,
        updated_at: new Date().toISOString(),
      };

  const { data: updated, error: updateError } = await admin
    .from("companies")
    .update(patch)
    .eq("id", companyId)
    .select("id,name,status,suspended_at,suspension_reason")
    .single();
  if (updateError) return json({ error: "status_update_failed", detail: updateError.message }, 500);

  await admin.from("platform_license_events").insert({
    company_id: companyId,
    actor_user_id: caller.id,
    from_status: beforeStatus,
    to_status: nextStatus,
    reason: nextStatus === "suspended" ? reason : (reason || "Reactivated by platform owner"),
  });

  const { data: callerLink } = await admin
    .from("employee_account_links")
    .select("employee_id")
    .eq("company_id", companyId)
    .eq("user_id", caller.id)
    .eq("status", "active")
    .maybeSingle();

  await admin.from("audit_events").insert({
    company_id: companyId,
    actor_user_id: caller.id,
    actor_employee_id: callerLink?.employee_id ?? null,
    action: nextStatus === "suspended" ? "company.suspended" : "company.reactivated",
    entity_type: "company",
    entity_id: companyId,
    before_data: { status: beforeStatus },
    after_data: { status: nextStatus, reason: nextStatus === "suspended" ? reason : null },
  });

  return json({ ok: true, idempotent: false, company: updated });
});
