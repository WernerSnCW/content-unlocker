// PART B — Types
// Defined first; everything else depends on them.

export type SignalCategory = "qualification" | "core" | "problem" | "situational";
export type BeliefState = "green" | "amber" | "grey" | "red" | "n_a";
export type QualState = "confirmed" | "not_confirmed" | "unknown";
export type Persona = "preserver" | "growth_seeker" | "legacy_builder" | "undetermined";
export type HotButton = "family" | "freedom" | "legacy" | "relief" | "significance";
export type DecisionStyle = "quick" | "thorough" | "unknown";
export type BookTrack = "book_1" | "nurture";
export type CallType = "cold_call" | "demo" | "opportunity";
export type ActionType =
  | "send_content"
  | "schedule_call"
  | "close_deal"
  | "move_to_nurture"
  | "escalate_to_tom"
  | "reserve_stock"
  | "initiate_seedlegals"
  | "schedule_adviser_call";
export type Owner = "agent" | "tom" | "system";
export type Confidence = "high" | "medium" | "low";
export type FlagType = "compliance_warning" | "missing_data" | "timing_violation" | "gate_blocked";

export type AnyState = BeliefState | QualState;

export interface SignalState {
  code: string;
  state: AnyState;
  surfacedBy: "question" | "conversation" | "not_yet";
  notes: string;
  updatedAt: string;
  confidence: Confidence;
}

export type SignalMap = Record<string, SignalState>;

export interface FactFind {
  practicalProblem: string | null;
  currentPressure: string | null;
  personalAngle: string | null;
  desiredOutcome: string | null;
  exactPhrases: string[];
  portfolioShape: string | null;
  annualTaxLiability: number | null;
  decisionStakeholders: string | null;
  decisionStyle: DecisionStyle;
  questionsForCall3: string | null;
}

export interface CallRecord {
  callNumber: number;
  callType: CallType;
  date: string;
  durationMins: number;
  dispositionCode: string | null;
  signalsUpdated: string[];
  notes: string;
}

export interface ArtifactRecord {
  docId: number;
  docName: string;
  triggerSignal: string;
  sentAt: string;
  opened: boolean | null;
}

export interface Investor {
  investorId: string;
  name: string;
  persona: Persona;
  hotButton: HotButton | null;
  demoScore: number | null;
  bookTrack: BookTrack | null;
  decisionStyle: DecisionStyle;
  pack1Gate: "eligible" | "blocked";
  signals: SignalMap;
  factFind: FactFind;
  callHistory: CallRecord[];
  artifactsSent: ArtifactRecord[];
}

export interface SignalUpdate {
  code: string;
  previousState: string;
  newState: string;
  evidence: string;
  confidence: Confidence;
}

export interface ContentRecommendation {
  docId: number;
  docName: string;
  triggerSignal: string;
  coverNoteDraft: string | null;
}

export interface GateResult {
  c4Compliance: "open" | "blocked";
  pack1: "eligible" | "blocked";
  pack1BlockedReasons: string[];
  activeRoute: "book_1" | "nurture" | "send_100_revisit" | "nurture_no_situational" | "pending";
  blockedSignals: string[];
}

export interface NextAction {
  actionType: ActionType;
  detail: string;
  owner: Owner;
  timing: string;
  contentToSend: ContentRecommendation | null;
}

export interface EngineFlag {
  type: FlagType;
  message: string;
}

export interface EngineOutput {
  engineVersion: string;
  processedAt: string;
  callType: CallType;
  investorId: string;

  signalUpdates: SignalUpdate[];
  factFindUpdates: Partial<FactFind>;
  personaAssessment: { persona: Persona; confidence: Confidence; evidence: string };
  hotButton: { primary: HotButton | null; evidence: string };
  demoScore: number | null;

  gateStatus: GateResult;

  nextBestAction: NextAction;

  // V3: pipelineTransition now uses logical event names (see ADR 004).
  // Adapter layer resolves to the website's current stage enum via stage_mapping table.
  pipelineTransition: { fromEvent: string | null; toEvent: string; reason: string } | null;
  crmNote: string;
  flags: EngineFlag[];
}

// ============ V3 types (ADDITIVE) ============

export interface QuestionDetection {
  questionNumber: number;
  detected: boolean;
  signalTarget: string | null;
  investorResponse: string | null;
  inferredState: string | null;
  confidence: Confidence;
}

export interface DemoSegmentAnalysis {
  segment: number;
  segmentName: string;
  covered: boolean;
  signalOutcomes: { code: string; state: string }[];
  skipped: boolean;
  skipReason: string | null;
}

export interface EmailOutput {
  templateId: string; // "EMAIL_1" | "EMAIL_2"
  subject: string;
  body: string;
  attachmentDocId: number | null;
  attachmentDocName: string | null;
  coverNoteAngle: string | null;
  personalisationSources: string[];
  complianceCheck: { passed: boolean; violations: string[] };
  timing: string;
}

export interface PostCloseAction {
  action: string;
  owner: Owner | "system";
  timing: string;
  detail?: string;
}

export interface AdviserLoopAction {
  phase: "pre_call" | "during_call" | "post_call";
  actions: PostCloseAction[];
}

export interface Book2RoutingResult {
  triggered: boolean;
  reason: string;
  actions: string[];
}

// Extended output — V3 superset of V2. Additive, non-breaking.
export interface EngineOutputV3 extends EngineOutput {
  questionsDetected: QuestionDetection[];
  demoSegmentAnalysis: DemoSegmentAnalysis[] | null;
  emailDraft: EmailOutput | null;
  postCloseActions: PostCloseAction[] | null;
  adviserLoopActions: AdviserLoopAction[] | null;
  book2Routing: Book2RoutingResult | null;
}

// Config-side types (for Part A)

export interface SignalDef {
  code: string;
  name: string;
  category: SignalCategory;
  persona: Persona | null;
  priority: number;
  validStates: readonly AnyState[];
  activation: string; // human-readable rule; evaluated via isSignalActive()
  gateRole?: string;
  note?: string;
  detectionPatterns?: readonly { pattern: string; weight: number; note?: string }[];
  negativePatterns?: readonly { pattern: string; weight: number }[];
}

export interface PersonaDef {
  id: Exclude<Persona, "undetermined">;
  label: string;
  problemCluster: readonly string[];
  demoEmphasis: string;
  patterns: readonly { pattern: string; weight: number }[];
}

export interface HotButtonDef {
  id: HotButton;
  patterns: readonly string[];
}

export interface GateDef {
  id: string;
  evaluationOrder: number;
  condition?: (signals: SignalMap, investor: Investor) => boolean;
  blockedAction?: Record<string, any>;
  override?: string;
  routeMap?: Record<string, string>;
}

export interface RouteEntry {
  signal: string;
  triggerStates: readonly string[];
  docId: number | null;
  docName: string;
  personaFilter?: Persona;
  personaVariant?: Record<string, { docId: number | null; docName: string }>;
  altDoc?: { docId: number; docName: string };
  isComplianceGateOverride?: boolean;
  gateCondition?: string;
  note?: string;
}

export interface ComplianceRule {
  id: string;
  correct: string;
  prohibited: readonly string[];
  caveatRequired: boolean;
  caveatText?: string;
}

// ============ V3 config-side types ============

export interface QuestionDef {
  qNum: number;
  text: string | null; // null for narrative questions (e.g. Q12)
  signal: string | null;
  call: 1 | 2 | 3;
  category: string;
  alsoSurfaces?: readonly string[];
  note?: string;
  responseMap?: Readonly<Record<string, { state?: string; outcome?: string; note?: string; contentRoute?: number }>>;
  variants?: Readonly<Record<string, { text: string; signal: string }>>;
  captures?: readonly string[];
  gateRole?: string;
  prerequisite?: string;
}

export interface DemoSegmentDef {
  segment: number;
  name: string;
  durationMins: number;
  screenShare: boolean;
  questionsUsed: readonly number[];
  signalsSurfaced: readonly string[];
  alsoCaptures?: readonly string[];
  personaBeliefsSurfaced?: Readonly<Record<string, readonly string[]>>;
  captures?: readonly string[];
  expectedOutcome: string;
  criticalGate?: string;
  note?: string;
}

export interface ColdCallStepDef {
  step: number;
  name: string;
  signalTarget: string | null;
  purpose: string;
}

export interface AttachmentRouteEntry {
  belief: string;
  state: string;
  docId: number;
  angle: string;
}

export interface EmailTemplateDef {
  id: string;
  trigger: string;
  timing: string;
  timingException?: string;
  subject: string;
  attachment?: { docId: number; docName: string };
  structure: readonly string[];
  personalisationRequired: boolean;
  personalisationFields?: readonly string[];
  attachmentRouting?: string;
  note?: string;
}

export interface ProblemBeliefPatternDef {
  name: string;
  persona: string;
  detectionPatterns: readonly { pattern: string; weight: number; note?: string; context?: string }[];
}

export interface PostCloseStageDef {
  stage: number;
  name: string;
  trigger: string;
  actions?: readonly {
    action: string;
    owner: string;
    timing: string;
    detail?: string;
  }[];
  recurringActions?: readonly {
    action: string;
    owner: string;
    timing: string;
    detail?: string;
  }[];
}

export interface AdviserLoopDef {
  trigger: string;
  preCall: {
    actions: readonly { action: string; owner: string; timing: string; detail?: string }[];
  };
  duringCall: {
    tomRole: string;
    openingFrame: string;
    agenda: readonly string[];
    fcaConcerns: string;
  };
  postCall: {
    actions: readonly { action: string; owner?: string; timing?: string; detail?: string; nextStep?: string; fields?: readonly string[] }[];
  };
}

export interface Book2RoutingDef {
  trigger: string;
  entryActions: readonly { action: string; owner: string; timing: string; detail?: string }[];
  subscriberPipeline: readonly {
    stage: string;
    trigger: string;
    action?: string;
    autoEmails?: readonly { name: string; timing: string; wordCount?: string; content: string }[];
  }[];
  crossoverRule: string;
  exclusionRules: readonly { tag: string; rule: string }[];
}
