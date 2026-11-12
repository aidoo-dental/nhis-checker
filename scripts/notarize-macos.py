#!/usr/bin/env python3
"""Sign an existing NHIS Checker DMG, notarize app and DMG, and verify both tickets."""
import argparse, hashlib, json, os, plistlib, subprocess, time
from pathlib import Path
p=argparse.ArgumentParser()
p.add_argument('input',type=Path);p.add_argument('stage',type=Path)
p.add_argument('--identity',required=True);p.add_argument('--profile',required=True)
a=p.parse_args();a.input=a.input.resolve();a.stage=a.stage.resolve();a.stage.mkdir(parents=True,exist_ok=True)
report={'input':a.input.name,'input_sha256':hashlib.sha256(a.input.read_bytes()).hexdigest()}
def save():
 (a.stage/'report.json').write_text(json.dumps(report,indent=2)+'\n')
def run(*args):
 r=subprocess.run([str(x) for x in args],capture_output=True,text=True,timeout=180)
 if r.returncode: raise RuntimeError(r.stderr or r.stdout or 'Command failed')
 return r.stdout

def notarize(path, key):
 checkpoint=a.stage/(key+'-submission.json')
 if checkpoint.exists(): submitted=json.loads(checkpoint.read_text())
 else:
  submitted=json.loads(run('xcrun','notarytool','submit',path,'--keychain-profile',a.profile,'--output-format','json'))
  checkpoint.write_text(json.dumps(submitted,indent=2)+'\n')
 report[key+'_submission']=submitted['id'];report['stage']='Waiting for Apple: '+key;save()
 print(report['stage'],submitted['id'],flush=True)
 for attempt in range(120):
  status=json.loads(run('xcrun','notarytool','info',submitted['id'],'--keychain-profile',a.profile,'--output-format','json'))
  if status['status']!='In Progress': break
  time.sleep(15)
 if status['status']!='Accepted':
  run('xcrun','notarytool','log',submitted['id'],'--keychain-profile',a.profile,a.stage/(key+'-notary-log.json'))
  raise RuntimeError('Notarization status: '+status['status'])
 run('xcrun','stapler','staple',path)
 run('xcrun','stapler','validate',path)
 report[key+'_notarization']='Accepted';save()
try:
 app=a.stage/'payload/NHIS Checker.app'
 if not (a.stage/'app-submission.json').exists():
  if app.exists(): raise RuntimeError('Staging app already exists: inspect before resuming')
  mount=a.stage/'mount';mount.mkdir()
  run('hdiutil','attach','-readonly','-nobrowse','-mountpoint',mount,a.input)
  try: run('ditto',mount/'NHIS Checker.app',app)
  finally: run('hdiutil','detach',mount)
  run('xattr','-cr',app)
  info=plistlib.loads((app/'Contents/Info.plist').read_bytes())
  report['version']=info['CFBundleShortVersionString'];save()
  # The external PKCS#11 driver is signed by its own vendor, not AIDOO.
  ent=a.stage/'entitlements.plist'
  ent.write_bytes(plistlib.dumps({'com.apple.security.cs.disable-library-validation':True}))
  main=app/'Contents/MacOS/NHIS Checker'
  for binary in sorted(app.rglob('*')):
   if binary.is_symlink() or not binary.is_file() or binary==main: continue
   with binary.open('rb') as f: magic=f.read(4)
   if magic in (b'\xcf\xfa\xed\xfe',b'\xce\xfa\xed\xfe',b'\xfe\xed\xfa\xcf',b'\xca\xfe\xba\xbe',b'\xbe\xba\xfe\xca'):
    run('codesign','--force','--timestamp','--options','runtime','--sign',a.identity,binary)
  for framework in sorted(app.rglob('*.framework'),key=lambda x:len(x.parts),reverse=True):
   run('codesign','--force','--timestamp','--options','runtime','--sign',a.identity,framework)
  run('codesign','--force','--timestamp','--options','runtime','--entitlements',ent,'--sign',a.identity,app)
  run('codesign','--verify','--deep','--strict',app)
  run('ditto','-c','-k','--keepParent',app,a.stage/'app.zip')
 # The archive is submitted, while the ticket is attached to the .app.
 if not (a.stage/'app-submission.json').exists():
  submitted=json.loads(run('xcrun','notarytool','submit',a.stage/'app.zip','--keychain-profile',a.profile,'--output-format','json'))
  (a.stage/'app-submission.json').write_text(json.dumps(submitted,indent=2)+'\n')
 notarize(app,'app')
 run('spctl','--assess','--type','execute','--verbose=2',app)
 dmg=a.stage/a.input.name
 if not dmg.exists():
  (a.stage/'payload/Applications').symlink_to('/Applications')
  run('hdiutil','create','-volname','NHIS Checker','-srcfolder',a.stage/'payload','-format','UDZO',dmg)
  run('codesign','--force','--timestamp','--sign',a.identity,dmg)
 notarize(dmg,'dmg')
 run('codesign','--verify','--strict',dmg)
 run('hdiutil','verify',dmg)
 run('spctl','--assess','--type','open','--context','context:primary-signature','--verbose=2',dmg)
 mount=a.stage/'verify-mount';mount.mkdir(exist_ok=True)
 run('hdiutil','attach','-readonly','-nobrowse','-mountpoint',mount,dmg)
 try:
  packed=mount/'NHIS Checker.app'
  run('codesign','--verify','--deep','--strict',packed)
  run('xcrun','stapler','validate',packed)
  run('spctl','--assess','--type','execute','--verbose=2',packed)
 finally: run('hdiutil','detach',mount)
 report.update(stage='Complete',output=str(dmg),sha256=hashlib.sha256(dmg.read_bytes()).hexdigest(),gatekeeper='accepted',app_ticket=True,dmg_ticket=True)
 save();print(json.dumps(report),flush=True)
except Exception as e:
 report.update(stage='Failed',error=str(e));save();raise
