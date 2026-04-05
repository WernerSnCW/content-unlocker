import { createHash } from "crypto";

export interface ParsedBlock {
  index: number;
  destination: string;
  action: "create" | "update";
  id?: string;
  key?: string;
  title?: string;
  output_type?: string;
  tier?: number;
  category?: string;
  lifecycle_status?: string;
  send_status?: string;
  propagate?: boolean;
  content: string;
  status: "VALID" | "REJECTED";
  error?: string;
}

export interface ParsedImportFile {
  fileHeader: { title?: string; author?: string; date?: string; description?: string } | null;
  blocks: ParsedBlock[];
  totalBlocks: number;
  validBlocks: number;
  rejectedBlocks: number;
}

const PROHIBITED_PATTERNS = [
  "22p",
  "7.8x",
  "78x",
  "asa",
  "safe",
  "series a",
  "£99/month",
  "£249/month",
  "advanced subscription agreement",
];

function extractFileHeader(content: string): { title?: string; author?: string; date?: string; description?: string } | null {
  const headerMatch = content.match(/<!--\s*IMPORT_FILE\s*\n([\s\S]*?)-->/);
  if (!headerMatch) return null;

  const pairs: Record<string, string> = {};
  const lines = headerMatch[1].split("\n");
  for (const line of lines) {
    const kvMatch = line.match(/^\s*(\w+)\s*:\s*(.+?)\s*$/);
    if (kvMatch) {
      pairs[kvMatch[1].toLowerCase()] = kvMatch[2];
    }
  }

  return {
    title: pairs.title,
    author: pairs.author,
    date: pairs.date,
    description: pairs.description,
  };
}

function checkProhibited(content: string): string | null {
  const normalised = content.toLowerCase().replace(/\s+/g, " ");
  for (const pattern of PROHIBITED_PATTERNS) {
    if (normalised.includes(pattern)) {
      return pattern;
    }
  }
  return null;
}

function extractBlocks(content: string): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];
  const blockRegex = /<!--\s*IMPORT_BLOCK\s*\n([\s\S]*?)-->([\s\S]*?)<!--\s*\/IMPORT_BLOCK\s*-->/g;

  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = blockRegex.exec(content)) !== null) {
    const headerText = match[1];
    const blockContent = match[2].trim();

    const pairs: Record<string, string> = {};
    const headerLines = headerText.split("\n");
    for (const line of headerLines) {
      const kvMatch = line.match(/^\s*(\w+)\s*:\s*(.+?)\s*$/);
      if (kvMatch) {
        pairs[kvMatch[1].toLowerCase()] = kvMatch[2];
      }
    }

    const destination = pairs.destination || "";
    const action = pairs.action || "";
    const title = pairs.title || undefined;
    const id = pairs.id || undefined;
    const key = pairs.key || undefined;
    const output_type = pairs.output_type || undefined;
    const tier = pairs.tier ? parseInt(pairs.tier, 10) : undefined;
    const category = pairs.category || undefined;
    const lifecycle_status = pairs.lifecycle_status || undefined;
    const send_status = pairs.send_status || undefined;
    const propagate = pairs.propagate ? pairs.propagate.toLowerCase() === "true" : undefined;

    const block: ParsedBlock = {
      index,
      destination,
      action: action as "create" | "update",
      id,
      key,
      title,
      output_type,
      tier,
      category,
      lifecycle_status,
      send_status,
      propagate,
      content: blockContent,
      status: "VALID",
    };

    if (!destination || destination !== "document") {
      block.status = "REJECTED";
      block.error = destination
        ? `Destination not supported in this version: ${destination}`
        : "destination is required";
    } else if (action !== "create" && action !== "update") {
      block.status = "REJECTED";
      block.error = `Action not supported: ${action || "(empty)"}`;
    } else if (action === "update" && !id && !key) {
      block.status = "REJECTED";
      block.error = "update action requires id or key";
    } else if (!blockContent) {
      block.status = "REJECTED";
      block.error = "Block has no content";
    } else {
      const prohibited = checkProhibited(blockContent);
      if (prohibited) {
        block.status = "REJECTED";
        block.error = `Prohibited value detected: ${prohibited}`;
      }
    }

    if (!block.title && blockContent) {
      const firstLine = blockContent.split("\n").find((l) => l.trim().length > 0);
      if (firstLine) {
        block.title = firstLine.trim().replace(/^#+\s*/, "").substring(0, 80);
      }
    }

    blocks.push(block);
    index++;
  }

  return blocks;
}

export function parseImportFile(fileContent: string): ParsedImportFile {
  const fileHeader = extractFileHeader(fileContent);
  const blocks = extractBlocks(fileContent);
  const validBlocks = blocks.filter((b) => b.status === "VALID").length;
  const rejectedBlocks = blocks.filter((b) => b.status === "REJECTED").length;

  return {
    fileHeader,
    blocks,
    totalBlocks: blocks.length,
    validBlocks,
    rejectedBlocks,
  };
}

export function computeFileHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}
