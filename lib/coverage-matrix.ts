export const ARCHETYPES = ["Growth Seeker", "Preserver", "Legacy Builder"] as const;

export const PIPELINE_STAGES = [
  "Outreach",
  "Called",
  "Demo Booked",
  "Demo Complete",
  "Decision",
] as const;

export const COVERAGE_MATRIX: Array<{ archetype: string; stage: string }> = [];
for (const archetype of ARCHETYPES) {
  for (const stage of PIPELINE_STAGES) {
    COVERAGE_MATRIX.push({ archetype, stage });
  }
}

export const REQUIRED_DOCUMENT_TYPES = [
  "Case study",
  "One-pager / overview",
  "FAQ / objection handler",
  "Compliance / risk disclosure",
  "How it works / explainer",
  "Pricing / terms summary",
] as const;

export const EXPECTED_COMPLIANCE_FIELDS = [
  "eis_income_tax_relief",
  "eis_cgt_deferral",
  "seis_income_tax_relief",
  "loss_relief_rate",
  "vct_relief_rate",
  "annual_eis_limit",
  "annual_seis_limit",
] as const;

export const COMPLIANCE_FIELD_LABELS: Record<string, string> = {
  eis_income_tax_relief: "EIS income tax relief rate",
  eis_cgt_deferral: "EIS CGT deferral rate",
  seis_income_tax_relief: "SEIS income tax relief rate",
  loss_relief_rate: "Loss relief rate",
  vct_relief_rate: "VCT relief rate",
  annual_eis_limit: "Annual EIS limit",
  annual_seis_limit: "Annual SEIS limit",
};
