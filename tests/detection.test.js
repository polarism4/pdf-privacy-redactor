import test from 'node:test';
import assert from 'node:assert/strict';
import { passesLuhn,findSensitiveSpans,suggestionsFromTextItems } from '../src/detection.js';
import {normalizeBox,boxToPixels,deduplicateBoxes} from '../src/geometry.js';

test('detects card number that passes Luhn',()=>{
  assert.equal(passesLuhn('4111 1111 1111 1111'),true);
  assert.equal(passesLuhn('4111 1111 1111 1112'),false);
});
test('flags account number with label and email but not a small transaction amount',()=>{
  const labels=findSensitiveSpans('Account number: 012345678901. Contact help@example.com. Payment 1299.00');
  assert.ok(labels.some(s=>s.label==='Labeled account'));
  assert.ok(labels.some(s=>s.label==='Email'));
  assert.equal(findSensitiveSpans('2026-10-01 Restaurant 1299.00').length,0);
});
test('normalizes and clamps boxes',()=>{
  const box=normalizeBox(0.9,0.8,-0.2,1.4);
  assert.equal(box.x,0);assert.equal(box.y,0.8);assert.equal(box.w,0.9);assert.ok(Math.abs(box.h-0.2)<1e-12);
  assert.deepEqual(boxToPixels({x:.1,y:.2,w:.4,h:.5},100,100),{x:10,y:20,w:40,h:50});
});
test('deduplicates substantially overlapping regions',()=>{
  const one={x:.1,y:.1,w:.3,h:.1}, two={x:.105,y:.1,w:.3,h:.1};
  assert.equal(deduplicateBoxes([one,two]).length,1);
});
test('detects a sensitive PDF.js text item as a suggested rectangle',()=>{
  const items=[{str:'Card number: 4111 1111 1111 1111',width:250,transform:[1,0,0,12,25,750]}];
  const v={width:600,height:800,scale:1,transform:[1,0,0,-1,0,800]};
  const util={transform:(m,t)=>[1,0,0,-t[3],t[4],800-t[5]]};
  const result=suggestionsFromTextItems(items,v,util);
  assert.equal(result.length,1);assert.ok(result[0].w>.1);
});
