import { describe, expect, it } from 'vitest';

import { parseDiningSpecFromRawText } from './parse-dining-spec';

const SAMPLE = `DINING TABLE SPECIFICATION
Block name: Ballroom A

Block sides (metres)
Side 1: 12.0 m
Side 2: 10.0 m
Side 3: 12.0 m
Side 4: 10.0 m

Table layout
Table count: 20
Table shape: round
Table size: 1.5 m
Chairs per table: 8
Table gap: 0.8 m

Chair size
Chair size: 0.45 m x 0.50 m

Stage and exit
Stage: Side 1 (top / front)
Exit: Side 4 (right)`;

describe('parseDiningSpecFromRawText', () => {
  it('parses the sample dining measurement sheet', () => {
    const { spec, notes } = parseDiningSpecFromRawText(SAMPLE);
    expect(spec).not.toBeNull();
    expect(notes).toEqual([]);
    expect(spec!.blockName).toBe('Ballroom A');
    expect(spec!.sideLengthsM).toEqual([12, 10, 12, 10]);
    expect(spec!.tableCount).toBe(20);
    expect(spec!.tableShape).toBe('round');
    expect(spec!.tableWidthM).toBe(1.5);
    expect(spec!.tableDepthM).toBe(1.5);
    expect(spec!.chairsPerTable).toBe(8);
    expect(spec!.tableGapM).toBe(0.8);
    expect(spec!.chairWidthM).toBe(0.45);
    expect(spec!.chairLengthM).toBe(0.5);
    expect(spec!.stageSideIndex).toBe(0);
    expect(spec!.exitSideIndex).toBe(3);
    expect(spec!.confidence).toBe('high');
  });

  it('parses rectangular table dimensions', () => {
    const text = `Table layout
Table count: 6
Table shape: rectangular
Table size: 2.0 m x 1.2 m
Chairs per table: 10`;
    const { spec } = parseDiningSpecFromRawText(text);
    expect(spec!.tableShape).toBe('rectangular');
    expect(spec!.tableWidthM).toBe(2);
    expect(spec!.tableDepthM).toBe(1.2);
    expect(spec!.tableCount).toBe(6);
    expect(spec!.chairsPerTable).toBe(10);
  });

  it('returns null when no table or side info is found', () => {
    const { spec } = parseDiningSpecFromRawText('Hello world');
    expect(spec).toBeNull();
  });
});
