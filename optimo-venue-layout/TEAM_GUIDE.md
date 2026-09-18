# Team Guide — Optimo Venue Layout Platform

> **Teammates:** After cloning, open the project in Cursor and **read this file first**.  
> This file only tracks **what has been changed in the project**.

---

## Paste this in Cursor

```
Read TEAM_GUIDE.md and summarize what has been built and changed in the project so far.
```

---

## Project (one line)

**Optimo Venue Spatial Inventory & Layout Platform** — Angular app for admin dashboard, venue layouts, 2D designer, block workspace (seating / dining / GA), and AI-assisted venue creation.

**API:** **Supabase** (interim) for auth + saved venue templates + block config templates. Real Optimo API later — connect only after lead approves and API access is available.

---

## What's built now (as of 2026-07-23)

| Area | Status | Main contributors |
|---|---|---|
| Admin shell, dashboard, auth, theme | Done | Kalai |
| Venue template library (Supabase save/load/delete) | Done | Kalai |
| 2D canvas — all 13 element types render + edit | Done | Kalai, Danuharan |
| Infinite canvas pan/zoom + zoom buttons | Done | Kalai |
| AI blueprint detection (browser CV + Azure OCR) | Done | Kalai |
| Trace mode + colour detect + auto trace fill | Done | Thamsan, Kalai |
| Blueprint audit / accuracy verify (OpenRouter vision) | Done | Kalai, Danuharan, Thamsan |
| Block workspace (seating / dining / GA) | Done | Thamsan, Thifshana, Kalai |
| Seating tools (drag seats, auto seat, drag-and-fill, arrange by row) | Done | Thamsan, Thifshana, Kalai |
| Auto-fill seating across blocks + CSV seating import | Done | Thifshana, Danuharan, Thamsan |
| Bulk apply seating (shape-family match across similar blocks) | Done | Kalai, Thamsan |
| Block hover tooltip (seat / capacity summary on canvas) | Done | Danuharan |
| Dining & table planning (8 templates, service routes, floor-plan image detect) | Done | Thifshana |
| General Admission block flow | Done | Thamsan |
| Parking layouts (standalone 2D designer + Supabase templates) | Done | Thamsan |
| Layers panel (visibility, lock, z-order) | Done | Kalai |
| Unified seat chair graphic | Done | Danuharan |
| Layer Ring sector editor | Done | Danuharan |
| TanStack Query template caching | Done | Kalai |
| Upload Image start panel (venue start chooser) | Stub | — |
| Private suite / merchandise / 3rd party shop workspaces | Not started | — |

**Team:** Kalai (Kalaimakan), Thifshana, Thamsan (Thamsan2002), Danuharan

---

## Clone and run

```bash
npm install
ng serve
# http://localhost:4200
```

**Requirements:** Node.js 20+, npm 10+

**Auth:** Supabase email/password login at `/login`. Protected routes use `authGuard`.

**Supabase setup (first time):**
1. Run `supabase/migrations/001_ovl_initial_schema.sql` in Supabase SQL Editor
2. Run `supabase/migrations/002_ovl_block_config_templates.sql` (block config templates for seating/dining/GA)
3. Run `supabase/migrations/003_ovl_parking_layout_templates.sql` (parking layouts linked to venue templates)
4. Create a test user in **Authentication → Users** (auto-confirm email)
5. Credentials live in `src/environments/environment.ts` (publishable key only — no service-role key in Angular)
6. Edge Function `analyze-blueprint` needs Azure OCR secrets; blueprint **audit/verify** also needs `OPENROUTER_API_KEY`

---

## Coding Standards (All Devs)

### Must follow
1. **Comments in English** — JSDoc on public service methods; explain non-obvious logic
2. **`ChangeDetectionStrategy.OnPush`** on every component
3. **Signals** for state (`signal()`, `computed()`, `input()`, `output()`)
4. **Standalone components** — no NgModules
5. **Lazy routes** for every feature
6. **`trackBy`** on all lists
7. **No `any`** — use proper interfaces from `src/app/models/`
8. **Feature folder structure:**
   ```
   features/my-feature/
   ├── pages/
   ├── components/
   ├── services/
   └── my-feature.routes.ts
   ```

### Comment example
```typescript
/**
 * Converts AI detection results into layout elements and applies them to the canvas.
 * Detections with accepted=false are skipped.
 * Called after the user clicks "Approve & Apply" on the AI review screen.
 */
applyDetections(detections: AiDetectionResult[]): void {
  // Filter out rejected detections before mapping to layout elements
  const accepted = detections.filter((d) => d.accepted);
  ...
}
```

### Performance rules (designer especially)
- Only render canvas elements inside the current viewport
- Debounce save operations (500ms)
- Avoid re-creating Konva shapes on every signal change — patch existing nodes

---

## Git Workflow

```bash
git clone [Repo_name]
git pull
git checkout -b feature/your-change-name
# work...
ng build
git add .
git commit -m "feat(scope): short description"
git push -u origin feature/your-change-name
```

Open a PR to the `develop` branch.

---

## Project Changes Log

> **Every dev updates this** when a feature or change is complete.  
> **Rule:** Put **your name in the title** — e.g. `(Kalai)`. Newest entry at the top.  
> Teammates clone → read this file → know what is already built before starting work.

---

### Template (copy for your entry)

```markdown
### [YYYY-MM-DD] — [Short title] ([Your Name])

**What changed:**
- ...

**Files / folders:**
- `path/to/file`

**How to test:**
1. ...

**Notes:**
- ...
```

---

### Entries

### 2026-07-23 — Blueprint audit polish + block detection accuracy (Kalai, Danuharan)

**What changed:**
- **Block detection** — pitch isolation, aspect-ratio checks, and contour/flood-fill refinements so stadium blocks align better with the blueprint (`detect-blocks.ts`)
- **Blueprint audit** — verify detected blocks against the real blueprint via OpenRouter vision; issue types: `missing`, `split`, `merged`, `misnamed`, `extra`, `malformed`
- **Audit panel UX** — issue tracking, fix/accept workflow, selection suppression while reviewing, friendly errors (credits / auth / rate-limit)
- **Edge Function** — `verifyBlocks` path + `normalize-verify.ts` / `verify-prompt.ts`; OpenRouter timeout/retry hardening (`openrouter.ts`)

**Files / folders:**
- `src/app/features/layout-designer/lib/detect-blocks.ts`
- `src/app/features/layout-designer/lib/audit-overlay.ts`
- `src/app/features/layout-designer/services/blueprint-audit.service.ts`
- `src/app/features/layout-designer/components/blueprint-audit-panel/`
- `supabase/functions/analyze-blueprint/` (`index.ts`, `openrouter.ts`, `normalize-verify.ts`, `verify-prompt.ts`)

**How to test:**
1. AI Layout Detection → analyze a stadium blueprint → Generate Layout
2. Open **Blueprint audit / verify** → run check → review missing / malformed / split issues
3. Click an issue → canvas focuses the affected region; fix or accept
4. Re-verify after edits → accuracy % should improve

**Notes:**
- Audit needs `OPENROUTER_API_KEY` on the Edge Function; OCR-only analyze still works with Azure secrets alone
- Model pinned toward Flash 2.5 for verify (see Thamsan 2026-07-14 note)

---

### 2026-07-21 — Auto trace fill + pitch isolation (Kalai)

**What changed:**
- **Auto trace fill** — colour-detect / flood-fill can auto-complete traced block regions more reliably after pitch isolation
- Removed fragile `reclaimBorders` path; aspect-ratio filters tightened so pitch vs seating regions separate cleanly

**Files / folders:**
- `src/app/features/layout-designer/lib/detect-blocks.ts`
- `src/app/features/layout-designer/lib/flood-fill.ts`
- `src/app/features/layout-designer/layout-designer.page.ts`

**How to test:**
1. Upload blueprint → enable trace / colour detect
2. Click coloured seating regions → blocks should fill without swallowing the pitch
3. Pitch/centerpiece stays isolated from stand polygons

---

### 2026-07-18 — Seating engine polish: drag seats + arrange-by-row + padding (Kalai)

**What changed:**
- Multiple **drag-seats** stability passes (row depth, border padding, multi-segment placement)
- **Arrange by row** measurement prompt fixed when side lengths are needed
- Seat placement keeps clearer edge padding so chairs don’t clip block borders
- “Seating fully fixed” pass for repeated re-arrange / n-times apply bugs

**Files / folders:**
- `src/app/features/layout-designer/lib/drag-seats.ts`
- `src/app/features/layout-designer/lib/arrange-by-row.ts`
- `src/app/features/layout-designer/lib/custom-shape-seats.ts`
- `src/app/features/layout-designer/services/layout-canvas.service.ts`

**How to test:**
1. Customize seating block → Drag seats → fill inward; re-enter and re-arrange
2. Arrange by row → if measurements asked, enter lengths → rows place correctly
3. Chairs stay inside polygon with visible border gap

---

### 2026-07-16 — Dining from floor-plan image + table-document tools (Thifshana)

**What changed:**
- **3rd dining option** — upload a dining floor-plan image; browser CV (`detect-dining-layout.ts`) finds tables / chairs / stage-like regions and builds layout (`dining-image-to-layout.ts`)
- Reference image stored on the dining block for alignment while editing
- **Auto create table** / table-document flow — parse dining specs + sample floor-plan assets
- Inspector + canvas render tables placed from image detection

**Files / folders:**
- `src/app/features/layout-designer/lib/detect-dining-layout.ts`
- `src/app/features/layout-designer/lib/dining-image-to-layout.ts`
- `src/app/features/layout-designer/lib/dining-reference-image.ts`
- `src/app/features/layout-designer/lib/parse-dining-spec.ts`
- `src/app/features/layout-designer/models/dining-spec.model.ts`
- `src/app/features/layout-designer/services/dining-spec-analyzer.service.ts`
- `src/app/features/layout-designer/components/inspector-panel/`
- `public/samples/dining-floor-plan-reference.*`, `public/samples/auto-table-spec-example.*`

**How to test:**
1. Dining block → choose floor-plan / image option → upload PNG/JPG/WEBP/SVG
2. Analyze → tables + chairs appear on canvas aligned to reference image
3. Save block config → reopen → image-backed layout restores

**Notes:**
- Merged via PR `#26` (`table-document`) around 2026-07-20

---

### 2026-07-16 — BlueprintAuditService + verify Edge Function (Kalai)

**What changed:**
- First full **BlueprintAuditService** + **BlueprintAuditPanel** for post-AI accuracy review
- Edge Function verification/error handling refactor; Deno/VS Code support for local function editing
- Selection suppression + UI focus while stepping through audit issues

**Files / folders:**
- `src/app/features/layout-designer/services/blueprint-audit.service.ts`
- `src/app/features/layout-designer/components/blueprint-audit-panel/`
- `supabase/functions/analyze-blueprint/`

**How to test:**
1. After AI generate → open audit panel → Run verify
2. Issues list shows Type-2 (split/merged/misnamed/extra) and Type-3 (missing)
3. Selecting an issue highlights the canvas region

---

### 2026-07-13 / 14 — Bulk apply seating + shape-family match (Kalai, Thamsan)

**What changed:**
- **Bulk apply seating modal** — after seating one block, offer to copy the same plan onto similar empty blocks
- **Shape-family matching** (`block-shape-match.ts`) — geometry similarity so only compatible blocks are selectable
- Remap / regenerate seating snapshots onto target polygons (`remap-seating-snapshot.ts`, `bulk-seating-regenerate.ts`)
- Conflict cleared when multiple blocks share one seating plan; Flash 2.5 pinned for vision where used

**Files / folders:**
- `src/app/features/layout-designer/components/bulk-apply-seating-modal/`
- `src/app/features/layout-designer/lib/block-shape-match.ts`
- `src/app/features/layout-designer/lib/bulk-seating-regenerate.ts`
- `src/app/features/layout-designer/lib/remap-seating-snapshot.ts`
- `src/app/features/layout-designer/lib/bulk-seating-apply.spec.ts`
- `src/app/features/layout-designer/services/layout-canvas.service.ts`

**How to test:**
1. Seat one custom block → save / finish seating
2. Bulk-apply modal lists similar blocks → select targets → Apply
3. Targets get remapped seats facing pitch; already-seated / dissimilar blocks stay skipped

---

### 2026-07-13 — Seating mouse-hover panel (Danuharan)

**What changed:**
- Canvas **hover tooltip** on blocks — shows seating / capacity summary while pointer is over a block
- UI/UX polish for quick inspection without opening the inspector

**Files / folders:**
- `src/app/features/layout-designer/components/canvas-stage/canvas-stage.component.{ts,html}`
- `src/app/features/layout-designer/lib/block-location-preview.ts` (related preview helpers)
- `src/tailwind.css`

**How to test:**
1. Open a layout with seated blocks
2. Hover a block on canvas → tooltip shows seat / capacity info near cursor
3. Move away → tooltip clears

**Notes:**
- Merged via PR `#21` (`Seating_Mouse_Hover_Panel`)

---

### 2026-07-08 — Auto-fill seating + CSV import (Thifshana, Danuharan, Thamsan)

**What changed:**
- **Auto-fill seating** in block workspace — batch-fill eligible custom blocks toward the pitch (`auto-fill-seating.ts`, measurements helpers)
- Colour-match deselect, exit handling, alignment, and workplace Autofill panel UX
- **CSV seating import** — upload CSV (block code + rows/cols or capacity); VIEW POINT aimed at pitch; conflict UI when seats don’t fit (`seating-import-panel`, `import-seating.ts`)
- Early **missing-block / accuracy suggestion** groundwork (feeds later audit panel)

**Files / folders:**
- `src/app/features/layout-designer/lib/auto-fill-seating.ts`
- `src/app/features/layout-designer/lib/auto-fill-measurements.ts`
- `src/app/features/layout-designer/models/auto-fill-seating.model.ts`
- `src/app/features/layout-designer/components/seating-import-panel/`
- `src/app/features/layout-designer/lib/import-seating.ts`
- `src/app/features/layout-designer/lib/parse-seating-import-file.ts`
- `src/app/features/layout-designer/lib/stadium-ground.ts`
- `src/app/features/layout-designer/lib/infer-ground-viewpoint.ts`
- `src/app/features/layout-designer/components/block-workspace-sidebar/`

**How to test:**
1. After AI layout → Autofill panel → set chair/gap → run auto-fill on selected blocks
2. Or open **CSV import** → drop sample CSV → resolve any shortfall conflicts → seats appear per block code
3. Deselect colour-matched blocks → they are skipped on next fill

---

### 2026-07-07 — Parking layouts standalone designer (Thamsan)

**What changed:**
- **Parking** as a separate 2D canvas (not embedded in stadium `layout_config`)
- New routes/page: parking layout designer with workspace sidebar + stepper
- Supabase table `parking_layout_templates` linked to venue via `venue_layout_template_id` (migration `003`)
- Parking draw tools (`parking-shape.ts`) + template service / TanStack query keys

**Files / folders:**
- `src/app/features/parking-layouts/parking-layout-designer.page.{ts,html}`
- `src/app/features/layout-designer/components/parking-workspace-sidebar/`
- `src/app/features/layout-designer/components/parking-workspace-stepper/`
- `src/app/features/layout-designer/lib/parking-shape.ts`
- `src/app/features/venue-layouts/services/parking-template.service.ts`
- `src/app/core/models/parking-layout-template.model.ts`
- `supabase/migrations/003_ovl_parking_layout_templates.sql`
- `src/app/features/venue-layouts/venue-layouts.page.{ts,html}` (entry points)

**How to test:**
1. Run migration `003_ovl_parking_layout_templates.sql`
2. Venue Layouts → open a venue → create / edit a **Parking** layout
3. Draw parking areas → name required → Save → reload from library

**Notes:**
- One venue can have multiple parking layouts (one-to-many)

---

### 2026-07-07 — Dining table-plan step process (Thifshana)

**What changed:**
- Improved step flow for table-plan layouts in the dining block workspace (clearer wizard sequencing before later image-detect option)

**Files / folders:**
- `src/app/features/layout-designer/components/block-workspace-sidebar/`
- `src/app/features/layout-designer/components/inspector-panel/`

**How to test:**
1. Dining block → walk configure → table planning steps in order
2. Sidebar / inspector steps stay consistent on narrow screens

---

### 2026-07-06 — Drag-seats row depth + seating lock polish (Kalai)

**What changed:**
- **Drag-seats integration** — `drag-seats.ts` wired deeply into block workspace: viewpoint-frame seating, interactive row depth resolution, preserving existing seat overrides when re-arranging
- **Interactive seating lock** — `interactiveSeatingLocked` flag prevents accidental seat edits after leaving block workspace
- **Row label visibility** — double-click row labels on canvas to toggle show/hide
- **Edge frame calculations** — refactored seat arrangement math for more accurate row placement inside custom polygons

**Files / folders:**
- `src/app/features/layout-designer/lib/drag-seats.ts`
- `src/app/features/layout-designer/lib/custom-shape-seats.ts`
- `src/app/features/layout-designer/components/canvas-stage/canvas-stage.component.{ts,html}`
- `src/app/features/layout-designer/components/inspector-panel/inspector-panel.component.{ts,html}`
- `src/app/features/layout-designer/services/layout-canvas.service.ts`

**How to test:**
1. Open a custom piece → **Customize block** → seating flow → **Drag seats**
2. Fill rows inward from viewpoint side → confirm row depths resolve correctly
3. Re-enter workspace and re-arrange → existing manual seat overrides should be preserved
4. Double-click a row label → label toggles visibility
5. Exit workspace → seats should be locked from accidental drag

**Notes:**
- `drag-seats.ts` is the core seating engine (~2000+ lines); shared by Thamsan, Thifshana, and Kalai's seating tools

---

### 2026-07-06 — Unified seat chair graphic (Danuharan)

**What changed:**
- **Seat shape fix** — consistent top-down theater chair SVG across all seating tools and layout preview
- Chair graphic shows backrest, armrests, cushion, and clear facing direction
- New reusable `SeatChairGraphicComponent` replaces ad-hoc seat dots in canvas and preview

**Files / folders:**
- `src/app/features/layout-designer/components/seat-chair-graphic/seat-chair-graphic.component.ts`
- `src/app/features/layout-designer/lib/chair-seat-icon.ts`
- `src/app/features/layout-designer/lib/seat-chair-view.ts`
- `src/app/features/layout-designer/components/canvas-stage/canvas-stage.component.ts`
- `src/app/features/venue-layouts/components/layout-preview/layout-preview.component.ts`

**How to test:**
1. Add seats via any seating tool (drag seats, auto seat, drag-and-fill)
2. Chairs should render with consistent shape and facing direction on canvas
3. Save template → library card preview shows same chair graphic

---

### 2026-07-06 — Dining 2D canvas properties + delete exit (Thifshana)

**What changed:**
- **2D dining properties on canvas** — SVG layers for dining stage, food-prep area, exit, service routes, and tables with chair arcs
- **Delete exit** — remove or reposition dining exit from inspector panel
- Dining elements now render as proper 2D shapes (not placeholder dots)

**Files / folders:**
- `src/app/features/layout-designer/components/canvas-stage/canvas-stage.component.html`
- `src/app/features/layout-designer/components/inspector-panel/inspector-panel.component.html`
- `src/app/features/layout-designer/lib/dining-stage.ts`
- `src/app/features/layout-designer/lib/dining-table-icon.ts`
- `src/app/features/layout-designer/lib/dining-service-routes.ts`

**How to test:**
1. Custom piece → **Customize block** → **Dining & Table** flow
2. Apply a dining layout template → stage, food prep, tables, service routes render on canvas
3. Inspector → delete exit → exit removed from canvas

---

### 2026-07-05 — Dining layout template enhancement (Thifshana)

**What changed:**
- Improved **8 auto-generated dining patterns** (`pattern-a` … `pattern-h`): grid, staggered, banquet with stage/food-prep/exit/service-route placement
- Better recipe generation, overlap validation, and inspector UX for template picker
- Table count grid modes and access categories refined

**Files / folders:**
- `src/app/features/layout-designer/lib/dining-layout-templates.ts`
- `src/app/features/layout-designer/lib/dining-stage.ts`
- `src/app/features/layout-designer/lib/dining-tables.ts`
- `src/app/features/layout-designer/components/inspector-panel/inspector-panel.component.{ts,html}`
- `src/app/features/layout-designer/services/table-category.service.ts`

**How to test:**
1. Dining block workspace → **Create & Arrange tables** → pick category → generate layout patterns
2. Apply a pattern → tables, stage, food prep placed without overlaps
3. Try different patterns (A–H) → each produces distinct spatial arrangement

---

### 2026-07-04 — Block workspace side labels + row visibility (Kalai)

**What changed:**
- **Side labeling** — block workspace sidebar shows per-side label cards with editable names
- **Block label bug fixes** — corrected label positioning and interaction on canvas
- **Row label double-click** — toggle row label visibility directly on canvas (see also 2026-07-06 entry)

**Files / folders:**
- `src/app/features/layout-designer/components/block-workspace-sidebar/block-workspace-sidebar.component.{ts,html}`
- `src/app/features/layout-designer/lib/block-label.ts`
- `src/app/features/layout-designer/models/block-type.model.ts`
- `src/app/features/layout-designer/components/canvas-stage/canvas-stage.component.{ts,html}`

**How to test:**
1. Customize block → configure sides → each side shows label card in sidebar
2. Edit side label → canvas label updates
3. Double-click row label on canvas → toggles visibility

---

### 2026-07-03 — General Admission block flow (Thamsan)

**What changed:**
- New **`general-admission`** block type with dedicated 4-step GA flow (no viewpoint, no individual seats):
  1. **Configure sides** — click side on canvas → label + length in metres
  2. **Max participants** — capacity-based ticketing
  3. **Save** — config persisted to Supabase block config templates
- Six block types defined in `block-type.model.ts`: seating, general-admission, private-suite, dining-table, merchandise, third-party-shop
- GA uses side-label configure UI but skips seat/viewpoint tools

**Files / folders:**
- `src/app/features/layout-designer/models/block-type.model.ts`
- `src/app/features/layout-designer/components/block-workspace-sidebar/block-workspace-sidebar.component.{ts,html}`
- `src/app/features/layout-designer/components/block-workspace-stepper/block-workspace-stepper.component.{ts,html}`
- `src/app/features/layout-designer/services/layout-canvas.service.ts`
- `src/app/features/layout-designer/models/layout-element.model.ts` (`gaConfiguredSides`, `gaMaxParticipants`)
- `supabase/migrations/002_ovl_block_config_templates.sql`

**How to test:**
1. Custom piece → **Customize block** → select **General Admission**
2. Click each side on canvas → enter label + length → confirm
3. Enter max participants → save
4. Block shows capacity label on canvas (no seat dots)

**Notes:**
- Private suite, merchandise, 3rd party shop types are defined but workspace tools not built yet

---

### 2026-07-03 — Dining planning improvements (Thifshana)

**What changed:**
- **Dining features** — stage placement, food-prep area, exit placement, auto table grid with overlap checks
- **Table counts** — improved table count grid modes and capacity estimates
- **Dining template styles** — inspector panel layout for dining wizard flow

**Files / folders:**
- `src/app/features/layout-designer/lib/dining-layout-templates.ts`
- `src/app/features/layout-designer/lib/dining-stage.ts`
- `src/app/features/layout-designer/lib/dining-tables.ts`
- `src/app/features/layout-designer/components/block-workspace-sidebar/block-workspace-sidebar.component.{ts,html}`
- `src/app/features/layout-designer/components/inspector-panel/inspector-panel.component.{ts,html}`
- `src/tailwind.css` (dining template styles)

**How to test:**
1. Dining block → configure sides → add tables via wizard
2. Place stage, food prep, exit → verify no table overlaps
3. Table count grid → capacity updates in sidebar

---

### 2026-07-03 — AI blueprint spec + interactive block layer (Kalai)

**What changed:**
- **Blueprint upload spec** — documented resolution/file-size guidance for AI uploads (`blueprint-image-spec.ts`); tooltips in upload panel
- **Interactive block layer** — clickable traced-block layer on canvas with improved pointer event handling
- Traced blocks from colour-detect or manual trace are selectable and editable on canvas

**Files / folders:**
- `src/app/features/layout-designer/lib/blueprint-image-spec.ts`
- `src/app/features/layout-designer/layout-designer.page.{ts,html}`
- `src/app/features/layout-designer/components/canvas-stage/canvas-stage.component.{ts,html}`

**How to test:**
1. AI panel → upload blueprint → tooltip shows recommended image specs
2. After trace/analyze → click individual blocks on canvas → block selects and opens inspector

---

### 2026-07-02 — Viewpoint edge styling + seat placement (Kalai)

**What changed:**
- **Viewpoint edges** — green VIEW POINT edge styling on canvas; confirmed side label shown in block workspace sidebar
- Inspector clarifies seat arrangement relative to viewpoint side
- Streamlined seat placement service methods

**Files / folders:**
- `src/app/features/layout-designer/lib/block-viewpoint.ts`
- `src/app/features/layout-designer/lib/block-label.ts`
- `src/app/features/layout-designer/components/block-workspace-sidebar/block-workspace-sidebar.component.{ts,html}`
- `src/app/features/layout-designer/components/inspector-panel/inspector-panel.component.{ts,html}`
- `src/app/features/layout-designer/services/layout-canvas.service.ts`
- `src/tailwind.css` (viewpoint edge styles)

**How to test:**
1. Seating block → set VIEW POINT on a side → edge turns green on canvas
2. Sidebar shows confirmed viewpoint side label
3. Drag seats inward from viewpoint → rows fill correctly toward center

---

### 2026-07-02 — Advanced table planning + categories (Thifshana)

**What changed:**
- **Table categories** — save/reuse table dimension presets in `localStorage` via `TableCategoryService`
- **Advanced planning** — table-count grid modes, access categories, service route drawing between tables
- **Dining layout templates** — initial 8 auto-generated spatial recipes (`pattern-a` … `pattern-h`)

**Files / folders:**
- `src/app/features/layout-designer/services/table-category.service.ts`
- `src/app/features/layout-designer/models/table-category-template.model.ts`
- `src/app/features/layout-designer/services/block-config-template.service.ts`
- `src/app/features/layout-designer/lib/dining-layout-templates.ts`
- `src/app/features/layout-designer/lib/dining-service-routes.ts`
- `src/app/features/layout-designer/components/block-workspace-sidebar/block-workspace-sidebar.component.{ts,html}`

**How to test:**
1. Dining block → create table category preset → save → reuse on next block
2. Generate layout pattern → apply → tables placed per recipe
3. Draw service routes between table groups

---

### 2026-07-01 — Zoom buttons + trace OCR + multi-side measure (Kalai)

**What changed:**
- **Zoom buttons** — toolbar + floating +/- buttons with hold-to-repeat; click percentage to reset to 100%; block workspace caps zoom at 800%
- **Trace mode + OCR labeling** — trace panel UI; OCR tokens cached from uploaded blueprint and matched to manually traced blocks for auto-labeling
- **Multi-side measurement** — enter all side lengths at once during configure step (not one-at-a-time)
- **Template card UX** — dark-mode hover states for delete/confirm buttons on venue layouts page

**Files / folders:**
- `src/app/features/layout-designer/layout-designer.page.{ts,html}`
- `src/app/features/layout-designer/services/layout-canvas.service.ts`
- `src/app/features/layout-designer/lib/assign-ocr-labels.ts`
- `src/app/features/layout-designer/services/blueprint-analyzer.service.ts`
- `src/app/features/layout-designer/components/block-workspace-sidebar/block-workspace-sidebar.component.{ts,html}`
- `src/app/features/layout-designer/components/inspector-panel/inspector-panel.component.{ts,html}`
- `src/tailwind.css`

**How to test:**
1. Canvas → use +/- zoom buttons; hold for repeat; click % to reset
2. Trace mode → trace blocks manually → OCR auto-labels from cached blueprint tokens
3. Block configure → enter all side lengths in one form
4. Venue layouts → delete card → hover shows clear confirm/cancel feedback

---

### 2026-07-01 — Element fixes + seat graphic component (Danuharan)

**What changed:**
- **Element fixes** — broad canvas/inspector/layers fixes across element types
- **SeatChairGraphicComponent** — unified seat rendering component introduced (refined in 2026-07-06 seat shape fix)
- Layout preview render updates for new seat graphics

**Files / folders:**
- `src/app/features/layout-designer/components/canvas-stage/canvas-stage.component.{ts,html}`
- `src/app/features/layout-designer/components/inspector-panel/inspector-panel.component.{ts,html}`
- `src/app/features/layout-designer/components/layers-panel/layers-panel.component.ts`
- `src/app/features/layout-designer/components/seat-chair-graphic/seat-chair-graphic.component.ts`
- `src/app/features/layout-designer/lib/chair-seat-icon.ts`
- `src/app/features/venue-layouts/lib/layout-preview-render.ts`

**How to test:**
1. Test each element type (center piece, layer ring, block grid, etc.) → render + inspector edit works
2. Seats show chair graphic (not plain dots)
3. Layers panel → visibility/lock toggles work for all element types

---

### 2026-07-01 — Tools fix 2: block labels + pointer behavior (Danuharan)

**What changed:**
- Block label interaction fixes on canvas
- Canvas-stage pointer/tool behavior corrections

**Files / folders:**
- `src/app/features/layout-designer/lib/block-label.ts`
- `src/app/features/layout-designer/components/canvas-stage/canvas-stage.component.ts`
- `src/tailwind.css`

**How to test:**
1. Select block with labels → click label on canvas → correct block selects
2. Drag/resize elements → pointer events don't conflict with label clicks

---

### 2026-07-01 — Table planning layout improvements (Thifshana)

**What changed:**
- Improved table planning workspace layout in block workspace sidebar
- Refined dining inspector flow and table placement UX

**Files / folders:**
- `src/app/features/layout-designer/components/block-workspace-sidebar/block-workspace-sidebar.component.{ts,html}`
- `src/app/features/layout-designer/components/inspector-panel/inspector-panel.component.{ts,html}`
- `src/tailwind.css`

**How to test:**
1. Dining block → table planning sidebar scrolls and lays out correctly on narrow screens
2. Table wizard steps are clearly labeled and navigable

---

### 2026-06-30 — Table panning workspace (Thifshana)

**What changed:**
- Improved table planning workplace layout and panning within dining block workspace
- Service route drawing groundwork

**Files / folders:**
- `src/app/features/layout-designer/components/block-workspace-sidebar/block-workspace-sidebar.component.{ts,html}`
- `src/app/features/layout-designer/lib/dining-service-routes.ts`

**How to test:**
1. Dining block workspace → pan around table layout area
2. Sidebar controls remain accessible while panning

---

### 2026-06-29 — Drag-and-fill seating + seating optimize (Thamsan)

**What changed:**
- **Drag and fill** — double-click seed seat, drag along row to fill, drag inward for multi-row auto-fill (`drag-fill-seats.ts`)
- **Seating optimize** — performance/UX polish for custom-shape seating + drag-fill
- **Seating tools** sidebar reorganized for clearer tool access

**Files / folders:**
- `src/app/features/layout-designer/lib/drag-fill-seats.ts`
- `src/app/features/layout-designer/lib/custom-shape-seats.ts`
- `src/app/features/layout-designer/components/inspector-panel/inspector-panel.component.{ts,html}`

**How to test:**
1. Custom piece with seats → inspector → drag-and-fill tool
2. Double-click a seat → drag along row → row fills
3. Drag inward → multiple rows auto-fill inside polygon

**Notes:**
- Drag-and-fill accessible via inspector methods; main tool-picker shows: Drag seats, Arrange by row, Auto seat create, Add seats one by one, Draw seat area manually

---

### 2026-06-29 — Table planning foundation (Thifshana)

**What changed:**
- **Basic table workspace** — dining block flow: viewpoint → configure sides → add tables
- Core dining libs: table placement, stage, table icons, physical dimensions
- `blockType === 'dining-table'` drives dedicated workspace UI

**Files / folders:**
- `src/app/features/layout-designer/components/block-workspace-sidebar/block-workspace-sidebar.component.{ts,html}`
- `src/app/features/layout-designer/lib/dining-tables.ts`
- `src/app/features/layout-designer/lib/dining-stage.ts`
- `src/app/features/layout-designer/lib/dining-table-icon.ts`
- `src/app/features/layout-designer/models/layout-element.model.ts`

**How to test:**
1. Custom piece → Customize block → **Dining & Table**
2. Configure sides → add tables → tables appear on canvas with chair arcs

---

### 2026-06-29 — Designer CSS/responsive refactor + scrollbar fix (Kalai)

**What changed:**
- Canvas height calculations, grid alignment, light/dark theme color polish
- Inspector behavior and component style refinements
- Scrollbar bug fixed on layout designer page

**Files / folders:**
- `src/app/features/layout-designer/layout-designer.page.{ts,html}`
- `src/app/features/layout-designer/components/canvas-stage/canvas-stage.component.{ts,html}`
- `src/tailwind.css`

**How to test:**
1. Open designer on various screen sizes → canvas fills available height
2. Light/dark toggle → grid, sidebar, inspector colors consistent
3. Long content → page scrolls correctly (no double scrollbar)

---

### 2026-06-26 — Block workspace scaffold + auto seat (Thamsan)

**What changed:**
- **Customize block overlay** — full 5-step stepper (type → VIEW POINT → configure → edit → save) replaces simple inspector for custom pieces
- **Six block types** defined; seating and dining-table have full workspace flows
- **Physical measurement edges** + viewpoint angle system
- **Auto seat create** — upload seating spec (image/PDF/TXT/SVG) → Azure OCR / local parser → preview rows×seats → apply
- **Drag seats** — initial 3-step wizard: side lengths + stadium-view side → chair size → drag inward to fill rows
- **Block config templates** — reusable seating/dining snapshots saved to Supabase (`002_ovl_block_config_templates.sql`)

**Files / folders:**
- `src/app/features/layout-designer/components/block-workspace-sidebar/` (new)
- `src/app/features/layout-designer/components/block-workspace-stepper/` (new)
- `src/app/features/layout-designer/models/block-type.model.ts`
- `src/app/features/layout-designer/models/block-config-template.model.ts`
- `src/app/features/layout-designer/lib/block-measure-edges.ts`
- `src/app/features/layout-designer/lib/block-viewpoint.ts`
- `src/app/features/layout-designer/lib/physical-dims.ts`
- `src/app/features/layout-designer/lib/drag-seats.ts`
- `src/app/features/layout-designer/lib/parse-seating-spec.ts`
- `src/app/features/layout-designer/lib/local-spec-file.ts`
- `src/app/features/layout-designer/models/seating-spec.model.ts`
- `src/app/features/layout-designer/services/block-config-template.service.ts`
- `src/app/features/layout-designer/services/seating-spec-analyzer.service.ts`
- `supabase/migrations/002_ovl_block_config_templates.sql`
- `public/samples/` (sample seating spec files)

**How to test:**
1. Draw custom piece → select it → **Customize block** button in inspector
2. Pick block type (Seating) → set VIEW POINT → configure side lengths → edit → save
3. Inspector seating tools → **Auto seat create** → upload spec file → preview → apply
4. **Drag seats** → follow 3-step wizard → drag inward to fill rows
5. Save block config → reload template → block config restores

---

### 2026-06-26 — Zoom controls + reference image canvas sizing (Kalai)

**What changed:**
- **Zoom controls** on designer toolbar (+/- buttons, percentage display)
- **Reference image canvas sizing** — canvas dynamically adjusts to match blueprint dimensions; geometry scaling for AI-detected layout alignment
- Toolbar restructured for clearer action/zoom organization

**Files / folders:**
- `src/app/features/layout-designer/layout-designer.page.{ts,html}`
- `src/app/features/layout-designer/services/layout-canvas.service.ts`
- `src/app/features/layout-designer/lib/canvas-image.ts`
- `src/app/features/layout-designer/lib/fit-layout-geometry.ts`
- `src/app/features/layout-designer/components/canvas-stage/canvas-stage.component.{ts,html}`
- `src/tailwind.css`

**How to test:**
1. Upload AI blueprint → canvas resizes to match image proportions
2. Generated blocks align with reference image background
3. Zoom +/- works; percentage shown in toolbar

---

### 2026-06-25 — TanStack Query + layers visibility/lock (Kalai)

**What changed:**
- **TanStack Query** (`@tanstack/angular-query-experimental`) for Supabase reads with client-side caching (5 min stale, 30 min GC)
- Venue layout list uses `injectQuery`; saves invalidate cache via `QueryClient`
- **Layers panel** — elements support `visible` and `locked` flags; eye/lock toggles, z-order up/down, delete
- **Pitch shape selection** — AI centerpiece can be rectangle, oval, or circle; improved contour tracing/simplification
- **Reference image** — geometry scaling, opacity, edge adjustment for custom shapes
- **Edge adjustment** options for custom shapes in inspector panel
- Removed obsolete `docs/AI_DETECTION_SETUP.md` (replaced by inline trace mode)

**Files / folders:**
- `src/app/core/query/query-client.config.ts`
- `src/app/app.config.ts`
- `src/app/features/venue-layouts/venue-layouts.page.ts`
- `src/app/features/layout-designer/components/layers-panel/layers-panel.component.{ts,html}`
- `src/app/features/layout-designer/lib/element-display.ts`
- `src/app/features/layout-designer/models/layout-element.model.ts`
- `src/app/features/layout-designer/lib/contour-geometry.ts`
- `src/app/features/layout-designer/lib/detect-blocks.ts`
- `src/app/features/layout-designer/lib/cv-to-layout.ts`
- `src/app/features/layout-designer/lib/canvas-image.ts`
- `src/app/features/layout-designer/services/layout-canvas.service.ts`

**How to test:**
1. Venue layouts page → templates load with caching (no flash on revisit within 5 min)
2. Designer → right sidebar **Layers** → toggle visibility/lock, reorder z-index
3. AI analyze → pick pitch shape (rectangle/oval/circle) → centerpiece matches
4. Custom shape inspector → edge adjustment controls work

---

### 2026-06-25 — Layer Ring sector editor (Danuharan)

**What changed:**
- Improved Layer Ring element rendering, sector seat editing, and preview
- New **sector block seat panel** for editing individual ring sectors
- Sector seat layout math refined

**Files / folders:**
- `src/app/features/layout-designer/components/sector-block-seat-panel/sector-block-seat-panel.component.{ts,html}`
- `src/app/features/layout-designer/lib/sector-seat-layout.ts`
- `src/app/features/layout-designer/lib/seat-layout.ts`
- `src/app/features/layout-designer/components/canvas-stage/canvas-stage.component.{ts,html}`
- `src/app/features/venue-layouts/lib/layout-preview-render.ts`
- `src/app/features/layout-designer/data/element-factory.ts`

**How to test:**
1. Add Layer Ring → configure sectors/rows/seats
2. Select a sector → sector seat panel opens for per-sector editing
3. Save → library preview shows ring with sector detail

---

### 2026-06-25 — Custom seating + seating tools categories + spacing (Thifshana)

**What changed:**
- **Custom seating plan** — locked seating zones inside custom pieces; physical dimensions; seat layout regeneration
- **Seating tools UI** — reorganized inspector into 3 tool categories; added **Arrange by row** and **Define by row/column** grid seating
- **Seat spacing configuration** — inspector "Configure seat & row spacing": chair width/depth (m), seat gap, row gap; affects capacity estimates

**Files / folders:**
- `src/app/features/layout-designer/lib/custom-shape-seats.ts`
- `src/app/features/layout-designer/lib/block-seat-layout.ts`
- `src/app/features/layout-designer/lib/physical-dims.ts`
- `src/app/features/layout-designer/lib/arrange-by-row.ts`
- `src/app/features/layout-designer/lib/define-by-row-column.ts`
- `src/app/features/layout-designer/lib/drag-seats.ts`
- `src/app/features/layout-designer/components/inspector-panel/inspector-panel.component.{ts,html}`
- `src/app/features/layout-designer/models/layout-element.model.ts`

**How to test:**
1. Custom piece → inspector → seating tools section shows categorized tools
2. Configure seat spacing → capacity estimate updates
3. **Arrange by row** → seats fill row-by-row inside shape
4. **Define by row/column** → grid seating with specified rows×cols

---

### 2026-06-25 — Colour detect trace mode + pitch shapes (Thamsan)

**What changed:**
- **Colour detection** — flood-fill on blueprint reference image (`colorDetectMode` + tolerance slider); click coloured regions to trace as custom 2D blocks
- **Trace panel** in layout designer — toggle trace mode, colour sensitivity slider (works with upload/AI flows)
- Foundation for manual block tracing alongside AI detection

**Files / folders:**
- `src/app/features/layout-designer/lib/flood-fill.ts`
- `src/app/features/layout-designer/lib/canvas-image.ts`
- `src/app/features/layout-designer/services/layout-canvas.service.ts` (`colorDetectMode`, `colorDetectTolerance`)
- `src/app/features/layout-designer/layout-designer.page.html` (trace panel)

**How to test:**
1. Upload blueprint as reference image → enable trace mode
2. Adjust colour sensitivity slider → click coloured region on image → block traced as custom polygon
3. Traced blocks appear on canvas and are editable

**Notes:**
- Kalai later added OCR auto-labeling for traced blocks (see 2026-07-01 entry)

---

### 2026-06-24 — AI Layout Detection: browser CV + Azure OCR + result UI (Kalai)

**What changed:**

**Stack (Phase 1 — approved Option A)**
- **Geometry in the browser** — coloured-region flood fill + contour tracing + polygon simplify (`detect-blocks.ts`, `contour-geometry.ts`). No Python/OpenCV server yet (Phase 2).
- **Labels from Azure OCR** — Supabase Edge Function `analyze-blueprint` with **`ocrOnly: true`** returns token polygons only (no OpenRouter/LLM in the live flow).
- **Merge** — `assign-ocr-labels.ts` assigns each OCR token to a block polygon via point-in-polygon; builds `CvAnalysisResult` with confidence + tier rings.
- **Apply** — `cv-to-layout.ts` converts detected blocks → `custom` centerpiece + stand label elements; chart image set as **canvas background** (`referenceImage` in layout config).

**Supabase Edge Function** (`supabase/functions/analyze-blueprint/`)
- `index.ts` — orchestration; supports `ocrOnly` mode and full LLM mode (legacy, not used in UI)
- `azure-ocr.ts` — Azure Document Intelligence OCR with coordinates
- `openrouter.ts`, `prompt.ts`, `normalize.ts` — full LLM pipeline (kept for future / fallback)
- Deploy: `npx supabase functions deploy analyze-blueprint --project-ref afpjzctfhtlsyqpsyzzt`
- Secrets (server-side only): `AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT`, `AZURE_DOCUMENT_INTELLIGENCE_KEY`  
  (`OPENROUTER_API_KEY` optional — not needed for current `ocrOnly` flow)

**Layout designer — AI panel flow** (`layout-designer.page.{ts,html}`)
1. **idle** — drop zone; optional “Remove from canvas” if chart already on canvas
2. **preview** — uploaded image thumbnail, “Include seats” checkbox, **✦ Analyze with AI**, Remove / Choose different image
3. **analyzing** — image preview (dimmed) + spinner + status text
4. **result** — prototype-style panel:
   - Venue title + confidence badge
   - Detection summary + model box (`client-cv · geometry detected`)
   - **Ground / Stage** — editable name + shape dropdown
   - **Seating Tiers** — dark-theme tier cards (`ai-tier-theme`): dot, editable name, tier code, block count, block list preview
   - **+ Add tier** (up to 6), **Generate Layout →**, **Re-analyze** / **New image**
5. **error** — message + Try again

**Canvas**
- `referenceImage` on `VenueLayoutConfig`; rendered behind grid in `canvas-stage`
- `LayoutCanvasService.setReferenceImage()`, `applyGeneratedElements()`

**UI polish**
- Full **page scroll** (no internal sidebar scroll on result panel)
- Tier cards + Add tier button use **dark theme** inside `ai-tier-theme` wrapper
- Re-analyze / New image compact single-line buttons

**Docs**
- `docs/AI_DETECTION_SETUP.md` — deploy + secrets guide (updated for `ocrOnly` pipeline)
- `docs/AI_LAYOUT_DETECTION_STACK.docx` — stack recommendation doc

**Files / folders:**
- `supabase/functions/analyze-blueprint/` (all handlers)
- `src/app/features/layout-designer/lib/contour-geometry.ts`
- `src/app/features/layout-designer/lib/detect-blocks.ts`
- `src/app/features/layout-designer/lib/assign-ocr-labels.ts`
- `src/app/features/layout-designer/lib/cv-to-layout.ts`
- `src/app/features/layout-designer/lib/ai-tier-groups.ts`
- `src/app/features/layout-designer/services/blueprint-analyzer.service.ts`
- `src/app/features/layout-designer/layout-designer.page.{ts,html}`
- `src/app/features/layout-designer/components/canvas-stage/canvas-stage.component.html`
- `src/app/features/layout-designer/services/layout-canvas.service.ts`
- `src/app/core/models/venue-layout-config.model.ts`
- `src/tailwind.css` (`.ai-tier-theme`, `.ai-status`, `.ai-result`, `.ai-btn--dashed`, etc.)
- `docs/AI_DETECTION_SETUP.md`

**How to test:**
1. Set Azure secrets in Supabase; deploy `analyze-blueprint` (see `docs/AI_DETECTION_SETUP.md`)
2. `ng serve` → login → **Venue Layouts** → **+ New blank layout**
3. Start → **AI Layout Detection** → upload stadium/seating chart (PNG/JPG/WEBP)
4. Confirm preview → **✦ Analyze with AI** → wait for tiers/blocks result
5. Edit tier names if needed → **Generate Layout →** → chart background + block polygons on canvas
6. Adjust polygons in Inspector; **Save as template**
7. `ng build` passes

**Notes:**
- **Do not** put API keys in `environment.ts` — Edge Function secrets only
- AI detection generates block polygons; seat generation inside blocks uses **block workspace seating tools** (drag seats, auto seat, drag-and-fill, etc.)
- Manual tier remove (✕) on tier cards is disabled; **+ Add tier** adds empty manual tier (max 6)
- `lib/blueprint-to-layout.ts` — old LLM ring converter; superseded by `cv-to-layout.ts` for current flow
- Upload Image / Blueprint start panel still stub (“coming soon”)
- **Trace mode** + colour detect available for manual block tracing (see 2026-06-25 Thamsan entry)
- Phase 2 option: Python OpenCV microservice for pixel-perfect polygons

---

### 2026-06-24 — Supabase templates: auth, save, library cards (Kalai)

**What changed:**
- **Supabase integration** — interim database (not prototype SQL / not prototype `.env`):
  - Migration `001_ovl_initial_schema.sql`: `profiles`, `venue_layout_templates`, RLS, `ovl_list_my_templates()` RPC, soft archive via `ovl_archive_template()`
  - `layout_config` JSONB validated (`version`, `canvas`, `elements`)
- **Core services:** `SupabaseService`, `AuthService`, `ToastService`, `authGuard`
- **Login page** at `/login`; admin routes require session
- **VenueTemplateService** — list / get / create / update / hard delete templates
- **Models:** `VenueLayoutConfig`, `VenueLayoutTemplateSummary`
- **LayoutCanvasService** — `exportLayoutConfig()`, `loadLayoutConfig()`, `resetSession()` (clears canvas + history)
- **Designer save flow:**
  - Footer: **Back** + **Save as template** (3D preview button removed)
  - **Template name required** — orange border + toast if save clicked without name
  - Save (new or edit) → toast → **auto redirect to `/venue-layouts`** (template library)
  - Edit route: `/venue-layouts/:id/edit` loads template from DB
  - **Bug fixes:** `paramMap` subscription (not snapshot only); `beginNewLayout()` resets singleton canvas on `/venue-layouts/new` (no stale data from previous session)
- **Venue Layouts library page** (prototype-style):
  - Header in dark rounded box: title, subtitle, **+ New blank layout**
  - **Your Templates** section lists saved templates as **individual cards**
  - Each card: SVG preview (`LayoutPreviewComponent` + `layout-preview-render.ts`), name, description, badges (blocks / seats / updated date), **Edit** + **Delete**
  - Delete: click → **Confirm delete?** → **Deleting…** → toast
  - Card sizing tuned: responsive grid (2 cols @ 900px, 3 @ 1280px), preview `min-height: 120px`, compact body text/buttons

**Files / folders:**
- `supabase/migrations/001_ovl_initial_schema.sql`
- `src/environments/environment.ts`
- `src/app/core/services/supabase.service.ts`, `auth.service.ts`, `toast.service.ts`
- `src/app/core/guards/auth.guard.ts`
- `src/app/core/models/venue-layout-config.model.ts`, `venue-layout-template.model.ts`
- `src/app/features/auth/login.page.*`
- `src/app/features/venue-layouts/venue-layouts.page.{ts,html}`
- `src/app/features/venue-layouts/services/venue-template.service.ts`
- `src/app/features/venue-layouts/components/layout-preview/`
- `src/app/features/venue-layouts/lib/layout-preview-render.ts`, `layout-stats.ts`
- `src/app/features/layout-designer/layout-designer.page.{ts,html}`
- `src/app/features/layout-designer/services/layout-canvas.service.ts`
- `src/app/app.routes.ts`
- `src/tailwind.css` (template cards, designer footer, toasts)

**How to test:**
1. Run migration SQL in Supabase; create + confirm a test user
2. `ng serve` → `/login` → sign in
3. **Venue Layouts** → **+ New blank layout** → add elements → enter **template name** → **Save as template**
4. Should land on `/venue-layouts` with new card (preview, block/seat counts, date)
5. **Edit** opens designer with saved layout; save again → back to library
6. **Delete** → confirm → card removed
7. **+ New blank layout** again → canvas empty (no previous layout bleed-through)
8. `ng build` passes

**Notes:**
- Undo/redo history is **session-only** (not persisted to DB)
- ~~AI / upload start panels still stub (“coming soon”)~~ → **AI Layout Detection done** (see entry above); Upload panel still stub
- ~~Seats inside custom shape — button only~~ → **done** — block workspace seating tools (see 2026-06-26+ entries)
- Do **not** commit service-role keys; publishable key + RLS only in Angular
- Template list uses **TanStack Query** caching (see 2026-06-25 entry)

---

### 2026-06-24 — Infinite canvas: full dot grid + camera pan/zoom (Kalai)

**What changed:**
- Replaced fixed `1000×700` viewBox + inner scale transform with **dynamic viewBox** driven by camera centre + zoom (prototype pattern).
- **Dot grid fills the entire visible canvas** at any zoom level — no more small grid box in the centre with empty dark borders.
- **Infinite pan workspace:** grid extends beyond the viewport (`getVisibleGridBounds`); middle-mouse drag moves the camera so shapes can be placed/moved anywhere.
- `panX` / `panY` transform removed → `cameraX` / `cameraY` on `LayoutCanvasService`; `resetView()` resets zoom + camera to artboard centre.
- Coordinate hit-testing (`toCanvasPx`, drag delta) updated to use SVG root CTM (no nested viewport transform).
- Drawing hint updated: middle-click drag to pan.

**Files / folders:**
- `src/app/features/layout-designer/lib/canvas-grid.ts` (new)
- `src/app/features/layout-designer/services/layout-canvas.service.ts`
- `src/app/features/layout-designer/components/canvas-stage/canvas-stage.component.{ts,html}`
- `src/tailwind.css` (`.canvas-stage-grid`)

**How to test:**
1. Open `/venue-layouts/new` → add a shape
2. Zoom out (50%) → dots should still cover the **full** canvas area
3. Middle-mouse drag → pan around; dots stay visible in all directions
4. Drag a shape far from centre → it stays editable
5. `ng build` passes

**Notes:**
- Artboard logical size remains `1000×700` for `%` geometry; camera can view beyond that box.

---

### 2026-06-24 — Undo / Redo / Delete keyboard shortcuts fix (Kalai)

**What changed:**
- **Keyboard shortcuts** on canvas (ignored when focus is in input/textarea/select):
  - `Ctrl+Z` → undo
  - `Ctrl+Shift+Z` → redo
  - `Delete` / `Backspace` → delete **selected element only** (not the whole canvas)
- **History bug fixed:** snapshots now use `structuredClone` so undo/redo does not corrupt shared array references.
- **Gesture history:** drag / rotate / resize / custom-vertex drag use `beginGesture()` + `commitGesture()` — history recorded only when something actually changed (no duplicate entries on click-without-move).
- Selection cleared after undo/redo if the selected element no longer exists.
- Toolbar **Undo** / **Redo** buttons and Inspector **Delete** button use the same fixed service logic.

**Files / folders:**
- `src/app/features/layout-designer/services/layout-canvas.service.ts`
- `src/app/features/layout-designer/components/canvas-stage/canvas-stage.component.ts`

**How to test:**
1. Add 2–3 shapes → select one → press **Delete** → only that shape removes
2. **Ctrl+Z** undoes last action; **Ctrl+Shift+Z** redoes
3. Click a shape without moving → repeated **Ctrl+Z** should not wipe the whole canvas
4. Inspector **Delete** button removes selected element
5. Type in Inspector name field → Backspace edits text (does not delete shape)

**Notes:**
- Inspector field edits still call `update()` per keystroke (follow-up: debounce / `updateSilent` for typing).

---

### 2026-06-24 — Custom Piece polish: inspector, vertex edit, bbox resize (Kalai)

**What changed:**
- **Custom Piece draw flow** (prototype-faithful):
  - Sidebar click → crosshair only; no empty box until shape is finished
  - Click points on canvas → line / polygon preview; double-click or **Enter** to finish (min 3 points); **Esc** to cancel
  - On finish → draw mode closes, new shape stays **selected**
- **Custom Piece inspector** (matches prototype screenshots):
  - Header: Custom Piece, **Duplicate**, **Delete**
  - **Custom draw** — instructions, point count, Draw another outline, Clear shape, Quick shape builder (+/− segments)
  - **Seats inside shape** — opens block workspace seating tools (drag seats, auto seat, arrange by row, etc.)
  - **Element name**, **Label**, **Position & size** (X/Y/Width/Height %, Rotation °), **Colors** (fill + label)
  - Inspector also shows **Finish / Cancel** while actively drawing
- **Canvas selection overlay** (all selected elements):
  - Dashed bbox, **8 resize handles** (4 corners + 4 edges), move handle, rotate handle
  - **Rotation-aware resize cursors** — cursor direction follows element rotation on screen
  - **Bug fix:** bottom-left (`sw`) resize handle was at wrong Y (overlapped top-left); now at correct corner
- **Custom shape vertex handles** — blue/white circles at each polygon corner; drag to reshape (hand/grab cursor)
- **Resize math** — `lib/resize.ts`: corner drag fixes opposite corner; edge drag fixes opposite edge; works with rotation
- **Custom shape helpers** — `lib/custom-shape.ts`: renormalize outline, quick shape builder, local ↔ canvas point conversion
- **Service** — `finishDrawing` on existing element, `clearCustomShape`, `generateQuickShape`, `updateCustomVertexSilent`, `duplicateSelected`, gesture undo on drag/rotate/resize/vertex
- **Docs** — `docs/Add-Element-Architecture.docx` (3 approaches: hardcode vs DB vs registry; recommends registry pattern)

**Files / folders:**
- `src/app/features/layout-designer/lib/custom-shape.ts` (new)
- `src/app/features/layout-designer/lib/resize.ts` (new)
- `src/app/features/layout-designer/components/canvas-stage/canvas-stage.component.{ts,html}`
- `src/app/features/layout-designer/components/inspector-panel/inspector-panel.component.{ts,html}`
- `src/app/features/layout-designer/services/layout-canvas.service.ts`
- `src/app/features/layout-designer/data/element-factory.ts`
- `src/tailwind.css` (inspector sections, vertex/resize handle styles)
- `docs/Add-Element-Architecture.docx`
- `scripts/generate-add-element-doc.py`

**How to test:**
1. Venue Layouts → **+ New blank layout**
2. Click **Custom Piece** → crosshair on canvas; click 3+ points → double-click or Enter → shape selected, inspector full panel
3. Drag **−** circles on corners → reshape polygon; hover shows hand cursor
4. Drag **white square** bbox corners → scale whole shape; drag side handles → width/height only
5. **Rotate** shape → hover each handle → resize cursor matches handle direction on screen
6. Inspector: Quick shape +/−, Clear shape, Duplicate, Position & size, Colors
7. `ng build` passes

**Notes:**
- Architecture doc: element **types** in code registry; placed **instances** in layout JSON only
- ~~Save to mock API / localStorage still pending~~ → **done** — see **2026-06-24 Supabase templates** entry

---

### 2026-06-23 — Working 2D designer canvas: all elements render + edit (Kalai)

**What changed:**
- Real **SVG canvas** that renders, selects, drags, zooms, and pans — no drawing library (pure browser SVG + TypeScript math), faithful to the prototype.
- All elements now actually work on the canvas:
  - **Center Piece** — oval / circle / rectangle / square / hexagon / octagon / D-end + curve + label
  - **Custom Piece** — point-by-point drawing on canvas (double-click / Enter to finish, Esc to cancel)
  - **Layer Ring** — annular ring with sector blocks + seats; sectors / rows / seats editable
  - **Layer Rect** — rectangular ground with 4-side framed blocks + seats; add/remove block per side
  - **Block Grid** — rows × seats grid with row labels + seat dots
  - **Seat Section** — per-row seats with independent curve / count; add/remove rows
  - **Aisle** — striped walkway (orientation toggle)
  - **Label** — free text (size / weight / align)
  - **Stage / Exit / Entrance / Canteen / Shop** — Center Piece presets (colour + label + position)
- **Undo / Redo** wired (50-step history); toolbar buttons live.
- **Inspector panel** — edit every element's properties per type + colours + delete.
- Clicking a sidebar tool adds the element to the canvas immediately and selects it (prototype behaviour).
- Toolbar counts (elements / blocks / seats) update live from the canvas.
- Typed element model (discriminated union, `%`-based geometry) — only placed instances are serialized for future API save.
- Removed dead code: old loose `CanvasElement` model + unused registry `defaultProps` helpers.

**Files / folders:**
- `src/app/features/layout-designer/models/layout-element.model.ts` (new typed model)
- `src/app/features/layout-designer/lib/geometry.ts` (shape paths + px/% math)
- `src/app/features/layout-designer/lib/seat-layout.ts` (seat positions: grid / section / ring)
- `src/app/features/layout-designer/data/element-factory.ts` (default instance per tool)
- `src/app/features/layout-designer/components/canvas-stage/` (SVG canvas + interaction)
- `src/app/features/layout-designer/components/inspector-panel/` (per-type editing)
- `src/app/features/layout-designer/services/layout-canvas.service.ts` (signals + undo/redo + CRUD + zoom/pan)
- `src/app/features/layout-designer/data/element-registry.ts`, `models/element-definition.model.ts` (cleanup)
- `src/app/features/layout-designer/layout-designer.page.{ts,html}`
- `src/tailwind.css` (canvas + inspector styles)

**How to test:**
1. Venue Layouts → **+ New blank layout** (`/venue-layouts/new`)
2. Click any tool under **Add element** → it appears on the canvas and is selected
3. Drag to move; middle-mouse drag to pan; zoom +/- buttons
4. Edit it in the **Inspector** (shape, rows, seats, colours, etc.) → canvas updates live
5. **Custom Piece** → click points on canvas, double-click / Enter to finish
6. Use **Undo / Redo**; watch toolbar counts (elements / blocks / seats) change
7. `ng build` passes

**Notes:**
- Tech: SVG rendering + Angular Signals + TypeScript seat math. No Konva/Fabric/OpenCV.
- ~~Still pending: save to mock API / localStorage draft~~ → **done** — Supabase save (see **2026-06-24 Supabase templates** entry)
- ~~Still pending: AI blueprint upload pipeline, reference/background image on canvas.~~ → **AI pipeline + reference image on canvas done** (see **2026-06-24 AI Layout Detection** entry)
- Resize/rotate/move handles added in **2026-06-24** entry (Custom Piece + all elements).

---

### 2026-06-23 — Element registry + Add Element library (Kalai)

**What changed:**
- Registry pattern: 13 canvas tools defined in code (`element-registry.ts`), not DB
- Models: `ElementTypeId`, `ElementDefinition`, `CanvasElement` (instance shape for future API save)
- `LayoutCanvasService` — placement mode, element/block/seat counts, `placeElement()` stub
- Reusable `ElementToolCardComponent` — data-driven sidebar list with multi-colour hover
- Add Element section: Focus area (6) + Annotations & presets (7), scrollable in left panel
- Toolbar badges wired to live counts from canvas service

**Files / folders:**
- `src/app/features/layout-designer/models/`
- `src/app/features/layout-designer/data/element-registry.ts`
- `src/app/features/layout-designer/services/layout-canvas.service.ts`
- `src/app/features/layout-designer/components/element-tool-card/`
- `src/app/features/layout-designer/layout-designer.page.ts`
- `src/app/features/layout-designer/layout-designer.page.html`
- `src/tailwind.css`

**How to test:**
1. Open New Venue Layout → scroll left panel to **Add element**
2. All 13 tools listed in two categories
3. Click a tool → highlights active, notice shows placement stub
4. Toolbar counts stay at 0 until canvas placement is implemented

---

### 2026-06-23 — Layout designer scaffold (Kalai)

**What changed:**
- Replaced simple start chooser with full **layout designer** page at `/venue-layouts/new`
- Optional template name + description at top; Back button to library
- Three start options (AI / Upload / Manual), infinity canvas (grid + zoom), inspector panel
- Sidebar auto-collapses on designer route; main area goes full-bleed (no padding)

**Files / folders:**
- `src/app/features/layout-designer/layout-designer.page.ts`
- `src/app/features/layout-designer/layout-designer.page.html`
- `src/app/layout/admin-shell/admin-shell.component.ts`
- `src/app/layout/admin-shell/admin-shell.component.html`
- `src/app/app.routes.ts`
- Removed `src/app/features/venue-layouts/layout-start.page.*`

**How to test:**
1. Go to Venue Layouts → **+ New blank layout**
2. Sidebar should collapse automatically
3. Optional name/description fields at top; workspace below with 3 start cards, canvas, inspector
4. Zoom +/- works on canvas overlay; start options show “coming soon” notice

---

### 2026-06-23 — Header/sidebar UI fixes (Kalai)

**What changed:**
- Removed OVL badge from top header (page title only)
- Fixed sidebar collapse chevron alignment (SVG icon, centered layout when collapsed)

---

### 2026-06-23 — Top bar: user + dark theme (Kalai)

**What changed:**
- Header bar: OVL badge, dynamic page title, theme toggle (☾/☀), user name + avatar
- `ThemeService` — light/dark toggle, saved in `localStorage`
- `SessionUserService` — mock user **Kalai** (swap via `setUser()` when API connects)
- Dark mode `dark:` Tailwind classes on shell and pages

**Files / folders:**
- `src/app/core/services/theme.service.ts`
- `src/app/core/services/session-user.service.ts`
- `src/app/core/models/session-user.model.ts`
- `src/app/layout/admin-shell/`
- `src/app/app.config.ts`, `src/tailwind.css`

**How to test:**
1. Top bar shows page title + **Kalai** + **K** avatar
2. Click moon icon → dark theme; sun icon → light theme
3. Refresh page → theme preference is remembered

---

### 2026-06-23 — Tailwind CSS migration (Kalai)

**What changed:**
- **Tailwind CSS v4** configured (`postcss.config.mjs`, `src/tailwind.css`)
- Removed all component `.scss` files and `styles.scss`
- Admin shell, dashboard, venue layouts, start chooser — **Tailwind utility classes only**
- Mobile responsive via Tailwind (`md:` breakpoint, drawer, `sm:` stacked layouts)
- New components default to `style: none` in `angular.json`

**Files / folders:**
- `postcss.config.mjs`, `src/tailwind.css`
- `src/app/layout/admin-shell/admin-shell.component.html`
- `src/app/features/**` (html + ts, no scss)
- Deleted: all `*.scss` under `src/app/`

**How to test:**
1. `npm start` → UI should look the same as before
2. Resize below 768px → hamburger menu + responsive layout
3. `ng build` passes

**Notes:**
- 2D designer (future) may need separate CSS for canvas — not part of this change

---

### 2026-06-23 — Mobile responsive layout (Kalai)

**What changed:**
- Mobile drawer sidebar (hamburger menu, backdrop, tap outside to close)
- Nav closes automatically after route change on mobile
- Responsive padding on header, content, and toast
- Venue Layouts and start chooser: stacked buttons on small screens
- Dashboard text scales on small viewports
- `overflow-x: hidden` on body to prevent horizontal scroll

**Files / folders:**
- `src/app/layout/admin-shell/` (ts, html, scss)
- `src/app/features/venue-layouts/*.scss`
- `src/app/features/dashboard/dashboard.page.ts`
- `src/styles.scss`

**How to test:**
1. `npm start` → resize browser below 768px or use phone devtools
2. Tap ☰ → sidebar opens; tap backdrop or a link → closes
3. Check Venue Layouts page — button full width on narrow screens

---

### 2026-06-23 — Admin dashboard scaffold (Kalai)

**What changed:**
- Admin shell with sidebar branded **Optimo Venue Layout** (collapse toggle, logout button placeholder)
- Dashboard page (welcome text only)
- Venue Layouts page with 3 areas: **New blank layout** button, **Starter layouts** empty state, **Your templates** empty state
- Layout start chooser (`/venue-layouts/new`) — AI / Upload / Manual options (designer not built; shows notice)
- Other sidebar items show **Coming soon** toast on click
- Lazy-loaded routes, OnPush components, minimal global styles
- No database, no mock API, no auth yet

**Files / folders:**
- `src/app/layout/admin-shell/`
- `src/app/features/dashboard/dashboard.page.ts`
- `src/app/features/venue-layouts/` (venue-layouts.page, layout-start.page)
- `src/app/app.routes.ts`
- `src/styles.scss`

**How to test:**
1. `cd optimo-venue-layout && npm start`
2. Open http://localhost:4200 → Dashboard
3. Click **Venue Layouts** → see empty starter/your template sections
4. Click **+ New blank layout** → start chooser with 3 options
5. Click Events / Sponsors etc. → **Coming soon** toast

**Notes:**
- Designer, templates data, and save flow are **not** implemented yet
- Logout button is UI only

---

*Full requirements: `PROJECT_BRAIN.md` · Prototype reference: `PROTOTYPE_REFERENCE.md` · Supabase migrations: `supabase/migrations/`*
