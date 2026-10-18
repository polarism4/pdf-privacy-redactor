import { PDFDocument } from 'pdf-lib';
import { boxToPixels } from './geometry.js';

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not encode page image.')), type, quality));
}

/** Creates an image-only PDF. No objects from the source PDF are copied. */
export async function exportFlattenedPdf(sourcePdf, masks, onProgress, options = {}) {
  const out = await PDFDocument.create();
  out.setTitle('Redacted PDF');
  out.setSubject('Image-only PDF reconstructed from redacted pages');
  out.setAuthor('');
  out.setCreator('PDF Privacy Redactor');
  out.setKeywords([]);
  const targetDpi = options.dpi ?? 160;
  const pageMaxPixels = options.pageMaxPixels ?? 12500000;
  let maskCount = 0;
  for (let n = 1; n <= sourcePdf.numPages; n++) {
    const page = await sourcePdf.getPage(n);
    const baseViewport = page.getViewport({ scale: 1 });
    const pagesize = baseViewport.width * baseViewport.height;
    const scale = Math.min(targetDpi / 72, Math.sqrt(pageMaxPixels / pagesize));
    if (!Number.isFinite(scale) || scale <= 0) throw new Error('Invalid PDF page dimensions.');
    const viewport = page.getViewport({scale});
    const width = Math.ceil(viewport.width);
    const height = Math.ceil(viewport.height);
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d', {alpha:false, willReadFrequently:true});
    if (!context) throw new Error('Canvas is not available.');
    context.fillStyle = '#fff'; context.fillRect(0, 0, width, height);
    await page.render({canvasContext:context, canvas, viewport, background:'#fff'}).promise;
    const pageMasks = (masks[n] || []).filter(mask => mask.accepted);
    context.fillStyle = '#000';
    for (const mask of pageMasks) {
      const rect = boxToPixels(mask, width, height);
      if (rect.w < 2 || rect.h < 2) continue;
      context.fillRect(rect.x, rect.y, rect.w, rect.h);
      // Verify actual canvas pixels were overwritten before image encoding.
      const sample = context.getImageData(rect.x + Math.floor(rect.w/2), rect.y + Math.floor(rect.h/2), 1, 1).data;
      if (sample[0] !== 0 || sample[1] !== 0 || sample[2] !== 0) throw new Error('Could not verify a redaction mask.');
      maskCount++;
    }
    // JPEG compresses the final sanitized pixels; it never sees original image bytes.
    const jpg = await canvasToBlob(canvas, 'image/jpeg', 0.91);
    const jpgBytes = new Uint8Array(await jpg.arrayBuffer());
    const embedded = await out.embedJpg(jpgBytes);
    const p = out.addPage([baseViewport.width, baseViewport.height]);
    p.drawImage(embedded, {x:0, y:0, width:baseViewport.width, height:baseViewport.height});
    canvas.width = 0; canvas.height = 0;
    page.cleanup();
    onProgress?.(n, sourcePdf.numPages);
  }
  if (maskCount === 0) throw new Error('No approved redaction boxes. Export cancelled.');
  const bytes = await out.save({ useObjectStreams: true });
  return { bytes, maskCount, pageCount:sourcePdf.numPages };
}

/** Structural checks only; no scanner can guarantee that all PII was selected. */
export async function verifyOutput(pdfjsLib, bytes, expectedPages) {
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(bytes), isEvalSupported:false }).promise;
  try {
    const details = [];
    const attachments = await pdf.getAttachments();
    let totalText = 0, annotations = 0;
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const text = await page.getTextContent();
      totalText += text.items.filter(i => i.str?.trim()).length;
      const annots = await page.getAnnotations();
      annotations += annots.length;
    }
    const passed = pdf.numPages === expectedPages && totalText === 0 && annotations === 0 &&
      (!attachments || Object.keys(attachments).length === 0);
    if (!passed) details.push('Unexpected text, annotations, attachments, or page count.');
    return {passed, details, totalText, annotations, pageCount:pdf.numPages,
      hasAttachments: !!attachments && Object.keys(attachments).length > 0};
  } finally { await pdf.destroy(); }
}
