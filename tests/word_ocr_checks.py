"""Actual DOCX round-trip validation and OCR result review controls in Chromium."""
import os,zipfile,xml.etree.ElementTree as ET
from pathlib import Path
from playwright.sync_api import sync_playwright
from docx import Document
from PIL import Image,ImageDraw
url=os.environ.get('SCANNER_URL','http://127.0.0.1:8765')
im=Image.new('RGB',(600,800),'white');ImageDraw.Draw(im).text((80,80),'REVIEWED TEXT DOCUMENT',fill='black');im.save('/tmp/word-test-page.png')
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None),headless=True,args=['--no-sandbox'])
 context=browser.new_context(accept_downloads=True);page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(url);page.wait_for_function('!state.restoring');assert page.locator('#downloadWordBtn').is_visible() and page.locator('#downloadWordBtn').is_disabled()
 for n in [1,2]:
  page.locator('#importFile').set_input_files('/tmp/word-test-page.png');page.wait_for_selector('#cropModal[open]');page.locator('#resetCropBtn').click();page.locator('#confirmCropBtn').click();page.wait_for_function(f'state.pages.length==={n} && !state.busy')
 page.locator('.page').nth(0).get_by_text('Text / identify',exact=True).click();page.locator('#recognizedText').fill('Corrected invoice\nTotal: ₦450 & <reviewed>\nCafé Ελληνικά Русский 中文 हिन्दी مرحبا 😀')
 with page.expect_download() as dl:page.locator('#downloadWordCurrentBtn').click()
 path=dl.value.path();assert dl.value.suggested_filename.endswith('.docx');doc=Document(path);text='\n'.join(p.text for p in doc.paragraphs)
 for s in ['Corrected invoice','₦450 & <reviewed>','Café','中文','हिन्दी','مرحبا','😀']:assert s in text,(s,text)
 with zipfile.ZipFile(path) as z:
  for name in z.namelist():
   if not name.endswith("/"):ET.fromstring(z.read(name))
  assert 'word/document.xml' in z.namelist() and '[Content_Types].xml' in z.namelist()
 assert not page.locator('#textModal').is_visible();assert page.locator('#downloadWordBtn').is_enabled()
 print('PASS prominent Save review & download Word creates a genuine, editable Unicode DOCX')
 # An unreviewed second page remains represented without leaking stale words.
 page.evaluate('state.pages[1].text="UNREVIEWED SECRET";state.pages[1].ocrStale=true;renderPages()')
 page.locator('#exportFormat').select_option('docx')
 with page.expect_download() as dl:page.locator('#downloadPdfBtn').click()
 text='\n'.join(p.text for p in Document(dl.value.path()).paragraphs);assert 'Page 1' in text and 'Page 2' in text;assert 'UNREVIEWED SECRET' not in text;assert 'needs review' in text
 page.locator('#exportPages').select_option(page.evaluate('state.pages[1].id'));assert page.locator('#downloadPdfBtn').is_disabled() and page.locator('#downloadWordBtn').is_disabled()
 page.locator('#exportPages').select_option(page.evaluate('state.pages[0].id'));page.wait_for_function('navigator.serviceWorker.controller !== null');context.set_offline(True)
 with page.expect_download() as dl:page.locator('#downloadWordBtn').click()
 assert 'Corrected invoice' in '\n'.join(p.text for p in Document(dl.value.path()).paragraphs)
 print('PASS all-page/single-page Word export, explicit unreviewed placeholders, stale exclusion and offline download')
 # Exercise result comparison without replacing user corrections when switching passes.
 context.set_offline(False);page.locator('.page').nth(0).get_by_text('Text / identify',exact=True).click()
 page.evaluate('OCRReview.render([{text:"Low confidence word",confidence:60,words:[{text:"confidence",confidence:45,bbox:{x0:60,y0:60,x1:200,y1:100}}],label:"Contrast preparation"},{text:"Alternate result",confidence:65,words:[],label:"Alternate lighting preparation"}],0,state.editing.image)')
 page.locator('#recognizedText').fill('My corrected first result');page.locator('#ocrResultChoice').select_option('1');page.locator('#recognizedText').fill('My corrected second result');page.locator('#ocrResultChoice').select_option('0');assert page.locator('#recognizedText').input_value()=='My corrected first result'
 page.locator('#uncertainWords button').click();page.wait_for_function('document.getElementById("ocrWordPreview").width>0');page.locator('#closeTextBtn').click();assert page.evaluate('state.pages[0].text.startsWith("Corrected invoice")')
 assert not errors,errors
 print('PASS candidate switching retains per-result corrections, uncertain-word image crops and cancel preserve saved text')
 browser.close()
