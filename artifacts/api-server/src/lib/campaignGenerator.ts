import { db, acuTable, channelsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { buildChannelConstraintPrompt, getOutputTypeForChannel } from "./channelConstraints";

interface CampaignBrief {
  campaign_id: string;
  name: string;
  description?: string;
  target_cluster: string;
  personas: string[];
  entry_stage: string;
  target_stage: string;
  channels: string[];
  duration_weeks: number;
  daily_volume?: number;
  primary_belief?: string;
  secondary_beliefs?: string[];
  primary_cta?: string;
  secondary_cta?: string;
  lead_magnet?: string;
  compliance_constraints?: string[];
  blocked_content?: string[];
  prohibited_acus?: string[];
  notes?: string;
}

interface SequenceNode {
  node_id: string;
  day: number;
  channel: string;
  content_id: string;
  title: string;
  output_type: string;
  branch_condition?: string;
  next_nodes: {
    condition: string;
    node_id: string;
    day: number;
  }[];
}

const GENERIC_TO_SPECIFIC: Record<string, string[]> = {
  email: ["email_cold", "email_warm", "email_nurture"],
  call: ["call_script", "voicemail"],
  linkedin: ["linkedin_message"],
  meta: ["meta_ad"],
  display: ["display_ad"],
  whatsapp: ["whatsapp"],
};

function resolveChannelSet(channels: string[]): Set<string> {
  const resolved = new Set<string>();
  for (const ch of channels) {
    const mapped = GENERIC_TO_SPECIFIC[ch];
    if (mapped) {
      for (const m of mapped) resolved.add(m);
    } else {
      resolved.add(ch);
    }
  }
  return resolved;
}

interface TemplateTouchpoint {
  id: string;
  day: number;
  channel: string;
  title: string;
  branch_condition?: string;
  branches?: { condition: string; target_id: string; target_day: number }[];
}

const COLD_OUTREACH_TEMPLATE: TemplateTouchpoint[] = [
  {
    id: "E1", day: 0, channel: "email_cold", title: "E1 — Cold Introduction",
    branches: [
      { condition: "opened_no_click", target_id: "E2A", target_day: 3 },
      { condition: "no_open", target_id: "E2B", target_day: 3 },
      { condition: "clicked", target_id: "E2C", target_day: 3 },
    ],
  },
  { id: "E2A", day: 3, channel: "email_cold", title: "E2A — Opened, Different Angle", branch_condition: "opened_no_click" },
  { id: "E2B", day: 3, channel: "email_cold", title: "E2B — No Open, New Subject", branch_condition: "no_open" },
  { id: "E2C", day: 3, channel: "email_cold", title: "E2C — Clicked, Friction Removal", branch_condition: "clicked" },
  { id: "LI1", day: 5, channel: "linkedin_message", title: "LI1 — LinkedIn InMail" },
  { id: "CS1", day: 5, channel: "call_script", title: "CS1 — First Call Attempt" },
  { id: "VM1", day: 5, channel: "voicemail", title: "VM1 — Voicemail Drop" },
  {
    id: "E3", day: 7, channel: "email_warm", title: "E3 — Social Proof Email",
    branches: [
      { condition: "opened_no_click", target_id: "E4", target_day: 21 },
      { condition: "no_open", target_id: "E4", target_day: 21 },
      { condition: "clicked", target_id: "E4", target_day: 21 },
    ],
  },
  { id: "CS2", day: 7, channel: "call_script", title: "CS2 — Second Call Attempt" },
  { id: "VM2", day: 7, channel: "voicemail", title: "VM2 — Second Voicemail" },
  { id: "CS3", day: 14, channel: "call_script", title: "CS3 — Final Call Attempt" },
  { id: "E4", day: 21, channel: "email_warm", title: "E4 — Head-Start Framing" },
  { id: "E5", day: 42, channel: "email_warm", title: "E5 — Final Attempt Sign-off" },
  { id: "EXIT", day: 56, channel: "email_warm", title: "EXIT — 8-Week Exit Automation" },
];

const AD_TEMPLATE: TemplateTouchpoint[] = [
  { id: "AD1_cold", day: 0, channel: "meta_ad", title: "AD1 — Meta Cold Awareness" },
  { id: "AD1_warm", day: 0, channel: "meta_ad", title: "AD1 — Meta Warm Retarget" },
  { id: "AD1_hot", day: 0, channel: "meta_ad", title: "AD1 — Meta Hot Convert" },
  { id: "AD2", day: 0, channel: "linkedin_ad", title: "AD2 — LinkedIn Sponsored" },
  { id: "AD3", day: 0, channel: "display_ad", title: "AD3 — Display Awareness" },
];

const WARM_NURTURE_TEMPLATE: TemplateTouchpoint[] = [
  { id: "E1", day: 0, channel: "email_warm", title: "E1 — Warm Re-engagement" },
  { id: "WA1", day: 2, channel: "whatsapp", title: "WA1 — Quick Update" },
  { id: "E2", day: 5, channel: "email_warm", title: "E2 — Insight Delivery" },
  { id: "LI1", day: 7, channel: "linkedin_message", title: "LI1 — LinkedIn Follow" },
  { id: "CS1", day: 10, channel: "call_script", title: "CS1 — Scheduled Call" },
  { id: "E3", day: 14, channel: "email_nurture", title: "E3 — Deep Dive Content" },
  { id: "WA2", day: 18, channel: "whatsapp", title: "WA2 — Meeting Confirmation" },
];

export function buildSequenceFromBrief(brief: CampaignBrief): SequenceNode[] {
  const allowedChannels = resolveChannelSet(brief.channels);
  const hasAdChannels = allowedChannels.has("meta_ad") || allowedChannels.has("linkedin_ad") || allowedChannels.has("display_ad");

  let templates: TemplateTouchpoint[] = [];

  if (brief.entry_stage === "Outreach" || brief.entry_stage === "Cold") {
    templates = [...COLD_OUTREACH_TEMPLATE];
  } else {
    templates = [...WARM_NURTURE_TEMPLATE];
  }

  if (hasAdChannels) {
    templates = [...templates, ...AD_TEMPLATE];
  }

  const filtered = templates.filter((t) => allowedChannels.has(t.channel));

  const nodes: SequenceNode[] = [];
  const idMap = new Map<string, string>();

  filtered.forEach((t, i) => {
    const nodeId = `touch_${String(i + 1).padStart(2, "0")}_${t.id.toLowerCase()}`;
    idMap.set(t.id, nodeId);
  });

  for (let i = 0; i < filtered.length; i++) {
    const t = filtered[i];
    const nodeId = idMap.get(t.id)!;
    const contentId = `${brief.campaign_id}_${t.id.toLowerCase()}`;

    const nextNodes: SequenceNode["next_nodes"] = [];
    if (t.branches) {
      for (const br of t.branches) {
        const targetNodeId = idMap.get(br.target_id);
        if (targetNodeId) {
          nextNodes.push({
            condition: br.condition,
            node_id: targetNodeId,
            day: br.target_day,
          });
        }
      }
    }

    nodes.push({
      node_id: nodeId,
      day: t.day,
      channel: t.channel,
      content_id: contentId,
      title: t.title,
      output_type: getOutputTypeForChannel(t.channel),
      branch_condition: t.branch_condition,
      next_nodes: nextNodes,
    });
  }

  return nodes;
}

export async function buildAssetGenerationPrompt(
  node: SequenceNode,
  brief: CampaignBrief,
  channelConfig: any,
  acuSection: string
): Promise<string> {
  const channelConstraints = channelConfig
    ? buildChannelConstraintPrompt(channelConfig)
    : `Channel: ${node.channel}`;

  return `You are the content engine for Unlock, a UK fintech specialising in EIS/SEIS portfolio intelligence.

Generate content for a campaign touchpoint.

CAMPAIGN CONTEXT:
- Campaign: ${brief.name}
${brief.description ? `- Description: ${brief.description}` : ""}
- Target cluster: ${brief.target_cluster}
- Target personas: ${brief.personas.join(", ")}
- Entry stage: ${brief.entry_stage} → Target stage: ${brief.target_stage}
- Primary belief to establish: ${brief.primary_belief || "General awareness"}
- Secondary beliefs: ${(brief.secondary_beliefs || []).join(", ") || "None"}
- Primary CTA: ${brief.primary_cta || "Learn more"}
- Secondary CTA: ${brief.secondary_cta || "None"}
${brief.lead_magnet ? `- Lead magnet: ${brief.lead_magnet}` : ""}
${brief.notes ? `\nNotes: ${brief.notes}` : ""}

TOUCHPOINT:
- Title: ${node.title}
- Day ${node.day} in sequence
- Content ID: ${node.content_id}
${node.branch_condition ? `- Branch condition: ${node.branch_condition}` : ""}

CHANNEL CONSTRAINTS:
${channelConstraints}

${acuSection}

COMPLIANCE RULES:
- Use British English spelling throughout
- Never say "shareholder" — always "Founding investor"
- Never use discount tier percentages
- Include "Capital at risk" qualifier where appropriate
- Include "subject to individual tax circumstances" where appropriate
- All figures must match LOCKED ACU content verbatim
${(brief.prohibited_acus || []).length > 0 ? `\nPROHIBITED CONTENT (any occurrence triggers QC failure):\n${brief.prohibited_acus!.map((id) => `- ${id}`).join("\n")}` : ""}

OUTPUT REQUIREMENTS:
${node.channel.startsWith("email") ? `- Subject line (within channel word limits)
- Body text (within channel word limits)
- CTA text
- Preview text (max 90 chars)` : ""}
${node.channel === "call_script" ? `- Opening line (under 15 seconds)
- Key talking points (max 3)
- Objection responses (max ${channelConfig?.max_objection_responses || 3})
- Closing / meeting ask
- Goal: ${channelConfig?.goal || "book_meeting_not_sell"}` : ""}
${node.channel === "voicemail" ? `- Voicemail script (max ${channelConfig?.max_words || 60} words, under ${channelConfig?.max_duration_seconds || 30}s)` : ""}
${node.channel === "whatsapp" ? `- Template message (max ${channelConfig?.max_lines || 5} lines)
- No corporate sign-offs
- No pitch language` : ""}
${node.channel === "linkedin_message" ? `- Subject line (max ${channelConfig?.subject_max_chars || 60} chars)
- Message body (max ${channelConfig?.max_sentences || 3} sentences)` : ""}
${node.channel.includes("ad") ? `- Headline (max ${channelConfig?.headline_max_chars || 40} chars)
- Body copy (max ${channelConfig?.body_max_chars || 125} chars)
- CTA: one of ${(channelConfig?.cta_options || ["Learn More"]).join(", ")}
- Ad sizes: ${(channelConfig?.formats || []).join(", ")}` : ""}

Generate the content now. Output as structured markdown with clear section headers.`;
}

export function buildACBuildInstructions(brief: CampaignBrief, sequence: SequenceNode[]): object {
  const emailNodes = sequence.filter((n) => n.channel.startsWith("email"));
  const automations = emailNodes.map((node, i) => ({
    step: i + 1,
    automation_name: `${brief.campaign_id}_${node.node_id}`,
    trigger: i === 0 ? "Tag added: " + brief.campaign_id : `Wait ${node.day - (emailNodes[i - 1]?.day || 0)} days`,
    action: "Send email",
    email_name: node.title,
    content_id: node.content_id,
    conditions: node.next_nodes.map((nn) => ({
      if: nn.condition,
      then: `Go to ${nn.node_id}`,
      wait_days: nn.day - node.day,
    })),
  }));

  return {
    platform: "ActiveCampaign",
    campaign_id: brief.campaign_id,
    campaign_name: brief.name,
    entry_tag: brief.campaign_id,
    list_segment: `${brief.target_cluster} — ${brief.entry_stage}`,
    daily_send_limit: brief.daily_volume || 100,
    custom_fields: [
      { field: "campaign_source", value: brief.campaign_id },
      { field: "target_cluster", value: brief.target_cluster },
      { field: "entry_stage", value: brief.entry_stage },
      { field: "call_attempts", value: 0, type: "counter" },
    ],
    automations,
    notes: [
      `Create tag '${brief.campaign_id}' before building`,
      "Import contacts to segment before activation",
      "Test with internal list first",
      "Set daily send limit to " + (brief.daily_volume || 100),
      "Configure branch conditions for E1 (Day 3: opened_no_click / no_open / clicked)",
      "Link Aircall tags to automation triggers via Zapier",
    ],
  };
}

export function buildTagTable(brief: CampaignBrief, sequence: SequenceNode[]): object {
  const callNodes = sequence.filter((n) => n.channel === "call_script" || n.channel === "voicemail");

  const tags = [
    {
      aircall_tag: "interested",
      title: "Contact expressed interest",
      trigger_action: "Applied after call when contact shows interest",
      day: null,
      email_action: "Stop cold sequence → start warm nurture",
      ad_action: "Move to unlock-hot audience",
      crm_action: "Create deal. Stage: Interested. Assign to Tom.",
    },
    {
      aircall_tag: "meeting-booked",
      title: "Meeting booked during call",
      trigger_action: "Applied when contact agrees to a meeting",
      day: null,
      email_action: "Stop ALL sequences → fire confirmation email immediately",
      ad_action: "Remove from ALL audiences",
      crm_action: "Move to Demo Booked. Create meeting activity.",
    },
    {
      aircall_tag: "no-answer",
      title: "No answer on call attempt",
      trigger_action: "Applied when call goes unanswered",
      day: null,
      email_action: "Increment Call Attempts +1",
      ad_action: "No change",
      crm_action: "Log call. Schedule next attempt.",
    },
    {
      aircall_tag: "no-answer-3x",
      title: "Third consecutive no-answer",
      trigger_action: "Applied on 3rd unanswered call",
      day: null,
      email_action: "Reduce email cadence",
      ad_action: "Downgrade to passive display only",
      crm_action: "Tag: Exhausted Calls.",
    },
    {
      aircall_tag: "callback-requested",
      title: "Contact requested callback",
      trigger_action: "Applied when contact asks to be called back",
      day: null,
      email_action: "Fire confirmation email. Pause sequence.",
      ad_action: "No change",
      crm_action: "Create callback activity with date/time.",
    },
    {
      aircall_tag: "not-now",
      title: "Contact said not now",
      trigger_action: "Applied when timing is wrong but not rejected",
      day: null,
      email_action: "Pause all sequences 28 days",
      ad_action: "Downgrade to warm/passive",
      crm_action: "Schedule follow-up +28 days.",
    },
    {
      aircall_tag: "no-interest",
      title: "Contact has no interest",
      trigger_action: "Applied when contact explicitly declines",
      day: null,
      email_action: "Stop ALL sequences. Add to suppression.",
      ad_action: "Remove from ALL audiences",
      crm_action: "Mark Lost. Tag: No Interest.",
    },
  ];

  const callSchedule = callNodes.map((node) => ({
    node_id: node.node_id,
    title: node.title,
    day: node.day,
    channel: node.channel,
    content_id: node.content_id,
    post_call_actions: [
      { outcome: "connected_interested", tag: "interested" },
      { outcome: "meeting_booked", tag: "meeting-booked" },
      { outcome: "no_answer", tag: "no-answer" },
      { outcome: "callback_requested", tag: "callback-requested" },
      { outcome: "not_now", tag: "not-now" },
      { outcome: "no_interest", tag: "no-interest" },
    ],
  }));

  return {
    campaign_id: brief.campaign_id,
    campaign_name: brief.name,
    tags,
    call_schedule: callSchedule,
    notes: [
      "Tags are applied manually by the caller in Aircall after each call",
      "All downstream actions fire automatically via Zapier/AC integrations",
      "no-answer-3x fires automatically when no-answer count reaches 3",
    ],
  };
}
