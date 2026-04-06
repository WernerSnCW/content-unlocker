import puppeteer, { type Browser } from "puppeteer-core";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { BRAND } from "./brand";

function findChromium(): string {
  const hardcoded = "/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium";
  try {
    if (existsSync(hardcoded)) return hardcoded;
  } catch {}
  try {
    return execSync("which chromium", { encoding: "utf8" }).trim();
  } catch {}
  return hardcoded;
}

const CHROMIUM_PATH = findChromium();

let browserInstance: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (browserInstance && browserInstance.connected) {
    return browserInstance;
  }
  browserInstance = await puppeteer.launch({
    executablePath: CHROMIUM_PATH,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
  browserInstance.on("disconnected", () => {
    browserInstance = null;
  });
  return browserInstance;
}

const FONTS_DIR = join(process.cwd(), "src", "assets", "fonts");

function loadFontBase64(weight: string): string {
  const fontPath = join(FONTS_DIR, `Inter-${weight}.woff2`);
  const buf = readFileSync(fontPath);
  return buf.toString("base64");
}

function buildFontFaces(): string {
  const weights = ["400", "500", "600", "700"];
  return weights
    .map((w) => {
      const b64 = loadFontBase64(w);
      return `@font-face {
      font-family: 'Inter';
      font-weight: ${w};
      font-style: normal;
      src: url(data:font/woff2;base64,${b64}) format('woff2');
    }`;
    })
    .join("\n");
}

interface PdfDocumentInput {
  name: string;
  file_code: string;
  version: number;
  tier: number;
  category: string;
  description?: string | null;
  content: string;
  last_reviewed?: string | null;
}

function markdownToHtml(content: string): string {
  let html = content;

  html = html.replace(/^####\s+(.+)$/gm, `<h4>$1</h4>`);
  html = html.replace(/^###\s+(.+)$/gm, `<h3>$1</h3>`);
  html = html.replace(/^##\s+(.+)$/gm, `<h2>$1</h2>`);
  html = html.replace(/^#\s+(.+)$/gm, `<h1>$1</h1>`);

  html = html.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  const lines = html.split("\n");
  const result: string[] = [];
  let inList = false;
  let inTable = false;
  let tableRows: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
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
        result.push("<ul>");
        inList = true;
      }
      result.push(`<li>${trimmed.replace(/^[-*]\s+/, "")}</li>`);
      continue;
    } else if (inList) {
      result.push("</ul>");
      inList = false;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      if (!inList) {
        result.push("<ol>");
        inList = true;
      }
      result.push(`<li>${trimmed.replace(/^\d+\.\s+/, "")}</li>`);
      continue;
    }

    if (trimmed === "---" || trimmed === "***") {
      result.push("<hr>");
      continue;
    }

    if (trimmed === "") {
      continue;
    }

    if (!trimmed.startsWith("<")) {
      result.push(`<p>${trimmed}</p>`);
    } else {
      result.push(trimmed);
    }
  }

  if (inList) result.push("</ul>");
  if (inTable) result.push(renderTable(tableRows));

  return result.join("\n");
}

function renderTable(rows: string[]): string {
  if (rows.length === 0) return "";
  const headerCells = rows[0].split("|").filter((c) => c.trim() !== "");
  let html = "<table><thead><tr>";
  for (const cell of headerCells) {
    html += `<th>${cell.trim()}</th>`;
  }
  html += "</tr></thead><tbody>";
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i].split("|").filter((c) => c.trim() !== "");
    html += "<tr>";
    for (const cell of cells) {
      html += `<td>${cell.trim()}</td>`;
    }
    html += "</tr>";
  }
  html += "</tbody></table>";
  return html;
}

function buildLogoSvg(): string {
  const { colours } = BRAND;
  return `<svg width="140" height="32" viewBox="0 0 140 32" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="0" width="6" height="32" rx="2" fill="${colours.green}" />
    <text x="16" y="24" font-family="Inter, sans-serif" font-size="22" font-weight="700" letter-spacing="0.12em" fill="${colours.darkNavy}">UNLOCK</text>
  </svg>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildPdfHtml(doc: PdfDocumentInput): string {
  const { fonts, colours, typography, spacing } = BRAND;
  const fontFaces = buildFontFaces();
  const bodyHtml = markdownToHtml(doc.content);
  const date = new Date().toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    ${fontFaces}

    @page {
      size: A4;
      margin: ${spacing.pagePaddingMm}mm;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: ${typography.body.size};
      font-weight: ${typography.body.weight};
      line-height: ${typography.body.lineHeight};
      color: ${colours.black};
      background: ${colours.white};
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
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

    .header-left { flex: 1; }

    .logo {
      display: flex;
      align-items: center;
      flex-shrink: 0;
    }

    .doc-title {
      font-family: 'Inter', sans-serif;
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
      font-family: 'Inter', sans-serif;
      font-size: ${typography.h1.size};
      font-weight: ${typography.h1.weight};
      color: ${colours.darkNavy};
      letter-spacing: ${typography.h1.letterSpacing};
      margin: ${spacing.sectionGapMm}mm 0 4mm 0;
    }

    h2 {
      font-family: 'Inter', sans-serif;
      font-size: ${typography.h2.size};
      font-weight: ${typography.h2.weight};
      color: ${colours.darkNavy};
      letter-spacing: ${typography.h2.letterSpacing};
      margin: 8mm 0 3mm 0;
      padding-bottom: 2mm;
      border-bottom: 1px solid ${colours.midGrey};
    }

    h3 {
      font-family: 'Inter', sans-serif;
      font-size: ${typography.h3.size};
      font-weight: ${typography.h3.weight};
      color: ${colours.charcoal};
      margin: 6mm 0 2mm 0;
    }

    h4 {
      font-family: 'Inter', sans-serif;
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
      margin-top: 12mm;
      padding-top: 4mm;
      border-top: 1px solid ${colours.midGrey};
      font-size: ${typography.caption.size};
      color: #999;
      display: flex;
      justify-content: space-between;
    }

    @media print {
      .page-container { padding: 0; }
    }
  </style>
</head>
<body>
  <div class="page-container">
    <div class="header">
      <div class="header-left">
        <div class="doc-title">${escapeHtml(doc.name)}</div>
        <div class="doc-subtitle">
          Ref: ${escapeHtml(doc.file_code)} | Tier ${doc.tier} | v${doc.version}
        </div>
      </div>
      <div class="logo">${buildLogoSvg()}</div>
    </div>
    <div class="content">${bodyHtml}</div>
    <div class="footer">
      <span>${escapeHtml(doc.file_code)} | ${escapeHtml(doc.name)}</span>
      <span>${date}</span>
    </div>
  </div>
</body>
</html>`;
}

export async function generatePdf(doc: PdfDocumentInput): Promise<Buffer> {
  const html = buildPdfHtml(doc);
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });
    return Buffer.from(pdfBuffer);
  } finally {
    await page.close();
  }
}

export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}
