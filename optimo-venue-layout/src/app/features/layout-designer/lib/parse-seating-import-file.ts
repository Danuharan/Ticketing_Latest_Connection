/**
 * Bulk seating import file parser (CSV — export "Save as CSV" from Excel).
 *
 * One row per block. Required: block code plus either rows × seats-per-row or a
 * seat capacity (irregular shapes). Chair size / gaps / edge margin are optional
 * — when omitted, import derives them from the row/column structure and the
 * block's available size. Curve and aisles are applied as specified.
 */

import {
  createDefaultAisleSlot,
  type AutoFillAisleSlot,
  type AutoFillAisleType,
} from '../models/auto-fill-seating.model';

export interface SeatingImportRow {
  /** Block code as printed on the chart, e.g. "N3401" or "B11". */
  blockCode: string;
  rows?: number;
  seatsPerRow?: number;
  /** Total seat target — used alone for irregular shapes, or as a cap with rows/columns. */
  capacity?: number;
  chairWidthM?: number;
  chairLengthM?: number;
  seatGapM?: number;
  rowGapM?: number;
  /** Clear space between the block border and the first/last seats (metres). */
  edgeMarginM?: number;
  /**
   * Per-row seat counts for irregular shapes, expanded from the row_seats
   * column ("1-5:6|6-8:2|7:5" → row 7 overrides the 6-8 range). Index 0 = row A.
   */
  rowSeatCounts?: number[];
  /** Shared row bow (0 = straight). Same units as Auto Fill curve. */
  curveDeg?: number;
  /** Aisles to reserve when filling this block (row / column / center / draw). */
  aisles?: AutoFillAisleSlot[];
  /** 1-based line number in the file — used in error messages. */
  lineNumber: number;
}

export interface SeatingImportParseResult {
  rows: SeatingImportRow[];
  errors: string[];
}

type ImportCsvField =
  | keyof Omit<SeatingImportRow, 'lineNumber' | 'aisles'>
  | 'aisleType'
  | 'aisleRows'
  | 'aisleColumns'
  | 'aisleWidthM'
  | 'rowAisleWidthM'
  | 'columnAisleWidthM'
  | 'aisleCenterAxis'
  | 'aislesSpec'
  | 'centerRowAisleWidths'
  | 'centerColumnAisleWidths';

/** Header aliases → canonical field. Headers are matched after lowercasing and stripping spaces/_/-. */
const HEADER_ALIASES: Record<string, ImportCsvField> = {
  rowseats: 'rowSeatCounts',
  seatsbyrow: 'rowSeatCounts',
  rowwiseseats: 'rowSeatCounts',
  seatsperrowbyrange: 'rowSeatCounts',
  block: 'blockCode',
  blockcode: 'blockCode',
  blockno: 'blockCode',
  blocknumber: 'blockCode',
  blockname: 'blockCode',
  code: 'blockCode',
  section: 'blockCode',
  rows: 'rows',
  rowcount: 'rows',
  numberofrows: 'rows',
  columns: 'seatsPerRow',
  cols: 'seatsPerRow',
  seatsperrow: 'seatsPerRow',
  numberofcolumns: 'seatsPerRow',
  capacity: 'capacity',
  seatcapacity: 'capacity',
  totalseats: 'capacity',
  chairwidthm: 'chairWidthM',
  chairwidth: 'chairWidthM',
  seatwidth: 'chairWidthM',
  seatwidthm: 'chairWidthM',
  chairlengthm: 'chairLengthM',
  chairlength: 'chairLengthM',
  chairdepth: 'chairLengthM',
  chairdepthm: 'chairLengthM',
  seatdepth: 'chairLengthM',
  seatdepthm: 'chairLengthM',
  seatgapm: 'seatGapM',
  seatgap: 'seatGapM',
  seatspacing: 'seatGapM',
  seatspacingm: 'seatGapM',
  gapbetweenseats: 'seatGapM',
  rowgapm: 'rowGapM',
  rowgap: 'rowGapM',
  gapbetweenrows: 'rowGapM',
  edgemarginm: 'edgeMarginM',
  edgemargin: 'edgeMarginM',
  bordermargin: 'edgeMarginM',
  bordergap: 'edgeMarginM',
  blockbordertoseatspace: 'edgeMarginM',
  curve: 'curveDeg',
  curvedeg: 'curveDeg',
  curvevalue: 'curveDeg',
  aisletype: 'aisleType',
  aislerows: 'aisleRows',
  aislecolumns: 'aisleColumns',
  aislecols: 'aisleColumns',
  aislewidthm: 'aisleWidthM',
  aislewidth: 'aisleWidthM',
  rowaislewidthm: 'rowAisleWidthM',
  rowaislewidth: 'rowAisleWidthM',
  columnaislewidthm: 'columnAisleWidthM',
  columnaislewidth: 'columnAisleWidthM',
  aislecenter: 'aisleCenterAxis',
  aislecenteraxis: 'aisleCenterAxis',
  aisles: 'aislesSpec',
  centerrowaislewidthsm: 'centerRowAisleWidths',
  centerrowaislewidthm: 'centerRowAisleWidths',
  centerrowaislewidths: 'centerRowAisleWidths',
  centerrowaislewidth: 'centerRowAisleWidths',
  centercolumnaislewidthsm: 'centerColumnAisleWidths',
  centercolumnaislewidthm: 'centerColumnAisleWidths',
  centercolumnaislewidths: 'centerColumnAisleWidths',
  centercolumnaislewidth: 'centerColumnAisleWidths',
};

const NUMERIC_FIELDS: (keyof Omit<SeatingImportRow, 'lineNumber' | 'blockCode'>)[] = [
  'rows',
  'seatsPerRow',
  'capacity',
  'chairWidthM',
  'chairLengthM',
  'seatGapM',
  'rowGapM',
  'edgeMarginM',
];

export const SEATING_IMPORT_SAMPLE_CSV = [
  'block_code,rows,columns,capacity,chair_width_m,chair_length_m,seat_gap_m,row_gap_m,edge_margin_m,row_seats,curve_deg,center_row_aisle_widths_m,center_column_aisle_widths_m',
  '1,8,8,,0.45,0.5,0.06,0.1,0.2,,0,0.2,0.2',
  '2,8,8,,0.45,0.5,0.06,0.1,0.2,,2,0.2,0.2',
  '3,8,10,,0.45,0.5,0.06,0.1,0.2,,3,0.2,0.2',
  '4,8,8,,0.45,0.5,0.06,0.1,0.2,1-2:8|3-4:6,0,0.2,0.2',
  '5,8,,,0.45,0.5,0.06,0.1,0.2,,0,0.2,0.2',
].join('\r\n');

function normalizeHeader(raw: string): string {
  return raw.toLowerCase().replace(/[\s_\-()."']/g, '').replace(/metres?$/, 'm');
}

/** Split one CSV line honouring double-quoted fields ("" = escaped quote). */
function splitCsvLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields.map((f) => f.trim());
}

/** Pick the delimiter that yields the most columns on the header line. */
function detectDelimiter(headerLine: string): string {
  let best = ',';
  let bestCount = 0;
  for (const candidate of [',', ';', '\t']) {
    const count = splitCsvLine(headerLine, candidate).length;
    if (count > bestCount) {
      bestCount = count;
      best = candidate;
    }
  }
  return best;
}

const MAX_ROW_SEATS_ROWS = 200;

/**
 * Expand a row_seats expression like "1-5:6|6-8:2|7:5" into per-row counts.
 * Rows are 1-based; later entries override earlier ones (row 7 above wins).
 * Separators: | or ;.
 */
function parseRowSeats(
  raw: string,
  fallbackSeats?: number,
  targetRows?: number,
): { counts: number[] } | { error: string } {
  const counts: (number | undefined)[] = [];
  const entries = raw.split(/[|;]/).map((entry) => entry.trim()).filter(Boolean);
  if (entries.length === 0) {
    return { error: 'row_seats is empty' };
  }
  for (const entry of entries) {
    const match = entry.match(/^(\d+)(?:\s*-\s*(\d+))?\s*:\s*(\d+)?$/);
    if (!match) {
      return { error: `"${entry}" is not valid — use row:seats or start-end:seats (e.g. 1-5:6)` };
    }
    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : start;
    const seats = match[3] ? Number(match[3]) : fallbackSeats;
    if (start < 1 || end < start || end > MAX_ROW_SEATS_ROWS) {
      return { error: `"${entry}" has an invalid row range` };
    }
    if (seats == null || seats < 1) {
      continue;
    }
    for (let rowNumber = start; rowNumber <= end; rowNumber += 1) {
      counts[rowNumber - 1] = seats;
    }
  }
  for (let index = 0; index < counts.length; index += 1) {
    if (counts[index] == null && fallbackSeats != null && fallbackSeats > 0) {
      counts[index] = fallbackSeats;
    }
  }
  const gaps: number[] = [];
  for (let index = 0; index < counts.length; index += 1) {
    if (counts[index] == null) {
      gaps.push(index + 1);
    }
  }
  if (gaps.length > 0) {
    return { error: `rows ${gaps.join(', ')} have no seat count` };
  }
  if (counts.length === 0) {
    return { error: 'row_seats did not define any rows' };
  }
  const fill = fallbackSeats ?? counts[counts.length - 1];
  if (targetRows != null && targetRows > counts.length && fill != null && fill > 0) {
    while (counts.length < targetRows) {
      counts.push(fill);
    }
  }
  return { counts: counts as number[] };
}

function parsePositiveNumber(raw: string): number | null {
  const cleaned = raw.replace(/,/g, '.').replace(/[^\d.]/g, '');
  if (!cleaned) {
    return null;
  }
  const value = Number(cleaned);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Unit suffix → metres. Values without a unit are already metres. */
const UNIT_TO_METRES: Record<string, number> = {
  m: 1,
  cm: 0.01,
  mm: 0.001,
  in: 0.0254,
  inch: 0.0254,
  ft: 0.3048,
};

/** Measurement cell → metres. Accepts "0.45", "45cm", "450 mm", "18in", "1.5 ft". */
function parseMeasurementM(raw: string): number | null {
  const match = raw
    .trim()
    .toLowerCase()
    .match(/^(\d+(?:[.,]\d+)?)\s*(m|cm|mm|in|inch|ft)?$/);
  if (!match) {
    return null;
  }
  const value = Number(match[1].replace(',', '.'));
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value * (UNIT_TO_METRES[match[2] ?? 'm'] ?? 1);
}

/** One or more widths: `0.2`, `0.2,0.3`, or `0.2|0.3`. Zero / blank entries are skipped. */
function parseMeasurementListM(raw: string): number[] | { error: string } {
  const single = parseMeasurementM(raw);
  if (single != null) {
    return [single];
  }
  const parts = raw.split(/[|;,]/).map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) {
    return [];
  }
  const values: number[] = [];
  for (const part of parts) {
    const value = parseMeasurementM(part);
    if (value == null) {
      return { error: `"${part}" is not a valid measurement` };
    }
    values.push(value);
  }
  return values;
}

const AISLE_TYPES: AutoFillAisleType[] = ['row', 'column', 'center', 'draw'];

function isAisleType(raw: string): raw is AutoFillAisleType {
  return AISLE_TYPES.includes(raw.toLowerCase() as AutoFillAisleType);
}

function splitPayloadWidth(payload: string): { body: string; widthM?: number } {
  const idx = payload.lastIndexOf(':');
  if (idx < 0) {
    return { body: payload.trim() };
  }
  const widthM = parseMeasurementM(payload.slice(idx + 1).trim());
  if (widthM == null) {
    return { body: payload.trim() };
  }
  return { body: payload.slice(0, idx).trim(), widthM };
}

/**
 * Compact aisle list: `row:C:1.2|column:5:1|center:column:2|draw:20,10-80,90:1.2`
 */
export function parseImportAislesSpec(raw: string): { slots: AutoFillAisleSlot[] } | { error: string } {
  const parts = raw.split('|').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) {
    return { error: 'aisles is empty' };
  }
  const slots: AutoFillAisleSlot[] = [];
  for (const part of parts) {
    const colon = part.indexOf(':');
    const typeRaw = (colon < 0 ? part : part.slice(0, colon)).trim().toLowerCase();
    const payload = colon < 0 ? '' : part.slice(colon + 1).trim();
    if (!isAisleType(typeRaw)) {
      return { error: `"${part}" — aisle type must be row, column, center, or draw` };
    }
    const { body, widthM } = splitPayloadWidth(payload);
    const slot = createDefaultAisleSlot(typeRaw);
    slot.widthM = widthM ?? 1;
    if (typeRaw === 'row') {
      slot.rows = body;
      if (!slot.rows) {
        return { error: `"${part}" — row aisle needs letters (example: row:C:1.2)` };
      }
    } else if (typeRaw === 'column') {
      slot.columns = body;
      if (!slot.columns) {
        return { error: `"${part}" — column aisle needs numbers (example: column:5:1)` };
      }
    } else if (typeRaw === 'center') {
      const axis = body.toLowerCase();
      if (axis !== 'row' && axis !== 'column') {
        return { error: `"${part}" — center aisle needs row or column (example: center:column:2)` };
      }
      slot.centerAxis = axis;
    } else {
      const match = body.match(
        /^(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)$/,
      );
      if (!match) {
        return {
          error: `"${part}" — draw aisle needs x1,y1-x2,y2 percents (example: draw:20,10-80,90:1.2)`,
        };
      }
      slot.drawStart = { xPct: Number(match[1]), yPct: Number(match[2]) };
      slot.drawEnd = { xPct: Number(match[3]), yPct: Number(match[4]) };
    }
    slots.push(slot);
  }
  return { slots };
}

interface AisleColumnDraft {
  type?: string;
  rows?: string;
  columns?: string;
  widthM?: number;
  rowWidthM?: number;
  columnWidthM?: number;
  centerAxis?: string;
  spec?: string;
  centerRowWidthsM?: number[];
  centerColumnWidthsM?: number[];
}

function centerAisleSlotsFromWidths(
  widths: number[] | undefined,
  axis: 'row' | 'column',
): AutoFillAisleSlot[] {
  return (widths ?? [])
    .filter((widthM) => widthM > 0)
    .map((widthM) => {
      const slot = createDefaultAisleSlot('center');
      slot.centerAxis = axis;
      slot.widthM = widthM;
      return slot;
    });
}

function buildAislesFromDraft(
  draft: AisleColumnDraft,
  errors: string[],
  lineNumber: number,
): AutoFillAisleSlot[] {
  const slots: AutoFillAisleSlot[] = [
    ...centerAisleSlotsFromWidths(draft.centerRowWidthsM, 'row'),
    ...centerAisleSlotsFromWidths(draft.centerColumnWidthsM, 'column'),
  ];
  if (draft.spec) {
    const parsed = parseImportAislesSpec(draft.spec);
    if ('error' in parsed) {
      errors.push(`Line ${lineNumber}: aisles ${parsed.error} — aisles ignored.`);
    } else {
      slots.push(...parsed.slots);
    }
  }
  const typeRaw = (draft.type ?? '').trim().toLowerCase();
  if (!typeRaw) {
    if ((draft.rows ?? '').trim()) {
      const rowSlot = createDefaultAisleSlot('row');
      rowSlot.rows = (draft.rows ?? '').trim();
      rowSlot.widthM = draft.rowWidthM != null && draft.rowWidthM > 0
        ? draft.rowWidthM
        : draft.widthM != null && draft.widthM > 0
          ? draft.widthM
          : 1;
      slots.push(rowSlot);
    }
    if ((draft.columns ?? '').trim()) {
      const columnSlot = createDefaultAisleSlot('column');
      columnSlot.columns = (draft.columns ?? '').trim();
      columnSlot.widthM = draft.columnWidthM != null && draft.columnWidthM > 0
        ? draft.columnWidthM
        : draft.widthM != null && draft.widthM > 0
          ? draft.widthM
          : 1;
      slots.push(columnSlot);
    }
    return slots;
  }
  if (!isAisleType(typeRaw)) {
    errors.push(
      `Line ${lineNumber}: aisle_type "${draft.type}" is not row, column, center, or draw — aisle ignored.`,
    );
    return slots;
  }
  const slot = createDefaultAisleSlot(typeRaw);
  slot.widthM = draft.widthM != null && draft.widthM > 0 ? draft.widthM : 1;
  if (typeRaw === 'row') {
    slot.rows = (draft.rows ?? '').trim();
    if (!slot.rows) {
      errors.push(`Line ${lineNumber}: aisle_type row needs aisle_rows (example: C or C, E) — aisle ignored.`);
      return slots;
    }
  } else if (typeRaw === 'column') {
    slot.columns = (draft.columns ?? '').trim();
    if (!slot.columns) {
      errors.push(
        `Line ${lineNumber}: aisle_type column needs aisle_columns (example: 1 or 1, 5) — aisle ignored.`,
      );
      return slots;
    }
  } else if (typeRaw === 'center') {
    const axis = (draft.centerAxis ?? 'column').trim().toLowerCase();
    if (axis !== 'row' && axis !== 'column') {
      errors.push(`Line ${lineNumber}: aisle_center must be row or column — aisle ignored.`);
      return slots;
    }
    slot.centerAxis = axis;
  } else if (!slot.drawStart || !slot.drawEnd) {
    errors.push(
      `Line ${lineNumber}: draw aisles belong in the aisles column (example: draw:20,10-80,90:1.2) — aisle ignored.`,
    );
    return slots;
  }
  slots.push(slot);
  return slots;
}

function parseFiniteNumber(raw: string): number | null {
  const cleaned = raw.replace(/,/g, '.').replace(/[^\d.-]/g, '');
  if (!cleaned) {
    return null;
  }
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/**
 * Parse a seating import CSV. The first non-empty line must be the header row;
 * unknown columns are ignored so clients can keep extra bookkeeping columns.
 */
export function parseSeatingImportCsv(text: string): SeatingImportParseResult {
  const errors: string[] = [];
  const rows: SeatingImportRow[] = [];

  const lines = text.replace(/^﻿/, '').split(/\r\n|\r|\n/);
  let headerIndex = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim()) {
      headerIndex = i;
      break;
    }
  }
  if (headerIndex < 0) {
    return { rows, errors: ['The file is empty.'] };
  }

  const delimiter = detectDelimiter(lines[headerIndex]);
  const headers = splitCsvLine(lines[headerIndex], delimiter).map(normalizeHeader);
  const fieldByColumn = headers.map((h) => HEADER_ALIASES[h] ?? null);

  if (!fieldByColumn.includes('blockCode')) {
    return {
      rows,
      errors: [
        'No block code column found. Add a header row with a "block_code" column (also accepted: block, block_no, code, section).',
      ],
    };
  }

  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) {
      continue;
    }
    const lineNumber = i + 1;
    const cells = splitCsvLine(line, delimiter);
    const row: SeatingImportRow = { blockCode: '', lineNumber };
    const aisleDraft: AisleColumnDraft = {};
    let rowSeatsRaw = '';

    for (let col = 0; col < fieldByColumn.length; col += 1) {
      const field = fieldByColumn[col];
      const raw = cells[col] ?? '';
      if (!field || !raw) {
        continue;
      }
      if (field === 'blockCode') {
        row.blockCode = raw;
      } else if (field === 'rowSeatCounts') {
        rowSeatsRaw = raw;
      } else if (field === 'aisleType') {
        aisleDraft.type = raw;
      } else if (field === 'aisleRows') {
        aisleDraft.rows = raw;
      } else if (field === 'aisleColumns') {
        aisleDraft.columns = raw;
      } else if (field === 'aisleCenterAxis') {
        aisleDraft.centerAxis = raw;
      } else if (field === 'aislesSpec') {
        aisleDraft.spec = raw;
      } else if (field === 'curveDeg') {
        const value = parseFiniteNumber(raw);
        if (value == null) {
          errors.push(`Line ${lineNumber}: "${raw}" is not a valid curve — value ignored.`);
        } else {
          row.curveDeg = Math.max(0, Math.min(50, value));
        }
      } else if (field === 'rows' || field === 'seatsPerRow' || field === 'capacity') {
        const value = parsePositiveNumber(raw);
        if (value == null) {
          errors.push(`Line ${lineNumber}: "${raw}" is not a valid number — value ignored.`);
        } else {
          row[field] = Math.round(value);
        }
      } else if (field === 'aisleWidthM') {
        const value = parseMeasurementM(raw);
        if (value == null) {
          errors.push(
            `Line ${lineNumber}: "${raw}" is not a valid aisle width (use metres, or add cm/mm/in/ft) — value ignored.`,
          );
        } else {
          aisleDraft.widthM = value;
        }
      } else if (field === 'rowAisleWidthM' || field === 'columnAisleWidthM') {
        const value = parseMeasurementM(raw);
        if (value == null) {
          errors.push(
            `Line ${lineNumber}: "${raw}" is not a valid aisle width (use metres, or add cm/mm/in/ft) — value ignored.`,
          );
        } else if (field === 'rowAisleWidthM') {
          aisleDraft.rowWidthM = value;
        } else {
          aisleDraft.columnWidthM = value;
        }
      } else if (field === 'centerRowAisleWidths' || field === 'centerColumnAisleWidths') {
        const parsed = parseMeasurementListM(raw);
        if ('error' in parsed) {
          errors.push(
            `Line ${lineNumber}: ${field === 'centerRowAisleWidths' ? 'center_row_aisle_widths_m' : 'center_column_aisle_widths_m'} ${parsed.error} — value ignored.`,
          );
        } else if (parsed.length > 0) {
          if (field === 'centerRowAisleWidths') {
            aisleDraft.centerRowWidthsM = parsed;
          } else {
            aisleDraft.centerColumnWidthsM = parsed;
          }
        }
      } else {
        // Measurement columns accept unit suffixes: 45cm, 450mm, 18in, 1.5ft.
        const value = parseMeasurementM(raw);
        if (value == null) {
          errors.push(
            `Line ${lineNumber}: "${raw}" is not a valid measurement (use metres, or add cm/mm/in/ft) — value ignored.`,
          );
        } else {
          row[field] = value;
        }
      }
    }

    if (rowSeatsRaw) {
      const parsedRowSeats = parseRowSeats(rowSeatsRaw, row.seatsPerRow, row.rows);
      if ('error' in parsedRowSeats) {
        errors.push(`Line ${lineNumber}: row_seats ${parsedRowSeats.error} — value ignored.`);
      } else {
        row.rowSeatCounts = parsedRowSeats.counts;
      }
    }

    const aisles = buildAislesFromDraft(aisleDraft, errors, lineNumber);
    if (aisles.length > 0) {
      row.aisles = aisles;
    }

    if (!row.blockCode) {
      errors.push(`Line ${lineNumber}: missing block code — row skipped.`);
      continue;
    }
    if (row.rows == null && row.capacity == null && row.rowSeatCounts == null) {
      errors.push(
        `Line ${lineNumber} (${row.blockCode}): needs rows (with optional columns), row_seats, or a capacity — row skipped.`,
      );
      continue;
    }
    rows.push(row);
  }

  if (rows.length === 0 && errors.length === 0) {
    errors.push('No data rows found under the header row.');
  }
  return { rows, errors };
}

/** Normalised key used to match file block codes against canvas block labels. */
export function normalizeBlockCode(raw: string | undefined | null): string {
  return (raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}
