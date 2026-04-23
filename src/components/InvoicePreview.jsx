import { calcDur, calcEarnings, fmtCAD } from '../lib/utils.js';
import { useAccentColor } from '../lib/AccentColorContext.js';

export default function InvoicePreview({ sessions, jobs, employees, dateRange, company, customer, invoiceNum, selectedJobIds, taxRate }) {
  const accent = useAccentColor();
  const [rs, re] = dateRange;
  const taxPct = Number.isFinite(taxRate) ? taxRate : 5;

  const f = sessions.filter(s => {
    if (!s.end_time) return false;
    const t = new Date(s.start_time);
    if (t < rs || t > re) return false;
    if (selectedJobIds && selectedJobIds.length > 0) return selectedJobIds.includes(s.job_id);
    return true;
  });

  const subtotal = f.reduce((sum, x) => sum + calcEarnings(x, jobs), 0);
  const totalHours = (f.reduce((sum, x) => sum + calcDur(x), 0) / 3600000).toFixed(2);
  const gst = subtotal * (taxPct / 100);
  const grandTotal = subtotal + gst;
  const taxLabel = `GST (${Number.isInteger(taxPct) ? taxPct : taxPct.toFixed(2).replace(/\.?0+$/, '')}%)`;

  const col = { padding: '5px 8px' };
  const colR = { ...col, textAlign: 'right' };

  return (
    <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 12, padding: '18px 16px', fontSize: 12, lineHeight: 1.5 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
        <div style={{ flex: 1 }}>
          {company?.logo && (
            <img src={company.logo} style={{ width: 44, height: 44, objectFit: 'contain', marginBottom: 6, borderRadius: 6 }} alt="logo" />
          )}
          <div style={{ fontSize: 18, fontWeight: 800, color: accent, fontFamily: "'Syne', sans-serif", letterSpacing: 1 }}>INVOICE</div>
          <div style={{ marginTop: 4, color: '#555' }}>
            {company?.name && <div style={{ fontWeight: 700, color: '#111', fontSize: 13 }}>{company.name}</div>}
            {company?.address && <div>{company.address}</div>}
            {company?.phone && <div>{company.phone}</div>}
            {company?.email && <div>{company.email}</div>}
            {company?.gstNumber && <div>GST #: {company.gstNumber}</div>}
            {company?.worksafeNumber && <div>WorkSafe BC #: {company.worksafeNumber}</div>}
          </div>
        </div>
        <div style={{ textAlign: 'right', color: '#666', flexShrink: 0, marginLeft: 12 }}>
          <div>
            <span>Invoice #: </span>
            <span style={{ fontWeight: 600, color: '#111' }}>{invoiceNum || 'INV-001'}</span>
          </div>
          <div>Date: {new Date().toLocaleDateString('en-CA')}</div>
          <div>Period:</div>
          <div>{rs.toLocaleDateString('en-CA')}</div>
          <div>to {re.toLocaleDateString('en-CA')}</div>
        </div>
      </div>

      {/* Bill To */}
      {customer && (
        <div style={{ marginBottom: 14, padding: '10px 12px', background: '#f9f9f9', borderRadius: 8 }}>
          <div style={{ color: '#999', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>Bill To</div>
          <div style={{ fontWeight: 700, color: '#111' }}>{customer.name}</div>
          {customer.address && <div style={{ color: '#555' }}>{customer.address}</div>}
          {customer.phone && <div style={{ color: '#555' }}>{customer.phone}</div>}
          {customer.email && <div style={{ color: '#555' }}>{customer.email}</div>}
        </div>
      )}

      {/* Labour table */}
      {f.length > 0 ? (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontWeight: 700, color: '#111', marginBottom: 6, fontSize: 13 }}>Labour</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ background: accent, color: '#fff' }}>
                  {['Date', 'Job', 'Employee', 'Hours', 'Rate', 'Amount'].map(h => (
                    <th key={h} style={{ padding: '6px 8px', textAlign: ['Hours', 'Rate', 'Amount'].includes(h) ? 'right' : 'left', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {f.map((s, i) => {
                  const j = jobs.find(x => x.id === s.job_id);
                  const emp = employees.find(x => x.id === s.employee_id);
                  const hrs = (calcDur(s) / 3600000).toFixed(2);
                  const earn = calcEarnings(s, jobs);
                  return (
                    <tr key={s.id || i} style={{ background: i % 2 === 0 ? '#fff' : '#f9f9f9', borderBottom: '1px solid #eee' }}>
                      <td style={col}>{new Date(s.start_time).toLocaleDateString('en-CA')}</td>
                      <td style={col}>{j?.name || ''}</td>
                      <td style={col}>{emp?.name || 'Owner'}</td>
                      <td style={colR}>{hrs}</td>
                      <td style={{ ...colR, whiteSpace: 'nowrap' }}>{fmtCAD(j?.rate || 0)}/hr</td>
                      <td style={{ ...colR, whiteSpace: 'nowrap' }}>{fmtCAD(earn)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ background: '#f0f0f0', fontWeight: 700 }}>
                  <td colSpan={3} style={col}>Subtotal</td>
                  <td style={colR}>{totalHours}</td>
                  <td />
                  <td style={{ ...colR, whiteSpace: 'nowrap' }}>{fmtCAD(subtotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      ) : (
        <div style={{ color: '#bbb', fontSize: 12, padding: '16px 0', textAlign: 'center' }}>No sessions found for this period</div>
      )}

      {/* Totals */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', width: 200, color: '#666' }}>
          <span>Subtotal:</span>
          <span style={{ fontWeight: 600, color: '#111' }}>{fmtCAD(subtotal)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', width: 200, color: '#666' }}>
          <span>{taxLabel}:</span>
          <span style={{ fontWeight: 600, color: '#111' }}>{fmtCAD(gst)}</span>
        </div>
        <div style={{ width: 200, height: 1, background: accent, margin: '4px 0' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', width: 200, fontSize: 15, fontWeight: 800, color: '#111' }}>
          <span>Total Due:</span>
          <span>{fmtCAD(grandTotal)}</span>
        </div>
        {company?.gstNumber && (
          <div style={{ color: '#bbb', fontSize: 10, marginTop: 2 }}>GST Reg: {company.gstNumber}</div>
        )}
      </div>

      <div style={{ borderTop: '1px solid #eee', paddingTop: 8, color: '#ccc', fontSize: 10 }}>Generated by SiteLedger</div>
    </div>
  );
}
