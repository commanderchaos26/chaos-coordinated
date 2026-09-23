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

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const companyId = String(body.company_id ?? "");
  const action = String(body.action ?? "status");
  if (!companyId) return json({ error: "company_id_required" }, 400);

  const { data: company } = await admin
    .from("companies")
    .select("id,status")
    .eq("id", companyId)
    .maybeSingle();
  if (!company) return json({ error: "company_not_found" }, 404);

  const { data: callerLink } = await admin
    .from("employee_account_links")
    .select("employee_id")
    .eq("company_id", companyId)
    .eq("user_id", caller.id)
    .eq("status", "active")
    .maybeSingle();
  if (!callerLink) return json({ error: "not_a_company_member" }, 403);

  const { data: roles } = await admin
    .from("role_grants")
    .select("role")
    .eq("company_id", companyId)
    .eq("employee_id", callerLink.employee_id)
    .is("revoked_at", null);
  if (!(roles ?? []).some((row: any) => row.role === "owner")) {
    return json({ error: "owner_required" }, 403);
  }

  if (action === "status") {
    const { data: accounts, error } = await admin
      .from("platform_test_accounts")
      .select("id,employee_id,auth_user_id,email,label,active,created_at,retired_at")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });
    if (error) {
      console.error("test_account_lookup_failed", error);
      return json({ error: "test_account_lookup_failed" }, 500);
    }
    return json({ ok: true, company_status: company.status, accounts: accounts ?? [] });
  }

  if (company.status !== "active") return json({ error: "company_suspended" }, 423);

  if (action === "provision_technician") {
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const label = String(body.label ?? "QA Technician").trim() || "QA Technician";
    if (!email.includes("@")) return json({ error: "invalid_email" }, 400);
    if (password.length < 10) return json({ error: "password_too_short" }, 400);

    const { data: existing } = await admin
      .from("platform_test_accounts")
      .select("*")
      .eq("company_id", companyId)
      .eq("email", email)
      .maybeSingle();

    if (existing?.active) {
      const { error: authUpdateError } = await admin.auth.admin.updateUserById(existing.auth_user_id, {
        password,
        email_confirm: true,
      });
      if (authUpdateError) {
        console.error("test_password_reset_failed", authUpdateError);
        return json({ error: "test_password_reset_failed" }, 400);
      }
      return json({ ok: true, idempotent: true, account: existing });
    }
    if (existing && !existing.active) {
      return json({ error: "retired_test_email_use_another_address" }, 409);
    }

    const { data: authCreated, error: authError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { qa_test_account: true },
    });
    if (authError || !authCreated.user) {
      console.error("auth_user_create_failed", authError ?? "No user returned");
      return json({ error: "auth_user_create_failed" }, 400);
    }

    const authUserId = authCreated.user.id;
    let employeeId: string | null = null;

    try {
      const { data: employee, error: employeeError } = await admin
        .from("employees")
        .insert({
          company_id: companyId,
          display_name: label,
          employment_status: "active",
          floater_eligible: true,
          start_date: new Date().toISOString().slice(0, 10),
        })
        .select("id")
        .single();
      if (employeeError) throw employeeError;
      employeeId = employee.id;

      const { error: linkError } = await admin.from("employee_account_links").insert({
        company_id: companyId,
        employee_id: employeeId,
        user_id: authUserId,
        intended_email: email,
        status: "active",
        linked_at: new Date().toISOString(),
      });
      if (linkError) throw linkError;

      const { error: roleError } = await admin.from("role_grants").insert({
        company_id: companyId,
        employee_id: employeeId,
        role: "technician",
        granted_by: callerLink.employee_id,
        reason: "QA test technician",
      });
      if (roleError) throw roleError;

      const { data: account, error: accountError } = await admin
        .from("platform_test_accounts")
        .insert({
          company_id: companyId,
          employee_id: employeeId,
          auth_user_id: authUserId,
          email,
          label,
          active: true,
          created_by_user_id: caller.id,
        })
        .select("*")
        .single();
      if (accountError) throw accountError;

      await admin.from("audit_events").insert({
        company_id: companyId,
        actor_user_id: caller.id,
        actor_employee_id: callerLink.employee_id,
        action: "qa.test_account_created",
        entity_type: "employee",
        entity_id: employeeId,
        after_data: { email, label, role: "technician" },
      });

      return json({ ok: true, idempotent: false, account }, 201);
    } catch (error) {
      await admin.auth.admin.deleteUser(authUserId).catch(() => undefined);
      console.error("test_account_create_failed", error);
      return json({ error: "test_account_create_failed", employee_id: employeeId }, 400);
    }
  }

  const testAccountId = String(body.test_account_id ?? "");
  if (!testAccountId) return json({ error: "test_account_id_required" }, 400);

  if (action === "seed_flow") {
    const { data, error } = await admin.rpc("platform_seed_test_flow", {
      p_company_id: companyId,
      p_test_account_id: testAccountId,
      p_created_by_employee_id: callerLink.employee_id,
    });
    if (error) {
      console.error("test_flow_seed_failed", error);
      return json({ error: "test_flow_seed_failed" }, 400);
    }
    return json(data ?? { ok: true });
  }

  if (action === "retire_account") {
    const { data: account } = await admin
      .from("platform_test_accounts")
      .select("auth_user_id")
      .eq("company_id", companyId)
      .eq("id", testAccountId)
      .maybeSingle();
    if (!account) return json({ error: "test_account_not_found" }, 404);

    const { data, error } = await admin.rpc("platform_retire_test_account", {
      p_company_id: companyId,
      p_test_account_id: testAccountId,
    });
    if (error) {
      console.error("test_account_retire_failed", error);
      return json({ error: "test_account_retire_failed" }, 400);
    }

    const { error: deleteError } = await admin.auth.admin.deleteUser(account.auth_user_id);
    return json({
      ...(data ?? { ok: true }),
      auth_user_deleted: !deleteError,
    });
  }

  return json({ error: "unsupported_action" }, 400);
});
