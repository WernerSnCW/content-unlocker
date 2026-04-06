export function fuzzyMatchLeads(query: string, leads: any[]): Array<{ lead_id: string; name: string; company: string; pipeline_stage: string; detected_persona: string; confidence: number }> {
  const qLower = query.toLowerCase().trim();
  const qWords = qLower.split(/\s+/);
  const results: Array<{ lead_id: string; name: string; company: string; pipeline_stage: string; detected_persona: string; confidence: number }> = [];

  for (const lead of leads) {
    const nameLower = lead.name.toLowerCase();
    const nameWords = nameLower.split(/\s+/);
    let confidence = 0;

    if (nameLower === qLower) {
      confidence = 1.0;
    } else if (qWords.every((w: string) => nameWords.includes(w))) {
      confidence = 0.85;
    } else if (qWords.length > 0 && nameWords.length > 0 && nameWords[nameWords.length - 1] === qWords[qWords.length - 1]) {
      confidence = 0.4;
    } else if (qWords.length > 0 && nameWords.length > 0 && nameWords[0] === qWords[0]) {
      confidence = 0.5;
    }

    if (confidence >= 0.4) {
      results.push({
        lead_id: lead.id,
        name: lead.name,
        company: lead.company || "",
        pipeline_stage: lead.pipeline_stage,
        detected_persona: lead.detected_persona || "",
        confidence,
      });
    }
  }

  return results.sort((a, b) => b.confidence - a.confidence).slice(0, 3);
}
