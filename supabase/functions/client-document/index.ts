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

const allowedMime = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/plain",
]);

function safeFileName(name: string) {
  return (name || "document").replace(/[^A-Za-z0-9._ -]/g, "_").slice(0, 160);
}

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

    const { data: link, error: linkError } = await adminClient
      .from("employee_account_links")
      .select("employee_id")
      .eq("company_id", companyId)
      .eq("user_id", userData.user.id)
      .eq("status", "active")
      .maybeSingle();
    if (linkError) throw linkError;
    if (!link?.employee_id) return json({ error: "not_a_company_member" }, 403);

    const { data: roles, error: rolesError } = await adminClient
      .from("role_grants")
      .select("role")
      .eq("company_id", companyId)
      .eq("employee_id", link.employee_id)
      .is("revoked_at", null);
    if (rolesError) throw rolesError;
    const management = (roles ?? []).some((row: any) => ["owner","operations_manager"].includes(row.role));
    if (!management) return json({ error: "insufficient_permission" }, 403);

    if (action === "prepare_upload") {
      const clientId = String(body?.client_id ?? "");
      const propertyId = String(body?.property_id ?? "");
      const documentType = String(body?.document_type ?? "");
      const originalFileName = safeFileName(String(body?.file_name ?? "document"));
      const mimeType = String(body?.mime_type ?? "").toLowerCase();
      const byteSize = Number(body?.byte_size ?? 0);

      if (!clientId || !propertyId || !["contract","turn_list"].includes(documentType)) {
        return json({ error: "client_property_document_type_required" }, 400);
      }
      if (!allowedMime.has(mimeType)) return json({ error: "unsupported_media_type" }, 400);
      if (byteSize > 50 * 1024 * 1024) return json({ error: "file_too_large" }, 400);

      const [
        { data: client, error: clientError },
        { data: clientProperty, error: clientPropertyError },
        { data: property, error: propertyError },
      ] = await Promise.all([
        adminClient.from("clients").select("id").eq("company_id", companyId).eq("id", clientId).eq("active", true).maybeSingle(),
        adminClient.from("client_properties").select("id").eq("company_id", companyId).eq("client_id", clientId).eq("property_id", propertyId).maybeSingle(),
        adminClient.from("properties").select("id").eq("company_id", companyId).eq("id", propertyId).eq("active", true).maybeSingle(),
      ]);
      if (clientError) throw clientError;
      if (clientPropertyError) throw clientPropertyError;
      if (propertyError) throw propertyError;
      if (!client || !clientProperty) return json({ error: "client_property_not_found" }, 404);
      if (!property) {
        return json({
          error: "property_archived",
          message: "This property is archived. Restore or create an active property before uploading new client documents.",
        }, 409);
      }

      const { data: versionRows } = await adminClient
        .from("client_documents")
        .select("version_no")
        .eq("company_id", companyId)
        .eq("client_id", clientId)
        .eq("property_id", propertyId)
        .eq("document_type", documentType)
        .order("version_no", { ascending: false })
        .limit(1);
      const versionNo = Number(versionRows?.[0]?.version_no ?? 0) + 1;
      const documentId = crypto.randomUUID();
      const path = `${companyId}/${clientId}/${documentType}/v${versionNo}/${documentId}-${originalFileName}`;

      const { error: insertError } = await adminClient.from("client_documents").insert({
        id: documentId,
        company_id: companyId,
        client_id: clientId,
        property_id: propertyId,
        document_type: documentType,
        version_no: versionNo,
        original_file_name: originalFileName,
        storage_bucket: "client-documents",
        storage_path: path,
        mime_type: mimeType,
        byte_size: Number.isFinite(byteSize) && byteSize > 0 ? byteSize : null,
        status: "preparing",
        created_by: link.employee_id,
      });
      if (insertError) throw insertError;

      const { data: signed, error: signedError } = await adminClient.storage
        .from("client-documents")
        .createSignedUploadUrl(path);
      if (signedError || !signed?.token) throw signedError ?? new Error("Could not prepare document upload.");

      return json({
        ok: true,
        document_id: documentId,
        version_no: versionNo,
        bucket: "client-documents",
        path,
        token: signed.token,
      });
    }

    if (action === "register_upload") {
      const documentId = String(body?.document_id ?? "");
      if (!documentId) return json({ error: "document_id_required" }, 400);

      const { data: document, error: documentError } = await adminClient
        .from("client_documents")
        .select("*")
        .eq("company_id", companyId)
        .eq("id", documentId)
        .maybeSingle();
      if (documentError) throw documentError;
      if (!document) return json({ error: "client_document_not_found" }, 404);

      const slash = document.storage_path.lastIndexOf("/");
      const folder = document.storage_path.slice(0, slash);
      const fileName = document.storage_path.slice(slash + 1);
      const { data: objects, error: listError } = await adminClient.storage
        .from("client-documents")
        .list(folder, { search: fileName, limit: 10 });
      if (listError) throw listError;
      const uploaded = (objects ?? []).find((item: any) => item.name === fileName);
      if (!uploaded) return json({ error: "uploaded_file_not_found" }, 400);

      const { error: updateError } = await adminClient
        .from("client_documents")
        .update({
          status: "uploaded",
          byte_size: Number(uploaded?.metadata?.size ?? document.byte_size ?? 0) || null,
        })
        .eq("id", documentId);
      if (updateError) throw updateError;

      let importId: string | null = null;
      if (document.document_type === "turn_list") {
        const { data: activeProperty, error: activePropertyError } = await adminClient
          .from("properties")
          .select("id")
          .eq("company_id", companyId)
          .eq("id", document.property_id)
          .eq("active", true)
          .maybeSingle();
        if (activePropertyError) throw activePropertyError;
        if (!activeProperty) {
          await adminClient
            .from("client_documents")
            .update({
              status: "failed",
              ai_summary: "Property was archived before this turn list could be registered.",
            })
            .eq("id", documentId);
          return json({
            error: "property_archived",
            message: "The file was preserved, but this property is archived so no new turn-list workflow was created.",
          }, 409);
        }

        const { data: existingImport } = await adminClient
          .from("turn_list_imports")
          .select("id")
          .eq("company_id", companyId)
          .eq("document_id", documentId)
          .maybeSingle();

        if (existingImport?.id) {
          importId = existingImport.id;
        } else {
          const { data: createdImport, error: importError } = await adminClient
            .from("turn_list_imports")
            .insert({
              company_id: companyId,
              client_id: document.client_id,
              property_id: document.property_id,
              document_id: documentId,
              status: "uploaded",
              created_by: link.employee_id,
            })
            .select("id")
            .single();
          if (importError || !createdImport) throw importError ?? new Error("Could not create turn-list import.");
          importId = createdImport.id;
        }
      }

      await adminClient.from("audit_events").insert({
        company_id: companyId,
        actor_user_id: userData.user.id,
        actor_employee_id: link.employee_id,
        action: document.document_type === "contract" ? "client.contract_uploaded" : "client.turn_list_uploaded",
        entity_type: "client_document",
        entity_id: documentId,
        after_data: { client_id: document.client_id, property_id: document.property_id, import_id: importId },
      });

      return json({ ok: true, document_id: documentId, import_id: importId });
    }

    if (action === "signed_read") {
      const documentId = String(body?.document_id ?? "");
      const { data: document, error: documentError } = await adminClient
        .from("client_documents")
        .select("id,storage_bucket,storage_path,original_file_name")
        .eq("company_id", companyId)
        .eq("id", documentId)
        .maybeSingle();
      if (documentError) throw documentError;
      if (!document) return json({ error: "client_document_not_found" }, 404);

      const { data: signed, error: signedError } = await adminClient.storage
        .from(document.storage_bucket)
        .createSignedUrl(document.storage_path, 600, { download: document.original_file_name });
      if (signedError || !signed?.signedUrl) throw signedError ?? new Error("Could not open document.");

      return json({ ok: true, file_name: document.original_file_name, signed_url: signed.signedUrl, expires_in: 600 });
    }

    return json({ error: "unsupported_action" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Client document request failed.";
    return json({ error: "client_document_failed", message }, 500);
  }
});
