import { Router, type IRouter } from "express";
import { ReplitConnectors } from "@replit/connectors-sdk";
import { randomUUID } from "crypto";
import { db } from "@workspace/db";
import { documentsTable, changelogTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { getGdocsTemplate } from "../../lib/templates/index";
import { formatContentForGdocs, wrapGdocsHtml } from "../../lib/formatService";

const router: IRouter = Router();
const connectors = new ReplitConnectors();

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="48" viewBox="0 0 240 48"><rect x="0" y="6" width="7" height="36" rx="1" fill="#01BC77"/><text x="20" y="36" font-family="Arial,Helvetica,sans-serif" font-size="30" font-weight="bold" fill="#0F1629" letter-spacing="5">UNLOCK</text></svg>`;

let cachedLogoUrl: string | null = null;
let cachedLogoExpiry = 0;

async function getOrUploadLogo(): Promise<string | null> {
  if (cachedLogoUrl && Date.now() < cachedLogoExpiry) return cachedLogoUrl;

  try {
    const boundary = "logo_boundary_" + Date.now();
    const metadata = {
      name: "unlock-logo.svg",
      mimeType: "image/svg+xml",
    };
    const body =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify(metadata) +
      `\r\n--${boundary}\r\n` +
      `Content-Type: image/svg+xml\r\n\r\n` +
      LOGO_SVG +
      `\r\n--${boundary}--`;

    const uploadResp = await connectors.proxy(
      "google-drive",
      "/upload/drive/v3/files?uploadType=multipart&fields=id,webContentLink",
      {
        method: "POST",
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        body,
      }
    );

    if (!uploadResp.ok) return null;
    const uploaded = await uploadResp.json();

    await connectors.proxy(
      "google-drive",
      `/drive/v3/files/${uploaded.id}/permissions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "reader", type: "anyone" }),
      }
    );

    cachedLogoUrl = `https://drive.google.com/uc?id=${uploaded.id}&export=download`;
    cachedLogoExpiry = Date.now() + 24 * 60 * 60 * 1000;
    return cachedLogoUrl;
  } catch (err) {
    console.warn("Logo upload failed:", err);
    return null;
  }
}

router.post("/gdocs/export/:id", async (req, res): Promise<void> => {
  const docId = req.params.id;

  const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, docId));
  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  const content = doc.content || "";
  const title = `[Unlock] ${doc.name} (${doc.file_code})`;

  try {
    const logoUrl = await getOrUploadLogo();
    const useAi = req.query.format === "ai";

    const docRecord = {
      id: doc.id,
      file_code: doc.file_code,
      name: doc.name,
      description: doc.description || undefined,
      content: content,
      tier: doc.tier,
      category: doc.category,
      version: doc.version,
      last_reviewed: doc.last_reviewed || undefined,
    };

    let formattedHtml: string;
    if (useAi) {
      try {
        const formatInput = {
          name: doc.name,
          file_code: doc.file_code,
          content: content,
          tier: doc.tier,
          category: doc.category,
          version: doc.version,
          description: doc.description || undefined,
        };
        const aiBody = await formatContentForGdocs(formatInput);
        formattedHtml = wrapGdocsHtml(formatInput, aiBody);
      } catch (aiErr: any) {
        console.warn("AI formatting failed, falling back to static template:", aiErr.message);
        formattedHtml = getGdocsTemplate(docRecord, logoUrl || undefined);
      }
    } else {
      formattedHtml = getGdocsTemplate(docRecord, logoUrl || undefined);
    }

    const existingGdocUrl = (doc as any).gdoc_url;
    const existingGdocId = existingGdocUrl ? extractGdocId(existingGdocUrl) : null;

    if (existingGdocId) {
      try {
        await connectors.proxy("google-drive", `/drive/v3/files/${existingGdocId}`, {
          method: "DELETE",
        });
      } catch (_) {}
    }

    const metadata = {
      name: title,
      mimeType: "application/vnd.google-apps.document",
    };

    const boundary = "unlock_boundary_" + Date.now();
    const body =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify(metadata) +
      `\r\n--${boundary}\r\n` +
      `Content-Type: text/html; charset=UTF-8\r\n\r\n` +
      formattedHtml +
      `\r\n--${boundary}--`;

    const createResp = await connectors.proxy(
      "google-drive",
      "/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink",
      {
        method: "POST",
        headers: {
          "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body,
      }
    );

    if (!createResp.ok) {
      const errText = await createResp.text();
      res.status(500).json({ error: "Failed to create Google Doc", details: errText });
      return;
    }

    const created = await createResp.json();

    await db.update(documentsTable)
      .set({ gdoc_url: created.webViewLink, gdoc_id: created.id } as any)
      .where(eq(documentsTable.id, docId));

    await db.insert(changelogTable).values({
      id: randomUUID(),
      action: "GDOCS_EXPORTED",
      document_id: docId,
      details: `Content exported to new Google Doc with formatted HTML`,
      triggered_by: "agent",
    });

    res.json({
      gdoc_url: created.webViewLink,
      gdoc_id: created.id,
      document_id: docId,
      status: "created",
    });
  } catch (err: any) {
    res.status(500).json({ error: "Google Docs export failed", details: err.message });
  }
});

router.post("/gdocs/import/:id", async (req, res): Promise<void> => {
  const docId = req.params.id;

  const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, docId));
  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  const hasEditOverride = req.body?.edit_override === true;
  if (doc.tier === 1 && !hasEditOverride) {
    res.status(403).json({
      error: "TIER1_LOCKED",
      message: "Pulling changes into a Tier 1 foundational document requires explicit authorisation.",
      tier: 1,
      document_id: docId,
    });
    return;
  }

  const gdocId = (doc as any).gdoc_id;
  if (!gdocId) {
    res.status(400).json({ error: "No Google Doc linked to this document. Export it first." });
    return;
  }

  try {
    const exportResp = await connectors.proxy(
      "google-drive",
      `/drive/v3/files/${gdocId}/export?mimeType=text/plain`,
      { method: "GET" }
    );

    if (!exportResp.ok) {
      const errText = await exportResp.text();
      res.status(500).json({ error: "Failed to fetch from Google Docs", details: errText });
      return;
    }

    const newContent = await exportResp.text();

    await db.update(documentsTable)
      .set({ content: newContent.trim() })
      .where(eq(documentsTable.id, docId));

    await db.insert(changelogTable).values({
      id: randomUUID(),
      action: "CONTENT_IMPORTED",
      document_id: docId,
      details: `Content pulled from Google Docs (${newContent.trim().length} chars)${doc.tier === 1 ? " [Tier 1 override]" : ""}`,
      triggered_by: "agent",
    });

    res.json({
      document_id: docId,
      status: "imported",
      content_length: newContent.trim().length,
    });
  } catch (err: any) {
    res.status(500).json({ error: "Google Docs import failed", details: err.message });
  }
});

router.get("/gdocs/status/:id", async (req, res): Promise<void> => {
  const docId = req.params.id;

  const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, docId));
  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  const gdocId = (doc as any).gdoc_id;
  const gdocUrl = (doc as any).gdoc_url;

  if (!gdocId) {
    res.json({ linked: false, document_id: docId });
    return;
  }

  try {
    const metaResp = await connectors.proxy(
      "google-drive",
      `/drive/v3/files/${gdocId}?fields=id,name,modifiedTime,webViewLink`,
      { method: "GET" }
    );

    if (!metaResp.ok) {
      res.json({ linked: true, accessible: false, document_id: docId, gdoc_url: gdocUrl });
      return;
    }

    const meta = await metaResp.json();
    res.json({
      linked: true,
      accessible: true,
      document_id: docId,
      gdoc_id: gdocId,
      gdoc_url: meta.webViewLink,
      gdoc_name: meta.name,
      gdoc_modified: meta.modifiedTime,
    });
  } catch (err: any) {
    res.json({ linked: true, accessible: false, document_id: docId, gdoc_url: gdocUrl, error: err.message });
  }
});

function extractGdocId(url: string): string | null {
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

export default router;
