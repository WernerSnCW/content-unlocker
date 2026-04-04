import { db, acuTable, channelsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { buildChannelConstraintPrompt, getOutputTypeForChannel } from "./channelConstraints";

interface CampaignBrief {
  campaign_id: string;
  name: string;
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
  compliance_constraints?: string[];
  blocked_content?: string[];
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

const CHANNEL_SEQUENCE_TEMPLATES: Record<string, { channel: string; dayOffset: number; title: string; condition?: string }[]> = {
  cold_outreach: [
    { channel: "email_cold", dayOffset: 0, title: "E1 — Cold Introduction" },
    { channel: "email_cold", dayOffset: 3, title: "E2 — Value Follow-up" },
    { channel: "linkedin_message", dayOffset: 2, title: "LI1 — LinkedIn Connect" },
    { channel: "call_script", dayOffset: 5, title: "CS1 — First Call" },
    { channel: "voicemail", dayOffset: 5, title: "VM1 — Voicemail" },
    { channel: "email_warm", dayOffset: 7, title: "E3 — Social Proof Email" },
    { channel: "whatsapp", dayOffset: 8, title: "WA1 — Report Delivery" },
    { channel: "email_warm", dayOffset: 12, title: "E4 — Case Study Email" },
    { channel: "call_script", dayOffset: 14, title: "CS2 — Second Call" },
    { channel: "email_warm", dayOffset: 18, title: "E5 — Final Value Email" },
  ],
  warm_nurture: [
    { channel: "email_warm", dayOffset: 0, title: "E1 — Warm Re-engagement" },
    { channel: "whatsapp", dayOffset: 2, title: "WA1 — Quick Update" },
    { channel: "email_warm", dayOffset: 5, title: "E2 — Insight Delivery" },
    { channel: "linkedin_message", dayOffset: 7, title: "LI1 — LinkedIn Follow" },
    { channel: "call_script", dayOffset: 10, title: "CS1 — Scheduled Call" },
    { channel: "email_nurture", dayOffset: 14, title: "E3 — Deep Dive Content" },
    { channel: "whatsapp", dayOffset: 18, title: "WA2 — Meeting Confirmation" },
  ],
  ad_campaign: [
    { channel: "meta_ad", dayOffset: 0, title: "AD1 — Meta Cold Awareness" },
    { channel: "linkedin_ad", dayOffset: 0, title: "AD2 — LinkedIn Targeted" },
    { channel: "display_ad", dayOffset: 0, title: "AD3 — Display Retarget" },
    { channel: "meta_ad", dayOffset: 14, title: "AD4 — Meta Warm Retarget" },
    { channel: "linkedin_ad", dayOffset: 14, title: "AD5 — LinkedIn Conversion" },
  ],
};

export function buildSequenceFromBrief(brief: CampaignBrief): SequenceNode[] {
  const nodes: SequenceNode[] = [];
  const availableChannels = new Set(brief.channels);

  const hasEmailChannels = availableChannels.has("email");
  const hasAdChannels = availableChannels.has("meta") || availableChannels.has("display");

  let templates: typeof CHANNEL_SEQUENCE_TEMPLATES.cold_outreach = [];

  if (brief.entry_stage === "Outreach" || brief.entry_stage === "Cold") {
    templates = [...CHANNEL_SEQUENCE_TEMPLATES.cold_outreach];
  } else {
    templates = [...CHANNEL_SEQUENCE_TEMPLATES.warm_nurture];
  }

  if (hasAdChannels) {
    templates = [...templates, ...CHANNEL_SEQUENCE_TEMPLATES.ad_campaign];
  }

  const channelMapping: Record<string, string> = {
    email: "email_cold",
    call: "call_script",
    linkedin: "linkedin_message",
    meta: "meta_ad",
    display: "display_ad",
    whatsapp: "whatsapp",
  };

  const allowedChannelIds = new Set<string>();
  for (const ch of brief.channels) {
    const mapped = channelMapping[ch];
    if (mapped) allowedChannelIds.add(mapped);
    if (ch === "email") {
      allowedChannelIds.add("email_cold");
      allowedChannelIds.add("email_warm");
      allowedChannelIds.add("email_nurture");
    }
    if (ch === "call") {
      allowedChannelIds.add("call_script");
      allowedChannelIds.add("voicemail");
    }
  }

  let nodeIndex = 0;
  for (const tmpl of templates) {
    if (!allowedChannelIds.has(tmpl.channel)) continue;

    const nodeId = `touch_${String(nodeIndex + 1).padStart(2, "0")}_${tmpl.channel}`;
    const contentId = `${brief.campaign_id}_${tmpl.channel}_${nodeIndex + 1}`;

    const nextNodes: SequenceNode["next_nodes"] = [];
    if (tmpl.channel.startsWith("email")) {
      const nextDay = tmpl.dayOffset + 4;
      nextNodes.push(
        { condition: "opened_no_click", node_id: `touch_${String(nodeIndex + 2).padStart(2, "0")}_followup`, day: nextDay },
        { condition: "no_open", node_id: `touch_${String(nodeIndex + 2).padStart(2, "0")}_resend`, day: nextDay },
        { condition: "clicked", node_id: `touch_${String(nodeIndex + 2).padStart(2, "0")}_advance`, day: nextDay }
      );
    }

    nodes.push({
      node_id: nodeId,
      day: tmpl.dayOffset,
      channel: tmpl.channel,
      content_id: contentId,
      title: tmpl.title,
      output_type: getOutputTypeForChannel(tmpl.channel),
      branch_condition: tmpl.condition,
      next_nodes: nextNodes,
    });

    nodeIndex++;
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
- Target cluster: ${brief.target_cluster}
- Target personas: ${brief.personas.join(", ")}
- Entry stage: ${brief.entry_stage} → Target stage: ${brief.target_stage}
- Primary belief to establish: ${brief.primary_belief || "General awareness"}
- Secondary beliefs: ${(brief.secondary_beliefs || []).join(", ") || "None"}
- Primary CTA: ${brief.primary_cta || "Learn more"}
- Secondary CTA: ${brief.secondary_cta || "None"}
${brief.notes ? `\nNotes: ${brief.notes}` : ""}

TOUCHPOINT:
- Title: ${node.title}
- Day ${node.day} in sequence
- Content ID: ${node.content_id}

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
    automation_name: `${brief.campaign_id}_${node.channel}_day${node.day}`,
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
    automations,
    notes: [
      "Create tag '" + brief.campaign_id + "' before building",
      "Import contacts to segment before activation",
      "Test with internal list first",
    ],
  };
}

export function buildTagTable(brief: CampaignBrief, sequence: SequenceNode[]): object[] {
  const callNodes = sequence.filter((n) => n.channel === "call_script" || n.channel === "voicemail");
  return callNodes.map((node) => ({
    aircall_tag: `${brief.campaign_id}_${node.node_id}`,
    trigger_action: node.channel === "call_script" ? "Outbound call placed" : "Voicemail left",
    content_reference: node.content_id,
    title: node.title,
    day: node.day,
    post_call_actions: [
      { outcome: "connected_interested", action: "Move to Called stage, add meeting tag" },
      { outcome: "connected_not_interested", action: "Add objection tag, schedule follow-up +7 days" },
      { outcome: "no_answer", action: "Leave voicemail, schedule retry +2 days" },
      { outcome: "wrong_number", action: "Flag for data cleanup" },
    ],
  }));
}
