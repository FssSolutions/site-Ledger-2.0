import { describe, it, expect } from 'vitest';
import { qboInvoiceMode, qboInvoiceState, invoiceTitle } from '../src/lib/qboApi.js';

describe('when invoices can be created in QuickBooks', () => {
  it('needs a live connection, finished setup and the server update', () => {
    const base = { connected: true, status: 'connected', setup_complete: true, invoices_ready: true };
    expect(qboInvoiceMode(base)).toBe('ready');
    expect(qboInvoiceMode({ ...base, setup_complete: false })).toBe('setup');
    expect(qboInvoiceMode({ ...base, status: 'needs_reconnect' })).toBe('reconnect');
    expect(qboInvoiceMode({ ...base, invoices_ready: undefined })).toBe('off'); // server not updated yet
    expect(qboInvoiceMode({ connected: false, invoices_ready: true })).toBe('off');
    expect(qboInvoiceMode(null)).toBe('off');
  });
});

describe('how an invoice is shown', () => {
  it('tells hand-recorded, created and unsent invoices apart', () => {
    expect(qboInvoiceState({ notes: 'INV-007' })).toBe('manual');
    expect(qboInvoiceState({ qbo_status: 'pending' })).toBe('unsent');
    expect(qboInvoiceState({ qbo_status: 'failed', qbo_error: 'x' })).toBe('unsent');
    expect(qboInvoiceState({ qbo_status: 'created', qbo_invoice_id: '145' })).toBe('created');
    expect(qboInvoiceState({ qbo_status: 'voided', qbo_invoice_id: '145' })).toBe('voided');
    expect(qboInvoiceState({ qbo_status: 'deleted', qbo_invoice_id: '145' })).toBe('voided');
    expect(qboInvoiceState(null)).toBe('manual');
  });

  it('titles each kind', () => {
    expect(invoiceTitle({ notes: 'INV-007' })).toBe('INV-007');
    expect(invoiceTitle({ notes: '' })).toBe('—');
    expect(invoiceTitle({ qbo_status: 'failed', notes: '' })).toBe('Not in QuickBooks yet');
    expect(invoiceTitle({ qbo_status: 'created', qbo_invoice_id: '145', qbo_doc_number: '1042' })).toBe('QuickBooks #1042');
    expect(invoiceTitle({ qbo_status: 'created', qbo_invoice_id: '145', qbo_doc_number: null })).toBe('QuickBooks invoice');
    expect(invoiceTitle({ qbo_status: 'voided', qbo_invoice_id: '145', qbo_doc_number: '1042' })).toBe('Voided in QuickBooks #1042');
  });
});
