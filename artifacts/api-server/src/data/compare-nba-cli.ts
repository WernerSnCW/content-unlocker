// Phase 7.1a — CLI compare tool.
//
// Usage (from repo root):
//   ./node_modules/.pnpm/node_modules/.bin/tsx \
//     artifacts/api-server/src/data/compare-nba-cli.ts
//
// Runs the rule-engine NBA against the legacy cascade NBA for every
// stored conversation that has a transcript. Prints one line per call
// plus a summary at the end. No HTTP, no port hunting.
//
// Optional: pass one or more conversation ids as arguments to narrow
// down, e.g. `... compare-nba-cli.ts conv_abc conv_def`.

import { db, leadConversationsTable } from "@workspace/db";
import { isNotNull } from "drizzle-orm";
import { loadInvestor, loadOutcomeRules, processTranscriptDetailed } from "../engine/v2";
import type { CallType } from "../engine/v2";

function inferCallType(durationSeconds: number | null | undefined): CallType {
  const mins = Math.round((durationSeconds || 0) / 60);
  if (mins >= 40) return "demo";
  if (mins >= 20) return "opportunity";
  return "cold_call";
}

interface Row {
  id: string;
  callType: CallType;
  agreed: boolean;
  matched: string | null;
  legacyAction: string;
  rulesAction: string;
  error?: string;
  diff?: string;
}

async function main() {
  const filterIds = process.argv.slice(2);

  const query = db.select().from(leadConversationsTable).where(isNotNull(leadConversationsTable.transcript_text));
  const all = await query;
  const conversations = filterIds.length > 0
    ? all.filter((c: typeof all[number]) => filterIds.includes(c.id))
    : all;

  if (conversations.length === 0) {
    console.log(filterIds.length > 0
      ? `No conversations matched ids: ${filterIds.join(", ")}`
      : "No conversations with transcripts in DB.");
    process.exit(0);
  }

  const rules = await loadOutcomeRules();
  if (rules.length === 0) {
    console.log("No outcome rules in DB — run the seed first.");
    process.exit(1);
  }

  console.log(`Comparing ${conversations.length} conversations against ${rules.length} rules...\n`);

  const rows: Row[] = [];
  for (const conv of conversations) {
    if (!conv.contact_id || !conv.transcript_text) continue;
    const callType = inferCallType(conv.duration_seconds);
    try {
      const investor = await loadInvestor(conv.contact_id);
      const legacy = processTranscriptDetailed(conv.transcript_text, callType, investor);
      const rulesRun = processTranscriptDetailed(conv.transcript_text, callType, investor, { outcomeRules: rules });

      const lhs = legacy.output.nextBestAction;
      const rhs = rulesRun.output.nextBestAction;
      const agreed =
        lhs.actionType === rhs.actionType &&
        lhs.owner === rhs.owner &&
        lhs.timing === rhs.timing &&
        lhs.detail === rhs.detail &&
        (lhs.contentToSend?.docId ?? null) === (rhs.contentToSend?.docId ?? null);

      const diff = agreed ? "" : [
        lhs.actionType !== rhs.actionType ? `actionType(${lhs.actionType}→${rhs.actionType})` : "",
        lhs.owner !== rhs.owner ? `owner(${lhs.owner}→${rhs.owner})` : "",
        lhs.timing !== rhs.timing ? `timing(${lhs.timing}→${rhs.timing})` : "",
        lhs.detail !== rhs.detail ? `detail("${lhs.detail}"→"${rhs.detail}")` : "",
        (lhs.contentToSend?.docId ?? null) !== (rhs.contentToSend?.docId ?? null)
          ? `docId(${lhs.contentToSend?.docId ?? "null"}→${rhs.contentToSend?.docId ?? "null"})`
          : "",
      ].filter(Boolean).join(", ");

      rows.push({
        id: conv.id,
        callType,
        agreed,
        matched: rulesRun.detail.nbaTrace?.matchedRuleId ?? null,
        legacyAction: lhs.actionType,
        rulesAction: rhs.actionType,
        diff,
      });
    } catch (err: any) {
      rows.push({
        id: conv.id,
        callType,
        agreed: false,
        matched: null,
        legacyAction: "error",
        rulesAction: "error",
        error: err?.message || String(err),
      });
    }
  }

  // Pretty print
  for (const r of rows) {
    const mark = r.agreed ? "✓" : "✗";
    const tail = r.error
      ? `ERROR: ${r.error}`
      : r.agreed
      ? `${r.legacyAction} (matched ${r.matched})`
      : `DIFF — ${r.diff}`;
    console.log(`  ${mark} ${r.id} [${r.callType}] → ${tail}`);
  }

  const agreedCount = rows.filter((r) => r.agreed).length;
  const total = rows.length;
  console.log(`\n${agreedCount}/${total} agreed`);

  // drizzle pool keeps node alive — force exit.
  setTimeout(() => process.exit(agreedCount === total ? 0 : 1), 100).unref();
}

main().catch((err) => {
  console.error("Compare CLI failed:", err);
  process.exit(1);
});
