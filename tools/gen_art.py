import os,sys,json,base64,urllib.request
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0,"/home/isabelle/.openclaw/workspace/research/the-ping/table")
key=[l.split("=",1)[1].strip() for l in open(os.path.expanduser("~/.secrets/openrouter.env")) if l.startswith("OPENROUTER_API_KEY=")][0]
R="/home/isabelle/.openclaw/workspace/research/the-ping/"
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D3=R+"table/gptmock/d3.png"; OLD=R+"look/mock-A/frame-1440.png"
KEYBG=("The background MUST be one perfectly flat solid pure #00FF00 green, no gradient, no shadow on the background, no texture, no border. Do not use green anywhere in the object. ")
NOTEXT="ABSOLUTELY NO text, letters, numbers, logos, symbols or signage anywhere. "
ROOMP=("Create a full-frame 3:2 background plate of a dark, dingy 1970s basement poker room, in the exact painted/photographic mood, color grading, grain and level of detail of the FIRST reference image (the approved mockup). "
"Draw ONLY the room, as if the table and every UI element were removed: cinder-block and peeling paneled walls, a heavy hanging dome lamp with its warm cone of light, exposed pipes and a water heater on the left, a dusty shelf with cans and a radio at the back, an old wooden desk, stacked boxes, folding chairs at the edges, a stained frayed rug on the concrete floor, deep black shadow in all four corners so about 70% of the frame is in shadow. "
"IMPORTANT: leave the whole centre of the frame EMPTY - just the rug and floor lit by one soft pool of warm lamplight, with the lamp hanging above it - because a poker table will be placed there later. "
"NO poker table, NO chairs at a table, NO people, NO cards, NO buttons, NO panels, NO UI bars, NO neon sign, NO pin-up poster. A plain wall calendar with no readable numbers or nothing at all on that wall is fine. "+NOTEXT+
"The second reference image is only for mood/age of the room; follow the first for composition. ")
J={
 "room-a":("room",ROOMP+"Variation A: the lamp hangs top-centre, shelf and radio behind the table, water heater and pipes left, folding chair right.",[D3,OLD],False),
 "room-b":("room",ROOMP+"Variation B: same layout, slightly warmer and more cluttered, a boarded little window high on the back wall, heavier vignette.",[D3,OLD],False),
 "plate-rect":("plate","A single small horizontal seat name-plate for a poker table: a worn cream vinyl rounded-RECTANGLE tag (corner radius small, about 12% of height, NOT a pill and NOT an oval) with an aged brass edge rim, a faint stitched border line and four tiny brass rivets at the corners, flat blank cream centre. Aspect about 2.6:1 wide, straight-on front view, lit from top-left, subtle wear and grime, 1970s. Fill most of the frame. "+NOTEXT+KEYBG,[R+"table/kit/k2-seat-plate.png",D3],True),
 "panel-left":("panel","A tall vertical side-panel frame for a UI: a dark aged-walnut wooden frame with a thin worn aged-brass inlay line and small brass corner rivets, the inside is a flat dark near-black warm-brown leather field, plain and empty. Portrait aspect about 1:3, straight-on, lit from top-left, 1970s basement worn look. Fill the frame edge to edge. "+NOTEXT+KEYBG,[R+"table/kit/k2-panel.png",D3],True),
}
def b64(p): return base64.b64encode(open(p,"rb").read()).decode()
def gen(n):
    kind,prompt,refs,keyed=J[n]
    raw=f"{ROOT}/art-src/raw/{n}.png"
    if os.path.exists(raw): return n,"cached"
    asp={"room":"3:2","plate":"3:2","panel":"2:3"}[kind]
    body={"model":"openai/gpt-5.4-image-2","modalities":["image","text"],"image_config":{"aspect_ratio":asp},"messages":[{"role":"user","content":[{"type":"image_url","image_url":{"url":"data:image/png;base64,"+b64(p)}} for p in refs]+[{"type":"text","text":prompt}]}]}
    req=urllib.request.Request("https://openrouter.ai/api/v1/chat/completions",data=json.dumps(body).encode(),headers={"Authorization":"Bearer "+key,"Content-Type":"application/json"})
    try:
        d=json.load(urllib.request.urlopen(req,timeout=900)); im=d["choices"][0]["message"]["images"][0]["image_url"]["url"]
        open(raw,"wb").write(base64.b64decode(im.split(",",1)[1])); open(f"{ROOT}/gencount.txt","a").write(n+"\n"); return n,"ok"
    except Exception as e: return n,"ERR "+str(e)[:300]
if __name__=="__main__":
    names=sys.argv[1:] or list(J)
    with ThreadPoolExecutor(3) as ex:
        for r in ex.map(gen,names): print(r,flush=True)
