// Browser test of the basement workflow against the production build.
//   npm run test:e2e
// Builds with a local mock Supabase, serves dist/, and drives Chromium.
import { spawn, execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { startMock } from './mockSupabase.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const MOCK = 54321;
const APP = 4173;
const BASE = `http://localhost:${APP}`;

let failures = 0;
let lastPage = null;
function check(cond, msg) {
  if (cond) console.log(`  ok   ${msg}`);
  else { failures += 1; console.log(`  FAIL ${msg}`); }
}
async function waitFor(fn, msg, timeout = 15000) {
  const t0 = Date.now();
  for (;;) {
    try { if (await fn()) { check(true, msg); return true; } } catch { /* retry */ }
    if (Date.now() - t0 > timeout) { check(false, `${msg} (timed out)`); return false; }
    await new Promise(r => setTimeout(r, 200));
  }
}

const env = { ...process.env, VITE_SUPABASE_URL: `http://127.0.0.1:${MOCK}`, VITE_SUPABASE_ANON_KEY: 'test-anon-key' };
execSync('npx vite build --logLevel error', { env, stdio: 'inherit' });
const mock = await startMock({ port: MOCK });
const preview = spawn('npx', ['vite', 'preview', '--port', String(APP), '--strictPort'], { env, stdio: 'ignore' });
const browser = await chromium.launch();

async function signIn(page, email, password) {
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.locator('form').getByRole('button', { name: 'Sign In' }).click();
  await page.getByRole('navigation', { name: 'Main' }).waitFor({ timeout: 15000 });
}
async function openMore(page, name) {
  await page.getByRole('button', { name: 'More' }).click();
  await page.locator('#more-menu').getByRole('button', { name }).click();
}
async function signOut(page, keepPending = false) {
  await page.getByRole('button', { name: 'Sign out' }).click();
  const label = keepPending ? 'Sign out and keep changes on this device' : 'Sign out';
  await page.getByRole('dialog').getByRole('button', { name: label, exact: true }).click();
  await page.getByLabel('Email').waitFor({ timeout: 15000 });
}

try {
  await waitFor(async () => (await fetch(BASE)).ok, 'preview server is up');
  mock.addUser('a@example.test', 'password-a');
  mock.addUser('b@example.test', 'password-b');
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  lastPage = page;
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_INTERNET_DISCONNECTED|Failed to fetch/.test(m.text())) console.log('  console:', m.text().slice(0, 200)); });
  page.on('pageerror', e => { failures += 1; console.log('  PAGE ERROR', e.message); });

  console.log('Online setup');
  await page.goto(BASE);
  await signIn(page, 'a@example.test', 'password-a');
  await openMore(page, 'Jobs');
  await page.getByRole('button', { name: 'New Job' }).click();
  await page.getByLabel('Job name').fill('Basement reno');
  await page.getByLabel('Customer rate (CAD per hour)').fill('65');
  await page.getByRole('button', { name: 'Add Job' }).click();
  await waitFor(() => mock.rows('jobs').length === 1, 'job synced to server');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await waitFor(() => page.evaluate(() => !!navigator.serviceWorker.controller), 'service worker controls the page');

  console.log('Offline in the basement');
  await context.setOffline(true);
  await page.reload();
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Clock' }).click();
  check(await page.getByText('Basement reno').first().isVisible(), 'app opens offline with cached jobs');
  await page.getByRole('button', { name: 'Clock In' }).last().click();
  await page.getByRole('button', { name: 'Take a Break' }).click();
  await page.waitForTimeout(1500);
  await page.reload(); // refresh mid-break
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Clock' }).click();
  check(await page.getByText('ON BREAK').isVisible(), 'break survives a refresh');
  await page.getByRole('button', { name: 'Resume' }).click();
  await page.getByRole('button', { name: 'Clock Out' }).click(); // tapped right after Resume
  await waitFor(async () => (await page.getByRole('status').filter({ hasText: 'saved on this device' }).count()) > 0, 'banner says changes are saved on this device');

  await openMore(page, 'Expenses');
  await page.getByRole('button', { name: 'Log Expense' }).click();
  await page.getByLabel('Description').fill('Screws, "deck" =SUM(A1)');
  await page.getByLabel('Amount (CAD)').fill('12.50');
  await page.getByRole('button', { name: 'Save Expense' }).click();
  await page.getByRole('button', { name: 'Log Expense', expanded: false }).waitFor();
  await openMore(page, 'Mileage');
  await page.getByRole('button', { name: 'Log Trip' }).click();
  await page.getByLabel('One-way distance (km)').fill('21');
  await page.getByLabel(/Round trip/).check();
  await page.getByRole('button', { name: 'Save Trip' }).click();
  await page.getByRole('button', { name: 'Log Trip', expanded: false }).waitFor(); // form closes only once saved on the device

  // Access token expires while still offline.
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('sl-auth'));
    s.expires_at = Math.floor(Date.now() / 1000) - 60;
    localStorage.setItem('sl-auth', JSON.stringify(s));
  });
  await page.reload();
  await waitFor(async () => (await page.getByRole('status').filter({ hasText: /3 changes saved on this device/ }).count()) > 0, 'expired session offline: opens within 5 s, 3 changes pending (clock-in/out coalesced)', 5000);
  check(mock.rows('sessions').length === 0, 'nothing reached the server while offline');

  console.log('Back online');
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await waitFor(() => mock.rows('sessions').length === 1 && mock.rows('expenses').length === 1 && mock.rows('mileage').length === 1, 'all offline work synced', 60000);
  const s = mock.rows('sessions')[0];
  check(s && s.end_time && s.break_seconds >= 1, 'exactly one completed session with break stored separately');
  check(mock.rows('mileage')[0]?.km === 42, 'round trip doubled km');
  check(mock.rows('sessions').length === 1, 'no duplicate session');
  await waitFor(async () => (await page.getByRole('status').filter({ hasText: /saved on this device|waiting to sync/ }).count()) === 0, 'banner clears after sync');

  console.log('Account isolation');
  // A creates an expense offline, then signs out keeping it on the device.
  await context.setOffline(true);
  await openMore(page, 'Expenses');
  await page.getByRole('button', { name: 'Log Expense' }).click();
  await page.getByLabel('Description').fill('A private pending expense');
  await page.getByLabel('Amount (CAD)').fill('99');
  await page.getByRole('button', { name: 'Save Expense' }).click();
  await page.getByRole('button', { name: 'Log Expense', expanded: false }).waitFor();
  await signOut(page, true);
  await context.setOffline(false);
  check(await page.getByText(/unsynced changes for a\*\*\*@example.test/).isVisible(), 'sign-in screen mentions pending work for the other account');
  await signIn(page, 'b@example.test', 'password-b');
  await openMore(page, 'Jobs');
  await page.waitForTimeout(1500);
  check(!(await page.getByText('Basement reno').count()), "B does not see A's jobs");
  await openMore(page, 'Expenses');
  check(!(await page.getByText('A private pending expense').count()), "B does not see A's pending expense");
  await page.waitForTimeout(2000);
  check(mock.rows('expenses').length === 1, "A's pending expense was not uploaded under B");
  await signOut(page);
  await signIn(page, 'a@example.test', 'password-a');
  await waitFor(() => mock.rows('expenses').length === 2 && mock.rows('expenses').every(e => e.user_id === mock.rows('jobs')[0].user_id), "A's pending expense uploads under A after A signs back in");

  console.log('Invoice');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Reports' }).click();
  await page.getByRole('button', { name: /Record QuickBooks Invoice/ }).click();
  await page.getByLabel('Invoice Number (as in QuickBooks)').fill('INV-100');
  await page.getByRole('button', { name: 'Record invoice & mark billed' }).click();
  await waitFor(() => mock.rows('invoices').length === 1 && mock.rows('sessions')[0].invoice_id, 'invoice recorded and session claimed atomically');
  await waitFor(() => page.getByRole('heading', { name: 'Invoice recorded' }).isVisible(), 'success shown after the server confirmed');

  await context.close();
} catch (e) {
  failures += 1;
  console.log('  FAIL unexpected error:', e.message.split('\n')[0]);
  try { console.log('  page text:', (await lastPage?.locator('body').innerText())?.slice(0, 500).replace(/\n+/g, ' | ')); } catch { /* ignore */ }
} finally {
  await browser.close();
  preview.kill();
  await mock.close();
}
console.log(failures ? `\n${failures} browser check(s) failed` : '\nAll browser checks passed');
process.exit(failures ? 1 : 0);
