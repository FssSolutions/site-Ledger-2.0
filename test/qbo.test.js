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
