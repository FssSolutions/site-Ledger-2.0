import { describe, it, expect } from 'vitest';
import { readQboReturn, clearQboReturn, qboReturnMessage } from '../src/lib/qboApi.js';

describe('return from QuickBooks sign-in', () => {
  it('reads only known results', () => {
    expect(readQboReturn({ search: '?qbo=connected' })).toEqual({ result: 'connected', reason: null });
    expect(readQboReturn({ search: '?qbo=error&reason=invalid_state' })).toEqual({ result: 'error', reason: 'invalid_state' });
    expect(readQboReturn({ search: '?qbo=%3Cscript%3E' })).toBeNull();
    expect(readQboReturn({ search: '' })).toBeNull();
    expect(readQboReturn(undefined)).toBeNull();
  });

  it('removes its parameters and keeps everything else in the URL', () => {
    const calls = [];
    const win = {
      location: { pathname: '/', search: '?qbo=error&reason=server&keep=1', hash: '#x' },
      history: { replaceState: (...a) => calls.push(a) },
    };
    clearQboReturn(win);
    expect(calls).toEqual([[null, '', '/?keep=1#x']]);
    calls.length = 0;
    clearQboReturn({ location: { pathname: '/', search: '?qbo=connected', hash: '' }, history: { replaceState: (...a) => calls.push(a) } });
    expect(calls).toEqual([[null, '', '/']]);
  });

  it('explains each outcome in plain language', () => {
    expect(qboReturnMessage(null)).toBeNull();
    expect(qboReturnMessage({ result: 'connected' })).toEqual({ message: 'QuickBooks connected.', type: 'success' });
    expect(qboReturnMessage({ result: 'cancelled' }).type).toBe('info');
    expect(qboReturnMessage({ result: 'error', reason: 'company_in_use' }).message).toMatch(/already connected/);
    expect(qboReturnMessage({ result: 'error', reason: 'invalid_state' }).message).toMatch(/expired/);
    // Unknown reasons are never echoed back.
    const m = qboReturnMessage({ result: 'error', reason: '<b>x</b>' });
    expect(m.type).toBe('error');
    expect(m.message).not.toContain('<b>');
  });
});

describe('tax code label', () => {
  it('shows the rate when known', async () => {
    const { taxCodeLabel } = await import('../src/lib/qboApi.js');
    expect(taxCodeLabel({ name: 'GST', rate: 5 })).toBe('GST (5%)');
    expect(taxCodeLabel({ name: 'GST/PST BC', rate: 12 })).toBe('GST/PST BC (12%)');
    expect(taxCodeLabel({ name: 'Mystery', rate: null })).toBe('Mystery');
    expect(taxCodeLabel(null)).toBe('');
  });
});

describe('sign-in address check', () => {
  it('only allows https addresses on intuit.com', async () => {
    const { isIntuitUrl } = await import('../src/lib/qboApi.js');
    expect(isIntuitUrl('https://appcenter.intuit.com/connect/oauth2?client_id=x')).toBe(true);
    expect(isIntuitUrl('http://appcenter.intuit.com/connect/oauth2')).toBe(false);
    expect(isIntuitUrl('https://appcenter.intuit.com.evil.example/')).toBe(false);
    expect(isIntuitUrl('https://evil.example/?x=https://appcenter.intuit.com/')).toBe(false);
    expect(isIntuitUrl('javascript:alert(1)')).toBe(false);
    expect(isIntuitUrl(null)).toBe(false);
  });
});
