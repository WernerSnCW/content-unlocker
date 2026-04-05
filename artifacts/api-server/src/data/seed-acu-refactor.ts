import { db, acuTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const topicMapping: Record<string, { topics: string[]; requires_qualifier?: string; policy_status?: string }> = {
  "acu_eis_relief_30":         { topics: ["eis_relief_rate"] },
  "acu_seis_relief_50":        { topics: ["seis_relief_rate"] },
  "acu_vct_relief_20":         { topics: ["vct_relief_rate"] },
  "acu_eis_loss_relief":       { topics: ["eis_loss_relief"], requires_qualifier: "acu_tax_circumstances", policy_status: "enacted" },
  "acu_seis_loss_relief":      { topics: ["seis_loss_relief"], requires_qualifier: "acu_tax_circumstances", policy_status: "enacted" },
  "acu_22p_prohibited":        { topics: ["prohibited_22p"] },
  "acu_78x_prohibited":        { topics: ["prohibited_78x"] },
  "acu_april6_deadline_prohibited": { topics: ["prohibited_april6_deadline"] },
  "acu_return_5_6x":           { topics: ["return_on_effective_cost"], requires_qualifier: "acu_tax_circumstances" },
  "acu_4321_model":            { topics: ["portfolio_model_4321"], requires_qualifier: "acu_capital_at_risk" },
  "acu_pitchbook_exit":        { topics: ["exit_pitchbook", "exit_thesis"] },
  "acu_bvd_exit":              { topics: ["exit_bureau_van_dijk", "exit_thesis"] },
  "acu_refinitiv_exit":        { topics: ["exit_refinitiv", "exit_thesis"] },
  "acu_nesta_2009":            { topics: ["research_nesta_2009"] },
  "acu_sfc_capital_2024":      { topics: ["research_sfc_2024"] },
  "acu_capital_at_risk":       { topics: ["compliance_capital_at_risk"] },
  "acu_tax_circumstances":     { topics: ["compliance_tax_circumstances"] },
  "acu_bpr_enactment":         { topics: ["compliance_bpr_enactment"], policy_status: "subject_to_enactment" },
  "acu_pension_legislation":   { topics: ["compliance_pension_legislation"], policy_status: "subject_to_legislation" },
  "acu_advice_gap":            { topics: ["advice_gap"] },
  "acu_jan_2027_structure":    { topics: ["prohibited_jan_2027_pending"] },
  "acu_tony_vine_lott":        { topics: ["founding_investor_traction"] },
};

const newACUs = [
  {
    id: "acu_not_advice",
    type: "qualifier",
    topics: ["compliance_not_advice"],
    content: "This document does not constitute regulated financial advice.",
    status: "LOCKED",
    source: "FCA standard",
  },
  {
    id: "acu_past_performance",
    type: "qualifier",
    topics: ["compliance_past_performance"],
    content: "Past performance is not a guide to future performance.",
    status: "LOCKED",
    source: "FCA standard",
  },
  {
    id: "acu_jan_2027_head_start",
    type: "framing",
    topics: ["return_framing"],
    content: "Your January 2027 Self Assessment bill is due in nine months. An EIS investment made now reduces that bill directly — you are not waiting for an exit to see the benefit.",
    status: "LOCKED",
    source: "Unlock approved framing — does not require legal sign-off (factual description of SA timeline only)",
  },
  {
    id: "acu_fca_status",
    type: "qualifier",
    topics: ["compliance_fca_status"],
    content: "Unlock Services Limited. FCA registration number: [TO BE CONFIRMED BY LEGAL].",
    status: "DRAFT",
    source: "Pending legal confirmation of FCA registration number",
  },
];

export async function seedACURefactor() {
  let updated = 0;
  let created = 0;

  for (const [acuId, data] of Object.entries(topicMapping)) {
    const updateData: any = { topics: data.topics };
    if (data.requires_qualifier) updateData.requires_qualifier = data.requires_qualifier;
    if (data.policy_status) updateData.policy_status = data.policy_status;

    const [existing] = await db.select().from(acuTable).where(eq(acuTable.id, acuId));
    if (existing) {
      await db.update(acuTable).set(updateData).where(eq(acuTable.id, acuId));
      updated++;
    }
  }

  for (const acu of newACUs) {
    const [existing] = await db.select().from(acuTable).where(eq(acuTable.id, acu.id));
    if (!existing) {
      await db.insert(acuTable).values({
        id: acu.id,
        type: acu.type,
        content: acu.content,
        status: acu.status,
        source: acu.source,
        topics: acu.topics,
        version: 1,
        expression_variants: [],
        documents_referencing: [],
        cascade_on_change: true,
        approved_by: acu.status === "LOCKED" ? "tom_king" : undefined,
        approved_date: acu.status === "LOCKED" ? new Date().toISOString().split("T")[0] : undefined,
      });
      created++;
    }
  }

  return { updated, created };
}
