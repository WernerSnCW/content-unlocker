// Shared fixtures used across tests.
import type { Investor } from "../types";

export function blankInvestor(overrides: Partial<Investor> = {}): Investor {
  return {
    investorId: "test_1",
    name: "Test Investor",
    persona: "undetermined",
    hotButton: null,
    demoScore: null,
    bookTrack: null,
    decisionStyle: "unknown",
    pack1Gate: "blocked",
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
    callHistory: [],
    artifactsSent: [],
    ...overrides,
  };
}

export function signalAt(state: string) {
  return {
    code: "X",
    state: state as any,
    surfacedBy: "conversation" as const,
    notes: "",
    updatedAt: "2026-04-14T00:00:00Z",
    confidence: "medium" as const,
  };
}
