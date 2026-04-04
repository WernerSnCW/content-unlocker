export interface MatrixContextFlags {
  eis_familiar: boolean
  iht_confirmed: boolean
  adviser_mentioned: boolean
}

export interface MatrixContextWithNotes {
  eis_familiar: boolean
  iht_confirmed: boolean
  adviser_mentioned: boolean
  derivation_notes: {
    eis_familiar: string
    iht_confirmed: string
    adviser_mentioned: string
  }
}

export function deriveMatrixFlags(analysis: {
  transcript_summary?: string
  information_gaps?: Array<{ gap?: string; impact?: string; suggested_document_type?: string }>
  blocking_objections?: string[]
  objections?: Array<{ objection?: string; severity?: string; suggested_response?: string }>
}): MatrixContextWithNotes {
  const summary = (analysis.transcript_summary ?? "").toLowerCase()
  const gaps = analysis.information_gaps ?? []
  const objections = analysis.objections ?? []
  const blockingObjections = analysis.blocking_objections ?? []

  const eisEducationPatterns = [
    /what is eis/i,
    /how eis works/i,
    /eis basics/i,
    /eis mechanics/i,
    /eis.*education/i,
    /understand.*eis/i,
    /learn.*eis/i,
    /eis.*explained/i,
    /enterprise investment scheme.*explained/i,
    /how.*tax relief works/i,
    /eis.*unfamiliar/i,
    /not.*familiar.*eis/i,
    /seis.*basics/i,
  ]
  const hasEisGap = gaps.some((g) => {
    const gapText = (g.gap ?? "") + " " + (g.impact ?? "")
    return eisEducationPatterns.some((rx) => rx.test(gapText))
  })
  const familiaritySignals = [
    "familiar with eis",
    "done eis before",
    "previous eis",
    "knows eis",
    "done this before",
    "used eis",
    "invested via eis",
    "eis experience",
    "eis-experience",
    "prior eis",
    "existing eis",
    "eis-familiar",
    "eis-informed",
  ]
  const hasFamiliaritySignal = familiaritySignals.some((s) => summary.includes(s))
  const eis_familiar = hasFamiliaritySignal

  let eisNote: string
  if (hasFamiliaritySignal) {
    eisNote = "Investor has prior EIS experience — skip education material"
  } else if (hasEisGap) {
    eisNote = "EIS information gap detected — investor needs education"
  } else {
    eisNote = "No clear EIS familiarity signal detected"
  }

  const ihtKeywords = [
    "inheritance tax",
    "iht",
    "estate planning",
    "passing on",
    "pass on wealth",
    "heirs",
    "beneficiaries",
    "death duties",
    "estate above",
    "iht exposure",
    "iht concern",
  ]
  const ihtNegationPatterns = [
    /no\s+(mention|reference|discussion|interest).*(?:inheritance|iht|estate)/i,
    /without.*(?:inheritance|iht|estate)/i,
    /not.*(?:concerned|worried|interested).*(?:inheritance|iht|estate)/i,
    /no.*estate\s*planning/i,
    /isn'?t.*(?:worried|concerned).*(?:inheritance|iht|estate)/i,
    /doesn'?t.*(?:care|worry).*(?:inheritance|iht|estate)/i,
  ]
  const hasIhtNegation = ihtNegationPatterns.some((rx) => rx.test(summary))
  const hasIhtPositive = ihtKeywords.some((k) => summary.includes(k))
  const iht_confirmed = hasIhtPositive && !hasIhtNegation

  let ihtNote: string
  if (iht_confirmed) {
    ihtNote = "IHT concern detected in transcript"
  } else {
    ihtNote = "No IHT references detected"
  }

  const adviserKeywords = [
    "accountant",
    "ifa",
    "financial adviser",
    "financial advisor",
    "adviser",
    "advisor",
    "speak to someone",
    "get advice",
    "consult",
    "my adviser",
    "my advisor",
  ]

  const adviserNegationPatterns = [
    /no\s+adviser/i,
    /no\s+advisor/i,
    /no\s+accountant/i,
    /without.*adviser/i,
    /without.*advisor/i,
    /no.*adviser\s+involve/i,
    /no.*advisor\s+involve/i,
    /self[- ]directed/i,
    /isn'?t.*adviser/i,
    /doesn'?t.*adviser/i,
  ]
  const adviserNegationInText = (text: string) =>
    adviserNegationPatterns.some((rx) => rx.test(text))
  const adviserInObjections = objections.some((o) => {
    const text = ((o.objection ?? "") + " " + (o.suggested_response ?? "")).toLowerCase()
    return !adviserNegationInText(text) && adviserKeywords.some((k) => text.includes(k))
  })
  const adviserInBlocking = blockingObjections.some((b) => {
    const text = b.toLowerCase()
    return !adviserNegationInText(text) && adviserKeywords.some((k) => text.includes(k))
  })
  const hasAdviserNegation = adviserNegationPatterns.some((rx) => rx.test(summary))
  const adviserInSummary = !hasAdviserNegation && adviserKeywords.some((k) => summary.includes(k))
  const adviser_mentioned = adviserInObjections || adviserInBlocking || adviserInSummary

  let adviserNote: string
  if (adviserInObjections || adviserInBlocking) {
    adviserNote = "Adviser/accountant referenced in objections"
  } else if (adviserInSummary) {
    adviserNote = "Adviser/accountant mentioned in transcript"
  } else {
    adviserNote = "No adviser reference detected"
  }

  return {
    eis_familiar,
    iht_confirmed,
    adviser_mentioned,
    derivation_notes: {
      eis_familiar: eisNote,
      iht_confirmed: ihtNote,
      adviser_mentioned: adviserNote,
    },
  }
}
