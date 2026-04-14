import { useState, useCallback } from "react";

const UNLOCK_GREEN = "#01BC77";
const TEXT_GREEN = "#008655";
const NEAR_BLACK = "#1A1A1A";
const CREAM = "#F0EBE0";
const DARK_TEAL = "#0D2D35";

const entities = [
  {
    id: "documents",
    label: "Documents",
    x: 60,
    y: 30,
    color: DARK_TEAL,
    fields: [
      { name: "document_id", type: "PK", dataType: "INT" },
      { name: "numeric_id", type: "", dataType: "CHAR(3)" },
      { name: "type", type: "FK", dataType: "VARCHAR" },
      { name: "title", type: "", dataType: "VARCHAR(255)" },
      { name: "version", type: "", dataType: "VARCHAR(10)" },
      { name: "status", type: "", dataType: "ENUM(CURRENT,SUPERSEDED)" },
      { name: "track", type: "", dataType: "ENUM(B1,B2,Both,Internal)" },
      { name: "audience", type: "", dataType: "VARCHAR(100)" },
      { name: "belief_stage", type: "", dataType: "VARCHAR(20)" },
      { name: "output_format", type: "", dataType: "ENUM(docx,pptx,xlsx,md)" },
      { name: "tier", type: "", dataType: "ENUM(1,2,3)" },
      { name: "pinned", type: "", dataType: "BOOLEAN" },
      { name: "supersedes", type: "FK→self", dataType: "INT NULL" },
      { name: "last_updated", type: "", dataType: "DATE" },
      { name: "updated_by", type: "", dataType: "VARCHAR(50)" },
      { name: "content_body", type: "", dataType: "TEXT" },
    ],
  },
  {
    id: "document_types",
    label: "Document Types",
    x: 60,
    y: 420,
    color: "#5B6770",
    fields: [
      { name: "type_code", type: "PK", dataType: "VARCHAR(20)" },
      { name: "description", type: "", dataType: "VARCHAR(100)" },
      { name: "id_range_start", type: "", dataType: "INT" },
      { name: "id_range_end", type: "", dataType: "INT" },
    ],
  },
  {
    id: "investors",
    label: "Investors (Prospects)",
    x: 520,
    y: 30,
    color: TEXT_GREEN,
    fields: [
      { name: "investor_id", type: "PK", dataType: "INT" },
      { name: "name", type: "", dataType: "VARCHAR(100)" },
      { name: "email", type: "", dataType: "VARCHAR(150)" },
      { name: "phone", type: "", dataType: "VARCHAR(20)" },
      { name: "persona", type: "FK", dataType: "VARCHAR(30)" },
      { name: "tier", type: "", dataType: "ENUM(1,2,3)" },
      { name: "hot_button", type: "", dataType: "ENUM(family,freedom,...)" },
      { name: "demo_score", type: "", dataType: "INT NULL" },
      { name: "book_track", type: "", dataType: "ENUM(book_1,nurture)" },
      { name: "decision_style", type: "", dataType: "ENUM(quick,thorough,...)" },
      { name: "pack1_gate", type: "", dataType: "ENUM(eligible,blocked)" },
      { name: "annual_tax_liability", type: "", dataType: "DECIMAL NULL" },
      { name: "portfolio_shape", type: "", dataType: "TEXT" },
      { name: "practical_problem", type: "", dataType: "TEXT" },
      { name: "current_pressure", type: "", dataType: "TEXT" },
      { name: "personal_angle", type: "", dataType: "TEXT" },
      { name: "desired_outcome", type: "", dataType: "TEXT" },
      { name: "exact_phrases", type: "", dataType: "TEXT" },
      { name: "decision_stakeholders", type: "", dataType: "TEXT" },
      { name: "questions_for_call3", type: "", dataType: "TEXT" },
      { name: "pipedrive_deal_id", type: "", dataType: "VARCHAR(50)" },
      { name: "created_at", type: "", dataType: "TIMESTAMP" },
    ],
  },
  {
    id: "belief_signals",
    label: "Belief Signals",
    x: 520,
    y: 520,
    color: "#B8860B",
    fields: [
      { name: "signal_id", type: "PK", dataType: "INT" },
      { name: "investor_id", type: "FK", dataType: "INT" },
      { name: "signal_code", type: "", dataType: "ENUM(C1-C4,G1-G3,L1-L2,...)" },
      { name: "category", type: "", dataType: "ENUM(qual,core,problem,sit)" },
      { name: "state", type: "", dataType: "ENUM(green,amber,grey,red,n_a)" },
      { name: "surfaced_by", type: "", dataType: "ENUM(question,convo,...)" },
      { name: "notes", type: "", dataType: "TEXT" },
      { name: "updated_at", type: "", dataType: "TIMESTAMP" },
    ],
  },
  {
    id: "personas",
    label: "Personas (19)",
    x: 960,
    y: 30,
    color: "#8B4513",
    fields: [
      { name: "persona_id", type: "PK", dataType: "VARCHAR(30)" },
      { name: "label", type: "", dataType: "VARCHAR(50)" },
      { name: "archetype", type: "", dataType: "ENUM(Preserver,Growth,Legacy)" },
      { name: "portfolio_min", type: "", dataType: "DECIMAL" },
      { name: "portfolio_max", type: "", dataType: "DECIMAL" },
      { name: "age_range", type: "", dataType: "VARCHAR(10)" },
      { name: "risk_approach", type: "", dataType: "VARCHAR(30)" },
      { name: "tier_priority", type: "", dataType: "ENUM(1,2,3)" },
      { name: "problem_belief_cluster", type: "", dataType: "ENUM(G,L,P)" },
      { name: "pain_points", type: "", dataType: "TEXT" },
      { name: "call_signals", type: "", dataType: "TEXT" },
    ],
  },
  {
    id: "calls",
    label: "Calls / Touchpoints",
    x: 960,
    y: 280,
    color: "#4A6FA5",
    fields: [
      { name: "call_id", type: "PK", dataType: "INT" },
      { name: "investor_id", type: "FK", dataType: "INT" },
      { name: "call_number", type: "", dataType: "INT" },
      { name: "call_type", type: "", dataType: "ENUM(cold_call,demo,opp)" },
      { name: "owner", type: "", dataType: "ENUM(agent,tom)" },
      { name: "date", type: "", dataType: "TIMESTAMP" },
      { name: "duration_mins", type: "", dataType: "INT" },
      { name: "disposition_code", type: "", dataType: "VARCHAR(5)" },
      { name: "signals_updated", type: "", dataType: "JSON" },
      { name: "notes", type: "", dataType: "TEXT" },
      { name: "aircall_id", type: "", dataType: "VARCHAR(50)" },
    ],
  },
  {
    id: "artifacts_sent",
    label: "Artifacts Sent",
    x: 960,
    y: 520,
    color: "#6B4C9A",
    fields: [
      { name: "artifact_id", type: "PK", dataType: "INT" },
      { name: "investor_id", type: "FK", dataType: "INT" },
      { name: "document_id", type: "FK", dataType: "INT" },
      { name: "trigger_signal", type: "", dataType: "VARCHAR(5)" },
      { name: "sent_at", type: "", dataType: "TIMESTAMP" },
      { name: "opened", type: "", dataType: "BOOLEAN NULL" },
      { name: "cover_note", type: "", dataType: "TEXT" },
    ],
  },
  {
    id: "compliance_rules",
    label: "Compliance Rules",
    x: 60,
    y: 640,
    color: "#C0392B",
    fields: [
      { name: "rule_id", type: "PK", dataType: "INT" },
      { name: "constant_name", type: "", dataType: "VARCHAR(100)" },
      { name: "correct_value", type: "", dataType: "TEXT" },
      { name: "never_say", type: "", dataType: "TEXT" },
      { name: "caveat_required", type: "", dataType: "BOOLEAN" },
      { name: "caveat_text", type: "", dataType: "TEXT NULL" },
      { name: "source_document_id", type: "FK", dataType: "INT" },
      { name: "effective_date", type: "", dataType: "DATE" },
    ],
  },
  {
    id: "financials",
    label: "Financial Projections",
    x: 520,
    y: 770,
    color: "#2C3E50",
    fields: [
      { name: "period_id", type: "PK", dataType: "INT" },
      { name: "year_label", type: "", dataType: "VARCHAR(30)" },
      { name: "start_date", type: "", dataType: "DATE" },
      { name: "end_date", type: "", dataType: "DATE" },
      { name: "revenue", type: "", dataType: "DECIMAL" },
      { name: "expenses", type: "", dataType: "DECIMAL" },
      { name: "ebitda", type: "", dataType: "DECIMAL NULL" },
      { name: "paid_users", type: "", dataType: "INT NULL" },
      { name: "source", type: "", dataType: "VARCHAR(100)" },
    ],
  },
  {
    id: "content_routing",
    label: "Content Routing Map",
    x: 520,
    y: 960,
    color: "#16A085",
    fields: [
      { name: "route_id", type: "PK", dataType: "INT" },
      { name: "signal_code", type: "", dataType: "VARCHAR(5)" },
      { name: "signal_state", type: "", dataType: "ENUM(amber,grey)" },
      { name: "persona_filter", type: "FK", dataType: "VARCHAR(30) NULL" },
      { name: "document_id", type: "FK", dataType: "INT" },
      { name: "gate_required", type: "", dataType: "BOOLEAN" },
      { name: "gate_conditions", type: "", dataType: "JSON NULL" },
      { name: "priority_order", type: "", dataType: "INT" },
      { name: "notes", type: "", dataType: "TEXT" },
    ],
  },
  {
    id: "pipeline_stages",
    label: "Pipeline Stages",
    x: 960,
    y: 760,
    color: "#7D3C98",
    fields: [
      { name: "stage_id", type: "PK", dataType: "INT" },
      { name: "stage_number", type: "", dataType: "INT" },
      { name: "name", type: "", dataType: "VARCHAR(50)" },
      { name: "description", type: "", dataType: "TEXT" },
      { name: "probability_pct", type: "", dataType: "INT" },
      { name: "auto_workflow", type: "", dataType: "VARCHAR(20) NULL" },
    ],
  },
  {
    id: "team_members",
    label: "Team Members",
    x: 60,
    y: 860,
    color: "#1B4F72",
    fields: [
      { name: "member_id", type: "PK", dataType: "INT" },
      { name: "name", type: "", dataType: "VARCHAR(100)" },
      { name: "role", type: "", dataType: "VARCHAR(100)" },
      { name: "bio_approved", type: "", dataType: "TEXT" },
      { name: "bio_prohibited", type: "", dataType: "TEXT" },
      { name: "is_core_team", type: "", dataType: "BOOLEAN" },
    ],
  },
  {
    id: "platform_tools",
    label: "Platform Tools",
    x: 960,
    y: 960,
    color: "#117A65",
    fields: [
      { name: "tool_id", type: "PK", dataType: "INT" },
      { name: "name", type: "", dataType: "VARCHAR(100)" },
      { name: "tool_type", type: "", dataType: "ENUM(standalone,feeds,both)" },
      { name: "priority", type: "", dataType: "ENUM(P1,P2,P3,P4)" },
      { name: "group_name", type: "", dataType: "VARCHAR(50)" },
      { name: "standalone_value", type: "", dataType: "TEXT" },
      { name: "feeds_into", type: "", dataType: "TEXT" },
      { name: "status_approved", type: "", dataType: "TEXT" },
    ],
  },
];

const relationships = [
  { from: "documents", to: "document_types", label: "type →", type: "many-to-one" },
  { from: "investors", to: "personas", label: "persona →", type: "many-to-one" },
  { from: "belief_signals", to: "investors", label: "investor_id →", type: "many-to-one" },
  { from: "calls", to: "investors", label: "investor_id →", type: "many-to-one" },
  { from: "artifacts_sent", to: "investors", label: "investor_id →", type: "many-to-one" },
  { from: "artifacts_sent", to: "documents", label: "document_id →", type: "many-to-one" },
  { from: "content_routing", to: "documents", label: "document_id →", type: "many-to-one" },
  { from: "content_routing", to: "personas", label: "persona_filter →", type: "many-to-one" },
  { from: "compliance_rules", to: "documents", label: "source_document →", type: "many-to-one" },
];

const SCALE = 0.58;
const CARD_W = 360;
const FIELD_H = 22;
const HEADER_H = 38;
const PAD = 10;

function cardHeight(entity) {
  return HEADER_H + entity.fields.length * FIELD_H + PAD;
}

function getAnchor(entity, side) {
  const h = cardHeight(entity);
  const cx = entity.x + CARD_W / 2;
  const cy = entity.y + h / 2;
  switch (side) {
    case "left": return { x: entity.x, y: cy };
    case "right": return { x: entity.x + CARD_W, y: cy };
    case "top": return { x: cx, y: entity.y };
    case "bottom": return { x: cx, y: entity.y + h };
    default: return { x: cx, y: cy };
  }
}

function bestSides(fromE, toE) {
  const fc = { x: fromE.x + CARD_W / 2, y: fromE.y + cardHeight(fromE) / 2 };
  const tc = { x: toE.x + CARD_W / 2, y: toE.y + cardHeight(toE) / 2 };
  const dx = tc.x - fc.x;
  const dy = tc.y - fc.y;
  let fromSide, toSide;
  if (Math.abs(dx) > Math.abs(dy)) {
    fromSide = dx > 0 ? "right" : "left";
    toSide = dx > 0 ? "left" : "right";
  } else {
    fromSide = dy > 0 ? "bottom" : "top";
    toSide = dy > 0 ? "top" : "bottom";
  }
  return [getAnchor(fromE, fromSide), getAnchor(toE, toSide)];
}

function RelLine({ fromE, toE, label }) {
  const [a, b] = bestSides(fromE, toE);
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  return (
    <g>
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#888" strokeWidth={1.5} strokeDasharray="6 3" />
      <circle cx={b.x} cy={b.y} r={4} fill="#888" />
      <rect x={mx - 40} y={my - 9} width={80} height={18} rx={3} fill="white" fillOpacity={0.85} />
      <text x={mx} y={my + 4} textAnchor="middle" fontSize={10} fill="#555" fontFamily="'JetBrains Mono', monospace">{label}</text>
    </g>
  );
}

function EntityCard({ entity, isSelected, onClick }) {
  const h = cardHeight(entity);
  return (
    <g onClick={() => onClick(entity.id)} style={{ cursor: "pointer" }}>
      <rect x={entity.x} y={entity.y} width={CARD_W} height={h} rx={6} fill="white" stroke={isSelected ? UNLOCK_GREEN : entity.color} strokeWidth={isSelected ? 3 : 1.5} filter="url(#shadow)" />
      <rect x={entity.x} y={entity.y} width={CARD_W} height={HEADER_H} rx={6} fill={entity.color} />
      <rect x={entity.x} y={entity.y + HEADER_H - 6} width={CARD_W} height={6} fill={entity.color} />
      <text x={entity.x + 14} y={entity.y + 25} fill="white" fontSize={14} fontWeight="700" fontFamily="'JetBrains Mono', monospace">{entity.label}</text>
      {entity.fields.map((f, i) => {
        const fy = entity.y + HEADER_H + i * FIELD_H + 16;
        return (
          <g key={f.name}>
            {i > 0 && <line x1={entity.x + 8} y1={fy - 14} x2={entity.x + CARD_W - 8} y2={fy - 14} stroke="#eee" strokeWidth={0.5} />}
            {f.type === "PK" && <text x={entity.x + 12} y={fy} fontSize={9} fill="#D4A017" fontWeight="700" fontFamily="monospace">PK</text>}
            {f.type === "FK" && <text x={entity.x + 12} y={fy} fontSize={9} fill="#4A90D9" fontWeight="700" fontFamily="monospace">FK</text>}
            {f.type === "FK→self" && <text x={entity.x + 12} y={fy} fontSize={9} fill="#4A90D9" fontWeight="700" fontFamily="monospace">FK</text>}
            <text x={entity.x + 36} y={fy} fontSize={11} fill={NEAR_BLACK} fontFamily="'JetBrains Mono', monospace" fontWeight={f.type === "PK" ? "700" : "400"}>{f.name}</text>
            <text x={entity.x + CARD_W - 12} y={fy} fontSize={9.5} fill="#999" fontFamily="monospace" textAnchor="end">{f.dataType}</text>
          </g>
        );
      })}
    </g>
  );
}

export default function UnlockERD() {
  const [selected, setSelected] = useState(null);
  const [view, setView] = useState("erd");

  const entityMap = {};
  entities.forEach(e => { entityMap[e.id] = e; });

  const handleSelect = useCallback((id) => {
    setSelected(prev => prev === id ? null : id);
  }, []);

  const selectedEntity = selected ? entityMap[selected] : null;

  const summaryStats = {
    tables: entities.length,
    relationships: relationships.length,
    totalFields: entities.reduce((a, e) => a + e.fields.length, 0),
    pks: entities.length,
    fks: entities.reduce((a, e) => a + e.fields.filter(f => f.type.startsWith("FK")).length, 0),
  };

  if (view === "schema") {
    return (
      <div style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace", background: "#fafaf8", minHeight: "100vh", padding: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: DARK_TEAL, margin: 0 }}>UNLOCK — Database Schema</h1>
            <p style={{ fontSize: 12, color: "#888", margin: "4px 0 0" }}>SQL Table Definitions · {summaryStats.tables} tables · {summaryStats.totalFields} fields</p>
          </div>
          <button onClick={() => setView("erd")} style={{ background: DARK_TEAL, color: "white", border: "none", padding: "8px 16px", borderRadius: 4, cursor: "pointer", fontSize: 12, fontFamily: "inherit" }}>← ERD View</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {entities.map(e => (
            <div key={e.id} style={{ background: "white", border: `2px solid ${e.color}`, borderRadius: 8, overflow: "hidden" }}>
              <div style={{ background: e.color, padding: "10px 14px" }}>
                <span style={{ color: "white", fontWeight: 700, fontSize: 13 }}>{e.label}</span>
              </div>
              <div style={{ padding: "10px 14px", fontSize: 11, lineHeight: 1.8 }}>
                {e.fields.map(f => (
                  <div key={f.name} style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid #f0f0f0", padding: "2px 0" }}>
                    <span>
                      {f.type === "PK" && <span style={{ color: "#D4A017", fontWeight: 700, marginRight: 6 }}>PK</span>}
                      {f.type.startsWith("FK") && <span style={{ color: "#4A90D9", fontWeight: 700, marginRight: 6 }}>FK</span>}
                      <span style={{ fontWeight: f.type === "PK" ? 700 : 400 }}>{f.name}</span>
                    </span>
                    <span style={{ color: "#999" }}>{f.dataType}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace", background: "#fafaf8", minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <div style={{ background: DARK_TEAL, padding: "16px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "white", margin: 0, letterSpacing: 1 }}>UNLOCK — Entity Relationship Diagram</h1>
          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", margin: "4px 0 0" }}>
            {summaryStats.tables} tables · {summaryStats.totalFields} fields · {summaryStats.relationships} relationships · {summaryStats.fks} foreign keys
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setView("schema")} style={{ background: "rgba(255,255,255,0.15)", color: "white", border: "1px solid rgba(255,255,255,0.3)", padding: "6px 14px", borderRadius: 4, cursor: "pointer", fontSize: 11, fontFamily: "inherit" }}>Schema View</button>
        </div>
      </div>

      <div style={{ display: "flex", flex: 1 }}>
        <div style={{ flex: 1, overflow: "auto", padding: 12 }}>
          <svg width={1400 * SCALE} height={1200 * SCALE} viewBox="0 0 1400 1200" style={{ background: "white", borderRadius: 8, border: "1px solid #e0e0e0" }}>
            <defs>
              <filter id="shadow" x="-2%" y="-2%" width="104%" height="104%">
                <feDropShadow dx="1" dy="2" stdDeviation="3" floodOpacity="0.08" />
              </filter>
            </defs>
            {relationships.map((r, i) => (
              <RelLine key={i} fromE={entityMap[r.from]} toE={entityMap[r.to]} label={r.label} />
            ))}
            {entities.map(e => (
              <EntityCard key={e.id} entity={e} isSelected={selected === e.id} onClick={handleSelect} />
            ))}
          </svg>
        </div>

        <div style={{ width: 280, background: "white", borderLeft: "1px solid #e0e0e0", padding: 16, overflow: "auto" }}>
          {selectedEntity ? (
            <div>
              <div style={{ background: selectedEntity.color, padding: "10px 12px", borderRadius: 6, marginBottom: 12 }}>
                <h3 style={{ color: "white", fontSize: 14, margin: 0, fontWeight: 700 }}>{selectedEntity.label}</h3>
              </div>
              <p style={{ fontSize: 11, color: "#666", marginBottom: 12 }}>{selectedEntity.fields.length} fields · {selectedEntity.fields.filter(f => f.type === "PK").length} PK · {selectedEntity.fields.filter(f => f.type.startsWith("FK")).length} FK</p>
              {selectedEntity.fields.map(f => (
                <div key={f.name} style={{ padding: "6px 0", borderBottom: "1px solid #f5f5f5", fontSize: 11 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {f.type === "PK" && <span style={{ background: "#FFF3CD", color: "#856404", padding: "1px 5px", borderRadius: 3, fontSize: 9, fontWeight: 700 }}>PK</span>}
                    {f.type.startsWith("FK") && <span style={{ background: "#D6EAF8", color: "#2471A3", padding: "1px 5px", borderRadius: 3, fontSize: 9, fontWeight: 700 }}>FK</span>}
                    <span style={{ fontWeight: f.type === "PK" ? 700 : 500 }}>{f.name}</span>
                  </div>
                  <div style={{ color: "#999", fontSize: 10, marginTop: 2, paddingLeft: f.type ? 30 : 0 }}>{f.dataType}</div>
                </div>
              ))}
              <div style={{ marginTop: 16, fontSize: 10, color: "#888" }}>
                <strong style={{ color: "#555" }}>Relationships:</strong>
                {relationships.filter(r => r.from === selected || r.to === selected).map((r, i) => (
                  <div key={i} style={{ marginTop: 4, padding: "4px 6px", background: "#f9f9f9", borderRadius: 3 }}>
                    {r.from === selected ? `→ ${entityMap[r.to].label}` : `← ${entityMap[r.from].label}`}
                    <span style={{ color: "#aaa" }}> ({r.type})</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div>
              <h3 style={{ fontSize: 14, color: DARK_TEAL, marginTop: 0, fontWeight: 700 }}>Entity Inspector</h3>
              <p style={{ fontSize: 11, color: "#888", lineHeight: 1.6 }}>Click any table in the diagram to inspect its fields and relationships.</p>
              <div style={{ marginTop: 16, padding: 12, background: CREAM, borderRadius: 6, fontSize: 10, lineHeight: 1.7 }}>
                <strong style={{ color: DARK_TEAL }}>Schema Summary</strong><br />
                Tables: {summaryStats.tables}<br />
                Total fields: {summaryStats.totalFields}<br />
                Primary keys: {summaryStats.pks}<br />
                Foreign keys: {summaryStats.fks}<br />
                Relationships: {summaryStats.relationships}
              </div>
              <div style={{ marginTop: 12 }}>
                <strong style={{ fontSize: 11, color: DARK_TEAL }}>All Tables</strong>
                {entities.map(e => (
                  <div key={e.id} onClick={() => handleSelect(e.id)} style={{ cursor: "pointer", padding: "5px 8px", margin: "3px 0", borderRadius: 4, background: "#fafafa", fontSize: 10, display: "flex", justifyContent: "space-between", alignItems: "center", border: "1px solid #f0f0f0" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: e.color, display: "inline-block" }} />
                      {e.label}
                    </span>
                    <span style={{ color: "#bbb" }}>{e.fields.length}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
