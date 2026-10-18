import './style.css';
import * as pdfjsLib from 'pdfjs-dist/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { registerSW } from 'virtual:pwa-register';
import { normalizeBox, clamp } from './geometry.js';
import { suggestionsFromTextItems } from './detection.js';
import { exportFlattenedPdf, verifyOutput } from './export.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
registerSW({immediate:true});

const state = {
  pdf:null, fileName:'', numPages:0, page:1, masks:{}, history:[], redo:[],
  mode:'draw', busy:false, zoom:1, renderTicket:0, isRendering:false, docNonce:0,
  suggestionNotice:'', verified:null, lastExport:null, reviewedPages:new Set()
};
const $ = id => document.getElementById(id);
let rectCounter = 1, pointerStart = null, resizeTimer = null;

$('app').innerHTML = `
<div class="layout">
  <header class="topbar"><div class="brand"><div class="mark">▣</div><div><strong>PDF Privacy Redactor</strong><span>Local-first • No document uploads</span></div></div>
    <div class="topright"><span class="status"><i></i><span id="network-status">On-device processing</span></span><button id="reset" class="quiet" disabled>Clear document</button></div>
  </header>
  <section class="intro"><div><div class="eyebrow">PRIVATE DOCUMENT WORKSPACE</div><h1>Redact before you share.</h1><p>Mask account details and identities while keeping your transactions readable. All processing happens in this browser.</p></div></section>
  <main>
    <section id="upload" class="upload-panel"><div class="upload-icon">⇧</div><h2>Open a bank or credit card statement</h2><p>Choose a PDF from Files or drag it here. Original files stay on your device.</p>
      <label for="file-input" class="primary upload-button">Choose PDF</label><input id="file-input" type="file" accept="application/pdf,.pdf" />
      <p class="small">No account, server, or API required. Text PDFs support suggestions; scans need manual masking.</p></section>
    <section id="workspace" class="workspace hidden" aria-label="PDF redaction editor">
      <aside class="sidebar">
        <div class="side-header"><strong id="file-title">Document</strong><span id="doc-details"></span></div>
        <div class="workflow-steps"><div class="step"><b>1</b><span>Review suggested sensitive fields</span></div><div class="step"><b>2</b><span>Draw any missing redaction boxes</span></div><div class="step"><b>3</b><span>Export an image-only PDF</span></div></div>
        <button class="secondary block" id="detect">✦ Find sensitive text</button>
        <p id="suggestion-note" class="hint">Suggestions are not applied until you accept them.</p>
        <div class="redaction-stats"><div><strong id="accepted-count">0</strong><span>Approved masks</span></div><div><strong id="pending-count">0</strong><span>Suggestions</span></div></div>
        <div class="side-label">PAGES</div><nav id="page-list" class="page-list"></nav>
        <div class="side-bottom"><strong>Review carefully</strong><p>Auto-detection can miss names, addresses, QR codes, and details in images. Read each page before exporting.</p></div>
      </aside>
      <section class="editor">
        <div class="toolbar"><div class="toolrow">
          <button id="draw-mode" class="modebtn active" aria-pressed="true">▣ Draw mask</button>
          <button id="pan-mode" class="modebtn" aria-pressed="false">✋ Navigate</button>
          <span class="separator"></span>
          <button id="undo" class="iconbtn" title="Undo" disabled>↶</button><button id="redo" class="iconbtn" title="Redo" disabled>↷</button>
          <button id="accept-page" class="quiet">Accept suggestions on page</button>
          <button id="clear-page" class="quiet danger">Clear page masks</button>
        </div><div class="toolrow">
          <button id="zoom-out" class="iconbtn">−</button><span id="zoom-label">100%</span><button id="zoom-in" class="iconbtn">+</button>
        </div></div>
        <div id="viewer" class="viewer"><div id="empty-page" class="loading">Preparing document...</div><div id="page-shell" class="page-shell hidden"><canvas id="pdf-canvas"></canvas><div id="overlay" class="overlay" aria-label="Draw redaction boxes"></div></div></div>
        <div class="page-bottom"><div class="page-controls"><button id="prev" class="iconbtn" title="Previous page">‹</button><span id="page-indicator">Page 1</span><button id="next" class="iconbtn" title="Next page">›</button><button id="mark-reviewed" class="quiet review-btn">□ Mark page reviewed</button></div><div class="legend"><span><i class="swatch red"></i> Approved (black in output)</span><span><i class="swatch amber"></i> Suggested</span></div></div>
      </section>
      <aside class="export-panel"><div class="side-label">EXPORT</div><h3>Sanitized copy</h3><p>Every output page is rebuilt from pixels. Original selectable text and hidden layers are not copied.</p>
        <label class="checkboxrow"><input type="checkbox" id="confirm-review"><span>I reviewed all pages and all sensitive information is masked.</span></label>
        <button id="export" class="primary block" disabled>Export redacted PDF ↗</button>
        <div id="export-result"></div><div class="privacy-box"><strong>Privacy note</strong><p>Verification can check the PDF structure, but cannot identify every unmasked personal detail.</p></div>
      </aside>
    </section>
  </main>
  <div id="toast" role="status" aria-live="polite"></div>
  <footer>PDF Privacy Redactor • Version 0.1 • Your original PDF is not modified</footer>
</div>`;

function toast(message, error=false) {
  const el = $('toast'); el.textContent = message; el.className = error ? 'show error' : 'show';
  clearTimeout(toast.timer); toast.timer = setTimeout(()=>el.className='', 5000);
}
function setBusy(value, message='') {
  state.busy = value;
  if (value && message) toast(message);
  for (const id of ['file-input','detect','export','reset','accept-page','clear-page']) $(id).disabled = value;
  updateControls();
}
function currentMasks() {return state.masks[state.page] || (state.masks[state.page] = []);}
function saveHistory() {
  state.history.push(JSON.stringify(state.masks));
  if(state.history.length > 60) state.history.shift();
  state.redo.length=0;
}
function refreshHistory() { $('undo').disabled=state.history.length===0; $('redo').disabled=state.redo.length===0; }
function clearExportState() {
  state.verified=null; state.lastExport=null;
  $('export-result').replaceChildren(); $('confirm-review').checked=false;
}
function mutate(fn) { saveHistory(); fn(); state.reviewedPages.delete(state.page); clearExportState(); renderBoxes(); updateControls(); refreshHistory(); }
function counts() {
  const all=Object.values(state.masks).flat();
  return {approved:all.filter(b=>b.accepted).length,pending:all.filter(b=>!b.accepted).length};
}
function updateControls() {
  const {approved,pending}=counts();
  $('accepted-count').textContent=approved; $('pending-count').textContent=pending;
  $('export').disabled = state.busy || approved===0 || state.reviewedPages.size !== state.numPages || !$('confirm-review').checked;
  $('prev').disabled = state.busy || state.page<=1;
  $('next').disabled = state.busy || state.page>=state.numPages;
  $('zoom-out').disabled = state.busy || state.zoom <= 0.75;
  $('zoom-in').disabled = state.busy || state.zoom >= 2;
  $('zoom-label').textContent = `${Math.round(state.zoom*100)}%`;
  $('mark-reviewed').textContent = `${state.reviewedPages.has(state.page) ? '☑' : '□'} Reviewed (${state.reviewedPages.size}/${state.numPages})`;
  $('mark-reviewed').disabled = !state.pdf || state.busy;
  $('reset').disabled=!state.pdf || state.busy;
  $('detect').disabled=!state.pdf || state.busy;
  $('accept-page').disabled=state.busy || !currentMasks().some(b=>!b.accepted);
  $('clear-page').disabled=state.busy || !currentMasks().length;
  refreshHistory();
  document.querySelectorAll('.page-button').forEach(b=>{
    b.classList.toggle('selected',Number(b.dataset.page)===state.page);
    const masks=state.masks[Number(b.dataset.page)]||[];
    b.querySelector('.page-total').textContent=state.reviewedPages.has(Number(b.dataset.page)) ? '✓ reviewed' : (masks.filter(m=>m.accepted).length ? `${masks.filter(m=>m.accepted).length} masks` : '');
  });
}
function setMode(mode) {
  state.mode=mode;
  $('draw-mode').classList.toggle('active',mode==='draw');
  $('pan-mode').classList.toggle('active',mode==='pan');
  $('draw-mode').setAttribute('aria-pressed',String(mode==='draw'));
  $('pan-mode').setAttribute('aria-pressed',String(mode==='pan'));
  $('overlay').classList.toggle('drawing',mode==='draw');
  $('overlay').classList.toggle('panning',mode==='pan');
  $('viewer').classList.toggle('navigate',mode==='pan');
}
function showDocument() {
  $('upload').classList.add('hidden');$('workspace').classList.remove('hidden');
  $('file-title').textContent=state.fileName;
  $('doc-details').textContent=`${state.numPages} page${state.numPages!==1?'s':''} • PDF`;
  const list=$('page-list'); list.replaceChildren();
  for (let i=1; i<=state.numPages; i++) {
    const button=document.createElement('button');button.className='page-button';button.dataset.page=i;
    button.innerHTML=`<span class="page-page">${i}</span><span>Page ${i}</span><small class="page-total"></small>`;
    button.addEventListener('click',()=>goPage(i));list.append(button);
  }
  updateControls();
}
async function openFile(file) {
  if(!file) return;
  if(!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {toast('Please choose a PDF file.',true);return;}
  if(file.size>100*1024*1024) {toast('PDF exceeds 100 MB. Please split it first.',true);return;}
  setBusy(true, 'Opening document locally...');
  const nonce=++state.docNonce;
  try {
    const raw=new Uint8Array(await file.arrayBuffer());
    // pdfjs-dist may transfer the source buffer to its worker; clone is intentional.
    const loaded=await pdfjsLib.getDocument({data:raw,isEvalSupported:false}).promise;
    if(nonce!==state.docNonce) {await loaded.destroy();return;}
    if(state.pdf) await state.pdf.destroy();
    state.pdf=loaded;state.numPages=loaded.numPages;state.fileName=file.name;
    state.page=1;state.zoom=1;state.masks={};state.history=[];state.redo=[];state.reviewedPages.clear();
    clearExportState();showDocument();setMode('draw');await renderPage();
    toast('Loaded locally. Review every page before export.');
  } catch(e) {toast(`Could not open PDF: ${e.message}`,true);console.error('PDF error type:',e.name);}
  finally {setBusy(false);$('file-input').value='';}
}
async function goPage(page) {if(state.busy || page<1 || page>state.numPages || page===state.page) return;state.page=page; await renderPage(); updateControls();}
async function renderPage() {
  if(!state.pdf) return;
  const ticket=++state.renderTicket;
  $('empty-page').classList.remove('hidden');$('page-shell').classList.add('hidden');
  $('empty-page').textContent='Rendering page...';
  try {
    const page=await state.pdf.getPage(state.page);
    const avail=Math.max(270, $('viewer').clientWidth-48);
    const base=page.getViewport({scale:1});
    const cssScale=Math.min(1.45, avail/base.width)*state.zoom;
    const viewport=page.getViewport({scale:cssScale});
    const dpr=Math.min(window.devicePixelRatio||1,2);
    const canvas=$('pdf-canvas');
    canvas.width=Math.round(viewport.width*dpr);canvas.height=Math.round(viewport.height*dpr);
    canvas.style.width=`${viewport.width}px`;canvas.style.height=`${viewport.height}px`;
    const ctx=canvas.getContext('2d', {alpha:false});
    await page.render({canvasContext:ctx,canvas,viewport,transform:[dpr,0,0,dpr,0,0]}).promise;
    if(ticket!==state.renderTicket) return;
    $('page-shell').style.width=`${viewport.width}px`;
    $('page-shell').style.height=`${viewport.height}px`;
    $('page-shell').classList.remove('hidden');$('empty-page').classList.add('hidden');
    renderBoxes(); $('page-indicator').textContent=`Page ${state.page} of ${state.numPages}`;
    updateControls();
    page.cleanup();
  } catch(e) {if(ticket===state.renderTicket){$('empty-page').textContent=`Could not render page: ${e.message}`;toast('PDF rendering error.',true);}}
}
function createMaskElement(box) {
  const elem=document.createElement('div');
  elem.className=`mask ${box.accepted?'approved':'suggested'}`;
  elem.style.left=`${box.x*100}%`;elem.style.top=`${box.y*100}%`;
  elem.style.width=`${box.w*100}%`;elem.style.height=`${box.h*100}%`;
  elem.title=box.accepted?'Approved mask — tap to remove':'Suggestion — tap to approve';
  elem.setAttribute('role','button');elem.setAttribute('tabindex','0');
  elem.setAttribute('aria-label',elem.title);
  elem.addEventListener('click',e=>{
    e.stopPropagation();if(state.mode==='pan' || state.busy) return;
    mutate(()=>{const masks=currentMasks();const found=masks.find(m=>m.id===box.id);
      if(!found) return;
      if(!found.accepted) found.accepted=true;
      else masks.splice(masks.indexOf(found),1);
    });
  });
  elem.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();elem.click();}});
  return elem;
}
function renderBoxes() {
  const overlay=$('overlay');overlay.replaceChildren();
  for(const box of currentMasks()) overlay.append(createMaskElement(box));
  updateControls();
}
function pointInOverlay(event) {
  const rect=$('overlay').getBoundingClientRect();
  return {x:clamp((event.clientX-rect.left)/rect.width,0,1),y:clamp((event.clientY-rect.top)/rect.height,0,1)};
}
$('overlay').addEventListener('pointerdown',e=>{
  if(state.mode!=='draw'||state.busy||e.target!==$('overlay')) return;
  e.preventDefault(); pointerStart=pointInOverlay(e);
  $('overlay').setPointerCapture(e.pointerId);
  const preview=document.createElement('div');preview.className='mask preview';preview.id='drawing-preview';$('overlay').append(preview);
});
$('overlay').addEventListener('pointermove',e=>{
  if(!pointerStart) return;
  const pos=pointInOverlay(e);const box=normalizeBox(pointerStart.x,pointerStart.y,pos.x,pos.y);
  const preview=$('drawing-preview');if(!preview)return;
  Object.assign(preview.style,{left:`${box.x*100}%`,top:`${box.y*100}%`,width:`${box.w*100}%`,height:`${box.h*100}%`});
});
function finishDrawing(e) {
  if(!pointerStart) return;
  const pos=pointInOverlay(e);const box=normalizeBox(pointerStart.x,pointerStart.y,pos.x,pos.y);
  pointerStart=null;$('drawing-preview')?.remove();
  if(box.w<0.004||box.h<0.004) return;
  mutate(()=>currentMasks().push({...box,id:rectCounter++,accepted:true,label:'Manual'}));
}
$('overlay').addEventListener('pointerup',finishDrawing);
$('overlay').addEventListener('pointercancel',()=>{pointerStart=null;$('drawing-preview')?.remove();});

async function detect() {
  if(!state.pdf||state.busy)return;
  setBusy(true);let total=0, scanned=0;
  try {
    const gathered={}; state.reviewedPages.clear();
    for(let i=1;i<=state.numPages;i++) {
      toast(`Inspecting searchable text, page ${i}/${state.numPages}...`);
      const p=await state.pdf.getPage(i);
      const items=(await p.getTextContent()).items;
      if(items.filter(v=>v.str?.trim()).length<3) scanned++;
      const boxes=suggestionsFromTextItems(items,p.getViewport({scale:1}),pdfjsLib.Util);
      gathered[i]=boxes.map(b=>({...b,id:rectCounter++,accepted:false}));
      p.cleanup();
    }
    mutate(()=>{
      for(let i=1;i<=state.numPages;i++) {
        const existing=state.masks[i]||[];
        const fresh=gathered[i].filter(c=>!existing.some(e=>
          Math.abs(c.x-e.x)<0.01 && Math.abs(c.y-e.y)<0.01 && Math.abs(c.w-e.w)<0.03));
        state.masks[i]=[...existing,...fresh];total+=fresh.length;
      }
    });
    $('suggestion-note').textContent=`${total} suggestion(s). ${scanned ? `${scanned} page(s) have little or no selectable text and require careful manual review.` : ''} Tap amber regions to approve.`;
    toast(`Found ${total} suggestions. None were applied automatically.`);
  } catch(e){toast(`Detection failed: ${e.message}`,true);}
  finally{setBusy(false);renderBoxes();}
}
function downloadBytes(bytes,filename) {
  const blob=new Blob([bytes],{type:'application/pdf'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=filename;a.style.display='none';
  document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}
async function exportPdf() {
  if(state.busy||!state.pdf||!$('confirm-review').checked||state.reviewedPages.size!==state.numPages)return;
  if(counts().approved===0) return;
  if(!window.confirm('Export an image-only copy? Confirm that you reviewed ALL pages, including QR codes, scanned text, names and addresses.')) return;
  setBusy(true,'Exporting approved masks locally...');
  try {
    const result=await exportFlattenedPdf(state.pdf,state.masks,(n,total)=>toast(`Rendering sanitized pages ${n}/${total}...`));
    const verification=await verifyOutput(pdfjsLib,result.bytes,result.pageCount);
    state.verified=verification;
    if(!verification.passed) throw new Error(`Verification failed: ${verification.details.join(' ')}`);
    const basename=state.fileName.replace(/\.pdf$/i,'').replace(/[^a-z0-9_.-]/gi,'_');
    const filename=`${basename || 'document'}_REDACTED.pdf`;
    downloadBytes(result.bytes,filename);
    $('export-result').innerHTML=`<div class="success-result"><strong>✓ Structural checks passed</strong><p>${result.pageCount} page(s) · ${result.maskCount} applied mask(s). No selectable text, PDF annotations, or attachments detected.</p><p><b>Visual review is still required.</b> Your original file was unchanged.</p></div>`;
    toast(`Exported ${filename}`);
  } catch(e){$('export-result').innerHTML='<div class="failure-result">Export or structural verification failed. No verified file was delivered.</div>';toast(`Export failed: ${e.message}`,true);}
  finally{setBusy(false);}
}

$('file-input').addEventListener('change',e=>openFile(e.target.files?.[0]));
$('reset').addEventListener('click',async()=>{
  if(!window.confirm('Close this document and clear its in-memory redaction data?')) return;
  state.docNonce++;state.renderTicket++;
  if(state.pdf) await state.pdf.destroy();
  state.pdf=null;state.numPages=0;state.masks={};state.history=[];state.redo=[];state.reviewedPages.clear();state.page=1;
  $('workspace').classList.add('hidden');$('upload').classList.remove('hidden');$('file-input').value='';clearExportState();updateControls();
});
$('detect').addEventListener('click',detect);
$('draw-mode').addEventListener('click',()=>setMode('draw'));
$('pan-mode').addEventListener('click',()=>setMode('pan'));
$('prev').addEventListener('click',()=>goPage(state.page-1));
$('next').addEventListener('click',()=>goPage(state.page+1));
$('zoom-in').addEventListener('click',()=>{state.zoom=Math.min(2,state.zoom+0.25);renderPage();});
$('zoom-out').addEventListener('click',()=>{state.zoom=Math.max(0.75,state.zoom-0.25);renderPage();});
$('accept-page').addEventListener('click',()=>mutate(()=>currentMasks().forEach(mask=>mask.accepted=true)));
$('clear-page').addEventListener('click',()=>{if(window.confirm('Remove all masks from this page?'))mutate(()=>state.masks[state.page]=[]);});
$('confirm-review').addEventListener('change',updateControls);
$('mark-reviewed').addEventListener('click',()=>{
  if(state.reviewedPages.has(state.page)) state.reviewedPages.delete(state.page);
  else state.reviewedPages.add(state.page);
  $('confirm-review').checked=false;updateControls();
});
$('export').addEventListener('click',exportPdf);
$('undo').addEventListener('click',()=>{
  if(!state.history.length)return;
  state.redo.push(JSON.stringify(state.masks));state.masks=JSON.parse(state.history.pop());state.reviewedPages.clear();clearExportState();renderBoxes();
});
$('redo').addEventListener('click',()=>{
  if(!state.redo.length)return;
  state.history.push(JSON.stringify(state.masks));state.masks=JSON.parse(state.redo.pop());state.reviewedPages.clear();clearExportState();renderBoxes();
});
window.addEventListener('resize',()=>{if(!state.pdf)return;clearTimeout(resizeTimer);resizeTimer=setTimeout(renderPage,200);});
const upload=$('upload');
upload.addEventListener('dragover',e=>{e.preventDefault();upload.classList.add('dragover');});
upload.addEventListener('dragleave',()=>upload.classList.remove('dragover'));
upload.addEventListener('drop',e=>{e.preventDefault();upload.classList.remove('dragover');openFile(e.dataTransfer.files?.[0]);});
setMode('draw');updateControls();
