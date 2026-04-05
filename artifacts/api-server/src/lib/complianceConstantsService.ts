import { db, complianceConstantsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import type { ComplianceConstant } from "@workspace/db";
import complianceJsonFallback from "../data/compliance_constants.json" with { type: "json" };

let _cache: ComplianceConstant[] | null = null;

const PROHIBITED_VALUES = ["22p", "7.8x", "78x"];

export async function loadConstants(): Promise<ComplianceConstant[]> {
  logger.debug("compliance_constants: DB read");
  const rows = await db
    .select()
    .from(complianceConstantsTable)
    .where(eq(complianceConstantsTable.status, "ACTIVE"));
  _cache = rows;
  return rows;
}

export function getConstants(): { version: string; constants: Array<{ key: string; label: string; value: string; note: string | null }> } {
  if (process.env.COMPLIANCE_CONSTANTS_DB === "false") {
    return {
      version: (complianceJsonFallback as any).version,
      constants: (complianceJsonFallback as any).constants,
    };
  }

  if (_cache === null) {
    throw new Error("Compliance constants cache not initialized. Call loadConstants() at startup.");
  }

  return {
    version: "DB",
    constants: _cache.map((c) => ({
      key: c.key,
      label: c.label,
      value: c.value,
      note: c.notes,
    })),
  };
}

export function getConstantByKey(key: string): ComplianceConstant | undefined {
  if (_cache === null) {
    throw new Error("Compliance constants cache not initialized. Call loadConstants() at startup.");
  }
  return _cache.find((c) => c.key === key);
}

export function getFullCache(): ComplianceConstant[] | null {
  return _cache;
}

export function invalidateCache(): void {
  _cache = null;
}

export function validateOverride(
  key: string,
  newValue: string,
  currentConstant: ComplianceConstant
): { valid: boolean; error?: string } {
  if (currentConstant.status !== "ACTIVE") {
    return { valid: false, error: `Constant '${key}' is not ACTIVE (current status: ${currentConstant.status})` };
  }

  const normalised = newValue.trim().toLowerCase();
  for (const prohibited of PROHIBITED_VALUES) {
    if (normalised === prohibited.toLowerCase()) {
      return { valid: false, error: "Prohibited value" };
    }
  }

  if (currentConstant.subject_to_qualifier && !currentConstant.subject_to_qualifier) {
    return { valid: false, error: "Cannot remove qualifier requirement from a qualifier-protected constant" };
  }

  return { valid: true };
}
