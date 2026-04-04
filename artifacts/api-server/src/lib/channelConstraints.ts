import type { Channel } from "@workspace/db";

export interface ChannelViolation {
  check: string;
  message: string;
  severity: "fail" | "warning";
}

export function validateChannelCompliance(
  content: string,
  channel: Channel
): ChannelViolation[] {
  const violations: ChannelViolation[] = [];
  const words = content.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const lines = content.split("\n").filter(Boolean);
  const sentences = content.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const links = (content.match(/https?:\/\/\S+/g) || []).length;

  if (channel.max_words && wordCount > channel.max_words) {
    violations.push({
      check: "WORD_COUNT",
      message: `Content has ${wordCount} words, max allowed is ${channel.max_words}`,
      severity: "fail",
    });
  }

  if (channel.max_links && links > channel.max_links) {
    violations.push({
      check: "LINK_COUNT",
      message: `Content has ${links} links, max allowed is ${channel.max_links}`,
      severity: "fail",
    });
  }

  if (channel.max_lines && lines.length > channel.max_lines) {
    violations.push({
      check: "LINE_COUNT",
      message: `Content has ${lines.length} lines, max allowed is ${channel.max_lines}`,
      severity: "fail",
    });
  }

  if (channel.max_sentences && sentences.length > channel.max_sentences) {
    violations.push({
      check: "SENTENCE_COUNT",
      message: `Content has ${sentences.length} sentences, max allowed is ${channel.max_sentences}`,
      severity: "fail",
    });
  }

  if (channel.body_max_chars && content.length > channel.body_max_chars) {
    violations.push({
      check: "BODY_LENGTH",
      message: `Body has ${content.length} chars, max allowed is ${channel.body_max_chars}`,
      severity: "fail",
    });
  }

  const prohibited = (channel.prohibited as string[]) || [];
  for (const term of prohibited) {
    if (content.toLowerCase().includes(term.toLowerCase())) {
      violations.push({
        check: "PROHIBITED_CONTENT",
        message: `Content contains prohibited term for this channel: "${term}"`,
        severity: "fail",
      });
    }
  }

  return violations;
}

export function getOutputTypeForChannel(channelId: string): string {
  const mapping: Record<string, string> = {
    email_cold: "email",
    email_warm: "email",
    email_nurture: "email",
    whatsapp: "whatsapp-template",
    linkedin_message: "linkedin-message",
    meta_ad: "ad-brief",
    linkedin_ad: "ad-brief",
    display_ad: "ad-brief",
    call_script: "call-script",
    voicemail: "call-script",
  };
  return mapping[channelId] || "email";
}

export function buildChannelConstraintPrompt(channel: Channel): string {
  const parts: string[] = [];
  parts.push(`Channel: ${channel.name} (${channel.id})`);
  parts.push(`Format: ${channel.format}`);

  if (channel.max_words) parts.push(`Max words: ${channel.max_words}`);
  if (channel.max_links) parts.push(`Max links: ${channel.max_links}`);
  if (channel.max_ctas) parts.push(`Max CTAs: ${channel.max_ctas}`);
  if (channel.max_lines) parts.push(`Max lines: ${channel.max_lines}`);
  if (channel.max_sentences)
    parts.push(`Max sentences: ${channel.max_sentences}`);
  if (channel.max_duration_seconds)
    parts.push(`Max duration: ${channel.max_duration_seconds}s`);
  if (channel.headline_max_chars)
    parts.push(`Headline max chars: ${channel.headline_max_chars}`);
  if (channel.body_max_chars)
    parts.push(`Body max chars: ${channel.body_max_chars}`);
  if (channel.subject_max_words)
    parts.push(`Subject max words: ${channel.subject_max_words}`);
  if (channel.subject_max_chars)
    parts.push(`Subject max chars: ${channel.subject_max_chars}`);
  if (channel.goal) parts.push(`Goal: ${channel.goal}`);

  const prohibited = (channel.prohibited as string[]) || [];
  if (prohibited.length > 0) {
    parts.push(`Prohibited: ${prohibited.join(", ")}`);
  }

  const ctaOptions = (channel.cta_options as string[]) || [];
  if (ctaOptions.length > 0) {
    parts.push(`CTA options: ${ctaOptions.join(", ")}`);
  }

  const formats = (channel.formats as string[]) || [];
  if (formats.length > 0) {
    parts.push(`Ad formats: ${formats.join(", ")}`);
  }

  return parts.join("\n");
}
