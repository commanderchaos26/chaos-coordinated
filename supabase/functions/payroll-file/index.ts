import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "missing_authorization" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const publishableKeys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}");
  const publicKey = publishableKeys.default ?? Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const token = authHeader.replace(/^Bearer\s+/i, "");
  const userClient = createClient(supabaseUrl, publicKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData.user) return json({ error: "invalid_user_session" }, 401);

    const body = await req.json();
    const exportId = String(body?.export_id ?? "");
    if (!exportId) return json({ error: "export_id_required" }, 400);

    const { data: payrollExport, error: exportError } = await adminClient
      .from("payroll_exports")
      .select("id,company_id,employee_id,week_start,file_name,content,total_hours")
      .eq("id", exportId)
      .maybeSingle();

    if (exportError) throw exportError;
    if (!payrollExport) return json({ error: "payroll_export_not_found" }, 404);

    const { data: link, error: linkError } = await adminClient
      .from("employee_account_links")
      .select("employee_id")
      .eq("company_id", payrollExport.company_id)
      .eq("user_id", userData.user.id)
      .eq("status", "active")
      .maybeSingle();

    if (linkError) throw linkError;
    if (!link?.employee_id) return json({ error: "not_a_company_member" }, 403);

    const { data: roles, error: rolesError } = await adminClient
      .from("role_grants")
      .select("role")
      .eq("company_id", payrollExport.company_id)
      .eq("employee_id", link.employee_id)
      .is("revoked_at", null);

    if (rolesError) throw rolesError;
    const allowed = (roles ?? []).some((row: any) => ["owner","operations_manager"].includes(row.role));
    if (!allowed) return json({ error: "insufficient_permission" }, 403);

    const safeFileName = String(payrollExport.file_name || "payroll.txt").replace(/[^A-Za-z0-9 _.-]/g, "");
    const path = `${payrollExport.company_id}/${payrollExport.week_start}/${payrollExport.employee_id}/${safeFileName}`;

    const blob = new Blob([payrollExport.content], { type: "text/plain;charset=utf-8" });
    const { error: uploadError } = await adminClient.storage
      .from("payroll-exports")
      .upload(path, blob, { contentType: "text/plain;charset=utf-8", upsert: true });

    if (uploadError) throw uploadError;

    const { data: signed, error: signedError } = await adminClient.storage
      .from("payroll-exports")
      .createSignedUrl(path, 600, { download: safeFileName });

    if (signedError || !signed?.signedUrl) throw signedError ?? new Error("Could not create payroll download link.");

    return json({
      ok: true,
      file_name: safeFileName,
      total_hours: payrollExport.total_hours,
      signed_url: signed.signedUrl,
      expires_in: 600,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not prepare payroll file.";
    return json({ error: "payroll_file_failed", message }, 500);
  }
});
