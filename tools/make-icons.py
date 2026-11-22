# Erzeugt die App-Icons (einmalig, Ergebnis liegt in public/icons).
from PIL import Image, ImageDraw, ImageFont
import os
BG=(18,15,11); GOLD=(212,166,63); DARK=(42,35,26)
def icon(size, maskable=False):
    s=size*4
    im=Image.new('RGB',(s,s),BG); d=ImageDraw.Draw(im)
    pad = int(s*0.16) if maskable else int(s*0.06)
    d.ellipse([pad,pad,s-pad,s-pad],fill=DARK,outline=GOLD,width=int(s*0.025))
    r=int(s*0.035); d.ellipse([pad+r*2,pad+r*2,s-pad-r*2,s-pad-r*2],outline=GOLD,width=max(2,int(s*0.008)))
    font=ImageFont.truetype(r'C:\Windows\Fonts\bahnschrift.ttf', int((s-2*pad)*0.42))
    try: font.set_variation_by_name('Bold Condensed')
    except Exception: pass
    small=ImageFont.truetype(r'C:\Windows\Fonts\bahnschrift.ttf', int((s-2*pad)*0.085))
    try: small.set_variation_by_name('SemiBold Condensed')
    except Exception: pass
    cx=s/2
    d.text((cx,s*0.47),'AK',font=font,fill=GOLD,anchor='mm')
    d.text((cx,s*0.67),'WILD',font=small,fill=(241,230,207),anchor='mm')
    d.line([(cx-s*0.17,s*0.67),(cx-s*0.09,s*0.67)],fill=GOLD,width=max(2,int(s*0.006)))
    d.line([(cx+s*0.09,s*0.67),(cx+s*0.17,s*0.67)],fill=GOLD,width=max(2,int(s*0.006)))
    return im.resize((size,size),Image.LANCZOS)
out=os.path.join(os.path.dirname(__file__), '..', 'public', 'icons')
icon(192).save(f'{out}/icon-192.png'); icon(512).save(f'{out}/icon-512.png')
icon(512,True).save(f'{out}/icon-maskable-512.png'); icon(180).save(f'{out}/apple-touch-icon.png')
icon(64).save(f'{out}/favicon-64.png')
print(sorted(os.listdir(out)))
