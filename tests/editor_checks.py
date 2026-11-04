"""Saved-page edit transactions, retakes and one-step recovery using real browser canvas/PDF APIs."""
import os,json,subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright
from PIL import Image,ImageDraw,ImageFont
url=os.environ.get('SCANNER_URL','http://127.0.0.1:8765')
for n,color in [(1,'#b62635'),(2,'#164dcc'),(3,'#2b8850')]:
 im=Image.new('RGB',(900,1200),'#454545');d=ImageDraw.Draw(im);d.rectangle((70,70,830,1130),fill='white');d.rectangle((140,140,760,360),fill=color);font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',40);d.text((140,430),f'Page {n} invoice',fill='black',font=font);d.text((140,540),'Total: 450',fill='black',font=font);im.save(f'/tmp/scanner-edit-{n}.png')
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None),headless=True,args=['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'])
 context=browser.new_context(permissions=['camera'],accept_downloads=True,viewport={'width':390,'height':844});page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept())
 page.goto(url);page.wait_for_function('!state.restoring')
 def card(index=1):return page.locator('.page').nth(index)
 def open_editor(index=1):
  card(index).get_by_text('Edit / Retake',exact=True).click();page.wait_for_selector('#pageEditor[open]')
 def ready():page.wait_for_function('!document.getElementById("savePageEditBtn").disabled')
 def save():
  ready();page.locator('#savePageEditBtn').click();page.wait_for_function('!PageEditor.isOpen() && !state.busy');page.evaluate('state.persist')
 def reload():
  page.reload();page.wait_for_function('!state.restoring')
 page.locator('#enhancement').select_option('bw')
 for n in [1,2]:
  page.locator('#importFile').set_input_files(f'/tmp/scanner-edit-{n}.png');page.wait_for_selector('#cropModal[open]');page.locator('#confirmCropBtn').click();page.wait_for_function(f'state.pages.length==={n} && !state.busy')
 assert page.evaluate('state.pages.every(p=>p.sourceImage && p.editRecipe.mode==="bw")')
 # Review text on the selected page before changing its image.
 card().get_by_text('Text / identify',exact=True).click();page.locator('#recognizedText').fill('Reviewed invoice\nTotal: 450');page.locator('#identifiedFields').fill('Total: 450');page.locator('#saveTextBtn').click();page.evaluate('state.persist')
 original=page.evaluate('JSON.stringify(state.pages)');ids=page.evaluate('state.pages.map(p=>p.id)')
 open_editor();assert page.locator('#savePageEditBtn').is_disabled();page.locator('#editorRotateBtn').click();ready();assert page.evaluate('JSON.stringify(state.pages)')==original;page.locator('#cancelPageEditBtn').click();assert page.evaluate('JSON.stringify(state.pages)')==original
 print('PASS preview and cancellation do not mutate saved pages')
 # Changing Original recovers color from the retained pre-enhancement source.
 open_editor();page.locator('#editorEnhancement').select_option('original');ready()
 assert page.evaluate('''async()=>{const img=document.getElementById('editorPreview');await img.decode();const c=makeCanvas(img.naturalWidth,img.naturalHeight);c.getContext('2d').drawImage(img,0,0);const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;for(let i=0;i<d.length;i+=4)if(Math.abs(d[i]-d[i+2])>70)return true;return false;}''')
 save();assert page.evaluate('state.pages.map(p=>p.id)')==ids;assert page.evaluate('state.pages[1].ocrStale && state.pages[1].text.includes("450") && state.pages[1].words.length===0 && ScanCore.textRuns(state.pages[1]).length===0')
 assert page.evaluate('state.pages[0].image')==json.loads(original)[0]['image'];reload();assert page.evaluate('!!state.pages[1].undo && !!state.pages[1].sourceImage && state.pages[1].ocrStale')
 with page.expect_download() as dl:page.locator('#downloadPdfBtn').click()
 assert 'Reviewed invoice' not in subprocess.check_output(['pdftotext','-raw',dl.value.path(),'-'],text=True)
 card().get_by_text('Text / identify',exact=True).click();page.locator('#saveTextBtn').click();assert page.locator('#textModal').is_visible();assert 'confirmation' in page.locator('#ocrStatus').inner_text();page.locator('#confirmEditedReview').check();page.locator('#saveTextBtn').click();assert page.evaluate('!state.pages[1].ocrStale')
 with page.expect_download() as dl:page.locator('#downloadPdfBtn').click()
 assert 'Reviewed invoice' in subprocess.check_output(['pdftotext','-raw',dl.value.path(),'-'],text=True)
 card().get_by_text('Undo edit',exact=True).click();page.evaluate('state.persist');assert page.evaluate('JSON.stringify(state.pages)')==original
 print('PASS source-color recovery, stale-text review, PDF exclusion, position and persistent undo')
 # Crop on a temporary copy, including cancellation of rotated-source changes.
 open_editor();page.locator('#editorCropBtn').click();page.wait_for_selector('#cropModal[open]');page.locator('#rotateCropBtn').click();page.locator('#cancelCropBtn').click();assert page.locator('#savePageEditBtn').is_disabled()
 page.locator('#editorCropBtn').click();page.locator('#cornerSelect').select_option('0');page.locator('#cornerX').fill('20');page.locator('#confirmCropBtn').click();ready();save();assert page.evaluate('state.pages.length===2 && state.pages[1].editRecipe.corners[0].x>100');card().get_by_text('Undo edit',exact=True).click();page.evaluate('state.persist');assert page.evaluate('JSON.stringify(state.pages)')==original
 open_editor();page.locator('#editorCropBtn').click();page.locator('#rotateCropBtn').click();page.locator('#confirmCropBtn').click();ready();save();assert page.evaluate('state.pages[1].sourceWidth>state.pages[1].sourceHeight');card().get_by_text('Undo edit',exact=True).click();page.evaluate('state.persist');assert page.evaluate('JSON.stringify(state.pages)')==original
 print('PASS nested crop cancel and save, without appending a page')
 # Retake cancellation and camera failure both preserve the saved page.
 open_editor();page.locator('#editorRetakeBtn').click();page.wait_for_function('!document.getElementById("captureRetakeBtn").disabled');page.evaluate('window.retakeTrack=document.getElementById("editorVideo").srcObject.getVideoTracks()[0]');page.locator('#cancelRetakeBtn').click();assert page.evaluate('window.retakeTrack.readyState==="ended"');page.locator('#cancelPageEditBtn').click();assert page.evaluate('JSON.stringify(state.pages)')==original
 open_editor();page.evaluate('()=>{window.originalGUM=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=()=>Promise.reject(new DOMException("Denied by test","NotAllowedError"));}');page.locator('#editorRetakeBtn').click();page.wait_for_function('document.getElementById("editorStatus").textContent.includes("Could not start retake")');assert page.evaluate('JSON.stringify(state.pages)')==original;page.evaluate('()=>{navigator.mediaDevices.getUserMedia=window.originalGUM;}');page.locator('#cancelPageEditBtn').click()
 # A permission result arriving after cancel must be stopped rather than attached.
 open_editor();page.evaluate('()=>{navigator.mediaDevices.getUserMedia=()=>new Promise(resolve=>window.resolveRetake=resolve);}');page.locator('#editorRetakeBtn').click();page.locator('#cancelRetakeBtn').click();page.evaluate('window.lateRetakeStopped=false;window.resolveRetake({getTracks:()=>[{stop(){window.lateRetakeStopped=true;}}]})');page.wait_for_function('window.lateRetakeStopped');page.evaluate('()=>{navigator.mediaDevices.getUserMedia=window.originalGUM;}');page.locator('#cancelPageEditBtn').click()
 print('PASS cancelled, denied and late camera requests preserve pages and release streams')
 # A real simulated camera replaces exactly the selected page after Save.
 open_editor();page.locator('#editorRetakeBtn').click();page.wait_for_function('!document.getElementById("captureRetakeBtn").disabled');page.evaluate('window.retakeTrack=document.getElementById("editorVideo").srcObject.getVideoTracks()[0]');page.locator('#captureRetakeBtn').click();ready();assert page.evaluate('window.retakeTrack.readyState==="ended"');assert page.evaluate('JSON.stringify(state.pages)')==original;save();assert page.evaluate('state.pages.map(p=>p.id)')==ids;assert page.evaluate('state.pages[1].image')!=json.loads(original)[1]['image'];reload();card().get_by_text('Undo edit',exact=True).click();page.evaluate('state.persist');assert page.evaluate('JSON.stringify(state.pages)')==original
 print('PASS captured retake replaces in place after acceptance, with undo after reload')
 # Replacement from a file is temporary until Save and can recover from an invalid file.
 open_editor();page.locator('#editorReplaceFile').set_input_files({'name':'bad.png','mimeType':'image/png','buffer':b'not an image'});page.wait_for_function('document.getElementById("editorStatus").textContent.includes("Could not open replacement")');assert page.evaluate('JSON.stringify(state.pages)')==original
 page.locator('#editorReplaceFile').set_input_files('/tmp/scanner-edit-3.png');ready();save();assert page.evaluate('state.pages.map(p=>p.id)')==ids;card().get_by_text('Undo edit',exact=True).click();page.evaluate('state.persist');assert page.evaluate('JSON.stringify(state.pages)')==original
 # Existing drafts that predate source retention still open and save correctly.
 page.evaluate('delete state.pages[1].sourceImage;delete state.pages[1].editRecipe;persistDraft()');reload();open_editor();assert 'older page' in page.locator('#editorNotice').inner_text();assert page.locator('#editorEnhancement').input_value()=='original';page.locator('#editorRotateBtn').click();save();assert page.evaluate('!!state.pages[1].sourceImage && !!state.pages[1].undo');card().get_by_text('Undo edit',exact=True).click();assert page.evaluate('!state.pages[1].sourceImage')
 print('PASS replacement-file errors/recovery and legacy saved-page editing')
 # Failed draft storage must be explicit; the edited image remains exportable in memory.
 open_editor();page.locator('#editorRotateBtn').click();ready();page.evaluate('()=>{window.normalDBRequest=dbRequest;dbRequest=()=>Promise.reject(new DOMException("Storage full","QuotaExceededError"));}')
 save();assert 'Local recovery could not be saved' in page.locator('#status').inner_text();assert 'Storage full' in page.locator('#storageStatus').inner_text()
 page.evaluate('()=>{dbRequest=window.normalDBRequest;}');page.evaluate('persistDraft()');assert page.evaluate('state.pages.length===2')
 print('PASS local-save failure warns without discarding the in-memory edit')

 assert not errors,errors
 browser.close()
