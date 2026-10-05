import os,sys,json,base64,urllib.request
sys.path.insert(0,"/home/isabelle/.openclaw/workspace/research/the-ping/table")
from gen import key_out,key
import numpy as np
from PIL import Image
from concurrent.futures import ThreadPoolExecutor
R="/home/isabelle/.openclaw/workspace/research/the-ping/table/"
A=[R+"gptmock/d3.png",R+"tblb-3-vp.png"]
b64=lambda p:base64.b64encode(open(p,"rb").read()).decode()
mime=lambda p:"image/png" if p.endswith("png") else "image/jpeg"
P=("Reference 1 is a game screenshot: use ONLY the ANGLE and perspective of its poker table (camera slightly above the near rail, near rail wider and closer, far rail shorter and higher, felt an angled ellipse). Reference 2 is the approved top-down table: use its materials and VP logo exactly: muted denim-slate blue matte felt, warm teak wood rail, cream stitched vinyl padded rim, brass studs, gold-foil 'VP' monogram logo (letters V and P, spelled exactly VP) centered on the felt, drawn in the same perspective. "
"Generate ONLY the empty poker table, an oval/racetrack table, floating alone, filling the full width of a 3:2 canvas, with a short visible wooden table edge/apron on the near side. Matte illustrated 1970s gouache style, no glare, no spotlight, no sheen, no glow, even soft lighting. The felt must be completely EMPTY: no cards, no chips, no text, no numbers, no dealer button, no people, no hands, no objects, only the VP logo. No floor, no room, no shadow on the background. "
"The background MUST be one perfectly flat solid pure #00FF00 green, no gradient, no texture. Do not use green anywhere in the table. ")
V={"A":"Camera tilt about 25 degrees from top-down: only a mild angle, the felt ellipse is fairly round and tall.",
"B":"Camera tilt about 40 degrees from top-down: medium angle, like the screenshot's table.",
"C":"Camera tilt about 55 degrees from top-down: strong low angle, the felt ellipse is flat and wide, near rail much bigger than far rail, the thick table side edge clearly visible."}
def g(n):
    body={"model":"openai/gpt-5.4-image-2","modalities":["image","text"],"image_config":{"aspect_ratio":"3:2"},"messages":[{"role":"user","content":[{"type":"image_url","image_url":{"url":f"data:{mime(p)};base64,"+b64(p)}} for p in A]+[{"type":"text","text":P+V[n]}]}]}
    req=urllib.request.Request("https://openrouter.ai/api/v1/chat/completions",data=json.dumps(body).encode(),headers={"Authorization":"Bearer "+key,"Content-Type":"application/json"})
    try:
        d=json.load(urllib.request.urlopen(req,timeout=900)); im=d["choices"][0]["message"]["images"][0]["image_url"]["url"]
        open(f"raw-{n}.png","wb").write(base64.b64decode(im.split(",",1)[1])); open("../../gencount.txt","a").write("persp-"+n+"\n")
        key_out(f"raw-{n}.png",f"keyed-{n}.png")
        im=Image.open(f"keyed-{n}.png"); bb=im.split()[3].point(lambda x:255 if x>20 else 0).getbbox(); im=im.crop(bb); im.save(f"table-{n}.png")
        bg=Image.new("RGB",(1200,int(1200*im.height/im.width)+80),(0x1a,0x14,0x10)); t=im.resize((1120,int(1120*im.height/im.width)))
        bg.paste(t,(40,40),t); bg.save(f"table-{n}-preview.jpg",quality=88); return n,"ok",im.size
    except Exception as e: return n,"ERR "+str(e)[:300]
if __name__=="__main__":
    ns=sys.argv[1:] or list(V)
    with ThreadPoolExecutor(2) as ex:
        for r in ex.map(g,ns): print(r,flush=True)
