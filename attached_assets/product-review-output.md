# 070 — PRODUCT REVIEW OUTPUT
Date: April 2026

---

## INPUTS

**CURRENT STATE OUTPUT:** From Step 1 (050 Health Check), 055 (Functional Integrity), 056–062 (System Integrity Audit), 060 (Strategic Assessment).
**PRODUCT GOALS:** Automate investor transcript analysis, recommend compliance-approved documents, generate content with ACU enforcement and 19-check QC, track investor belief states, manage campaigns, detect content gaps — all for an internal operator.
**PRIMARY USER:** Internal investor relations / content operations manager. Non-technical, highly domain-knowledgeable. Daily user.
**KNOWN PAIN POINTS:** Intelligence data generated but not visible in UI. Single compliance gap (inv_opp_feb26). Call prep page is basic.

---

## PRODUCT REVIEW OUTPUT

### 1. User journeys identified

#### `Post-call document recommendation (core workflow)`
**The job:** After an investor call, identify what to send and log the send.
**Current path:** Call Prep → check off Q1–Q4 → click "Start Recommendation" → Recommend page (auto-populates Q checklist) → search and select lead → paste transcript → Analyse → view analysis (persona, stage, objections) → view ranked documents → review auto-generated email draft → Confirm Send → logged to lead's send_log.
**Implemented by:** `pages/call-prep.tsx` → `pages/recommend.tsx` (lines 136–218: handleAnalyze → rank → email → confirm pipeline). Routes: `POST /recommendation/analyze`, `POST /recommendation/rank`, `POST /recommendation/email-draft`, `POST /recommendation/confirm`.
**Where it breaks or creates friction:** The Call Prep → Recommend handoff works via URL params (`?Q1=1&Q2=1...`), but the transition is one-way. After recommendation, there is no link back to Call Prep for the next call. Also, when arriving at Recommend without Call Prep, the Q1–Q4 checklist is collapsed by default — the operator may forget to open it, reducing analysis confidence without realising it.
**Is this journey complete?** YES

---

#### `Batch transcript processing`
**The job:** Process multiple call transcripts at once (e.g. after a day of calls).
**Current path:** Recommend page → Batch Upload tab → drag/drop or select up to 20 .txt/.docx files → Submit → view results per file (persona, stage, objections) → link each result to existing lead or create new lead → review batch analysis.
**Implemented by:** `pages/recommend.tsx` (lines 220–346: handleBatchSubmit, handleCreateLeadFromBatch, handleLinkToLead). Routes: `POST /recommendation/parse-transcripts`, `POST /recommendation/analyze-batch`.
**Where it breaks or creates friction:** After batch analysis, results are displayed but there is no path to rank documents for each transcript. The single-transcript flow goes analyse → rank → email → confirm, but batch stops at analyse. The operator must manually switch to single mode and re-process each transcript to get document recommendations — defeating the purpose of batch processing.
**Is this journey complete?** PARTIAL — missing batch-to-rank step.

---

#### `Lead intelligence review`
**The job:** Understand an investor's profile, beliefs, and readiness before or after a call.
**Current path:** Leads page → click lead → Lead Detail page (Overview tab: next-best-action, interaction timeline, details, persona validation, notes) → Intelligence & Beliefs tab (belief state grid by cluster, gates, next belief target).
**Implemented by:** `pages/lead-detail.tsx` (lines 73–771). Routes: `GET /leads/:id`, `GET /leads/:id/beliefs`, `GET /leads/:id/beliefs/gates`, `GET /leads/:id/beliefs/next`, `GET /leads/:id/intelligence`.
**Where it breaks or creates friction:** The Intelligence & Beliefs tab shows belief states and gates but does NOT show: SPIN analysis (situation, problem, implication, need-payoff), qualification booleans (eis_familiar, ifa_involved, estate_above_2m, etc.), hot button labels (although HOT_BUTTON_LABELS constant is defined at line 51, it's only used if intelligence data contains them), belief evidence/source/confidence, or belief transition history. These are all generated and stored by the backend. The operator sees a coloured belief grid but lacks the context to understand WHY each belief is in its current state.
**Is this journey complete?** PARTIAL — missing SPIN, qualification, evidence, and transition displays.

---

#### `Content generation`
**The job:** Generate a new compliance-approved document using AI.
**Current path:** Content Generation page → choose Freeform or Template tab → Freeform: enter document name, type, context, and content instructions → Generate → view result with ACU compliance panel (locked/prohibited status) → optional Regenerate → Promote to Registry. Template: select template → fill name and context → Generate → same review/promote flow.
**Implemented by:** `pages/generate.tsx` (747 lines). Routes: `POST /generation/generate`, `POST /generation/from-template`, `POST /generation/:id/regenerate`, `POST /generation/:id/promote`.
**Where it breaks or creates friction:** None identified. The two-tab approach (Freeform vs Template) is appropriate. The ACU compliance panel showing locked/prohibited status before promotion is a strong compliance safeguard.
**Is this journey complete?** YES

---

#### `Content gap identification and resolution`
**The job:** Find gaps in the document library and generate content to fill them.
**Current path:** Content Gaps page → view matrix gaps (stage × archetype), type gaps, recommendation failure gaps → select a gap → Generate Brief → review/edit brief (with information readiness assessment) → Generate Document from Brief → document created.
**Implemented by:** `pages/gaps.tsx` (515 lines). Routes: `GET /content/gaps`, `POST /content/gaps/brief`, `POST /content/gaps/generate`.
**Where it breaks or creates friction:** The gap-to-brief-to-generation flow is smooth. Minor friction: after generating a document from a brief, there is no automatic link back to the gaps page to verify the gap has been closed. The operator must manually return and re-run gap analysis.
**Is this journey complete?** YES

---

#### `Document library health maintenance`
**The job:** Identify and resolve document quality issues across the 84-document library.
**Current path:** Document Health page → Run Health Check → view results (7 dimensions per document: identity, targeting, belief, compliance, propagation, content, delivery) → identify failing documents → navigate to Document Detail → edit or → go to Work Queue → Start Analysis → review auto-fix results → accept/skip/resolve findings one by one → view session summary.
**Implemented by:** `pages/document-health.tsx` (474 lines), `pages/work-queue.tsx` (688 lines), `pages/document-detail.tsx` (848 lines). Routes: `POST /documents/health-check`, `POST /work-queue/start`, card accept/skip/resolve endpoints.
**Where it breaks or creates friction:** Two friction points: (1) Document Health and Work Queue are separate sidebar entries with no cross-link. The operator must mentally map "these 15 failing documents from Health Check are the ones I need to process in Work Queue." (2) Work Queue sessions marked COMPLETE still contain unresolved PENDING findings — the operator sees "COMPLETE" and may think all issues are handled when 58 findings remain open.
**Is this journey complete?** PARTIAL — journey works but the Health Check → Work Queue handoff is disconnected.

---

#### `Campaign planning and asset generation`
**The job:** Plan a multi-channel campaign, generate assets, run QC, and activate.
**Current path:** Campaigns page → Create Campaign (name, description, target_persona, target_stage, objective, channels) → campaign created in DRAFT → Campaign Detail page → Generate Assets → QC Run → review QC results → Activate campaign.
**Implemented by:** `pages/campaigns.tsx` (564 lines), `pages/campaign-detail.tsx`. Routes: `POST /campaigns`, `POST /campaigns/:id/generate`, `POST /campaigns/:id/qc`, `POST /campaigns/:id/activate`.
**Where it breaks or creates friction:** None identified. The linear flow (create → generate → QC → activate) maps well to the actual workflow. The 19-check QC at the campaign level is a proper compliance gate.
**Is this journey complete?** YES

---

#### `Document editing with propagation awareness`
**The job:** Edit a document's content while understanding downstream impact.
**Current path:** Registry → click document → Document Detail page → Tier 1: locked by default, must click Unlock → confirmation dialog warns about propagation → edit content inline → Save → propagation cascade triggered.
**Implemented by:** `pages/document-detail.tsx` (lines 13–63: TierLockBanner, UnlockConfirmDialog, Tier2Warning). Routes: `PATCH /documents/:id`, `POST /documents/:id/propagate`.
**Where it breaks or creates friction:** The Tier 1 lock/unlock UX is well-designed. After saving, the operator is told propagation occurred but cannot see which downstream documents were affected without navigating to the changelog or document health pages. A post-edit summary showing "Flagged 12 downstream documents for review" would close the loop.
**Is this journey complete?** YES — but missing post-edit impact summary.

---

#### `Feature update impact assessment`
**The job:** When the product changes, assess impact across the document library.
**Current path:** Feature Updates page → enter feature description → Run Impact Assessment → view results per document (affected/not affected, why, suggested action).
**Implemented by:** `pages/feature-updates.tsx`. Route: `POST /content/feature-update`.
**Where it breaks or creates friction:** None identified. This is a well-scoped utility.
**Is this journey complete?** YES

---

#### `ACU management`
**The job:** Manage the lifecycle of Approved Content Units (compliance atoms).
**Current path:** Content Units page → view all ACUs with status (LOCKED, APPROVED, DRAFT, PROHIBITED) → create/edit ACU → manage expression variants → run contradiction detection.
**Implemented by:** `pages/acu.tsx`. Routes: `GET /acu`, `POST /acu`, `PATCH /acu/:id`, `POST /acu/scan`, `POST /acu/contradictions`.
**Where it breaks or creates friction:** None identified.
**Is this journey complete?** YES

---

### 2. Information architecture assessment

#### Home page / entry point (Dashboard — "Command Centre")
**What it currently does:** 4 metric cards (Total Leads, Total Documents, Docs Sent This Week, Action Required [docs needing review]). Pipeline breakdown section. Open tasks summary with count and top tasks. Recent activity feed (last 10 entries).
**First-time user needs:** Understanding what the tool does and where to start. The Dashboard provides orientation metrics but no guided entry point (e.g. "Start here: analyse your first transcript" or "You have 25 documents needing review — go to Work Queue").
**Returning user needs:** Quick triage — what's changed, what needs attention. The "Action Required" card and open tasks summary serve this well. Recent activity provides audit context.
**Verdict:** APPROPRIATE
**Specific problem:** None — the dashboard is lean and functional. The only minor gap is no "suggested next action" for the operator (the system knows belief states, open tasks, and stale documents — it could surface a single prioritised action).

#### Sidebar navigation
**What it currently does:** 4 groups: Operations (Dashboard, Recommendation Engine, Call Prep, Lead Management, Task Board, Work Queue), Content (Content Bank, Content Gaps, Content Generation, Document Registry, Document Health, Import Content, Feature Updates), Governance (Content Units, Campaigns, Persona Analytics), System (Changelog, Compliance Constants).
**Should it exist as standalone?** YES
**Verdict:** OVERLOADED
**Specific problem:** 22 sidebar entries is a lot for a single operator. The Content group has 7 entries, several of which are rarely used together (Import Content, Feature Updates). More critically, the grouping doesn't reflect workflow priority — the operator's daily workflow is Call Prep → Recommend → Lead Detail → (occasionally) Work Queue, but these are interleaved with Document Registry, Content Gaps, and other maintenance tools.

#### Lead Detail page
**What it currently does:** Header (name, company, pipeline stage, persona). Two tabs: Overview (next-best-action card, interaction timeline, details sidebar, persona validation, notes) and Intelligence & Beliefs (belief grid by cluster with state colours, gates, next belief target, generate profile button).
**Should it exist as standalone?** YES
**Verdict:** UNDERSPECIFIED
**Specific problem:** The Beliefs tab shows a coloured grid but omits SPIN analysis, qualification booleans, belief evidence, and belief transition history — all of which are computed and stored. The operator is missing the "why" behind each belief state.

#### Document Detail page
**What it currently does:** Header with tier badge and review state. Tier lock system (T1 locked by default). Content editor (markdown with preview). QC history. PDF export. Google Docs sync. Quality scoring.
**Should it exist as standalone?** YES
**Verdict:** APPROPRIATE

#### Content Gaps page
**What it currently does:** Coverage matrix (stage × archetype), type gaps, recommendation failure gaps, information readiness assessment, gap → brief → generate flow, snapshot history.
**Should it exist as standalone?** YES
**Verdict:** APPROPRIATE — this is one of the best-designed pages in the tool.

---

### 3. Feature grouping and phase opportunities

#### `Document maintenance tools are spread across 3 sidebar entries`
**Current state:** Document Registry (browse/search/filter documents), Document Health (run health check, view 7-dimension scores), and Work Queue (batch-analyse flagged documents, accept/skip findings) are separate sidebar entries.
**The problem:** These three tools serve one workflow: "keep the document library healthy." An operator running Document Health identifies problems, but must then navigate to Work Queue to resolve them, or to Document Registry to find specific documents. There is no cross-linking — the operator must hold the context in their head.
**Proposed grouping:** Keep all three as separate pages but add explicit navigation links: Document Health results should include a "Process in Work Queue" button for flagged documents. Work Queue findings should link directly to the affected document in Document Detail. Document Registry's "Requires Review" filter should link to relevant Work Queue sessions.
**Rationale:** The operator thinks in terms of "fix the library" — not "run health check, then go to work queue, then go to registry."
**Effort:** LOW

#### `Call Prep is isolated from Recommendation Engine`
**Current state:** Call Prep shows the 4 questions and links to Recommend with checked questions. Recommend accepts those parameters and uses them for analysis confidence.
**The problem:** Call Prep is a pre-call page; Recommend is a post-call page. But they're sibling sidebar entries with no visual distinction. The operator flow is linear (prep → call → recommend) but the navigation treats them as independent tools.
**Proposed grouping:** No structural change needed, but add a visual flow indicator on Call Prep showing "Step 1: Prepare → Step 2: Call → Step 3: Analyse" with the transition to Recommend being the natural conclusion.
**Rationale:** Reflects the operator's actual temporal workflow.
**Effort:** LOW

---

### 4. Progressive disclosure opportunities

#### `Recommendation Engine — single transcript mode`
**Currently shown:** Lead search, lead context card, Q1–Q4 checklist, transcript textarea, Analyse button, full analysis panel (persona, stage, objections, evidence, information gaps, readiness, matrix flags), ranked documents with belief enrichment, email draft, confirm send.
**Immediately needed:** Lead search, transcript textarea, Analyse button.
**Can be deferred:** Q1–Q4 checklist (auto-expand if questions were checked in Call Prep, otherwise collapsed), analysis detail panels (collapsed by default — the operator primarily needs the ranked documents and email draft, not the full evidence breakdown).
**Trigger for revealing:** Analyse button triggers analysis panel. Q1–Q4 auto-opens if URL params present.

#### `Lead Detail — Intelligence & Beliefs tab`
**Currently shown:** Full belief grid (all 23 beliefs across 6 clusters) with state dots, belief detail panel on click, gates panel, next belief target.
**Immediately needed:** Summary view — how many beliefs are ESTABLISHED vs UNKNOWN, which gates are open, what the next belief target is.
**Can be deferred:** Full cluster-by-cluster belief grid (expand individual clusters on click).
**Trigger for revealing:** Click on cluster header expands that cluster's beliefs.

#### `Document Detail — edit mode for Tier 1 documents`
**Currently shown:** TierLockBanner (always visible for T1 docs), unlock confirmation dialog (on click), then full edit mode.
**Immediately needed:** The current progressive disclosure is already well-implemented here — T1 content is locked by default and requires deliberate unlock with a confirmation dialog.
**Can be deferred:** N/A — already properly implemented.
**Trigger for revealing:** Already using confirmation dialog.

---

### 5. Back-to-front coherence gaps

**Backend capability not surfaced:**
- **SPIN analysis** (situation, problem, implication, need-payoff): Generated by `POST /leads/:leadId/intelligence/generate`, stored in intelligence record. Not displayed anywhere in the lead detail UI. Should appear in the Intelligence & Beliefs tab.
- **Qualification booleans** (eis_familiar, ifa_involved, estate_above_2m, previously_invested, estate_planning_done, charitable_intent, trust_in_place, pension_reviewed, business_owner): Generated by intelligence endpoint, used by recommendation filter pipeline. Not displayed on lead detail page. Should appear as a checklist in the Intelligence & Beliefs tab.
- **Belief evidence, source, and confidence**: Stored per lead-belief record. The belief grid shows state (UNKNOWN/ABSENT/PARTIAL/ESTABLISHED/BLOCKED) but not why. Should appear in belief detail panel on click.
- **Belief transitions history**: Stored in belief_transitions table. Records every state change with timestamp and trigger. Not displayed anywhere. Should appear as a mini-timeline in belief detail panel.
- **Matrix derivation notes** (`derivation_notes.eis_familiar`, etc.): Returned by transcript analysis. Shown briefly in recommend page matrix flags section but not persisted visibly on lead detail.
- **Document quality score breakdown**: `POST /documents/:id/quality-score` returns a multi-dimension score (identity, targeting, belief, compliance, propagation, content, delivery). Available from registry table row but the breakdown is not shown — only a single aggregate badge.
- **Gap analysis snapshot history with notes**: `GET /content/gaps/history` returns saved snapshots with operator notes. History panel exists in gaps page but is collapsed by default with no indication that history exists.

**Frontend promise not backed by capability:**
- **Global search bar** (header): The search input in the header (`"Search leads, documents, or content..."`) is not connected to any backend endpoint. It is a non-functional placeholder.
- **Notification bell** (header): The bell icon with red dot in the header is decorative — it is not connected to any notification system.
- **Settings gear icon** (header): Not connected to any settings page or modal.

---

### 6. Missing connective tissue

- **Document Health → Work Queue:** After running a health check, the operator sees documents with FAIL status but has no button to "Send to Work Queue" or "Process failing documents." They must manually navigate to Work Queue and start a new session, which analyses all flagged documents — not just the ones they identified in Health Check.

- **Work Queue finding → Document Detail:** Each finding card shows document name and issue description but does not link to the document detail page. The operator must navigate to Registry, search for the document, and open it separately.

- **Recommendation confirm → Lead Detail:** After confirming a send on the Recommendation page, the send is logged but there is no link to view the updated lead record. The operator must navigate to Leads, search for the lead, and open their detail page.

- **Content Gaps → Content Generation:** The gaps page has its own "Generate from Brief" flow, but if the operator wants to use the main Content Generation page instead (e.g. to use a template), there is no way to carry the gap context forward. The two generation paths are disconnected.

- **Batch analysis result → Single recommendation:** After batch-processing transcripts, each result shows persona/stage/objections but there is no "Run Recommendation" button per result that would transition to the single-transcript recommendation flow pre-populated with that analysis.

---

### 7. Friction inventory

| Location | Friction point | Severity | Likely fix |
|---|---|---|---|
| Header | Global search bar is non-functional | MEDIUM | Either wire to a multi-entity search endpoint or remove the placeholder to avoid confusion |
| Header | Notification bell is decorative with a red dot implying unread notifications | LOW | Remove the red dot, or connect to open tasks / documents requiring review |
| Header | Settings icon leads nowhere | LOW | Remove or connect to a settings page |
| Recommend (batch) | Batch analysis stops at persona/stage — no path to document ranking per transcript | HIGH | Add "Rank Documents" action per batch result, or auto-rank on analysis completion |
| Lead Detail | Intelligence & Beliefs tab missing SPIN, qualification, evidence, transitions | HIGH | Display stored intelligence data — zero backend work needed |
| Work Queue | Sessions marked COMPLETE with unresolved PENDING findings | MEDIUM | Distinguish "analysis complete" from "fully resolved" in session status |
| Document Health → Work Queue | No cross-link between failing documents and work queue processing | MEDIUM | Add "Process in Work Queue" button on health check results |
| Work Queue → Document Detail | Finding cards don't link to affected document | MEDIUM | Add document name as clickable link to document detail |
| Recommend → Lead Detail | No link to lead after confirming send | LOW | Add "View Lead" link in confirm success state |
| Document Detail (T1 edit) | After saving, no summary of propagation impact | LOW | Show "Flagged N downstream documents" in save confirmation |
| Sidebar | 22 entries across 4 groups — high cognitive load for daily workflow | LOW | Consider collapsible groups or favourites/pinned items |
| Call Prep | No lead context shown — operator checks questions without knowing which investor they're about to call | MEDIUM | Add lead selector to Call Prep so questions can be contextualised against known beliefs |
| Registry | Quality score per document requires manual POST click per row — no batch option | LOW | Add "Score All" or auto-score on health check |
| Gaps page | Snapshot history collapsed with no indicator that history exists | LOW | Add history count badge or "N snapshots saved" indicator |

---

### 8. Error UX

| Journey | Error state | Communication | Rating |
|---|---|---|---|
| Transcript analysis | Claude API failure | `analyzeMutation.error` displayed as text below Analyse button | CLEAR |
| Transcript analysis | Empty transcript submitted | Button disabled when transcript is empty — prevented | CLEAR |
| Batch upload | File too large (>500KB) | Error message with specific filenames | CLEAR |
| Batch upload | >20 files selected | Error message with count | CLEAR |
| Batch upload | Individual transcript parse failure | Per-file error status in results list | CLEAR |
| Content generation | Generation fails | Error displayed in generation result area | CLEAR |
| Content generation | Promote fails | `tmplPromoteError` state shown in UI | CLEAR |
| Lead creation | API failure | Generic "Failed to create lead" — no specific reason | VAGUE |
| Lead intelligence generation | No notes or transcript available | Specific error message: "Lead has no notes or transcript to analyse" | CLEAR |
| Document save | Update fails | Mutation error state — generic message | VAGUE |
| Work Queue start | Analysis fails mid-session | `error_message` field displayed on session card | CLEAR |
| Work Queue | Auto-fix fails | Applied/failed count shown in auto-fix result | CLEAR |
| Campaign creation | API failure | Error from mutation displayed | CLEAR |
| Health check | Check fails mid-run | Session error state shown | CLEAR |
| Document Health | No flagged documents to check | Empty state message | CLEAR |
| Google Docs export | Export fails | Error state in export mutation | VAGUE |
| Google Docs import | Import fails with no Drive connection | Error displayed but may not explain that Google Drive integration is needed | VAGUE |
| PDF export | Puppeteer/filesystem failure | Silent failure — operator sees loading spinner then nothing | NONE |

---

### 9. Prioritised recommendations

#### `Surface intelligence data on Lead Detail page`
**Type:** SURFACE EXISTING CAPABILITY
**What to change:** Add to the Intelligence & Beliefs tab: SPIN analysis panel (4 fields), qualification boolean checklist (9 fields), belief evidence/source/confidence in belief detail popup, belief transitions timeline. All data already exists in API responses.
**Who it helps:** Post-call recommendation journey, lead intelligence review journey.
**Effort:** MEDIUM
**Priority:** HIGH — This is the single most impactful change. The operator is making investment communication decisions without seeing the analysis the system has already performed.

#### `Fix non-functional header elements`
**Type:** SIMPLIFY
**What to change:** Either wire the global search to a multi-entity search endpoint (leads + documents + changelog) or remove it. Remove the notification bell red dot (or connect to open task count). Remove or connect the settings icon.
**Who it helps:** All journeys — reduces UI dishonesty.
**Effort:** LOW (remove) / MEDIUM (wire up search)
**Priority:** HIGH — Non-functional UI elements erode operator trust. A search bar that doesn't search is worse than no search bar.

#### `Add batch-to-rank path in recommendation engine`
**Type:** ADD CONNECTIVE TISSUE
**What to change:** After batch transcript analysis, add a "Rank Documents" button per result that transitions to the single-transcript recommendation flow pre-populated with that analysis, or auto-rank the top 3 documents per transcript.
**Who it helps:** Batch transcript processing journey.
**Effort:** MEDIUM
**Priority:** HIGH — Batch mode currently stops at analysis, forcing the operator to re-process each transcript individually.

#### `Connect Document Health → Work Queue`
**Type:** ADD CONNECTIVE TISSUE
**What to change:** Add "Process in Work Queue" button on Document Health results page. Work Queue finding cards should link to Document Detail. Document Health "FAIL" rows should show which Work Queue session (if any) has findings for that document.
**Who it helps:** Document library health maintenance journey.
**Effort:** LOW
**Priority:** MEDIUM

#### `Add lead context to Call Prep page`
**Type:** RESTRUCTURE
**What to change:** Add a lead selector to the Call Prep page. When a lead is selected, show their current belief state summary, last interaction date, and known persona. This lets the operator contextualise the 4 questions against what the system already knows about the investor.
**Who it helps:** Post-call document recommendation journey.
**Effort:** MEDIUM
**Priority:** MEDIUM — Would significantly improve call quality, which feeds back into better transcript analysis.

#### `Distinguish Work Queue session completion states`
**Type:** SIMPLIFY
**What to change:** Replace single COMPLETE status with ANALYSIS_COMPLETE (findings generated, operator review pending) and FULLY_RESOLVED (all findings accepted/skipped). Show pending finding count on ANALYSIS_COMPLETE sessions.
**Who it helps:** Document library health maintenance journey.
**Effort:** LOW
**Priority:** MEDIUM

#### `Add post-edit propagation impact summary`
**Type:** ADD CONNECTIVE TISSUE
**What to change:** After saving a Tier 1 or Tier 2 document edit, display a summary: "Propagation triggered: N downstream documents flagged for review. [View in Document Health]".
**Who it helps:** Document editing journey.
**Effort:** LOW
**Priority:** LOW

#### `Add Recommend → Lead link after confirm`
**Type:** ADD CONNECTIVE TISSUE
**What to change:** After confirming a send on the Recommendation page, show a "View [Lead Name]" link that navigates to the lead detail page.
**Who it helps:** Post-call recommendation journey.
**Effort:** LOW
**Priority:** LOW

---

### 10. Overall verdict

| Dimension | Status | Notes |
|---|---|---|
| User journey completeness | 🟡 | Core journeys (single recommend, generate, gap fill, campaign) are complete. Batch processing and lead intelligence review are partial. |
| Information architecture | 🟡 | Dashboard and most pages are appropriate. Sidebar is overloaded at 22 entries. Lead Detail is underspecified — missing intelligence displays. |
| Feature grouping logic | 🟡 | Document maintenance tools (Health, Work Queue, Registry) are logically related but navigationally disconnected. |
| Progressive disclosure | 🟢 | Tier 1 document locking is well-implemented. Recommend page could benefit from more collapsed defaults. |
| Back-to-front coherence | 🔴 | 7 backend capabilities not surfaced in UI (SPIN, qualifications, belief evidence, transitions, derivation notes, quality score breakdown, gap history). 3 non-functional header elements (search, bell, settings). |
| Connective tissue | 🟡 | 5 missing handoffs identified (Health→Queue, Queue→Doc, Recommend→Lead, Gaps→Generate, Batch→Rank). |
| Error UX | 🟡 | CLEAR for most journeys. VAGUE for lead creation, document save, Google Docs operations. NONE for PDF export failure. |

**Recommendation:** PROCEED AS-IS — with targeted fixes.

**One thing to fix first:** Surface the buried intelligence data (SPIN analysis, qualification booleans, belief evidence/confidence/source, belief transitions) on the Lead Detail page. This is the highest-impact change because it requires zero backend work — all data already exists in API responses — and it directly improves the operator's decision-making quality for every investor interaction. The operator is currently making compliance-critical document recommendations while seeing only a coloured belief grid, when the system has already computed the full analytical picture underneath.
