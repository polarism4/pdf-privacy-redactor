/** Heuristic *suggestions*, never unconditional redactions. No network or external processing. */
import { normalizeBox, padBox, deduplicateBoxes } from './geometry.js';

const expressions = [
  { label: 'Email', regex: /[\w.+-]+@[\w.-]+\.[a-z]{2,}/giu },
  { label: 'Thai phone', regex: /(?:\+66[\s.-]?|0)(?:[689]\d[\s.-]?\d{3}[\s.-]?\d{4})/gu },
  { label: 'Thai ID candidate', regex: /(?<!\d)\d(?:[\s-]?\d){12}(?!\d)/gu },
  { label: 'Labeled account', regex: /(?:account\s*(?:no\.?|number|#)?|a\/c\s*(?:no\.?|number)?|เลข(?:ที่)?บัญชี)\s*[:#-]?\s*[xX*•\d\s-]{7,26}/giu },
  { label: 'Labeled card', regex: /(?:card\s*(?:no\.?|number|#)?|เลข(?:ที่)?บัตร)\s*[:#-]?\s*[xX*•\d\s-]{7,26}/giu },
  { label: 'Labeled customer name', regex: /(?:customer\s*name|cardholder|account\s*holder|ชื่อ(?:ผู้ถือบัตร|ลูกค้า|บัญชี)?|นามสกุล)\s*[:：]?\s*[^\n\r]{3,65}/giu },
  { label: 'Labeled address', regex: /(?:mailing\s*address|billing\s*address|address\s*:|ที่อยู่\s*[:：])\s*[^\n\r]{6,120}/giu }
];

export function passesLuhn(value) {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0; let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (double) { d *= 2; if (d > 9) d -= 9; }
    sum += d; double = !double;
  }
  return sum % 10 === 0;
}
export function findSensitiveSpans(s) {
  const spans = [];
  for (const {label, regex} of expressions) {
    regex.lastIndex = 0;
    for (const match of s.matchAll(regex)) {
      if (label === 'Thai ID candidate' && match[0].replace(/\D/g,'').length !== 13) continue;
      spans.push({ start: match.index, end: match.index + match[0].length, label });
    }
  }
  const cardPattern = /(?<!\d)(?:\d[ -]?){13,19}(?!\d)/g;
  for (const match of s.matchAll(cardPattern)) {
    if (passesLuhn(match[0])) spans.push({ start: match.index, end: match.index + match[0].length, label: 'Card number candidate' });
  }
  return spans;
}
/**
 * PDF.js text spans are approximate. Items frequently fragment a name or number;
 * to avoid incomplete masking suggest covering the *whole text item* containing
 * sensitive material, not only match-length pixels.
 */
export function suggestionsFromTextItems(items, viewport, pdfjsUtil) {
  const suggestions = [];
  for (const item of items) {
    if (!item.str || !item.transform || !findSensitiveSpans(item.str).length) continue;
    const t = pdfjsUtil.transform(viewport.transform, item.transform);
    const rotated = Math.abs(t[1]) > Math.abs(t[0]);
    const fontH = Math.max(8, Math.hypot(t[2], t[3]));
    const fontW = Math.max(8, (item.width || 8) * viewport.scale);
    const px = rotated ? {x: t[4] - fontH, y: t[5] - fontW, w: fontH, h: fontW} :
                         {x: t[4], y: t[5] - fontH, w: fontW, h: fontH};
    const box = padBox(normalizeBox(px.x / viewport.width, px.y / viewport.height,
      (px.x + px.w) / viewport.width, (px.y + px.h) / viewport.height), 3, viewport.width, viewport.height);
    if (box.w > 0 && box.h > 0) suggestions.push({...box, label: findSensitiveSpans(item.str)[0].label});
  }
  return deduplicateBoxes(suggestions);
}
