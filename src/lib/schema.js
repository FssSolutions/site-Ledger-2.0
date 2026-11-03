// Which columns the app may write for each synced table. Anything else on a
// local record (sync metadata, server-managed columns such as version,
// updated_at, invoice_id) is never sent from the outbox.

export const SYNCED_TABLES = ['jobs', 'employees', 'customers', 'company_profiles', 'sessions', 'mileage', 'expenses'];
// Pulled for display but only written through dedicated server functions.
export const SERVER_TABLES = ['invoices', 'invoice_lines'];
export const ALL_TABLES = [...SYNCED_TABLES, ...SERVER_TABLES];

export const WRITABLE_FIELDS = {
  jobs: ['name', 'rate', 'color', 'notes', 'status', 'address', 'budget_hours', 'budget_cost', 'pricing_type', 'half_day_rate', 'full_day_rate'],
  employees: ['name', 'rate'],
  customers: ['name', 'phone', 'email', 'address'],
  company_profiles: ['name', 'phone', 'email', 'address', 'gst_number', 'worksafe_number', 'logo', 'half_day_rate', 'full_day_rate'],
  sessions: ['job_id', 'employee_id', 'start_time', 'end_time', 'notes', 'day_type', 'break_seconds', 'break_started_at', 'bill_basis', 'bill_rate', 'cost_rate'],
  mileage: ['job_id', 'date', 'km', 'note'],
  expenses: ['job_id', 'date', 'description', 'amount', 'category'],
};

// Reference columns, so the sync engine can hold back a change that points at
// a record whose own creation has not synced (or failed).
export const REFERENCES = {
  sessions: { job_id: 'jobs', employee_id: 'employees' },
  mileage: { job_id: 'jobs' },
  expenses: { job_id: 'jobs' },
};

// Sync dependency order for a full push: parents before children.
export const TABLE_ORDER = ['jobs', 'employees', 'customers', 'company_profiles', 'sessions', 'mileage', 'expenses'];

export function pickWritable(table, obj) {
  const fields = WRITABLE_FIELDS[table];
  if (!fields) throw new Error(`Table ${table} is not writable through sync`);
  const out = {};
  for (const f of fields) if (Object.prototype.hasOwnProperty.call(obj, f)) out[f] = obj[f] === undefined ? null : obj[f];
  return out;
}

const TIMESTAMP_FIELDS = new Set(['start_time', 'end_time', 'break_started_at', 'created_at', 'updated_at', 'issued_at']);
const NUMERIC_FIELDS = new Set(['rate', 'budget_hours', 'budget_cost', 'half_day_rate', 'full_day_rate', 'km', 'amount', 'break_seconds', 'bill_rate', 'cost_rate']);

// Compares a value we sent with what the server stored, tolerating format
// differences (timestamp offsets, numeric strings) but not value differences.
export function sameValue(field, a, b) {
  if (a == null || a === '') return b == null || b === '';
  if (b == null || b === '') return false;
  if (TIMESTAMP_FIELDS.has(field)) return Date.parse(a) === Date.parse(b);
  if (NUMERIC_FIELDS.has(field)) return Number(a) === Number(b);
  return String(a) === String(b);
}

export function fieldsMatch(fields, serverRow) {
  return Object.keys(fields).every(f => sameValue(f, fields[f], serverRow[f]));
}
