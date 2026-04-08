import { anthropic } from "@workspace/integrations-anthropic-ai";
import { claudeWithTimeout } from "./claudeTimeout";
import { BRAND } from "./brand";

interface FormatInput {
  name: string;
  file_code: string;
  content: string;
  tier?: number;
  category?: string;
  version?: number;
  description?: string;
}

const DESIGN_BIBLE_SYSTEM = `You are the Unlock Design Bible formatting engine. You convert raw document content (markdown) into clean, Google Docs-compatible HTML that strictly follows the Unlock Design Bible v0.2.

## OUTPUT FORMAT
Return ONLY the formatted HTML body content. No <html>, <head>, or <body> wrapper tags — just the content elements. The caller will wrap your output in the document shell with logo and footer.

## DESIGN BIBLE RULES — MANDATORY

### Typography (all sizes in pt, Google Docs compatible)
- H1: 20pt, bold, color #0F1629 (dark navy). Title Case. Use for numbered section headings.
- H2: 14pt, bold, color #0F1629. Title Case. Use for sub-section headings.
- H3: 12pt, bold, color #2D2D3F (charcoal). Title Case.
- H4: 11pt, bold, color #2D2D3F. Title Case.
- Body text: 11pt, regular weight, color #1A1A2E. Sentence case. Line height 1.5.
- Small print / metadata: 9pt, color #888888.

### Spacing (8pt grid)
- H1: 32pt margin-top, 16pt margin-bottom (space-xl before, space-md after)
- H2: 24pt margin-top, 8pt margin-bottom (space-lg before, space-sm after)
- H3/H4: 16pt margin-top, 8pt margin-bottom
- Paragraphs: 8pt margin-bottom (space-sm)
- Between sections: 32pt gap

### Colour Rules — CRITICAL
- Brand Green #01BC77: ONLY for fills, table header backgrounds, badges. NEVER for body text.
- Text Green #008655: For text that needs green emphasis — scores, callout labels, section anchors. Passes WCAG AA 4.5:1 on white.
- Near-black #1A1A2E: All body text, all headings, neutral table headers.
- White #FFFFFF: Text on dark surfaces only.
- NEVER place white text on Brand Green — fails WCAG (2.48:1 ratio). Use near-black text on green fills.

### Writing Rules
1. Downside before upside. Always.
2. Lead with the claim — first sentence of every paragraph states what it's about.
3. Short sentences. Topic sentences: 8–15 words. Maximum ~35 words.
4. Active voice. 'Unlock Access evaluates every company' not 'Every company is evaluated.'
5. Em dashes for parentheticals — not commas, not brackets.
6. No bullet-point prose in long-form. Bullets only in factsheets for scannable lists.
7. Bold for first-use definitions only — not general emphasis.
8. Process sequences use →.
9. No superlatives unless provably true and cited.
10. No hedging language ('may', 'might', 'could possibly') unless legally required.

### Number & Currency Formats
- Currency exact: £50,000
- Currency large: £34B+, £6.5M
- Percentages: 30%, 68% — never 'percent'
- Dates in prose: April 2027, March 2026
- Dates specific: 6 April 2026

### Terminology
- Use "Unlock Access" not "the platform"
- EIS / SEIS always capitalised
- "Programme" not "Program"
- "Net invested" not "Amount invested"
- "Win rate" not "Success rate"
- "Income tax relief" not "Tax relief"

### Table Formatting
- Table headers: background-color #0F1629 (dark navy), white text, bold, 9pt, uppercase
- Table body: 10pt, alternating rows white/#F5F5F5
- Cell padding: 6pt top/bottom, 10pt left/right
- Border: 1px solid #E0E0E0 on bottom of each row
- Use <td> not <th> — Google Docs handles td better

### Section Structure
- Every section opens with a single short paragraph stating what the section is about and why it matters.
- If a section doesn't advance the argument, remove it.
- Each heading introduces the content below; no orphan headings.

### HTML Guidelines for Google Docs
- Use ONLY inline styles on every element. Google Docs strips <style> blocks.
- Use <b> and <i> not <strong> and <em> (better Google Docs support).
- Use <table> with inline styles for all tabular data.
- Use <ul>/<ol> for lists with inline-styled <li> elements.
- Use <hr> for section breaks.
- Use <p> for all body text with inline font-size and color.
- Avoid <div>, <span>, <section> — Google Docs handles them poorly.
- Do NOT use CSS classes, external stylesheets, or <style> tags.
- Every visible element MUST have inline style with font-size in pt and color.`;

const COLOURS = BRAND.colours;

function buildFormatPrompt(doc: FormatInput): string {
  return `Format this document content for Google Docs export. Apply all Design Bible rules. Return ONLY the HTML body content — no wrapper, no <html>/<body> tags.

Document: "${doc.name}"
Reference: ${doc.file_code}
${doc.tier ? `Tier: ${doc.tier}` : ''}
${doc.category ? `Category: ${doc.category}` : ''}

---
RAW CONTENT:
${doc.content}
---

Remember:
- Every element needs inline styles with font-size in pt and color
- H1 = 20pt bold #0F1629, H2 = 14pt bold #0F1629, body = 11pt #1A1A2E
- Tables: dark navy headers (#0F1629) with white text, 10pt body
- Green text (#008655) only for scores/callouts, never for body text
- Apply writing rules: active voice, short sentences, downside before upside
- Return ONLY the formatted HTML content, nothing else`;
}

export async function formatContentForGdocs(doc: FormatInput): Promise<string> {
  const message = await claudeWithTimeout(anthropic, {
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    system: DESIGN_BIBLE_SYSTEM,
    messages: [
      { role: "user", content: buildFormatPrompt(doc) }
    ],
  });

  const block = message.content[0];
  if (block.type !== "text") {
    throw new Error("Unexpected response type from formatting engine");
  }

  let html = block.text.trim();
  if (html.startsWith("```html")) {
    html = html.slice(7);
  }
  if (html.startsWith("```")) {
    html = html.slice(3);
  }
  if (html.endsWith("```")) {
    html = html.slice(0, -3);
  }

  return html.trim();
}

export function wrapGdocsHtml(doc: FormatInput, bodyHtml: string): string {
  const date = new Date().toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric'
  });

  return `<html><head><meta charset="UTF-8"></head><body style="font-family:Arial,sans-serif;color:#1A1A2E;">
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20pt;"><tr>
  <td style="vertical-align:bottom;">
    <p style="font-size:20pt;font-weight:bold;color:${COLOURS.darkNavy};margin:0;">${escapeHtml(doc.name)}</p>
    <p style="font-size:9pt;color:#888888;margin:4pt 0 0 0;">${doc.file_code ? `Ref: ${escapeHtml(doc.file_code)}` : ''}${doc.tier ? ` | Tier ${doc.tier}` : ''}${doc.version ? ` | v${doc.version}` : ''}</p>
  </td>
  <td style="text-align:right;vertical-align:top;width:180pt;">
    <table cellpadding="0" cellspacing="0" style="margin-left:auto;"><tr>
      <td style="background-color:#01BC77;width:6pt;height:32pt;">&nbsp;</td>
      <td style="padding-left:8pt;font-size:20pt;font-weight:bold;color:${COLOURS.darkNavy};letter-spacing:3pt;font-family:Arial,Helvetica,sans-serif;">UNLOCK</td>
    </tr></table>
  </td>
</tr></table>
<hr>
${bodyHtml}
<br><hr>
<p style="font-size:8pt;color:#888888;">${escapeHtml(doc.file_code)} | ${escapeHtml(doc.name)} | ${date}</p>
</body></html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
