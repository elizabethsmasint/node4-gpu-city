#!/usr/bin/env python3
"""Verify GPU City in Firefox; pass --url to check a deployed copy."""
import argparse,base64,json,subprocess,tempfile,time,urllib.request,urllib.error
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
if (ROOT/'web').is_dir():ROOT=ROOT/'web'
OUT=Path('/tmp/gpu-city-ui-qa');OUT.mkdir(exist_ok=True)
def request(url,body=None,method=None):
 req=urllib.request.Request(url,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json'},method=method)
 try:
  with urllib.request.urlopen(req,timeout=60) as f:return json.load(f)
 except urllib.error.HTTPError as e:raise RuntimeError(e.read().decode())
def wait(fn,seconds=40):
 end=time.monotonic()+seconds;err=None
 while time.monotonic()<end:
  try:
   result=fn()
   if result:return result
  except Exception as e:err=e
  time.sleep(.2)
 raise RuntimeError(f'Timed out: {err}')
parser=argparse.ArgumentParser();parser.add_argument('--url');args=parser.parse_args()
checks=[];procs=[];session=None;base='http://127.0.0.1:4449'
with tempfile.TemporaryDirectory(prefix='browser-qa-profile-',dir=ROOT) as profile,(OUT/'browser.log').open('w') as log:
 try:
  if not args.url:procs.append(subprocess.Popen(['python3','-m','http.server','8766','--bind','127.0.0.1','--directory',str(ROOT)],stdout=log,stderr=log))
  procs.append(subprocess.Popen(['/snap/firefox/current/usr/lib/firefox/geckodriver','--port','4449'],stdout=log,stderr=log))
  wait(lambda:request(base+'/status')['value']['ready'])
  caps={'capabilities':{'alwaysMatch':{'browserName':'firefox','moz:firefoxOptions':{'binary':'/usr/bin/firefox','args':['-headless','-profile',profile]}}}}
  session=request(base+'/session',caps)['value']['sessionId'];endpoint=base+'/session/'+session
  def cmd(path,body=None,method=None):return request(endpoint+path,body,method)['value']
  def js(script):return cmd('/execute/sync',{'script':script,'args':[]})
  def check(script,label):
   if not js('return '+script):
    print(json.dumps(js('return {width:innerWidth,scroll:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll("body *")].map(e=>({tag:e.tagName,id:e.id,cls:e.className,left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right,width:e.getBoundingClientRect().width})).filter(r=>r.right>innerWidth+1||r.left<0).slice(0,25)}')),flush=True)
    shot('failure.png')
    raise AssertionError(label)
   checks.append(label)
  def click(id):js(f'document.getElementById({json.dumps(id)}).click()')
  def shot(name):
   (OUT/name).write_bytes(base64.b64decode(cmd('/screenshot')))
  cmd('/window/rect',{'width':1600,'height':1200});cmd('/url',{'url':args.url or 'http://127.0.0.1:8766/'})
  wait(lambda:js('return !!window.gpuCity?.state.data && document.querySelectorAll(".kernel-lane").length===3'))
  js('window.__errors=[];window.addEventListener("error",e=>__errors.push(e.message));window.addEventListener("unhandledrejection",e=>__errors.push(String(e.reason)))')
  check('gpuCity.state.data.events.length===116186','Original capture loads all 116,186 launches')
  check('gpuCity.state.selected===7 && gpuCity.state.followCursor','Starts on a known transfer kernel with stream neighbors')
  check('document.querySelector(".memory-board").getBoundingClientRect().width>900','Memory routes occupy the main desktop workspace')
  check('document.querySelectorAll(".memory-vessel").length===9','All three kernels show DRAM input, GPU, and DRAM output')
  check('document.querySelectorAll(".stream-link").length===2','Stream dependencies connect the kernel rows')
  check('document.querySelectorAll(".kernel-lane[data-animating=true]").length===1','Only the selected kernel previews transfers')
  check('document.documentElement.scrollWidth<=innerWidth','Desktop has no horizontal overflow')
  js('gpuCity.operation.running=false;gpuCity.operation.time=4500')
  wait(lambda:js('return document.getElementById("transfer-phase").textContent==="GPU → DRAM · write"'))
  check('document.getElementById("transfer-gpu-percent").textContent==="100%" && document.getElementById("transfer-dram-percent").textContent!=="0%"','Input tile is loaded while output DRAM fills')
  check('getComputedStyle(document.getElementById("transfer-dram-fill")).transform!=="none"','DRAM fill is painted inside the main memory box')
  shot('desktop.png')
  js('window.__fill=document.getElementById("transfer-dram-fill").style.transform')
  time.sleep(.3);check('document.getElementById("transfer-dram-fill").style.transform===__fill','Pausing freezes the displayed transfer')
  click('operation-play');check('gpuCity.operation.running','Main transfer button resumes the animation')
  js('window.__clock=gpuCity.state.time;window.__initial=gpuCity.state.selected;document.querySelector(".kernel-lane:not(.is-selected) [data-event]").click()')
  check('gpuCity.state.selected===__initial-1 && gpuCity.state.time===__clock && !gpuCity.state.followCursor','Selecting a neighboring kernel pins its preview without moving the clock')
  js('gpuCity.selectEvent(0,{seek:false})')
  check('document.querySelector(".kernel-lane.is-selected").textContent.includes("Transfer pattern not available")','Unknown kernels do not invent transfer progress')
  click('board-next');check('gpuCity.state.selected===1 && gpuCity.state.time===gpuCity.state.data.events[1][0]+gpuCity.state.data.events[1][1]/2','Next stream kernel seeks to that recorded launch')
  click('tour');wait(lambda:js('return gpuCity.operation.group.category==="add"'))
  check('gpuCity.operation.group.grid[0]===32768','Large add investigation remains usable')
  js('const d=gpuCity.state.data;const i=d.events.findIndex((e,i)=>i>0&&e[5]!=null&&e[6]!=null&&e[5]+e[6]<d.events[i-1][0]+d.events[i-1][1]&&e[5]+e[6]>=d.events[i-1][0]);gpuCity.state.time=d.events[i][5]+d.events[i][6];gpuCity.selectEvent(i,{seek:false});')
  wait(lambda:js('return document.querySelector(".stream-link[data-state=waiting]")'))
  check('document.getElementById("dependency-chain").textContent.includes("Must finish first")','Actual queued work identifies its prerequisite in the main view')
  shot('waiting.png')
  click('follow-cursor');check('gpuCity.state.followCursor','Follow playhead can be restored')
  click('board-play');time.sleep(.3);click('board-play')
  check('gpuCity.state.selected>=0 && !gpuCity.state.playing','Measured playback runs and pauses')
  js('const g=gpuCity.state.data.groups.find(g=>g.category==="fill");gpuCity.selectEvent(g.first_event)')
  check('document.querySelector(".kernel-lane.is-selected .source").textContent.includes("SCALAR")','Fill kernels show scalar preparation without an input read')
  cmd('/window/rect',{'width':1280,'height':900});time.sleep(.3)
  check('document.documentElement.scrollWidth<=innerWidth','Laptop has no horizontal overflow')
  shot('laptop.png')
  cmd('/window/rect',{'width':390,'height':844});time.sleep(.3)
  check('document.documentElement.scrollWidth<=innerWidth','Mobile has no horizontal overflow')
  check('[...document.querySelectorAll(".memory-vessel")].every(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.left>=0&&r.right<=innerWidth})','All nine memory boxes remain readable within mobile width')
  js('document.querySelector(".data-workbench").scrollIntoView()');shot('mobile.png')
  js('document.querySelector("[data-view=compare]").click()');wait(lambda:js('return gpuCity.state.compareData.length===3'))
  check('document.getElementById("comparison-table").textContent.includes("109,090")','Comparison retains measured Stage A counts')
  js('document.querySelector("[data-view=evidence]").click()')
  check('!document.getElementById("evidence-view").hidden','Evidence view remains accessible')
  check('__errors.length===0','No browser errors across selection, playback, comparison, or evidence')
  # A fixed-width frame avoids Firefox's minimum desktop window width.
  cmd('/window/rect',{'width':1000,'height':1100})
  js('const f=document.createElement("iframe");f.id="qa-phone";f.src=location.href;f.style="position:fixed;top:0;left:0;width:390px;height:844px;border:0;z-index:9999;background:white";document.body.append(f)')
  frame=cmd('/element',{'using':'css selector','value':'#qa-phone'})
  cmd('/frame',{'id':frame})
  wait(lambda:js('return !!window.gpuCity?.state.data && document.querySelectorAll(".kernel-lane").length===3'))
  check('innerWidth===390 && document.documentElement.scrollWidth<=390','True 390px mobile viewport has no horizontal overflow')
  check('[...document.querySelectorAll(".memory-vessel")].every(e=>{const r=e.getBoundingClientRect();return r.width>40&&r.left>=0&&r.right<=390})','Every memory box fits a 390px phone')
  js('document.querySelector(".data-workbench").scrollIntoView();document.querySelector(".kernel-lane:not(.is-selected) .memory-vessel").click()')
  check('gpuCity.state.selected===6','Clicking a memory box selects its kernel')
  cmd('/frame',{'id':None})
  (OUT/'phone-390.png').write_bytes(base64.b64decode(cmd('/element/'+frame['element-6066-11e4-a52e-4f735466cecf']+'/screenshot')))

  (OUT/'results.json').write_text(json.dumps({'passed':len(checks),'checks':checks},indent=2))
  print(json.dumps({'passed':len(checks),'checks':checks},indent=2))
 finally:
  if session:
   try:request(base+'/session/'+session,method='DELETE')
   except Exception:pass
  for proc in reversed(procs):
   proc.terminate()
   try:proc.wait(timeout=5)
   except subprocess.TimeoutExpired:proc.kill();proc.wait()
