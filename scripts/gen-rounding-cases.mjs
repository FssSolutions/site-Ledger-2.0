// Emits SQL asserting that the app's invoice arithmetic (src/lib/billing.js)
// matches the checks in record_invoice() for many random cases.
import { buildInvoiceLines, totalsFromLines, toRpcLine } from '../src/lib/billing.js';

let seed = 42;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const out = ['begin;'];
for (let c = 0; c < 300; c++) {
  const rate = Math.round(rnd() * 20000) / 100;                 // $0.00 - $200.00
  const taxRate = [0, 5, 7, 12, 13, 4.712, 9.975][Math.floor(rnd() * 7)];
  const job = { id: 'j', name: 'J', rate, pricing_type: 'hourly' };
  const n = 1 + Math.floor(rnd() * 6);
  const sessions = Array.from({ length: n }, (_, i) => {
    const start = Date.UTC(2026, 9, 1 + i, 15, Math.floor(rnd() * 60), Math.floor(rnd() * 60));
    const ms = Math.floor(rnd() * 12 * 3600 * 1000) + 60000;
    return { id: `s${i}`, job_id: 'j', start_time: new Date(start).toISOString(), end_time: new Date(start + ms).toISOString(), break_seconds: Math.floor(rnd() * 1800) };
  }).filter(s => Date.parse(s.end_time) - Date.parse(s.start_time) > s.break_seconds * 1000);
  const lines = buildInvoiceLines(sessions, { jobs: [job], employees: [], company: {} }, () => '2026-10-01').map(toRpcLine);
  const t = totalsFromLines(buildInvoiceLines(sessions, { jobs: [job], employees: [], company: {} }, () => '2026-10-01'), taxRate);
  for (const l of lines) out.push(`select tests.assert(round(${l.quantity}::numeric(10,2) * ${l.unit_price}::numeric(12,2), 2) = ${l.amount}::numeric(12,2), 'line ${c}');`);
  const sub = (t.subtotalCents / 100).toFixed(2);
  out.push(`select tests.assert(round(${sub}::numeric(12,2) * ${taxRate}::numeric(6,3) / 100, 2) = ${(t.taxCents / 100).toFixed(2)}::numeric(12,2), 'tax ${c} at ${taxRate}');`);
}
out.push("select 'rounding_parity: all assertions passed' as result;", 'rollback;');
console.log(out.join('\n'));
