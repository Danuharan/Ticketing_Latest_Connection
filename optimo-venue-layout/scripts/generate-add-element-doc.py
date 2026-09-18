"""Generate Add-Element-Architecture.docx for the layout designer."""
from __future__ import annotations

import os

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor

OUT_PATH = os.path.join(
    os.path.dirname(os.path.dirname(__file__)),
    "docs",
    "Add-Element-Architecture.docx",
)


def set_cell_shading(cell, hex_color: str) -> None:
    shading = OxmlElement("w:shd")
    shading.set(qn("w:fill"), hex_color)
    shading.set(qn("w:val"), "clear")
    cell._tc.get_or_add_tcPr().append(shading)


def add_heading(doc: Document, text: str, level: int = 1):
    return doc.add_heading(text, level=level)


def add_para(doc: Document, text: str, *, bold: bool = False, italic: bool = False):
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.bold = bold
    run.italic = italic
    return p


def add_bullet(doc: Document, text: str):
    return doc.add_paragraph(text, style="List Bullet")


def main() -> None:
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    doc = Document()

    title = doc.add_heading("Add Element — Architecture Guide", 0)
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER

    sub = doc.add_paragraph("Optimo Venue Layout Designer")
    sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
    sub.runs[0].italic = True
    sub.runs[0].font.size = Pt(12)

    meta = doc.add_paragraph(
        "Document version: 1.0  |  Date: 24 June 2026  |  Project: optimo-venue-layout"
    )
    meta.alignment = WD_ALIGN_PARAGRAPH.CENTER
    meta.runs[0].font.size = Pt(10)
    meta.runs[0].font.color.rgb = RGBColor(100, 116, 139)

    doc.add_paragraph()

    add_heading(doc, "1. Short Answer", 1)
    add_para(
        doc,
        "Element types (Custom Piece, Block Grid, Stage, etc.) live in a code registry — "
        "hardcoded, version-controlled, and typed. When a user places elements on the canvas, "
        "only instances (layout data) are saved to JSON/API/DB — not the type definitions themselves.",
    )
    add_para(
        doc,
        "Saving element definitions in the database is not recommended: it is inefficient, hard to "
        "maintain, lacks TypeScript safety, and cannot be unit-tested or version-controlled with "
        "the application code.",
        italic=True,
    )

    add_heading(doc, "2. What Happens When the User Clicks “+ Add Element”?", 1)
    for i, step in enumerate(
        [
            "Sidebar click → placement / draw mode starts (depends on tool)",
            "Canvas → a new element instance is created with a unique id, type, position, size, and default properties",
            "Renderer → looks up the type in the registry and draws the correct SVG shape",
            "Inspector → shows editable properties for the selected instance",
            "Save → layout JSON stores only instances: { templateName, elements: [...], viewport }",
        ],
        1,
    ):
        add_bullet(doc, f"{i}. {step}")

    add_heading(doc, 'Example: "+ Block Grid" click', 2)
    for b in [
        "App enters placement mode for type: 'block-grid'",
        'Canvas creates one instance: { id, type: "block-grid", position, size, rows, seatsPerRow, label, rotation, style }',
        "SVG renderer reads type from registry and draws the grid + seats",
        "Inspector lets user edit rows, seats per row, label, colours",
        "On save, only this instance is stored in JSON — the type definition is never saved",
    ]:
        add_bullet(doc, b)

    add_heading(doc, "3. Three Approaches — Comparison", 1)

    table = doc.add_table(rows=1, cols=4)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.style = "Table Grid"
    hdr = table.rows[0].cells
    for i, h in enumerate(["Approach", "How it works", "Pros", "Cons / Verdict"]):
        hdr[i].text = h
        set_cell_shading(hdr[i], "DBEAFE")
        for p in hdr[i].paragraphs:
            for r in p.runs:
                r.bold = True

    rows_data = [
        (
            "A. Full hardcode\n(14 separate big components)",
            "One large Angular component per sidebar tool. Each component owns its own UI, canvas drawing, inspector, and defaults.",
            "• Simple to start\n• Each type fully isolated",
            "• Massive code duplication\n• Hard to scale (15th element = new component everywhere)\n• Inconsistent UX\n\n❌ Verdict: Works for prototypes only",
        ),
        (
            "B. Element types in DB",
            "Tool definitions (title, icon, default props, render rules) stored in database. App loads types at runtime.",
            "• Non-developers could add types (in theory)\n• Centralised config",
            "• No TypeScript typing\n• Cannot unit-test render logic easily\n• Version drift between app and DB\n• Security risk (arbitrary render rules)\n• Slower startup\n\n❌ Verdict: Not recommended",
        ),
        (
            "C. Registry + data-driven UI ✅\n(Recommended)",
            "One element-registry.ts lists all tools (metadata only). One reusable sidebar card. One canvas renderer switches on type. One service holds instances[]. Inspector forms per type group.",
            "• DRY — no duplicate sidebar code\n• Full TypeScript types + tests\n• Git version control\n• Same pattern as Figma, Konva, our prototype\n• Easy to add type #14 or #15",
            "• New complex types need renderer + inspector logic in code (expected and correct)\n\n✅ Verdict: Best for Optimo Venue Layout",
        ),
    ]
    for row in rows_data:
        cells = table.add_row().cells
        for i, val in enumerate(row):
            cells[i].text = val
    for cell in table.rows[3].cells:
        set_cell_shading(cell, "ECFDF5")

    doc.add_paragraph()

    add_heading(doc, "4. Key Differences (Simple Summary)", 1)
    diff_table = doc.add_table(rows=1, cols=4)
    diff_table.style = "Table Grid"
    dh = diff_table.rows[0].cells
    for i, h in enumerate(["Topic", "Approach A", "Approach B", "Approach C ✅"]):
        dh[i].text = h
        set_cell_shading(dh[i], "E2E8F0")
        for p in dh[i].paragraphs:
            for r in p.runs:
                r.bold = True

    for row in [
        ("Where types live", "Scattered in 14 components", "Database tables", "element-registry.ts (code)"),
        ("Where instances live", "Component state / JSON", "JSON / DB", "layout JSON / API / DB"),
        ("Sidebar UI", "14 separate cards", "Dynamic from DB", "1 reusable card × registry list"),
        ("Canvas render", "14 render paths", "Runtime rules from DB", "1 renderer, switch on type"),
        ("Type safety", "Partial", "None", "Full TypeScript"),
        ("Adding element #15", "New component everywhere", "DB row + hope app supports it", "Registry entry + factory + render case"),
        ("Industry pattern", "Rare at scale", "CMS-style (wrong tool)", "Figma / Konva / prototype"),
    ]:
        cells = diff_table.add_row().cells
        for i, v in enumerate(row):
            cells[i].text = v

    doc.add_paragraph()

    add_heading(doc, "5. Recommended Architecture (Approach C)", 1)
    add_para(doc, "Folder structure in optimo-venue-layout:", bold=True)
    structure = """src/app/features/layout-designer/
  models/
    layout-element.model.ts       ← placed instance shape (discriminated union)
    element-definition.model.ts   ← type metadata (id, title, icon, category)
    element-type.model.ts         ← type ids + categories
  data/
    element-registry.ts           ← all 13 sidebar tools (catalogue)
    element-factory.ts            ← creates default instance per tool id
  lib/
    geometry.ts, seat-layout.ts, custom-shape.ts  ← pure math / SVG helpers
  components/
    element-tool-card/            ← ONE reusable sidebar card
    canvas-stage/                 ← draws all instances by type (SVG)
    inspector-panel/              ← edits selected instance properties
  services/
    layout-canvas.service.ts      ← elements[], add, select, undo, pan, zoom"""
    p = doc.add_paragraph(structure)
    for r in p.runs:
        r.font.name = "Consolas"
        r.font.size = Pt(9)

    add_para(
        doc,
        "You do NOT need 14 Angular components for the sidebar — one element-tool-card + registry list is enough.",
        bold=True,
    )
    add_para(
        doc,
        "Complex types (Block Grid, Seat Section, Custom Piece) may have richer inspector sections, "
        "but they still share the same registry + service + canvas pattern.",
    )

    add_heading(doc, "6. What Goes in DB/API vs What Stays in Code", 1)
    save_table = doc.add_table(rows=1, cols=2)
    save_table.style = "Table Grid"
    sh = save_table.rows[0].cells
    sh[0].text = "Save in DB / API"
    sh[1].text = "Keep in Code Only"
    set_cell_shading(sh[0], "DCFCE7")
    set_cell_shading(sh[1], "DBEAFE")
    for c in sh:
        for p in c.paragraphs:
            for r in p.runs:
                r.bold = True

    save_row = save_table.add_row().cells
    save_row[0].text = (
        "• Layout name, description\n"
        "• Venue / template id\n"
        "• Placed elements array (instances)\n"
        "• Viewport (pan, zoom)\n"
        "• Version, createdBy, updatedAt\n"
        "• Optional: thumbnail / preview image"
    )
    save_row[1].text = (
        "• Element type catalogue (registry)\n"
        "• How each type renders (SVG logic)\n"
        "• Default props and factory\n"
        "• Icons, categories, descriptions\n"
        "• Placement / draw interaction rules\n"
        "• Geometry and seat math"
    )

    doc.add_paragraph()
    add_para(
        doc,
        "Efficient storage: one layout document as a JSON blob, or a normalised layout_elements "
        "table where each row is one instance — instance data only, never type definitions.",
        italic=True,
    )

    add_heading(doc, "7. Element Catalogue (13 Tools — Prototype-Aligned)", 1)
    cat_table = doc.add_table(rows=1, cols=4)
    cat_table.style = "Table Grid"
    ch = cat_table.rows[0].cells
    for i, h in enumerate(["#", "Tool ID", "Title", "Category"]):
        ch[i].text = h
        set_cell_shading(ch[i], "F1F5F9")
        for p in ch[i].paragraphs:
            for r in p.runs:
                r.bold = True

    for el in [
        ("1", "custom-piece", "Custom Piece", "Focus area"),
        ("2", "center-piece", "Center Piece", "Focus area"),
        ("3", "layer-ring", "Layer Ring", "Focus area"),
        ("4", "layer-rect", "Layer Rect", "Focus area"),
        ("5", "block-grid", "Block Grid", "Focus area"),
        ("6", "seat-section", "Seat Section", "Focus area"),
        ("7", "aisle", "Aisle", "Annotations & presets"),
        ("8", "label", "Label", "Annotations & presets"),
        ("9", "stage", "Stage", "Annotations & presets"),
        ("10", "exit", "Exit", "Annotations & presets"),
        ("11", "entrance", "Entrance", "Annotations & presets"),
        ("12", "canteen", "Canteen", "Annotations & presets"),
        ("13", "shop", "Shop", "Annotations & presets"),
    ]:
        cells = cat_table.add_row().cells
        for i, v in enumerate(el):
            cells[i].text = v

    doc.add_paragraph()
    add_para(
        doc,
        "Focus area = seating geometry, grounds, custom shapes. "
        "Annotations & presets = labelled zones and signage (implemented as centerpiece presets).",
    )

    add_heading(doc, "8. Example Saved Layout JSON", 1)
    json_example = """{
  "templateName": "Main Stadium — Event A",
  "venueId": "venue-001",
  "viewport": { "panX": 0, "panY": 0, "zoom": 100 },
  "elements": [
    {
      "id": "grid-abc123",
      "type": "block-grid",
      "name": "North Stand",
      "position": { "xPct": 25, "yPct": 30 },
      "size": { "wPct": 20, "hPct": 25 },
      "rotation": 0,
      "rows": 12,
      "seatsPerRow": 24,
      "label": "NORTH",
      "rowLabelStyle": "letter",
      "style": { "fillColor": "#e2e8f0", "strokeColor": "#94a3b8", "labelColor": "#0f172a" }
    },
    {
      "id": "custom-def456",
      "type": "centerpiece",
      "shape": "custom",
      "name": "Custom Piece",
      "customPoints": [{ "xPct": 0, "yPct": 0 }, "..."],
      "position": { "xPct": 52, "yPct": 44 },
      "size": { "wPct": 12, "hPct": 12 },
      "rotation": 0,
      "label": "VIP",
      "style": { "fillColor": "#dbeafe", "labelColor": "#1e3a8a" }
    }
  ]
}"""
    p2 = doc.add_paragraph(json_example)
    for r in p2.runs:
        r.font.name = "Consolas"
        r.font.size = Pt(8)

    add_heading(doc, "9. Conclusion", 1)
    add_para(
        doc,
        "Use Approach C — Registry + data-driven UI. Element types are application code "
        "(registry, factory, renderer, inspector). User layouts store only instances. This matches "
        "industry practice, our React prototype, and Optimo's need for typed, testable, "
        "version-controlled spatial logic.",
    )

    add_heading(doc, "Decision", 2)
    decision = doc.add_paragraph()
    run = decision.add_run(
        "✅ Adopted: Approach C (Registry pattern) — already implemented in optimo-venue-layout."
    )
    run.bold = True
    run.font.color.rgb = RGBColor(22, 101, 52)

    doc.save(OUT_PATH)
    print(f"Created: {OUT_PATH}")
    print(f"Size: {os.path.getsize(OUT_PATH)} bytes")


if __name__ == "__main__":
    main()
