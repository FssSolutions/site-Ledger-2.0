import { describe, it, expect } from 'vitest';
import { buildInvoicePdf } from '../src/lib/generateInvoice.js';
import { buildInvoiceLines, totalsFromLines, toRpcLine } from '../src/lib/billing.js';
import { localDateKey } from '../src/lib/time.js';

const job = { id: 'j1', name: 'Basement suite, "Unit B"', rate: 65, pricing_type: 'hourly' };
const fixed = { id: 'j2', name: 'Deck', pricing_type: 'fixed', full_day_rate: 750, rate: 0 };
const emp = { id: 'e1', name: 'Sam', rate: 40 };
const data = { jobs: [job, fixed], employees: [emp], company: {} };

function realisticSessions(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const day = new Date(2026, 9, 1 + (i % 28), 8, 0);
    const fixedDay = i % 7 === 0;
    out.push({
      id: `s${i}`, job_id: fixedDay ? 'j2' : 'j1', employee_id: i % 2 ? 'e1' : null,
      start_time: day.toISOString(), end_time: new Date(day.getTime() + (7.5 + (i % 3) * 0.25) * 3600000).toISOString(),
      break_seconds: i % 4 === 0 ? 1800 : 0, day_type: fixedDay ? 'full' : null,
    });
  }
  return out;
}

// What record_invoice() returns: the stored lines and totals.
function recorded(sessions, taxRate = 5) {
  const lines = buildInvoiceLines(sessions, data, localDateKey);
  const t = totalsFromLines(lines, taxRate);
  return {
    invoice: { notes: 'INV-042', date_generated: '2026-10-31', date_range_start: '2026-10-01', date_range_end: '2026-10-31', customer_name: 'Pat Example',
      subtotal: (t.subtotalCents / 100).toFixed(2), tax_rate: taxRate, tax_amount: (t.taxCents / 100).toFixed(2), calculated_total: (t.totalCents / 100).toFixed(2), amount: (t.totalCents / 100).toFixed(2) },
    lines: lines.map(toRpcLine),
    totals: t,
  };
}

const pdfText = doc => new TextDecoder('latin1').decode(doc.output('arraybuffer'));
const money = c => new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(c / 100);

describe('invoice PDF', () => {
  it('paginates 120 lines, repeats headers, and keeps totals that match the recorded invoice', () => {
    const { invoice, lines, totals } = recorded(realisticSessions(120));
    const doc = buildInvoicePdf({ invoice, lines, company: { name: 'Example Carpentry' } });
    const pages = doc.getNumberOfPages();
    expect(pages).toBeGreaterThan(2);
    const text = pdfText(doc);
    expect(text).toContain(`Page ${pages} of ${pages}`);
    // table header repeated on every page that has table rows (the totals
    // block may start a page of its own)
    expect((text.match(/\(Amount\)/g) || []).length).toBeGreaterThanOrEqual(pages - 1);
    expect(text).toContain(`(${money(totals.subtotalCents)})`);
    expect(text).toContain(`(${money(totals.taxCents)})`);
    expect(text).toContain(`(${money(totals.totalCents)})`);
    // the sum of printed line amounts equals the printed subtotal
    const sum = lines.reduce((a, l) => a + Math.round(Number(l.amount) * 100), 0);
    expect(sum).toBe(totals.subtotalCents);
  });

  it('shows the customer rate, not the employee wage, and labels agree with amounts', () => {
    const s = [{ id: 'x', job_id: 'j1', employee_id: 'e1', start_time: '2026-10-01T15:00:00Z', end_time: '2026-10-01T23:00:00Z' }];
    const { invoice, lines } = recorded(s, 5);
    const text = pdfText(buildInvoicePdf({ invoice, lines }));
    expect(text).toContain('($65.00)');
    expect(text).toContain('($520.00)');
    expect(text).not.toContain('($40.00)');
    expect(text).toContain('($546.00)');
    expect(text).toContain('(GST \\(5%\\):)');
  });

  it('fixed-price lines print as one day at the day rate', () => {
    const s = [{ id: 'f', job_id: 'j2', start_time: '2026-10-02T15:00:00Z', end_time: '2026-10-02T23:00:00Z', day_type: 'full' }];
    const { invoice, lines } = recorded(s, 0);
    const text = pdfText(buildInvoicePdf({ invoice, lines }));
    expect(text).toContain('(full day)');
    expect(text).toContain('($750.00)');
  });
});
