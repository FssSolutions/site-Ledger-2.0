import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { calcDur, calcEarnings, fmtCAD } from './utils.js';

export default function generateInvoice({ sessions, jobs, employees, dateRange, company, customer, invoiceNum, selectedJobIds }) {
  const [rs, re] = dateRange;

  // Filter sessions by date range and optionally by selected jobs
  const f = sessions.filter(s => {
    if (!s.end_time) return false;
    const t = new Date(s.start_time);
    if (t < rs || t > re) return false;
    if (selectedJobIds && selectedJobIds.length > 0) {
      return selectedJobIds.includes(s.job_id);
    }
    return true;
  });

  const doc = new jsPDF();
  const pw = doc.internal.pageSize.getWidth();

  let y = 14;

  // Company logo
  if (company.logo) {
    try {
      doc.addImage(company.logo, 'JPEG', 14, y, 30, 30);
      y += 4; // text starts beside logo
    } catch {
      // skip logo if it fails
    }
  }

  const logoOffset = company.logo ? 50 : 14;

  // Header — INVOICE title
  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(232, 101, 26);
  doc.text('INVOICE', logoOffset, y + 8);

  // Company info below title
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(60);
  let cy = y + 16;
  if (company.name) { doc.setFont('helvetica', 'bold'); doc.text(company.name, logoOffset, cy); doc.setFont('helvetica', 'normal'); cy += 5; }
  if (company.address) { doc.text(company.address, logoOffset, cy); cy += 5; }
  if (company.phone) { doc.text(company.phone, logoOffset, cy); cy += 5; }
  if (company.email) { doc.text(company.email, logoOffset, cy); cy += 5; }
  if (company.gstNumber) { doc.text(`GST #: ${company.gstNumber}`, logoOffset, cy); cy += 5; }
  if (company.worksafeNumber) { doc.text(`WorkSafe BC #: ${company.worksafeNumber}`, logoOffset, cy); cy += 5; }

  // Invoice details — right side
  doc.setTextColor(100);
  doc.text(`Invoice #: ${invoiceNum || 'INV-001'}`, pw - 14, y + 8, { align: 'right' });
  doc.text(`Date: ${new Date().toLocaleDateString('en-CA')}`, pw - 14, y + 14, { align: 'right' });
  doc.text(`Period: ${rs.toLocaleDateString('en-CA')} to ${re.toLocaleDateString('en-CA')}`, pw - 14, y + 20, { align: 'right' });

  y = Math.max(cy, y + 28) + 6;

  // Bill To
  if (customer) {
    doc.setTextColor(100);
    doc.setFont('helvetica', 'normal');
    doc.text('Bill To:', 14, y);
    y += 6;
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0);
    doc.text(customer.name, 14, y);
    doc.setFont('helvetica', 'normal');
    y += 5;
    doc.setTextColor(60);
    if (customer.address) { doc.text(customer.address, 14, y); y += 5; }
    if (customer.phone) { doc.text(customer.phone, 14, y); y += 5; }
    if (customer.email) { doc.text(customer.email, 14, y); y += 5; }
    y += 5;
  }

  // Labour table
  const labourRows = f.map(s => {
    const j = jobs.find(x => x.id === s.job_id);
    const emp = employees.find(x => x.id === s.employee_id);
    const hrs = (calcDur(s) / 3600000).toFixed(2);
    const earn = calcEarnings(s, jobs);
    return [
      new Date(s.start_time).toLocaleDateString('en-CA'),
      j?.name || '',
      emp?.name || 'Owner',
      hrs,
      fmtCAD(j?.rate || 0) + '/hr',
      fmtCAD(earn)
    ];
  });

  const subtotal = f.reduce((s, x) => s + calcEarnings(x, jobs), 0);
  const totalHours = (f.reduce((s, x) => s + calcDur(x), 0) / 3600000).toFixed(2);

  if (labourRows.length > 0) {
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0);
    doc.text('Labour', 14, y);
    y += 4;

    autoTable(doc, {
      startY: y,
      head: [['Date', 'Job', 'Employee', 'Hours', 'Rate', 'Amount']],
      body: labourRows,
      foot: [['', '', 'Subtotal', totalHours, '', fmtCAD(subtotal)]],
      theme: 'grid',
      headStyles: { fillColor: [232, 101, 26], textColor: 255, fontStyle: 'bold', fontSize: 9 },
      footStyles: { fillColor: [245, 245, 245], textColor: [0, 0, 0], fontStyle: 'bold', fontSize: 9 },
      styles: { fontSize: 8, cellPadding: 3 },
      columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
    });

    y = doc.lastAutoTable.finalY + 12;
  }

  // GST + Total summary
  const gst = subtotal * 0.05;
  const grandTotal = subtotal + gst;

  const summaryX = pw - 80;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(60);
  doc.text('Subtotal:', summaryX, y);
  doc.text(fmtCAD(subtotal), pw - 14, y, { align: 'right' });
  y += 7;
  doc.text('GST (5%):', summaryX, y);
  doc.text(fmtCAD(gst), pw - 14, y, { align: 'right' });
  y += 4;

  doc.setDrawColor(232, 101, 26);
  doc.setLineWidth(0.5);
  doc.line(summaryX, y, pw - 14, y);
  y += 8;

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0);
  doc.text('Total Due:', summaryX, y);
  doc.text(fmtCAD(grandTotal), pw - 14, y, { align: 'right' });

  // GST number reminder at bottom of totals
  if (company.gstNumber) {
    y += 8;
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(130);
    doc.text(`GST Registration: ${company.gstNumber}`, summaryX, y);
  }

  // Footer
  const ph = doc.internal.pageSize.getHeight();
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(150);
  doc.text('Generated by SiteLedger', 14, ph - 10);

  doc.save(`invoice-${invoiceNum || 'draft'}-${rs.toLocaleDateString('en-CA')}.pdf`);
}
