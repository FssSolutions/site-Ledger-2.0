// Vercel Serverless Function — runs every Monday 8 AM UTC via Vercel Cron
// Sends a weekly summary email to each user via Resend
//
// Required env vars in Vercel dashboard:
//   RESEND_API_KEY    — from resend.com
//   SUPABASE_URL      — your Supabase project URL
//   SUPABASE_SERVICE_KEY — Supabase service_role key (NOT the anon key)
//   EMAIL_FROM        — sender address, e.g. "SiteLedger <noreply@yourdomain.com>"

export default async function handler(req, res) {
  // Only allow Vercel cron or authorized calls
  const authHeader = req.headers['authorization'];
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const EMAIL_FROM = process.env.EMAIL_FROM || 'SiteLedger <noreply@siteledger.app>';

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !RESEND_API_KEY) {
    return res.status(500).json({ error: 'Missing environment variables' });
  }

  const headers = {
    'Content-Type': 'application/json',
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
  };

  try {
    // Get all users
    const usersRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, { headers });
    const usersData = await usersRes.json();
    const users = usersData.users || [];

    // Date range: last 7 days
    const now = new Date();
    const weekAgo = new Date(now);
    weekAgo.setDate(now.getDate() - 7);
    weekAgo.setHours(0, 0, 0, 0);
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);

    const isoStart = weekAgo.toISOString();
    const isoEnd = endOfToday.toISOString();

    let sent = 0;

    for (const user of users) {
      // Fetch sessions for this user in the past week
      const sessUrl = `${SUPABASE_URL}/rest/v1/sessions?user_id=eq.${user.id}&start_time=gte.${isoStart}&start_time=lte.${isoEnd}&select=*`;
      const sessRes = await fetch(sessUrl, { headers });
      const sessions = await sessRes.json();

      if (!Array.isArray(sessions) || sessions.length === 0) continue;

      // Fetch jobs for the user
      const jobsRes = await fetch(`${SUPABASE_URL}/rest/v1/jobs?user_id=eq.${user.id}&select=*`, { headers });
      const jobs = await jobsRes.json();
      const jobMap = {};
      (jobs || []).forEach(j => { jobMap[j.id] = j; });

      // Fetch employees
      const empRes = await fetch(`${SUPABASE_URL}/rest/v1/employees?user_id=eq.${user.id}&select=*`, { headers });
      const employees = await empRes.json();
      const empMap = {};
      (employees || []).forEach(e => { empMap[e.id] = e; });

      // Calculate stats
      let totalMs = 0;
      let totalEarnings = 0;
      const dailyHours = {};

      sessions.filter(s => s.end_time).forEach(s => {
        const dur = new Date(s.end_time) - new Date(s.start_time);
        totalMs += dur;
        const job = jobMap[s.job_id];
        if (job) totalEarnings += (dur / 3600000) * job.rate;

        const dk = s.start_time.slice(0, 10);
        dailyHours[dk] = (dailyHours[dk] || 0) + dur / 3600000;
      });

      const totalHrs = totalMs / 3600000;

      // Overtime flags
      const otDays = Object.entries(dailyHours)
        .filter(([, h]) => h > 8)
        .map(([d, h]) => ({ date: d, hours: h.toFixed(1), ot: (h - 8).toFixed(1) }));

      const weeklyOT = totalHrs > 44 ? (totalHrs - 44).toFixed(1) : null;

      // Build email HTML
      const fmtCAD = n => new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(n || 0);
      const fmtHrs = h => `${Math.floor(h)}h ${Math.round((h % 1) * 60)}m`;

      let otSection = '';
      if (otDays.length > 0 || weeklyOT) {
        otSection = `
          <div style="background:#FEF5E7;border-left:4px solid #E67E22;padding:12px 16px;border-radius:8px;margin:16px 0;">
            <strong style="color:#E67E22;">Overtime Flagged</strong><br/>
            ${weeklyOT ? `<span style="color:#C0392B;">Weekly total: ${fmtHrs(totalHrs)} (${weeklyOT}h over 44h limit)</span><br/>` : ''}
            ${otDays.map(d => `<span style="color:#E67E22;">${d.date}: ${d.hours}h (${d.ot}h OT)</span>`).join('<br/>')}
          </div>`;
      }

      // Job breakdown
      const jobBreakdown = {};
      sessions.filter(s => s.end_time).forEach(s => {
        const jName = jobMap[s.job_id]?.name || 'Unknown';
        if (!jobBreakdown[jName]) jobBreakdown[jName] = { hrs: 0, earn: 0 };
        const dur = (new Date(s.end_time) - new Date(s.start_time)) / 3600000;
        jobBreakdown[jName].hrs += dur;
        const job = jobMap[s.job_id];
        if (job) jobBreakdown[jName].earn += dur * job.rate;
      });

      const jobRows = Object.entries(jobBreakdown)
        .sort((a, b) => b[1].earn - a[1].earn)
        .map(([name, { hrs, earn }]) =>
          `<tr><td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;">${name}</td><td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;text-align:right;">${fmtHrs(hrs)}</td><td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;text-align:right;">${fmtCAD(earn)}</td></tr>`
        ).join('');

      const html = `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:500px;margin:0 auto;color:#333;">
          <div style="background:#E8651A;color:#fff;padding:20px 24px;border-radius:12px 12px 0 0;">
            <h1 style="margin:0;font-size:20px;">SiteLedger Weekly Summary</h1>
            <p style="margin:4px 0 0;opacity:0.8;font-size:13px;">${weekAgo.toLocaleDateString('en-CA')} — ${now.toLocaleDateString('en-CA')}</p>
          </div>
          <div style="background:#fff;border:1px solid #e8e8e8;border-top:none;padding:24px;border-radius:0 0 12px 12px;">
            <div style="display:flex;gap:16px;margin-bottom:20px;">
              <div style="flex:1;background:#f9f9f9;padding:16px;border-radius:8px;text-align:center;">
                <div style="color:#999;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Hours</div>
                <div style="font-size:22px;font-weight:700;">${fmtHrs(totalHrs)}</div>
              </div>
              <div style="flex:1;background:#f9f9f9;padding:16px;border-radius:8px;text-align:center;">
                <div style="color:#999;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Earned</div>
                <div style="font-size:22px;font-weight:700;color:#E8651A;">${fmtCAD(totalEarnings)}</div>
              </div>
            </div>
            ${otSection}
            <table style="width:100%;border-collapse:collapse;margin-top:16px;">
              <thead><tr style="background:#f9f9f9;">
                <th style="padding:8px 12px;text-align:left;font-size:11px;color:#999;text-transform:uppercase;">Job</th>
                <th style="padding:8px 12px;text-align:right;font-size:11px;color:#999;text-transform:uppercase;">Hours</th>
                <th style="padding:8px 12px;text-align:right;font-size:11px;color:#999;text-transform:uppercase;">Earned</th>
              </tr></thead>
              <tbody>${jobRows}</tbody>
            </table>
            <p style="color:#aaa;font-size:11px;margin-top:20px;text-align:center;">Sent by SiteLedger · Manage notifications in app settings</p>
          </div>
        </div>`;

      // Send via Resend
      const emailRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
        body: JSON.stringify({
          from: EMAIL_FROM,
          to: user.email,
          subject: `SiteLedger: ${fmtHrs(totalHrs)} logged, ${fmtCAD(totalEarnings)} earned this week`,
          html,
        }),
      });

      if (emailRes.ok) sent++;
    }

    return res.status(200).json({ ok: true, sent });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
