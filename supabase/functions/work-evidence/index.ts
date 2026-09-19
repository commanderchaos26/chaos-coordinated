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
const sha256Pattern = /^[a-f0-9]{64}$/;

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

    if (action === "list_completion") {
      const { data: links, error: linksError } = await adminClient
        .from("evidence_links")
        .select("evidence_file_id")
        .eq("company_id", companyId)
        .eq("entity_type", "assignment")
        .eq("entity_id", assignmentId)
        .eq("purpose", "completion");
      if (linksError) throw linksError;

      const ids = [...new Set((links ?? []).map((row: any) => row.evidence_file_id).filter(Boolean))];
      if (!ids.length) return json({ ok: true, evidence: [] });

      const { data: files, error: filesError } = await adminClient
        .from("evidence_files")
        .select("id,storage_bucket,storage_path,mime_type,byte_size,captured_at")
        .eq("company_id", companyId)
        .in("id", ids)
        .order("captured_at", { ascending: false });
      if (filesError) throw filesError;

      const evidence = [];
      for (const file of files ?? []) {
        const { data: signed, error: signedError } = await adminClient.storage
          .from(file.storage_bucket)
          .createSignedUrl(file.storage_path, 900);
        if (signedError || !signed?.signedUrl) throw signedError ?? new Error("Could not create evidence read link.");
        evidence.push({
          id: file.id,
          signedUrl: signed.signedUrl,
          mimeType: file.mime_type,
          byteSize: file.byte_size,
          capturedAt: file.captured_at,
        });
      }

      return json({ ok: true, evidence });
    }

    if (action === "prepare_upload" && !["active", "paused"].includes(String(assignment.status))) {
      return json({
        error: "assignment_not_ready_for_completion_evidence",
        message: "Start this assignment before adding completion evidence.",
      }, 409);
    }

    // A registration request can arrive after the assignment completion request wins a race.
    // Allow registration of an already-prepared object, but never allow preparing a new upload after completion.
    if (action === "register_upload" && !["active", "paused", "submitted", "completed"].includes(String(assignment.status))) {
      return json({
        error: "assignment_not_ready_for_completion_evidence",
        message: "This assignment is not in a state that can accept completion evidence.",
      }, 409);
    }

    if (action === "prepare_upload") {
      const mimeType = String(body?.mime_type ?? "image/jpeg").toLowerCase();
      if (!allowedMime.has(mimeType)) return json({ error: "unsupported_media_type" }, 400);
      const extension = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
      const suppliedHash = String(body?.sha256 ?? "").toLowerCase();
      const sha256 = sha256Pattern.test(suppliedHash) ? suppliedHash : null;

      // New clients send a content hash. The deterministic path makes a retry of the same
      // photo resolve to the same storage/evidence record. Older clients remain supported.
      const filename = sha256 ? `${sha256}.${extension}` : `${crypto.randomUUID()}.${extension}`;
      const folder = sha256
        ? `${companyId}/work-orders/${workOrderId}/${assignmentId}`
        : `${companyId}/work-orders/${workOrderId}`;
      const path = `${folder}/${filename}`;

      if (sha256) {
        const { data: existingEvidence, error: existingError } = await adminClient
          .from("evidence_files")
          .select("id")
          .eq("storage_bucket", "work-evidence")
          .eq("storage_path", path)
          .maybeSingle();
        if (existingError) throw existingError;
        if (existingEvidence?.id) {
          return json({
            ok: true,
            bucket: "work-evidence",
            path,
            token: null,
            upload_required: false,
            already_registered: true,
            evidence_file_id: existingEvidence.id,
          });
        }

        const { data: objects, error: listError } = await adminClient.storage
          .from("work-evidence")
          .list(folder, { search: filename, limit: 10 });
        if (listError) throw listError;
        if ((objects ?? []).some((item: any) => item.name === filename)) {
          return json({
            ok: true,
            bucket: "work-evidence",
            path,
            token: null,
            upload_required: false,
            already_registered: false,
            evidence_file_id: null,
          });
        }
      }

      const { data, error } = await adminClient.storage.from("work-evidence").createSignedUploadUrl(path);
      if (error || !data?.token) throw error ?? new Error("Could not create upload token.");
      return json({
        ok: true,
        bucket: "work-evidence",
        path,
        token: data.token,
        upload_required: true,
        already_registered: false,
        evidence_file_id: null,
      });
    }

    if (action === "register_upload") {
      const path = String(body?.storage_path ?? "");
      const mimeType = String(body?.mime_type ?? "image/jpeg").toLowerCase();
      const byteSize = Number(body?.byte_size ?? 0);
      const suppliedHash = String(body?.sha256 ?? "").toLowerCase();
      const sha256 = sha256Pattern.test(suppliedHash) ? suppliedHash : null;
      const expectedPrefix = `${companyId}/work-orders/${workOrderId}/`;
      if (!path.startsWith(expectedPrefix)) return json({ error: "invalid_storage_path" }, 400);
      if (!allowedMime.has(mimeType)) return json({ error: "unsupported_media_type" }, 400);

      let { data: evidence, error: existingEvidenceError } = await adminClient
        .from("evidence_files")
        .select("id")
        .eq("storage_bucket", "work-evidence")
        .eq("storage_path", path)
        .maybeSingle();
      if (existingEvidenceError) throw existingEvidenceError;

      let createdEvidence = false;
      if (!evidence) {
        const slash = path.lastIndexOf("/");
        const folder = path.slice(0, slash);
        const fileName = path.slice(slash + 1);
        const { data: objects, error: listError } = await adminClient.storage.from("work-evidence").list(folder, { search: fileName, limit: 10 });
        if (listError) throw listError;
        const uploaded = (objects ?? []).find((item: any) => item.name === fileName);
        if (!uploaded) return json({ error: "uploaded_file_not_found" }, 400);

        const effectiveSize = Number(uploaded?.metadata?.size ?? byteSize ?? 0);
        const { data: created, error: evidenceError } = await adminClient
          .from("evidence_files")
          .insert({
            company_id: companyId,
            storage_bucket: "work-evidence",
            storage_path: path,
            media_type: "photo",
            mime_type: mimeType,
            byte_size: Number.isFinite(effectiveSize) && effectiveSize > 0 ? effectiveSize : null,
            sha256,
            captured_by: link.employee_id,
            captured_at: new Date().toISOString(),
          })
          .select("id")
          .single();
        if (evidenceError || !created) throw evidenceError ?? new Error("Could not record evidence.");
        evidence = created;
        createdEvidence = true;
      }

      const { error: linksError } = await adminClient.from("evidence_links").upsert([
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
      ], { onConflict: "evidence_file_id,entity_type,entity_id" });
      if (linksError) throw linksError;

      if (createdEvidence) {
        await adminClient.from("audit_events").insert({
          company_id: companyId,
          actor_user_id: userData.user.id,
          actor_employee_id: link.employee_id,
          action: "work_order.completion_evidence_added",
          entity_type: "work_order",
          entity_id: workOrderId,
          after_data: { evidence_file_id: evidence.id, assignment_id: assignmentId, storage_path: path, sha256 },
        });
      }

      return json({
        ok: true,
        evidence_file_id: evidence.id,
        already_registered: !createdEvidence,
      });
    }

    return json({ error: "unsupported_action" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Evidence upload failed.";
    return json({ error: "work_evidence_failed", message }, 500);
  }
});
