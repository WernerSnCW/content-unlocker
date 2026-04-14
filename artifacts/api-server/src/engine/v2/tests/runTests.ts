// Runnable test harness for the V2 engine.
// Usage from api-server dir: npx tsx src/engine/v2/tests/runTests.ts

import { detectPersona } from "../functions/detectPersona";
import { detectHotButton } from "../functions/detectHotButton";
import { analyseSignals } from "../functions/analyseSignals";
import { evaluateGates } from "../functions/evaluateGates";
import { routeContent } from "../functions/routeContent";
import { generateCoverNote } from "../functions/generateCoverNote";
import { processTranscript } from "../functions/processTranscript";
import { validateCompliance } from "../functions/validateCompliance";
import { blankInvestor, signalAt } from "./fixtures";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e: any) {
    failed++;
    failures.push(`${name}: ${e.message}`);
    console.log(`  ✗ ${name}`);
    console.log(`      ${e.message}`);
  }
}

function expect<T>(actual: T) {
  return {
    toBe(expected: T) {
      if (actual !== expected) throw new Error(`expected ${String(expected)}, got ${String(actual)}`);
    },
    toEqual(expected: any) {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      }
    },
    toContain(sub: string) {
      if (typeof actual !== "string" || !actual.includes(sub)) {
        throw new Error(`expected to contain "${sub}", got ${JSON.stringify(actual)}`);
      }
    },
    toBeTruthy() {
      if (!actual) throw new Error(`expected truthy, got ${String(actual)}`);
    },
    toBeNull() {
      if (actual !== null) throw new Error(`expected null, got ${String(actual)}`);
    },
  };
}

// ============ D1. Persona ============

console.log("\nD1. Persona Detection");

test("Clear Growth Seeker", () => {
  const t = "I've been looking at Crowdcube and Seedrs but the fees are killing me. I want direct access to deals, not through a fund. What does it cost?";
  const r = detectPersona(t, "undetermined");
  expect(r.persona).toBe("growth_seeker");
  expect(r.confidence).toBe("high");
});

test("Clear Legacy Builder", () => {
  const t = "My main concern is IHT. I've got about £3M in property and investments and I want to make sure my children are protected. My solicitor mentioned BPR but I don't fully understand it.";
  const r = detectPersona(t, "undetermined");
  expect(r.persona).toBe("legacy_builder");
});

test("Undetermined below threshold", () => {
  const r = detectPersona("I'm just having a look really. Someone mentioned you.", "undetermined");
  expect(r.persona).toBe("undetermined");
});

test("Hysteresis — does not flip on small margin", () => {
  // Investor already labelled growth_seeker; new transcript weakly legacy
  const t = "I've been thinking about my estate a bit.";
  const r = detectPersona(t, "growth_seeker");
  expect(r.persona).toBe("growth_seeker");
});

// ============ D2. Gates ============

console.log("\nD2. Gate Logic");

test("C4 amber blocks everything below priority 6", () => {
  const investor = blankInvestor({ persona: "growth_seeker", demoScore: 85 });
  const signals = {
    C4: { ...signalAt("amber"), code: "C4" },
    S2: { ...signalAt("green"), code: "S2" },
  };
  const r = evaluateGates(signals, investor);
  expect(r.c4Compliance).toBe("blocked");
  expect(r.blockedSignals.includes("S2")).toBe(true);
});

test("Pack 1 eligible when all conditions met", () => {
  const investor = blankInvestor({ persona: "legacy_builder", demoScore: 75 });
  const signals = {
    C4: { ...signalAt("green"), code: "C4" },
    S1: { ...signalAt("green"), code: "S1" },
    S2: { ...signalAt("green"), code: "S2" },
  };
  const r = evaluateGates(signals, investor);
  expect(r.pack1).toBe("eligible");
});

test("Pack 1 blocked when demo score too low", () => {
  const investor = blankInvestor({ persona: "legacy_builder", demoScore: 65 });
  const signals = {
    C4: { ...signalAt("green"), code: "C4" },
    S1: { ...signalAt("green"), code: "S1" },
    S2: { ...signalAt("green"), code: "S2" },
  };
  const r = evaluateGates(signals, investor);
  expect(r.pack1).toBe("blocked");
  expect(r.pack1BlockedReasons.some((x) => x.includes("demo_score"))).toBe(true);
});

// ============ D3. Content Routing ============

console.log("\nD3. Content Routing");

test("C4 amber → compliance gate override (doc 140)", () => {
  const investor = blankInvestor({ persona: "growth_seeker" });
  const signals = { C4: { ...signalAt("amber"), code: "C4" } };
  const gate = evaluateGates(signals, investor);
  const r = routeContent(signals, investor, gate);
  expect(r!.docId).toBe(140);
  expect(r!.triggerSignal).toBe("C4");
});

test("G1 amber for growth_seeker → doc 180", () => {
  const investor = blankInvestor({ persona: "growth_seeker" });
  const signals = {
    C4: { ...signalAt("green"), code: "C4" },
    C3: { ...signalAt("green"), code: "C3" },
    G1: { ...signalAt("amber"), code: "G1" },
  };
  const gate = evaluateGates(signals, investor);
  const r = routeContent(signals, investor, gate);
  expect(r!.docId).toBe(180);
});

test("G1 amber for legacy_builder → L1 match (not G1)", () => {
  const investor = blankInvestor({ persona: "legacy_builder" });
  const signals = {
    C4: { ...signalAt("green"), code: "C4" },
    G1: { ...signalAt("amber"), code: "G1" },
    L1: { ...signalAt("amber"), code: "L1" },
  };
  const gate = evaluateGates(signals, investor);
  const r = routeContent(signals, investor, gate);
  expect(r!.docId).toBe(170); // L1 doc
});

test("All green → nothing to send", () => {
  const investor = blankInvestor({ persona: "growth_seeker" });
  const signals: any = {};
  for (const code of ["C1", "C2", "C3", "C4", "G1", "G2", "G3", "S1", "S2"]) {
    signals[code] = { ...signalAt("green"), code };
  }
  const gate = evaluateGates(signals, investor);
  const r = routeContent(signals, investor, gate);
  expect(r).toBeNull();
});

// ============ D4. Cover Notes ============

console.log("\nD4. Cover Notes");

test("Level 1 phrase produces personalised note", () => {
  const investor = blankInvestor({
    factFind: {
      ...blankInvestor().factFind,
      exactPhrases: ["I can't see everything in one place"],
      practicalProblem: "multiple providers, no consolidated view",
      desiredOutcome: "one screen that shows me everything",
    },
  });
  const content = { docId: 181, docName: "Portfolio Stress Test", triggerSignal: "P2", coverNoteDraft: null };
  const r = generateCoverNote(investor, content);
  expect(r.text!).toContain("can't see everything");
  expect(r.text!).toContain("Capital at risk");
  expect(r.text!.toLowerCase().includes("checking in")).toBe(false);
});

test("No observations → flagged for human", () => {
  const investor = blankInvestor();
  const content = { docId: 181, docName: "Stress Test", triggerSignal: "P2", coverNoteDraft: null };
  const r = generateCoverNote(investor, content);
  expect(r.text).toBeNull();
  expect(r.flag!.type).toBe("missing_data");
});

// ============ D5. End-to-end ============

console.log("\nD5. End-to-end post-demo");

test("Margaret preserver scenario", () => {
  const transcript = `
    Tom: What's the main thing on your mind financially?
    Margaret: I'm terrified of making a mistake I can't undo. I've got my SIPP at Aviva,
    ISA at Hargreaves, some property, and a bit of cash. Nobody shows me the full picture.
    I understand the EIS tax relief — 30% income tax, right? But I'm worried about
    the risk. What happens if the company fails?
    Margaret: OK so the downside is about 38p in the pound. That's better than I thought.
    I'm interested in how the platform works for my situation specifically.
  `;
  const investor = blankInvestor({ persona: "preserver", demoScore: 78 });
  const out = processTranscript(transcript, "demo", investor);

  // Persona should remain preserver
  expect(out.personaAssessment.persona).toBe("preserver");

  // "Nobody shows me the full picture" matches C2 (Problem Is Unsolved), weight 4
  const c2 = out.signalUpdates.find((u) => u.code === "C2");
  expect(!!c2).toBe(true);

  // C4 not green (they're still worried) → compliance gate blocks → doc 140
  if (out.gateStatus.c4Compliance === "blocked") {
    expect(out.nextBestAction.contentToSend?.docId).toBe(140);
  }

  // Engine version tagged
  expect(out.engineVersion.startsWith("2.")).toBe(true);
});

// ============ Compliance ============

console.log("\nCompliance");

test("Detects prohibited BPR framing", () => {
  const r = validateCompliance("The BPR cap is £2.5M per individual from April 2026.");
  expect(r.passed).toBe(false);
  expect(r.violations.some((v) => v.ruleId === "BPR_CAP")).toBe(true);
});

test("Clean copy passes", () => {
  const r = validateCompliance("Capital at risk. Not financial advice. Instant Investment vehicle.");
  expect(r.passed).toBe(true);
});

// ============ Summary ============

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
