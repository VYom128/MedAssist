import {
  clinicHeader,
  createPdf,
  formatMoneyForPdf,
  paragraph,
  pdfSafe,
  pdfSafeUnicode,
  setFontDirectoryForTests,
  table,
  unicodeFontsAvailable,
} from '../../src/services/pdf.service.js';
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

  describe('embedded Unicode font (₹)', () => {
    afterEach(() => setFontDirectoryForTests(null));

    it('prints ₹ and text through the embedded Noto Sans', async () => {
      expect(unicodeFontsAvailable()).toBe(true);
      const pdf = createPdf({ title: 'Invoice', unicode: true, watermark: 'VOID' });
      expect(pdf.unicode).toBe(true);
      await clinicHeader(pdf, 'TAX INVOICE');
      paragraph(pdf, `Total ${pdf.money(12_345_678_950)} – Asha Kulkarni ≤ 5`);
      table(pdf, [{ header: 'Amount', width: 1 }], [[pdf.money(-50_000)]]);
      const buffer = await pdf.finish();
      expect(isPdf(buffer)).toBe(true);
      expect(buffer.toString('latin1')).toContain('NotoSans');
      const text = pdfText(buffer);
      expect(text).toContain('TAX INVOICE');
      expect(text).toContain('Total ₹12,34,56,789.50 – Asha Kulkarni <= 5');
      expect(text).toContain('-₹500.00');
      expect(text).toContain('VOID');
      expect(text).toContain('Page 1 of 1');
    });

    it('falls back to the standard fonts and "Rs." when the font files are missing', async () => {
      setFontDirectoryForTests('/nonexistent/fonts');
      expect(unicodeFontsAvailable()).toBe(false);
      const pdf = createPdf({ title: 'Invoice', unicode: true });
      expect(pdf.unicode).toBe(false);
      paragraph(pdf, `Total ${pdf.money(125_050)}`);
      const text = pdfText(await pdf.finish());
      expect(text).toContain('Total Rs. 1,250.50');
      expect(formatMoneyForPdf(125_050)).toBe('Rs. 1,250.50');
    });

    it('formatMoneyForPdf and pdfSafeUnicode', () => {
      expect(formatMoneyForPdf(0, true)).toBe('₹0.00');
      expect(formatMoneyForPdf(99, true)).toBe('₹0.99');
      expect(formatMoneyForPdf(10_000_000, true)).toBe('₹1,00,000.00');
      expect(formatMoneyForPdf(-150, false)).toBe('-Rs. 1.50');
      expect(pdfSafeUnicode('₹5 “ok” é ≥ नमस्ते\tx')).toBe('₹5 “ok” é >= ?????? x');
    });
  });
});
