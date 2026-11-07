"""Ground-truth regression: compare old direct fast OCR with enhanced accurate OCR.
Requires SCANNER_ASSET_FIXTURES containing core.js, eng.traineddata and eng-accurate.traineddata.
No real user document is uploaded or included in the fixtures.
"""
import os,json,re,unicodedata,random
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont,ImageFilter
from playwright.sync_api import sync_playwright
url=os.environ.get('SCANNER_URL','http://127.0.0.1:8765');assets=Path(os.environ['SCANNER_ASSET_FIXTURES']);root=Path(__file__).resolve().parents[1];manifest=json.loads((root/'ocr-assets.json').read_text())
lines=['COMMUNITY DOCUMENT REVIEW','Invoice number: AB-2026-450','Reference: October payment record','Service charge: 120.50','Delivery charge: 25.00','Total amount due: 145.50','Payment date: 06 November 2026','Please review names and amounts.']
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf',18)
samples=[]
for kind in ['faint','uneven','mixed']:
 im=Image.new('RGB',(1050,1350),'white');d=ImageDraw.Draw(im)
 if kind=='uneven':
  for x in range(1050):v=int(175+65*x/1050);d.line((x,0,x,1349),fill=(v,v,v))
 elif kind=='mixed':d.rectangle((0,0,1049,650),fill=(75,65,130))
 for i,line in enumerate(lines):
  y=100+i*130
  fill=(192,192,192) if kind=='faint' else (110,110,110) if kind=='uneven' else (240,240,240) if y<650 else (45,45,45)
  d.text((70,y),line,font=font,fill=fill)
 if kind!='mixed':im=im.filter(ImageFilter.GaussianBlur(.35))
 path=Path('/tmp/scanner-ocr-'+kind+'.jpg');im.save(path,quality=82);samples.append((kind,path))
def normalize(text):return re.sub(r'\s+',' ',unicodedata.normalize('NFKC',text)).strip().lower()
def distance(a,b):
 prev=list(range(len(b)+1))
 for i,x in enumerate(a,1):
  row=[i]
  for j,y in enumerate(b,1):row.append(min(row[-1]+1,prev[j]+1,prev[j-1]+(x!=y)))
  prev=row
 return prev[-1]
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None),headless=True,args=['--no-sandbox']);context=browser.new_context();
 for spec,path,mime in [(manifest['core'],assets/'core.js','application/javascript'),(manifest['languages']['eng'],assets/'eng.traineddata','application/octet-stream'),(manifest['accurateLanguages']['eng'],assets/'eng-accurate.traineddata','application/octet-stream')]:context.route(spec['url'],lambda route,request,path=path,mime=mime:route.fulfill(path=str(path),content_type=mime,headers={'Access-Control-Allow-Origin':'*'}))
 page=context.new_page();page.goto(url);page.wait_for_function('!state.restoring');page.wait_for_function('navigator.serviceWorker.controller !== null');results=[];expected=normalize('\n'.join(lines))
 for index,(kind,path) in enumerate(samples):
  page.locator('#importFile').set_input_files(str(path));page.wait_for_selector('#cropModal[open]');page.locator('#resetCropBtn').click();page.locator('#deskew').uncheck();page.locator('#confirmCropBtn').click();page.wait_for_function(f'state.pages.length==={index+1} && !state.busy')
  baseline=page.evaluate('''async index=>{await loadScript(engines.ocr);const options=await OfflineOCR.prepare('eng',{quality:'fast'}),worker=await Tesseract.createWorker('eng',1,options);try{const {data}=await worker.recognize(state.pages[index].image);return data.text;}finally{await worker.terminate();}}''',index)
  page.locator('.page').nth(index).get_by_text('Text / identify',exact=True).click();page.locator('#ocrAccuracy').select_option('accurate');page.locator('#autoOrient').uncheck();page.locator('#recognizeBtn').click();page.wait_for_function('!state.ocrBusy',timeout=180000);text=page.locator('#recognizedText').input_value();assert text,page.locator('#ocrStatus').inner_text();old=distance(expected,normalize(baseline))/len(expected);new=distance(expected,normalize(text))/len(expected);results.append((old,new));print(f'{kind}: baseline character error {old:.3f}; enhanced {new:.3f}',flush=True)
  if new>old:print('BASELINE:',baseline,'ENHANCED:',text,flush=True)
  page.locator('#closeTextBtn').click()
 assert sum(n for _,n in results)<sum(o for o,_ in results)*.5,results
 assert all(n<.15 for _,n in results),results
 print('PASS real-engine aggregate character error improves on faint, uneven-light and mixed-polarity fixtures',flush=True)
 browser.close()
