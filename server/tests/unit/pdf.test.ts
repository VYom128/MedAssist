import { clinicHeader, createPdf, pdfSafe, table } from '../../src/services/pdf.service.js';
import { isPdf, pdfText } from '../helpers/pdf.js';

describe('pdf.service', () => {
  it('builds a valid PDF with the clinic header, a table and page footers', async () => {
    const pdf = createPdf({ title: 'Test document' });
    await clinicHeader(pdf, 'Laboratory report');
    table(
      pdf,
      [
        { header: 'Parameter', width: 2 },
        { header: 'Result', width: 1 },
      ],
      Array.from({ length: 80 }, (_, i) => [`Row ${i}`, { text: String(i), bold: i % 2 === 0 }]),
    );
    const buffer = await pdf.finish();
    expect(isPdf(buffer)).toBe(true);
    const text = pdfText(buffer);
    expect(text).toContain('MedAssist Clinic');
    expect(text).toContain('Laboratory report');
    expect(text).toContain('Row 79');
    expect(text).toMatch(/Page 1 of [2-9]/);
    expect(text).toContain('Generated on');
  });

  it('pdfSafe replaces what the standard fonts cannot draw', () => {
    expect(pdfSafe('₹500 – “ok” ≥ 5…')).toBe('Rs.500 – "ok" >= 5...');
    expect(pdfSafe('नमस्ते A')).toBe('?????? A');
    expect(pdfSafe('a\tb\r\nc')).toBe('a b\nc');
  });
});
