---
ID: 402
TYPE: SPEC
TITLE: Intelligence Engine Rules Specification
VERSION: V2
STATUS: CURRENT
TRACK: Internal
AUDIENCE: Claude Code / Werner / Developer
BELIEF_STAGE: N/A
OUTPUT_FORMAT: md
GOOGLE_TYPE: none
SUPERSEDES: 402_SPEC_Intelligence_Engine_V1_CURRENT.md
PINNED: false
LAST_UPDATED: 2026-04-14
UPDATED_BY: Tom King / Claude session
---

# UNLOCK — Intelligence Engine V2
## Implementation Specification for Claude Code
*V2 · April 14, 2026 · Internal*

---

## HOW TO USE THIS DOCUMENT

This document has five parts. Build them in order. Each part is self-contained — it gives you everything you need to implement that module before moving to the next.

```
PART A — CONFIG    Pure data. Import directly. No logic.
PART B — TYPES     TypeScript interfaces. The shape of everything.
PART C — FUNCTIONS Pure logic. Each function has inputs, outputs, and rules.
PART D — TESTS     Input/output fixtures. Validate every function.
PART E — VERSIONING How to update the engine without breaking the app.
```

**Implementation order:**
1. PART B — define all types first
2. PART A — load config as typed constants
3. PART C — implement functions in the numbered order given
4. PART D — run test fixtures against each function
5. PART E — implement version checking

---

# PART A — CONFIG

*Pure data. No logic. Import these as typed constants. When the engine is updated, only this section changes for CONFIG_ONLY updates.*

## A1. Signal Registry

```typescript
const SIGNAL_REGISTRY = [
  // QUALIFICATION — priority 1-2
  { code: "QT", name: "Tax Rate Qualification", category: "qualification", persona: null, priority: 1,
    validStates: ["confirmed", "not_confirmed", "unknown"] as const,
    activation: "always",
    detectionPatterns: [
      { pattern: "higher rate", weight: 3 },
      { pattern: "additional rate", weight: 3 },
      { pattern: "pay 40%", weight: 3 },
      { pattern: "pay 45%", weight: 3 },
      { pattern: "tax liability", weight: 2 },
      { pattern: "accountant handles", weight: 1 },
    ],
    negativePatterns: [
      { pattern: "basic rate", weight: -3 },
      { pattern: "don't pay much tax", weight: -3 },
      { pattern: "retired, don't really pay", weight: -2 },
    ]
  },
  { code: "QL", name: "Liquidity Qualification", category: "qualification", persona: null, priority: 2,
    validStates: ["confirmed", "not_confirmed", "unknown"] as const,
    activation: "always",
    detectionPatterns: [
      { pattern: "capital available", weight: 3 },
      { pattern: "sold a business", weight: 3 },
      { pattern: "sold a property", weight: 3 },
      { pattern: "sitting in cash", weight: 3 },
      { pattern: "looking to deploy", weight: 2 },
    ],
    negativePatterns: [
      { pattern: "everything is tied up", weight: -3 },
      { pattern: "fully invested", weight: -3 },
      { pattern: "need to liquidate", weight: -2 },
      { pattern: "not right now", weight: -2 },
    ]
  },

  // CORE BELIEFS — priority 3-6
  { code: "C1", name: "Problem Is Real", category: "core", persona: null, priority: 3,
    validStates: ["green", "amber", "grey", "red", "n_a"] as const,
    activation: "always",
    detectionPatterns: [
      { pattern: "multiple providers", weight: 3 },
      { pattern: "no single view", weight: 4 },
      { pattern: "fragmented", weight: 3 },
      { pattern: "spreadsheet", weight: 2 },
      { pattern: "can't see everything", weight: 3 },
    ]
  },
  { code: "C2", name: "Problem Is Unsolved", category: "core", persona: null, priority: 4,
    validStates: ["green", "amber", "grey", "red", "n_a"] as const,
    activation: "always",
    note: "Established by narrative, not by question. Detect from responses to EIS narrative.",
    detectionPatterns: [
      { pattern: "adviser doesn't", weight: 3 },
      { pattern: "generic advice", weight: 3 },
      { pattern: "nobody shows me", weight: 4 },
      { pattern: "gaps in", weight: 2 },
      { pattern: "never seen this", weight: 3 },
    ]
  },
  { code: "C3", name: "EIS Understood", category: "core", persona: null, priority: 5,
    validStates: ["green", "amber", "grey", "red", "n_a"] as const,
    activation: "always",
    detectionPatterns: [
      { pattern: "income tax relief", weight: 3 },
      { pattern: "capital gains deferral", weight: 3 },
      { pattern: "loss relief", weight: 2 },
      { pattern: "I understand how it works", weight: 4 },
      { pattern: "30%", weight: 2, note: "partial understanding — check if conflating relief types" },
    ]
  },
  { code: "C4", name: "Risk Understood", category: "core", persona: null, priority: 6,
    validStates: ["green", "amber", "grey", "red", "n_a"] as const,
    activation: "always",
    gateRole: "COMPLIANCE_GATE",
    detectionPatterns: [
      { pattern: "capital at risk", weight: 4 },
      { pattern: "illiquid", weight: 3 },
      { pattern: "holding period", weight: 3 },
      { pattern: "could lose", weight: 3 },
      { pattern: "downside", weight: 2 },
    ]
  },

  // PROBLEM BELIEFS — priority 7-9 (persona-gated)
  { code: "G1", name: "Fee Awareness", category: "problem", persona: "growth_seeker", priority: 7,
    validStates: ["green", "amber", "grey", "red", "n_a"] as const,
    activation: "persona === 'growth_seeker'"
  },
  { code: "G2", name: "Deal Flow Gap", category: "problem", persona: "growth_seeker", priority: 8,
    validStates: ["green", "amber", "grey", "red", "n_a"] as const,
    activation: "persona === 'growth_seeker'"
  },
  { code: "G3", name: "Early Entry Value", category: "problem", persona: "growth_seeker", priority: 9,
    validStates: ["green", "amber", "grey", "red", "n_a"] as const,
    activation: "persona === 'growth_seeker'"
  },
  { code: "L1", name: "IHT Exposure", category: "problem", persona: "legacy_builder", priority: 7,
    validStates: ["green", "amber", "grey", "red", "n_a"] as const,
    activation: "persona === 'legacy_builder'"
  },
  { code: "L2", name: "BPR Cap Awareness", category: "problem", persona: "legacy_builder", priority: 8,
    validStates: ["green", "amber", "grey", "red", "n_a"] as const,
    activation: "persona === 'legacy_builder'"
  },
  { code: "P2", name: "Concentration Risk", category: "problem", persona: "preserver", priority: 7,
    validStates: ["green", "amber", "grey", "red", "n_a"] as const,
    activation: "persona === 'preserver'"
  },
  { code: "P3", name: "Income Sustainability", category: "problem", persona: "preserver", priority: 8,
    validStates: ["green", "amber", "grey", "red", "n_a"] as const,
    activation: "persona === 'preserver'"
  },

  // SITUATIONAL BELIEFS — priority 10-15
  { code: "S1", name: "Unlock Credible", category: "situational", persona: null, priority: 10,
    validStates: ["green", "amber", "grey", "red", "n_a"] as const,
    activation: "signals.C4 === 'green'"
  },
  { code: "S2", name: "Considering Investing", category: "situational", persona: null, priority: 11,
    validStates: ["green", "amber", "grey", "red", "n_a"] as const,
    activation: "signals.S1 === 'green'",
    gateRole: "TRACK_ROUTER"
  },
  { code: "S3", name: "Valuation Fair", category: "situational", persona: null, priority: 12,
    validStates: ["green", "amber", "grey", "red", "n_a"] as const,
    activation: "signals.S2 === 'green'"
  },
  { code: "S4", name: "Team Can Execute", category: "situational", persona: null, priority: 13,
    validStates: ["green", "amber", "grey", "red", "n_a"] as const,
    activation: "signals.S2 === 'green'"
  },
  { code: "S5", name: "Terms Protect", category: "situational", persona: null, priority: 14,
    validStates: ["green", "amber", "grey", "red", "n_a"] as const,
    activation: "signals.S2 === 'green'"
  },
  { code: "S6", name: "Timing Right", category: "situational", persona: null, priority: 15,
    validStates: ["green", "amber", "grey", "red", "n_a"] as const,
    activation: "signals.S2 === 'green'"
  },
] as const;
```

## A2. Gate Definitions

```typescript
const GATES = [
  {
    id: "C4_COMPLIANCE",
    evaluationOrder: 1,
    condition: (signals: SignalMap) => signals.C4 === "green",
    blockedAction: { send: 140, sendOnly: true, reason: "C4 compliance gate — only document 140 permitted" },
    override: "none",
  },
  {
    id: "PERSONA",
    evaluationOrder: 2,
    condition: (investor: Investor) => investor.persona !== "undetermined",
    blockedAction: { skipCategories: ["problem"], reason: "Persona not yet determined — problem beliefs inactive" },
    override: "none",
  },
  {
    id: "S_CLUSTER",
    evaluationOrder: 3,
    condition: (signals: SignalMap) => signals.S1 === "green",
    blockedAction: { skipSignals: ["S2","S3","S4","S5","S6"], reason: "S1 not green — S-cluster inactive" },
    override: "none",
  },
  {
    id: "S2_ROUTING",
    evaluationOrder: 4,
    routeMap: {
      green: "book_1",
      amber: "send_100_revisit",
      grey: "nurture",
      red: "nurture_no_situational",
    },
  },
  {
    id: "PACK1",
    evaluationOrder: 5,
    condition: (signals: SignalMap, investor: Investor) =>
      signals.S2 === "green" && signals.C4 === "green" && (investor.demoScore ?? 0) >= 70,
    blockedAction: { blockDocument: 120, reason: "Pack 1 gate not met" },
    override: "none",
  },
] as const;
```

## A3. Content Routing Map

```typescript
const ROUTING_MAP = [
  // Each entry: when this signal is in this state, send this document.
  // Evaluated in priority order (signal priority from A1).
  // First match wins. Only one document sent per routing cycle.

  { signal: "C4", triggerStates: ["amber", "grey"], docId: 140, docName: "Access Explainer",
    isComplianceGateOverride: true,
    note: "ONLY document permitted when C4 is not green. Nothing else. No exceptions." },

  { signal: "C3", triggerStates: ["amber"], docId: 150, docName: "EIS Investors Secret Weapon",
    personaVariant: { legacy_builder: { docId: null, docName: "Unlock EIS Investor Guide V2" } } },

  { signal: "G1", triggerStates: ["amber"], docId: 180, docName: "EIS Fee Comparison",
    personaFilter: "growth_seeker" },

  { signal: "G2", triggerStates: ["amber"], docId: 140, docName: "Access Explainer — syndicate section",
    personaFilter: "growth_seeker" },

  { signal: "L1", triggerStates: ["amber"], docId: 170, docName: "IHT Planning 5M Estate",
    personaFilter: "legacy_builder",
    altDoc: { docId: 160, docName: "EIS 2026 Five Case Studies" } },

  { signal: "L2", triggerStates: ["amber"], docId: 182, docName: "BPR Explainer",
    personaFilter: "legacy_builder" },

  { signal: "P2", triggerStates: ["amber"], docId: 181, docName: "Portfolio Stress Test",
    personaFilter: "preserver" },

  { signal: "S2", triggerStates: ["amber"], docId: 100, docName: "One-Pager" },

  { signal: "PACK1_GATE", triggerStates: ["eligible"], docId: 120, docName: "Pack 1 — Founding Investor Brief",
    gateCondition: "PACK1" },
] as const;
```

## A4. Persona Detection Config

```typescript
const PERSONA_CONFIG = {
  threshold: 8, // minimum total weight to classify
  personas: [
    {
      id: "preserver" as const,
      label: "The Preserver",
      problemCluster: ["P2", "P3"],
      demoEmphasis: "stress-test + drawdown sequencing",
      patterns: [
        { pattern: "worried about", weight: 3 },
        { pattern: "protection", weight: 3 },
        { pattern: "safe", weight: 2 },
        { pattern: "preserve", weight: 3 },
        { pattern: "can't afford to lose", weight: 4 },
        { pattern: "retirement", weight: 2 },
        { pattern: "recently retired", weight: 3 },
        { pattern: "drawdown", weight: 2 },
        { pattern: "income sustainability", weight: 2 },
        { pattern: "sequence of returns", weight: 3 },
        { pattern: "irreversible", weight: 3 },
      ],
    },
    {
      id: "growth_seeker" as const,
      label: "The Growth Seeker",
      problemCluster: ["G1", "G2", "G3"],
      demoEmphasis: "syndicate access + fee comparison",
      patterns: [
        { pattern: "deals", weight: 3 },
        { pattern: "opportunities", weight: 2 },
        { pattern: "access", weight: 2 },
        { pattern: "fees", weight: 3 },
        { pattern: "what does it cost", weight: 3 },
        { pattern: "crowdcube", weight: 4 },
        { pattern: "seedrs", weight: 4 },
        { pattern: "direct", weight: 2 },
        { pattern: "not through a fund", weight: 3 },
        { pattern: "growth", weight: 2 },
        { pattern: "upside", weight: 2 },
        { pattern: "returns", weight: 2 },
      ],
    },
    {
      id: "legacy_builder" as const,
      label: "The Legacy Builder",
      problemCluster: ["L1", "L2"],
      demoEmphasis: "IHT trajectory + pension interaction",
      patterns: [
        { pattern: "IHT", weight: 4 },
        { pattern: "inheritance", weight: 3 },
        { pattern: "estate", weight: 3 },
        { pattern: "children", weight: 3 },
        { pattern: "grandchildren", weight: 3 },
        { pattern: "trust", weight: 3 },
        { pattern: "succession", weight: 3 },
        { pattern: "passing on", weight: 3 },
        { pattern: "BPR", weight: 4 },
        { pattern: "business property relief", weight: 4 },
        { pattern: "next generation", weight: 3 },
        { pattern: "solicitor", weight: 2 },
      ],
    },
  ],
  hotButtons: [
    { id: "family" as const, patterns: ["kids", "wife", "provide for", "next generation", "grandchildren", "family"] },
    { id: "freedom" as const, patterns: ["options", "independence", "control", "my own decisions", "not be told"] },
    { id: "legacy" as const, patterns: ["build something", "leave behind", "meaningful", "lasting"] },
    { id: "relief" as const, patterns: ["simplify", "less stress", "one place", "stop worrying", "peace of mind"] },
    { id: "significance" as const, patterns: ["early", "founding", "first", "exclusive", "part of something"] },
  ],
} as const;
```

## A5. Call Type Config

```typescript
const CALL_TYPES = [
  {
    callNumber: 1,
    name: "Cold Call",
    owner: "agent" as const,
    durationMins: { min: 5, max: 10 },
    signalResponsibility: ["QT", "QL"],
    alsoSurfaces: ["persona", "hot_button", "C1"],
    successOutcome: "demo_booked",
    dispositionCodes: {
      "101": { label: "Demo Booked", pipelineAction: "move_to_stage_2", firesWorkflow: "WF2" },
      "102": { label: "Not Interested", pipelineAction: "move_to_lost" },
      "103": { label: "Call Back Later", pipelineAction: "stay_stage_1", createsTask: "callback" },
      "104": { label: "Wrong Number", pipelineAction: "delete_deal" },
      "105": { label: "Voicemail", pipelineAction: "stay_stage_1", createsTask: "followup_2_days" },
    },
    autoSendsOnSuccess: [{ docId: 100, attachedTo: "demo_confirmation_email" }],
  },
  {
    callNumber: 2,
    name: "Demo + Fact Find",
    owner: "tom" as const,
    durationMins: { min: 40, max: 50 },
    segments: [
      { name: "Open with them", durationMins: 5, screenShare: false },
      { name: "EIS narrative", durationMins: 8, screenShare: false },
      { name: "Asset register demo", durationMins: 5, screenShare: true },
      { name: "Decumulation planner demo", durationMins: 12, screenShare: true },
      { name: "Founding round", durationMins: 7, screenShare: false },
      { name: "Fact find", durationMins: 10, screenShare: false },
    ],
    signalResponsibility: ["C1", "C2", "C3", "C4", "S1", "S2"],
    alsoSurfaces: ["persona_cluster_beliefs", "hot_button", "all_fact_find_fields"],
    produces: "demo_score",
    postCallTiming: {
      crmUpdate: "within_2_hours",
      factFindFields: "within_24_hours",
      emailSend: "24_to_48_hours",
    },
  },
  {
    callNumber: 3,
    name: "The Opportunity",
    owner: "tom" as const,
    durationMins: { min: 30, max: 45 },
    signalResponsibility: ["S2", "S3", "S4", "S5", "S6"],
    closeScript: "Based on everything we've discussed — what do you think? Is this something you want to do?",
    outcomes: {
      committed: { actions: ["reserve_stock", "send_pack1_if_not_sent", "send_pack2", "initiate_seedlegals"] },
      adviser_loop: { actions: ["send_pack2", "schedule_three_way_call", "set_adviser_involved_flag"] },
      needs_time: { actions: ["set_specific_followup_date", "send_remaining_content", "note_unresolved_belief"] },
      no: { actions: ["close_as_lost", "log_reason", "check_book2_eligible"] },
    },
  },
] as const;
```

## A6. Timing Rules

```typescript
const TIMING_RULES = {
  postDemoEmail: {
    earliest: "24_hours_after_demo",
    latest: "48_hours_after_demo",
    exception: "If investor explicitly requested specific info on the call, send THAT ITEM immediately. The post-demo email itself still follows at 24-48 hours.",
  },
  crmUpdate: { deadline: "2_hours_after_call" },
  factFindComplete: { deadline: "24_hours_after_demo" },
  demoCapacity: { maxPerWeek: 10, overflowAction: "activate_webinar_overflow" },
  quarterlyUpdate: { deadline: "45_days_after_quarter_end", activatesWhen: "first_investor_committed" },
} as const;
```

## A7. Compliance Constants

```typescript
const COMPLIANCE = {
  version: "1.0",
  effectiveDate: "2026-04-14",
  rules: [
    { id: "BPR_CAP", correct: "£2.5M per estate — Finance Act 2026",
      prohibited: ["per individual", "per person", "per taxpayer", "announced, subject to final enactment"],
      caveatRequired: false },
    { id: "AIM_BPR", correct: "50% relief in all cases from April 2026 (Finance Act 2026)",
      prohibited: ["100% without qualification"],
      caveatRequired: false },
    { id: "PENSION_IHT", correct: "subject to final legislation",
      prohibited: ["stated as enacted fact"],
      caveatRequired: true, caveatText: "subject to parliamentary approval of Finance Bill 2025-26" },
    { id: "INVESTMENT_INSTRUMENT", correct: "Instant Investment",
      prohibited: ["ASA", "Advanced Subscription Agreement", "SAFE"] },
    { id: "MINIMUM_TICKET", correct: "£40,000",
      prohibited: ["£20,000", "£20K"] },
    { id: "ANTI_DILUTION", correct: "until the Growth Capital round",
      prohibited: ["until Series A"] },
    { id: "TOM_KING_BIO",
      correct: "15 years in investor-introduction and capital-facilitation technology. £250M+ capital facilitated.",
      prohibited: ["Cloudworkz"] },
    { id: "SEIS_LIMIT", correct: "£200,000", prohibited: ["£100,000"] },
    { id: "SEIS_LOSS", correct: "~27.5p per pound (additional rate)", prohibited: ["20p", "22p"] },
    { id: "EIS_LOSS", correct: "~38.5p per pound (additional rate)", prohibited: ["30p as universal"] },
    { id: "ROUND_CLOSE", correct: "April 2027", prohibited: ["April 6", "April 27", "end of March"] },
    { id: "YEAR1_REVENUE", correct: "£44K", prohibited: ["£1.4M"] },
    { id: "YEAR5_REVENUE", correct: "£8.78M", prohibited: ["£8.25M"] },
    { id: "EXIT_RANGE", correct: "£50M–£80M", prohibited: ["£20–50M"] },
  ],
} as const;
```

## A8. Red Signal Re-Routing

```typescript
const RED_SIGNAL_ACTIONS: Record<string, { meaning: string; action: string }> = {
  QT: { meaning: "Basic rate taxpayer", action: "EIS not compelling. Assess platform interest or non-tax conviction. Otherwise exit." },
  QL: { meaning: "No deployable capital", action: "Cannot act. Nurture track. Re-engage at 6 months." },
  C1: { meaning: "No fragmentation problem", action: "Rare. Probe first. If confirmed, platform proposition does not land." },
  C3: { meaning: "Firmly dismisses EIS", action: "Stop EIS discussion. Platform may still have value. Route to platform-only." },
  C4: { meaning: "Not comfortable with risk/illiquidity", action: "EIS not suitable. No investment content. Platform-only or exit." },
  S1: { meaning: "Demo didn't land", action: "Product not credible to them. No further S-beliefs. Close cleanly." },
  S2: { meaning: "Firm no to investing", action: "No further S-beliefs. Nurture only. Route to Book 2 if platform interest." },
  S3: { meaning: "Valuation dealbreaker", action: "Log objection. May revisit at step-up. Do not push." },
  S4: { meaning: "Doesn't believe team can execute", action: "Offer Pack 2 as evidence. If still red, respect it." },
};
```

## A9. Pipeline Stages

```typescript
const PIPELINE_STAGES = [
  { stage: 1, name: "Outreach Queued", probability: 0 },
  { stage: 2, name: "Demo Booked", probability: 20 },
  { stage: 3, name: "Demo Scheduled", probability: 40 },
  { stage: 4, name: "Demo Completed", probability: 60 },
  { stage: 5, name: "Pack 1 Sent — Decision Stage", probability: 75 },
] as const;
```

---

# PART B — TYPES

*Define these first. Everything else depends on them.*

```typescript
// === ENUMS ===

type SignalCategory = "qualification" | "core" | "problem" | "situational";
type BeliefState = "green" | "amber" | "grey" | "red" | "n_a";
type QualState = "confirmed" | "not_confirmed" | "unknown";
type Persona = "preserver" | "growth_seeker" | "legacy_builder" | "undetermined";
type HotButton = "family" | "freedom" | "legacy" | "relief" | "significance";
type DecisionStyle = "quick" | "thorough" | "unknown";
type BookTrack = "book_1" | "nurture";
type CallType = "cold_call" | "demo" | "opportunity";
type ActionType = "send_content" | "schedule_call" | "close_deal" | "move_to_nurture"
  | "escalate_to_tom" | "reserve_stock" | "initiate_seedlegals" | "schedule_adviser_call";
type Owner = "agent" | "tom" | "system";
type Confidence = "high" | "medium" | "low";
type FlagType = "compliance_warning" | "missing_data" | "timing_violation" | "gate_blocked";

// === CORE OBJECTS ===

interface SignalState {
  code: string;
  state: BeliefState | QualState;
  surfacedBy: "question" | "conversation" | "not_yet";
  notes: string;
  updatedAt: string; // ISO timestamp
  confidence: Confidence;
}

interface Investor {
  investorId: string;
  name: string;
  persona: Persona;
  hotButton: HotButton | null;
  demoScore: number | null;
  bookTrack: BookTrack | null;
  decisionStyle: DecisionStyle;
  pack1Gate: "eligible" | "blocked";
  signals: Record<string, SignalState>;
  factFind: FactFind;
  callHistory: CallRecord[];
  artifactsSent: ArtifactRecord[];
}

interface FactFind {
  practicalProblem: string | null;   // their words
  currentPressure: string | null;    // their words
  personalAngle: string | null;      // their words
  desiredOutcome: string | null;     // their words
  exactPhrases: string[];            // verbatim — HIGHEST VALUE FIELD
  portfolioShape: string | null;
  annualTaxLiability: number | null;
  decisionStakeholders: string | null;
  decisionStyle: DecisionStyle;
  questionsForCall3: string | null;  // verbatim
}

interface CallRecord {
  callNumber: number;
  callType: CallType;
  date: string;
  durationMins: number;
  dispositionCode: string | null;
  signalsUpdated: string[];          // signal codes that changed
  notes: string;
}

interface ArtifactRecord {
  docId: number;
  docName: string;
  triggerSignal: string;
  sentAt: string;
  opened: boolean | null;
}

// === ENGINE OUTPUT ===

interface EngineOutput {
  engineVersion: string;
  processedAt: string;
  callType: CallType;
  investorId: string;

  signalUpdates: SignalUpdate[];
  factFindUpdates: Partial<FactFind>;
  personaAssessment: { persona: Persona; confidence: Confidence; evidence: string };
  hotButton: { primary: HotButton | null; evidence: string };
  demoScore: number | null;

  gateStatus: {
    c4Compliance: "open" | "blocked";
    pack1: "eligible" | "blocked";
    pack1BlockedReasons: string[];
  };

  nextBestAction: {
    actionType: ActionType;
    detail: string;
    owner: Owner;
    timing: "immediate" | "24_48_hours" | string;
    contentToSend: ContentRecommendation | null;
  };

  pipelineTransition: { fromStage: number; toStage: number; reason: string } | null;
  crmNote: string;
  flags: { type: FlagType; message: string }[];
}

interface SignalUpdate {
  code: string;
  previousState: string;
  newState: string;
  evidence: string;
  confidence: Confidence;
}

interface ContentRecommendation {
  docId: number;
  docName: string;
  triggerSignal: string;
  coverNoteDraft: string;
}
```

---

# PART C — FUNCTIONS

*Implement in this order. Each function lists its exact inputs, outputs, and rules. No ambiguity.*

## C1. detectPersona

```
INPUT:  transcript: string, currentPersona: Persona
OUTPUT: { persona: Persona, confidence: Confidence, evidence: string }

RULES:
1. For each persona in PERSONA_CONFIG.personas:
   - Scan transcript (case-insensitive) for each pattern
   - Sum weights of all matched patterns
2. Take the persona with the highest total weight
3. If highest weight < PERSONA_CONFIG.threshold (8): return "undetermined"
4. If tied: return "undetermined"
5. If currentPersona !== "undetermined" and new detection disagrees:
   - Only override if new weight exceeds current by >= 4 (prevents flip-flopping)
6. Return the winning persona, confidence based on margin:
   - margin >= 6: "high"
   - margin >= 3: "medium"
   - else: "low"
7. Evidence = comma-separated list of matched patterns
```

## C2. detectHotButton

```
INPUT:  transcript: string
OUTPUT: { primary: HotButton | null, evidence: string }

RULES:
1. For each hotButton in PERSONA_CONFIG.hotButtons:
   - Count pattern matches in transcript (case-insensitive)
2. Highest count wins. Ties: return first in config order.
3. If no matches: return null
```

## C3. analyseSignals

```
INPUT:  transcript: string, currentSignals: Record<string, SignalState>, investor: Investor
OUTPUT: SignalUpdate[]

RULES:
1. For each signal in SIGNAL_REGISTRY (sorted by priority):
   a. Check activation condition. If not met, skip.
   b. Scan transcript for detectionPatterns. Sum positive weights.
   c. Scan transcript for negativePatterns. Sum negative weights.
   d. Net score = positive + negative.
   e. Determine proposed new state:
      - net >= 8: "green" (strong confirmation)
      - net >= 4: "amber" (partial / discussed but unresolved)
      - net <= -4: "red" (firm negative)
      - net between -3 and 3: no change (insufficient signal)
   f. Check state transition validity (see TRANSITION_RULES below)
   g. If valid and different from current: add to updates

2. TRANSITION_RULES:
   VALID:   grey→amber, grey→green, grey→red, grey→n_a,
            amber→green, amber→red,
            green→amber (rare — require confidence "high"),
            red→amber (rare — require confidence "high")
   INVALID: any→grey (cannot unsurface),
            n_a→anything except grey

3. For qualification signals (QT, QL):
   Use "confirmed" / "not_confirmed" / "unknown" instead of belief states.
   - net >= 4: "confirmed"
   - net <= -4: "not_confirmed"
   - else: "unknown" (only if currently "unknown")
```

## C4. evaluateGates

```
INPUT:  signals: Record<string, SignalState>, investor: Investor
OUTPUT: {
  c4Compliance: "open" | "blocked",
  pack1: "eligible" | "blocked",
  pack1BlockedReasons: string[],
  activeRoute: "book_1" | "nurture" | "send_100_revisit" | "nurture_no_situational",
  blockedSignals: string[],  // signals that cannot be routed against due to gates
}

RULES:
1. Evaluate GATES in evaluationOrder (1 through 5).
2. C4_COMPLIANCE: if signals.C4 !== "green" → blocked. All signals below priority 6 are blocked.
3. PERSONA: if investor.persona === "undetermined" → skip all problem belief signals.
4. S_CLUSTER: if signals.S1 !== "green" → skip S2–S6.
5. S2_ROUTING: map signals.S2 state to route per routeMap.
6. PACK1: check all three conditions. If any fails, list reasons.
```

## C5. routeContent

```
INPUT:  signals: Record<string, SignalState>, investor: Investor, gateResult: GateResult
OUTPUT: ContentRecommendation | null

RULES:
1. If gateResult.c4Compliance === "blocked":
   Return { docId: 140, docName: "Access Explainer", triggerSignal: "C4" }
   STOP. Nothing else.

2. Walk ROUTING_MAP in order (which follows signal priority).
3. For each route:
   a. Is the signal in a triggerState? If no, skip.
   b. Is the signal in gateResult.blockedSignals? If yes, skip.
   c. Does the route have a personaFilter? If yes, does investor.persona match? If no, skip.
   d. Does the route have a gateCondition? If yes, is that gate met? If no, skip.
   e. FIRST MATCH WINS. Return that content recommendation.

3. If no match: return null (no content to send — all routable signals are green, red, or n_a)

4. For the matched route, check personaVariant and altDoc:
   - If persona matches a variant, use the variant's docId
   - altDoc is an alternative the engine can flag but does not auto-select
```

## C6. generateCoverNote

```
INPUT:  investor: Investor, content: ContentRecommendation
OUTPUT: string (the cover note draft)

RULES:
1. OBSERVATION HIERARCHY (use the highest available):
   Level 1: investor.factFind.exactPhrases (verbatim quote from them)
   Level 2: investor.factFind (their specific situation — practical_problem, desired_outcome)
   Level 3: genuine market event (BPR cap change, pension IHT timeline)
   Level 4: real external trigger
   Level 5: NOTHING — flag for human review, do not generate generic note

2. STRUCTURE:
   Line 1: Reference what THEY said. Use a Level 1 or 2 observation.
   Line 2: Why THIS document is relevant to THEIR situation.
   Line 3: What they will find in the document (one sentence).
   Line 4: CTA — soft ("read and we'll discuss on [date]") or direct ("schedule Call 3").
   Line 5: "Capital at risk. Not financial advice."

3. PROHIBITED in cover notes:
   - "Just checking in" / "Following up" / "Touching base"
   - Generic personalisation ("As a sophisticated investor...")
   - More than one document referenced
   - More than one belief addressed

4. If no Level 1 or Level 2 observation available:
   Return null and flag { type: "missing_data", message: "No personalisation data for cover note" }
```

## C7. determineNextAction

```
INPUT:  callType: CallType, signals: Record<string, SignalState>, investor: Investor,
        content: ContentRecommendation | null, gateResult: GateResult
OUTPUT: { actionType: ActionType, detail: string, owner: Owner, timing: string }

RULES:
1. After COLD CALL (callType === "cold_call"):
   - If demo booked: { actionType: "send_content", detail: "Send demo confirmation + one-pager",
     owner: "agent", timing: "immediate" }
   - If not interested: { actionType: "close_deal", owner: "system" }
   - If callback: { actionType: "schedule_call", detail: "Callback", owner: "agent", timing: "[date]" }

2. After DEMO (callType === "demo"):
   - If content !== null: { actionType: "send_content", detail: content.docName,
     owner: "tom", timing: "24_48_hours" }
   - If Pack 1 gate met: { actionType: "send_content", detail: "Pack 1 + schedule Call 3",
     owner: "tom", timing: "24_48_hours" }
   - If demo_score < 50: { actionType: "escalate_to_tom", detail: "Low demo score — review before next action" }

3. After OPPORTUNITY (callType === "opportunity"):
   - Map to outcome from CALL_TYPES[2].outcomes based on signal states:
     - All S-beliefs green + close confirmed → "committed"
     - S5 amber + mentions adviser → "adviser_loop"
     - Any S-belief amber + no close → "needs_time"
     - S2 red or explicit decline → "no"
```

## C8. buildCrmNote

```
INPUT:  callType: CallType, signalUpdates: SignalUpdate[], factFindUpdates: Partial<FactFind>,
        investor: Investor, content: ContentRecommendation | null, nextAction: NextAction
OUTPUT: string (structured note for Pipedrive)

RULES:
Format varies by call type. Use these exact templates:

COLD CALL:
  "Cold call [DATE]:
   Persona signals: [evidence from persona detection]
   QT: [state + evidence]
   QL: [state + evidence]
   Hot button: [if detected]
   Key phrase: [highest-value exact phrase]
   Next action: [from nextAction]"

DEMO:
  "Demo + Fact Find [DATE]:
   Score: [demoScore]/100
   Persona: [confirmed persona]
   Beliefs updated: [list of signal codes that changed, with from→to]
   Fact find summary:
     Problem: [practicalProblem — their words]
     Pressure: [currentPressure — their words]
     Outcome: [desiredOutcome — their words]
   Content sent: [docName if any]
   Call 3 scheduled: [date if set]
   Pack 1 gate: [eligible/blocked + reasons]"

OPPORTUNITY:
  "Call 3 [DATE]:
   Opened with: [their problem in their words]
   Questions addressed: [from questionsForCall3]
   Beliefs resolved: [S-beliefs that moved to green]
   Outcome: [committed/adviser_loop/needs_time/no]
   Next action: [from nextAction]
   Ticket size: [if discussed]"
```

## C9. validateCompliance

```
INPUT:  text: string (any outbound text — email, cover note, document)
OUTPUT: { passed: boolean, violations: { ruleId: string, found: string, correct: string }[] }

RULES:
1. For each rule in COMPLIANCE.rules:
   - Scan text for any string in rule.prohibited (case-insensitive)
   - If found: add to violations with the correct value
2. If violations.length > 0: passed = false
3. Also check:
   - If text mentions pension IHT without caveat: add violation
   - If text mentions EIS loss relief without rate bracket: add violation
```

## C10. processTranscript (ORCHESTRATOR)

```
INPUT:  transcript: string, callType: CallType, investor: Investor
OUTPUT: EngineOutput

This is the main entry point. It calls all other functions in order:

1. persona = detectPersona(transcript, investor.persona)
2. hotButton = detectHotButton(transcript)
3. signalUpdates = analyseSignals(transcript, investor.signals, investor)
4. Apply signalUpdates to produce updatedSignals
5. gateResult = evaluateGates(updatedSignals, investor)
6. content = routeContent(updatedSignals, investor, gateResult)
7. coverNote = content ? generateCoverNote(investor, content) : null
8. nextAction = determineNextAction(callType, updatedSignals, investor, content, gateResult)
9. crmNote = buildCrmNote(callType, signalUpdates, factFindUpdates, investor, content, nextAction)
10. complianceCheck = validateCompliance(coverNote ?? "")
11. Assemble and return EngineOutput
```

---

# PART D — TESTS

*Run these against your implementation. Each test is a complete input→output fixture.*

## D1. Persona Detection

```typescript
// TEST: Clear Growth Seeker
const transcript1 = "I've been looking at Crowdcube and Seedrs but the fees are killing me. I want direct access to deals, not through a fund. What does it cost?";
const expected1 = { persona: "growth_seeker", confidence: "high" };
// Matched: "Crowdcube"(4) + "Seedrs"(4) + "fees"(3) + "direct"(2) + "not through a fund"(3) + "deals"(3) = 19

// TEST: Clear Legacy Builder
const transcript2 = "My main concern is IHT. I've got about £3M in property and investments and I want to make sure my children are protected. My solicitor mentioned BPR but I don't fully understand it.";
const expected2 = { persona: "legacy_builder", confidence: "high" };
// Matched: "IHT"(4) + "children"(3) + "solicitor"(2) + "BPR"(4) = 13

// TEST: Undetermined (below threshold)
const transcript3 = "I'm just having a look really. Someone mentioned you.";
const expected3 = { persona: "undetermined" };
// No patterns matched above threshold
```

## D2. Gate Logic

```typescript
// TEST: C4 gate blocks everything
const signals_c4_amber = { C4: { state: "amber" }, S2: { state: "green" } };
const investor_high_score = { demoScore: 85, persona: "growth_seeker" };
// Expected: c4Compliance = "blocked", content = { docId: 140 }
// Even though S2 is green and demo score is high, ONLY document 140 is permitted.

// TEST: Pack 1 gate — all conditions met
const signals_pack1_eligible = { C4: { state: "green" }, S2: { state: "green" }, S1: { state: "green" } };
const investor_pack1 = { demoScore: 75, persona: "legacy_builder" };
// Expected: pack1 = "eligible"

// TEST: Pack 1 gate — demo score too low
const signals_pack1_blocked = { C4: { state: "green" }, S2: { state: "green" }, S1: { state: "green" } };
const investor_low_score = { demoScore: 65, persona: "legacy_builder" };
// Expected: pack1 = "blocked", pack1BlockedReasons = ["demo_score < 70"]
```

## D3. Content Routing

```typescript
// TEST: C4 amber — compliance gate override
// Input: C4 = amber, all other signals green, persona = growth_seeker
// Expected output: { docId: 140, triggerSignal: "C4" }
// Reason: C4 gate overrides everything. Even if G1 is amber, only 140 is sent.

// TEST: G1 amber for Growth Seeker
// Input: C4 = green, C3 = green, G1 = amber, persona = "growth_seeker"
// Expected output: { docId: 180, triggerSignal: "G1" }

// TEST: G1 amber but persona is Legacy Builder
// Input: C4 = green, G1 = amber, L1 = amber, persona = "legacy_builder"
// Expected output: { docId: 170, triggerSignal: "L1" }
// Reason: G1 has personaFilter "growth_seeker" — skipped for legacy_builder. L1 matches.

// TEST: All green — nothing to send
// Input: all signals green or n_a
// Expected output: null
```

## D4. Cover Note Generation

```typescript
// TEST: Level 1 observation available
const investor_with_phrases = {
  factFind: {
    exactPhrases: ["I can't see everything in one place"],
    practicalProblem: "multiple providers, no consolidated view",
    desiredOutcome: "one screen that shows me everything",
  }
};
const content = { docId: 181, docName: "Portfolio Stress Test", triggerSignal: "P2" };
// Expected: cover note opens with "You mentioned you can't see everything in one place..."
// Must NOT contain: "checking in", "following up", "as a sophisticated investor"

// TEST: No observations — flag for human review
const investor_empty = { factFind: { exactPhrases: [], practicalProblem: null } };
// Expected: coverNote = null, flag = { type: "missing_data" }
```

## D5. End-to-End: Post-Demo Processing

```typescript
// SCENARIO: Margaret (Preserver), post-demo, demo score 78
const transcript = `
  Tom: What's the main thing on your mind financially?
  Margaret: I'm terrified of making a mistake I can't undo. I've got my SIPP at Aviva,
  ISA at Hargreaves, some property, and a bit of cash. Nobody shows me the full picture.
  I understand the EIS tax relief — 30% income tax, right? But I'm worried about
  the risk. What happens if the company fails?
  Tom: [explains loss relief mechanics]
  Margaret: OK so the downside is about 38p in the pound. That's better than I thought.
  I'm interested in how the platform works for my situation specifically.
`;

const currentInvestor = {
  persona: "preserver",
  signals: { C1: "grey", C2: "grey", C3: "grey", C4: "grey", P2: "grey", P3: "grey", S1: "grey", S2: "grey" },
  demoScore: 78,
};

// EXPECTED OUTPUT:
// persona: "preserver" (confirmed — "terrified of making a mistake", "worried about the risk")
// hotButton: "relief" ("stop worrying" equivalent — "terrified of making a mistake I can't undo")
// signalUpdates:
//   C1: grey → green (evidence: "nobody shows me the full picture" — multiple providers confirmed)
//   C2: grey → green (evidence: "nobody shows me the full picture")
//   C3: grey → amber (evidence: mentions 30% but conflates relief types — partial understanding)
//   C4: grey → amber (evidence: asked about company failure, understood loss relief number, but "worried")
// gateStatus:
//   c4Compliance: blocked (C4 is amber, not green)
// nextBestAction:
//   send document 140 (Access Explainer) — C4 compliance gate in effect
//   timing: 24_48_hours
//   owner: tom
// factFindUpdates:
//   practicalProblem: "nobody shows me the full picture"
//   exactPhrases: ["terrified of making a mistake I can't undo", "nobody shows me the full picture"]
//   portfolioShape: "SIPP (Aviva), ISA (Hargreaves Lansdown), property, cash"
```

---

# PART E — VERSIONING

## E1. Version Format

```
ENGINE VERSION: [major].[minor]
  MAJOR: New signals, new gates, structural changes to processing order
  MINOR: Threshold adjustments, content mapping updates, new detection patterns, compliance updates
```

## E2. Change Types

```
ADDITIVE:     New rules added. No existing rules changed.
              App adds new logic. Old logic untouched.
              Example: Adding signal G4, adding a new routing map entry.

BREAKING:     Existing rules changed or removed.
              App must update existing logic.
              Example: Changing Pack 1 gate threshold from 70 to 65. Renaming a signal code.

CONFIG_ONLY:  Values in PART A changed. No logic changes.
              App reloads config. No code changes.
              Example: Adding a new detection pattern. Updating a compliance constant.
```

## E3. What the App Must Do

```
1. Store the engine version it is currently running (e.g. "1.0").
2. On startup or sync, compare stored version against latest spec version.
3. If mismatch:
   a. Read the CHANGELOG entries between stored version and latest.
   b. For CONFIG_ONLY changes: reload PART A config.
   c. For ADDITIVE changes: implement new logic, reload config.
   d. For BREAKING changes: implement updated logic, reload config, run PART D tests.
   e. Update stored version.
4. All engine outputs include engineVersion in the response.
```

## E4. Changelog

```
V2.0 — April 14, 2026
TYPE: INITIAL RELEASE (restructured from V1 prose format)
CONTAINS: 17 signals, 5 gates, 9 routing map entries, 3 call types,
  5 pipeline stages, 3 personas, 5 hot buttons, 13 compliance constants.
  10 functions. 5 test fixture groups.
SOURCE DOCUMENTS: 544, 545, 546, 547, 548, 549, 551, 520, 530, 701, 010, 992, 991, 210, 600.
MIGRATION: First version. Full implementation required.
```

---

*402_SPEC_Intelligence_Engine_V2_CURRENT.md*
*Unlock Services Limited | Internal — not for distribution*
*V2.0 | April 14, 2026*
*Optimised for Claude Code implementation*
*Maintained by: Tom King / Claude session*
