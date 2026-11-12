import { describe, it, expect } from 'vitest';
import {
  escapeQueryValue, cleanDisplayName, customerPayload, lineDescription, itemIdFor, buildInvoicePayload,
  parseInvoiceResult, faultMessage, UUID, nextDocNumber,
} from './invoice.ts';

const settings = { labour_item_id: '3', half_day_item_id: null, full_day_item_id: '7', tax_code_id: '5' };

describe('QuickBooks customer', () => {
  it('escapes names for a QuickBooks query', () => {
    expect(escapeQueryValue("O'Brien")).toBe("O\\'Brien");
    expect(escapeQueryValue('a\\b')).toBe('a\\\\b');
    expect(escapeQueryValue("x' or '1'='1")).toBe("x\\' or \\'1\\'=\\'1");
  });

  it('cleans display names QuickBooks would refuse', () => {
    expect(cleanDisplayName('  Smith:  Kitchen\treno\n ')).toBe('Smith Kitchen reno');
    expect(cleanDisplayName(null)).toBe('');
    expect(cleanDisplayName('x'.repeat(300))).toHaveLength(100);
  });

  it('sends only usable contact details', () => {
    expect(customerPayload({ id: 'c', name: 'Jane Smith', email: 'jane@example.com', phone: '604-555-1234', address: '12 Main St' })).toEqual({
      DisplayName: 'Jane Smith',
      PrimaryEmailAddr: { Address: 'jane@example.com' },
      PrimaryPhone: { FreeFormNumber: '604-555-1234' },
      BillAddr: { Line1: '12 Main St' },
    });
    expect(customerPayload({ id: 'c', name: 'Jane', email: 'not an email', phone: '', address: null })).toEqual({ DisplayName: 'Jane' });
  });
});

describe('QuickBooks invoice payload', () => {
  const lines = [
    { work_date: '2026-10-14', description: 'Kitchen reno', worker_name: 'Mike', quantity: '8.00', unit: 'hour', unit_price: '65.00', amount: '520.00' },
    { work_date: '2026-10-15', description: 'Kitchen reno', worker_name: null, quantity: '1.00', unit: 'half_day', unit_price: '400.00', amount: '400.00' },
    { work_date: '2026-10-16', description: 'Deck', worker_name: 'Mike', quantity: '1.00', unit: 'full_day', unit_price: '750.00', amount: '750.00' },
  ];

  it('describes each line without shifting the date', () => {
    expect(lineDescription(lines[0])).toBe('Oct 14 · Kitchen reno · Mike');
    expect(lineDescription(lines[1])).toBe('Oct 15 · Kitchen reno (half day)');
    expect(lineDescription(lines[2])).toBe('Oct 16 · Deck · Mike (full day)');
    expect(lineDescription({ ...lines[0], work_date: '2026-01-01' })).toBe('Jan 1 · Kitchen reno · Mike');
    expect(lineDescription({ ...lines[0], work_date: null, worker_name: null })).toBe('Kitchen reno');
  });

  it('uses the day-rate items when chosen, otherwise the labour item', () => {
    expect(itemIdFor('hour', settings)).toBe('3');
    expect(itemIdFor('half_day', settings)).toBe('3');
    expect(itemIdFor('full_day', settings)).toBe('7');
  });

  it('builds one taxable line per entry, amounts before tax', () => {
    const p = buildInvoicePayload({ invoiceId: 'inv-1', txnDate: '2026-10-20', customerRef: '58', lines, settings, billEmail: 'jane@example.com' });
    expect(p.CustomerRef).toEqual({ value: '58' });
    expect(p.TxnDate).toBe('2026-10-20');
    expect(p.PrivateNote).toBe('SiteLedger inv-1');
    expect(p.GlobalTaxCalculation).toBe('TaxExcluded');
    expect(p.BillEmail).toEqual({ Address: 'jane@example.com' });
    expect(p.Line).toHaveLength(3);
    expect(p.Line[0]).toEqual({
      DetailType: 'SalesItemLineDetail',
      Amount: 520,
      Description: 'Oct 14 · Kitchen reno · Mike',
      SalesItemLineDetail: { ItemRef: { value: '3' }, Qty: 8, UnitPrice: 65, TaxCodeRef: { value: '5' }, ServiceDate: '2026-10-14' },
    });
    expect(p.Line[2].SalesItemLineDetail.ItemRef).toEqual({ value: '7' });
    // No invoice number: QuickBooks assigns it. No tax amount: QuickBooks calculates it.
    expect(p).not.toHaveProperty('DocNumber');
    expect(p).not.toHaveProperty('TxnTaxDetail');
    for (const l of p.Line) expect(l.Amount).toBe(Math.round(l.SalesItemLineDetail.Qty * l.SalesItemLineDetail.UnitPrice * 100) / 100);
  });

  it('leaves out a bad email or date', () => {
    const p = buildInvoicePayload({ invoiceId: 'i', txnDate: 'yesterday', customerRef: '1', lines: [], settings, billEmail: 'nope' });
    expect(p).not.toHaveProperty('BillEmail');
    expect(p).not.toHaveProperty('TxnDate');
  });
});

describe('QuickBooks answers', () => {
  it('reads the created invoice', () => {
    expect(parseInvoiceResult({ Invoice: { Id: '145', DocNumber: '1042', TotalAmt: 587.6, Balance: 587.6, TxnTaxDetail: { TotalTax: 67.6 } } }))
      .toEqual({ id: '145', docNumber: '1042', total: 587.6, tax: 67.6, balance: 587.6 });
    expect(parseInvoiceResult({ Invoice: { Id: '146' } })).toEqual({ id: '146', docNumber: null, total: null, tax: null, balance: null });
    expect(parseInvoiceResult({ Invoice: { Id: 'not valid!' } })).toBeNull();
    expect(parseInvoiceResult({ Fault: {} })).toBeNull();
    expect(parseInvoiceResult(null)).toBeNull();
  });

  it('explains a refusal in QuickBooks\' own words, shortened', () => {
    expect(faultMessage({ Fault: { Error: [{ Message: 'Invalid Reference Id', Detail: 'Invalid Reference Id : Something you\'re trying to use has been made inactive.', code: '2500' }] } }))
      .toBe("Invalid Reference Id : Something you're trying to use has been made inactive.");
    expect(faultMessage({ Fault: { Error: [{ Message: 'Duplicate Name Exists Error' }] } })).toBe('Duplicate Name Exists Error');
    expect(faultMessage({ Fault: { Error: [{ Detail: 'x'.repeat(1000) }] } })).toHaveLength(240);
    expect(faultMessage(null)).toBe('no reason was given');
  });

  it('recognises uuids', () => {
    expect(UUID.test('a0000000-0000-4000-8000-0000000000f1')).toBe(true);
    expect(UUID.test("a0000000-0000-4000-8000-0000000000f1' or 1=1")).toBe(false);
    expect(UUID.test('123')).toBe(false);
  });
});

describe('invoice number when QuickBooks does not assign one', () => {
  it('continues the most recent pattern', () => {
    expect(nextDocNumber(['1002', '1001'])).toBe('1003');
    expect(nextDocNumber([null, '', '1002', '1001'])).toBe('1003'); // newest invoice has no number
    expect(nextDocNumber(['INV-0099', 'INV-0098'])).toBe('INV-0100');
    expect(nextDocNumber(['2026-009'])).toBe('2026-010');
    expect(nextDocNumber(['999'])).toBe('1000');
  });

  it('skips numbers already in use', () => {
    expect(nextDocNumber(['1002', '1004', '1003'])).toBe('1005');
    expect(nextDocNumber(['A7', 'A8', 'A9'])).toBe('A10');
  });

  it('starts at 1001 when there is nothing to follow', () => {
    expect(nextDocNumber([])).toBe('1001');
    expect(nextDocNumber([null, undefined, ''])).toBe('1001');
    expect(nextDocNumber(['DRAFT', 'no digits'])).toBe('1001');
  });

  it('gives up rather than exceed the QuickBooks length limit', () => {
    expect(nextDocNumber(['X'.repeat(20) + '99'])).toBeNull();
  });

  it('is sent only when provided', () => {
    const base = { invoiceId: 'i', txnDate: '2026-11-11', customerRef: '1', lines: [], settings: { labour_item_id: '3', half_day_item_id: null, full_day_item_id: null, tax_code_id: '5' } };
    expect(buildInvoicePayload({ ...base, docNumber: '1003' }).DocNumber).toBe('1003');
    expect(buildInvoicePayload({ ...base, docNumber: null })).not.toHaveProperty('DocNumber');
  });
});
