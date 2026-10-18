"""Synthetic browser regression: pip install playwright pymupdf; install Chromium.
Run against a production preview: python scripts/browser-smoke.py [base URL].
No real statements are used. Downloaded test output is held in a temporary directory.
"""
import os
import sys
import tempfile
from urllib.parse import urlsplit

import fitz
from playwright.sync_api import sync_playwright

base = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:4173/'
origin = urlsplit(base).netloc
sample = os.path.join(os.path.dirname(__file__), '..', 'samples', 'FAKE_bank_statement.pdf')
with sync_playwright() as p, tempfile.TemporaryDirectory() as tmp:
    browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), args=['--no-sandbox'])
    context = browser.new_context(viewport={'width': 1024, 'height': 768}, has_touch=True, device_scale_factor=2, accept_downloads=True)
    page = context.new_page()
    errors, external, uploads = [], [], []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('dialog', lambda d: d.accept())
    def record(request):
        if request.url.startswith(('http:', 'https:')):
            if urlsplit(request.url).netloc != origin:
                external.append(request.url)
            if request.method not in ('GET', 'HEAD') or request.post_data_buffer:
                uploads.append((request.method, request.url))
    context.on('request', record)
    page.goto(base)
    page.locator('#file-input').set_input_files(sample)
    page.wait_for_function("() => document.querySelector('#doc-details').textContent.includes('2 pages') && !document.querySelector('#detect').disabled")
    page.locator('#page-shell').wait_for(state='visible')
    for width, height in [(768, 1024), (1024, 768), (390, 844)]:
        page.set_viewport_size({'width': width, 'height': height})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'Horizontal overflow at {width}'
    page.set_viewport_size({'width': 1024, 'height': 768})
    # Use a large manual box so its center and boundary can be checked independently.
    box = page.locator('#overlay').bounding_box()
    x1, y1 = box['x'] + box['width'] * .1, box['y'] + box['height'] * .1
    x2, y2 = box['x'] + box['width'] * .8, box['y'] + box['height'] * .25
    page.mouse.move(x1, y1)
    page.mouse.down()
    page.mouse.move(x2, y2, steps=10)
    page.mouse.up()
    assert page.locator('#accepted-count').inner_text() == '1'
    page.locator('#undo').click()
    assert page.locator('#accepted-count').inner_text() == '0'
    page.locator('#redo').click()
    assert page.locator('#accepted-count').inner_text() == '1'
    page.locator('#pencil-only').check()
    page.mouse.move(x1, y1)
    page.mouse.down()
    page.mouse.move(x2, y2)
    page.mouse.up()
    assert page.locator('#accepted-count').inner_text() == '1', 'Pencil-only mode accepted mouse input'
    # Older Safari click events can lack pointerType; retain the pen pointerdown type.
    page.locator('.mask.approved').evaluate("el => { el.dispatchEvent(new PointerEvent('pointerdown', {pointerType:'pen', bubbles:true})); el.dispatchEvent(new MouseEvent('click', {detail:1, bubbles:true})); }")
    assert page.locator('#accepted-count').inner_text() == '0'
    page.locator('#undo').click()
    # Touch cancellation must discard the preview rather than export a partial mask.
    page.locator('#pencil-only').uncheck()
    cdp = context.new_cdp_session(page)
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x1, 'y': y1, 'id': 1}]})
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x2, 'y': y2, 'id': 1}]})
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchCancel', 'touchPoints': []})
    assert page.locator('#drawing-preview').count() == 0
    assert page.locator('#accepted-count').inner_text() == '1'
    # A second finger must not replace the first finger's starting coordinate.
    box = page.locator('#overlay').bounding_box()
    def touch(fx, fy, pointer):
        return {'x': box['x'] + box['width'] * fx, 'y': box['y'] + box['height'] * fy, 'id': pointer}
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [touch(.15, .35, 1)]})
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [touch(.15, .35, 1), touch(.4, .4, 2)]})
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [touch(.35, .5, 1), touch(.5, .55, 2)]})
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
    assert page.locator('#accepted-count').inner_text() == '2'
    left = page.locator('.mask.approved').last.evaluate('(el) => parseFloat(el.style.left)')
    assert abs(left - 15) < 1, f'Second pointer corrupted gesture: {left}'
    page.locator('#undo').click()
    page.locator('#pencil-only').check()
    page.locator('.mask.approved').click()
    assert page.locator('#accepted-count').inner_text() == '1', 'Mouse must not delete masks in Pencil-only mode'
    page.locator('#mark-reviewed').click()
    page.locator('#next').click()
    page.wait_for_function("() => document.querySelector('#page-indicator').textContent === 'Page 2 of 2'")
    page.locator('#page-shell').wait_for(state='visible')
    box = page.locator('#overlay').bounding_box()
    px, py = box['x'] + box['width'] * .3, box['y'] + box['height'] * .2
    for kind, x, y, buttons in [('mousePressed', px, py, 1), ('mouseMoved', px + 60, py + 35, 1), ('mouseReleased', px + 60, py + 35, 0)]:
        cdp.send('Input.dispatchMouseEvent', {'type': kind, 'x': x, 'y': y, 'button': 'left', 'buttons': buttons, 'clickCount': 1, 'pointerType': 'pen'})
    assert page.locator('#accepted-count').inner_text() == '2', 'Pen input must draw with Pencil-only enabled'
    page.locator('#mark-reviewed').click()
    page.locator('#confirm-review').check()
    with page.expect_download() as download:
        page.locator('#export').click()
    output = os.path.join(tmp, 'redacted.pdf')
    download.value.save_as(output)
    page.locator('.success-result').wait_for()
    with fitz.open(output) as pdf:
        assert len(pdf) == 2
        assert pdf.embfile_count() == 0
        for sheet in pdf:
            assert not sheet.get_text().strip()
            assert not list(sheet.annots() or [])
            assert not sheet.get_links()
            assert sheet.get_images(), 'Output must contain raster images'
        pix = pdf[0].get_pixmap()
        # The normalized manual rectangle must actually overwrite exported pixels.
        for fx, fy in [(.12, .12), (.45, .17), (.78, .23)]:
            assert max(pix.pixel(int(pix.width * fx), int(pix.height * fy))[:3]) < 20
    assert not errors, errors
    assert not external, external
    assert not uploads, uploads
    print('PASS: synthetic import, manual mask, undo/redo, Pencil-only filtering, two-page export, independent PDF structure/pixel checks, tablet/mobile widths, no external requests or uploads.')
    browser.close()
