-- Adds fixed-price (half-day / full-day) billing as an alternative to hourly.
alter table jobs add column if not exists pricing_type text not null default 'hourly'
  check (pricing_type in ('hourly', 'fixed'));
alter table jobs add column if not exists half_day_rate numeric;
alter table jobs add column if not exists full_day_rate numeric;

alter table sessions add column if not exists day_type text
  check (day_type in ('half', 'full'));

alter table company_profiles add column if not exists half_day_rate numeric;
alter table company_profiles add column if not exists full_day_rate numeric;
