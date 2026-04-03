import { Router, type IRouter } from "express";
import { db, leadsTable } from "@workspace/db";
import { isNotNull, sql, eq } from "drizzle-orm";
import { PERSONA_TO_ARCHETYPE, VALID_ARCHETYPES } from "../../../../../lib/personas";

const router: IRouter = Router();

router.get("/analytics/personas", async (_req, res): Promise<void> => {
  const allLeads = await db.select().from(leadsTable);

  const totalLeads = allLeads.length;
  const withDetected = allLeads.filter((l) => l.detected_persona);
  const withConfirmed = allLeads.filter((l) => l.confirmed_persona);

  let correctCount = 0;
  let incorrectCount = 0;
  const corrections: Array<{
    lead_id: string;
    lead_name: string;
    detected: string;
    confirmed: string;
    confirmed_archetype: string;
  }> = [];

  for (const lead of withConfirmed) {
    if (lead.detected_persona === lead.confirmed_persona) {
      correctCount++;
    } else {
      incorrectCount++;
      corrections.push({
        lead_id: lead.id,
        lead_name: lead.name,
        detected: lead.detected_persona || "N/A",
        confirmed: lead.confirmed_persona!,
        confirmed_archetype: lead.confirmed_archetype || "N/A",
      });
    }
  }

  const accuracy = withConfirmed.length > 0
    ? Math.round((correctCount / withConfirmed.length) * 100)
    : null;

  const personaDistribution: Record<string, { detected: number; confirmed: number }> = {};
  for (const lead of allLeads) {
    if (lead.detected_persona) {
      if (!personaDistribution[lead.detected_persona]) {
        personaDistribution[lead.detected_persona] = { detected: 0, confirmed: 0 };
      }
      personaDistribution[lead.detected_persona].detected++;
    }
    if (lead.confirmed_persona) {
      if (!personaDistribution[lead.confirmed_persona]) {
        personaDistribution[lead.confirmed_persona] = { detected: 0, confirmed: 0 };
      }
      personaDistribution[lead.confirmed_persona].confirmed++;
    }
  }

  const archetypeDistribution: Record<string, { detected: number; confirmed: number }> = {};
  for (const archetype of VALID_ARCHETYPES) {
    archetypeDistribution[archetype] = { detected: 0, confirmed: 0 };
  }
  for (const lead of allLeads) {
    if (lead.detected_persona) {
      const arch = PERSONA_TO_ARCHETYPE[lead.detected_persona];
      if (arch) archetypeDistribution[arch].detected++;
    }
    if (lead.confirmed_archetype) {
      if (archetypeDistribution[lead.confirmed_archetype]) {
        archetypeDistribution[lead.confirmed_archetype].confirmed++;
      }
    }
  }

  const confidenceDistribution = {
    high: withDetected.filter((l) => (l.persona_confidence ?? 0) >= 0.8).length,
    medium: withDetected.filter((l) => {
      const c = l.persona_confidence ?? 0;
      return c >= 0.5 && c < 0.8;
    }).length,
    low: withDetected.filter((l) => (l.persona_confidence ?? 0) < 0.5).length,
  };

  const unconfirmedLeads = allLeads
    .filter((l) => l.detected_persona && !l.confirmed_persona)
    .map((l) => ({
      lead_id: l.id,
      name: l.name,
      detected_persona: l.detected_persona,
      persona_confidence: l.persona_confidence,
      pipeline_stage: l.pipeline_stage,
    }));

  res.json({
    summary: {
      total_leads: totalLeads,
      with_detected_persona: withDetected.length,
      with_confirmed_persona: withConfirmed.length,
      accuracy_percentage: accuracy,
      correct_predictions: correctCount,
      incorrect_predictions: incorrectCount,
      awaiting_confirmation: withDetected.length - withConfirmed.length,
    },
    persona_distribution: personaDistribution,
    archetype_distribution: archetypeDistribution,
    confidence_distribution: confidenceDistribution,
    corrections,
    unconfirmed_leads: unconfirmedLeads,
  });
});

export default router;
