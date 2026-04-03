# FIX SESSION — Gap Snapshot Accumulation + Rank Field Normalisation
Version: 1.0

---

## Final report

Fix 1 — Gap snapshot accumulation:
- Default behaviour (no save): CONFIRMED no DB write
- Explicit save (?save=true): CONFIRMED saves correctly
- Frontend Save Snapshot button: WORKING
- DB row count stable on page load: YES

Fix 2 — Rank field normalisation:
- rank field always present: YES
- relevance_score field always present: YES
- ranking and score absent from response: YES
- Rank order unchanged: YES
