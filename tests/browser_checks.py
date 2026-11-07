"""Run against `python -m http.server 8765` with Python Playwright and Chromium installed."""
import json, os
from pathlib import Path
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw, ImageFont
ROOT=Path(__file__).resolve().parents[1]
fixture=Image.new('RGB',(1400,1800),'#333333');d=ImageDraw.Draw(fixture)
d.rectangle((130,130,1270,1670),fill='white')
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',44)
for y,text in enumerate(['INVOICE','Invoice No: INV-2026-11','Date: 2026-11-04','Grand total: 123.45','JUO Legacy Scanner test document']):d.text((210,300+y*170),text,font=font,fill='black')
fixture.save('/tmp/scanner-fixture.png')
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None),headless=True,args=['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'])
 context=browser.new_context(permissions=['camera'],accept_downloads=True,viewport={'width':390,'height':844})
 if os.environ.get('SCANNER_ASSET_FIXTURES'):
  assets=Path(os.environ['SCANNER_ASSET_FIXTURES']);manifest=json.loads((ROOT/'ocr-assets.json').read_text())
  context.route(manifest['core']['url'],lambda route:route.fulfill(path=str(assets/'core.js'),content_type='application/javascript',headers={'Access-Control-Allow-Origin':'*'}))
  context.route(manifest['languages']['eng']['url'],lambda route:route.fulfill(path=str(assets/'eng.traineddata'),content_type='application/octet-stream',headers={'Access-Control-Allow-Origin':'*'}))
 context.add_init_script("document.addEventListener('DOMContentLoaded',()=>{const s=document.getElementById('ocrAccuracy');if(s)s.value='fast';});")
 page=context.new_page(); errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(os.environ.get('SCANNER_URL','http://127.0.0.1:8765'));page.wait_for_function('!state.restoring')
 page.locator('#importFile').set_input_files('/tmp/scanner-fixture.png')
 page.wait_for_selector('#cropModal[open]');assert page.locator('#cropAdvice').inner_text().startswith('Page detected.')
 page.locator('#confirmCropBtn').click();page.wait_for_function('state.pages.length===1 && !state.busy')
 assert page.locator('.page').count()==1
 page.locator('#startCameraBtn').click();page.wait_for_function('state.stream !== null && !state.starting')
 page.locator('#captureBtn').click();page.wait_for_selector('#cropModal[open]');assert page.evaluate('state.stream===null')
 page.locator('#cancelCropBtn').click();assert page.evaluate('state.source===null')
 print('PASS import, page detection, perspective processing, camera capture and cancellation')
 page.locator('.page button',has_text='Text / identify').click()
 page.locator('#recognizedText').fill('INVOICE\nInvoice No: INV-2026-11\nTotal: 123.45')
 page.locator('#documentType').select_option('Invoice');page.locator('#identifiedFields').fill('Total: 123.45')
 page.locator('#saveTextBtn').click();page.wait_for_function('state.persist')
 assert 'Invoice' in page.locator('.page p').inner_text()
 with page.expect_download() as dl:page.locator('#downloadTextBtn').click()
 assert 'INV-2026-11' in Path(dl.value.path()).read_text()
 page.reload();page.wait_for_function('!state.restoring');assert page.locator('.page').count()==1
 assert page.evaluate('state.pages[0].text.includes("INV-2026-11")')
 print('PASS reviewed text download and local draft recovery')
 # An OCR word box fixture verifies real PDF generation, including invisible text.
 page.evaluate('state.pages[0].words=[{text:"INVOICE",bbox:{x0:100,y0:100,x1:400,y1:160}}]')
 with page.expect_download() as dl:page.locator('#downloadPdfBtn').click()
 pdf=Path(dl.value.path()).read_bytes();assert pdf.startswith(b'%PDF-');Path('/tmp/scanner-export.pdf').write_bytes(pdf)
 assert page.locator('.page').count()==1
 print('PASS real PDF download with searchable word layer; draft retained')
 page.wait_for_function('navigator.serviceWorker.controller !== null')
 context.set_offline(True);page.reload();page.wait_for_function('!state.restoring');assert page.locator('.page').count()==1
 with page.expect_download() as dl:page.locator('#downloadPdfBtn').click()
 assert Path(dl.value.path()).read_bytes().startswith(b'%PDF-')
 print('PASS offline reload, recovery, and PDF export')
 context.set_offline(False)
 page.locator('.page button',has_text='Rotate').click();page.wait_for_function('PageEditor.isOpen() && !document.getElementById("savePageEditBtn").disabled');page.locator('#savePageEditBtn').click();page.wait_for_function('!PageEditor.isOpen() && !state.busy');assert page.evaluate('state.pages[0].words.length===0 && state.pages[0].ocrStale && state.pages[0].text.includes("INV-2026-11")')
 page.screenshot(path='/tmp/scanner-preview.png',full_page=True)
 page.on('dialog',lambda d:d.accept());page.locator('#clearBtn').click();page.wait_for_function('state.pages.length===0');page.reload();page.wait_for_function('!state.restoring');assert page.locator('.page').count()==0
 if os.environ.get('SCANNER_TEST_OCR')=='1':
  page.locator('#importFile').set_input_files('/tmp/scanner-fixture.png');page.wait_for_selector('#cropModal[open]');page.locator('#confirmCropBtn').click();page.wait_for_function('state.pages.length===1 && !state.busy')
  page.evaluate("""async () => {const p=state.pages[0],img=new Image();img.src=p.image;await img.decode();const c=rotate(imageCanvas(img),90);p.image=c.toDataURL('image/jpeg',.95);[p.width,p.height]=[p.height,p.width];p.paper=[p.paper[1],p.paper[0]];if(p.editRecipe)p.editRecipe.rotation=(p.editRecipe.rotation+90)%360;}""")
  page.locator('.page button',has_text='Text / identify').click();page.locator('#recognizeBtn').click();page.wait_for_function('!state.ocrBusy',timeout=180000)
  assert 'INVOICE' in page.locator('#recognizedText').input_value().upper(),page.locator('#ocrStatus').inner_text()
  assert page.locator('#documentType').input_value()=='Invoice'
  page.locator('#saveTextBtn').click();assert page.evaluate('state.pages[0].words.length>0 && state.pages[0].height>state.pages[0].width && state.pages[0].editRecipe.rotation%180===0')
  print('PASS real OCR, orientation correction, classification and word coordinates')
 assert not errors,errors
 print('PASS rotation preserves reviewed text with stale geometry excluded, clear removes recovered pages; no browser errors')
 browser.close()
