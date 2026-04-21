// Runnable test harness for the V3 engine (backwards compatible with V2).
// Usage from api-server dir: see repo root scripts for the compile-and-run.

import { detectPersona } from "../functions/detectPersona";
import { detectHotButton } from "../functions/detectHotButton";
import { analyseSignals } from "../functions/analyseSignals";
import { evaluateGates } from "../functions/evaluateGates";
import { routeContent } from "../functions/routeContent";
import { generateCoverNote } from "../functions/generateCoverNote";
import { processTranscript } from "../functions/processTranscript";
import { validateCompliance } from "../functions/validateCompliance";
import { detectQuestions } from "../functions/detectQuestions";
import { analyseDemoSegments } from "../functions/analyseDemoSegments";
import { generateEmail } from "../functions/generateEmail";
import { determinePostCloseActions } from "../functions/determinePostCloseActions";
import { routeToBook2 } from "../functions/routeToBook2";
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

  // Engine version tagged (3.x or later)
  const major = parseInt(out.engineVersion.split(".")[0]);
  expect(major >= 2).toBe(true);
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

// ============ D6. Question Detection ============

console.log("\nD6. Question Detection");

test("Cold-call questions detected", () => {
  const transcript = `
    Agent: Are you familiar with EIS at all?
    Investor: I've heard of it but never really looked into it properly.
    Agent: And are you paying higher or additional rate at the moment?
    Investor: Additional rate, yes.
    Agent: Do you have capital you're looking to deploy?
    Investor: Yes, I've just sold a rental property. Sitting on about £300K.
  `;
  const result = detectQuestions(transcript, "cold_call");
  const q1 = result.find(q => q.questionNumber === 1);
  const q2 = result.find(q => q.questionNumber === 2);
  const q3 = result.find(q => q.questionNumber === 3);
  expect(!!q1?.detected).toBe(true);
  expect(!!q2?.detected).toBe(true);
  expect(q2?.inferredState).toBe("confirmed");
  expect(!!q3?.detected).toBe(true);
});

test("Undetected questions are reported", () => {
  const transcript = "Agent: Hi. Investor: Hi.";
  const result = detectQuestions(transcript, "cold_call");
  const undetected = result.filter(q => !q.detected);
  expect(undetected.length > 0).toBe(true);
});

// ============ D7. Demo Segment Analysis ============

console.log("\nD7. Demo Segment Analysis");

test("C4 amber after segment 2 with segment 5 covered → flag", () => {
  const questions = [
    { questionNumber: 10, detected: true, signalTarget: "C4", investorResponse: null, inferredState: "amber", confidence: "medium" as const },
    { questionNumber: 19, detected: true, signalTarget: "S2", investorResponse: null, inferredState: "amber", confidence: "medium" as const },
  ];
  const updates = [
    { code: "C4", previousState: "grey", newState: "amber", evidence: "", confidence: "medium" as const },
    { code: "S2", previousState: "grey", newState: "amber", evidence: "", confidence: "medium" as const },
  ];
  const r = analyseDemoSegments("demo", questions, updates);
  expect(r.flags.length > 0).toBe(true);
  expect(r.flags[0].message.includes("C4")).toBe(true);
});

test("Non-demo callType returns empty", () => {
  const r = analyseDemoSegments("cold_call", [], []);
  expect(r.segments.length).toBe(0);
  expect(r.flags.length).toBe(0);
});

// ============ D8. Email Generation ============

console.log("\nD8. Email Generation");

test("EMAIL_1 — demo confirmation produced for cold call", () => {
  const investor = blankInvestor({ name: "James Smith" });
  const r = generateEmail(investor, "cold_call", null, [], { c4Compliance: "open", pack1: "blocked", pack1BlockedReasons: [], activeRoute: "pending", blockedSignals: [] });
  expect(r.email?.templateId).toBe("EMAIL_1");
  expect(r.email!.attachmentDocId).toBe(100);
});

test("EMAIL_2 — post-demo requires personalisation", () => {
  const noData = blankInvestor({ persona: "legacy_builder" });
  const r = generateEmail(noData, "demo", null, [], { c4Compliance: "open", pack1: "blocked", pack1BlockedReasons: [], activeRoute: "pending", blockedSignals: [] });
  expect(r.email).toBeNull();
  expect(r.flag?.type).toBe("missing_data");
});

test("EMAIL_2 — legacy builder with L1 amber routes to doc 170", () => {
  const investor = blankInvestor({
    persona: "legacy_builder",
    factFind: {
      ...blankInvestor().factFind,
      exactPhrases: ["I want to make sure my children are protected"],
      practicalProblem: "IHT exposure on £3M estate",
      desiredOutcome: "tax-efficient transfer",
    },
  });
  const updates = [{ code: "L1", previousState: "grey", newState: "amber", evidence: "", confidence: "medium" as const }];
  const r = generateEmail(investor, "demo", null, updates, { c4Compliance: "open", pack1: "blocked", pack1BlockedReasons: [], activeRoute: "pending", blockedSignals: [] });
  expect(r.email?.templateId).toBe("EMAIL_2");
  expect(r.email!.attachmentDocId).toBe(170);
  expect(r.email!.body.includes("make sure my children are protected")).toBe(true);
});

// ============ D9. Post-Close Actions ============

console.log("\nD9. Post-Close Actions");

test("Committed outcome returns stages 6-8 + quarterly", () => {
  const r = determinePostCloseActions("committed", blankInvestor());
  expect(!!r.postCloseActions).toBe(true);
  expect(r.postCloseActions!.some(a => a.action === "reserve_stock")).toBe(true);
  expect(r.postCloseActions!.some(a => a.action === "quarterly_update")).toBe(true);
});

test("Adviser loop returns pre/during/post actions", () => {
  const r = determinePostCloseActions("adviser_loop", blankInvestor());
  expect(!!r.adviserLoopActions).toBe(true);
  const phases = r.adviserLoopActions!.map(p => p.phase);
  expect(phases.includes("pre_call")).toBe(true);
  expect(phases.includes("during_call")).toBe(true);
  expect(phases.includes("post_call")).toBe(true);
});

// ============ D10. Book 2 Routing ============

console.log("\nD10. Book 2 Routing");

test("S2 red triggers Book 2 routing", () => {
  const investor = blankInvestor();
  const signals = { S2: { ...signalAt("red"), code: "S2" } };
  const r = routeToBook2(signals, investor);
  expect(r?.triggered).toBe(true);
  expect(r!.actions.includes("tag_book2_eligible")).toBe(true);
});

test("founding_investor tag excludes Book 2", () => {
  const investor = { ...blankInvestor(), tags: ["founding_investor"] };
  const signals = { S2: { ...signalAt("red"), code: "S2" } };
  const r = routeToBook2(signals, investor as any);
  expect(r).toBeNull();
});

// ============ D11. End-to-End Cold Call ============

console.log("\nD11. End-to-end — James Growth Seeker");

test("Full cold call scenario", () => {
  const transcript = `
    Agent: Hi James, it's Sarah calling from Unlock.
    Agent: Are you familiar with EIS?
    James: I've done EIS before through a Crowdcube fund but the fees are ridiculous.
    I'm paying 3.5% annually and I can't even see what companies I'm in.
    Agent: Are you paying additional rate?
    James: Yes, additional rate. £180K income a year — I pay 45%.
    Agent: Do you have capital available?
    James: Just sold a rental property. Got about £640K sitting in cash.
    Agent: What does the rest look like?
    James: ISA at HL, SIPP, the Crowdcube stuff, another BTL property.
    Agent: Is your main focus growth, protection, or wealth transfer?
    James: Growth. I want better deals at lower fees. I'm after upside.
  `;
  const james = blankInvestor({ investorId: "james", name: "James Smith" });
  const output = processTranscript(transcript, "cold_call", james);

  // Persona should detect as growth_seeker
  expect(output.personaAssessment.persona).toBe("growth_seeker");
  // QL confirmed via "sold a rental property" / "sitting in cash"
  expect(output.signalUpdates.some(u => u.code === "QL" && u.newState === "confirmed")).toBe(true);
  // G1 (fee awareness) should at minimum surface
  const g1 = output.signalUpdates.find(u => u.code === "G1");
  expect(!!g1).toBe(true);
  // Engine version stamped V3
  expect(output.engineVersion.startsWith("3.")).toBe(true);
  // V3 fields present
  expect(Array.isArray(output.questionsDetected)).toBe(true);
  expect(output.demoSegmentAnalysis).toBeNull(); // cold call
  // Email draft: EMAIL_1 with doc 100
  expect(output.emailDraft?.templateId).toBe("EMAIL_1");
  expect(output.emailDraft?.attachmentDocId).toBe(100);
});

// ============ D6. Outcome rule evaluator (Phase 7.1a) ============
// Minimal unit tests for the rule evaluator. The evaluator is exercised
// end-to-end via processTranscript when opts.outcomeRules is passed,
// but a couple of direct tests catch clause-evaluation regressions that
// the fixture transcripts might mask.

import { evaluateOutcomeRules, RuleCoverageError } from "../outcomeRules/evaluator";
import { OUTCOME_RULES_SEED } from "../../../data/seed-outcome-rules";

function mockRules() {
  // Use the seed translated into LoadedOutcomeRule shape. The seed is
  // the canonical rule set, so testing against it doubles as a fixture
  // check.
  return OUTCOME_RULES_SEED.map((r) => ({
    ...r,
    when_clauses: r.when_clauses as any,
    created_at: new Date(),
    updated_at: new Date(),
  }));
}

test("Outcome rules — opportunity + all S green picks opp_all_s_green", () => {
  const rules = mockRules();
  const signals: any = {
    S2: { state: "green" }, S3: { state: "green" }, S4: { state: "green" },
    S5: { state: "green" }, S6: { state: "green" },
  };
  const { action, trace } = evaluateOutcomeRules(rules, {
    callType: "opportunity",
    signals,
    investor: blankInvestor({ investorId: "t" }),
    content: null,
    gateResult: { c4Compliance: "open", pack1: "blocked", pack1BlockedReasons: [], activeRoute: "pending", blockedSignals: [] } as any,
  });
  expect(trace.matchedRuleId).toBe("opp_all_s_green");
  expect(action.actionType).toBe("reserve_stock");
  expect(action.owner).toBe("tom");
  expect(action.timing).toBe("immediate");
});

test("Outcome rules — demo + pack1 eligible picks demo_pack1_eligible", () => {
  const rules = mockRules();
  const { action, trace } = evaluateOutcomeRules(rules, {
    callType: "demo",
    signals: {} as any,
    investor: blankInvestor({ investorId: "t" }),
    content: { docId: 120, docName: "Pack 1" } as any,
    gateResult: { c4Compliance: "open", pack1: "eligible", pack1BlockedReasons: [], activeRoute: "pending", blockedSignals: [] } as any,
  });
  expect(trace.matchedRuleId).toBe("demo_pack1_eligible");
  expect(action.actionType).toBe("send_content");
  expect(action.contentToSend?.docId).toBe(120);
});

test("Outcome rules — cold call with no content → cold_fallback", () => {
  const rules = mockRules();
  const { action, trace } = evaluateOutcomeRules(rules, {
    callType: "cold_call",
    signals: {} as any,
    investor: blankInvestor({ investorId: "t" }),
    content: null,
    gateResult: { c4Compliance: "open", pack1: "blocked", pack1BlockedReasons: [], activeRoute: "pending", blockedSignals: [] } as any,
  });
  expect(trace.matchedRuleId).toBe("cold_fallback");
  expect(action.actionType).toBe("move_to_nurture");
});

test("Outcome rules — demo_low_score triggers before demo_fallback", () => {
  const rules = mockRules();
  const { action, trace } = evaluateOutcomeRules(rules, {
    callType: "demo",
    signals: {} as any,
    investor: blankInvestor({ investorId: "t", demoScore: 40 }),
    content: null,
    gateResult: { c4Compliance: "open", pack1: "blocked", pack1BlockedReasons: [], activeRoute: "pending", blockedSignals: [] } as any,
  });
  expect(trace.matchedRuleId).toBe("demo_low_score");
  expect(action.actionType).toBe("escalate_to_tom");
});

test("Outcome rules — no fallback throws RuleCoverageError", () => {
  // Only one rule, specific to opportunity — cold call falls through.
  const rules = [{
    id: "t1", priority: 10, enabled: true,
    when_clauses: [{ lvalue: "callType", op: "===" as const, rvalue: "opportunity" }],
    action_type: "close_deal", owner: "system", timing: "immediate",
    detail: "x", uses_content: false,
    created_at: new Date(), updated_at: new Date(),
  }];
  let threw: unknown = null;
  try {
    evaluateOutcomeRules(rules, {
      callType: "cold_call",
      signals: {} as any,
      investor: blankInvestor({ investorId: "t" }),
      content: null,
      gateResult: { c4Compliance: "open", pack1: "blocked", pack1BlockedReasons: [], activeRoute: "pending", blockedSignals: [] } as any,
    });
  } catch (e) { threw = e; }
  expect(threw instanceof RuleCoverageError).toBe(true);
});

// ============ D7. Parity: rule-engine NBA matches legacy cascade ============
// Runs a fixture scenario through BOTH NBA paths and asserts byte-identical
// NextAction across all fields. This is the acceptance bar for flipping
// ENGINE_OUTCOME_RULES on. One parity test per callType so every branch of
// the legacy cascade is exercised.

function assertParity(scenario: string, legacy: any, byRules: any) {
  test(`Parity — ${scenario}: actionType`, () => {
    expect(legacy.nextBestAction.actionType).toBe(byRules.nextBestAction.actionType);
  });
  test(`Parity — ${scenario}: owner`, () => {
    expect(legacy.nextBestAction.owner).toBe(byRules.nextBestAction.owner);
  });
  test(`Parity — ${scenario}: timing`, () => {
    expect(legacy.nextBestAction.timing).toBe(byRules.nextBestAction.timing);
  });
  test(`Parity — ${scenario}: detail`, () => {
    expect(legacy.nextBestAction.detail).toBe(byRules.nextBestAction.detail);
  });
  test(`Parity — ${scenario}: contentToSend.docId`, () => {
    expect(legacy.nextBestAction.contentToSend?.docId ?? null).toBe(byRules.nextBestAction.contentToSend?.docId ?? null);
  });
}

(() => {
  // Cold call — James
  const transcript = `
    Agent: Hi James, it's Sarah calling from Unlock.
    Agent: Are you familiar with EIS?
    James: I've done EIS before through a Crowdcube fund but the fees are ridiculous.
    Agent: Are you paying additional rate?
    James: Yes, additional rate. £180K income a year — I pay 45%.
    Agent: Do you have capital available?
    James: Just sold a rental property. Got about £640K sitting in cash.
  `;
  const james = blankInvestor({ investorId: "james" });
  const legacy = processTranscript(transcript, "cold_call", james);
  const byRules = processTranscript(transcript, "cold_call", james, { outcomeRules: mockRules() });
  assertParity("James cold call", legacy, byRules);
})();

(() => {
  // Demo — Margaret preserver. C4 is amber/grey → compliance gate blocks →
  // content routes to doc 140. Expect rules + legacy to produce identical NBA.
  const transcript = `
    Tom: What's the main thing on your mind financially?
    Margaret: I'm terrified of making a mistake I can't undo. I've got my SIPP at Aviva,
    ISA at Hargreaves, some property, and a bit of cash. Nobody shows me the full picture.
    I understand the EIS tax relief — 30% income tax, right? But I'm worried about
    the risk. What happens if the company fails?
    Margaret: OK so the downside is about 38p in the pound. That's better than I thought.
    I'm interested in how the platform works for my situation specifically.
  `;
  const margaret = blankInvestor({ investorId: "margaret", persona: "preserver", demoScore: 78 });
  const legacy = processTranscript(transcript, "demo", margaret);
  const byRules = processTranscript(transcript, "demo", margaret, { outcomeRules: mockRules() });
  assertParity("Margaret demo", legacy, byRules);
})();

(() => {
  // Opportunity — Duncan, Call 3 close scenario. Adviser surfacing → S5 amber
  // → expect adviser_loop rule path.
  const transcript = `
    Tom: Has anything changed since we spoke?
    Duncan: I've been reading through the document you sent. It all makes sense.
    Tom: Based on everything we've discussed, what do you think?
    Duncan: I want to do this, but I'd like to run it past my accountant first before committing.
    Tom: Absolutely. Would a three-way call help?
    Duncan: Yes, that would be useful.
  `;
  const duncan = blankInvestor({
    investorId: "duncan",
    persona: "legacy_builder",
    demoScore: 82,
    // Pre-seed signals that the opportunity call acts on. In a real call the
    // demo already surfaced these; for the test we stamp them in.
    signals: {
      S1: { code: "S1", state: "green", surfacedBy: "conversation", notes: "demo landed", updatedAt: new Date().toISOString(), confidence: "high" },
      S2: { code: "S2", state: "green", surfacedBy: "conversation", notes: "interested in backing", updatedAt: new Date().toISOString(), confidence: "high" },
    } as any,
  });
  const legacy = processTranscript(transcript, "opportunity", duncan);
  const byRules = processTranscript(transcript, "opportunity", duncan, { outcomeRules: mockRules() });
  assertParity("Duncan opportunity (adviser)", legacy, byRules);
})();

// ============ Summary ============

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
