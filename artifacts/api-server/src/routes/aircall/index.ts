import { Router, type IRouter } from "express";
import { db, contactsTable, leadConversationsTable, integrationConfigsTable, agentsTable, callListMembershipsTable } from "@workspace/db";
import { eq, or, sql, and, isNull } from "drizzle-orm";

const router: IRouter = Router();

const COOL_OFF_DAYS = 28;

interface TagMapping {
  aircall_tag: string;
  outcome: string;
  side_effect: string | null;
}

const DEFAULT_TAG_MAPPING: TagMapping[] = [
  { aircall_tag: "interested", outcome: "interested", side_effect: null },
  { aircall_tag: "no-interest", outcome: "no-interest", side_effect: null },
  { aircall_tag: "no-answer", outcome: "no-answer", side_effect: "cool_off" },
  { aircall_tag: "callback", outcome: "callback-requested", side_effect: "callback" },
  { aircall_tag: "meeting-booked", outcome: "meeting-booked", side_effect: null },
  { aircall_tag: "not-now", outcome: "not-now", side_effect: null },
];

// Helper: get Aircall API auth header
async function getAircallAuth(): Promise<string | null> {
  try {
    const [config] = await db.select().from(integrationConfigsTable)
      .where(eq(integrationConfigsTable.provider, "aircall"));
    const cfg = config?.config as Record<string, any>;
    if (cfg?.api_id && cfg?.api_token) {
      return `Basic ${Buffer.from(`${cfg.api_id}:${cfg.api_token}`).toString("base64")}`;
    }
  } catch { /* ignore */ }
  return null;
}

// Helper: get tag mapping from config or use defaults
async function getTagMapping(): Promise<TagMapping[]> {
  try {
    const [config] = await db.select().from(integrationConfigsTable)
      .where(eq(integrationConfigsTable.provider, "aircall"));
    const cfg = config?.config as Record<string, any>;
    if (cfg?.tag_mapping && Array.isArray(cfg.tag_mapping) && cfg.tag_mapping.length > 0) {
      return cfg.tag_mapping;
    }
  } catch { /* use defaults */ }
  return DEFAULT_TAG_MAPPING;
}

// Helper: normalise phone for matching (strip spaces, dashes, parens)
function normalisePhone(phone: string): string {
  return phone.replace(/[\s\-\(\)]/g, "");
}

// Helper: extract external phone number from Aircall call data (tries many payload shapes)
function extractPhone(data: any): string {
  if (data?.raw_digits) return data.raw_digits;
  if (data?.number?.digits) return data.number.digits;
  // Tag/comment events sometimes nest the call object
  if (data?.call?.raw_digits) return data.call.raw_digits;
  if (data?.call?.number?.digits) return data.call.number.digits;
  // Participants array — pick the external one
  const participants = data?.participants || data?.call?.participants;
  if (Array.isArray(participants)) {
    const ext = participants.find((p: any) => p.participant_type === "external");
    if (ext?.phone_number) return ext.phone_number;
  }
  // Contact object on the call
  if (data?.contact?.phone_number) return data.contact.phone_number;
  return "";
}

// Helper: find contact by phone number from call data
async function findContactByPhone(phoneNumber: string) {
  if (!phoneNumber) return null;
  const normalised = normalisePhone(phoneNumber);

  // Try exact match first, then normalised
  const [exact] = await db.select().from(contactsTable)
    .where(eq(contactsTable.phone, normalised))
    .limit(1);
  if (exact) return exact;

  // Try matching with or without leading +
  const withPlus = normalised.startsWith("+") ? normalised : `+${normalised}`;
  const withoutPlus = normalised.startsWith("+") ? normalised.slice(1) : normalised;

  const [fuzzy] = await db.select().from(contactsTable)
    .where(or(
      eq(contactsTable.phone, withPlus),
      eq(contactsTable.phone, withoutPlus),
    ))
    .limit(1);
  return fuzzy || null;
}

// Helper: find agent by Aircall user ID
async function findAgentByAircallUser(aircallUserId: number) {
  if (!aircallUserId) return null;
  const [agent] = await db.select().from(agentsTable)
    .where(eq(agentsTable.aircall_user_id, aircallUserId))
    .limit(1);
  return agent || null;
}

// Helper: apply tag outcome to contact
async function applyTagOutcome(contactId: string, tagName: string, tagMapping: TagMapping[]) {
  const mapping = tagMapping.find(m => m.aircall_tag.toLowerCase() === tagName.toLowerCase());
  if (!mapping) return null;

  const updates: Record<string, any> = {
    last_call_outcome: mapping.outcome,
  };

  if (mapping.side_effect === "cool_off") {
    const coolOffDate = new Date();
    coolOffDate.setDate(coolOffDate.getDate() + COOL_OFF_DAYS);
    updates.cool_off_until = coolOffDate;
  } else if (mapping.side_effect === "callback") {
    const callbackDate = new Date();
    callbackDate.setDate(callbackDate.getDate() + 1);
    updates.callback_date = callbackDate;
  }

  await db.update(contactsTable)
    .set(updates)
    .where(eq(contactsTable.id, contactId));

  return mapping.outcome;
}

// ==================== Webhook Log (in-memory, for debugging) ====================

interface WebhookLogEntry {
  timestamp: string;
  event: string;
  status: string;
  contact_match: string | null;
  data_summary: Record<string, any>;
  raw_body: any;
}

const webhookLog: WebhookLogEntry[] = [];
const MAX_LOG_ENTRIES = 100;

function logWebhook(event: string, status: string, contactMatch: string | null, data: any) {
  webhookLog.unshift({
    timestamp: new Date().toISOString(),
    event,
    status,
    contact_match: contactMatch,
    data_summary: {
      call_id: data?.id || data?.call_id,
      raw_digits: data?.raw_digits || data?.number?.digits,
      direction: data?.direction,
      duration: data?.duration,
      tags: data?.tags?.map((t: any) => t.name || t),
      user: data?.user?.name || data?.user?.id,
      comment: typeof data?.comments === "string" ? data.comments : data?.comments?.content || data?.note?.content || data?.note,
      tag: typeof data?.tag === "string" ? data.tag : data?.tag?.name,
    },
    raw_body: data,
  });
  if (webhookLog.length > MAX_LOG_ENTRIES) webhookLog.pop();
}

// GET /aircall/webhook-log — view recent webhook events
router.get("/aircall/webhook-log", async (_req, res): Promise<void> => {
  res.json({ entries: webhookLog, count: webhookLog.length });
});

// ==================== Webhook Endpoint ====================

router.post("/aircall/webhook", async (req, res): Promise<void> => {
  // Always respond 200 quickly — Aircall retries on non-200
  const event = req.body?.event;
  const data = req.body?.data;

  if (!event || !data) {
    logWebhook(event || "unknown", "ignored", null, req.body);
    res.status(200).json({ status: "ignored", reason: "no event or data" });
    return;
  }

  // Optional: verify webhook token
  const token = req.query?.token || req.headers["x-aircall-token"];
  if (token) {
    try {
      const [config] = await db.select().from(integrationConfigsTable)
        .where(eq(integrationConfigsTable.provider, "aircall"));
      const cfg = config?.config as Record<string, any>;
      if (cfg?.webhook_token && token !== cfg.webhook_token) {
        console.warn("[Aircall Webhook] Invalid token");
        res.status(200).json({ status: "ignored", reason: "invalid token" });
        return;
      }
    } catch { /* proceed without verification */ }
  }

  try {
    if (event === "call.ended") {
      const result = await handleCallEnded(data);
      logWebhook(event, "processed", result || null, data);
      res.status(200).json({ status: "processed", event: "call.ended" });
    } else if (event === "call.tagged") {
      const result = await handleCallTagged(data);
      logWebhook(event, "processed", result || null, data);
      res.status(200).json({ status: "processed", event: "call.tagged" });
    } else if (event === "call.commented") {
      await handleCallCommented(data);
      logWebhook(event, "processed", null, data);
      res.status(200).json({ status: "processed", event: "call.commented" });
    } else if (event === "transcription.created") {
      const result = await handleTranscriptionCreated(data);
      logWebhook(event, "processed", result || null, data);
      res.status(200).json({ status: "processed", event: "transcription.created", detail: result });
    } else if (event === "summary.created") {
      const result = await handleSummaryCreated(data);
      logWebhook(event, "processed", result || null, data);
      res.status(200).json({ status: "processed", event: "summary.created", detail: result });
    } else {
      logWebhook(event, "ignored", null, data);
      res.status(200).json({ status: "ignored", event });
    }
  } catch (err: any) {
    console.error(`[Aircall Webhook] Error processing ${event}:`, err.message);
    logWebhook(event, `error: ${err.message}`, null, data);
    // Still return 200 to prevent Aircall retries on our errors
    res.status(200).json({ status: "error", message: err.message });
  }
});

// GET /aircall/webhook — health check (Aircall pings this)
router.get("/aircall/webhook", async (_req, res): Promise<void> => {
  res.json({ status: "ok", handler: "aircall-webhook" });
});

// ==================== Event Handlers ====================

async function handleCallEnded(data: any): Promise<string | null> {
  const callId = data.id || data.call_id;
  const duration = data.duration || 0;
  const direction = data.direction || "outbound";
  const rawDigits = extractPhone(data);
  const aircallUserId = data.user?.id;
  const tags = data.tags || [];
  const agentNotes = data.comments || data.note || null;

  // Only process calls made by agents registered in our app
  const agent = await findAgentByAircallUser(aircallUserId);
  if (!agent) {
    return `skipped: Aircall user ${aircallUserId} (${data.user?.name || "unknown"}) is not a registered agent`;
  }

  // Find the contact
  const contact = await findContactByPhone(rawDigits);
  if (!contact) {
    console.warn(`[Aircall Webhook] call.ended — no contact found for ${rawDigits}`);
    return `no match: ${rawDigits}`;
  }

  // Update contact: mark as called, increment attempts
  await db.update(contactsTable).set({
    dispatch_status: "called",
    call_attempts: sql`${contactsTable.call_attempts} + 1`,
  }).where(eq(contactsTable.id, contact.id));

  // Close the active call-list membership (if any) — snapshot the outcome
  try {
    const [activeMembership] = await db.select().from(callListMembershipsTable)
      .where(and(
        eq(callListMembershipsTable.contact_id, contact.id),
        isNull(callListMembershipsTable.removed_at),
      ))
      .limit(1);
    if (activeMembership) {
      // Use first tag as outcome snapshot if present (full mapping happens below)
      const outcomeSnapshot = tags.length > 0
        ? (typeof tags[0] === "string" ? tags[0] : tags[0].name)
        : null;
      await db.update(callListMembershipsTable)
        .set({ removed_at: new Date(), removal_reason: "called", outcome_at_removal: outcomeSnapshot })
        .where(eq(callListMembershipsTable.id, activeMembership.id));
    }
  } catch { /* ignore membership close failures */ }

  // Store conversation record (idempotent: check for existing by external_id)
  const [existing] = await db.select({ id: leadConversationsTable.id })
    .from(leadConversationsTable)
    .where(eq(leadConversationsTable.external_id, String(callId)))
    .limit(1);

  if (!existing) {
    await db.insert(leadConversationsTable).values({
      contact_id: contact.id,
      lead_id: contact.lead_id || null,
      source: "aircall",
      external_id: String(callId),
      direction: direction === "inbound" ? "inbound" : "outbound",
      duration_seconds: duration,
      agent_name: agent?.name || "Unknown",
      agent_notes: agentNotes,
      tags: tags.map((t: any) => t.name || t),
      call_outcome: null, // Set when tags arrive
      conversation_date: new Date(),
    });
  }

  // If tags already present on the call, process them
  if (tags.length > 0) {
    const tagMapping = await getTagMapping();
    for (const tag of tags) {
      const tagName = typeof tag === "string" ? tag : tag.name;
      if (tagName) {
        const outcome = await applyTagOutcome(contact.id, tagName, tagMapping);
        if (outcome) {
          // Also update the conversation record
          await db.update(leadConversationsTable)
            .set({ call_outcome: outcome })
            .where(eq(leadConversationsTable.external_id, String(callId)));
          break; // First matching tag wins
        }
      }
    }
  }
  return `${contact.first_name} ${contact.last_name} (${contact.id})`;
}

async function handleCallTagged(data: any): Promise<string | null> {
  const callId = data.call_id || data.id;
  const tag = data.tag;

  if (!tag) return null;

  const tagName = typeof tag === "string" ? tag : tag.name;
  if (!tagName) return null;

  // Only process tags for calls we already recorded — the conversation record
  // only exists if call.ended passed the agent filter.
  if (!callId) return "no call_id";
  const [conv] = await db.select().from(leadConversationsTable)
    .where(eq(leadConversationsTable.external_id, String(callId)))
    .limit(1);
  if (!conv?.contact_id) {
    return `skipped: no conversation record for call ${callId} (not our agent or call.ended not yet received)`;
  }
  const [contact] = await db.select().from(contactsTable)
    .where(eq(contactsTable.id, conv.contact_id))
    .limit(1);
  if (!contact) {
    return `no contact for conversation ${conv.id}`;
  }

  const tagMapping = await getTagMapping();
  const outcome = await applyTagOutcome(contact.id, tagName, tagMapping);

  // Update conversation record too
  if (outcome && callId) {
    await db.update(leadConversationsTable)
      .set({ call_outcome: outcome, tags: sql`COALESCE(${leadConversationsTable.tags}, '[]'::jsonb) || ${JSON.stringify([tagName])}::jsonb` })
      .where(eq(leadConversationsTable.external_id, String(callId)));
  }
  return `${contact.first_name} ${contact.last_name} → ${outcome || tagName}`;
}

async function handleCallCommented(data: any) {
  const callId = data.call_id || data.id;
  const comment = data.comment || data.content || data.text || "";
  if (!callId || !comment) return;

  // Update agent_notes on the conversation record
  const [updated] = await db.update(leadConversationsTable)
    .set({ agent_notes: comment })
    .where(eq(leadConversationsTable.external_id, String(callId)))
    .returning({ id: leadConversationsTable.id });

  if (updated) {
    console.log(`[Aircall Webhook] call.commented — stored agent notes for call ${callId}`);
  }
}

async function handleTranscriptionCreated(data: any): Promise<string> {
  const callId = data.call_id || data.id;
  if (!callId) return "no call_id in payload";

  // Fetch the transcript from Aircall API
  const auth = await getAircallAuth();
  if (!auth) return "no Aircall API credentials configured";

  const url = `https://api.aircall.io/v1/calls/${callId}/transcription`;
  const response = await fetch(url, { headers: { Authorization: auth } });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return `API ${response.status} from ${url} — ${body.slice(0, 200)}`;
  }

  const transcriptionData = await response.json() as any;

  // Aircall shape (2026): { transcription: { content: { utterances: [{ text, participant_type, ... }] } } }
  let transcriptText = "";
  const utterances = transcriptionData?.transcription?.content?.utterances
    || transcriptionData?.content?.utterances
    || transcriptionData?.transcription?.utterances
    || [];

  if (Array.isArray(utterances) && utterances.length > 0) {
    // Collapse consecutive utterances from the same participant into one line
    const lines: string[] = [];
    let currentSpeaker = "";
    let currentText: string[] = [];
    const flush = () => {
      if (currentText.length > 0) {
        lines.push(`${currentSpeaker}: ${currentText.join(" ")}`);
        currentText = [];
      }
    };
    for (const u of utterances) {
      const speaker = u.participant_type === "internal" ? "Agent"
                    : u.participant_type === "external" ? "Contact"
                    : (u.speaker || u.role || "Speaker");
      const text = (u.text || u.content || "").trim();
      if (!text) continue;
      if (speaker !== currentSpeaker) {
        flush();
        currentSpeaker = speaker;
      }
      currentText.push(text);
    }
    flush();
    transcriptText = lines.join("\n");
  } else {
    // Legacy / fallback shapes
    const segments = transcriptionData?.transcription?.segments
      || transcriptionData?.segments
      || transcriptionData?.data?.segments
      || [];
    if (Array.isArray(segments) && segments.length > 0) {
      transcriptText = segments.map((s: any) =>
        `${s.speaker || s.role || "Speaker"}: ${s.text || s.content || ""}`
      ).join("\n");
    } else if (typeof transcriptionData?.transcription?.text === "string") {
      transcriptText = transcriptionData.transcription.text;
    } else if (typeof transcriptionData?.text === "string") {
      transcriptText = transcriptionData.text;
    }
  }

  // Extract Aircall AI summary if provided on the same response
  const aircallSummary = transcriptionData?.transcription?.summary ||
                         transcriptionData?.summary ||
                         transcriptionData?.data?.summary || null;

  if (!transcriptText && !aircallSummary) {
    // Surface the response shape so we can adapt the parser
    const topKeys = Object.keys(transcriptionData || {}).join(",");
    const innerKeys = transcriptionData?.transcription && typeof transcriptionData.transcription === "object"
      ? Object.keys(transcriptionData.transcription).join(",")
      : "(not an object)";
    const snippet = JSON.stringify(transcriptionData).slice(0, 400);
    return `empty transcript+summary; top keys: [${topKeys}]; transcription keys: [${innerKeys}]; snippet: ${snippet}`;
  }

  // Build the update payload
  const conversationUpdate: Record<string, any> = {};
  if (transcriptText) conversationUpdate.transcript_text = transcriptText;
  if (aircallSummary) conversationUpdate.summary = aircallSummary;

  const summary = `stored${aircallSummary ? " transcript+summary" : " transcript"} (${transcriptText.length} chars)`;

  // Update the conversation record with transcript and summary
  const [updated] = await db.update(leadConversationsTable)
    .set(conversationUpdate)
    .where(eq(leadConversationsTable.external_id, String(callId)))
    .returning({ id: leadConversationsTable.id });

  if (updated) return `${summary} (updated existing)`;

  // No conversation record yet — call.ended might not have arrived first.
  // Fetch call data so we can verify the call was made by one of our agents
  // before creating a record.
  const callResponse = await fetch(`https://api.aircall.io/v1/calls/${callId}`, {
    headers: { Authorization: auth },
  });
  if (!callResponse.ok) {
    return `no existing conversation AND call fetch returned ${callResponse.status}`;
  }
  const callData = await callResponse.json() as any;
  const call = callData?.call || callData;
  const aircallUserId = call?.user?.id;
  const agent = await findAgentByAircallUser(aircallUserId);
  if (!agent) {
    return `skipped: Aircall user ${aircallUserId} (${call?.user?.name || "unknown"}) is not a registered agent`;
  }
  const rawDigits = extractPhone(call);
  const contact = await findContactByPhone(rawDigits);
  if (!contact) return `no existing conversation AND no contact for phone ${rawDigits}`;
  await db.insert(leadConversationsTable).values({
    contact_id: contact.id,
    lead_id: contact.lead_id || null,
    source: "aircall",
    external_id: String(callId),
    direction: "outbound",
    agent_name: agent.name,
    transcript_text: transcriptText || null,
    summary: aircallSummary || null,
    conversation_date: new Date(),
  });
  return `${summary} (new conversation, contact ${contact.first_name} ${contact.last_name})`;
}

async function handleSummaryCreated(data: any): Promise<string> {
  const callId = data.call_id || data.id;
  if (!callId) return "no call_id in payload";

  const auth = await getAircallAuth();
  if (!auth) return "no Aircall API credentials configured";

  const url = `https://api.aircall.io/v1/calls/${callId}/summary`;
  const response = await fetch(url, { headers: { Authorization: auth } });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return `API ${response.status} from ${url} — ${body.slice(0, 200)}`;
  }

  const summaryData = await response.json() as any;
  // Aircall may return the summary under various keys — try the common ones
  const summaryText: string =
    summaryData?.summary?.content ||
    summaryData?.summary?.text ||
    summaryData?.content ||
    summaryData?.text ||
    (typeof summaryData?.summary === "string" ? summaryData.summary : "") ||
    "";

  if (!summaryText) {
    const keys = Object.keys(summaryData || {}).join(",");
    return `empty summary; response keys: [${keys}]`;
  }

  // Update existing conversation record (only exists if call.ended already passed agent filter)
  const [updated] = await db.update(leadConversationsTable)
    .set({ summary: summaryText })
    .where(eq(leadConversationsTable.external_id, String(callId)))
    .returning({ id: leadConversationsTable.id });

  if (updated) return `stored summary (${summaryText.length} chars) on existing conversation`;

  // Fallback — no conversation yet. Verify call is from our agent before inserting.
  const callResp = await fetch(`https://api.aircall.io/v1/calls/${callId}`, { headers: { Authorization: auth } });
  if (!callResp.ok) return `no existing conversation AND call fetch returned ${callResp.status}`;
  const callData = await callResp.json() as any;
  const call = callData?.call || callData;
  const agent = await findAgentByAircallUser(call?.user?.id);
  if (!agent) {
    return `skipped: Aircall user ${call?.user?.id} (${call?.user?.name || "unknown"}) is not a registered agent`;
  }
  const rawDigits = extractPhone(call);
  const contact = await findContactByPhone(rawDigits);
  if (!contact) return `no existing conversation AND no contact for phone ${rawDigits}`;

  await db.insert(leadConversationsTable).values({
    contact_id: contact.id,
    lead_id: contact.lead_id || null,
    source: "aircall",
    external_id: String(callId),
    direction: "outbound",
    agent_name: agent.name,
    summary: summaryText,
    conversation_date: new Date(),
  });
  return `stored summary (${summaryText.length} chars) on new conversation for ${contact.first_name} ${contact.last_name}`;
}

export default router;
