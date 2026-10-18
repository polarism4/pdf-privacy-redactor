# Validation status

## Automated checks, 2026-10-18

- `npm test`: **5/5 passed**, no skipped tests.
- `npm run build`: **passed**, including production PWA service worker generation. Vite reports a nonfatal large-chunk warning.
- Chromium production-preview synthetic workflow: two-page import/render, manual redaction, undo/redo, review gate, download, and built-in structural verification **passed**.
- Independent PyMuPDF checks of the downloaded output: two pages, raster images, no extractable text, annotations, links, or attachments; samples inside the manual mask were black **passed**.
- Touch cancellation, simultaneous contacts retaining the primary gesture, Pencil-only mouse filtering, simulated pen drawing, and mask edit filtering **passed** in Chromium.
- No document-wide horizontal overflow at 768×1024, 1024×768, and 390×844 viewports.
- Browser network observation through import/edit/export: **no cross-origin requests or upload requests**. Source review found no document networking or persistent document storage code; CSP restricts connections to the origin. Generated service-worker configuration precaches app assets and has no runtime document caching.
- Production application shell reloaded offline after service-worker activation during environment validation.
- Registry audit of production dependencies reported **zero known vulnerabilities**. Because the repository has no lockfile, this used a temporary lock outside the checkout; it is not a complete audit of bundled development/build tooling or future dependency resolutions.

## Reproduce browser regression

Start `npm run build` then `npm run preview -- --port 4173 --strictPort`.
With Python `playwright`, `pymupdf`, and Chromium installed:

```sh
python scripts/browser-smoke.py
# Optional: run the same synthetic test against a deployed build:
python scripts/browser-smoke.py https://polarism4.github.io/pdf-privacy-redactor/
```

Set `CHROMIUM_PATH` if Chromium is not at `/usr/bin/chromium`.
The test uses only `samples/FAKE_bank_statement.pdf`; downloads are temporary.
The CDP pen/touch assertions require Chromium and do not certify Apple Pencil behavior.

## Security and acceptance limits

- Physical iPad/iPhone Safari, Apple Pencil palm rejection, Files downloads, install-to-home-screen, and offline PDF editing require device testing. Chromium touch/pen simulation does not verify Safari.
- Black pixel samples and structural checks are useful regressions, not proof every sensitive region is covered. Visually inspect all exported pages before sharing.
- No OCR: scanned personal information, QR/barcodes, unlabeled names, rotated/fragmented text, and detector misses need manual review.
- Large documents, encrypted PDFs, malformed inputs, and mobile memory exhaustion were not comprehensively tested.
- Network observations cover the tested workflow and build, not browser extensions, operating-system behavior, compromised hosting, or all future code paths. `connect-src 'self'` permits same-origin connections; it is not an absolute no-upload guarantee by itself.
- No independent penetration test, PDF-parser fuzzing, or full dependency/supply-chain audit has been completed. Dependency ranges without a committed lockfile allow future builds to resolve different tooling.
