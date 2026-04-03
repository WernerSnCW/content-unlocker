export const PERSONA_TO_ARCHETYPE: Record<string, string> = {
  "Crypto Enthusiast":          "Growth Seeker",
  "Tech Worker":                "Growth Seeker",
  "Young Professional":         "Growth Seeker",
  "Entrepreneur":               "Growth Seeker",
  "BTL Mogul":                  "Growth Seeker",
  "Concentrated Stock Holder":  "Growth Seeker",

  "Retirement Planner":         "Preserver",
  "Old Fashioned Saver":        "Preserver",
  "ISA/SIPP Maximiser":         "Preserver",
  "DB Heavy":                   "Preserver",
  "Cautious Accumulator":       "Preserver",
  "Drawdown Specialist":        "Preserver",
  "Ultra-Conservative Saver":   "Preserver",

  "Property Lover":             "Legacy Builder",
  "Legacy Builder":             "Legacy Builder",
  "Dividend Seeker":            "Legacy Builder",
  "Global Nomad":               "Legacy Builder",
  "Financial Advisor":          "Legacy Builder",
  "HNW Inheritor":              "Legacy Builder",

  "Growth Seeker":              "Growth Seeker",
  "Preserver":                  "Preserver",
};

export const VALID_ARCHETYPES = ["Growth Seeker", "Preserver", "Legacy Builder"];

export function resolveArchetype(persona: string): string | null {
  return PERSONA_TO_ARCHETYPE[persona] ?? null;
}
