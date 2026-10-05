import os,sys,json,base64,urllib.request
from concurrent.futures import ThreadPoolExecutor
key=[l.split("=",1)[1].strip() for l in open(os.path.expanduser("~/.secrets/openrouter.env")) if l.startswith("OPENROUTER_API_KEY=")][0]
W="/home/isabelle/.openclaw/workspace/"
REF=W+"research/the-ping/table/gptmock/d3.png"
OUT=W+"the-ping-build/art-src/bg/"
P=("Create a 3:2 landscape illustrated BACKGROUND ROOM plate for a poker game. Reference image attached: the approved dark 1970s cinder-block basement with a single dusty hanging lamp and folding chairs. Reuse its mood and palette: warm brass light on dark brown/black, painterly matte gouache sticker-illustration style, no neon, no photorealism, no glow haze. A slanted poker table will later cover the CENTER ~60% of the frame and the bottom ~35%, so keep the center and lower-middle EMPTY, dark and quiet (just dim cinder-block wall, shadowy concrete floor); put all props around the EDGES and the upper wall / floor corners. NO table, NO people in the picture. "
"The room is a darkly funny political-campaign graveyard. Three core gags must all appear: (1) an overflowing trash bin stuffed with crumpled blank campaign flyers; (2) a pile of campaign yard signs (blank wire-stake signs, no text) burning, with small stylized flames, which is the only bright warm light besides the lamp; (3) a cluttered desk with a computer (CRT or laptop) whose screen shows text messages going out as abstract speech-bubble shapes streaming off it, manned by a small classic grey alien with big black eyes wearing a headset, hunched at the keyboard, with energy-drink cans and a pizza box on the desk. "
"STRICT: absolutely no readable text, letters, numbers or logos anywhere; signs and flyers are blank; screen shows only abstract bubble shapes. ")
V={"V1":"Arrangement: alien desk on the LEFT edge, the burning yard-sign pile on the RIGHT, the flyer-stuffed trash bin at the far right edge.",
"V2":"Arrangement: alien desk on the RIGHT edge, a steel oil drum fire with yard signs sticking out burning on the LEFT, and crumpled blank flyers spilling across the floor in the bottom-left corner.",
"V3":"Arrangement: the alien sits on a shelf/workbench in the upper-wall corner (upper left) with several extra monitors showing bubble shapes, the yard-sign fire on the RIGHT, the flyer trash bin low in a corner.",
"V4":"Arrangement: the MOST ABSURD version: TWO small grey aliens with headsets at two desks at opposite edges, stacked bins and overflowing barrels of crumpled flyers in the corners, and one stray blank sign-shaped silhouette (plain rectangle on a stake, NO text at all) burning on the floor at an edge."}
def g(n):
    p=REF; body={"model":"openai/gpt-5.4-image-2","modalities":["image","text"],"image_config":{"aspect_ratio":"3:2"},"messages":[{"role":"user","content":[{"type":"image_url","image_url":{"url":"data:image/png;base64,"+base64.b64encode(open(p,"rb").read()).decode()}},{"type":"text","text":P+V[n]}]}]}
    req=urllib.request.Request("https://openrouter.ai/api/v1/chat/completions",data=json.dumps(body).encode(),headers={"Authorization":"Bearer "+key,"Content-Type":"application/json"})
    try:
        d=json.load(urllib.request.urlopen(req,timeout=900)); im=d["choices"][0]["message"]["images"][0]["image_url"]["url"]
        open(OUT+f"bg-{n}.png","wb").write(base64.b64decode(im.split(",",1)[1]))
        open(W+"the-ping-build/gencount.txt","a").write("bg-"+n+"\n")
        os.system(f"ffmpeg -loglevel error -y -i {OUT}bg-{n}.png -vf scale=1200:-1 -q:v 4 {OUT}bg-{n}-small.jpg")
        return n,"ok"
    except Exception as e: return n,"ERR "+str(e)[:200]
names=sys.argv[1:] or list(V)
with ThreadPoolExecutor(4) as ex:
    for r in ex.map(g,names): print(r,flush=True)
