import { Router, type IRouter } from "express";
import { GetContentBankQueryParams } from "@workspace/api-zod";
import contentBankText from "../../data/content/700_CONTENT_Bank_V4_CURRENT.md";
import personaGuideText from "../../data/content/520_GUIDE_Investor_Personas_19_V1_CURRENT.md";

const router: IRouter = Router();

function parseSections(text: string): { title: string; content: string }[] {
  const sections: { title: string; content: string }[] = [];
  const lines = text.split("\n");
  let currentTitle = "";
  let currentContent: string[] = [];

  for (const line of lines) {
    if (line.startsWith("# ") || line.startsWith("## ")) {
      if (currentTitle || currentContent.length > 0) {
        sections.push({
          title: currentTitle || "Introduction",
          content: currentContent.join("\n").trim(),
        });
      }
      currentTitle = line.replace(/^#+\s*/, "");
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }

  if (currentTitle || currentContent.length > 0) {
    sections.push({
      title: currentTitle || "Content",
      content: currentContent.join("\n").trim(),
    });
  }

  return sections;
}

function parsePersonas(text: string) {
  const personas: any[] = [];
  const blocks = text.split(/(?=##\s+\d+\.\s)/);

  for (const block of blocks) {
    const nameMatch = block.match(/##\s+\d+\.\s+(.+)/);
    if (!nameMatch) continue;

    const name = nameMatch[1].trim();

    const archetypeMatch = block.match(/Archetype:\s*(.+)/i) || block.match(/Public archetype:\s*(.+)/i);
    const tierMatch = block.match(/Tier:\s*(.+)/i) || block.match(/Priority:\s*(.+)/i);

    const signals: string[] = [];
    const painPoints: string[] = [];
    const objections: string[] = [];

    const signalSection = block.match(/(?:Signals?|Indicators?|How to identify)[:\s]*\n([\s\S]*?)(?=\n(?:Pain|Objection|How to|###|##\s))/i);
    if (signalSection) {
      const items = signalSection[1].match(/[-•]\s*(.+)/g);
      if (items) signals.push(...items.map((s) => s.replace(/^[-•]\s*/, "").trim()));
    }

    const painSection = block.match(/(?:Pain points?|Concerns?|Worries)[:\s]*\n([\s\S]*?)(?=\n(?:Objection|How to|###|##\s))/i);
    if (painSection) {
      const items = painSection[1].match(/[-•]\s*(.+)/g);
      if (items) painPoints.push(...items.map((s) => s.replace(/^[-•]\s*/, "").trim()));
    }

    const objectionSection = block.match(/(?:Objections?|Pushback|Resistance)[:\s]*\n([\s\S]*?)(?=\n(?:How to|###|##\s|$))/i);
    if (objectionSection) {
      const items = objectionSection[1].match(/[-•]\s*(.+)/g);
      if (items) objections.push(...items.map((s) => s.replace(/^[-•]\s*/, "").trim()));
    }

    personas.push({
      name,
      archetype: archetypeMatch?.[1]?.trim() || "Unknown",
      tier: tierMatch?.[1]?.trim() || "Unknown",
      signals: signals.slice(0, 5),
      pain_points: painPoints.slice(0, 5),
      objections: objections.slice(0, 5),
    });
  }

  if (personas.length === 0) {
    return [
      { name: "Growth Seeker", archetype: "Growth Seeker", tier: "Tier 1", signals: ["Asks about returns", "Mentions growth"], pain_points: ["Wants higher returns"], objections: ["Risk concerns"] },
      { name: "Preserver", archetype: "Preserver", tier: "Tier 1", signals: ["Mentions capital preservation", "Risk-averse language"], pain_points: ["Fears losing capital"], objections: ["Too risky"] },
      { name: "Legacy Builder", archetype: "Legacy Builder", tier: "Tier 1", signals: ["Mentions estate planning", "IHT concerns"], pain_points: ["Estate tax burden"], objections: ["Complexity of structures"] },
    ];
  }

  return personas;
}

router.get("/content-bank", async (req, res): Promise<void> => {
  const params = GetContentBankQueryParams.safeParse(req.query);
  const search = params.success ? params.data.search : undefined;

  const sections = parseSections(contentBankText);

  if (search) {
    const filtered = sections.filter(
      (s) =>
        s.title.toLowerCase().includes(search.toLowerCase()) ||
        s.content.toLowerCase().includes(search.toLowerCase())
    );
    res.json({ full_text: contentBankText, sections: filtered });
    return;
  }

  res.json({ full_text: contentBankText, sections });
});

router.get("/content-bank/personas", async (_req, res): Promise<void> => {
  const personas = parsePersonas(personaGuideText);
  res.json(personas);
});

export default router;
