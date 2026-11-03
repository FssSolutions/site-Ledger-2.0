// CSV export with RFC 4180 quoting and protection against spreadsheet
// formula injection (cells starting with = + - @ tab or CR are prefixed with
// an apostrophe so Excel/Sheets show them as text).

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value, { numeric = false } = {}) {
  if (value == null) return '';
  let s = String(value);
  if (!numeric && FORMULA_START.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s) || s !== s.trim()) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

// rows: array of arrays. numericCols: indexes of columns holding numbers we
// generated ourselves (so negative numbers are not prefixed).
export function toCsv(rows, { numericCols = [] } = {}) {
  const nums = new Set(numericCols);
  return rows.map((r, ri) => r.map((c, ci) => csvCell(c, { numeric: ri > 0 && nums.has(ci) && typeof c === 'number' })).join(',')).join('\r\n');
}

export function downloadText(filename, text, type = 'text/csv;charset=utf-8') {
  const blob = new Blob(['﻿', text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
