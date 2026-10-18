# PDF Privacy Redactor — local-first PWA MVP

A browser-based redaction editor for bank and credit card statements. Compatible with modern iPad/iPhone Safari, Android Chrome, and desktop browsers. It renders a source PDF locally, lets you draw boxes and accept suggested sensitive-field regions, and builds a **new image-only PDF from sanitized page pixels**. The original PDF is never modified or uploaded by the application.

## What works in version 0.1

- Import searchable or scanned PDF statements locally (up to 100 MB; large files may exhaust mobile RAM).
- Preview all pages, zoom, navigate, and draw manual masks with touch, mouse or Apple Pencil.
- Detect **candidate** sensitive text on searchable PDFs: emails, Thai phone numbers, card numbers passing Luhn validation, ID candidates, and labeled names, addresses, or accounts. Suggestions are never accepted automatically.
- Approve suggested boxes individually or one page at a time, remove approved masks, undo/redo.
- Require page-by-page review marking before export.
- Export fully rasterized PDF pages **after masking pixels**, not by adding overlay objects to the original PDF.
- Reopen the output to verify that it has the expected page count and no extractable text, annotations, or attachments. The verified PDF download is generated locally.
- Installable offline PWA after an initial successful online visit (once hosted over HTTPS); bundle assets are cached, not user documents.

## Known limitations (read this)

1. **No OCR in this MVP.** Scanned PDF pages can be opened and manually redacted, but automatic suggestions only inspect existing selectable PDF text. In particular, QR/barcodes, Thai names without labels, and image-embedded details need visual review.
2. Even for searchable PDFs, detection can miss or incorrectly locate sensitive details, especially when text is split across PDF fragments or rotated. All suggested rectangles must be checked in the page preview; draw larger manual masks as necessary.
3. The export is a **pixel-image PDF**. It loses searchability, selectable text, bookmarks, and live links. Text may be less sharp and files may be larger.
4. Structural verification **does not** prove all personal information was masked. For sensitive data, review the *exported* PDF page by page before sharing it.
5. If importing encrypted PDFs fails, save an unlocked copy in a trusted local PDF viewer first. Do not upload the original anywhere to unlock it.
6. As with any browser application, security depends on the browser and the authenticity of hosted JavaScript. Use a trusted HTTPS origin and avoid untrusted browser extensions.

## Local development (Mac, Windows or Linux)

Requires Node.js 22+.

```bash
npm install
npm run dev
```

Visit the local address printed by Vite, normally `http://localhost:5173`. This is a **development server**, not an upload endpoint. Documents are read using `File.arrayBuffer()` by the browser. For a deployable static app:

```bash
npm test
npm run build
npm run preview
```

Files inside `dist/` can be hosted on any static HTTPS host. There is no app backend.

## Deploy using GitHub Pages from an iPad

1. Create a new GitHub repository (recommended name `pdf-privacy-redactor`), add a `main` branch.
2. Upload the *contents* of this ZIP to the repository root, preserving `src/`, `public/`, `.github/workflows/` and the other files. You cannot upload a single ZIP and expect GitHub Pages to extract it automatically.
3. In GitHub repository **Settings → Pages**, choose **GitHub Actions** as build and deployment source.
4. In the Actions tab, run **Deploy offline PDF Redactor PWA** if it did not start automatically. Wait for build and deploy to complete.
5. Open the resulting `https://<account>.github.io/<repository>/` in Safari and use Share → **Add to Home Screen**.
6. Before using it offline, successfully open the website once while connected to the internet. Test it again in airplane mode with a **fake PDF**, not a bank statement.

GitHub Pages content is publicly accessible even if you keep the source repository private on certain plans; do not commit original financial PDFs. This is a static public app, but statement files are not sent to it for processing.

## Privacy architecture

- No `fetch` / XMLHttpRequest / backend submission for documents.
- `Content-Security-Policy` restricts connections to the hosting origin, preventing cross-origin uploads by normal application code.
- The service worker precaches only compiled app assets, not imported or exported documents.
- Input data and PDF page renders are kept in memory while editing, and the in-memory document can be cleared. Browser, OS, screenshot and download behaviors are outside this application's control.
- Export uses `pdf-lib` to create a new PDF with fresh pages, with sanitized JPEGs from per-page canvases. No PDF objects from the source are copied.
- Exported PDF contains no original text layer, annotations, or attachments by design; the app performs structural checks after export.

## Security test suggestions

With a **synthetic** statement, try masking a fake account number and downloading the output. In a desktop PDF viewer, test text selection and run a text extractor such as `pdftotext` to check that no text remains. Also inspect each image visually and verify no mask is missing. This visual review is indispensable.

## Developer notes

- Dependencies: `pdfjs-dist` for client-side rendering, `pdf-lib` for writing PDF, `vite-plugin-pwa` for offline PWA.
- The output resolution is 160 dpi or lower for huge pages (capped at 12.5M pixels/page). Processing large documents may take time.
- Never add a third-party document-processing API without clearly changing the privacy promise and getting user consent.
