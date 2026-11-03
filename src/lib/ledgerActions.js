// User actions on the local ledger. Every action writes to on-device storage
// first (record + outbox entry atomically) and returns an explicit result:
//   { ok: true, data }  or  { ok: false, error: 'message for the user' }
// Callers update the UI from storage after success, and keep form drafts on
// failure.

import { snapshotFor, numOrNull } from './billing.js';
import { validateSessionTimes } from './time.js';

export function companyFromDb(r) {
  if (!r) return {};
  return {
    id: r.id, name: r.name || '', phone: r.phone || '', email: r.email || '',
    address: r.address || '', gstNumber: r.gst_number || '', worksafeNumber: r.worksafe_number || '',
    logo: r.logo || '', halfDayRate: r.half_day_rate ?? '', fullDayRate: r.full_day_rate ?? '',
  };
}

export function companyToDb(d) {
  const text = v => (v == null || v === '' ? null : String(v));
  return {
    name: text(d.name), phone: text(d.phone), email: text(d.email), address: text(d.address),
    gst_number: text(d.gstNumber), worksafe_number: text(d.worksafeNumber), logo: text(d.logo),
    half_day_rate: numOrNull(d.halfDayRate), full_day_rate: numOrNull(d.fullDayRate),
  };
}

export function jobToDb(j) {
  const pricing = j.pricing_type === 'fixed' ? 'fixed' : 'hourly';
  return {
    name: String(j.name || '').trim(),
    rate: pricing === 'fixed' ? numOrNull(j.rate) ?? 0 : numOrNull(j.rate),
    color: j.color || null,
    notes: j.notes || null,
    status: j.status || 'active',
    address: j.address || null,
    budget_hours: numOrNull(j.budget_hours),
    budget_cost: numOrNull(j.budget_cost),
    pricing_type: pricing,
    half_day_rate: numOrNull(j.half_day_rate),
    full_day_rate: numOrNull(j.full_day_rate),
  };
}

// Splits locally stored sessions into completed entries and open (clocked-in) ones.
export function deriveView(data) {
  const all = data.sessions || [];
  const open = all.filter(s => !s.end_time).sort((a, b) => Date.parse(b.start_time) - Date.parse(a.start_time));
  const profiles = [...(data.company_profiles || [])].sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  return {
    jobs: data.jobs || [],
    employees: data.employees || [],
    customers: data.customers || [],
    mileage: data.mileage || [],
    expenses: data.expenses || [],
    invoices: data.invoices || [],
    invoiceLines: data.invoice_lines || [],
    sessions: all.filter(s => s.end_time),
    active: open[0] || null,
    openSessions: open,
    companyRow: profiles[0] || null,
    company: companyFromDb(profiles[0]),
  };
}

const fail = error => ({ ok: false, error });
const okr = data => ({ ok: true, data });

async function attempt(fn) {
  try { return okr(await fn()); } catch (e) { return fail(e?.message || 'Could not save on this device.'); }
}

export function createActions({ store, getView, now = () => new Date() }) {
  const v = () => getView();
  const jobById = id => v().jobs.find(j => j.id === id) || null;
  const empById = id => (id ? v().employees.find(e => e.id === id) || null : null);
  const snap = (jobId, empId, dayType) => snapshotFor({ job: jobById(jobId), employee: empById(empId), company: v().company, dayType });
  // The screen can lag a tap behind storage; read the latest copy.
  const latestActive = async () => {
    const a = v().active;
    if (!a) return null;
    const rec = await store.getRecord('sessions', a.id).catch(() => null);
    return rec && !rec.deleted && !rec.data.end_time ? rec.data : rec ? null : a;
  };

  return {
    async clockIn(jobId, employeeId = null) {
      if (!jobById(jobId)) return fail('Choose a job first.');
      if (v().active) return fail('You are already clocked in. Clock out first.');
      return attempt(() => store.create('sessions', {
        job_id: jobId, employee_id: employeeId || null, start_time: now().toISOString(),
        break_seconds: 0, break_started_at: null, ...snap(jobId, employeeId, null),
      }));
    },

    async startBreak() {
      const a = await latestActive();
      if (!a) return fail('Not clocked in.');
      if (a.break_started_at) return okr(a);
      return attempt(() => store.update('sessions', a.id, { break_started_at: now().toISOString() }));
    },

    async endBreak() {
      const a = await latestActive();
      if (!a?.break_started_at) return fail('Not on a break.');
      // Round breaks down: never record more break than was taken.
      const add = Math.max(0, Math.floor((now() - Date.parse(a.break_started_at)) / 1000));
      return attempt(() => store.update('sessions', a.id, {
        break_seconds: (Number(a.break_seconds) || 0) + add, break_started_at: null,
      }));
    },

    // Break state is part of the session record, so it survives a failed
    // clock-out, a refresh, or switching devices.
    async clockOut({ endTime = null, dayType = null } = {}) {
      const a = await latestActive();
      if (!a) return fail('Not clocked in.');
      const job = jobById(a.job_id);
      if (job?.pricing_type === 'fixed' && !dayType) return fail('Choose Half Day or Full Day before clocking out.');
      const end = endTime ? new Date(endTime) : now();
      let breakSeconds = Number(a.break_seconds) || 0;
      if (a.break_started_at) {
        const breakStart = Date.parse(a.break_started_at);
        breakSeconds += Math.max(0, Math.floor((Math.max(breakStart, Math.min(end.getTime(), now().getTime())) - breakStart) / 1000));
      }
      // A live timer cannot have more break than elapsed time; guard against
      // rounding so clock-out is never blocked by it.
      const elapsedMs = end.getTime() - Date.parse(a.start_time);
      if (!endTime && elapsedMs > 0 && breakSeconds * 1000 >= elapsedMs) breakSeconds = Math.max(0, Math.ceil(elapsedMs / 1000) - 1);
      if (end.getTime() > now().getTime() + 60000) return fail('Clock-out time cannot be in the future.');
      const err = validateSessionTimes(a.start_time, end, breakSeconds);
      if (err) return fail(err);
      return attempt(() => store.update('sessions', a.id, {
        end_time: end.toISOString(), break_seconds: breakSeconds, break_started_at: null,
        day_type: job?.pricing_type === 'fixed' ? dayType : null,
        ...snap(a.job_id, a.employee_id, job?.pricing_type === 'fixed' ? dayType : null),
      }));
    },

    // Create or edit a completed entry.
    async saveSession(form) {
      const job = jobById(form.job_id);
      if (!job) return fail('Choose a job.');
      const isFixed = job.pricing_type === 'fixed';
      if (isFixed && !form.day_type) return fail('Choose Half Day or Full Day.');
      const breakSeconds = Math.max(0, Math.round(Number(form.break_seconds) || 0));
      const err = validateSessionTimes(form.start_time, form.end_time, breakSeconds);
      if (err) return fail(err);
      const fields = {
        job_id: form.job_id, employee_id: form.employee_id || null,
        start_time: new Date(form.start_time).toISOString(), end_time: new Date(form.end_time).toISOString(),
        notes: form.notes ? String(form.notes) : null, day_type: isFixed ? form.day_type : null,
        break_seconds: breakSeconds,
      };
      if (!form.id) {
        return attempt(() => store.create('sessions', { ...fields, break_started_at: null, ...snap(fields.job_id, fields.employee_id, fields.day_type) }));
      }
      const cur = v().sessions.find(s => s.id === form.id) || v().openSessions.find(s => s.id === form.id);
      if (!cur) return fail('That entry no longer exists on this device.');
      const rateChanged = cur.job_id !== fields.job_id || (cur.employee_id || null) !== fields.employee_id
        || (cur.day_type || null) !== fields.day_type || cur.bill_basis == null;
      return attempt(() => store.update('sessions', form.id, rateChanged ? { ...fields, ...snap(fields.job_id, fields.employee_id, fields.day_type) } : fields));
    },

    async deleteSession(id) { return attempt(() => store.remove('sessions', id)); },

    async addJob(j) {
      const row = jobToDb(j);
      if (!row.name) return fail('Enter a job name.');
      if (row.pricing_type === 'hourly' && row.rate == null) return fail('Enter an hourly rate (0 is allowed).');
      return attempt(() => store.create('jobs', row));
    },
    async updateJob(j) {
      const row = jobToDb(j);
      if (!row.name) return fail('Enter a job name.');
      if (row.pricing_type === 'hourly' && row.rate == null) return fail('Enter an hourly rate (0 is allowed).');
      return attempt(() => store.update('jobs', j.id, row));
    },
    async deleteJob(id) {
      if (v().sessions.some(s => s.job_id === id && s.invoice_id)) return fail('This job has billed hours. Mark it Complete or Archived instead.');
      if (v().active?.job_id === id) return fail('Clock out of this job before deleting it.');
      return attempt(() => store.remove('jobs', id));
    },

    async addEmployee(e) {
      if (!String(e.name || '').trim()) return fail('Enter a name.');
      if (numOrNull(e.rate) == null) return fail('Enter an hourly wage (0 is allowed).');
      return attempt(() => store.create('employees', { name: String(e.name).trim(), rate: numOrNull(e.rate) }));
    },
    async updateEmployee(e) {
      if (!String(e.name || '').trim()) return fail('Enter a name.');
      if (numOrNull(e.rate) == null) return fail('Enter an hourly wage (0 is allowed).');
      return attempt(() => store.update('employees', e.id, { name: String(e.name).trim(), rate: numOrNull(e.rate) }));
    },
    async deleteEmployee(id) {
      if (v().active?.employee_id === id) return fail('Clock this worker out first.');
      return attempt(() => store.remove('employees', id));
    },

    async addCustomer(c) {
      if (!String(c.name || '').trim()) return fail('Enter a customer name.');
      return attempt(() => store.create('customers', { name: String(c.name).trim(), phone: c.phone || null, email: c.email || null, address: c.address || null }));
    },
    async updateCustomer(c) {
      if (!String(c.name || '').trim()) return fail('Enter a customer name.');
      return attempt(() => store.update('customers', c.id, { name: String(c.name).trim(), phone: c.phone || null, email: c.email || null, address: c.address || null }));
    },
    async deleteCustomer(id) { return attempt(() => store.remove('customers', id)); },

    async addMileage(m) {
      const km = numOrNull(m.km);
      if (km == null || km <= 0) return fail('Enter the distance in km.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(m.date || '')) return fail('Enter a date.');
      return attempt(() => store.create('mileage', { job_id: m.job_id || null, date: m.date, km, note: m.note || null }));
    },
    async deleteMileage(id) { return attempt(() => store.remove('mileage', id)); },

    async addExpense(e) {
      const amount = numOrNull(e.amount);
      if (amount == null || amount < 0) return fail('Enter an amount.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date || '')) return fail('Enter a date.');
      if (!String(e.description || '').trim()) return fail('Enter a description.');
      return attempt(() => store.create('expenses', { job_id: e.job_id || null, date: e.date, description: String(e.description).trim(), amount, category: e.category || 'other' }));
    },
    async deleteExpense(id) { return attempt(() => store.remove('expenses', id)); },

    async saveCompany(camel) {
      const row = companyToDb(camel);
      const cur = v().companyRow;
      return attempt(() => (cur ? store.update('company_profiles', cur.id, row) : store.create('company_profiles', row)));
    },
  };
}
