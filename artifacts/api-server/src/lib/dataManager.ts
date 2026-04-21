import { db, leadsTable, documentsTable, changelogTable, acuTable, channelsTable, complianceConstantsTable, beliefRegistryTable } from "@workspace/db";
import { eq, ilike, and, desc } from "drizzle-orm";
import { randomUUID } from "crypto";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import registryData from "../data/registry.json" with { type: "json" };
import leadsData from "../data/leads.json" with { type: "json" };
import complianceData from "../data/compliance_constants.json" with { type: "json" };
import acuSeedData from "../data/acu-seed.json" with { type: "json" };
import channelSeedData from "../data/channels.json" with { type: "json" };
import { seedACURefactor } from "../data/seed-acu-refactor";
import { seedTemplates } from "../data/seed-templates";
import { seedPrompts } from "../data/seed-prompts";
import { seedOutcomeRules } from "../data/seed-outcome-rules";
import { logger } from "./logger";

export async function seedDatabase() {
  const existingLeads = await db.select({ id: leadsTable.id }).from(leadsTable).limit(1);
  if (existingLeads.length > 0) {
    logger.info("Database already seeded, running incremental seeds only");
    try {
      const acuResult = await seedACURefactor();
      logger.info({ ...acuResult }, "ACU refactor seed complete");
      const tmplResult = await seedTemplates();
      logger.info({ ...tmplResult }, "Template seed complete");
      const promptResult = await seedPrompts();
      logger.info({ ...promptResult }, "Prompt seed complete");
      const ccResult = await seedComplianceConstants();
      logger.info({ ...ccResult }, "Compliance constants seed complete");
      const brResult = await seedBeliefRegistry();
      logger.info({ ...brResult }, "Belief registry seed complete");
      const orResult = await seedOutcomeRules();
      logger.info({ ...orResult }, "Outcome rules seed complete");
    } catch (err) {
      logger.error({ err }, "Incremental seed error (non-fatal)");
    }
    return;
  }

  logger.info("Seeding database...");

  const candidateDirs = [
    join(import.meta.dirname, "..", "src", "data", "content"),
    join(import.meta.dirname, "..", "data", "content"),
  ];
  let contentDir = "";
  let contentFiles: string[] = [];
  for (const dir of candidateDirs) {
    try {
      contentFiles = readdirSync(dir);
      contentDir = dir;
      logger.info(`Found content directory at ${dir} with ${contentFiles.length} files`);
      break;
    } catch {
      continue;
    }
  }
  if (!contentDir) {
    logger.warn("Content directory not found, all documents will have null content");
  }

  for (const doc of (registryData as any).documents) {
    let content: string | null = null;
    const matchingFile = contentFiles.find((f) => f.startsWith(`${doc.id}_`));
    if (matchingFile) {
      try {
        content = readFileSync(join(contentDir, matchingFile), "utf-8");
        logger.info(`Loaded content for ${doc.id} (${doc.name}) from ${matchingFile}`);
      } catch (err) {
        logger.warn(`Failed to read content file ${matchingFile} for ${doc.id}: ${err}`);
      }
    } else {
      logger.info(`No content file found for ${doc.id} (${doc.name}), setting content to null`);
    }

    await db.insert(documentsTable).values({
      id: doc.id,
      file_code: doc.file_code,
      type: doc.type,
      name: doc.name,
      filename: doc.filename,
      tier: doc.tier,
      category: doc.category,
      lifecycle_status: doc.lifecycle_status,
      review_state: doc.review_state,
      version: doc.version,
      last_reviewed: doc.last_reviewed,
      description: doc.description,
      pipeline_stage_relevance: doc.pipeline_stage_relevance || [],
      persona_relevance: doc.persona_relevance || [],
      upstream_dependencies: doc.upstream_dependencies || [],
      downstream_dependents: doc.downstream_dependents || [],
      is_generated: doc.is_generated || false,
      generation_brief_id: doc.generation_brief_id || null,
      generation_attempt: doc.generation_attempt || null,
      qc_report_id: doc.qc_report_id || null,
      source_trace: doc.source_trace || [],
      content,
      qc_history: [],
    }).onConflictDoNothing();
  }

  for (const lead of (leadsData as any).leads) {
    await db.insert(leadsTable).values({
      id: lead.id,
      name: lead.name,
      company: lead.company || null,
      pipeline_stage: lead.pipeline_stage,
      first_contact: lead.first_contact,
      last_contact: lead.last_contact,
      detected_persona: lead.detected_persona || null,
      archived: lead.archived || false,
      send_log: lead.send_log || [],
      stage_history: lead.stage_history || [],
      notes_legacy: lead.notes || [],
    }).onConflictDoNothing();
  }

  for (const acu of (acuSeedData as any[])) {
    await db.insert(acuTable).values({
      id: acu.id,
      type: acu.type,
      content: acu.content,
      status: acu.status || "DRAFT",
      source: acu.source || null,
      approved_by: acu.approved_by || null,
      approved_date: acu.approved_date || null,
      version: acu.version || 1,
      expression_variants: acu.expression_variants || [],
      documents_referencing: acu.documents_referencing || [],
      cascade_on_change: acu.cascade_on_change !== undefined ? acu.cascade_on_change : true,
      notes: acu.notes || null,
    }).onConflictDoNothing();
  }
  logger.info(`Seeded ${(acuSeedData as any[]).length} ACUs`);

  for (const ch of (channelSeedData as any[])) {
    await db.insert(channelsTable).values({
      id: ch.id,
      name: ch.name,
      format: ch.format,
      max_words: ch.max_words || null,
      max_links: ch.max_links || null,
      max_ctas: ch.max_ctas || null,
      max_lines: ch.max_lines || null,
      max_sentences: ch.max_sentences || null,
      max_duration_seconds: ch.max_duration_seconds || null,
      headline_max_chars: ch.headline_max_chars || null,
      body_max_chars: ch.body_max_chars || null,
      subject_max_words: ch.subject_max_words || null,
      subject_max_chars: ch.subject_max_chars || null,
      prohibited: ch.prohibited || [],
      formats: ch.formats || [],
      cta_options: ch.cta_options || [],
      requires_meta_approval: ch.requires_meta_approval || false,
      requires_cta_button: ch.requires_cta_button || false,
      video_thumbnail: ch.video_thumbnail || false,
      from_address: ch.from_address || null,
      goal: ch.goal || null,
      max_objection_responses: ch.max_objection_responses || null,
      notes: ch.notes || null,
    }).onConflictDoNothing();
  }
  logger.info(`Seeded ${(channelSeedData as any[]).length} channels`);

  await db.insert(changelogTable).values({
    id: randomUUID(),
    action: "SYSTEM_INITIALIZED",
    details: "Platform initialized with seed data",
    triggered_by: "system",
  });

  try {
    const acuResult = await seedACURefactor();
    logger.info({ ...acuResult }, "ACU refactor seed complete");
    const tmplResult = await seedTemplates();
    logger.info({ ...tmplResult }, "Template seed complete");
    const promptResult = await seedPrompts();
    logger.info({ ...promptResult }, "Prompt seed complete");
    const ccResult = await seedComplianceConstants();
    logger.info({ ...ccResult }, "Compliance constants seed complete");
    const brResult = await seedBeliefRegistry();
    logger.info({ ...brResult }, "Belief registry seed complete");
  } catch (err) {
    logger.error({ err }, "Post-seed incremental seed error (non-fatal)");
  }

  logger.info("Database seeded successfully");
}

export function getComplianceConstants() {
  return {
    version: (complianceData as any).version,
    constants: (complianceData as any).constants,
  };
}

const COMPLIANCE_SEED_MAP: Record<string, { value_type: string; is_prohibited: boolean; subject_to_qualifier: boolean; category: string }> = {
  eis_income_tax_relief: { value_type: "percentage", is_prohibited: false, subject_to_qualifier: true, category: "tax_relief" },
  seis_income_tax_relief: { value_type: "percentage", is_prohibited: false, subject_to_qualifier: true, category: "tax_relief" },
  vct_relief_rate: { value_type: "percentage", is_prohibited: false, subject_to_qualifier: true, category: "tax_relief" },
  eis_cgt_deferral: { value_type: "percentage", is_prohibited: false, subject_to_qualifier: true, category: "tax_relief" },
  bpr_cap: { value_type: "currency", is_prohibited: false, subject_to_qualifier: false, category: "limits" },
  pension_iht_change: { value_type: "text", is_prohibited: false, subject_to_qualifier: false, category: "tax_relief" },
  eis_loss_relief_per_pound: { value_type: "text", is_prohibited: false, subject_to_qualifier: true, category: "tax_relief" },
  seis_loss_relief_per_pound: { value_type: "text", is_prohibited: false, subject_to_qualifier: true, category: "tax_relief" },
  seis_loss_relief_prohibited: { value_type: "text", is_prohibited: true, subject_to_qualifier: false, category: "prohibited" },
  founding_investor_minimum: { value_type: "currency", is_prohibited: false, subject_to_qualifier: false, category: "limits" },
  founding_investor_maximum: { value_type: "currency", is_prohibited: false, subject_to_qualifier: false, category: "limits" },
  pre_money_valuation: { value_type: "currency", is_prohibited: false, subject_to_qualifier: false, category: "limits" },
  instrument: { value_type: "text", is_prohibited: false, subject_to_qualifier: false, category: "instrument" },
  platform_pricing_prohibition: { value_type: "text", is_prohibited: true, subject_to_qualifier: false, category: "prohibited" },
  decumulation_planner_status: { value_type: "text", is_prohibited: false, subject_to_qualifier: false, category: "messaging" },
  product_tagline: { value_type: "text", is_prohibited: false, subject_to_qualifier: false, category: "messaging" },
  target_portfolio_range: { value_type: "text", is_prohibited: false, subject_to_qualifier: false, category: "limits" },
  annual_eis_limit: { value_type: "text", is_prohibited: false, subject_to_qualifier: true, category: "tax_relief" },
  annual_seis_limit: { value_type: "currency", is_prohibited: false, subject_to_qualifier: true, category: "tax_relief" },
  bpr_effective_date: { value_type: "text", is_prohibited: false, subject_to_qualifier: true, category: "tax_relief" },
  access_framework_framing: { value_type: "text", is_prohibited: false, subject_to_qualifier: false, category: "messaging" },
  loss_relief_rate: { value_type: "text", is_prohibited: false, subject_to_qualifier: true, category: "tax_relief" },
};

export async function seedComplianceConstants(): Promise<{ created: number; skipped: number; total: number }> {
  let created = 0;
  let skipped = 0;
  const constants = (complianceData as any).constants as Array<{ key: string; label: string; value: string; note?: string; applies_to?: string[] }>;

  for (const c of constants) {
    const mapping = COMPLIANCE_SEED_MAP[c.key];
    if (!mapping) {
      logger.warn(`No mapping found for compliance constant key '${c.key}' — skipping`);
      skipped++;
      continue;
    }

    const [existing] = await db
      .select()
      .from(complianceConstantsTable)
      .where(eq(complianceConstantsTable.key, c.key))
      .limit(1);

    if (existing) {
      skipped++;
      continue;
    }

    await db.insert(complianceConstantsTable).values({
      id: randomUUID(),
      key: c.key,
      label: c.label,
      value: c.value,
      value_type: mapping.value_type,
      status: "ACTIVE",
      is_prohibited: mapping.is_prohibited,
      prohibited_reason: mapping.is_prohibited ? (c.note || null) : null,
      subject_to_qualifier: mapping.subject_to_qualifier,
      qualifier_text: mapping.subject_to_qualifier ? "subject to individual tax circumstances" : null,
      category: mapping.category,
      notes: c.note || null,
      source: "manual_ui",
      activated_at: new Date(),
    });
    created++;
  }

  return { created, skipped, total: constants.length };
}

async function seedBeliefRegistry(): Promise<{ created: number; skipped: boolean }> {
  const existing = await db.select({ id: beliefRegistryTable.id }).from(beliefRegistryTable).limit(1);
  if (existing.length > 0) {
    return { created: 0, skipped: true };
  }

  const BELIEF_SEED = [
    { id: 'U1', cluster: 'universal', name: 'The Practical Advice Gap', belief_type: 'correctable', is_hard_gate: false, policy_status: 'active', gates: ['G3', 'any_unlock_product_claim'], primary_document_id: '140', description: 'Most IFAs practically cannot advise on individual EIS companies. The advice effectively stops at the fund level.', conversation_question: 'When your IFA discusses EIS, do they talk about specific companies or just funds?', content_if_unresolved: 'Send Doc 140 — explains why IFA advice stops at fund level and what that means for direct EIS.', red_flag_signals: ['My IFA handles everything including individual EIS deals', 'I already have a direct EIS advisory relationship'], green_flag_signals: ['My IFA only mentions EIS funds', 'I have to find individual deals myself', 'Nobody helps me evaluate specific EIS companies'] },
    { id: 'U2', cluster: 'universal', name: 'Hidden Correlation Risk', belief_type: 'developmental', is_hard_gate: false, policy_status: 'active', gates: ['P3', 'iran_effect_content'], primary_document_id: '190', conversation_question: 'How do you think about the correlation between your existing portfolio holdings?', content_if_unresolved: 'Send Doc 190 — Iran effect case study showing hidden correlation across apparently diversified portfolios.', red_flag_signals: ['My portfolio is already well diversified', 'Correlation risk does not concern me'], green_flag_signals: ['I had not thought about that', 'My holdings probably do move together', 'The 2022 drawdown hit everything at once'] },
    { id: 'U3', cluster: 'universal', name: 'Structural Independence as the Moat', belief_type: 'developmental', is_hard_gate: false, policy_status: 'active', gates: ['F0', 'any_platform_claim'], primary_document_id: '120', conversation_question: 'What matters most to you when evaluating who provides investment research or tools — independence or brand?', content_if_unresolved: 'Send Doc 120 — Unlock platform overview showing no commission, no AUM fee, no conflicted revenue.', red_flag_signals: ['I prefer established brands regardless of conflicts', 'Independence does not matter if the product is good'], green_flag_signals: ['I worry about conflicts of interest', 'Fee-free sounds too good — how do you make money?', 'Independence is important to me'] },
    { id: 'U4', cluster: 'universal', name: 'EIS Risk Is Manageable', belief_type: 'correctable', is_hard_gate: true, policy_status: 'active', gates: ['risk_appetite_question', 'any_risk_framing'], primary_document_id: '150', description: 'Maximum effective loss after all reliefs is ~38.5p per pound (EIS) or ~27.5p (SEIS).', conversation_question: 'When you think about EIS risk, what is the worst-case scenario in your mind?', content_if_unresolved: 'Send Doc 150 — EIS relief mechanics showing max effective loss is 38.5p per pound after all tax reliefs.', red_flag_signals: ['I could lose everything', 'EIS is too risky for me at any level', 'I do not want any illiquid exposure'], green_flag_signals: ['I did not realise the tax relief reduced the downside that much', 'So the real risk is only 38p in the pound?', 'That changes how I think about the allocation'] },
    { id: 'G1', cluster: 'growth_seeker', cluster_display_name: 'Growth Seeker', cluster_tagline: 'Live Well', name: 'Asymmetric Upside in Early-Stage Tech', belief_type: 'developmental', is_hard_gate: false, policy_status: 'active', primary_document_id: '160', conversation_question: 'What is your experience with early-stage tech investments — do you see the upside potential?', content_if_unresolved: 'Send Doc 160 — early-stage tech return profiles showing asymmetric upside with EIS tax relief floor.', red_flag_signals: ['Early-stage is pure gambling', 'I only invest in public markets', 'Tech companies are overvalued'], green_flag_signals: ['I like the risk/reward profile', 'Tax relief as a floor is interesting', 'I have done angel investing before'] },
    { id: 'G2', cluster: 'growth_seeker', cluster_display_name: 'Growth Seeker', cluster_tagline: 'Live Well', name: 'Direct EIS vs Fund Fee Drag', belief_type: 'correctable', is_hard_gate: false, policy_status: 'active', primary_document_id: '140', conversation_question: 'Have you looked at the total fee load on your current EIS fund investments?', content_if_unresolved: 'Send Doc 140 — comparison of direct EIS vs fund fee structures showing long-term fee drag impact.', red_flag_signals: ['Fund fees are worth it for the diversification', 'I prefer someone else managing the portfolio'], green_flag_signals: ['I had not added up all the layers of fees', 'The fee drag over 3-5 years is significant', 'I would rather pick direct if I had the tools'] },
    { id: 'G3', cluster: 'growth_seeker', cluster_display_name: 'Growth Seeker', cluster_tagline: 'Live Well', name: 'Infrastructure Required for Direct EIS', belief_type: 'developmental', is_hard_gate: false, policy_status: 'active', prerequisite_beliefs: ['U1'], primary_document_id: '140', conversation_question: 'If you wanted to invest in individual EIS companies directly, what tools or support would you need?', content_if_unresolved: 'Send Doc 140 — explains the infrastructure gap for direct EIS and how Unlock fills it.', red_flag_signals: ['I can do my own due diligence', 'I do not need tools, I just need deal flow'], green_flag_signals: ['I would not know where to start evaluating individual companies', 'Due diligence on private companies is hard', 'I need something to help me assess these'] },
    { id: 'P1', cluster: 'preserver', cluster_display_name: 'Preserver', cluster_tagline: 'Stay Safe', name: 'The January 2027 Head Start', belief_type: 'correctable', is_hard_gate: false, policy_status: 'blocked_pending_legal', description: 'BLOCKED — legal sign-off required on ASA two-year structure.', conversation_question: 'Are you aware of the timing advantage of acting before January 2027?', content_if_unresolved: 'BLOCKED — awaiting legal sign-off. Do not send content on this belief.', red_flag_signals: ['I am in no rush', 'Timing does not affect my decision'], green_flag_signals: ['I want to be ahead of the crowd', 'Getting in early matters to me'] },
    { id: 'P2', cluster: 'preserver', cluster_display_name: 'Preserver', cluster_tagline: 'Stay Safe', name: 'Reassessing Risk (38.5p not gross)', belief_type: 'correctable', is_hard_gate: false, policy_status: 'active', primary_document_id: '150', conversation_question: 'When you hear EIS is risky, are you thinking about gross loss or loss after tax reliefs?', content_if_unresolved: 'Send Doc 150 — walks through the relief stack showing net risk per pound is 38.5p not 100p.', red_flag_signals: ['Even 38p loss is too much', 'I do not trust HMRC to honour the reliefs'], green_flag_signals: ['I assumed I could lose the whole amount', 'I did not factor in loss relief on top of income tax relief', 'That reframes the risk significantly'] },
    { id: 'P3', cluster: 'preserver', cluster_display_name: 'Preserver', cluster_tagline: 'Stay Safe', name: 'Unlock More Valuable in a Correction', belief_type: 'developmental', is_hard_gate: false, policy_status: 'active', prerequisite_beliefs: ['U2'], primary_document_id: '190', conversation_question: 'If markets corrected 20-30%, how would that change your view on having uncorrelated holdings?', content_if_unresolved: 'Send Doc 190 — shows how EIS-qualifying companies behave differently in corrections vs correlated public markets.', red_flag_signals: ['I would just buy the dip in public markets', 'Private companies would be hit harder in a correction'], green_flag_signals: ['That is exactly when diversification matters', 'My portfolio has no real hedge', 'I saw how correlated everything was in 2022'] },
    { id: 'L1', cluster: 'legacy_builder', cluster_display_name: 'Legacy Builder', cluster_tagline: 'Leave Wealth', name: 'April 2027 Broke the Estate Plan', belief_type: 'correctable', is_hard_gate: false, policy_status: 'active', primary_document_id: '170', conversation_question: 'Have you reviewed how the April 2027 pension changes affect your estate plan?', content_if_unresolved: 'Send Doc 170 — analysis of pension IHT changes and impact on estate planning strategies.', red_flag_signals: ['My estate plan is already sorted', 'Pensions are not part of my estate plan', 'My adviser is handling this'], green_flag_signals: ['I had not realised pensions would be in the estate for IHT', 'That changes everything for my planning', 'We need to rethink the estate structure'] },
    { id: 'L2', cluster: 'legacy_builder', cluster_display_name: 'Legacy Builder', cluster_tagline: 'Leave Wealth', name: 'Rolling EIS as BPR Replacement', belief_type: 'developmental', is_hard_gate: false, policy_status: 'active', prerequisite_beliefs: ['L1'], primary_document_id: '170', conversation_question: 'With BPR under pressure, have you considered rolling EIS as an alternative estate planning tool?', content_if_unresolved: 'Send Doc 170 — explains how rolling EIS investments can replace BPR for IHT-efficient wealth transfer.', red_flag_signals: ['BPR still works fine for my situation', 'I do not want illiquid assets in my estate', 'EIS and estate planning do not mix'], green_flag_signals: ['I need a BPR alternative', 'The two-year qualifying period works for my timeline', 'Rolling EIS for IHT relief is clever'] },
    { id: 'L3', cluster: 'legacy_builder', cluster_display_name: 'Legacy Builder', cluster_tagline: 'Leave Wealth', name: 'The Two-Year Window', belief_type: 'correctable', is_hard_gate: false, policy_status: 'blocked_pending_legal', description: 'BLOCKED — legal sign-off required.', conversation_question: 'Do you understand the two-year holding requirement for EIS IHT relief?', content_if_unresolved: 'BLOCKED — awaiting legal sign-off. Do not send content on this belief.', red_flag_signals: ['Two years is too long to lock up capital'], green_flag_signals: ['Two years is shorter than I expected', 'That fits my estate planning horizon'] },
    { id: 'C1', cluster: 'company_conviction', name: 'The Market Is Large Enough', belief_type: 'developmental', is_hard_gate: false, policy_status: 'active', primary_document_id: '130', conversation_question: 'Do you see a large enough market for independent EIS due diligence tools?', content_if_unresolved: 'Send Doc 130 — market sizing and competitive landscape for EIS intelligence platforms.', red_flag_signals: ['The market is too niche', 'EIS is a tiny corner of the market', 'There will never be enough demand'], green_flag_signals: ['There are thousands of HNWIs who need this', 'The IFA gap creates real demand', 'With the regulatory changes the market is growing'] },
    { id: 'C2', cluster: 'company_conviction', name: 'The Team Can Build This', belief_type: 'correctable', is_hard_gate: false, policy_status: 'active', primary_document_id: '120', description: 'Tom King 15 years EIS/investment strategy. Werner — electronic banking + integrations. Tony Vine-Lott — strategic advisor, former Chairman Barclays Stockbroking.', conversation_question: 'What gives you confidence — or concern — about the team behind a company you invest in?', content_if_unresolved: 'Send Doc 120 — team backgrounds showing domain expertise: Tom King (15yr EIS), Werner (banking tech), Tony Vine-Lott (Barclays).', red_flag_signals: ['The team is too small', 'I need to see a bigger management team', 'No track record in this space'], green_flag_signals: ['The domain expertise is strong', 'I like that the team has industry background', 'Tom knows the EIS space well'] },
    { id: 'C3', cluster: 'company_conviction', name: 'The Product Is Real, Not a Pitch', belief_type: 'correctable', is_hard_gate: false, policy_status: 'active', primary_document_id: '120', description: 'Five founding investors actively using. Platform evolved from DD tool through real usage.', conversation_question: 'How important is it to you that the product is already being used by real investors?', content_if_unresolved: 'Send Doc 120 — shows five founding investors actively using the platform, evolved from real DD needs.', red_flag_signals: ['Five users is not proof of anything', 'I need to see thousands of users first', 'Sounds like vapourware'], green_flag_signals: ['I like that it grew from real usage', 'Founding investors using it daily is a good sign', 'Show me the platform'] },
    { id: 'C4', cluster: 'company_conviction', name: 'The Timing Is Right', belief_type: 'developmental', is_hard_gate: false, policy_status: 'active', primary_document_id: '196', description: 'April 6 2026 VCT relief reduced. April 2027 pension IHT. Regulatory environment creating demand.', conversation_question: 'With VCT relief reducing in April 2026 and pension IHT changes in 2027, how do you see the timing for EIS?', content_if_unresolved: 'Send Doc 196 — regulatory timeline showing converging tailwinds for EIS demand.', red_flag_signals: ['Regulatory changes could go either way', 'I do not make decisions based on policy changes', 'This feels like artificial urgency'], green_flag_signals: ['The regulatory tailwinds are real', 'VCT changes push people toward EIS', 'The pension IHT change is going to drive demand'] },
    { id: 'C5', cluster: 'company_conviction', name: 'The Business Model Holds', belief_type: 'developmental', is_hard_gate: false, policy_status: 'active', primary_document_id: '120', description: 'Subscription only. No commission, no AUM fee, no trail. Independence built into revenue model.', conversation_question: 'What do you think about a subscription-only model with no commissions or AUM fees?', content_if_unresolved: 'Send Doc 120 — business model breakdown: subscription only, no commission, no AUM, no trail.', red_flag_signals: ['Subscription models do not scale', 'How do you make enough revenue without AUM?', 'I do not trust free-from-conflict claims'], green_flag_signals: ['No commission means no conflicts', 'Subscription aligns incentives with users', 'That is how it should be'] },
    { id: 'C6', cluster: 'company_conviction', name: 'The Exit Path Is Credible', belief_type: 'developmental', is_hard_gate: false, policy_status: 'active', primary_document_id: '130', description: 'PitchBook/Morningstar, Bureau van Dijk/Moody\'s, Refinitiv/LSEG. Confirmed acquirer category.', conversation_question: 'When you invest in an early-stage company, how important is a clear exit path?', content_if_unresolved: 'Send Doc 130 — identified acquirer categories: PitchBook/Morningstar, Bureau van Dijk, Refinitiv/LSEG.', red_flag_signals: ['There is no realistic acquirer for this', 'Data companies are not being acquired', 'The exit is too speculative'], green_flag_signals: ['Those are credible acquirers', 'Data and analytics companies do get acquired', 'I can see the strategic fit'] },
    { id: 'F0', cluster: 'founding_round', name: 'Unlock Will Become Structurally Essential', belief_type: 'developmental', is_hard_gate: true, policy_status: 'active', prerequisite_beliefs: ['C2', 'C3'], gates: ['F1', 'F2', 'F3', 'pack_1', 'pack_2', 'investment_ask'], primary_document_id: '120', description: 'Must be established before any founding round content.', conversation_question: 'Do you believe that independent EIS intelligence will become a must-have rather than a nice-to-have?', content_if_unresolved: 'Send Doc 120 — structural thesis: why independent EIS DD will become essential infrastructure.', red_flag_signals: ['IFAs will figure this out themselves', 'There is no structural need for this', 'Existing platforms will add EIS features'], green_flag_signals: ['The advice gap is structural, not temporary', 'Nobody else is building this', 'Regulation is making this essential'] },
    { id: 'F1', cluster: 'founding_round', name: 'Founding Round Terms Are Attractive', belief_type: 'developmental', is_hard_gate: false, policy_status: 'active', prerequisite_beliefs: ['F0', 'C1', 'C4', 'C5'], primary_document_id: '120', conversation_question: 'How do the founding round terms compare to other early-stage deals you have seen?', content_if_unresolved: 'Send Doc 120 — founding round term sheet and valuation rationale.', red_flag_signals: ['The valuation is too high', 'I have seen better terms elsewhere', 'I would want more equity for this stage'], green_flag_signals: ['The terms are fair for this stage', 'EIS relief makes the entry price very attractive', 'I like the founder-friendly structure'] },
    { id: 'F2', cluster: 'founding_round', name: 'HMRC Co-Invests via EIS', belief_type: 'correctable', is_hard_gate: false, policy_status: 'active', prerequisite_beliefs: ['F0'], primary_document_id: '150', conversation_question: 'Do you see the EIS income tax relief as effectively HMRC co-investing alongside you?', content_if_unresolved: 'Send Doc 150 — reframes EIS relief as government co-investment, reducing effective entry cost.', red_flag_signals: ['That is just a tax break, not co-investment', 'I do not rely on tax incentives to make investment decisions'], green_flag_signals: ['I had not thought of it that way', 'HMRC taking 30% of the risk changes the equation', 'Effectively paying 70p per pound is compelling'] },
    { id: 'F3', cluster: 'founding_round', name: 'The Exit Path Is Clear', belief_type: 'developmental', is_hard_gate: false, policy_status: 'active', prerequisite_beliefs: ['F0', 'C6'], primary_document_id: '130', conversation_question: 'Based on the acquirer landscape, does the exit path for Unlock feel clear to you?', content_if_unresolved: 'Send Doc 130 — maps Unlock capabilities to confirmed acquirer needs in data/analytics space.', red_flag_signals: ['I am not convinced anyone would buy this', 'The exit timeline is too uncertain', 'Too many things need to go right'], green_flag_signals: ['The acquirer categories make sense', 'Data companies in this space are being acquired', 'I can see a 3-5 year exit path'] },
  ];

  await db.insert(beliefRegistryTable).values(BELIEF_SEED);
  return { created: BELIEF_SEED.length, skipped: false };
}

export function validateSeedData(): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const docs = (registryData as any).documents;
  const validStatuses = ["CURRENT", "DRAFT", "SUPERSEDED"];
  const validReviewStates = ["CLEAN", "REQUIRES_REVIEW", "REVIEWED"];
  const validStages = ["Outreach", "Called", "Demo Booked", "Demo Complete", "Decision"];
  const validPersonas = [
    "Growth Seeker", "Preserver", "Legacy Builder",
    "Tax Optimizer", "Portfolio Consolidator", "Yield Seeker",
    "Impact Investor", "Tech-Savvy Self-Director", "Risk-Averse Retiree",
    "Wealth Preserver", "Estate Planner", "Active Trader",
    "Delegator", "Information Gatherer", "Skeptic",
    "Social Proof Seeker", "Deadline-Driven", "Family Wealth Manager", "Institutional Thinker"
  ];

  const docIds = new Set<string>();
  for (const doc of docs) {
    if (docIds.has(doc.id)) {
      errors.push(`Duplicate document ID: ${doc.id}`);
    }
    docIds.add(doc.id);

    if (!validStatuses.includes(doc.lifecycle_status)) {
      errors.push(`Invalid lifecycle_status '${doc.lifecycle_status}' for document ${doc.id}`);
    }
    if (!validReviewStates.includes(doc.review_state)) {
      errors.push(`Invalid review_state '${doc.review_state}' for document ${doc.id}`);
    }
    if (![1, 2, 3].includes(doc.tier)) {
      errors.push(`Invalid tier '${doc.tier}' for document ${doc.id}`);
    }

    for (const dep of (doc.upstream_dependencies || [])) {
      if (!docIds.has(dep) && !docs.find((d: any) => d.id === dep)) {
        errors.push(`Broken upstream dependency: document ${doc.id} references non-existent ${dep}`);
      }
    }

    if (doc.upstream_dependencies?.includes(doc.id)) {
      errors.push(`Self-reference in dependencies for document ${doc.id}`);
    }

    for (const stage of (doc.pipeline_stage_relevance || [])) {
      if (!validStages.includes(stage)) {
        errors.push(`Invalid pipeline_stage_relevance '${stage}' in document ${doc.id}`);
      }
    }
    for (const persona of (doc.persona_relevance || [])) {
      if (!validPersonas.includes(persona)) {
        warnings.push(`Unrecognized persona '${persona}' in document ${doc.id}`);
      }
    }
  }

  const constants = (complianceData as any).constants;
  const requiredKeys = ["bpr_cap", "bpr_effective_date", "vct_relief_rate", "pension_iht_change", "decumulation_planner_status", "access_framework_framing", "product_tagline"];
  for (const key of requiredKeys) {
    if (!constants.find((c: any) => c.key === key)) {
      errors.push(`Missing compliance constant: ${key}`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

export async function getNextBestAction(lead: any): Promise<{ action: string; rationale: string; suggested_documents: string[] }> {
  const stage = lead.pipeline_stage;
  const sentDocIds = ((lead.send_log || []) as any[]).flatMap((s: any) => s.documents_sent || []);

  const allDocs = await db.select().from(documentsTable).orderBy(documentsTable.id);
  const eligible = allDocs.filter(
    (d) => d.lifecycle_status === "CURRENT" && d.review_state === "CLEAN"
  );

  function findUnsent(filter: (d: typeof eligible[0]) => boolean): string[] {
    return eligible
      .filter((d) => filter(d) && !sentDocIds.includes(d.id))
      .map((d) => d.id);
  }

  switch (stage) {
    case "Outreach": {
      const promos = findUnsent((d) =>
        d.category === "investor_docs" && d.type === "PROMO" &&
        (d.pipeline_stage_relevance as string[])?.includes("Outreach")
      );
      if (promos.length > 0) {
        return {
          action: "Call and send one-pager",
          rationale: "First contact — send a promotional overview to introduce Unlock",
          suggested_documents: [promos[0]],
        };
      }
      return {
        action: "Follow up on one-pager",
        rationale: "One-pager sent — follow up to book a call",
        suggested_documents: [],
      };
    }

    case "Called": {
      const promos = findUnsent((d) =>
        d.category === "investor_docs" && d.type === "PROMO" &&
        (d.pipeline_stage_relevance as string[])?.includes("Called")
      );
      if (promos.length > 0) {
        return {
          action: "Book demo and send three-pager",
          rationale: "Post-call follow-up — send detailed promotional material",
          suggested_documents: [promos[0]],
        };
      }
      return {
        action: "Book demo",
        rationale: "Key documents sent — focus on booking the demo",
        suggested_documents: [],
      };
    }

    case "Demo Booked":
      return {
        action: "Confirm attendance and prepare persona-matched talking points",
        rationale: "Demo booked — ensure attendance and prepare personalised content",
        suggested_documents: [],
      };

    case "Demo Complete": {
      const briefs = findUnsent((d) =>
        d.category === "investor_docs" && d.type === "BRIEF" &&
        (d.pipeline_stage_relevance as string[])?.includes("Demo Complete")
      );
      if (briefs.length > 0) {
        return {
          action: "Send Pack 1 with persona cover email",
          rationale: "Demo complete — send the founding investor brief",
          suggested_documents: [briefs[0]],
        };
      }

      if (lead.detected_persona === "Legacy Builder") {
        const planning = findUnsent((d) =>
          d.category === "investor_docs" && d.type === "PLANNING" &&
          (d.pipeline_stage_relevance as string[])?.includes("Demo Complete")
        );
        if (planning.length > 0) {
          return {
            action: "Send IHT planning document",
            rationale: "Legacy Builder persona — IHT planning document directly addresses their concerns",
            suggested_documents: [planning[0]],
          };
        }
      }

      const cases = findUnsent((d) =>
        d.category === "investor_docs" && d.type === "CASE" &&
        (d.pipeline_stage_relevance as string[])?.includes("Demo Complete")
      );
      if (cases.length > 0) {
        return {
          action: "Send EIS case studies",
          rationale: "Follow up with concrete worked examples to support the investment case",
          suggested_documents: [cases[0]],
        };
      }
      return {
        action: "Move to Decision stage",
        rationale: "All key Demo Complete documents sent — advance the conversation",
        suggested_documents: [],
      };
    }

    case "Decision": {
      const memos = findUnsent((d) =>
        d.category === "investor_docs" && d.type === "IIM" &&
        (d.pipeline_stage_relevance as string[])?.includes("Decision")
      );
      if (memos.length > 0) {
        return {
          action: "Send Pack 2 and initiate Instant Investment via SeedLegals",
          rationale: "Decision stage — send the full Information Memorandum",
          suggested_documents: [memos[0]],
        };
      }
      return {
        action: "Close — execute Instant Investment via SeedLegals",
        rationale: "All documents sent — proceed to investment execution",
        suggested_documents: [],
      };
    }

    default:
      return {
        action: "Review lead status",
        rationale: "Unknown pipeline stage — review and update manually",
        suggested_documents: [],
      };
  }
}
