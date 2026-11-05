"""Color preservation, real image formats, safe automatic cropping, and negotiated camera resolution."""
import os,io,zipfile
from pathlib import Path
from PIL import Image,ImageDraw
from playwright.sync_api import sync_playwright
url=os.environ.get('SCANNER_URL','http://127.0.0.1:8765')
fixture=Image.new('RGB',(720,960),(145,145,145));d=ImageDraw.Draw(fixture);d.rectangle((105,90,615,870),fill=(92,80,151));d.rectangle((150,510,570,830),fill=(225,225,225));d.text((240,200),'COLOR COVER',fill='white');fixture.save('/tmp/scanner-color-cover.png')
blank=Image.new('RGB',(640,480),(120,120,120));blank.save('/tmp/scanner-uniform.png')
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None),headless=True,args=['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'])
 context=browser.new_context(permissions=['camera'],accept_downloads=True);page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept())
 page.goto(url);page.wait_for_function('!state.restoring');assert page.locator('#enhancement').input_value()=='original'
 page.locator('#autoCrop').check();page.locator('#importFile').set_input_files('/tmp/scanner-color-cover.png');page.wait_for_function('state.pages.length===1 && !state.busy');assert not page.locator('#cropModal').is_visible()
 page.locator('#exportFormat').select_option('png')
 with page.expect_download() as dl:page.locator('#downloadPdfBtn').click()
 data=Path(dl.value.path()).read_bytes();assert data.startswith(b'\x89PNG\r\n\x1a\n');im=Image.open(io.BytesIO(data)).convert('RGB');r,g,b=im.getpixel((im.width//2,im.height//5));assert 70<r<120 and 65<g<110 and 125<b<180,(r,g,b)
 print('PASS Original preserves the purple cover and confident automatic crop saves the complete page')
 page.locator('.page').get_by_text('Edit / Retake',exact=True).click();page.locator('#editorEnhancement').select_option('color');page.wait_for_function('!document.getElementById("savePageEditBtn").disabled');page.locator('#savePageEditBtn').click();page.wait_for_function('!PageEditor.isOpen()')
 with page.expect_download() as dl:page.locator('#downloadPdfBtn').click()
 im=Image.open(dl.value.path()).convert('RGB');r,g,b=im.getpixel((im.width//2,im.height//5));assert r<130 and b<190,(r,g,b)
 page.locator('#exportFormat').select_option('jpeg')
 with page.expect_download() as dl:page.locator('#downloadPdfBtn').click()
 assert Path(dl.value.path()).read_bytes().startswith(b'\xff\xd8');import base64;assert Path(dl.value.path()).read_bytes()==base64.b64decode(page.evaluate('state.pages[0].image.split(",")[1]'));assert Image.open(dl.value.path()).size==tuple(page.evaluate('[state.pages[0].width,state.pages[0].height]'))
 print('PASS gentle Color mode avoids bleaching; JPEG and PNG are real encoded image files')
 page.locator('#importFile').set_input_files('/tmp/scanner-uniform.png');page.wait_for_selector('#cropModal[open]');assert page.evaluate('state.pages.length===1');page.locator('#confirmCropBtn').click();page.wait_for_function('state.pages.length===2 && !state.busy')
 page.wait_for_function('navigator.serviceWorker.controller !== null');context.set_offline(True);page.reload();page.wait_for_function('!state.restoring');page.locator('#exportFormat').select_option('png')
 with page.expect_download() as dl:page.locator('#downloadPdfBtn').click()
 with zipfile.ZipFile(dl.value.path()) as z:
  assert len(z.namelist())==2 and z.testzip() is None
  assert all(z.read(n).startswith(b'\x89PNG\r\n\x1a\n') for n in z.namelist())
 page.locator('#exportPages').select_option(page.evaluate('state.pages[1].id'));page.locator('#exportFormat').select_option('pdf')
 with page.expect_download() as dl:page.locator('#downloadPdfBtn').click()
 assert Path(dl.value.path()).read_bytes().startswith(b'%PDF-')
 print('PASS uncertain auto-crop falls back to review; offline multi-PNG ZIP and selected-page PDF export')
 context.set_offline(False);page.locator('#autoCrop').uncheck();page.locator('#startCameraBtn').click();page.wait_for_function('state.stream!==null && !state.starting');assert page.locator('#cameraResolution').is_enabled();assert 'Preview:' in page.locator('#cameraResolutionStatus').inner_text();page.locator('#stopCameraBtn').click()
 # Model a device that exposes 6 MP still photos while its live video may be smaller.
 page.evaluate('''()=>{window.NativeImageCapture=window.ImageCapture;window.ImageCapture=class{constructor(track){}getPhotoCapabilities(){return Promise.resolve({imageWidth:{min:640,max:4000},imageHeight:{min:480,max:3000}});}takePhoto(options){window.requestedPhoto=options;const c=makeCanvas(3000,2000);c.getContext('2d').fillStyle='#5c5097';c.getContext('2d').fillRect(0,0,3000,2000);return new Promise(resolve=>c.toBlob(resolve,'image/png'));}};}''')
 page.locator('#startCameraBtn').click();page.wait_for_function('state.stream!==null && !state.starting');page.locator('#cameraResolution').select_option('max');page.wait_for_function('!state.busy');page.locator('#captureBtn').click();page.wait_for_selector('#cropModal[open]');assert '3000 × 2000' in page.locator('#cropAdvice').inner_text();assert page.evaluate('state.source.width*state.source.height>4000000');page.locator('#confirmCropBtn').click();page.wait_for_function('state.pages.length===3 && !state.busy');assert page.evaluate('state.pages[2].width*state.pages[2].height>4000000');assert page.evaluate('window.requestedPhoto.imageWidth<=4000 && window.requestedPhoto.imageHeight<=3000')
 print('PASS capability-based high-resolution capture and processing retain more than 4 MP and report actual pixels')
 assert not errors,errors
 browser.close()
