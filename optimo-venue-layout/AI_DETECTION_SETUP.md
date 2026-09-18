# AI Layout Detection — Setup & Deployment

This guide deploys the **`analyze-blueprint`** Supabase Edge Function and explains
how the **AI Layout Detection** panel works in the layout designer.

## Architecture (Phase 1 — current)

```
Angular layout designer
  │
  ├─ Browser CV (no API key)
  │     detect-blocks.ts + contour-geometry.ts
  │     → block polygons, ring tiers, pitch region from image pixels
  │
  ├─ BlueprintAnalyzerService.fetchOcr()
  │     └─ supabase.functions.invoke('analyze-blueprint', { ocrOnly: true, imageBase64, mimeType })
  │           ↓ (Azure key stays server-side)
  │         Supabase Edge Function: analyze-blueprint
  │           └─ Azure Document Intelligence → OCR tokens + polygon coordinates
  │
  ├─ assign-ocr-labels.ts
  │     → point-in-polygon: OCR text → block label
  │
  ├─ cv-to-layout.ts + canvas.setReferenceImage()
  │     → chart as background + custom block polygons on canvas
  │
  └─ BlueprintAuditService (auto-runs after Generate Layout)
        audit-overlay.ts → blueprint + numbered-outline overlay JPEGs
        └─ supabase.functions.invoke('analyze-blueprint', { verifyBlocks: true, … })
              ↓ (OpenRouter key stays server-side)
            OpenRouter vision model compares both images
              → accuracy %, missing / split / merged / misnamed / extra issues
        → audit panel in the sidebar; clicking an issue highlights it on canvas
```

**Why this stack:** Geometry comes from **real image borders** (client CV), not from an LLM.
Block **names** come from **Azure OCR** coordinates merged into polygons — no hallucinated labels.
The **verification pass** uses the vision LLM only as a *QA auditor* — it never creates or moves
blocks; accuracy is computed client-side from its counts.

> **Full LLM analysis mode** (`ocrOnly: false`) is still in the edge function for experiments,
> but the designer calls **`ocrOnly: true`** for analysis and **`verifyBlocks: true`** for the
> post-generation audit.

> **Phase 2 (future):** Optional Python + OpenCV microservice for even tighter polygons.
> UI and merge layer are structured so a third geometry source can slot in later.

---

## 1. Install the Supabase CLI

```bash
npm install -g supabase
# or: scoop install supabase  /  brew install supabase/tap/supabase
supabase --version
```

## 2. Log in & link the project

```bash
supabase login
# Project ref is the subdomain in environment.ts (…/afpjzctfhtlsyqpsyzzt.supabase.co)
supabase link --project-ref afpjzctfhtlsyqpsyzzt
```

Run all commands from the `optimo-venue-layout` folder (where `supabase/` lives).

## 3. Set the function secrets

> ⚠️ Use **freshly rotated** keys. Never commit secrets to git or `environment.ts`.

**Required for current flow (OCR labels + AI verification):**

```bash
supabase secrets set AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT="https://YOUR-RESOURCE.cognitiveservices.azure.com/"
supabase secrets set AZURE_DOCUMENT_INTELLIGENCE_KEY="XXXXXXXX"
supabase secrets set OPENROUTER_API_KEY="sk-or-v1-XXXXXXXX"
```

**Optional:**

```bash
supabase secrets set BLUEPRINT_MODEL="google/gemini-2.5-flash"        # analysis default
supabase secrets set BLUEPRINT_VERIFY_MODEL="google/gemini-2.5-pro"   # verification default (already the built-in default)
```

Verify:

```bash
supabase secrets list
```

## 4. Deploy the function

```bash
npx supabase functions deploy analyze-blueprint --project-ref afpjzctfhtlsyqpsyzzt
```

The Angular client sends the logged-in user’s JWT automatically. For local testing without auth:

```bash
supabase functions deploy analyze-blueprint --no-verify-jwt
```

## 5. Test it

1. `ng serve` → login → **Venue Layouts** → **+ New blank layout**
2. Start → **AI Layout Detection**
3. Upload a stadium/seating chart (PNG/JPG/WEBP)
4. **✦ Analyze with AI** on the preview step
5. Review tiers/blocks on the result screen → **Generate Layout →**
6. Chart appears as canvas background; block polygons overlay on top (editable in Inspector)

---

## UI flow (designer sidebar)

| Phase | What the user sees |
|-------|-------------------|
| `idle` | Drop zone |
| `preview` | Image thumbnail, include-seats checkbox, Analyze button |
| `analyzing` | Image + spinner |
| `result` | Venue summary, Ground/Stage, Seating Tiers (dark cards), Generate Layout |
| `error` | Error message + Try again |

---

## Configuration reference

| Secret | Required (Phase 1) | Purpose |
|--------|-------------------|---------|
| `AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT` | ✅ | OCR endpoint |
| `AZURE_DOCUMENT_INTELLIGENCE_KEY` | ✅ | OCR key |
| `OPENROUTER_API_KEY` | ✅ | AI verification pass (`verifyBlocks: true`) + full LLM mode |
| `BLUEPRINT_MODEL` | optional | OpenRouter model slug for analysis (default gemini-2.5-flash) |
| `BLUEPRINT_VERIFY_MODEL` | optional | Model for verification (default gemini-2.5-pro) |

If Azure is missing, OCR returns empty and blocks stay unlabelled (CV geometry still works).
If OpenRouter is missing, block generation still works — only the verification panel errors
(with a Re-verify button).

### `verifyBlocks` request / response

Request body (built by `BlueprintAuditService` + `lib/audit-overlay.ts`):

```jsonc
{
  "verifyBlocks": true,
  "imageBase64": "…",          // original blueprint, downscaled JPEG
  "overlayBase64": "…",        // blueprint + numbered magenta outlines of detected blocks
  "mimeType": "image/jpeg",
  "blocks": [ { "index": 1, "label": "A12", "cxPct": 22.5, "cyPct": 14, "wPct": 6, "hPct": 5 } ]
}
```

Response:

```jsonc
{
  "verification": {
    "totalRealBlocks": 34,
    "issues": [
      {
        "type": "split",                 // missing | split | merged | misnamed | extra
        "realBlockLabel": "A12",
        "detectedIndices": [7, 8],       // badge numbers from the overlay
        "approxRegion": { "xPct": 22.5, "yPct": 14, "wPct": 6, "hPct": 5 },
        "note": "Label border of A12 traced as a second block."
      }
    ],
    "confidence": "high",
    "summary": "…"
  },
  "meta": { "llmModel": "…", "processingTimeMs": 1234 }
}
```

Accuracy shown in the panel = `(totalRealBlocks − affected real blocks) / totalRealBlocks`,
computed client-side in `blueprint-audit.service.ts`.

## Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| “Failed to send a request to the Edge Function” | Function not deployed — run step 4 |
| 401 / JWT errors | User not logged in, or `--no-verify-jwt` for dev |
| `AZURE_DOCUMENT_INTELLIGENCE_* is not configured` | Set secrets (step 3), redeploy |
| Few / no labelled blocks | OCR failed or chart text too small — check function logs |
| “Could not detect enough seating blocks” | Image unclear; need visible coloured sections + white borders |
| Stream logs | `supabase functions logs analyze-blueprint` |

## Files

| File | Role |
|------|------|
| **Edge function** | |
| `supabase/functions/analyze-blueprint/index.ts` | Handler; `ocrOnly` + `verifyBlocks` + full LLM modes |
| `…/azure-ocr.ts` | Azure Document Intelligence |
| `…/openrouter.ts` | OpenRouter vision (single- and multi-image) |
| `…/prompt.ts`, `…/normalize.ts` | LLM prompt + JSON normalize |
| `…/verify-prompt.ts`, `…/normalize-verify.ts` | Verification prompt + response normalize |
| **Browser CV** | |
| `src/.../lib/contour-geometry.ts` | Contour trace, simplify, point-in-polygon |
| `src/.../lib/detect-blocks.ts` | Flood-fill regions → block polygons |
| `src/.../lib/assign-ocr-labels.ts` | Merge OCR + CV |
| `src/.../lib/cv-to-layout.ts` | Result → `LayoutElement[]` |
| `src/.../lib/ai-tier-groups.ts` | Tier cards for result UI |
| `src/.../lib/audit-overlay.ts` | Verification image pair + block summary table |
| **Services / UI** | |
| `src/.../services/blueprint-analyzer.service.ts` | `fetchOcr()` |
| `src/.../services/blueprint-audit.service.ts` | Verification run + accuracy + issue focusing |
| `src/.../components/blueprint-audit-panel/` | Accuracy % + issue list panel |
| `src/.../layout-designer.page.{ts,html}` | AI panel state machine |
| `src/.../services/layout-canvas.service.ts` | `setReferenceImage`, `applyGeneratedElements`, audit highlight |
| `src/tailwind.css` | `.ai-tier-theme`, result + audit panel styles |

Team changelog: see **`TEAM_GUIDE.md`** → *2026-06-24 — AI Layout Detection*.
