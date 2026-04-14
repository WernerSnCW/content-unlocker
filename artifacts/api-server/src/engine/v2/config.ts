// PART A — Config
// Pure data. When the engine is updated, most changes land here.
// See: docs/402_SPEC_Intelligence_Engine_V2_CURRENT.md
import type {
  SignalDef,
  PersonaDef,
  HotButtonDef,
  GateDef,
  RouteEntry,
  ComplianceRule,
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

// ============ A9. Pipeline Stages ============

export const PIPELINE_STAGES = [
  { stage: 1, name: "Outreach Queued", probability: 0 },
  { stage: 2, name: "Demo Booked", probability: 20 },
  { stage: 3, name: "Demo Scheduled", probability: 40 },
  { stage: 4, name: "Demo Completed", probability: 60 },
  { stage: 5, name: "Pack 1 Sent — Decision Stage", probability: 75 },
] as const;
