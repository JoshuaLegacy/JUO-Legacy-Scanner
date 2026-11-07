"""Browser regression for corrected Unicode search, book controls, and barcode fallback.
Optional SCANNER_TEST_OFFLINE_OCR=1 tests a real prepared language in a fresh offline worker.
SCANNER_ASSET_FIXTURES can point to an existing directory of pinned core/model downloads.
"""
import os, subprocess, tempfile, json
from pathlib import Path
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw, ImageFont
url=os.environ.get('SCANNER_URL','http://127.0.0.1:8765')
fixture=Image.new('RGB',(1200,1600),'#333333');draw=ImageDraw.Draw(fixture);draw.rectangle((100,100,1100,1500),fill='white')
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',38)
for i,line in enumerate(['INVOICE','Invoice No: INV-2026-11','Date: 2026-11-04','Grand total: 123.45']):draw.text((150,300+i*180),line,font=font,fill='black')
fixture.save('/tmp/scanner-followup.png')
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None),headless=True,args=['--no-sandbox'])
 context=browser.new_context(accept_downloads=True,viewport={'width':390,'height':844});context.add_init_script("document.addEventListener('DOMContentLoaded',()=>{const s=document.getElementById('ocrAccuracy');if(s)s.value='fast';});")
 page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(url);page.wait_for_function('!state.restoring');page.wait_for_function('navigator.serviceWorker.controller !== null')
 page.locator('#importFile').set_input_files('/tmp/scanner-followup.png');page.wait_for_selector('#cropModal[open]')
 page.locator('#bookControls summary').click();page.locator('#topCurve').fill('8');page.wait_for_function('document.getElementById("bookPreview").width>10')
 page.locator('#topCurve').fill('0');page.locator('#confirmCropBtn').click();page.wait_for_function('state.pages.length===1 && !state.busy')
 print('PASS guided book correction controls and preview')
 page.locator('.page button',has_text='Text / identify').click()
 reviewed='Corrected invoice INV-2026-11\nTotal: ₦450\nCafé Ελληνικά Русский 中文 हिन्दी 😀'
 page.locator('#recognizedText').fill(reviewed);page.locator('#saveTextBtn').click()
 with page.expect_download() as dl:page.locator('#downloadPdfBtn').click()
 path=dl.value.path();extracted=subprocess.check_output(['pdftotext','-raw',path,'-'],text=True)
 for text in ['Corrected invoice INV-2026-11','₦450','Café','Ελληνικά','Русский','中文','हिन्दी','😀']:assert text in extracted,(text,extracted)
 assert 'x\n' not in extracted
 print('PASS real PDF extraction of manually corrected text across Unicode scripts')
 # Generate a QR fixture, then exercise the bundled decoder with the native API absent and network offline.
 page.evaluate('''async () => {await loadScript(engines.barcode);delete window.BarcodeDetector;const writer=new ZXing.QRCodeWriter(),matrix=writer.encode('https://example.com/scanner-test',ZXing.BarcodeFormat.QR_CODE,360,360,new Map()),c=makeCanvas(360,360),ctx=c.getContext('2d');for(let y=0;y<360;y++)for(let x=0;x<360;x++){ctx.fillStyle=matrix.get(x,y)?'black':'white';ctx.fillRect(x,y,1,1);}state.pages[0].image=c.toDataURL('image/png');}''')
 context.set_offline(True);page.locator('.page button',has_text='Text / identify').click();page.locator('#barcodeBtn').click();page.wait_for_function('!state.ocrBusy')
 assert 'https://example.com/scanner-test' in page.locator('#identifiedFields').input_value(),page.locator('#ocrStatus').inner_text()
 assert page.url.startswith(url)
 page.locator('#closeTextBtn').click();context.set_offline(False)
 print('PASS barcode fallback without native API, offline, with inert decoded URLs')
 # Cancellation and integrity failures leave readiness false and keep the saved document.
 page.locator('.page button',has_text='Text / identify').click()
 core=page.evaluate('(async()=> (await OfflineOCR.manifest()).core)()')
 page.evaluate("""coreURL=>{window.savedFetch=window.fetch;window.downloadStarted=false;window.fetch=(url,options)=>String(url)===coreURL?new Promise((resolve,reject)=>{window.downloadStarted=true;options.signal.addEventListener('abort',()=>reject(new DOMException('Cancelled','AbortError')));}):window.savedFetch(url,options);}""",core['url'])
 page.locator('#prepareOCRBtn').click();page.wait_for_function('window.downloadStarted');page.locator('#cancelOCRBtn').click();page.wait_for_function('!state.ocrBusy');assert 'cancelled' in page.locator('#ocrStatus').inner_text().lower()
 page.evaluate('window.fetch=window.savedFetch')
 context.route(core['url'],lambda route:route.fulfill(body=bytes(core['bytes']),content_type='application/javascript',headers={'Access-Control-Allow-Origin':'*'}))
 page.locator('#prepareOCRBtn').click();page.wait_for_function('!state.ocrBusy',timeout=30000);assert 'integrity check failed' in page.locator('#ocrStatus').inner_text()
 assert not page.evaluate('(async()=> (await OfflineOCR.status("eng")).ready)()')
 context.unroute(core['url']);page.locator('#closeTextBtn').click()
 print('PASS download cancellation and rejection of corrupted OCR assets')
 if os.environ.get('SCANNER_TEST_OFFLINE_OCR')=='1':
  fixtures=os.environ.get('SCANNER_ASSET_FIXTURES')
  if fixtures:
   manifest=json.loads((Path(__file__).resolve().parents[1]/'ocr-assets.json').read_text())
   context.route(manifest['core']['url'],lambda route:route.fulfill(path=str(Path(fixtures)/'core.js'),content_type='application/javascript',headers={'Access-Control-Allow-Origin':'*'}))
   context.route(manifest['languages']['eng']['url'],lambda route:route.fulfill(path=str(Path(fixtures)/'eng.traineddata'),content_type='application/octet-stream',headers={'Access-Control-Allow-Origin':'*'}))
  # Restore the invoice image for a real offline OCR run, not the QR fixture.
  page.locator('#importFile').set_input_files('/tmp/scanner-followup.png');page.wait_for_selector('#cropModal[open]');page.locator('#confirmCropBtn').click();page.wait_for_function('state.pages.length===2 && !state.busy')
  page.locator('.page').nth(1).get_by_text('Text / identify',exact=True).click();page.locator('#prepareOCRBtn').click();page.wait_for_function('!state.ocrBusy',timeout=180000)
  assert 'ready for offline' in page.locator('#packStatus').inner_text(),page.locator('#ocrStatus').inner_text()
  page.locator('#closeTextBtn').click();page.reload();page.wait_for_function('!state.restoring');context.set_offline(True)
  page.locator('.page').nth(1).get_by_text('Text / identify',exact=True).click();page.locator('#autoOrient').uncheck();page.locator('#recognizeBtn').click();page.wait_for_function('!state.ocrBusy',timeout=180000)
  assert 'INVOICE' in page.locator('#recognizedText').input_value().upper(),page.locator('#ocrStatus').inner_text()
  page.locator('#saveTextBtn').click();assert page.evaluate('state.pages[1].words.length>0')
  print('PASS prepared, integrity-checked OCR pack with a fresh worker after offline reload')
  page.locator('.page').nth(1).get_by_text('Text / identify',exact=True).click();previous=page.evaluate('state.pages[1].text');page.locator('#recognizeBtn').click();page.locator('#cancelOCRBtn').click();page.wait_for_function('!state.ocrBusy');assert page.evaluate('state.pages[1].text')==previous
  page.locator('#closeTextBtn').click();print('PASS recognition cancellation preserves reviewed text')
  page.locator('.page').nth(1).get_by_text('Text / identify',exact=True).click();page.locator('#removeOCRBtn').click();page.wait_for_function('document.getElementById("packStatus").textContent.includes("not downloaded")')
  page.locator('#recognizeBtn').click();page.wait_for_function('!state.ocrBusy',timeout=30000);assert 'not downloaded' in page.locator('#ocrStatus').inner_text()
  print('PASS removed/missing language is reported clearly while offline')
 assert not errors,errors
 browser.close()
