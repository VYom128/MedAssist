# Fonts

Noto Sans Regular and Bold (hinted TTF), used for invoice and receipt PDFs because PDFKit's
standard fonts have no ₹ sign. Licensed under the SIL Open Font License 1.1 (`OFL.txt`).

Source: https://github.com/notofonts/notofonts.github.io/tree/main/fonts/NotoSans/hinted/ttf
(licence: https://github.com/notofonts/latin-greek-cyrillic/blob/main/OFL.txt), downloaded
2026-10-06.

| File                 | SHA-256                                                          |
| -------------------- | ---------------------------------------------------------------- |
| NotoSans-Regular.ttf | 478c558ea716033cd60c03438f628dfa75694dcf6b5f6d505a2f05fd2b4f3823 |
| NotoSans-Bold.ttf    | 1df075a380fc7cb898acf64c1f7b3b4dd780de3caa860178bf929de35817a913 |
| OFL.txt              | cee9892f9f0cc8fe882c9e9537ee6a89621d86ee7ceaf70b02e2b2b1c25c061a |

`npm run build` copies this folder to `dist/assets/fonts` (`scripts/copyAssets.ts`). If the
files are missing at runtime, the PDFs fall back to Helvetica and print "Rs.".
