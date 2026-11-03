import { describe, it, expect } from 'vitest';
import { csvCell, toCsv } from '../src/lib/csv.js';

describe('CSV export', () => {
  it('quotes commas, quotes and line breaks', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
  });
  it('neutralises spreadsheet formulas in user text', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell('+1-555')).toBe("'+1-555");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('-2+3')).toBe("'-2+3");
  });
  it('leaves our own numbers alone', () => {
    expect(toCsv([['Amount'], [-12.5]], { numericCols: [0] })).toBe('Amount\r\n-12.5');
  });
});
