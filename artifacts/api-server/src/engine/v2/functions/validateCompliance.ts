// C9. validateCompliance
import { COMPLIANCE } from "../config";
import { lower } from "../util";

export interface ComplianceViolation {
  ruleId: string;
  found: string;
  correct: string;
}

export interface ComplianceResult {
  passed: boolean;
  violations: ComplianceViolation[];
}

export function validateCompliance(text: string): ComplianceResult {
  if (!text) return { passed: true, violations: [] };
  const haystack = lower(text);
  const violations: ComplianceViolation[] = [];

  for (const rule of COMPLIANCE.rules) {
    for (const forbidden of rule.prohibited) {
      if (haystack.includes(lower(forbidden))) {
        violations.push({ ruleId: rule.id, found: forbidden, correct: rule.correct });
      }
    }
    if (rule.caveatRequired && rule.caveatText) {
      // If the text triggers this topic but lacks the caveat, flag.
      const needsCaveat = haystack.includes("pension") && haystack.includes("iht");
      if (rule.id === "PENSION_IHT" && needsCaveat && !haystack.includes(lower(rule.caveatText))) {
        violations.push({
          ruleId: rule.id,
          found: "pension + IHT mentioned without required caveat",
          correct: rule.caveatText,
        });
      }
    }
  }

  // Extra check: EIS loss relief without rate bracket
  if (haystack.includes("loss relief") && !haystack.match(/additional rate|higher rate|basic rate/)) {
    violations.push({
      ruleId: "EIS_LOSS",
      found: "loss relief mentioned without rate bracket",
      correct: "always qualify loss relief by taxpayer rate bracket",
    });
  }

  return { passed: violations.length === 0, violations };
}
