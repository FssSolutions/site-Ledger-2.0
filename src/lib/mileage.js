// Mileage estimate at CRA "reasonable allowance" per-km rates.
//
// This is an ESTIMATE for reference, not a tax deduction: self-employed
// vehicle expenses are claimed from actual costs × business-use percentage,
// and this log supports that business-use record. The allowance is tiered:
// one rate for the first 5,000 km in a calendar year, a lower rate after.
//
// `verified: false` marks rates that have not been confirmed against CRA's
// published figures for that year. Check https://www.canada.ca (search
// "automobile allowance rates") each January and update this table.

export const CRA_ALLOWANCE = {
  2024: { first5000: 0.70, after: 0.64, verified: true },
  2025: { first5000: 0.72, after: 0.66, verified: true },
  // 0.72 was entered for 2026 in an earlier release; the 2026 "after 5,000 km"
  // rate is carried from 2025 and needs confirming.
  2026: { first5000: 0.72, after: 0.66, verified: false },
};

export function ratesForYear(year) {
  if (CRA_ALLOWANCE[year]) return { year, ...CRA_ALLOWANCE[year] };
  const known = Object.keys(CRA_ALLOWANCE).map(Number).sort((a, b) => a - b);
  const fallback = known.filter(y => y <= year).pop() ?? known[0];
  return { year, ...CRA_ALLOWANCE[fallback], verified: false, carriedFrom: fallback };
}

// Applies the tier in date order within each calendar year. Returns per-trip
// estimates (cents) keyed by trip id.
export function mileageEstimates(trips) {
  const sorted = [...trips].sort((a, b) => (a.date === b.date ? String(a.id).localeCompare(String(b.id)) : a.date < b.date ? -1 : 1));
  const usedByYear = {};
  const out = {};
  for (const t of sorted) {
    const year = Number(String(t.date).slice(0, 4));
    const rates = ratesForYear(year);
    const km = Math.max(0, Number(t.km) || 0);
    const used = usedByYear[year] || 0;
    const inFirst = Math.max(0, Math.min(km, 5000 - used));
    const after = km - inFirst;
    usedByYear[year] = used + km;
    out[t.id] = { cents: Math.round(inFirst * rates.first5000 * 100 + after * rates.after * 100), verified: rates.verified, year };
  }
  return out;
}

export function totalEstimateCents(trips, ids = null) {
  const est = mileageEstimates(trips);
  return Object.entries(est).reduce((a, [id, e]) => (ids && !ids.has(id) ? a : a + e.cents), 0);
}
