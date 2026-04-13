import { Router, type IRouter } from "express";
import { db, contactsTable, leadConversationsTable, integrationConfigsTable, agentsTable } from "@workspace/db";
import { eq, or, sql } from "drizzle-orm";

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

// ==================== Webhook Endpoint ====================

router.post("/aircall/webhook", async (req, res): Promise<void> => {
  // Always respond 200 quickly — Aircall retries on non-200
  const event = req.body?.event;
  const data = req.body?.data;

  if (!event || !data) {
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
      await handleCallEnded(data);
      res.status(200).json({ status: "processed", event: "call.ended" });
    } else if (event === "call.tagged") {
      await handleCallTagged(data);
      res.status(200).json({ status: "processed", event: "call.tagged" });
    } else {
      res.status(200).json({ status: "ignored", event });
    }
  } catch (err: any) {
    console.error(`[Aircall Webhook] Error processing ${event}:`, err.message);
    // Still return 200 to prevent Aircall retries on our errors
    res.status(200).json({ status: "error", message: err.message });
  }
});

// GET /aircall/webhook — health check (Aircall pings this)
router.get("/aircall/webhook", async (_req, res): Promise<void> => {
  res.json({ status: "ok", handler: "aircall-webhook" });
});

// ==================== Event Handlers ====================

async function handleCallEnded(data: any) {
  const callId = data.id || data.call_id;
  const duration = data.duration || 0;
  const direction = data.direction || "outbound";
  const rawDigits = data.raw_digits || data.number?.digits || "";
  const aircallUserId = data.user?.id;
  const tags = data.tags || [];

  // Find the contact
  const contact = await findContactByPhone(rawDigits);
  if (!contact) {
    console.warn(`[Aircall Webhook] call.ended — no contact found for ${rawDigits}`);
    return;
  }

  // Find the agent
  const agent = await findAgentByAircallUser(aircallUserId);

  // Update contact: mark as called, increment attempts
  await db.update(contactsTable).set({
    dispatch_status: "called",
    call_attempts: sql`${contactsTable.call_attempts} + 1`,
  }).where(eq(contactsTable.id, contact.id));

  // Store conversation record only if contact has a linked lead
  if (contact.lead_id) {
    const [existing] = await db.select({ id: leadConversationsTable.id })
      .from(leadConversationsTable)
      .where(eq(leadConversationsTable.external_id, String(callId)))
      .limit(1);

    if (!existing) {
      await db.insert(leadConversationsTable).values({
        lead_id: contact.lead_id,
        source: "aircall",
        external_id: String(callId),
        direction: direction === "inbound" ? "inbound" : "outbound",
        duration_seconds: duration,
        agent_name: agent?.name || "Unknown",
        tags: tags.map((t: any) => t.name || t),
        call_outcome: null, // Set when tags arrive
        conversation_date: new Date(),
      });
    }
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
}

async function handleCallTagged(data: any) {
  const callId = data.call_id || data.id;
  const tag = data.tag;
  const rawDigits = data.raw_digits || data.number?.digits || "";

  if (!tag) return;

  const tagName = typeof tag === "string" ? tag : tag.name;
  if (!tagName) return;

  // Try to find contact via phone number from the call data
  let contact = await findContactByPhone(rawDigits);

  // If no phone in the tag event, try finding via the conversation record
  if (!contact && callId) {
    const [conv] = await db.select().from(leadConversationsTable)
      .where(eq(leadConversationsTable.external_id, String(callId)))
      .limit(1);
    if (conv?.lead_id) {
      // lead_id might be a contact ID (we store contact.id when no lead exists)
      const [c] = await db.select().from(contactsTable)
        .where(eq(contactsTable.id, conv.lead_id))
        .limit(1);
      contact = c || null;
    }
  }

  if (!contact) {
    console.warn(`[Aircall Webhook] call.tagged — no contact found for call ${callId}`);
    return;
  }

  const tagMapping = await getTagMapping();
  const outcome = await applyTagOutcome(contact.id, tagName, tagMapping);

  // Update conversation record too
  if (outcome && callId) {
    await db.update(leadConversationsTable)
      .set({ call_outcome: outcome, tags: sql`COALESCE(${leadConversationsTable.tags}, '[]'::jsonb) || ${JSON.stringify([tagName])}::jsonb` })
      .where(eq(leadConversationsTable.external_id, String(callId)));
  }
}

export default router;
