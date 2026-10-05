import subprocess,os,time
from playwright.sync_api import sync_playwright
env=dict(os.environ,PORT="3912",BANK_FILE="/tmp/pp-faces-bank.json")
open("/tmp/pp-faces-bank.json","w").write("{}")
srv=subprocess.Popen(["node","server.js"],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
time.sleep(1.5)
try:
    with sync_playwright() as p:
        b=p.chromium.launch(); pg=b.new_page(viewport={"width":1440,"height":900})
        errs=[]; pg.on("pageerror",lambda e:errs.append(str(e)))
        pg.goto("http://localhost:3912/"); pg.wait_for_timeout(800)
        pg.evaluate("""()=>{
          document.body.innerHTML='<div id=t style="position:fixed;inset:0;background:#173a28;display:grid;grid-template-columns:repeat(4,1fr);gap:24px;padding:24px;align-content:start"></div>';
          const t=document.getElementById('t'); let h='';
          for(const r of ['J','Q','K']) for(const s of ['♠','♥','♦','♣']) h+='<div style="position:relative;height:250px;display:flex;justify-content:center;align-items:center">'+faceCardHtml({rank:r,suit:s},'lg')+'</div>';
          t.innerHTML=h;}""")
        pg.wait_for_timeout(600); pg.screenshot(path="qa/faces/faces-1440.png"); print("errors",errs); b.close()
finally: srv.terminate()
