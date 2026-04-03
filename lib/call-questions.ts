export const CALL_FRAMEWORK_QUESTIONS = [
  {
    id: "Q1",
    question: "What are you hoping your money will do for you over the next five to ten years?",
    purpose: "Surfaces the investor's core motivation and time horizon — essential for persona detection and document matching.",
    signals: ["growth_orientation", "preservation_priority", "legacy_intent", "income_need"],
    listen_for: [
      "Mentions of specific financial goals (retirement, property, children's education)",
      "Time horizon language — 'long term', 'next few years', 'generational'",
      "Risk appetite indicators — 'aggressive growth', 'protect what I have', 'steady returns'",
      "Tax planning references — 'reduce my tax bill', 'CGT', 'inheritance tax'"
    ]
  },
  {
    id: "Q2",
    question: "Have you invested in early-stage companies or tax-efficient schemes before?",
    purpose: "Determines sophistication level, experience with EIS/SEIS, and whether educational or advanced content is appropriate.",
    signals: ["prior_eis_experience", "sophistication_level", "risk_awareness", "portfolio_context"],
    listen_for: [
      "Direct EIS/SEIS experience — 'I've done EIS before', 'had a bad experience with VCTs'",
      "Angel or startup investing history",
      "General investment experience level — ISAs only vs diversified portfolio",
      "Awareness of tax relief mechanics — do they understand loss relief, CGT deferral?"
    ]
  },
  {
    id: "Q3",
    question: "What would make you hesitate or say no to an investment like this?",
    purpose: "Surfaces objections early so they can be addressed with the right documents rather than discovered at decision stage.",
    signals: ["primary_objection", "deal_breaker", "trust_barrier", "liquidity_concern"],
    listen_for: [
      "Liquidity concerns — 'I might need the money', 'how long is it locked up?'",
      "Risk aversion signals — 'I can't afford to lose it', 'what's the downside?'",
      "Trust barriers — 'how do I know this is legitimate?', 'who regulates you?'",
      "Complexity objections — 'this seems complicated', 'I don't understand EIS'"
    ]
  },
  {
    id: "Q4",
    question: "Who else is involved in your investment decisions?",
    purpose: "Identifies whether content needs to convince additional stakeholders (spouse, IFA, accountant) and adjusts the document package accordingly.",
    signals: ["decision_maker_count", "ifa_involvement", "spouse_influence", "accountant_role"],
    listen_for: [
      "IFA or financial adviser involvement — 'I'll need to run it past my adviser'",
      "Spouse or partner influence — 'my wife and I decide together'",
      "Accountant in the loop — 'let me check with my accountant about the tax side'",
      "Solo decision maker — 'it's just me', 'I make my own decisions'"
    ]
  }
];

export type CallQuestion = typeof CALL_FRAMEWORK_QUESTIONS[number];

export type QuestionsAnswered = {
  Q1: boolean;
  Q2: boolean;
  Q3: boolean;
  Q4: boolean;
};
