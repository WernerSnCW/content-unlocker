// Phase 4.9 session 2 — adapter unit tests.
// Deterministic tests for the LLM-result → Layer-2-input adapters.
// These do NOT hit Claude. Fixtures are synthetic LLMExtractionResult
// objects; adapters are asserted exact.
//
// Run from api-server dir with tsx / ts-node.

import type { LLMExtractionResult } from "../llm/extractionSchema";
import type { FactFind, SignalMap } from "../types";
import {
  extractionToPersona,
  extractionToHotButton,
  extractionToSignalUpdates,
  extractionToQuestionDetections,
  extractionToFactFindUpdates,
  extractionToDemoScore,
} from "../llm/adaptExtraction";
import { blankInvestor } from "./fixtures";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e: any) { failed++; failures.push(`${name}: ${e.message}`); console.log(`  ✗ ${name}\n      ${e.message}`); }
}

function expect<T>(actual: T) {
  return {
    toBe(expected: T) {
      if (actual !== expected) throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    },
    toEqual(expected: any) {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      }
    },
  };
}

function baseExtraction(overrides?: Partial<LLMExtractionResult>): LLMExtractionResult {
  return {
    persona: { classification: "undetermined", confidence: "low", evidence: "" },
    hotButton: { primary: null, evidence: "" },
    signals: {},
    factFind: {
      practicalProblem: null,
      currentPressure: null,
      personalAngle: null,
      desiredOutcome: null,
      exactPhrases: [],
      portfolioShape: null,
      annualTaxLiability: null,
      decisionStakeholders: null,
      decisionStyle: "unknown",
      questionsForCall3: null,
    },
    questionsDetected: [],
    demoScore: null,
    ...(overrides || {}),
  } as LLMExtractionResult;
}

console.log("Running adapter tests…\n");

// ---------- extractionToPersona ----------
test("persona classification passes through", () => {
  const r = baseExtraction({ persona: { classification: "legacy_builder", confidence: "high", evidence: "kids, estate" } });
  const out = extractionToPersona(r);
  expect(out.persona).toBe("legacy_builder");
  expect(out.confidence).toBe("high");
  expect(out.evidence).toBe("kids, estate");
});

// ---------- extractionToHotButton ----------
test("hot button null when LLM returns null", () => {
  const out = extractionToHotButton(baseExtraction());
  expect(out.primary).toBe(null);
});

test("hot button primary value passes through", () => {
  const r = baseExtraction({ hotButton: { primary: "family", evidence: "kids" } });
  const out = extractionToHotButton(r);
  expect(out.primary).toBe("family");
  expect(out.evidence).toBe("kids");
});

// ---------- extractionToSignalUpdates ----------
test("valid transition grey→amber produces update", () => {
  const r = baseExtraction({ signals: { C3: { proposedState: "amber", confidence: "medium", evidence: "understood basics", stateChanged: true } } });
  const updates = extractionToSignalUpdates(r, {} as SignalMap);
  expect(updates.length).toBe(1);
  expect(updates[0].code).toBe("C3");
  expect(updates[0].previousState).toBe("grey");
  expect(updates[0].newState).toBe("amber");
});

test("invalid transition amber→grey is dropped", () => {
  const current: SignalMap = {
    C3: { code: "C3", state: "amber", surfacedBy: "question", notes: "", updatedAt: "", confidence: "medium" },
  };
  const r = baseExtraction({ signals: { C3: { proposedState: "grey", confidence: "medium", evidence: "", stateChanged: true } } });
  const updates = extractionToSignalUpdates(r, current);
  expect(updates.length).toBe(0);
});

test("same-state proposal is dropped as no-op", () => {
  const current: SignalMap = {
    C3: { code: "C3", state: "amber", surfacedBy: "question", notes: "", updatedAt: "", confidence: "medium" },
  };
  const r = baseExtraction({ signals: { C3: { proposedState: "amber", confidence: "medium", evidence: "", stateChanged: false } } });
  const updates = extractionToSignalUpdates(r, current);
  expect(updates.length).toBe(0);
});

test("green→amber requires high confidence", () => {
  const current: SignalMap = {
    C3: { code: "C3", state: "green", surfacedBy: "question", notes: "", updatedAt: "", confidence: "high" },
  };
  const lowConf = baseExtraction({ signals: { C3: { proposedState: "amber", confidence: "medium", evidence: "", stateChanged: true } } });
  expect(extractionToSignalUpdates(lowConf, current).length).toBe(0);
  const highConf = baseExtraction({ signals: { C3: { proposedState: "amber", confidence: "high", evidence: "", stateChanged: true } } });
  expect(extractionToSignalUpdates(highConf, current).length).toBe(1);
});

test("qualification signal transitions freely", () => {
  const current: SignalMap = {
    QT: { code: "QT", state: "unknown", surfacedBy: "question", notes: "", updatedAt: "", confidence: "low" },
  };
  const r = baseExtraction({ signals: { QT: { proposedState: "confirmed", confidence: "medium", evidence: "higher rate", stateChanged: true } } });
  const updates = extractionToSignalUpdates(r, current);
  expect(updates.length).toBe(1);
  expect(updates[0].newState).toBe("confirmed");
});

// ---------- extractionToQuestionDetections ----------
test("LLM-reported question with gate role appears with correct call-type filtering", () => {
  const registry = new Map([
    [1, { qNum: 1, signal: "QT", call: 1 as const }],
    [10, { qNum: 10, signal: "C4", call: 1 as const, gateRole: "COMPLIANCE_GATE" }],
    [13, { qNum: 13, signal: null, call: 2 as const }], // demo question, should be dropped for cold_call
  ]);
  const r = baseExtraction({
    questionsDetected: [
      { questionNumber: 1, detected: true, investorResponse: "higher rate yes", inferredSignalState: "confirmed" },
      { questionNumber: 10, detected: false, investorResponse: null, inferredSignalState: null },
    ],
  });
  const out = extractionToQuestionDetections(r, "cold_call", registry);
  expect(out.length).toBe(2); // Q1 + Q10, not Q13 (demo)
  const q10 = out.find(q => q.questionNumber === 10);
  expect(q10?.detected).toBe(false);
  expect(q10?.signalTarget).toBe("C4");
});

test("missing questions are filled in as detected=false", () => {
  const registry = new Map([
    [1, { qNum: 1, signal: "QT", call: 1 as const }],
    [2, { qNum: 2, signal: "QL", call: 1 as const }],
  ]);
  const r = baseExtraction({
    questionsDetected: [{ questionNumber: 1, detected: true, investorResponse: "yes", inferredSignalState: "confirmed" }],
  });
  const out = extractionToQuestionDetections(r, "cold_call", registry);
  expect(out.length).toBe(2);
  const q2 = out.find(q => q.questionNumber === 2);
  expect(q2?.detected).toBe(false);
});

// ---------- extractionToFactFindUpdates ----------
test("fact-find non-null fields are copied through", () => {
  const r = baseExtraction({
    factFind: {
      practicalProblem: "fragmented portfolio",
      currentPressure: null,
      personalAngle: null,
      desiredOutcome: "simplify",
      exactPhrases: ["I can't see everything"],
      portfolioShape: null,
      annualTaxLiability: 80000,
      decisionStakeholders: null,
      decisionStyle: "thorough",
      questionsForCall3: null,
    },
  });
  const current: FactFind = blankInvestor().factFind;
  const out = extractionToFactFindUpdates(r, current);
  expect(out.practicalProblem).toBe("fragmented portfolio");
  expect(out.desiredOutcome).toBe("simplify");
  expect(out.annualTaxLiability).toBe(80000);
  expect(out.decisionStyle).toBe("thorough");
});

test("null from LLM never clobbers existing non-null fact-find", () => {
  const current: FactFind = {
    ...blankInvestor().factFind,
    practicalProblem: "kept from earlier call",
    desiredOutcome: "also kept",
  };
  const r = baseExtraction({
    factFind: {
      ...baseExtraction().factFind,
      practicalProblem: null,
      desiredOutcome: "",
    },
  });
  const out = extractionToFactFindUpdates(r, current);
  // null / empty from LLM -> NOT copied into updates
  expect("practicalProblem" in out).toBe(false);
  expect("desiredOutcome" in out).toBe(false);
});

test("exactPhrases accumulate without duplicates", () => {
  const current: FactFind = {
    ...blankInvestor().factFind,
    exactPhrases: ["I've built it over 30 years"],
  };
  const r = baseExtraction({
    factFind: {
      ...baseExtraction().factFind,
      exactPhrases: ["I've built it over 30 years", "I'm terrified of losing it"],
    },
  });
  const out = extractionToFactFindUpdates(r, current);
  expect(out.exactPhrases?.length).toBe(2);
  expect(out.exactPhrases?.[1]).toBe("I'm terrified of losing it");
});

test("decisionStyle unknown doesn't downgrade a known value", () => {
  const current: FactFind = { ...blankInvestor().factFind, decisionStyle: "thorough" };
  const r = baseExtraction({ factFind: { ...baseExtraction().factFind, decisionStyle: "unknown" } });
  const out = extractionToFactFindUpdates(r, current);
  expect("decisionStyle" in out).toBe(false); // preserve known value
});

// ---------- extractionToDemoScore ----------
test("demo score null passes through", () => {
  expect(extractionToDemoScore(baseExtraction())).toBe(null);
});
test("demo score rounded and clamped to 0..100", () => {
  expect(extractionToDemoScore(baseExtraction({ demoScore: 82.4 }))).toBe(82);
  expect(extractionToDemoScore(baseExtraction({ demoScore: 120 }))).toBe(100);
  expect(extractionToDemoScore(baseExtraction({ demoScore: -5 }))).toBe(0);
});

console.log(`\n${passed} passed · ${failed} failed`);
if (failed > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
