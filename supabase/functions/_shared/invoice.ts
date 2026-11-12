// Sending a recorded SiteLedger invoice to QuickBooks Online.
//
// Order of operations (see docs/QUICKBOOKS_PLAN.md): the hours are claimed
// first by record_invoice(); only then is the QuickBooks invoice created, and
// its id stored on our invoice. If QuickBooks fails, the invoice stays
// recorded here as "failed" and can be retried.
//
// No duplicates: every create request carries a request id made from our
// invoice id, so repeating a request whose reply was lost returns the same
// QuickBooks invoice. The counter in the request id only moves on when
// QuickBooks definitely refused a request, so a corrected retry is sent as
// a new request.
import { type QboConfig, type Connection, type QboSettings, QboError, qboFetch, qboQuery, db, validQboId } from './qbo.ts';

// ---- pure helpers (unit-tested) ---------------------------------------------

// Escapes a value for a QuickBooks query string literal.
export const escapeQueryValue = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

// QuickBooks display names cannot contain colons, tabs or line breaks.
export function cleanDisplayName(name: unknown) {
  return (typeof name === 'string' ? name : '').replace(/[:\t\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const validEmail = (v: string) => /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(v) && v.length <= 100;

export interface CustomerRow { id: string; name: string; email?: string | null; phone?: string | null; address?: string | null }

export function customerPayload(c: CustomerRow) {
  const email = text(c.email, 100);
  const phone = text(c.phone, 30);
  const address = text(c.address, 500);
  return {
    DisplayName: cleanDisplayName(c.name),
    ...(validEmail(email) ? { PrimaryEmailAddr: { Address: email } } : {}),
    ...(phone ? { PrimaryPhone: { FreeFormNumber: phone } } : {}),
    ...(address ? { BillAddr: { Line1: address } } : {}),
  };
}

export interface LineRow {
  work_date: string | null;
  description: string | null;
  worker_name: string | null;
  quantity: string | number;
  unit: string;
  unit_price: string | number;
  amount: string | number;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "Oct 14 · Kitchen reno · Mike (half day)". The date is a plain calendar
// date, so it is formatted without any time-zone conversion.
export function lineDescription(l: LineRow) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(l.work_date || '');
  const date = m && MONTHS[Number(m[2]) - 1] ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}` : '';
  const unit = l.unit === 'half_day' ? ' (half day)' : l.unit === 'full_day' ? ' (full day)' : '';
  return [date, text(l.description, 200), text(l.worker_name, 100)].filter(Boolean).join(' · ') + unit;
}

export function itemIdFor(unit: string, s: QboSettings) {
  if (unit === 'half_day') return s.half_day_item_id || s.labour_item_id;
  if (unit === 'full_day') return s.full_day_item_id || s.labour_item_id;
  return s.labour_item_id;
}

// The next invoice number, following the pattern of the most recent numbered
// invoice ("1002" -> "1003", "INV-0099" -> "INV-0100") and skipping numbers
// already in use. `recent` is DocNumbers, newest first.
export function nextDocNumber(recent: unknown[]) {
  const used = new Set(recent.filter((d): d is string => typeof d === 'string' && d.trim() !== '').map(d => d.trim()));
  let prefix = '';
  let digits = '1000';
  for (const d of recent) {
    const m = typeof d === 'string' ? /^(.*?)(\d{1,15})$/.exec(d.trim()) : null;
    if (m) { prefix = m[1]; digits = m[2]; break; }
  }
  let n = BigInt(digits);
  for (let i = 0; i < 1000; i += 1) {
    n += 1n;
    const candidate = prefix + n.toString().padStart(digits.length, '0');
    if (candidate.length > 21) return null; // QuickBooks' limit for invoice numbers
    if (!used.has(candidate)) return candidate;
  }
  return null;
}

export interface InvoiceInput {
  // Only when the QuickBooks company uses custom transaction numbers;
  // otherwise QuickBooks numbers the invoice itself.
  docNumber?: string | null;
  invoiceId: string;
  txnDate: string | null;
  customerRef: string;
  lines: LineRow[];
  settings: QboSettings;
  billEmail?: string | null;
}

// One QuickBooks line per recorded line. Amounts are before tax; QuickBooks
// calculates the tax from the tax code.
export function buildInvoicePayload(input: InvoiceInput) {
  const email = text(input.billEmail, 100);
  return {
    CustomerRef: { value: input.customerRef },
    ...(input.docNumber ? { DocNumber: input.docNumber } : {}),
    ...(input.txnDate && /^\d{4}-\d{2}-\d{2}$/.test(input.txnDate) ? { TxnDate: input.txnDate } : {}),
    PrivateNote: `SiteLedger ${input.invoiceId}`,
    GlobalTaxCalculation: 'TaxExcluded',
    ...(validEmail(email) ? { BillEmail: { Address: email } } : {}),
    Line: input.lines.map(l => ({
      DetailType: 'SalesItemLineDetail',
      Amount: Number(l.amount),
      Description: lineDescription(l),
      SalesItemLineDetail: {
        ItemRef: { value: itemIdFor(l.unit, input.settings) },
        Qty: Number(l.quantity),
        UnitPrice: Number(l.unit_price),
        TaxCodeRef: { value: input.settings.tax_code_id },
        ...(l.work_date && /^\d{4}-\d{2}-\d{2}$/.test(l.work_date) ? { ServiceDate: l.work_date } : {}),
      },
    })),
  };
}

export interface InvoiceResult { id: string; docNumber: string | null; total: number | null; tax: number | null; balance: number | null }

export function parseInvoiceResult(data: unknown): InvoiceResult | null {
  // deno-lint-ignore no-explicit-any
  const inv = (data as any)?.Invoice;
  if (!validQboId(inv?.Id)) return null;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
  return {
    id: inv.Id,
    docNumber: text(inv.DocNumber, 40) || null,
    total: num(inv.TotalAmt),
    tax: num(inv.TxnTaxDetail?.TotalTax),
    balance: num(inv.Balance),
  };
}

// QuickBooks' own explanation of a refused request, shortened.
export function faultMessage(data: unknown) {
  // deno-lint-ignore no-explicit-any
  const e = (data as any)?.Fault?.Error?.[0] ?? (data as any)?.fault?.error?.[0];
  return text(e?.Detail ?? e?.detail, 240) || text(e?.Message ?? e?.message, 240) || 'no reason was given';
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---- database as the user ---------------------------------------------------

// PostgREST request with the CALLER's token, so RLS decides what is visible.
// Used to read the user's own invoice, lines and customer, and to call
// record_invoice().
export function userDb(cfg: QboConfig, authHeader: string, path: string, init: { method?: string; body?: unknown } = {}) {
  return fetch(`${cfg.supabaseUrl}/rest/v1/${path}`, {
    method: init.method || 'GET',
    headers: { apikey: cfg.anonKey, Authorization: authHeader, 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(20_000),
  });
}

// ---- sending ----------------------------------------------------------------

// A problem that is explained to the user as-is.
class PushError extends Error {}

async function ensureCustomer(cfg: QboConfig, conn: Connection, customer: CustomerRow): Promise<{ id: string; fromLink: boolean }> {
  const name = cleanDisplayName(customer.name);
  if (!name) throw new PushError('The customer has no name. Add one under Company → Customers, then tap Retry.');

  const linked = await db(cfg, `qbo_customer_links?customer_id=eq.${customer.id}&realm_id=eq.${conn.realmId}&select=qbo_customer_id`);
  if (!linked.ok) throw new QboError('unavailable');
  const known = (await linked.json())?.[0]?.qbo_customer_id;
  if (validQboId(known)) return { id: known, fromLink: true };

  // Same name already in QuickBooks: use it. Otherwise add the customer.
  const found = await qboQuery(cfg, conn, `select * from Customer where DisplayName = '${escapeQueryValue(name)}'`);
  let id: unknown = found?.Customer?.[0]?.Id;
  if (!validQboId(id)) {
    const r = await qboFetch(cfg, conn, 'customer', { method: 'POST', body: customerPayload(customer) });
    const data = await r.json().catch(() => null);
    if (!r.ok) {
      if (r.status >= 400 && r.status < 500 && r.status !== 429) throw new PushError(`QuickBooks could not add the customer "${name}": ${faultMessage(data)}`);
      throw new QboError('unavailable');
    }
    id = data?.Customer?.Id;
    if (!validQboId(id)) throw new QboError('unavailable');
  }
  const saved = await db(cfg, 'qbo_customer_links?on_conflict=customer_id,realm_id', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: { customer_id: customer.id, realm_id: conn.realmId, user_id: conn.userId, qbo_customer_id: id },
  });
  await saved.body?.cancel(); // the link is a shortcut; the next invoice finds the customer by name again if this failed
  return { id, fromLink: false };
}

// When the QuickBooks company has "custom transaction numbers" on, QuickBooks
// leaves the invoice number blank unless we send one. Returns the next number
// in that case, or null when QuickBooks numbers invoices itself. Best effort:
// on any trouble the invoice is still created, just without a number.
async function docNumberIfNeeded(cfg: QboConfig, conn: Connection): Promise<string | null> {
  try {
    const r = await qboFetch(cfg, conn, 'preferences');
    if (!r.ok) { await r.body?.cancel(); return null; }
    if ((await r.json())?.Preferences?.SalesFormsPrefs?.CustomTxnNumbers !== true) return null;
    const recent = await qboQuery(cfg, conn, 'select DocNumber from Invoice orderby MetaData.CreateTime desc maxresults 200');
    // deno-lint-ignore no-explicit-any
    return nextDocNumber((Array.isArray(recent?.Invoice) ? recent.Invoice : []).map((i: any) => i?.DocNumber));
  } catch {
    return null;
  }
}

// deno-lint-ignore no-explicit-any
export type PushResult = { ok: boolean; error: string | null; invoice: any };

// Creates the QuickBooks invoice for an already-recorded SiteLedger invoice
// and stores the result on it. Never throws: the outcome is in the result
// and on the invoice row (qbo_status, qbo_error).
// deno-lint-ignore no-explicit-any
export async function pushInvoice(cfg: QboConfig, conn: Connection, invoice: any, lines: LineRow[], customer: CustomerRow): Promise<PushResult> {
  if (invoice.qbo_invoice_id) return { ok: true, error: null, invoice };
  if (invoice.qbo_status != null && invoice.qbo_status !== 'pending' && invoice.qbo_status !== 'failed') {
    return { ok: false, error: 'This invoice cannot be sent to QuickBooks.', invoice };
  }

  // Only ever touches an invoice that has no QuickBooks id yet.
  const patch = async (fields: Record<string, unknown>) => {
    try {
      const r = await db(cfg, `invoices?id=eq.${invoice.id}&qbo_invoice_id=is.null`, { method: 'PATCH', prefer: 'return=representation', body: fields });
      if (!r.ok) { await r.body?.cancel(); return null; }
      return (await r.json())?.[0] ?? null;
    } catch {
      return null;
    }
  };

  const row = await patch({ qbo_status: 'pending', qbo_realm_id: conn.realmId, qbo_error: null });
  if (!row) return { ok: false, error: 'Could not update the invoice. Tap Retry.', invoice };

  const fail = async (message: string, refused: boolean) => {
    const error = message.slice(0, 300);
    const saved = await patch({ qbo_status: 'failed', qbo_error: error, ...(refused ? { qbo_attempt: (Number(row.qbo_attempt) || 0) + 1 } : {}) });
    return { ok: false, error, invoice: saved ?? { ...row, qbo_status: 'failed', qbo_error: error } };
  };

  try {
    const cust = await ensureCustomer(cfg, conn, customer);
    const payload = buildInvoicePayload({
      docNumber: await docNumberIfNeeded(cfg, conn),
      invoiceId: row.id,
      txnDate: row.date_generated,
      customerRef: cust.id,
      lines,
      settings: conn.settings,
      billEmail: customer.email,
    });
    const r = await qboFetch(cfg, conn, `invoice?requestid=${row.id}-${Number(row.qbo_attempt) || 0}`, { method: 'POST', body: payload });
    const data = await r.json().catch(() => null);
    if (!r.ok) {
      if (r.status >= 400 && r.status < 500 && r.status !== 429) {
        // A stored customer link may point at a customer that was deleted or
        // merged in QuickBooks; forget it so the retry looks the customer up again.
        if (cust.fromLink) await db(cfg, `qbo_customer_links?customer_id=eq.${customer.id}&realm_id=eq.${conn.realmId}`, { method: 'DELETE' }).then(x => x.body?.cancel()).catch(() => null);
        return await fail(`QuickBooks did not accept the invoice: ${faultMessage(data)}`, true);
      }
      return await fail('QuickBooks is having trouble right now. Tap Retry in a few minutes.', false);
    }
    const res = parseInvoiceResult(data);
    if (!res) return await fail('QuickBooks answered in an unexpected way. Tap Retry; it will not create a second invoice.', false);

    const done = await patch({
      qbo_status: 'created',
      qbo_invoice_id: res.id,
      qbo_doc_number: res.docNumber,
      qbo_total: res.total,
      qbo_tax: res.tax,
      qbo_balance: res.balance,
      qbo_error: null,
      qbo_synced_at: new Date().toISOString(),
    });
    // Created in QuickBooks but not saved here: the row stays "pending", and
    // Retry repeats the same request id, which returns this same invoice.
    if (!done) return { ok: false, error: 'The invoice was created in QuickBooks, but saving that here failed. Tap Retry; it will not create a second invoice.', invoice: row };
    return { ok: true, error: null, invoice: done };
  } catch (ex) {
    if (ex instanceof PushError) return await fail(ex.message, false);
    if (ex instanceof QboError && ex.kind === 'reconnect') return await fail('QuickBooks needs to be reconnected (Company → Profile). Then tap Retry.', false);
    return await fail('QuickBooks could not be reached. Tap Retry when you have a connection.', false);
  }
}
