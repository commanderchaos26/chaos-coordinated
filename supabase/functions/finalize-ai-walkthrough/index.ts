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

function readOutputText(payload: any): string | null {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) return payload.output_text.trim();
  for (const item of payload?.output ?? []) {
    for (const content of item?.content ?? []) {
      if (content?.type === "output_text" && typeof content?.text === "string" && content.text.trim()) return content.text.trim();
    }
  }
  return null;
}

function safeMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 900);
  if (typeof error === "string") return error.slice(0, 900);
  try { return JSON.stringify(error).slice(0, 900); } catch { return "AI walkthrough finalization failed."; }
}

function appendReviewReason(existing: unknown, extra: string) {
  const base = typeof existing === "string" && existing.trim() ? existing.trim() : "";
  return base ? `${base}; ${extra}` : extra;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "missing_authorization" }, 401);

  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  if (!geminiKey) return json({ error: "gemini_not_configured", message: "GEMINI_API_KEY is not configured for this project yet." }, 503);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const publishableKeys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}");
  const publicKey = publishableKeys.default ?? Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const userClient = createClient(supabaseUrl, publicKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let companyId = "";
  let sessionId = "";
  try {
    const body = await req.json();
    companyId = String(body?.company_id ?? "");
    sessionId = String(body?.session_id ?? "");
    const finalizationKey = String(body?.finalization_key ?? "");
    if (!companyId || !sessionId || !finalizationKey) return json({ error: "company_session_and_key_required" }, 400);

    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData.user) return json({ error: "invalid_user_session" }, 401);

    const { data: session, error: sessionError } = await userClient
      .from("ai_walkthrough_sessions")
      .select("id,company_id,property_id,building_id,unit_id,turnover_id,work_site_id,status,started_by,ai_summary")
      .eq("company_id", companyId)
      .eq("id", sessionId)
      .single();
    if (sessionError || !session) return json({ error: "walkthrough_not_found" }, 404);

    if (session.status === "completed") {
      const { data: existing } = await userClient
        .from("ai_walkthrough_issues")
        .select("id,issue_key,title,work_order_id,status,needs_review,review_reason")
        .eq("company_id", companyId)
        .eq("session_id", sessionId)
        .order("created_at");
      return json({ ok: true, idempotent: true, session_id: sessionId, issues: existing ?? [], summary: session.ai_summary ?? null });
    }

    const [{ data: chunks, error: chunksError }, { data: departments, error: departmentsError }, { data: skills, error: skillsError }] = await Promise.all([
      userClient.from("ai_walkthrough_transcript_chunks")
        .select("sequence_no,source,transcript_text,is_final,captured_at")
        .eq("company_id", companyId)
        .eq("session_id", sessionId)
        .order("sequence_no"),
      userClient.from("departments").select("id,name,code").eq("company_id", companyId).eq("active", true).order("name"),
      userClient.from("skills").select("id,name,category,description").eq("company_id", companyId).eq("active", true).order("name"),
    ]);
    if (chunksError) throw chunksError;
    if (departmentsError) throw departmentsError;
    if (skillsError) throw skillsError;
    if (!chunks?.length) return json({ error: "no_walkthrough_observations", message: "Add at least one observation before finishing the walkthrough." }, 400);

    const locationQueries = await Promise.all([
      userClient.from("properties").select("id,name").eq("id", session.property_id).maybeSingle(),
      session.building_id ? userClient.from("buildings").select("id,name").eq("id", session.building_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
      session.unit_id ? userClient.from("units").select("id,unit_number").eq("id", session.unit_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    ]);
    const property = locationQueries[0].data;
    const building = locationQueries[1].data;
    const unit = locationQueries[2].data;

    const { error: processingError } = await userClient.rpc("ai_walkthrough_mark_processing", {
      p_company_id: companyId,
      p_session_id: sessionId,
    });
    if (processingError && !String(processingError.message ?? processingError).toLowerCase().includes("walkthrough_not_ready")) throw processingError;

    const departmentList = departments ?? [];
    const skillList = skills ?? [];
    const transcript = chunks.map((c: any) => `#${c.sequence_no} [${c.source}] ${c.transcript_text}`).join("\n");
    const context = {
      location: {
        property: property?.name ?? null,
        building: building?.name ?? null,
        unit: unit?.unit_number ?? null,
      },
      active_departments: departmentList,
      active_skills: skillList,
      transcript,
    };

    const schema = {
      type: "object",
      additionalProperties: false,
      required: ["summary", "issues"],
      properties: {
        summary: { type: "string", maxLength: 1200 },
        issues: {
          type: "array",
          maxItems: 50,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["issue_key","title","description","room_area","issue_category","department_id","required_skills","priority","occupancy_blocking","estimated_minutes","confidence","needs_review","review_reason","depends_on_issue_keys","source_chunk_sequences"],
            properties: {
              issue_key: { type: "string", minLength: 1, maxLength: 80 },
              title: { type: "string", minLength: 1, maxLength: 180 },
              description: { type: "string", maxLength: 1200 },
              room_area: { type: ["string","null"], maxLength: 120 },
              issue_category: { type: ["string","null"], maxLength: 120 },
              department_id: { type: ["string","null"] },
              required_skills: {
                type: "array",
                maxItems: 12,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["skill_id","name"],
                  properties: {
                    skill_id: { type: "string" },
                    name: { type: "string", maxLength: 160 },
                  },
                },
              },
              priority: { type: "string", enum: ["low","normal","high","emergency"] },
              occupancy_blocking: { type: "boolean" },
              estimated_minutes: { type: ["integer","null"], minimum: 1, maximum: 1440 },
              confidence: { type: "number", minimum: 0, maximum: 1 },
              needs_review: { type: "boolean" },
              review_reason: { type: ["string","null"], maxLength: 500 },
              depends_on_issue_keys: { type: "array", maxItems: 20, items: { type: "string", maxLength: 80 } },
              source_chunk_sequences: { type: "array", minItems: 1, maxItems: 100, items: { type: "integer", minimum: 1 } },
            },
          },
        },
      },
    };

    const instructions = `You are the Chaos Coordinated apartment-turnover walkthrough interpreter. Convert the completed field walkthrough transcript into the smallest correct set of actionable work orders.\n\nRules:\n- Treat later corrections as authoritative. If the speaker says scratch that, actually, instead, or otherwise revises an earlier statement, do not create the superseded work.\n- Merge duplicate observations that refer to the same physical issue and scope.\n- Resolve references such as same thing in bedroom two using preceding context.\n- Use ONLY department IDs and skill IDs supplied in the active company catalogs. Never invent IDs.\n- If an issue is real but cannot be confidently mapped to an active department, set department_id to null, needs_review=true, and explain why in review_reason.\n- Do not create work orders from casual conversation, administrative chatter, or statements that no work is needed.\n- Create dependencies when one trade must finish before another can begin. Example: drywall patch before painting the repaired surface.\n- Do not infer hazards, code violations, or emergency priority from weak evidence. Use emergency only when the transcript explicitly describes an immediate emergency or equivalent immediate danger. Use normal by default.\n- occupancy_blocking means the issue prevents the unit from being considered ready for occupancy; do not mark it true unless supported by the transcript or obvious direct work dependency.\n- estimated_minutes is a rough task estimate only when reasonably inferable; otherwise null.\n- source_chunk_sequences must identify the transcript chunks that support the issue.\n- If confidence is below 0.70 for classification or scope, set needs_review=true.\n- Work orders will be created automatically from your output, so favor correctness over aggressive guessing.\n- Do not dispatch employees. Your job ends with work-order creation.`;

    const configuredModel = Deno.env.get("GEMINI_MODEL")?.trim();
    const supportedModels = new Set(["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash"]);
    const modelName = configuredModel && supportedModels.has(configuredModel) ? configuredModel : "gemini-3.8-flash";
    const cleanSchema = (node: any): any => {
      if (Array.isArray(node)) return node.map(cleanSchema);
      if (node && typeof node === "object") {
        const out: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(node)) {
          if (key === "maxLength" || key === "minLength") continue;
          out[key] = cleanSchema(value);
        }
        return out;
      }
      return node;
    };

    const jsonContract = `
Return ONLY one valid JSON object with this exact top-level shape:
{
  "summary": "short summary",
  "issues": [
    {
      "issue_key": "unique_short_key",
      "title": "actionable work order title",
      "description": "clear scope",
      "room_area": null,
      "issue_category": null,
      "department_id": null,
      "required_skills": [{"skill_id":"existing supplied skill UUID","name":"existing supplied skill name"}],
      "priority": "low|normal|high|emergency",
      "occupancy_blocking": false,
      "estimated_minutes": null,
      "confidence": 0.0,
      "needs_review": false,
      "review_reason": null,
      "depends_on_issue_keys": [],
      "source_chunk_sequences": [1]
    }
  ]
}
Use JSON null for unknown nullable values. Do not use markdown fences, comments, or prose outside the JSON object.
`;

    const fullPrompt = `${instructions}\n\n${jsonContract}\n\nWalkthrough context:\n${JSON.stringify(context)}`;

    const interactionResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/interactions?key=${encodeURIComponent(geminiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: modelName,
          store: false,
          input: fullPrompt,
        }),
      },
    );

    const geminiPayload = await interactionResponse.json();
    if (!interactionResponse.ok) {
      const detail = geminiPayload?.error?.message
        ? `${geminiPayload.error.message}${geminiPayload?.error?.details ? ` | ${JSON.stringify(geminiPayload.error.details).slice(0, 1200)}` : ""}`
        : `Gemini request failed with status ${interactionResponse.status}`;
      throw new Error(detail);
    }

    let outputText = typeof geminiPayload?.output_text === "string" ? geminiPayload.output_text.trim() : "";
    if (!outputText) {
      outputText = (geminiPayload?.steps ?? [])
        .filter((step: any) => step?.type === "model_output")
        .flatMap((step: any) => Array.isArray(step?.content) ? step.content : [])
        .filter((content: any) => content?.type === "text" && typeof content?.text === "string")
        .map((content: any) => content.text)
        .join("")
        .trim();
    }
    if (!outputText) {
      throw new Error(`Gemini returned no walkthrough interpretation (status: ${geminiPayload?.status ?? "unknown"}).`);
    }

    outputText = outputText
      .replace(/^\s*```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/i, "")
      .trim();

    let interpretation: any;
    try {
      interpretation = JSON.parse(outputText);
    } catch {
      const firstBrace = outputText.indexOf("{");
      const lastBrace = outputText.lastIndexOf("}");
      if (firstBrace >= 0 && lastBrace > firstBrace) {
        interpretation = JSON.parse(outputText.slice(firstBrace, lastBrace + 1));
      } else {
        throw new Error("Gemini returned text that was not valid JSON.");
      }
    }
    if (!Array.isArray(interpretation?.issues)) throw new Error("The AI result did not contain an issues array.");

    const departmentIds = new Set(departmentList.map((d: any) => d.id));
    const skillById = new Map(skillList.map((s: any) => [s.id, s]));
    const chunkSequenceSet = new Set(chunks.map((c: any) => Number(c.sequence_no)));
    const issueKeys = new Set<string>();

    const cleanedIssues = interpretation.issues.map((raw: any, index: number) => {
      const issue: any = { ...raw };
      issue.issue_key = String(issue.issue_key || `issue_${index + 1}`).trim();
      if (!issue.issue_key || issueKeys.has(issue.issue_key)) throw new Error("AI produced duplicate or empty issue keys.");
      issueKeys.add(issue.issue_key);

      issue.title = String(issue.title ?? "").trim().slice(0, 180);
      if (!issue.title) throw new Error("AI produced an issue without a usable title.");
      issue.description = String(issue.description ?? "").trim().slice(0, 1200);
      issue.room_area = typeof issue.room_area === "string" && issue.room_area.trim() ? issue.room_area.trim().slice(0, 120) : null;
      issue.issue_category = typeof issue.issue_category === "string" && issue.issue_category.trim() ? issue.issue_category.trim().slice(0, 120) : null;
      issue.priority = ["low", "normal", "high", "emergency"].includes(String(issue.priority)) ? String(issue.priority) : "normal";
      issue.occupancy_blocking = issue.occupancy_blocking === true;
      const estimatedMinutes = Number(issue.estimated_minutes);
      issue.estimated_minutes = Number.isInteger(estimatedMinutes) && estimatedMinutes >= 1 && estimatedMinutes <= 1440 ? estimatedMinutes : null;
      const confidence = Number(issue.confidence);
      issue.confidence = Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0;
      issue.needs_review = issue.needs_review === true;
      issue.review_reason = typeof issue.review_reason === "string" && issue.review_reason.trim() ? issue.review_reason.trim().slice(0, 500) : null;
      if (issue.confidence < 0.70) {
        issue.needs_review = true;
        issue.review_reason = appendReviewReason(issue.review_reason, "AI confidence is below the automatic-accept threshold");
      }

      if (issue.department_id && !departmentIds.has(issue.department_id)) {
        issue.department_id = null;
        issue.needs_review = true;
        issue.review_reason = appendReviewReason(issue.review_reason, "AI department mapping did not match an active company department");
      }

      if (!issue.department_id) {
        issue.needs_review = true;
        issue.review_reason = appendReviewReason(issue.review_reason, "No active company department could be assigned with confidence");
      }

      issue.required_skills = Array.isArray(issue.required_skills)
        ? issue.required_skills.filter((entry: any) => entry?.skill_id && skillById.has(entry.skill_id)).map((entry: any) => ({
            skill_id: entry.skill_id,
            name: skillById.get(entry.skill_id)?.name ?? entry.name,
          }))
        : [];

      issue.source_chunk_sequences = Array.isArray(issue.source_chunk_sequences)
        ? [...new Set(issue.source_chunk_sequences.map(Number).filter((value: number) => chunkSequenceSet.has(value)))]
        : [];
      if (!issue.source_chunk_sequences.length) {
        issue.source_chunk_sequences = chunks.map((c: any) => Number(c.sequence_no));
        issue.needs_review = true;
        issue.review_reason = appendReviewReason(issue.review_reason, "AI did not identify a specific supporting transcript segment");
      }
      return issue;
    });

    for (const issue of cleanedIssues) {
      issue.depends_on_issue_keys = Array.isArray(issue.depends_on_issue_keys)
        ? issue.depends_on_issue_keys.filter((key: unknown) => typeof key === "string" && issueKeys.has(key as string) && key !== issue.issue_key)
        : [];
    }

    const { data: commitResult, error: commitError } = await adminClient.rpc("ai_walkthrough_commit_interpretation_service", {
      p_company_id: companyId,
      p_session_id: sessionId,
      p_finalization_key: finalizationKey,
      p_model_name: modelName,
      p_model_request_id: geminiPayload?.id ?? geminiPayload?.response_id ?? null,
      p_summary: String(interpretation.summary ?? "").slice(0, 1200),
      p_issues: cleanedIssues,
      p_actor_user_id: userData.user.id,
    });
    if (commitError) throw commitError;

    const { data: createdIssues } = await userClient
      .from("ai_walkthrough_issues")
      .select("id,issue_key,title,room_area,priority,department_id,confidence,needs_review,review_reason,work_order_id,status,depends_on_issue_keys")
      .eq("company_id", companyId)
      .eq("session_id", sessionId)
      .order("created_at");

    return json({
      ok: true,
      summary: String(interpretation.summary ?? ""),
      model: modelName,
      request_id: geminiPayload?.id ?? geminiPayload?.response_id ?? null,
      created: commitResult?.created ?? [],
      issues: createdIssues ?? [],
    });
  } catch (error) {
    const message = safeMessage(error);
    if (companyId && sessionId) {
      try {
        await userClient.rpc("ai_walkthrough_mark_failed", {
          p_company_id: companyId,
          p_session_id: sessionId,
          p_error_message: message,
        });
      } catch { /* best effort */ }
    }
    return json({ ok: false, error: "ai_walkthrough_finalization_failed", message }, 200);
  }
});
