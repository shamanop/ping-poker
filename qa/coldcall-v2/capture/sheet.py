import sys,glob
from PIL import Image, ImageDraw
d=sys.argv[1]; out=sys.argv[2]; a=int(sys.argv[3]) if len(sys.argv)>3 else 0; n=int(sys.argv[4]) if len(sys.argv)>4 else 8
fs=sorted(glob.glob(d+'/f*.jpg'))[a:a+n]
cols=4; w,h=270,480
rows=(len(fs)+cols-1)//cols
S=Image.new('RGB',(cols*w,rows*h),(20,20,20)); dr=ImageDraw.Draw(S)
for i,f in enumerate(fs):
    im=Image.open(f).resize((w,h)); S.paste(im,((i%cols)*w,(i//cols)*h)); dr.text(((i%cols)*w+4,(i//cols)*h+4),f.split('/')[-1],fill=(255,255,0))
S.save(out,quality=80)
