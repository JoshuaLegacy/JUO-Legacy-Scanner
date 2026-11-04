"""Fetch the pinned English OCR test assets through the configured system proxy."""
import hashlib, json, sys, time, urllib.request
from pathlib import Path
root=Path(__file__).resolve().parents[1]
manifest=json.loads((root/'ocr-assets.json').read_text())
target=Path(sys.argv[1] if len(sys.argv)>1 else '/tmp/scanner-ocr-fixtures');target.mkdir(parents=True,exist_ok=True)
for filename,spec in [('core.js',manifest['core']),('eng.traineddata',manifest['languages']['eng'])]:
 path=target/filename
 if path.exists() and hashlib.sha256(path.read_bytes()).hexdigest()==spec['sha256']:continue
 for attempt in range(3):
  try:
   with urllib.request.urlopen(spec['url'],timeout=90) as response:data=response.read()
   assert len(data)==spec['bytes'] and hashlib.sha256(data).hexdigest()==spec['sha256'],'OCR asset integrity mismatch'
   path.write_bytes(data);break
  except Exception:
   if attempt==2:raise
   time.sleep(2)
 print('Verified',filename)
