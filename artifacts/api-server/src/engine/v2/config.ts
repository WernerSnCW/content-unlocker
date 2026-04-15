// PART A — Config
// Pure data. When the engine is updated, most changes land here.
// See: docs/402_SPEC_Intelligence_Engine_V3_CURRENT.md
import type {
  SignalDef,
  PersonaDef,
  HotButtonDef,
  GateDef,
  RouteEntry,
  ComplianceRule,
  QuestionDef,
  DemoSegmentDef,
  ColdCallStepDef,
  AttachmentRouteEntry,
  EmailTemplateDef,
  ProblemBeliefPatternDef,
  PostCloseStageDef,
  AdviserLoopDef,
  Book2RoutingDef,
} from "./types";

// ============ A1. Signal Registry ============

export const SIGNAL_REGISTRY: readonly SignalDef[] = [
  // QUALIFICATION — priority 1-2
  {
    code: "QT", name: "Tax Rate Qualification", category: "qualification", persona: null, priority: 1,
    validStates: ["confirmed", "not_confirmed", "unknown"],
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
    ],
  },
  {
    code: "QL", name: "Liquidity Qualification", category: "qualification", persona: null, priority: 2,
    validStates: ["confirmed", "not_confirmed", "unknown"],
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
    ],
  },

  // CORE BELIEFS — priority 3-6
  {
    code: "C1", name: "Problem Is Real", category: "core", persona: null, priority: 3,
    validStates: ["green", "amber", "grey", "red", "n_a"],
    activation: "always",
    detectionPatterns: [
      { pattern: "multiple providers", weight: 3 },
      { pattern: "no single view", weight: 4 },
      { pattern: "fragmented", weight: 3 },
      { pattern: "spreadsheet", weight: 2 },
      { pattern: "can't see everything", weight: 3 },
    ],
  },
  {
    code: "C2", name: "Problem Is Unsolved", category: "core", persona: null, priority: 4,
    validStates: ["green", "amber", "grey", "red", "n_a"],
    activation: "always",
    note: "Established by narrative, not by question.",
    detectionPatterns: [
      { pattern: "adviser doesn't", weight: 3 },
      { pattern: "generic advice", weight: 3 },
      { pattern: "nobody shows me", weight: 4 },
      { pattern: "gaps in", weight: 2 },
      { pattern: "never seen this", weight: 3 },
    ],
  },
  {
    code: "C3", name: "EIS Understood", category: "core", persona: null, priority: 5,
    validStates: ["green", "amber", "grey", "red", "n_a"],
    activation: "always",
    detectionPatterns: [
      { pattern: "income tax relief", weight: 3 },
      { pattern: "capital gains deferral", weight: 3 },
      { pattern: "loss relief", weight: 2 },
      { pattern: "i understand how it works", weight: 4 },
      { pattern: "30%", weight: 2, note: "partial — check if conflating relief types" },
    ],
  },
  {
    code: "C4", name: "Risk Understood", category: "core", persona: null, priority: 6,
    validStates: ["green", "amber", "grey", "red", "n_a"],
    activation: "always",
    gateRole: "COMPLIANCE_GATE",
    detectionPatterns: [
      { pattern: "capital at risk", weight: 4 },
      { pattern: "illiquid", weight: 3 },
      { pattern: "holding period", weight: 3 },
      { pattern: "could lose", weight: 3 },
      { pattern: "downside", weight: 2 },
    ],
  },

  // PROBLEM BELIEFS — persona-gated
  { code: "G1", name: "Fee Awareness", category: "problem", persona: "growth_seeker", priority: 7,
    validStates: ["green", "amber", "grey", "red", "n_a"], activation: "persona === 'growth_seeker'" },
  { code: "G2", name: "Deal Flow Gap", category: "problem", persona: "growth_seeker", priority: 8,
    validStates: ["green", "amber", "grey", "red", "n_a"], activation: "persona === 'growth_seeker'" },
  { code: "G3", name: "Early Entry Value", category: "problem", persona: "growth_seeker", priority: 9,
    validStates: ["green", "amber", "grey", "red", "n_a"], activation: "persona === 'growth_seeker'" },
  { code: "L1", name: "IHT Exposure", category: "problem", persona: "legacy_builder", priority: 7,
    validStates: ["green", "amber", "grey", "red", "n_a"], activation: "persona === 'legacy_builder'" },
  { code: "L2", name: "BPR Cap Awareness", category: "problem", persona: "legacy_builder", priority: 8,
    validStates: ["green", "amber", "grey", "red", "n_a"], activation: "persona === 'legacy_builder'" },
  { code: "P2", name: "Concentration Risk", category: "problem", persona: "preserver", priority: 7,
    validStates: ["green", "amber", "grey", "red", "n_a"], activation: "persona === 'preserver'" },
  { code: "P3", name: "Income Sustainability", category: "problem", persona: "preserver", priority: 8,
    validStates: ["green", "amber", "grey", "red", "n_a"], activation: "persona === 'preserver'" },

  // SITUATIONAL BELIEFS
  { code: "S1", name: "Unlock Credible", category: "situational", persona: null, priority: 10,
    validStates: ["green", "amber", "grey", "red", "n_a"], activation: "signals.C4 === 'green'" },
  { code: "S2", name: "Considering Investing", category: "situational", persona: null, priority: 11,
    validStates: ["green", "amber", "grey", "red", "n_a"], activation: "signals.S1 === 'green'", gateRole: "TRACK_ROUTER" },
  { code: "S3", name: "Valuation Fair", category: "situational", persona: null, priority: 12,
    validStates: ["green", "amber", "grey", "red", "n_a"], activation: "signals.S2 === 'green'" },
  { code: "S4", name: "Team Can Execute", category: "situational", persona: null, priority: 13,
    validStates: ["green", "amber", "grey", "red", "n_a"], activation: "signals.S2 === 'green'" },
  { code: "S5", name: "Terms Protect", category: "situational", persona: null, priority: 14,
    validStates: ["green", "amber", "grey", "red", "n_a"], activation: "signals.S2 === 'green'" },
  { code: "S6", name: "Timing Right", category: "situational", persona: null, priority: 15,
    validStates: ["green", "amber", "grey", "red", "n_a"], activation: "signals.S2 === 'green'" },
];

// ============ A2. Gates ============

export const GATES: readonly GateDef[] = [
  {
    id: "C4_COMPLIANCE",
    evaluationOrder: 1,
    condition: (signals) => signals.C4?.state === "green",
    blockedAction: { send: 140, sendOnly: true, reason: "C4 compliance gate — only document 140 permitted" },
    override: "none",
  },
  {
    id: "PERSONA",
    evaluationOrder: 2,
    condition: (_signals, investor) => investor.persona !== "undetermined",
    blockedAction: { skipCategories: ["problem"], reason: "Persona not yet determined — problem beliefs inactive" },
    override: "none",
  },
  {
    id: "S_CLUSTER",
    evaluationOrder: 3,
    condition: (signals) => signals.S1?.state === "green",
    blockedAction: { skipSignals: ["S2", "S3", "S4", "S5", "S6"], reason: "S1 not green — S-cluster inactive" },
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
    condition: (signals, investor) =>
      signals.S2?.state === "green" && signals.C4?.state === "green" && (investor.demoScore ?? 0) >= 70,
    blockedAction: { blockDocument: 120, reason: "Pack 1 gate not met" },
    override: "none",
  },
];

// ============ A3. Content Routing Map ============

export const ROUTING_MAP: readonly RouteEntry[] = [
  { signal: "C4", triggerStates: ["amber", "grey"], docId: 140, docName: "Access Explainer",
    isComplianceGateOverride: true,
    note: "ONLY document permitted when C4 is not green." },
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
];

// ============ A4. Persona Detection ============

export const PERSONA_CONFIG = {
  threshold: 8,
  personas: [
    {
      id: "preserver",
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
        { pattern: "terrified", weight: 3 },
        { pattern: "mistake", weight: 2 },
      ],
    },
    {
      id: "growth_seeker",
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
      id: "legacy_builder",
      label: "The Legacy Builder",
      problemCluster: ["L1", "L2"],
      demoEmphasis: "IHT trajectory + pension interaction",
      patterns: [
        { pattern: "iht", weight: 4 },
        { pattern: "inheritance", weight: 3 },
        { pattern: "estate", weight: 3 },
        { pattern: "children", weight: 3 },
        { pattern: "grandchildren", weight: 3 },
        { pattern: "trust", weight: 3 },
        { pattern: "succession", weight: 3 },
        { pattern: "passing on", weight: 3 },
        { pattern: "bpr", weight: 4 },
        { pattern: "business property relief", weight: 4 },
        { pattern: "next generation", weight: 3 },
        { pattern: "solicitor", weight: 2 },
      ],
    },
  ] as const satisfies readonly PersonaDef[],
  hotButtons: [
    { id: "family", patterns: ["kids", "wife", "provide for", "next generation", "grandchildren", "family"] },
    { id: "freedom", patterns: ["options", "independence", "control", "my own decisions", "not be told"] },
    { id: "legacy", patterns: ["build something", "leave behind", "meaningful", "lasting"] },
    { id: "relief", patterns: ["simplify", "less stress", "one place", "stop worrying", "peace of mind"] },
    { id: "significance", patterns: ["early", "founding", "first", "exclusive", "part of something"] },
  ] as const satisfies readonly HotButtonDef[],
};

// ============ A5. Call Types ============

export const CALL_TYPES = {
  cold_call: {
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
  demo: {
    callNumber: 2,
    name: "Demo + Fact Find",
    owner: "tom" as const,
    durationMins: { min: 40, max: 50 },
    signalResponsibility: ["C1", "C2", "C3", "C4", "S1", "S2"],
    produces: "demo_score",
    postCallTiming: { crmUpdate: "within_2_hours", factFindFields: "within_24_hours", emailSend: "24_to_48_hours" },
  },
  opportunity: {
    callNumber: 3,
    name: "The Opportunity",
    owner: "tom" as const,
    durationMins: { min: 30, max: 45 },
    signalResponsibility: ["S2", "S3", "S4", "S5", "S6"],
    closeScript: "Based on everything we've discussed — what do you think?",
    outcomes: {
      committed: { actions: ["reserve_stock", "send_pack1_if_not_sent", "send_pack2", "initiate_seedlegals"] },
      adviser_loop: { actions: ["send_pack2", "schedule_three_way_call", "set_adviser_involved_flag"] },
      needs_time: { actions: ["set_specific_followup_date", "send_remaining_content", "note_unresolved_belief"] },
      no: { actions: ["close_as_lost", "log_reason", "check_book2_eligible"] },
    },
  },
} as const;

// ============ A6. Timing Rules ============

export const TIMING_RULES = {
  postDemoEmail: { earliest: "24_hours_after_demo", latest: "48_hours_after_demo",
    exception: "If investor explicitly requested specific info on the call, send THAT ITEM immediately." },
  crmUpdate: { deadline: "2_hours_after_call" },
  factFindComplete: { deadline: "24_hours_after_demo" },
  demoCapacity: { maxPerWeek: 10, overflowAction: "activate_webinar_overflow" },
  quarterlyUpdate: { deadline: "45_days_after_quarter_end", activatesWhen: "first_investor_committed" },
} as const;

// ============ A7. Compliance Constants ============

export const COMPLIANCE: { version: string; effectiveDate: string; rules: readonly ComplianceRule[] } = {
  version: "1.0",
  effectiveDate: "2026-04-14",
  rules: [
    { id: "BPR_CAP", correct: "£2.5M per estate — Finance Act 2026",
      prohibited: ["per individual", "per person", "per taxpayer", "announced, subject to final enactment"],
      caveatRequired: false },
    { id: "AIM_BPR", correct: "50% relief in all cases from April 2026 (Finance Act 2026)",
      prohibited: ["100% without qualification"], caveatRequired: false },
    { id: "PENSION_IHT", correct: "subject to final legislation",
      prohibited: ["stated as enacted fact"],
      caveatRequired: true, caveatText: "subject to parliamentary approval of Finance Bill 2025-26" },
    { id: "INVESTMENT_INSTRUMENT", correct: "Instant Investment",
      prohibited: ["ASA", "Advanced Subscription Agreement", "SAFE"], caveatRequired: false },
    { id: "MINIMUM_TICKET", correct: "£40,000", prohibited: ["£20,000", "£20K"], caveatRequired: false },
    { id: "ANTI_DILUTION", correct: "until the Growth Capital round",
      prohibited: ["until Series A"], caveatRequired: false },
    { id: "TOM_KING_BIO",
      correct: "15 years in investor-introduction and capital-facilitation technology. £250M+ capital facilitated.",
      prohibited: ["Cloudworkz"], caveatRequired: false },
    { id: "SEIS_LIMIT", correct: "£200,000", prohibited: ["£100,000"], caveatRequired: false },
    { id: "SEIS_LOSS", correct: "~27.5p per pound (additional rate)",
      prohibited: ["20p", "22p"], caveatRequired: false },
    { id: "EIS_LOSS", correct: "~38.5p per pound (additional rate)",
      prohibited: ["30p as universal"], caveatRequired: false },
    { id: "ROUND_CLOSE", correct: "April 2027",
      prohibited: ["April 6", "April 27", "end of March"], caveatRequired: false },
    { id: "YEAR1_REVENUE", correct: "£44K", prohibited: ["£1.4M"], caveatRequired: false },
    { id: "YEAR5_REVENUE", correct: "£8.78M", prohibited: ["£8.25M"], caveatRequired: false },
    { id: "EXIT_RANGE", correct: "£50M–£80M", prohibited: ["£20–50M"], caveatRequired: false },
  ],
};

// ============ A8. Red Signal Actions ============

export const RED_SIGNAL_ACTIONS: Record<string, { meaning: string; action: string }> = {
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

// ============ A9. Pipeline Stages (V3 — aligned to website enum, see ADR 004) ============
// Engine emits LOGICAL event names. Adapter layer translates to the website's
// current stage via stage_mapping table. Enum changes there are config-only
// updates (no engine code change).

export const PIPELINE_STAGES = [
  { event: "awareness", probability: 0, label: "Awareness" },
  { event: "demo_booked", probability: 20, label: "Demo Booked" },
  { event: "demo_done", probability: 50, label: "Demo Completed" },
  { event: "pack_1_sent", probability: 75, label: "Pack 1 Sent" },
  { event: "due_diligence", probability: 85, label: "Due Diligence" },
  { event: "committed", probability: 100, label: "Committed" },
] as const;

// ============ A10. Question Registry (V3) ============

export const QUESTION_REGISTRY: readonly QuestionDef[] = [
  // CALL 1 — Cold Call
  { qNum: 1, text: "Are you familiar with EIS?", signal: "C3", call: 1, category: "depth_check",
    responseMap: {
      "invest every year": { state: "green", note: "Skip basics on demo" },
      "heard of it": { state: "grey", note: "Full narrative needed" },
      "never looked into": { state: "grey", note: "Full narrative needed" },
      "no": { state: "grey", note: "Start from scratch" },
    }
  },
  { qNum: 2, text: "Are you paying higher or additional rate?", signal: "QT", call: 1, category: "qualification",
    responseMap: {
      "higher rate": { state: "confirmed" },
      "higher": { state: "confirmed" },
      "additional rate": { state: "confirmed" },
      "additional": { state: "confirmed" },
      "basic rate": { state: "not_confirmed", note: "Red — EIS relief limited" },
      "basic": { state: "not_confirmed", note: "Red — EIS relief limited" },
    }
  },
  { qNum: 3, text: "Capital to deploy or mostly tied up?", signal: "QL", call: 1, category: "qualification",
    responseMap: {
      "cash available": { state: "confirmed" },
      "sold a property": { state: "confirmed", note: "Motivated" },
      "sold a rental": { state: "confirmed", note: "Motivated" },
      "sold a business": { state: "confirmed", note: "Motivated" },
      "sitting in cash": { state: "confirmed" },
      "sitting on": { state: "confirmed", note: "Explicit capital amount" },
      "tied up": { state: "not_confirmed", note: "Red — cannot act. Nurture." },
      "everything is invested": { state: "not_confirmed" },
    }
  },
  { qNum: 4, text: "What does your portfolio look like?", signal: "C1", call: 1, category: "profiling",
    alsoSurfaces: ["persona"],
    note: "Listen for: property-heavy=Legacy/Preserver, EIS/alternatives=Growth, pension focus=Legacy/Preserver"
  },
  { qNum: 5, text: "What's the money for?", signal: null, call: 1, category: "profiling" },
  { qNum: 6, text: "Free [day] at [time]?", signal: null, call: 1, category: "booking" },
  { qNum: 7, text: "Aside from an emergency, any reason that wouldn't work?", signal: null, call: 1, category: "commitment_lock" },

  // CALL 2 — Demo + Fact Find
  { qNum: 8, text: "Main thing on your mind financially?", signal: null, call: 2, category: "fact_find",
    captures: ["practical_problem", "current_pressure", "desired_outcome", "persona_confirmation"] },
  { qNum: 9, text: "Does EIS make sense as a mechanism?", signal: "C3", call: 2, category: "diagnostic",
    responseMap: {
      "yes interesting": { state: "green" },
      "makes sense": { state: "green" },
      "want to read more": { state: "amber", contentRoute: 150 },
      "too good to be true": { state: "amber", note: "Return to statutory mechanics" },
      "not for me": { state: "red", note: "Stop EIS. Platform only." },
    }
  },
  { qNum: 10, text: "How comfortable are you with the risk side?", signal: "C4", call: 2, category: "diagnostic",
    gateRole: "COMPLIANCE_GATE",
    responseMap: {
      "done this before": { state: "green" },
      "understand the risk": { state: "green" },
      "worst case": { state: "amber", note: "Moving toward green" },
      "not really a risk-taker": { state: "amber", note: "Probe" },
      "can't have money locked up": { state: "red", note: "EIS not suitable. Send 140 only." },
      "not comfortable": { state: "red" },
    }
  },
  { qNum: 11, text: "Can you see everything in one place today?", signal: "C1", call: 2, category: "diagnostic",
    responseMap: {
      "no, everywhere": { state: "green" },
      "spreadsheet": { state: "green", note: "They described the problem" },
      "no single view": { state: "green" },
      "ifa handles": { state: "amber", note: "C2 narrative will address" },
    }
  },
  { qNum: 12, text: null, signal: "C2", call: 2, category: "narrative",
    note: "Narrative detection, not a question. Detect 'scarce assets' / 'IFA can't' / 'outside regulated'."
  },
  { qNum: 13, text: "[Persona-specific question]", signal: null, call: 2, category: "persona_diagnostic",
    variants: {
      growth_seeker: { text: "Do you know what you're paying in fees on your current EIS fund?", signal: "G1" },
      legacy_builder: { text: "Do you know your estate's IHT exposure right now?", signal: "L1" },
      preserver: { text: "Do you know your actual concentration across your whole portfolio?", signal: "P2" },
    }
  },
  { qNum: 14, text: "Does this make sense for your situation?", signal: "S1", call: 2, category: "diagnostic",
    responseMap: {
      "exactly what I need": { state: "green" },
      "makes sense for me": { state: "green" },
      "impressive but not sure": { state: "amber", note: "Probe what didn't land" },
      "don't see the point": { state: "red", note: "Product didn't land. No further S-beliefs." },
    }
  },
  { qNum: 15, text: "Annual income tax liability?", signal: "QT", call: 2, category: "fact_find",
    captures: ["annual_tax_liability"], note: "Precise figure. Sizes the EIS opportunity." },
  { qNum: 16, text: "Why does this matter now?", signal: "S6", call: 2, category: "fact_find",
    captures: ["current_pressure"], alsoSurfaces: ["S6"] },
  { qNum: 17, text: "Anyone else involved in decisions?", signal: "S5", call: 2, category: "fact_find",
    captures: ["decision_stakeholders"], note: "Flags adviser loop" },
  { qNum: 18, text: "Anything specific you want to know more about?", signal: null, call: 2, category: "fact_find",
    captures: ["questions_for_call3"] },
  { qNum: 19, text: "Consider backing as well as using?", signal: "S2", call: 2, category: "diagnostic",
    gateRole: "TRACK_ROUTER",
    responseMap: {
      "yes": { state: "green", note: "Schedule Call 3. Check Pack 1 gate." },
      "possibly": { state: "amber", contentRoute: 100 },
      "want to know more": { state: "amber", contentRoute: 100 },
      "no, just platform": { state: "red" },
      "just the platform": { state: "red" },
    }
  },

  // CALL 3 — The Opportunity
  { qNum: 20, text: "Has anything changed since we spoke?", signal: null, call: 3, category: "confirmation" },
  { qNum: 21, text: "How does the valuation land?", signal: "S3", call: 3, category: "diagnostic",
    responseMap: {
      "seems reasonable": { state: "green" },
      "feels high": { state: "amber" },
      "dealbreaker": { state: "red" },
    }
  },
  { qNum: 22, text: "What would you need to see re: the team?", signal: "S4", call: 3, category: "diagnostic",
    responseMap: {
      "I trust you": { state: "green" },
    }
  },
  { qNum: 23, text: "Run this past your adviser?", signal: "S5", call: 3, category: "diagnostic",
    responseMap: {
      "accountant": { state: "amber", note: "Facilitate adviser loop" },
      "adviser": { state: "amber", note: "Facilitate adviser loop" },
      "no, comfortable": { state: "green" },
    }
  },
  { qNum: 24, text: "Is this something you want to do?", signal: null, call: 3, category: "close",
    prerequisite: "C4 green AND S2 green AND relevant S-beliefs green",
    responseMap: {
      "yes": { outcome: "committed" },
      "need more time": { outcome: "needs_time" },
      "no": { outcome: "no" },
    }
  },
  { qNum: 25, text: "What questions do you still have?", signal: null, call: 3, category: "final_diagnostic" },
];

// ============ A11. Demo Segment Map (V3) ============

export const DEMO_SEGMENTS: readonly DemoSegmentDef[] = [
  { segment: 1, name: "Open with them", durationMins: 5, screenShare: false,
    questionsUsed: [8], signalsSurfaced: ["QT", "QL", "C1"],
    alsoCaptures: ["persona", "hot_button", "desired_outcome"],
    expectedOutcome: "QT/QL confirmed or flagged. C1 amber or green. Persona identified or narrowed." },
  { segment: 2, name: "EIS narrative", durationMins: 8, screenShare: false,
    questionsUsed: [9, 10], signalsSurfaced: ["C3", "C4", "C2"],
    alsoCaptures: ["annual_tax_liability"],
    expectedOutcome: "C3 amber or green. C4 surfaced. C2 reinforced.",
    criticalGate: "If C4 not green after this segment, do NOT proceed to investment discussion. Focus on platform as planning tool. Route to 140." },
  { segment: 3, name: "Asset register demo", durationMins: 5, screenShare: true,
    questionsUsed: [11], signalsSurfaced: ["C1"],
    expectedOutcome: "C1 → green. Visual impact of seeing everything in one place." },
  { segment: 4, name: "Decumulation planner demo", durationMins: 12, screenShare: true,
    questionsUsed: [13, 14], signalsSurfaced: ["S1"],
    personaBeliefsSurfaced: {
      legacy_builder: ["L1", "L2"],
      preserver: ["P2", "P3"],
      growth_seeker: ["G1", "G2"],
    },
    expectedOutcome: "S1 → green. Persona-specific beliefs surfaced and partially resolved." },
  { segment: 5, name: "Founding round", durationMins: 7, screenShare: false,
    questionsUsed: [19], signalsSurfaced: ["S2", "S3", "S4", "S5", "S6"],
    expectedOutcome: "S2 surfaced. If green, explore S3–S6.",
    note: "Ask S2 first. Only explore S3–S6 if S2 is clearly yes." },
  { segment: 6, name: "Close + fact find", durationMins: 10, screenShare: false,
    questionsUsed: [15, 16, 17, 18], signalsSurfaced: [],
    captures: ["annual_tax_liability", "current_pressure", "decision_stakeholders", "questions_for_call3"],
    expectedOutcome: "Fact find populated. Call 3 date set. Content routing decision made." },
];

// ============ A12. Cold Call Script Structure (V3) ============

export const COLD_CALL_STEPS: readonly ColdCallStepDef[] = [
  { step: 1, name: "Greeting & Permission", signalTarget: null,
    purpose: "Get permission to talk. If bad time, book callback and end." },
  { step: 2, name: "Platform Introduction", signalTarget: "C1",
    purpose: "Introduce Unlock as a portfolio visibility platform." },
  { step: 3, name: "EIS Introduction", signalTarget: "C3",
    purpose: "Introduce EIS as a government scheme. Ask if familiar." },
  { step: 4, name: "Revolut Anchor", signalTarget: "C3",
    purpose: "Revolut as EIS success story. £75B valuation. Tax-free gains." },
  { step: 5, name: "EIS Mechanics", signalTarget: "C3",
    purpose: "30% relief, loss relief (~38.5p), CGT-free gains, BPR after 2 years." },
  { step: 6, name: "Portfolio Model (4-3-2-1)", signalTarget: "C3",
    purpose: "4 fail, 3 modest, 2 strong, 1 fund-buster. Average 5-6x." },
  { step: 7, name: "Annual Translation", signalTarget: "C3",
    purpose: "3x annual tax = optimal deployment. Tax as trophy." },
  { step: 8, name: "Ten-Year Illustration", signalTarget: "C3",
    purpose: "£50K/yr x 10yr = £1M → £5-6M tax-free." },
  { step: 9, name: "Unlock as EIS", signalTarget: "S1",
    purpose: "Unlock itself is EIS-qualifying." },
  { step: 10, name: "Self-Directed Confirmation", signalTarget: "C2",
    purpose: "IFAs can't advise on individual EIS. Unlock fills the gap." },
  { step: 11, name: "Demo Invitation", signalTarget: null,
    purpose: "Video call with Tom. 15-20 minutes." },
  { step: 12, name: "QT Qualification", signalTarget: "QT", purpose: "Higher or additional rate?" },
  { step: 13, name: "QL Qualification", signalTarget: "QL", purpose: "Capital available or tied up?" },
  { step: 14, name: "Profiling Questions", signalTarget: "persona",
    purpose: "Portfolio shape, focus, adviser, stakeholders." },
  { step: 15, name: "Booking", signalTarget: null,
    purpose: "Specific day and time. Laptop. Video call." },
  { step: 16, name: "Commitment Lock", signalTarget: null,
    purpose: "Aside from an emergency, any reason? + compliance disclaimer." },
];

// ============ A13. Email Templates (V3) ============

export const EMAIL_TEMPLATES: {
  demoConfirmation: EmailTemplateDef;
  postDemo: EmailTemplateDef;
  attachmentRoutingTable: readonly AttachmentRouteEntry[];
  personaSupplementWithPack1: Record<string, { docId: number; docName: string } | { docIds: readonly number[]; docNames: readonly string[] }>;
} = {
  demoConfirmation: {
    id: "EMAIL_1",
    trigger: "disposition_code === '101'",
    timing: "immediate",
    subject: "Your call with Tom — [DAY] at [TIME]",
    attachment: { docId: 100, docName: "One-Pager" },
    structure: [
      "Opening: Good to speak. Looking forward to [DAY].",
      "Frame: This call is about EIS and the platform. Not the investment.",
      "EIS philosophy paragraph: asymmetric risk, discipline not punt.",
      "Two things covered: (1) EIS walkthrough, (2) platform demo.",
      "What we won't cover: investment opportunity — unless they want to.",
      "Duration: 15–20 min + questions. Video call, screen share.",
      "Attachment reference: short overview attached, no need to read in advance.",
      "FP disclaimer: Capital at risk. Introduction, not financial advice.",
    ],
    personalisationRequired: false,
    note: "Minimal personalisation — name and time only."
  },
  postDemo: {
    id: "EMAIL_2",
    trigger: "call_type === 'demo' AND demo completed",
    timing: "24_to_48_hours",
    timingException: "If investor explicitly requested specific info during the call, send THAT ITEM immediately. This email follows 24–48 hours later.",
    subject: "Following up — and what happens next if you want it to",
    structure: [
      "Opening: Thanks for the time today.",
      "Recap section: Personalised from call. Use their words.",
      "Status section: Where you are now — honest assessment.",
      "Next step section: Frame Call 3 and what it covers.",
      "Attachment section: One specific content asset with one-sentence explanation.",
      "Soft CTA: Let me know what you think.",
      "Availability: Specific slots for Call 3.",
      "FP disclaimer.",
    ],
    personalisationRequired: true,
    personalisationFields: ["exact_phrases", "practical_problem", "desired_outcome", "specific_reactions_from_demo"],
    attachmentRouting: "Use A3 ROUTING_MAP — one attachment mapped to highest unresolved belief.",
  },
  attachmentRoutingTable: [
    { belief: "C3", state: "amber", docId: 150, angle: "Goes deeper on the mechanics" },
    { belief: "C4", state: "amber", docId: 140, angle: "Covers the risk side — illiquidity, hold period, effective downside" },
    { belief: "L1", state: "amber", docId: 170, angle: "Connect to their family / estate situation" },
    { belief: "L2", state: "amber", docId: 170, angle: "Reference the £2.5M cap — BPR section" },
    { belief: "G1", state: "amber", docId: 180, angle: "Reference their current fund if named" },
    { belief: "G2", state: "amber", docId: 140, angle: "How Unlock Access works versus funds — syndicate section" },
    { belief: "P2", state: "amber", docId: 181, angle: "Reference the asset class they're concentrated in" },
    { belief: "S2", state: "amber", docId: 100, angle: "Context on the opportunity" },
    { belief: "PACK1_GATE", state: "eligible", docId: 120, angle: "The founding investor overview" },
  ],
  personaSupplementWithPack1: {
    preserver: { docId: 170, docName: "IHT EIS Estate Planning" },
    growth_seeker: { docId: 150, docName: "EIS Investors Secret Weapon" },
    legacy_builder: { docIds: [170, 160], docNames: ["IHT Planning", "EIS Case Studies"] },
  },
};

// ============ A14. Problem Belief Detection Patterns (V3) ============
// Used by analyseSignals (C3) as additional detection patterns for problem beliefs.

export const PROBLEM_BELIEF_PATTERNS: Record<string, ProblemBeliefPatternDef> = {
  G1: {
    name: "Fee Awareness", persona: "growth_seeker",
    detectionPatterns: [
      { pattern: "fees", weight: 3 },
      { pattern: "charges", weight: 3 },
      { pattern: "management fee", weight: 4 },
      { pattern: "paying too much", weight: 4 },
      { pattern: "3%", weight: 3, note: "Typical EIS fund annual fee" },
      { pattern: "performance fee", weight: 3 },
      { pattern: "fee drag", weight: 4 },
      { pattern: "ridiculous", weight: 2, context: "fees" },
    ],
  },
  G2: {
    name: "Deal Flow Gap", persona: "growth_seeker",
    detectionPatterns: [
      { pattern: "access to deals", weight: 4 },
      { pattern: "deal flow", weight: 4 },
      { pattern: "sourcing", weight: 2 },
      { pattern: "pipeline", weight: 3 },
      { pattern: "direct investment", weight: 3 },
    ],
  },
  G3: {
    name: "Early Entry Value", persona: "growth_seeker",
    detectionPatterns: [
      { pattern: "early stage", weight: 3 },
      { pattern: "ground floor", weight: 3 },
      { pattern: "founding", weight: 3 },
      { pattern: "pre-revenue", weight: 2 },
      { pattern: "first in", weight: 3 },
    ],
  },
  L1: {
    name: "IHT Exposure", persona: "legacy_builder",
    detectionPatterns: [
      { pattern: "iht", weight: 4 },
      { pattern: "inheritance tax", weight: 4 },
      { pattern: "estate value", weight: 3 },
      { pattern: "nil rate band", weight: 3 },
      { pattern: "estate planning", weight: 3 },
      { pattern: "tax on death", weight: 3 },
    ],
  },
  L2: {
    name: "BPR Cap Awareness", persona: "legacy_builder",
    detectionPatterns: [
      { pattern: "bpr", weight: 4 },
      { pattern: "business property relief", weight: 4 },
      { pattern: "2.5 million", weight: 3 },
      { pattern: "£2.5m", weight: 3 },
      { pattern: "finance act", weight: 3 },
    ],
  },
  P2: {
    name: "Concentration Risk", persona: "preserver",
    detectionPatterns: [
      { pattern: "concentrated", weight: 4 },
      { pattern: "all in property", weight: 4 },
      { pattern: "one provider", weight: 3 },
      { pattern: "too much in", weight: 3 },
      { pattern: "eggs in one basket", weight: 4 },
      { pattern: "overweight", weight: 3 },
    ],
  },
  P3: {
    name: "Income Sustainability", persona: "preserver",
    detectionPatterns: [
      { pattern: "will it last", weight: 4 },
      { pattern: "run out", weight: 4 },
      { pattern: "sustainable income", weight: 4 },
      { pattern: "drawdown rate", weight: 3 },
      { pattern: "sequence of returns", weight: 3 },
    ],
  },
};

// ============ A15. Post-Close Workflow (V3) ============

export const POST_CLOSE_WORKFLOW: { stages: readonly PostCloseStageDef[] } = {
  stages: [
    {
      stage: 6, name: "Committed — Paperwork", trigger: "call3_outcome === 'committed'",
      actions: [
        { action: "reserve_stock", owner: "tom", timing: "immediate" },
        { action: "send_pack1_if_not_sent", owner: "tom", timing: "immediate" },
        { action: "send_pack2", owner: "tom", timing: "within_24_hours" },
        { action: "initiate_seedlegals", owner: "tom", timing: "within_24_hours",
          detail: "Instant Investment process. Digital paperwork via SeedLegals." },
      ],
    },
    {
      stage: 7, name: "SeedLegals Processing", trigger: "seedlegals_initiated",
      actions: [
        { action: "monitor_seedlegals_completion", owner: "system", timing: "ongoing" },
        { action: "chase_if_unsigned_after_5_days", owner: "tom", timing: "5_days" },
      ],
    },
    {
      stage: 8, name: "Capital Transferred — Welcome", trigger: "capital_received",
      actions: [
        { action: "welcome_call", owner: "tom", timing: "within_48_hours",
          detail: "Confirm process. Product input opportunity. Referral potential." },
        { action: "send_onboarding_kit", owner: "system", timing: "immediate" },
        { action: "send_eis_confirmation_email", owner: "system", timing: "immediate" },
        { action: "tag_founding_investor", owner: "system", timing: "immediate",
          detail: "Permanently excluded from Book 2 and cold outreach." },
      ],
    },
    {
      stage: 9, name: "Active Founding Investor", trigger: "welcome_call_completed",
      recurringActions: [
        { action: "quarterly_update", owner: "tom", timing: "within_45_days_of_quarter_end",
          detail: "Platform milestones, progress, referral activation. 1–2 page email. Skipping is the most expensive thing." },
        { action: "referral_activation", owner: "tom", timing: "with_quarterly_update",
          detail: "Prompt: 'Know anyone who should see this? Your founding subscriber rate stays the same.'" },
      ],
    },
  ],
};

// ============ A16. Adviser Loop Workflow (V3) ============

export const ADVISER_LOOP_WORKFLOW: AdviserLoopDef = {
  trigger: "call3_outcome === 'adviser_loop' OR (S5 === 'amber' AND adviser/accountant mentioned)",
  preCall: {
    actions: [
      { action: "send_pack2_to_investor", owner: "tom", timing: "within_24_hours",
        detail: "Pack 2 is the due diligence document. Sent to investor, not directly to adviser." },
      { action: "send_relevant_persona_supplement", owner: "tom", timing: "with_pack2",
        detail: "170 for Legacy Builder, 150 for Growth Seeker, 170 for Preserver." },
      { action: "schedule_three_way_call", owner: "tom", timing: "within_48_hours",
        detail: "Tom + investor + IFA/accountant. Zoom. 30 minutes." },
    ],
  },
  duringCall: {
    tomRole: "Information provider, not adviser. Tom does not give financial advice on the call.",
    openingFrame: "I'm here to answer questions about the investment mechanics, the company, and the EIS structure. I'm not providing advice — the investor is making their own informed decision.",
    agenda: [
      "EIS advance assurance confirmed — HMRC approved",
      "Instant Investment mechanics — used in ~33% of UK rounds",
      "BPR framing: Finance Act 2026 enacted law",
      "Valuation rationale if asked",
      "Does not give financial advice — facilitates the adviser's due diligence",
    ],
    fcaConcerns: "If adviser raises FCA concerns: EIS is outside regulated advice scope. Investor is making their own decision. Unlock provides information, tools, and access — not advice.",
  },
  postCall: {
    actions: [
      { action: "follow_up_to_investor_directly", owner: "tom", timing: "within_24_hours",
        detail: "The relationship is with the investor, not the adviser." },
      { action: "update_pipedrive", owner: "tom", timing: "same_day",
        fields: ["adviser_call_completed", "adviser_objections", "S5_state_update"] },
      { action: "if_adviser_satisfied", nextStep: "soft_commitment_call" },
      { action: "if_adviser_has_concerns", nextStep: "address_and_reschedule",
        detail: "Note specific concerns. Provide additional evidence. Schedule follow-up." },
    ],
  },
};

// ============ A17. Book 2 Routing (V3) ============

export const BOOK2_ROUTING: Book2RoutingDef = {
  trigger: "S2 === 'red' OR investor explicitly platform-only OR QT === 'not_confirmed'",
  entryActions: [
    { action: "tag_book2_eligible", owner: "system", timing: "immediate" },
    { action: "add_to_waiting_list_sequence", owner: "system", timing: "immediate",
      detail: "Klaviyo sequence. Waiting list opens June 2026." },
  ],
  subscriberPipeline: [
    { stage: "waiting_list", trigger: "tagged book2_eligible",
      autoEmails: [
        { name: "Welcome", timing: "day_0", wordCount: "100-150", content: "Confirmation, no pitch" },
        { name: "Fragmentation", timing: "day_3", wordCount: "200-350", content: "Problem only" },
        { name: "EIS Maths", timing: "day_7", content: "Loss relief with bracket qualifier" },
        { name: "IHT Planning", timing: "day_14", content: "BPR caveat; pension IHT caveat" },
        { name: "Portfolio Intelligence", timing: "day_21", content: "Platform value proposition" },
      ],
    },
    { stage: "sandbox_activation", trigger: "September 2026 launch",
      action: "Demo sandbox available. Convert waiting list to active trial." },
    { stage: "subscription", trigger: "trial_completed",
      action: "Convert to Standard (£99/mo) or White Glove (£299/mo)." },
  ],
  crossoverRule: "If a Book 2 subscriber later signals investor interest (EIS questions, ticket size, asks about founding round), tag investor_track and route to Book 1 pipeline. Both tracks run in parallel until investor confirms preference.",
  exclusionRules: [
    { tag: "founding_investor", rule: "Permanently excluded from ALL Book 2 sequences" },
    { tag: "investor_track", rule: "Stays in Book 2 parallel until preference confirmed" },
    { tag: "eis_not_eligible", rule: "EIS content deprioritised. IHT and portfolio content continues." },
  ],
};
