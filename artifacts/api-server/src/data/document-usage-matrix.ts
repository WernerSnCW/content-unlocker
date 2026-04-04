export interface DocumentRule {
  file_code: string
  title: string
  worth_it: 1 | 2 | 3
  investor_facing: boolean
  positive_trigger: string
  exclusions: string[]
  prerequisite_sent?: string[]
  never_send_simultaneously?: string[]
  persona_never_first?: string[]
  notes: string
}

export const DOCUMENT_RULES: DocumentRule[] = [
  {
    file_code: "100",
    title: "One-Pager",
    worth_it: 3,
    investor_facing: true,
    positive_trigger: "Every prospect who hasn't previously engaged. First email attachment, always.",
    exclusions: [
      "After a demo — it undersells at that stage",
      "Do not send alongside the Three-Pager (110) to the same prospect",
    ],
    never_send_simultaneously: ["110"],
    persona_never_first: [],
    notes: "Highest-leverage doc in the set. April 6 deadline + EIS table do the work. Low cost, high ROI.",
  },
  {
    file_code: "110",
    title: "Three-Pager",
    worth_it: 3,
    investor_facing: true,
    positive_trigger: "Higher-potential prospects or warm introductions. Forwardable version — existing contact shares with a peer.",
    exclusions: [
      "Same prospect who already received the One-Pager (100) without a reason to upgrade",
      "Do not send alongside the One-Pager (100) to the same prospect",
    ],
    never_send_simultaneously: ["100"],
    persona_never_first: [],
    notes: "Forwardable use case is disproportionately high value. Choose one or the other per cold prospect.",
  },
  {
    file_code: "120",
    title: "Pack 1 — Founding Investor Brief",
    worth_it: 3,
    investor_facing: true,
    positive_trigger: "Within 24hrs of a completed demo. Not before. Requires demo context to land.",
    exclusions: [
      "Before the demo — depth implies relationship that doesn't exist yet",
      "Never send with Pack 2 (130) simultaneously",
      "Do not send cold without a prior demo",
    ],
    prerequisite_sent: [],
    never_send_simultaneously: ["130"],
    persona_never_first: [],
    notes: "Converts demo interest into allocation intent. Both tax bracket EIS worked example is strongest single asset.",
  },
  {
    file_code: "130",
    title: "Pack 2 — Information Memorandum",
    worth_it: 3,
    investor_facing: true,
    positive_trigger: "Investor has explicitly signalled intent: asked for more detail or requested a terms conversation.",
    exclusions: [
      "Anyone who hasn't completed a demo",
      "Do not send to move a stalled prospect — will overwhelm",
      "Never send simultaneously with Pack 1 (120)",
      "Do not send proactively — only on explicit investor request",
    ],
    prerequisite_sent: ["120"],
    never_send_simultaneously: ["120"],
    persona_never_first: [],
    notes: "Risk factors with mitigations is the most credibility-building content in the set. Closing document.",
  },
  {
    file_code: "140",
    title: "Access Service Explainer",
    worth_it: 2,
    investor_facing: true,
    positive_trigger: "Specific question about deal flow, Access fees, or how companies are selected.",
    exclusions: [
      "As a first document — describes a service within the platform, not the investment opportunity",
      "Before the platform has been introduced",
    ],
    prerequisite_sent: ["100", "110"],
    persona_never_first: [],
    notes: "Resolves specific objection. Four-pillar structure and transparency disclosure are reusable assets.",
  },
  {
    file_code: "145",
    title: "Decumulation Planner Explainer",
    worth_it: 2,
    investor_facing: true,
    positive_trigger: "Prospect raises pension IHT, drawdown sequencing, or estate planning in demo or follow-up.",
    exclusions: [
      "As a first document — only makes sense after the platform has been introduced",
      "Too technical for cold outreach without prior platform introduction",
    ],
    prerequisite_sent: ["100", "110"],
    persona_never_first: ["Growth Seeker"],
    notes: "The only plain-English explanation of the Decumulation Planner. Uses v1.5 spec.",
  },
  {
    file_code: "150",
    title: "EIS: Investor's Secret Weapon",
    worth_it: 3,
    investor_facing: true,
    positive_trigger: "Prospect has expressed EIS curiosity but is not yet EIS-informed. Also works as cold education asset.",
    exclusions: [
      "Investor who already knows EIS well — condescending",
      "Do not send simultaneously with One-Pager (100)",
      "Do not send to Preserver as a first document — EIS pitch feels speculative to a capital-protection mindset",
    ],
    never_send_simultaneously: ["100"],
    persona_never_first: ["Preserver"],
    notes: "Best education-to-conversion asset in the set. Part 2 (IFA/VCT barriers) is the hook. High ROI.",
  },
  {
    file_code: "160",
    title: "Five EIS Case Studies",
    worth_it: 2,
    investor_facing: true,
    positive_trigger: "After discovery call when investor's specific situation is established. Reference the relevant case only.",
    exclusions: [
      "As a first document — assumes EIS familiarity",
      "Do not send all five without directing to the relevant case",
      "Do not send blind — always reference the specific page relevant to their situation",
    ],
    prerequisite_sent: ["150", "100"],
    persona_never_first: [],
    notes: "Value is proportional to personalisation. 'Page 8 is the one for your situation' outperforms blind send.",
  },
  {
    file_code: "170",
    title: "IHT/EIS Planning — £5M Estate",
    worth_it: 3,
    investor_facing: true,
    positive_trigger: "After discovery call confirming: (a) estate above £2M, (b) IHT concern, (c) awareness of April 2026 or 2027 changes.",
    exclusions: [
      "Growth Seekers — wrong motivation",
      "Preservers — wrong motivation",
      "Do not send without confirming IHT exposure first",
      "Do not send before IHT concern has been established in discovery",
    ],
    persona_never_first: ["Growth Seeker", "Preserver"],
    notes: "Nothing else addresses IHT planning at this depth. Death sequencing matrix (Sec 7) is unique content.",
  },
  {
    file_code: "180",
    title: "Duncan Stewart Bespoke Brief",
    worth_it: 3,
    investor_facing: true,
    positive_trigger: "Named high-value prospect where discovery has established specific estate/IHT situation. Send 24–48hrs before the call.",
    exclusions: [
      "Do not send to any other prospect in current form",
      "Do not use as a template without updating figures — every figure is Duncan's specific estate",
    ],
    persona_never_first: [],
    notes: "Document structure is the template for future bespoke briefs. His specific estate, assets, IHT bill.",
  },
  {
    file_code: "190",
    title: "UK Investment Landscape 2026",
    worth_it: 2,
    investor_facing: true,
    positive_trigger: "Cold outreach where shorter docs haven't worked. Also gated download for inbound lead gen.",
    exclusions: [
      "Prospects in pipeline at demo stage or later — top of funnel only",
      "Do not lead with the Unlock pitch — lead with the market analysis",
      "Do not send as the sole follow-up after a demo",
    ],
    persona_never_first: [],
    notes: "Iran conflict update makes it timely. Lead with the market analysis, not the investment opportunity.",
  },
  {
    file_code: "241",
    title: "Adviser/Accountant Briefing Note",
    worth_it: 2,
    investor_facing: true,
    positive_trigger: "Investor says 'I want my accountant to look at this' — at any stage from demo onwards.",
    exclusions: [
      "Do not send cold — only when investor has specifically mentioned their adviser",
      "Do not lead with it — it's a response document",
    ],
    persona_never_first: [],
    notes: "Covers EIS mechanics, Instant Investment, BPR rule change, April 2027 pension IHT.",
  },
  {
    file_code: "510b",
    title: "Demo Call Script",
    worth_it: 3,
    investor_facing: false,
    positive_trigger: "Use for every demo call. Internal use only.",
    exclusions: [
      "Never share with investors — internal script only",
    ],
    persona_never_first: [],
    notes: "9-section script with screen moments. Agent use only.",
  },
  {
    file_code: "230b",
    title: "Pack 2 Covering Email",
    worth_it: 3,
    investor_facing: false,
    positive_trigger: "When sending Pack 2 to a prospect who has confirmed serious interest.",
    exclusions: [
      "Do not send proactively to a stalled prospect",
      "Personalise the middle section before use — do not send as a form letter",
    ],
    prerequisite_sent: ["130"],
    persona_never_first: [],
    notes: "Most important send in the sequence had no template. Section 6 first framing is built in.",
  },
  {
    file_code: "242",
    title: "Welcome Email Template",
    worth_it: 3,
    investor_facing: false,
    positive_trigger: "Send same day the Instant Investment agreement is signed.",
    exclusions: [
      "Do not use as a form letter — personalise with one specific sentence",
      "Do not send before signing",
    ],
    persona_never_first: [],
    notes: "First communication post-investment. Confirms EIS3 timeline, platform access, five founding investor benefits.",
  },
  {
    file_code: "243",
    title: "Onboarding / Welcome Pack",
    worth_it: 3,
    investor_facing: true,
    positive_trigger: "Send alongside or shortly after the welcome email. All founding investors receive this.",
    exclusions: [
      "Do not send before the Instant Investment is signed",
    ],
    prerequisite_sent: ["242"],
    persona_never_first: [],
    notes: "Operationalises the founding investor benefits. EIS3 guide, onboarding session prep, Growth Capital round rights.",
  },
  {
    file_code: "515",
    title: "Asset Register Video Script (V2)",
    worth_it: 3,
    investor_facing: false,
    positive_trigger: "Send video link when prospect says they want to see the product before booking a call.",
    exclusions: [
      "Do not share the script itself with investors — it's internal",
      "Send the link, not an attachment",
    ],
    persona_never_first: [],
    notes: "Only complete product demo in the library. 'Clarity, without complexity' closing line.",
  },
]

export interface PipelineStageRule {
  stage: string
  primary_documents: string[]
  send_condition: string
  objective: string
  exclusions: string[]
  timing: string
}

export const PIPELINE_SEQUENCE: PipelineStageRule[] = [
  {
    stage: "Outreach",
    primary_documents: ["100", "110"],
    send_condition: "Always — this is the entry point for every prospect.",
    objective: "Establish problem fit. Get a reply or a call booking.",
    exclusions: [
      "Do not send both 100 and 110 to the same prospect",
      "Do not send 120 (Pack 1) cold",
      "Do not send 130 (Pack 2) cold",
    ],
    timing: "Immediately on first contact",
  },
  {
    stage: "Called",
    primary_documents: ["150", "190"],
    send_condition: "If prospect is EIS-naive (150) or high-value cold prospect who hasn't replied (190).",
    objective: "Build the belief that EIS is the right structure before the demo.",
    exclusions: [
      "Do not send 150 to a prospect who already knows EIS well",
      "Do not send 150 and 190 simultaneously",
      "Do not send Pack 1 (120) before a demo",
    ],
    timing: "1–2 days before discovery call",
  },
  {
    stage: "Demo Booked",
    primary_documents: [],
    send_condition: "No document sends at this stage — demo confirmation only.",
    objective: "Prepare the investor to attend the demo.",
    exclusions: [
      "Do not send Pack 1 (120) before the demo has taken place",
      "Do not send Pack 2 (130) before the demo has taken place",
    ],
    timing: "Demo confirmation email only",
  },
  {
    stage: "Demo Complete",
    primary_documents: ["120"],
    send_condition: "Always after a completed demo.",
    objective: "Convert demo interest into allocation intent.",
    exclusions: [
      "Do not send before the demo",
      "Do not send Pack 2 (130) simultaneously with Pack 1",
      "Do not re-send the One-Pager (100) — undersells at this stage",
    ],
    timing: "Within 24hrs of demo",
  },
  {
    stage: "Decision",
    primary_documents: ["130"],
    send_condition: "Only after investor explicitly signals serious interest.",
    objective: "Give the investor the full picture for their own due diligence.",
    exclusions: [
      "Do not send to anyone who hasn't had a demo",
      "Do not send proactively to a stalled prospect",
      "Do not send Pack 1 (120) simultaneously",
    ],
    timing: "Same day as request — allow 5–7 days before following up",
  },
]

export interface PersonaRoute {
  archetype: string
  core_sequence: string[]
  never_first: string[]
  supplementary_triggers: string
  key_insight: string
}

export const PERSONA_ROUTING: PersonaRoute[] = [
  {
    archetype: "Preserver",
    core_sequence: ["100", "120", "130"],
    never_first: ["170", "150"],
    supplementary_triggers: "160 (George or Richard cases) if pension or CGT objection raised",
    key_insight: "Lead with downside protection and correlation risk, not EIS upside. The stress-test framing in Pack 1 (120) is the hook.",
  },
  {
    archetype: "Growth Seeker",
    core_sequence: ["110", "120", "140", "130"],
    never_first: ["170", "190"],
    supplementary_triggers: "150 if EIS-naive; 160 (James or Sophie cases) for numbers",
    key_insight: "Deal flow and Unlock Access are the hook. 140 earns its place after 120 for this persona.",
  },
  {
    archetype: "Legacy Builder",
    core_sequence: ["110", "120", "170", "130"],
    never_first: ["100", "140"],
    supplementary_triggers: "160 (George and Richard cases) before Pack 2",
    key_insight: "April 6 and April 2027 deadlines are genuine urgency. 170 is essential, not supplementary.",
  },
]

export function shouldExclude(
  fileCode: string,
  context: {
    archetype: string
    stage: string
    alreadySent: string[]
    currentResults: string[]
    eisFamiliar: boolean
    ihtConfirmed: boolean
    adviserMentioned: boolean
  }
): { excluded: boolean; reason?: string } {
  const rule = DOCUMENT_RULES.find(r => r.file_code === fileCode)
  if (!rule) return { excluded: false }

  if (!rule.investor_facing) {
    return { excluded: true, reason: "Internal document — not investor-facing" }
  }

  if (rule.never_send_simultaneously) {
    for (const conflictCode of rule.never_send_simultaneously) {
      if (context.currentResults.includes(conflictCode)) {
        return {
          excluded: true,
          reason: `Cannot send with ${conflictCode} in the same recommendation`,
        }
      }
    }
  }

  if (
    rule.persona_never_first &&
    rule.persona_never_first.includes(context.archetype) &&
    context.alreadySent.length === 0
  ) {
    return {
      excluded: true,
      reason: `Never send first to ${context.archetype}`,
    }
  }

  if (rule.prerequisite_sent && rule.prerequisite_sent.length > 0) {
    const missingPrereq = rule.prerequisite_sent.find(
      prereq => !context.alreadySent.includes(prereq)
    )
    if (missingPrereq) {
      return {
        excluded: true,
        reason: `Prerequisite not met — ${missingPrereq} must be sent first`,
      }
    }
  }

  if (fileCode === "130" && !context.alreadySent.includes("120")) {
    return { excluded: true, reason: "Pack 2 requires Pack 1 to have been sent first" }
  }

  if (fileCode === "150" && context.eisFamiliar) {
    return { excluded: true, reason: "Investor already knows EIS — 150 would be condescending" }
  }

  if (fileCode === "170" && !context.ihtConfirmed) {
    return { excluded: true, reason: "IHT concern not confirmed — 170 requires estate >£2M and IHT motivation" }
  }

  if (fileCode === "170" && context.archetype !== "Legacy Builder") {
    return { excluded: true, reason: "170 is Legacy Builder only — wrong persona motivation" }
  }

  if (fileCode === "241" && !context.adviserMentioned) {
    return { excluded: true, reason: "Adviser note only triggered when investor mentions their accountant/IFA" }
  }

  if (fileCode === "120" && context.stage === "Outreach") {
    return { excluded: true, reason: "Pack 1 must not be sent cold — requires demo context" }
  }

  if (fileCode === "120" && context.stage === "Called") {
    return { excluded: true, reason: "Pack 1 must not be sent before the demo" }
  }

  if (fileCode === "120" && context.stage === "Demo Booked") {
    return { excluded: true, reason: "Pack 1 must not be sent before the demo has taken place" }
  }

  if (fileCode === "130" && context.stage !== "Decision") {
    return { excluded: true, reason: "Pack 2 only appropriate at Decision stage after explicit investor signal" }
  }

  if (["100", "110", "190"].includes(fileCode) &&
      ["Demo Complete", "Decision"].includes(context.stage)) {
    return { excluded: true, reason: "Top-of-funnel document — undersells at demo/decision stage" }
  }

  return { excluded: false }
}

export function getWorthItWeight(fileCode: string): number {
  const rule = DOCUMENT_RULES.find(r => r.file_code === fileCode)
  return rule?.worth_it ?? 2
}

export function getPersonaRoute(archetype: string): PersonaRoute | undefined {
  return PERSONA_ROUTING.find(r => r.archetype === archetype)
}

export function getStageRule(stage: string): PipelineStageRule | undefined {
  return PIPELINE_SEQUENCE.find(r => r.stage === stage)
}
