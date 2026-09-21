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

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return btoa(binary);
}

function extractText(payload: any) {
  return (payload?.candidates?.[0]?.content?.parts ?? [])
    .map((part: any) => typeof part?.text === "string" ? part.text : "")
    .join("")
    .trim();
}

function parseJson(text: string) {
  const clean = text
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  try {
    return JSON.parse(clean);
  } catch {
    const start = clean.indexOf("{");
    const end = clean.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(clean.slice(start, end + 1));
    throw new Error("AI returned text that was not valid JSON.");
  }
}

class GeminiHttpError extends Error {
  status: number;
  retryable: boolean;

  constructor(message: string, status: number) {
    super(message);
    this.name = "GeminiHttpError";
    this.status = status;
    this.retryable = [408, 429, 500, 502, 503, 504].includes(status);
  }
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchGeminiJson(url: string, init: RequestInit, attempts = 2) {
  let lastError: unknown = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, init);
      const raw = await response.text();
      let payload: any = null;

      if (raw.trim()) {
        try {
          payload = JSON.parse(raw);
        } catch {
          payload = null;
        }
      }

      if (response.ok) {
        if (!payload) {
          throw new Error("Gemini returned a success response that was not valid JSON.");
        }
        return payload;
      }

      const detail = payload?.error?.message
        || raw.trim().slice(0, 900)
        || `Gemini request failed with status ${response.status}`;
      const upstreamError = new GeminiHttpError(detail, response.status);
      lastError = upstreamError;

      if (!upstreamError.retryable || attempt === attempts - 1) {
        throw upstreamError;
      }
    } catch (error) {
      lastError = error;
      const retryable = error instanceof GeminiHttpError
        ? error.retryable
        : error instanceof TypeError;

      if (!retryable || attempt === attempts - 1) throw error;
    }

    await delay(800 * (2 ** attempt) + Math.floor(Math.random() * 250));
  }

  throw lastError instanceof Error ? lastError : new Error("Gemini request failed.");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "missing_authorization" }, 401);

  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  if (!geminiKey) return json({ error: "gemini_not_configured", message: "GEMINI_API_KEY is not configured." }, 503);

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

  let importId = "";
  try {
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData.user) return json({ error: "invalid_user_session" }, 401);

    const body = await req.json();
    const companyId = String(body?.company_id ?? "");
    importId = String(body?.import_id ?? "");
    if (!companyId || !importId) return json({ error: "company_and_import_required" }, 400);

    const { data: link } = await adminClient
      .from("employee_account_links")
      .select("employee_id")
      .eq("company_id", companyId)
      .eq("user_id", userData.user.id)
      .eq("status", "active")
      .maybeSingle();
    if (!link?.employee_id) return json({ error: "not_a_company_member" }, 403);

    const { data: roles } = await adminClient
      .from("role_grants")
      .select("role")
      .eq("company_id", companyId)
      .eq("employee_id", link.employee_id)
      .is("revoked_at", null);
    if (!(roles ?? []).some((row: any) => ["owner","operations_manager"].includes(row.role))) {
      return json({ error: "insufficient_permission" }, 403);
    }

    const { data: turnImport, error: importError } = await adminClient
      .from("turn_list_imports")
      .select("id,client_id,property_id,document_id,status")
      .eq("company_id", companyId)
      .eq("id", importId)
      .maybeSingle();
    if (importError) throw importError;
    if (!turnImport) return json({ error: "turn_list_import_not_found" }, 404);
    if (turnImport.status === "committed") return json({ error: "turn_list_already_committed" }, 409);

    const { data: activeProperty, error: propertyError } = await adminClient
      .from("properties")
      .select("id")
      .eq("company_id", companyId)
      .eq("id", turnImport.property_id)
      .eq("active", true)
      .maybeSingle();
    if (propertyError) throw propertyError;
    if (!activeProperty) {
      return json({
        error: "property_archived",
        message: "This property is archived. Turn-list scanning is disabled for archived properties.",
      }, 409);
    }

    const { data: document, error: documentError } = await adminClient
      .from("client_documents")
      .select("id,storage_bucket,storage_path,mime_type,byte_size,original_file_name")
      .eq("company_id", companyId)
      .eq("id", turnImport.document_id)
      .maybeSingle();
    if (documentError) throw documentError;
    if (!document) return json({ error: "source_document_not_found" }, 404);
    if (Number(document.byte_size ?? 0) > 20 * 1024 * 1024) {
      return json({ error: "document_too_large_for_scan", message: "Turn-list AI scanning currently supports files up to 20 MB." }, 400);
    }

    await adminClient.from("turn_list_imports").update({ status: "scanning", error_message: null }).eq("id", importId);
    await adminClient.from("client_documents").update({ status: "scanning" }).eq("id", document.id);

    const { data: blob, error: downloadError } = await adminClient.storage
      .from(document.storage_bucket)
      .download(document.storage_path);
    if (downloadError || !blob) throw downloadError ?? new Error("Could not read uploaded turn list.");

    const mimeType = String(document.mime_type || blob.type || "application/pdf").toLowerCase();
    const prompt = `You are extracting a property TURN LIST for apartment turnover operations.

This document is NOT a list of repairs. Do not create or infer any maintenance work.
Extract only the apartment locations that need a turnover walkthrough.

Return ONLY valid JSON:
{
  "items": [
    {
      "building": "building label exactly as represented, e.g. 2 or Building A",
      "unit": "apartment/unit number exactly as represented, e.g. 203",
      "page": 1,
      "confidence": 0.98,
      "raw_text": "short source text supporting this row"
    }
  ]
}

Rules:
- A building heading applies to the apartment/unit numbers listed beneath it until a new building heading appears.
- One output item per unique building + unit.
- Ignore names, repair descriptions, prices, dates, notes, and other text that is not needed to identify building and apartment.
- Do not invent apartment numbers.
- If the unit is readable but the building cannot be determined, set building to null and confidence <= 0.60.
- If a page number cannot be determined, page may be null.
- confidence must be between 0 and 1.
- Return JSON only.`;

    let parts: any[];
    if (mimeType === "text/plain") {
      const textContent = await blob.text();
      parts = [{ text: `${prompt}\n\nTURN LIST DOCUMENT:\n${textContent}` }];
    } else {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      parts = [
        { text: prompt },
        { inline_data: { mime_type: mimeType, data: bytesToBase64(bytes) } },
      ];
    }

    const configuredModel = Deno.env.get("GEMINI_MODEL")?.trim();
    const fallbackModels = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash"];
    const modelCandidates = [...new Set([configuredModel, ...fallbackModels].filter(Boolean))] as string[];

    let payload: any = null;
    let modelName = modelCandidates[0] || "gemini-3.8-flash";
    let lastGeminiError: unknown = null;

    for (const candidate of modelCandidates) {
      try {
        payload = await fetchGeminiJson(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(candidate)}:generateContent?key=${encodeURIComponent(geminiKey)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ role: "user", parts }],
              generationConfig: {
                temperature: 0.1,
                responseMimeType: "application/json",
                maxOutputTokens: 8000,
              },
            }),
          },
          2,
        );
        modelName = candidate;
        lastGeminiError = null;
        break;
      } catch (error) {
        lastGeminiError = error;
        if (!(error instanceof GeminiHttpError) || !error.retryable) throw error;
      }
    }

    if (!payload) {
      throw lastGeminiError instanceof Error
        ? lastGeminiError
        : new Error("Gemini turn-list scan failed after retries.");
    }

    const outputText = extractText(payload);
    if (!outputText) throw new Error("Gemini returned no turn-list extraction.");
    const parsed = parseJson(outputText);
    if (!Array.isArray(parsed?.items)) throw new Error("AI result did not contain an items array.");

    const normalized = new Map<string, any>();
    for (const raw of parsed.items.slice(0, 1000)) {
      const building = typeof raw?.building === "string" && raw.building.trim() ? raw.building.trim().slice(0, 120) : "Unknown";
      const unit = typeof raw?.unit === "string" ? raw.unit.trim().slice(0, 80) : "";
      if (!unit) continue;
      const confidenceNumber = Number(raw?.confidence);
      const confidence = Number.isFinite(confidenceNumber) ? Math.max(0, Math.min(1, confidenceNumber)) : 0.5;
      const normalizedBuilding = building.toLowerCase().replace(/\s+/g, " ").trim();
      const normalizedUnit = unit.toLowerCase().replace(/\s+/g, " ").trim();
      const key = `${normalizedBuilding}::${normalizedUnit}`;
      if (normalized.has(key)) continue;
      normalized.set(key, {
        company_id: companyId,
        import_id: importId,
        client_id: turnImport.client_id,
        property_id: turnImport.property_id,
        source_document_id: turnImport.document_id,
        source_page: Number.isInteger(Number(raw?.page)) && Number(raw.page) > 0 ? Number(raw.page) : null,
        building_label: building,
        unit_number: unit,
        normalized_building: normalizedBuilding,
        normalized_unit: normalizedUnit,
        status: building === "Unknown" || confidence < 0.65 ? "needs_review" : "draft",
        confidence,
        review_reason: building === "Unknown" ? "Building could not be determined from the source document." : confidence < 0.65 ? "AI confidence is below the import threshold." : null,
        raw_text: typeof raw?.raw_text === "string" ? raw.raw_text.slice(0, 500) : null,
      });
    }

    await adminClient
      .from("turn_list_items")
      .delete()
      .eq("company_id", companyId)
      .eq("import_id", importId)
      .in("status", ["draft","needs_review"]);

    const rows = Array.from(normalized.values());
    if (rows.length) {
      const { error: insertError } = await adminClient.from("turn_list_items").insert(rows);
      if (insertError) throw insertError;
    }

    const needsReview = rows.filter((row) => row.status === "needs_review").length;
    await Promise.all([
      adminClient.from("turn_list_imports").update({
        status: "review",
        total_items: rows.length,
        pending_count: 0,
        needs_review_count: needsReview,
        scanned_at: new Date().toISOString(),
        error_message: null,
      }).eq("id", importId),
      adminClient.from("client_documents").update({
        status: "scanned",
        ai_summary: `Extracted ${rows.length} unique building/unit turn${rows.length === 1 ? "" : "s"}; ${needsReview} need review.`,
      }).eq("id", document.id),
    ]);

    await adminClient.from("audit_events").insert({
      company_id: companyId,
      actor_user_id: userData.user.id,
      actor_employee_id: link.employee_id,
      action: "turn_list.ai_scanned",
      entity_type: "turn_list_import",
      entity_id: importId,
      after_data: { total_items: rows.length, needs_review_count: needsReview, model: modelName },
    });

    const { data: savedItems } = await adminClient
      .from("turn_list_items")
      .select("id,building_label,unit_number,source_page,status,confidence,review_reason,raw_text")
      .eq("company_id", companyId)
      .eq("import_id", importId)
      .order("building_label")
      .order("unit_number");

    return json({ ok: true, import_id: importId, total_items: rows.length, needs_review_count: needsReview, items: savedItems ?? [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Turn-list scan failed.";
    if (importId) {
      await adminClient.from("turn_list_imports").update({ status: "failed", error_message: message }).eq("id", importId).catch(() => undefined);
    }
    return json({ error: "turn_list_scan_failed", message }, 500);
  }
});
