/** Normalized geometry; coordinates are [0,1] of the displayed/rendered PDF page. */
export function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
export function normalizeBox(x1, y1, x2, y2) {
  const x = clamp(Math.min(x1, x2), 0, 1);
  const y = clamp(Math.min(y1, y2), 0, 1);
  const r = clamp(Math.max(x1, x2), 0, 1);
  const b = clamp(Math.max(y1, y2), 0, 1);
  return { x, y, w: Math.max(0, r - x), h: Math.max(0, b - y) };
}
export function padBox(box, px, width, height) {
  return normalizeBox(box.x - px / width, box.y - px / height,
    box.x + box.w + px / width, box.y + box.h + px / height);
}
export function boxToPixels(box, width, height) {
  const x1 = clamp(Math.floor(box.x * width), 0, width);
  const y1 = clamp(Math.floor(box.y * height), 0, height);
  const x2 = clamp(Math.ceil((box.x + box.w) * width), 0, width);
  const y2 = clamp(Math.ceil((box.y + box.h) * height), 0, height);
  return { x: x1, y: y1, w: Math.max(0, x2 - x1), h: Math.max(0, y2 - y1) };
}
export function overlapping(a, b) {
  const w = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const h = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return w * h;
}
export function deduplicateBoxes(boxes) {
  const result = [];
  for (const box of boxes) {
    const dup = result.some(other => overlapping(box, other) / Math.min(box.w * box.h, other.w * other.h) > 0.78);
    if (!dup) result.push(box);
  }
  return result;
}
