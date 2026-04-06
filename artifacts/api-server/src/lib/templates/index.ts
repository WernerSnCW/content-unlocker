import { BRAND } from "../brand";

export type DocumentTemplate =
  | 'one-pager'
  | 'three-pager'
  | 'pack'
  | 'briefing'
  | 'explainer'
  | 'default';

interface DocumentRecord {
  id: string;
  file_code: string;
  name: string;
  description?: string;
  content?: string | null;
  tier?: number;
  category?: string;
  version?: number;
  last_reviewed?: string;
}

function selectTemplate(doc: DocumentRecord, override?: DocumentTemplate): DocumentTemplate {
  if (override) return override;
  const code = doc.file_code || '';
  if (code.startsWith('10')) return 'one-pager';
  if (code.startsWith('11')) return 'three-pager';
  if (code.startsWith('12') || code.startsWith('13')) return 'pack';
  if (code.startsWith('18')) return 'briefing';
  return 'default';
}

function markdownToHtml(content: string): string {
  let html = content;

  html = html.replace(/^#{4}\s+(.+)$/gm, `<h4>$1</h4>`);
  html = html.replace(/^#{3}\s+(.+)$/gm, `<h3>$1</h3>`);
  html = html.replace(/^#{2}\s+(.+)$/gm, `<h2>$1</h2>`);
  html = html.replace(/^#{1}\s+(.+)$/gm, `<h1>$1</h1>`);

  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  html = html.replace(/^\|(.+)\|$/gm, (match) => {
    return match;
  });

  const lines = html.split('\n');
  const result: string[] = [];
  let inList = false;
  let inTable = false;
  let tableRows: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      if (!inTable) {
        inTable = true;
        tableRows = [];
      }
      if (!/^\|[\s\-:|]+\|$/.test(trimmed)) {
        tableRows.push(trimmed);
      }
      continue;
    } else if (inTable) {
      inTable = false;
      result.push(renderTable(tableRows));
      tableRows = [];
    }

    if (/^[-*]\s+/.test(trimmed)) {
      if (!inList) {
        result.push('<ul>');
        inList = true;
      }
      result.push(`<li>${trimmed.replace(/^[-*]\s+/, '')}</li>`);
      continue;
    } else if (inList) {
      result.push('</ul>');
      inList = false;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      if (!inList) {
        result.push('<ol>');
        inList = true;
      }
      result.push(`<li>${trimmed.replace(/^\d+\.\s+/, '')}</li>`);
      continue;
    }

    if (trimmed === '---' || trimmed === '***') {
      result.push('<hr>');
      continue;
    }

    if (trimmed === '') {
      result.push('<br>');
      continue;
    }

    if (!trimmed.startsWith('<')) {
      result.push(`<p>${trimmed}</p>`);
    } else {
      result.push(trimmed);
    }
  }

  if (inList) result.push('</ul>');
  if (inTable) result.push(renderTable(tableRows));

  return result.join('\n');
}

function renderTable(rows: string[]): string {
  if (rows.length === 0) return '';
  const headerCells = rows[0].split('|').filter(c => c.trim() !== '');
  let html = '<table><thead><tr>';
  for (const cell of headerCells) {
    html += `<th>${cell.trim()}</th>`;
  }
  html += '</tr></thead><tbody>';
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i].split('|').filter(c => c.trim() !== '');
    html += '<tr>';
    for (const cell of cells) {
      html += `<td>${cell.trim()}</td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  return html;
}

function getBaseStyles(): string {
  const { fonts, colours, typography, spacing } = BRAND;
  return `
    @import url('https://fonts.googleapis.com/css2?family=${fonts.heading}:wght@300;400;500;600;700&display=swap');

    @page {
      size: A4;
      margin: ${spacing.pagePaddingMm}mm;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: '${fonts.body}', -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: ${typography.body.size};
      font-weight: ${typography.body.weight};
      line-height: ${typography.body.lineHeight};
      color: ${colours.black};
      background: ${colours.white};
    }

    .page-container {
      padding: ${spacing.pagePaddingMm}mm;
      max-width: 210mm;
      margin: 0 auto;
    }

    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: ${spacing.sectionGapMm}mm;
      padding-bottom: 8mm;
      border-bottom: 2px solid ${colours.green};
    }

    .header-left {
      flex: 1;
    }

    .logo {
      display: flex;
      align-items: center;
      flex-shrink: 0;
    }

    .doc-title {
      font-family: '${fonts.heading}', sans-serif;
      font-size: ${typography.h1.size};
      font-weight: ${typography.h1.weight};
      color: ${colours.darkNavy};
      letter-spacing: ${typography.h1.letterSpacing};
      margin-bottom: 4px;
    }

    .doc-subtitle {
      font-size: ${typography.caption.size};
      color: #666;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    h1 {
      font-family: '${fonts.heading}', sans-serif;
      font-size: ${typography.h1.size};
      font-weight: ${typography.h1.weight};
      color: ${colours.darkNavy};
      letter-spacing: ${typography.h1.letterSpacing};
      margin: ${spacing.sectionGapMm}mm 0 4mm 0;
    }

    h2 {
      font-family: '${fonts.heading}', sans-serif;
      font-size: ${typography.h2.size};
      font-weight: ${typography.h2.weight};
      color: ${colours.darkNavy};
      letter-spacing: ${typography.h2.letterSpacing};
      margin: 8mm 0 3mm 0;
      padding-bottom: 2mm;
      border-bottom: 1px solid ${colours.midGrey};
    }

    h3 {
      font-family: '${fonts.heading}', sans-serif;
      font-size: ${typography.h3.size};
      font-weight: ${typography.h3.weight};
      color: ${colours.charcoal};
      margin: 6mm 0 2mm 0;
    }

    h4 {
      font-family: '${fonts.heading}', sans-serif;
      font-size: ${typography.h4.size};
      font-weight: ${typography.h4.weight};
      color: ${colours.charcoal};
      margin: 4mm 0 2mm 0;
    }

    p { margin-bottom: 3mm; }

    ul, ol {
      margin-left: 6mm;
      margin-bottom: 3mm;
    }

    li { margin-bottom: 1.5mm; }

    table {
      width: 100%;
      border-collapse: collapse;
      margin: 4mm 0 6mm 0;
      font-size: 10px;
    }

    th {
      background: ${colours.darkNavy};
      color: ${colours.white};
      padding: 3mm 4mm;
      text-align: left;
      font-weight: ${fonts.headingWeights.medium};
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    td {
      padding: 2.5mm 4mm;
      border-bottom: 1px solid ${colours.midGrey};
    }

    tr:nth-child(even) td {
      background: ${colours.lightGrey};
    }

    hr {
      border: none;
      border-top: 1px solid ${colours.midGrey};
      margin: 6mm 0;
    }

    strong { font-weight: 600; }
    em { font-style: italic; }

    .footer {
      margin-top: auto;
      padding-top: 4mm;
      border-top: 1px solid ${colours.midGrey};
      font-size: ${typography.caption.size};
      color: #999;
      display: flex;
      justify-content: space-between;
    }

    .page-break {
      page-break-before: always;
    }

    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .page-container { padding: 0; }
    }
  `;
}

function buildLogoSvg(): string {
  const { colours } = BRAND;
  return `<svg width="140" height="32" viewBox="0 0 140 32" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="0" width="6" height="32" rx="2" fill="${colours.green}" />
    <text x="16" y="24" font-family="Inter, sans-serif" font-size="22" font-weight="700" letter-spacing="0.12em" fill="${colours.darkNavy}">UNLOCK</text>
  </svg>`;
}

function buildHeader(doc: DocumentRecord): string {
  return `
    <div class="header">
      <div class="header-left">
        <div class="doc-title">${escapeHtml(doc.name)}</div>
        <div class="doc-subtitle">
          ${doc.file_code ? `Ref: ${escapeHtml(doc.file_code)}` : ''}
          ${doc.tier ? ` | Tier ${doc.tier}` : ''}
          ${doc.version ? ` | v${doc.version}` : ''}
        </div>
      </div>
      <div class="logo">${buildLogoSvg()}</div>
    </div>
  `;
}

function buildFooter(doc: DocumentRecord): string {
  const date = new Date().toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric'
  });
  return `
    <div class="footer">
      <span>${escapeHtml(doc.file_code || doc.id)} | ${escapeHtml(doc.name)}</span>
      <span>${date}</span>
    </div>
  `;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildOnePager(doc: DocumentRecord): string {
  const content = doc.content || '';
  const bodyHtml = markdownToHtml(content);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    ${getBaseStyles()}
    .page-container {
      max-height: 297mm;
      overflow: hidden;
    }
    body { font-size: 10px; }
    h1 { font-size: 22px; margin: 6mm 0 3mm 0; }
    h2 { font-size: 16px; margin: 5mm 0 2mm 0; }
    p { margin-bottom: 2mm; }
  </style>
</head>
<body>
  <div class="page-container">
    ${buildHeader(doc)}
    <div class="content">${bodyHtml}</div>
    ${buildFooter(doc)}
  </div>
</body>
</html>`;
}

function buildMultiPage(doc: DocumentRecord): string {
  const content = doc.content || '';
  const bodyHtml = markdownToHtml(content);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>${getBaseStyles()}</style>
</head>
<body>
  <div class="page-container">
    ${buildHeader(doc)}
    <div class="content">${bodyHtml}</div>
    ${buildFooter(doc)}
  </div>
</body>
</html>`;
}

function buildBriefing(doc: DocumentRecord): string {
  const content = doc.content || '';
  const bodyHtml = markdownToHtml(content);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    ${getBaseStyles()}
    .header {
      text-align: center;
      display: block;
      padding-bottom: 12mm;
      margin-bottom: 8mm;
    }
    .logo { display: flex; justify-content: flex-end; margin-bottom: 8mm; }
    .doc-title {
      font-size: 32px;
      text-align: center;
    }
    .doc-subtitle {
      text-align: center;
      margin-top: 4mm;
      font-size: 12px;
      letter-spacing: 0.1em;
    }
  </style>
</head>
<body>
  <div class="page-container">
    ${buildHeader(doc)}
    <div class="content">${bodyHtml}</div>
    ${buildFooter(doc)}
  </div>
</body>
</html>`;
}

export function getGdocsTemplate(document: DocumentRecord): string {
  const { colours } = BRAND;
  const content = document.content || '';
  const bodyHtml = markdownToGdocsHtml(content, colours);
  const date = new Date().toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric'
  });

  return `<html><head><meta charset="UTF-8"></head><body>
<p style="text-align:right;margin-bottom:24px;">
  <span style="font-size:22px;font-weight:bold;color:${colours.darkNavy};letter-spacing:2px;">
    <span style="color:#01BC77;font-weight:bold;">|</span>&nbsp;UNLOCK
  </span>
</p>
<h1 style="font-size:24px;color:${colours.darkNavy};margin-bottom:4px;">${escapeHtml(document.name)}</h1>
<p style="font-size:11px;color:#888888;margin-bottom:24px;">
  ${document.file_code ? `Ref: ${escapeHtml(document.file_code)}` : ''}${document.tier ? ` | Tier ${document.tier}` : ''}${document.version ? ` | v${document.version}` : ''}
</p>
<hr style="border:none;border-top:2px solid ${colours.darkNavy};margin-bottom:24px;">
${bodyHtml}
<hr style="border:none;border-top:1px solid #E0E0E0;margin-top:32px;margin-bottom:8px;">
<p style="font-size:9px;color:#888888;">
  ${escapeHtml(document.file_code)} | ${escapeHtml(document.name)} | ${date}
</p>
</body></html>`;
}

function markdownToGdocsHtml(content: string, colours: typeof BRAND.colours): string {
  let html = content;

  html = html.replace(/^#{4}\s+(.+)$/gm, (_, t) =>
    `<h4 style="font-size:13px;font-weight:bold;color:${colours.charcoal};margin-top:16px;margin-bottom:8px;">${t}</h4>`);
  html = html.replace(/^#{3}\s+(.+)$/gm, (_, t) =>
    `<h3 style="font-size:15px;font-weight:bold;color:${colours.charcoal};margin-top:20px;margin-bottom:8px;">${t}</h3>`);
  html = html.replace(/^#{2}\s+(.+)$/gm, (_, t) =>
    `<h2 style="font-size:18px;font-weight:bold;color:${colours.darkNavy};margin-top:24px;margin-bottom:10px;">${t}</h2>`);
  html = html.replace(/^#{1}\s+(.+)$/gm, (_, t) =>
    `<h1 style="font-size:22px;font-weight:bold;color:${colours.darkNavy};margin-top:28px;margin-bottom:12px;">${t}</h1>`);

  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<b><i>$1</i></b>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  html = html.replace(/\*(.+?)\*/g, '<i>$1</i>');

  const lines = html.split('\n');
  const result: string[] = [];
  let inList = false;
  let listType = '';
  let inTable = false;
  let tableRows: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      if (!inTable) { inTable = true; tableRows = []; }
      if (!/^\|[\s\-:|]+\|$/.test(trimmed)) { tableRows.push(trimmed); }
      continue;
    } else if (inTable) {
      inTable = false;
      result.push(renderGdocsTable(tableRows, colours));
      tableRows = [];
    }

    if (/^[-*]\s+/.test(trimmed)) {
      if (!inList || listType !== 'ul') {
        if (inList) result.push(listType === 'ol' ? '</ol>' : '</ul>');
        result.push('<ul>');
        inList = true; listType = 'ul';
      }
      result.push(`<li style="font-size:11px;color:${colours.black};margin-bottom:4px;">${trimmed.replace(/^[-*]\s+/, '')}</li>`);
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      if (!inList || listType !== 'ol') {
        if (inList) result.push(listType === 'ol' ? '</ol>' : '</ul>');
        result.push('<ol>');
        inList = true; listType = 'ol';
      }
      result.push(`<li style="font-size:11px;color:${colours.black};margin-bottom:4px;">${trimmed.replace(/^\d+\.\s+/, '')}</li>`);
      continue;
    }

    if (inList) {
      result.push(listType === 'ol' ? '</ol>' : '</ul>');
      inList = false;
    }

    if (trimmed === '---' || trimmed === '***') {
      result.push('<hr style="border:none;border-top:1px solid #E0E0E0;margin:12px 0;">');
      continue;
    }

    if (trimmed === '') {
      result.push('<br>');
      continue;
    }

    if (!trimmed.startsWith('<')) {
      result.push(`<p style="font-size:11px;line-height:1.6;color:${colours.black};margin-bottom:8px;">${trimmed}</p>`);
    } else {
      result.push(trimmed);
    }
  }

  if (inList) result.push(listType === 'ol' ? '</ol>' : '</ul>');
  if (inTable) result.push(renderGdocsTable(tableRows, colours));

  return result.join('\n');
}

function renderGdocsTable(rows: string[], colours: typeof BRAND.colours): string {
  if (rows.length === 0) return '';
  const headerCells = rows[0].split('|').filter(c => c.trim() !== '');
  let html = '<table style="width:100%;border-collapse:collapse;margin:12px 0;font-size:10px;">';
  html += '<tr>';
  for (const cell of headerCells) {
    html += `<td style="background-color:${colours.darkNavy};color:white;padding:8px 12px;font-weight:bold;font-size:9px;text-transform:uppercase;letter-spacing:0.5px;">${cell.trim()}</td>`;
  }
  html += '</tr>';
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i].split('|').filter(c => c.trim() !== '');
    const bg = i % 2 === 0 ? '#F5F5F5' : 'white';
    html += '<tr>';
    for (const cell of cells) {
      html += `<td style="padding:6px 12px;border-bottom:1px solid #E0E0E0;background-color:${bg};font-size:10px;">${cell.trim()}</td>`;
    }
    html += '</tr>';
  }
  html += '</table>';
  return html;
}

export function getTemplate(
  document: DocumentRecord,
  template?: DocumentTemplate
): string {
  const selected = selectTemplate(document, template);

  switch (selected) {
    case 'one-pager':
      return buildOnePager(document);
    case 'three-pager':
    case 'pack':
    case 'explainer':
      return buildMultiPage(document);
    case 'briefing':
      return buildBriefing(document);
    case 'default':
    default:
      return buildMultiPage(document);
  }
}
