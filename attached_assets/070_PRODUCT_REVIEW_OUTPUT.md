## PRODUCT REVIEW OUTPUT

**Date:** 2026-04-05
**Reviewer:** Agent (systematic review against 070 template)
**Inputs used:**
- CURRENT STATE OUTPUT: `attached_assets/100_CURRENT_STATE_OUTPUT.md` (v1.1 corrected)
- PRODUCT GOALS: Internal content intelligence platform for Unlock (UK fintech). Enables the marketing/content team to manage investor-facing collateral with compliance-locked content units (ACUs), persona-aware document recommendations, AI-powered content generation with QC, campaign orchestration, and coverage gap analysis — all governed by immutable compliance facts.
- PRIMARY USER: Tom King, Head of Content / Marketing at Unlock. Semi-technical — comfortable with dashboards and forms but not writing code. Works daily with documents, investor personas, and compliance-sensitive content.
- KNOWN PAIN POINTS: 13-item sidebar is long; search bar and notification bell are non-functional; mixed data access patterns (generated hooks vs manual fetch); no authentication; hardcoded user identity ("John Doe").

---

### 1. User journeys identified

#### `Investor Call → Document Recommendation → Send`
**The job:** After a call with a prospective investor, analyse the transcript to detect persona/stage, get ranked document recommendations, generate an email draft, and confirm the send.
**Current path:** Call Prep (/call-prep) → tick questions covered → "Start Recommendation" → Recommendation Engine (/recommend) → search & select lead → paste transcript → Analyse → view persona/stage/objections → view ranked documents → view email draft → Confirm Send.
**Implemented by:** `pages/call-prep.tsx`, `pages/recommend.tsx`, routes `POST /recommendation/analyze`, `POST /recommendation/rank`, `POST /recommendation/email-draft`, `POST /recommendation/confirm-send`.
**Where it breaks or creates friction:** (1) Call Prep passes question flags via URL query params but the Recommendation Engine requires the user to re-search and re-select the lead — there is no lead pre-selection from Call Prep. (2) No way to return to the recommendation results after navigating away — results are ephemeral in component state. (3) In batch mode, transcript files must be uploaded one by one into the file list before processing; no folder upload.
**Is this journey complete?** YES — end-to-end path exists for both single and batch modes.

#### `Batch Transcript Processing → Lead Creation`
**The job:** Upload multiple call transcript files, analyse all of them, auto-match to existing leads, and create new leads for unmatched investors.
**Current path:** Recommendation Engine (/recommend) → switch to Batch tab → drag/drop .txt files → Process All → view results per file (persona, stage, readiness) → link to existing lead or "Create Lead" → view linked lead.
**Implemented by:** `pages/recommend.tsx` (batch mode), routes `POST /recommendation/parse-transcripts`, `POST /recommendation/analyze-batch`.
**Where it breaks or creates friction:** (1) After creating a lead from batch results, the user cannot immediately run a single-mode recommendation for that lead without manually switching tabs and re-searching. (2) Batch results disappear on page navigation.
**Is this journey complete?** YES.

#### `Create / Edit Document → QC → Promote`
**The job:** Generate a new compliance-checked document from a brief, review QC results, regenerate if needed, and promote to CURRENT status.
**Current path:** Content Generation (/generate) → fill document name, type, requirements, personas → Generate → view QC report (pass/fail/warnings) → Regenerate if failed → Promote to Registry.
**Implemented by:** `pages/generate.tsx`, routes `POST /generation/generate`, `POST /generation/regenerate/:id`, `PATCH /generation/promote/:id`.
**Where it breaks or creates friction:** (1) The generation form has no template picker — it uses free-text document type rather than the 22 registered templates. The template-based generation endpoint (`POST /generation/from-template`) exists but has no frontend UI. (2) After promotion, no link navigates the user to the newly promoted document in the registry.
**Is this journey complete?** PARTIAL — missing template-aware generation UI; missing post-promotion navigation.

#### `Template-Based Generation`
**The job:** Select a template from the Template Registry, fill in parameters, and generate a compliance-checked document that inherits the template's required/prohibited ACUs.
**Current path:** Not surfaced. Backend endpoint `POST /generation/from-template` exists and works (tested). No frontend form or page links to it.
**Implemented by:** `routes/generation/index.ts` → `generateFromTemplate()` in `lib/generationEngine.ts`. Templates viewable in ACU page → Templates tab.
**Where it breaks or creates friction:** Users must use the free-text generation page, which bypasses all template section definitions, required ACUs, and prohibited ACU enforcement.
**Is this journey complete?** NOT IMPLEMENTED on frontend.

#### `Review Document Content → Edit → Save`
**The job:** Open a document from the registry, review its content, edit fields, and save changes.
**Current path:** Document Registry (/registry) → click document row → Document Detail (/registry/:id) → view rendered markdown content, compliance panel, metadata → Edit mode (pencil icon) → modify fields → Save → changelog entry created.
**Implemented by:** `pages/registry.tsx`, `pages/document-detail.tsx`, route `PATCH /documents/:id`.
**Where it breaks or creates friction:** (1) Tier 1 documents require explicit unlock confirmation before editing (good friction — intentional). (2) Google Docs export/import buttons exist but depend on the Google Drive integration being configured with valid credentials. (3) No inline markdown editor — the content textarea is plain text.
**Is this journey complete?** YES.

#### `Import PDF Document`
**The job:** Upload a PDF to ingest its text content into the document registry.
**Current path:** Document Registry (/registry) → "Import PDF" button → modal with file picker, name, category, persona, stage fields → Upload → document created with review_state=REQUIRES_REVIEW.
**Implemented by:** `pages/registry.tsx` (import modal), route `POST /documents/import-pdf`.
**Where it breaks or creates friction:** (1) After import, user must manually navigate to the new document — no auto-redirect. (2) The modal closes but the list may not auto-refresh if the React Query cache is stale.
**Is this journey complete?** YES.

#### `Manage ACUs → Lock → Cascade`
**The job:** Create or edit content units, advance through DRAFT→APPROVED→LOCKED lifecycle, and cascade changes to referencing documents.
**Current path:** Content Units (/acu) → ACU Registry tab → view table with status/type filters → expand row for details → Approve → Lock → Cascade (flags referencing documents for review).
**Implemented by:** `pages/acu.tsx` (Registry tab), routes `PATCH /acu/:id/approve`, `PATCH /acu/:id/lock`, `PATCH /acu/:id/cascade`.
**Where it breaks or creates friction:** (1) Creating a new ACU uses a minimal form at the top of the page — no validation on content length or type-specific fields. (2) No visual indication of which documents will be affected before clicking Cascade.
**Is this journey complete?** YES.

#### `ACU Intelligence: Scan → Review Backlog → Resolve Contradictions`
**The job:** Trigger a content scan across all documents, review extracted candidate ACUs in a priority-ordered backlog, approve/reject/defer candidates, and resolve detected contradictions.
**Current path:** Content Units (/acu) → Intelligence tab → click "Run Full Scan" → view scan progress → switch between Contradictions panel (severity pills, resolve buttons), Backlog panel (importance/type filters, approve/reject/defer/duplicate), Coverage Map (17-belief grid).
**Implemented by:** `pages/acu.tsx` (Intelligence tab), routes `POST /acu/scan`, `GET /acu/backlog`, `PATCH /acu/backlog/:id/approve|reject|defer|duplicate`, `GET /acu/backlog/contradictions`, `PATCH /acu/contradictions/:id/resolve`, `GET /acu/coverage`.
**Where it breaks or creates friction:** (1) Full scan processes all documents sequentially — no progress indicator beyond "scanning". (2) Approving a candidate from the backlog promotes it to the ACU registry but doesn't show the new ACU's ID or link. (3) Coverage map uses 17 belief codes (U1-U4, G1-G3, etc.) with no legend explaining what each code means.
**Is this journey complete?** YES.

#### `Coverage Gap Analysis → Brief → Generate Document`
**The job:** Identify which persona × pipeline stage combinations lack documents, generate a creation brief for a gap, then generate the full document.
**Current path:** Content Gaps (/gaps) → view coverage matrix (personas × stages with readiness indicators) → click a gap cell → "Generate Brief" → review/edit brief → "Generate from Brief" → view generated document with QC → navigate to registry.
**Implemented by:** `pages/gaps.tsx`, routes `GET /content/gaps`, `POST /content/generate-brief`, `POST /content/generate-from-brief`.
**Where it breaks or creates friction:** (1) After generating a document from a brief, the user can click through to the registry but the generated document doesn't carry the gap context. (2) History panel (snapshots) works but snapshot comparison is not implemented — user sees raw JSON.
**Is this journey complete?** YES.

#### `Create Campaign → Generate Assets → QC → Activate`
**The job:** Define a multi-channel campaign, generate all channel-specific assets (emails, ads, scripts), run QC checks, and activate.
**Current path:** Campaigns (/campaigns) → "New Campaign" dialog → fill name, objective, personas, channels → Create → Campaign Detail (/campaigns/:id) → "Generate Assets" → view asset table per channel → expand to see generated content → QC tab → view pass/fail per asset → Activate campaign.
**Implemented by:** `pages/campaigns.tsx`, `pages/campaign-detail.tsx`, routes `POST /campaigns`, `POST /campaigns/:id/generate`, `GET /campaigns/:id/qc`, `PATCH /campaigns/:id/activate`.
**Where it breaks or creates friction:** (1) Campaign creation requires selecting personas and channels from pre-defined lists, but the channel list in the creation dialog may not match the channels available in the channel registry. (2) No way to edit individual generated assets before activation — it's generate-all or nothing.
**Is this journey complete?** YES.

#### `Feature Update → Impact Propagation`
**The job:** Record a product feature change and identify which documents need updating.
**Current path:** Feature Updates (/feature-updates) → fill title, description, features, change type, compliance/tier1 flags → Submit → view affected documents list with severity and detection method → click through to each document.
**Implemented by:** `pages/feature-updates.tsx`, route `POST /content/feature-update`.
**Where it breaks or creates friction:** (1) After identifying affected documents, the user must manually open each one to review — no bulk "flag for review" action from this page. (2) The feature update queue polling mechanism exists but provides limited status feedback.
**Is this journey complete?** PARTIAL — impact analysis works but no bulk action on results.

#### `Lead Management`
**The job:** View, search, and manage investor leads.
**Current path:** Lead Management (/leads) → search by name/company → view table (stage, persona, sends, last contact) → click row → Lead Detail (/leads/:id) → view profile, pipeline stage, send history, next best action → confirm/correct detected persona.
**Implemented by:** `pages/leads.tsx`, `pages/lead-detail.tsx`, routes `GET /leads`, `GET /leads/:id`, `GET /leads/:id/next-action`, `POST /leads/:id/confirm-persona`.
**Where it breaks or creates friction:** (1) "New Lead" button on the leads page has no route handler — it doesn't navigate anywhere or open a form. (2) No way to edit lead fields (company, stage) from the detail page — only persona confirmation is interactive.
**Is this journey complete?** PARTIAL — missing lead creation form and field editing.

#### `View Content Bank`
**The job:** Browse and search approved messaging, positioning, and source material.
**Current path:** Content Bank (/content-bank) → search → expand/collapse sections → read markdown content.
**Implemented by:** `pages/content-bank.tsx`, route `GET /content-bank`.
**Where it breaks or creates friction:** Read-only reference material. No friction for intended use.
**Is this journey complete?** YES.

#### `View Changelog`
**The job:** Review audit trail of system state changes.
**Current path:** Changelog (/changelog) → view timestamped entries with action types → click document reference to navigate.
**Implemented by:** `pages/changelog.tsx`, route `GET /compliance/changelog`.
**Where it breaks or creates friction:** None identified — clean read-only audit view.
**Is this journey complete?** YES.

#### `Persona Analytics`
**The job:** Track AI persona detection accuracy and validate predictions.
**Current path:** Persona Analytics (/analytics/personas) → view accuracy KPIs, persona distribution, confidence breakdown → view corrections list → view unconfirmed leads with links to lead detail.
**Implemented by:** `pages/persona-analytics.tsx`, route `GET /analytics/personas`.
**Where it breaks or creates friction:** (1) Unconfirmed leads list links to lead detail but confirming a persona there doesn't auto-refresh the analytics page.
**Is this journey complete?** YES.

---

### 2. Information architecture assessment

#### Home page / entry point (Dashboard — `/`)
**What it currently does:** 4 KPI cards (Total Leads, Total Documents, Docs Sent This Week, Action Required — documents needing review). Recent Activity feed (recent sends). Quick Actions panel (Start Recommendation, Add New Lead, Generate Content). Pipeline Breakdown (leads by stage). Coverage Gaps summary (stage × archetype gaps with count).
**First-time user needs:** Understanding what the tool does and where to start. The Quick Actions panel addresses this reasonably well — it offers the three most common starting actions.
**Returning user needs:** What needs attention right now (documents needing review, coverage gaps, recent activity). This is well-served.
**Verdict:** APPROPRIATE
**Specific problem:** Minor — "Add New Lead" quick action links to `/leads/new` which has no route handler (404).

#### Sidebar navigation
**What it currently does:** 13 items in a flat list: Dashboard, Recommendation Engine, Call Prep, Lead Management, Document Registry, Content Bank, Changelog, Content Generation, Content Gaps, Feature Updates, Persona Analytics, Content Units, Campaigns.
**Should it exist as standalone?** YES — sidebar is the primary navigation.
**Verdict:** OVERLOADED
**Specific problem:** 13 flat items with no grouping or hierarchy. Related features are scattered: "Content Generation" and "Content Gaps" are separated by "Changelog". "Call Prep" and "Recommendation Engine" are sequential workflow steps but positioned as independent top-level items. "Persona Analytics" is buried near the bottom despite being a key governance view.

#### Content Units page (`/acu`)
**What it currently does:** 5 tabs — ACU Registry, Intelligence (scan/backlog/contradictions/coverage), Templates (22 templates), Prompts (P001-P004), and implicitly the template/prompt detail views. This is the governance hub.
**Should it exist as standalone?** YES — but it conflates four distinct concerns: ACU management, intelligence scanning, template registry, and prompt governance.
**Verdict:** OVERLOADED
**Specific problem:** A single page with 5 tabs spanning ~1333 lines of JSX. Templates and Prompts are governance objects with their own lifecycle but are buried as subtabs of "Content Units". The Intelligence tab alone contains three sub-panels (contradictions, backlog, coverage map) that could each be standalone views.

#### Content Generation page (`/generate`)
**What it currently does:** Free-text generation form (document name, type, requirements, personas) → QC report → regenerate/promote.
**Should it exist as standalone?** SHOULD MERGE WITH: Template-based generation (currently backend-only, no UI).
**Verdict:** UNDERSPECIFIED
**Specific problem:** The generation page doesn't surface the Template Registry's 22 templates, their required/prohibited ACUs, or section definitions. The user has no way to use template-based generation from the UI, despite it being the more powerful and compliant generation path.

#### Campaigns page (`/campaigns`)
**What it currently does:** Campaign list with status indicators, creation dialog, navigation to campaign detail (assets, sequence, AC build, tags).
**Should it exist as standalone?** YES.
**Verdict:** APPROPRIATE

#### Call Prep page (`/call-prep`)
**What it currently does:** 4 qualification questions with checkboxes, signals to listen for, "Start Recommendation" button that carries checked questions to /recommend.
**Should it exist as standalone?** NO — SHOULD MERGE WITH: Recommendation Engine as a first step.
**Verdict:** MISPLACED — this is a pre-step to the recommendation flow, not an independent feature. Having it as a separate sidebar item creates an unnecessary navigation hop and may be skipped by users who don't realise the sequence.

---

### 3. Feature grouping and phase opportunities

#### `Sidebar navigation — content creation cluster`
**Current state:** Content Generation, Content Gaps, Content Bank, Feature Updates are spread across positions 8, 9, 6, and 10 in the sidebar.
**The problem:** Content creation is a workflow: identify gaps → generate briefs → generate documents → track updates. Scattering these items prevents the user from seeing the creation pipeline as a coherent flow.
**Proposed grouping:** Group under a "Content" section header: Content Bank, Content Gaps, Content Generation, Feature Updates — in that order (reference → identify → create → maintain).
**Rationale:** This matches the natural content lifecycle: reference existing material → find what's missing → create new content → propagate changes.
**Effort:** LOW — sidebar restructure only, no route changes.

#### `Sidebar navigation — investor operations cluster`
**Current state:** Call Prep, Recommendation Engine, Lead Management, Persona Analytics are at positions 3, 2, 4, and 11.
**The problem:** These are all investor-facing operations but are mixed with content management features. A user doing investor outreach has to hunt through the sidebar.
**Proposed grouping:** Group under an "Investor Intelligence" section header: Recommendation Engine (or merge Call Prep into it), Lead Management, Persona Analytics — in that order.
**Rationale:** These all serve the investor interaction workflow: prepare → recommend → manage → measure accuracy.
**Effort:** LOW — sidebar restructure only.

#### `ACU page tab overload`
**Current state:** ACU Registry, Intelligence, Templates, Prompts — all in one page component.
**The problem:** Templates and Prompts have no functional dependency on ACU management. A content team member looking for templates shouldn't need to navigate to "Content Units" to find them. The page component is 1333 lines long, making maintenance difficult.
**Proposed grouping:** (1) ACU Registry + Intelligence remain together (they are tightly coupled). (2) Templates become a standalone sidebar item or merge into Content Generation. (3) Prompts become a standalone governance view or fold into a "System Config" section.
**Rationale:** Templates are consumed by the generation workflow, not by ACU management. Prompts are system governance, not content unit management.
**Effort:** MEDIUM — requires extracting components and adding new routes.

---

### 4. Progressive disclosure opportunities

#### `Recommendation Engine — single mode`
**Currently shown:** Lead search, transcript textarea, Q1-Q4 checklist, matrix context flags, analysis results (persona, stage, objections, information gaps, readiness score, call completeness), ranked documents, email draft, confirm send — all in one scrolling view.
**Immediately needed:** Lead search, transcript input, Analyse button.
**Can be deferred:** Analysis results (shown after analysis completes), ranked documents (shown after ranking), email draft (shown after email generation), confirm send (shown after all prior steps).
**Trigger for revealing:** Each step auto-reveals on completion of the prior step — this is already partially implemented via mutation states. But the Q1-Q4 checklist, matrix flags panel, and information gap brief generator are always visible, adding visual noise before analysis.

#### `Content Units — ACU Registry tab`
**Currently shown:** Filters (status, type, search), full table with all columns (type, content preview, status, source, expression variants count, actions), expandable detail row.
**Immediately needed:** Search, status filter, table with type/content/status.
**Can be deferred:** Expression variants count, source, approved_by — move to expanded detail row.
**Trigger for revealing:** Row expansion (already implemented via chevron toggle).

#### `Campaign Detail — asset table`
**Currently shown:** All assets listed with channel, type, status, QC result, and full generated content visible on expand.
**Immediately needed:** Asset list with channel and QC status.
**Can be deferred:** Full generated content (shown on expand — already implemented), detailed QC breakdown.
**Trigger for revealing:** Asset row expansion (already implemented).

---

### 5. Back-to-front coherence gaps

**Backend capability not surfaced:**
- `POST /generation/from-template`: Template-based generation with required/prohibited ACU enforcement, section definitions, and parent template inheritance. Should appear as a "Generate from Template" option in the Content Generation page or as a dedicated template generation form.
- `GET /acu/coverage`: Belief coverage map (U1-U4, G1-G3, P1-P3, L1-L3, F0-F3) is rendered in the Intelligence tab but the belief codes have no legend or description. The backend has the full belief definitions.
- `POST /acu/:id/version`: ACU version history creation endpoint exists but no frontend UI exposes version management (viewing previous versions, creating snapshots).
- `GET /dashboard/recent-activity`: The changelog-based recent activity endpoint is called but the dashboard shows `recent_sends` instead — the `recentActivity` query result from `useGetRecentActivity` is fetched but never rendered.
- `GET /content-bank/personas`: Persona guide endpoint exists but no frontend page or component displays it.
- `GET /videos` / `POST /videos`: Video management CRUD exists but no sidebar item or page references videos.
- `GET /acu/scan-log`: Scan audit log endpoint exists but is not displayed anywhere in the Intelligence tab.

**Frontend promise not backed by capability:**
- Global search bar (header): Renders a search input with placeholder "Search leads, documents, or content..." but has no `onChange` handler, no API endpoint, and no search results display. Implies cross-entity search that does not exist.
- Notification bell (header): Renders with a red dot indicator (implying unread notifications) but has no click handler, no notification API, and no notification system.
- "New Lead" button (leads page): Button is rendered but links to `/leads/new` which matches no route — navigates to 404.
- Settings gear icon (header): Rendered but has no click handler or settings page.

---

### 6. Missing connective tissue

- **Content Generation → Template Registry:** The generation page should offer a "Choose Template" dropdown that loads from `GET /templates` and switches to the template-based generation flow (`POST /generation/from-template`). Currently these are completely disconnected — templates are viewable in the ACU page but not usable from the generation page.

- **Recommendation Engine → Lead Detail:** After analysing a transcript and confirming a send, the user should be able to click through to the lead's detail page to see the updated send history. Currently, the confirm-send action completes silently with a success badge but no navigation link.

- **Coverage Gaps → Content Generation:** After identifying a gap and generating a brief, clicking "Generate from Brief" produces a document but doesn't carry the gap context (which persona × stage combination it fills) into the document metadata. The generated document appears in the registry without context about why it was created.

- **Feature Updates → Document Registry:** After running a feature update impact analysis, the list of affected documents has links to individual documents, but there is no bulk "Flag All for Review" button that would batch-update all affected documents' review state.

- **ACU Intelligence Backlog → ACU Registry:** Approving a candidate from the backlog promotes it to the ACU registry, but the UI doesn't show the new ACU's ID or provide a direct link to it in the Registry tab.

- **Dashboard "Action Required" → Document Registry:** The dashboard card links to `/registry?review_state=REQUIRES_REVIEW` which correctly filters the registry. This connection works well.

- **Call Prep → Recommendation Engine:** Connected via URL query params — this works but the question coverage context is ephemeral and not persisted. If the user refreshes the recommendation page, the call prep context is lost.

---

### 7. Friction inventory

| Location | Friction point | Severity | Likely fix |
|---|---|---|---|
| Header — global search bar | Non-functional search input with placeholder text implying cross-entity search | MEDIUM | Either implement a global search API + results dropdown or remove the search bar |
| Header — notification bell | Non-functional bell icon with red dot implying unread notifications | LOW | Remove the red dot and disable the icon, or implement notifications |
| Header — settings icon | Non-functional settings gear with no click handler | LOW | Remove or implement a settings page |
| Sidebar | 13 flat nav items with no grouping or hierarchy | MEDIUM | Group into 3-4 sections: Operations, Content, Governance, System |
| Leads — "New Lead" button | Links to `/leads/new` which is a 404 | HIGH | Add a lead creation form/modal or route |
| Content Generation | No template picker — users cannot use template-based generation | HIGH | Add template dropdown that loads from Template Registry |
| ACU page | 5 tabs / 1333 lines — templates and prompts buried under "Content Units" | MEDIUM | Extract templates into own page; link from generation |
| Recommendation Engine | Call Prep context lost on page refresh | LOW | Persist Q1-Q4 state in URL params (partially done) or sessionStorage |
| Coverage Map | Belief codes (U1-U4, G1-G3, etc.) shown without legend | MEDIUM | Add tooltip or legend explaining each belief code |
| ACU Intelligence — scan | No progress indicator during full scan | MEDIUM | Add progress bar or per-document status updates |
| Dashboard | `useGetRecentActivity` result fetched but never rendered | LOW | Either render the activity feed or remove the unused query |
| User identity | Hardcoded "John Doe / john@unlock.com" with no auth | LOW | Acceptable for internal tool MVP; flag for future auth integration |

---

### 8. Error UX

| Journey | Error state | Communication | Rating |
|---|---|---|---|
| Transcript analysis | Claude API failure or empty transcript | Mutation error state renders error message via React Query | CLEAR |
| Batch transcript processing | File parse error (wrong format, too large) | Error shown per file in results list + global error banner | CLEAR |
| Document generation | Claude API failure | `generateMutation.error` rendered as error alert | CLEAR |
| Document generation — QC fail | QC report returns `overall: "fail"` | Red badge + warning list + "Regenerate" button | CLEAR |
| PDF import | Upload failure or parse error | Error toast / modal error state | VAGUE — no specific error message shown to user in the import modal |
| ACU approve/lock/cascade | Backend validation error (e.g. wrong status transition) | `throw new Error(err.error)` caught and shown via alert/toast | CLEAR |
| ACU scan | Scan failure (Claude API error) | Error state shown in Intelligence tab | VAGUE — generic "Scan failed" message without specifics |
| Campaign creation | Validation error | Dialog shows generic error | VAGUE |
| Campaign asset generation | Claude API failure | Error state per asset | CLEAR |
| Feature update submission | Backend error | Mutation error rendered | CLEAR |
| Lead detail — persona confirmation | API error | `setConfirmResult("Error: ...")` shown inline | CLEAR |
| Navigation — 404 | Unknown route | NotFound component rendered | CLEAR |
| Data loading — any page | API unreachable | React Query error state — varies by page: some show error text, some show blank | VAGUE — inconsistent error display across pages |

---

### 9. Prioritised recommendations

#### `R1: Surface template-based generation on the Content Generation page`
**Type:** SURFACE EXISTING CAPABILITY
**What to change:** Add a template picker dropdown to `/generate` that loads from `GET /templates`. When a template is selected, switch the form to show the template's section definitions, required ACUs, and prohibited ACUs. Submit via `POST /generation/from-template` instead of the free-text endpoint. Keep the free-text mode as a "Custom" option.
**Who it helps:** Content Generation journey. Ensures generated documents inherit compliance constraints from the Template Registry.
**Effort:** MEDIUM
**Priority:** HIGH

#### `R2: Implement lead creation form`
**Type:** ADD CONNECTIVE TISSUE
**What to change:** Add a lead creation form at `/leads/new` (or as a modal triggered by the "New Lead" button). Minimum fields: name, company, pipeline stage, source. Wire to `POST /leads`.
**Who it helps:** Lead Management journey. Currently the "New Lead" button (visible on leads page and dashboard Quick Actions) produces a 404.
**Effort:** LOW
**Priority:** HIGH

#### `R3: Group sidebar navigation into sections`
**Type:** RESTRUCTURE
**What to change:** Replace the flat 13-item list with 3-4 grouped sections:
- **Operations:** Dashboard, Recommendation Engine (absorb Call Prep as first step), Lead Management
- **Content:** Content Bank, Content Gaps, Content Generation, Document Registry, Feature Updates
- **Governance:** Content Units (ACU Registry + Intelligence), Campaigns, Persona Analytics
- **System:** Changelog (+ future: Settings, Prompts)
**Who it helps:** All users — reduces cognitive load when scanning navigation.
**Effort:** LOW
**Priority:** MEDIUM

#### `R4: Remove or implement non-functional header elements`
**Type:** SIMPLIFY
**What to change:** Remove the global search input, notification bell (with fake red dot), and settings icon — or implement them. A non-functional search bar with placeholder text actively misleads users.
**Who it helps:** All users — eliminates false affordances.
**Effort:** LOW
**Priority:** MEDIUM

#### `R5: Extract Template Registry from ACU page`
**Type:** REGROUP
**What to change:** Move the Templates tab out of `/acu` into either (a) its own sidebar entry `/templates` or (b) integrate it directly into the Content Generation page as a template browser/picker. Keep Prompts in ACU or move to a System section.
**Who it helps:** Content Generation journey — makes templates discoverable where they are consumed.
**Effort:** MEDIUM
**Priority:** MEDIUM

#### `R6: Add belief code legend to Coverage Map`
**Type:** SIMPLIFY
**What to change:** Add a collapsible legend panel or tooltips to the coverage map explaining what each belief code means (e.g. U1 = "EIS provides 30% income tax relief", G1 = "Growth potential of fund investments").
**Who it helps:** ACU Intelligence journey — coverage map is unreadable without domain knowledge of the belief codes.
**Effort:** LOW
**Priority:** MEDIUM

#### `R7: Wire Recommendation Engine → Lead Detail handoff`
**Type:** ADD CONNECTIVE TISSUE
**What to change:** After confirm-send completes, show a "View Lead" link that navigates to `/leads/:id` for the selected lead.
**Who it helps:** Investor Call → Send journey — currently ends abruptly at a success badge.
**Effort:** LOW
**Priority:** LOW

#### `R8: Merge Call Prep into Recommendation Engine`
**Type:** RESTRUCTURE
**What to change:** Make the Call Prep questionnaire the first step/panel of the Recommendation Engine page, rather than a separate sidebar item. Show it as a collapsible "Call Questions" panel above the transcript input.
**Who it helps:** Investor Call journey — removes an unnecessary navigation hop and ensures the checklist is always available when analysing transcripts.
**Effort:** LOW
**Priority:** LOW

#### `R9: Standardise error display across pages`
**Type:** SIMPLIFY
**What to change:** Create a shared `<ErrorBanner>` component used consistently across all pages for API error states. Currently some pages show inline text, some show nothing, some show toasts.
**Who it helps:** All journeys — consistent error UX builds trust.
**Effort:** LOW
**Priority:** LOW

#### `R10: Render or remove unused `useGetRecentActivity` on dashboard`
**Type:** SIMPLIFY
**What to change:** The dashboard fetches `useGetRecentActivity({ limit: 10 })` but never renders the result. Either render it in the Recent Activity section (replacing or supplementing `recent_sends`) or remove the dead query.
**Who it helps:** Dashboard — removes unnecessary API call and clarifies intent.
**Effort:** LOW
**Priority:** LOW

---

### 10. Overall verdict

| Dimension | Status | Notes |
|---|---|---|
| User journey completeness | 🟡 | Core journeys (recommend, generate, ACU management, campaigns) work end-to-end. Template-based generation has no UI. Lead creation 404s. |
| Information architecture | 🟡 | Dashboard is well-composed. Sidebar is overloaded (13 flat items). ACU page conflates 4 concerns. |
| Feature grouping logic | 🟡 | Content features scattered across sidebar. Templates buried under ACU page. Call Prep separated from Recommendation Engine. |
| Progressive disclosure | 🟢 | Most pages use expandable rows and mutation-driven reveal well. Recommendation Engine is dense but functional. |
| Back-to-front coherence | 🔴 | Template-based generation (major backend capability) has zero frontend exposure. Global search, notifications, and settings are fake affordances. Videos endpoint has no UI. |
| Connective tissue | 🟡 | Dashboard → Registry, Call Prep → Recommend work. Generation → Registry, Recommend → Lead Detail, Gaps → Generation lack handoff links. |
| Error UX | 🟡 | CLEAR in core journeys (recommendation, generation, ACU lifecycle). VAGUE in PDF import, scan failures, and inconsistent across data-loading states. |

**Recommendation:** RESTRUCTURE BEFORE BUILDING MORE

**One thing to fix first:** Surface template-based generation on the Content Generation page (R1). This is the single highest-impact change because it connects the existing Template Registry (22 templates with required/prohibited ACU enforcement) to the generation workflow where users actually create content. Without this, the template governance layer — the core compliance value proposition — is invisible to users.
