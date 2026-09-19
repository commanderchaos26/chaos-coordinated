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

function requireString(value: unknown, field: string, maxLength: number, allowEmpty = false) {
  if (typeof value !== "string") throw new Error(`AI field "${field}" must be text.`);
  const trimmed = value.trim();
  if (!allowEmpty && !trimmed) throw new Error(`AI field "${field}" cannot be empty.`);
  if (trimmed.length > maxLength) throw new Error(`AI field "${field}" is too long.`);
  return trimmed;
}

function nullableString(value: unknown, field: string, maxLength: number) {
  if (value == null) return null;
  if (typeof value !== "string") throw new Error(`AI field "${field}" must be text or null.`);
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function assertNoDependencyCycles(issues: Array<{ issue_key: string; depends_on_issue_keys: string[] }>) {
  const graph = new Map(issues.map((issue) => [issue.issue_key, issue.depends_on_issue_keys]));
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (key: string) => {
    if (visiting.has(key)) throw new Error("AI produced a circular work-order dependency.");
    if (visited.has(key)) return;
    visiting.add(key);
    for (const dependency of graph.get(key) ?? []) visit(dependency);
    visiting.delete(key);
    visited.add(key);
  };

  for (const issue of issues) visit(issue.issue_key);
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
      const { data: existing, error: existingError } = await adminClient
        .from("ai_walkthrough_issues")
        .select("id,issue_key,title,room_area,priority,department_id,confidence,needs_review,review_reason,work_order_id,status,depends_on_issue_keys")
        .eq("company_id", companyId)
        .eq("session_id", sessionId)
        .order("created_at");
      if (existingError) {
        return json({ ok: false, error: "results_read_failed", message: "The walkthrough completed, but its result list could not be loaded. Reopen the walkthrough to retry the results read." }, 200);
      }
      return json({
        ok: true,
        idempotent: true,
        session_id: sessionId,
        issues: existing ?? [],
        created_count: existing?.length ?? 0,
        summary: session.ai_summary ?? null,
      });
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

    const { data: claimResult, error: claimError } = await userClient.rpc("ai_walkthrough_claim_finalization", {
      p_company_id: companyId,
      p_session_id: sessionId,
      p_finalization_key: finalizationKey,
      p_lease_seconds: 180,
    });
    if (claimError) throw claimError;

    if (claimResult?.completed) {
      const { data: completedIssues, error: completedIssuesError } = await adminClient
        .from("ai_walkthrough_issues")
        .select("id,issue_key,title,room_area,priority,department_id,confidence,needs_review,review_reason,work_order_id,status,depends_on_issue_keys")
        .eq("company_id", companyId)
        .eq("session_id", sessionId)
        .order("created_at");
      if (completedIssuesError) {
        return json({ ok: false, error: "results_read_failed", message: "The walkthrough completed, but its result list could not be loaded. Reopen the walkthrough to retry the results read." }, 200);
      }
      return json({
        ok: true,
        idempotent: true,
        session_id: sessionId,
        issues: completedIssues ?? [],
        created_count: completedIssues?.length ?? 0,
        summary: session.ai_summary ?? null,
      });
    }

    if (!claimResult?.claim_granted) {
      return json({
        ok: false,
        error: "finalization_in_progress",
        message: "This walkthrough is already being finalized. Wait a moment, then reopen or retry to load the completed results.",
        lease_until: claimResult?.lease_until ?? null,
      }, 200);
    }

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
    if (!interpretation || typeof interpretation !== "object" || Array.isArray(interpretation)) {
      throw new Error("The AI result must be a JSON object.");
    }
    if (!Array.isArray(interpretation.issues)) throw new Error("The AI result did not contain an issues array.");
    if (interpretation.issues.length > 50) throw new Error("The AI returned more than the maximum 50 work items.");

    const summary = interpretation.summary == null
      ? ""
      : requireString(interpretation.summary, "summary", 1200, true);

    const departmentIds = new Set(departmentList.map((d: any) => d.id));
    const skillById = new Map(skillList.map((s: any) => [s.id, s]));
    const chunkSequenceSet = new Set(chunks.map((c: any) => Number(c.sequence_no)));
    const issueKeys = new Set<string>();

    const cleanedIssues = interpretation.issues.map((raw: any, index: number) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error(`AI issue #${index + 1} must be an object.`);
      }

      const issue: any = {};
      issue.issue_key = requireString(raw.issue_key ?? `issue_${index + 1}`, "issue_key", 80);
      if (issueKeys.has(issue.issue_key)) throw new Error("AI produced duplicate issue keys.");
      issueKeys.add(issue.issue_key);

      issue.title = requireString(raw.title, "title", 180);
      issue.description = requireString(raw.description ?? "", "description", 1200, true);
      issue.room_area = nullableString(raw.room_area, "room_area", 120);
      issue.issue_category = nullableString(raw.issue_category, "issue_category", 120);

      if (raw.department_id != null && typeof raw.department_id !== "string") {
        throw new Error("AI field \"department_id\" must be a department ID or null.");
      }
      issue.department_id = typeof raw.department_id === "string" && raw.department_id.trim() ? raw.department_id.trim() : null;

      if (typeof raw.priority !== "string" || !["low", "normal", "high", "emergency"].includes(raw.priority)) {
        throw new Error("AI produced an invalid priority.");
      }
      issue.priority = raw.priority;

      if (typeof raw.occupancy_blocking !== "boolean") throw new Error("AI field \"occupancy_blocking\" must be true or false.");
      issue.occupancy_blocking = raw.occupancy_blocking;

      if (raw.estimated_minutes == null) {
        issue.estimated_minutes = null;
      } else if (Number.isInteger(raw.estimated_minutes) && raw.estimated_minutes >= 1 && raw.estimated_minutes <= 1440) {
        issue.estimated_minutes = raw.estimated_minutes;
      } else {
        throw new Error("AI produced an invalid estimated_minutes value.");
      }

      if (typeof raw.confidence !== "number" || !Number.isFinite(raw.confidence) || raw.confidence < 0 || raw.confidence > 1) {
        throw new Error("AI produced an invalid confidence value.");
      }
      issue.confidence = raw.confidence;

      if (typeof raw.needs_review !== "boolean") throw new Error("AI field \"needs_review\" must be true or false.");
      issue.needs_review = raw.needs_review;
      issue.review_reason = nullableString(raw.review_reason, "review_reason", 500);

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

      if (!Array.isArray(raw.required_skills)) throw new Error("AI field \"required_skills\" must be an array.");
      if (raw.required_skills.length > 12) throw new Error("AI returned too many required skills for one issue.");

      const validSkills: Array<{ skill_id: string; name: string }> = [];
      let unknownSkillCount = 0;
      for (const entry of raw.required_skills) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry) || typeof entry.skill_id !== "string") {
          unknownSkillCount += 1;
          continue;
        }
        const known = skillById.get(entry.skill_id);
        if (!known) {
          unknownSkillCount += 1;
          continue;
        }
        validSkills.push({ skill_id: entry.skill_id, name: known.name });
      }
      issue.required_skills = validSkills;
      if (unknownSkillCount > 0) {
        issue.needs_review = true;
        issue.review_reason = appendReviewReason(issue.review_reason, `${unknownSkillCount} AI-selected skill${unknownSkillCount === 1 ? "" : "s"} did not match the active company skill catalog`);
      }

      if (!Array.isArray(raw.source_chunk_sequences)) throw new Error("AI field \"source_chunk_sequences\" must be an array.");
      if (raw.source_chunk_sequences.length > 100) throw new Error("AI returned too many source transcript references.");
      const validSequences = [...new Set(raw.source_chunk_sequences.filter((value: unknown) => Number.isInteger(value) && chunkSequenceSet.has(Number(value))).map(Number))];
      issue.source_chunk_sequences = validSequences;
      if (!issue.source_chunk_sequences.length) {
        issue.source_chunk_sequences = chunks.map((c: any) => Number(c.sequence_no));
        issue.needs_review = true;
        issue.review_reason = appendReviewReason(issue.review_reason, "AI did not identify a valid supporting transcript segment");
      }

      if (!Array.isArray(raw.depends_on_issue_keys)) throw new Error("AI field \"depends_on_issue_keys\" must be an array.");
      if (raw.depends_on_issue_keys.length > 20) throw new Error("AI returned too many dependencies for one issue.");
      issue.depends_on_issue_keys = [...new Set(raw.depends_on_issue_keys.map((value: unknown) => {
        if (typeof value !== "string" || !value.trim()) throw new Error("AI dependency keys must be non-empty text.");
        return value.trim();
      }))];

      return issue;
    });

    for (const issue of cleanedIssues) {
      for (const dependency of issue.depends_on_issue_keys) {
        if (dependency === issue.issue_key) throw new Error("AI produced a self-dependency.");
        if (!issueKeys.has(dependency)) throw new Error(`AI dependency "${dependency}" does not match a generated issue.`);
      }
    }
    assertNoDependencyCycles(cleanedIssues);

    const { data: commitResult, error: commitError } = await adminClient.rpc("ai_walkthrough_commit_interpretation_service", {
      p_company_id: companyId,
      p_session_id: sessionId,
      p_finalization_key: finalizationKey,
      p_model_name: modelName,
      p_model_request_id: geminiPayload?.id ?? geminiPayload?.response_id ?? null,
      p_summary: summary,
      p_issues: cleanedIssues,
      p_actor_user_id: userData.user.id,
    });
    if (commitError) throw commitError;

    const { data: createdIssues, error: createdIssuesError } = await adminClient
      .from("ai_walkthrough_issues")
      .select("id,issue_key,title,room_area,priority,department_id,confidence,needs_review,review_reason,work_order_id,status,depends_on_issue_keys")
      .eq("company_id", companyId)
      .eq("session_id", sessionId)
      .order("created_at");

    const committed = Array.isArray(commitResult?.created) ? commitResult.created : [];
    let responseIssues = createdIssues ?? [];
    let resultsSource = "database";

    if (createdIssuesError || responseIssues.length !== committed.length) {
      const cleanedByKey = new Map(cleanedIssues.map((issue: any) => [issue.issue_key, issue]));
      responseIssues = committed.map((created: any) => {
        const cleaned = cleanedByKey.get(created.issue_key) ?? {};
        return {
          id: created.issue_id,
          issue_key: created.issue_key,
          title: cleaned.title ?? "Created work order",
          room_area: cleaned.room_area ?? null,
          priority: cleaned.priority ?? "normal",
          department_id: cleaned.department_id ?? null,
          confidence: cleaned.confidence ?? null,
          needs_review: cleaned.needs_review ?? true,
          review_reason: cleaned.review_reason ?? (createdIssuesError ? "Result details could not be re-read after commit." : null),
          work_order_id: created.work_order_id,
          status: cleaned.needs_review ? "review_required" : "created",
          depends_on_issue_keys: cleaned.depends_on_issue_keys ?? [],
        };
      });
      resultsSource = "commit_fallback";
    }

    return json({
      ok: true,
      summary,
      model: modelName,
      request_id: geminiPayload?.id ?? geminiPayload?.response_id ?? null,
      created: committed,
      created_count: committed.length,
      issues: responseIssues,
      results_source: resultsSource,
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
