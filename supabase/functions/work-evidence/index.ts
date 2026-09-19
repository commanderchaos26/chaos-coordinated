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

const allowedMime = new Set(["image/jpeg", "image/png", "image/webp"]);

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
    const action = String(body?.action ?? "");
    const companyId = String(body?.company_id ?? "");
    const assignmentId = String(body?.assignment_id ?? "");
    const workOrderId = String(body?.work_order_id ?? "");
    if (!companyId || !assignmentId || !workOrderId) return json({ error: "company_assignment_work_order_required" }, 400);

    const { data: link } = await adminClient
      .from("employee_account_links")
      .select("employee_id")
      .eq("company_id", companyId)
      .eq("user_id", userData.user.id)
      .eq("status", "active")
      .maybeSingle();
    if (!link?.employee_id) return json({ error: "not_a_company_member" }, 403);

    const [{ data: assignment }, { data: roles }] = await Promise.all([
      adminClient.from("assignments").select("id,employee_id,work_order_id,status").eq("company_id", companyId).eq("id", assignmentId).maybeSingle(),
      adminClient.from("role_grants").select("role").eq("company_id", companyId).eq("employee_id", link.employee_id).is("revoked_at", null),
    ]);
    if (!assignment || assignment.work_order_id !== workOrderId) return json({ error: "assignment_not_found" }, 404);

    const management = (roles ?? []).some((row: any) => ["owner","operations_manager","supervisor","dispatcher"].includes(row.role));
    if (assignment.employee_id !== link.employee_id && !management) return json({ error: "insufficient_permission" }, 403);

    if (action === "prepare_upload") {
      const mimeType = String(body?.mime_type ?? "image/jpeg").toLowerCase();
      if (!allowedMime.has(mimeType)) return json({ error: "unsupported_media_type" }, 400);
      const extension = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
      const filename = `${crypto.randomUUID()}.${extension}`;
      const path = `${companyId}/work-orders/${workOrderId}/${filename}`;
      const { data, error } = await adminClient.storage.from("work-evidence").createSignedUploadUrl(path);
      if (error || !data?.token) throw error ?? new Error("Could not create upload token.");
      return json({ ok: true, bucket: "work-evidence", path, token: data.token });
    }

    if (action === "register_upload") {
      const path = String(body?.storage_path ?? "");
      const mimeType = String(body?.mime_type ?? "image/jpeg").toLowerCase();
      const byteSize = Number(body?.byte_size ?? 0);
      const expectedPrefix = `${companyId}/work-orders/${workOrderId}/`;
      if (!path.startsWith(expectedPrefix)) return json({ error: "invalid_storage_path" }, 400);
      if (!allowedMime.has(mimeType)) return json({ error: "unsupported_media_type" }, 400);

      const slash = path.lastIndexOf("/");
      const folder = path.slice(0, slash);
      const fileName = path.slice(slash + 1);
      const { data: objects, error: listError } = await adminClient.storage.from("work-evidence").list(folder, { search: fileName, limit: 10 });
      if (listError) throw listError;
      const uploaded = (objects ?? []).find((item: any) => item.name === fileName);
      if (!uploaded) return json({ error: "uploaded_file_not_found" }, 400);

      const effectiveSize = Number(uploaded?.metadata?.size ?? byteSize ?? 0);
      const { data: evidence, error: evidenceError } = await adminClient
        .from("evidence_files")
        .insert({
          company_id: companyId,
          storage_bucket: "work-evidence",
          storage_path: path,
          media_type: "photo",
          mime_type: mimeType,
          byte_size: Number.isFinite(effectiveSize) && effectiveSize > 0 ? effectiveSize : null,
          captured_by: link.employee_id,
          captured_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (evidenceError || !evidence) throw evidenceError ?? new Error("Could not record evidence.");

      const { error: linksError } = await adminClient.from("evidence_links").insert([
        {
          company_id: companyId,
          evidence_file_id: evidence.id,
          entity_type: "work_order",
          entity_id: workOrderId,
          purpose: "completion",
          created_by: link.employee_id,
        },
        {
          company_id: companyId,
          evidence_file_id: evidence.id,
          entity_type: "assignment",
          entity_id: assignmentId,
          purpose: "completion",
          created_by: link.employee_id,
        },
      ]);
      if (linksError) throw linksError;

      await adminClient.from("audit_events").insert({
        company_id: companyId,
        actor_user_id: userData.user.id,
        actor_employee_id: link.employee_id,
        action: "work_order.completion_evidence_added",
        entity_type: "work_order",
        entity_id: workOrderId,
        after_data: { evidence_file_id: evidence.id, assignment_id: assignmentId, storage_path: path },
      });

      return json({ ok: true, evidence_file_id: evidence.id });
    }

    return json({ error: "unsupported_action" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Evidence upload failed.";
    return json({ error: "work_evidence_failed", message }, 500);
  }
});
