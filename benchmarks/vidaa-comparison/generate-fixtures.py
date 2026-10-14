"""Deterministic synthetic artwork, no downloaded/private catalog assets. Pillow 12."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import random, math
root=Path(__file__).resolve().parent
font_path=root.parent.parent/'assets/fonts/Roboto-Regular.ttf'
for kind,count,size in [('poster',24,(240,300)),('backdrop',4,(1280,720))]:
    for i in range(count):
        rng=random.Random(5506111+i)
        base=Image.new('RGB',size);pixels=base.load()
        for y in range(size[1]):
            for x in range(size[0]):
                noise=rng.randrange(0,14)
                pixels[x,y]=((i*37+x//7+noise)%150+20,(i*19+y//5+noise)%150+20,(x//11+y//9+i*23+noise)%140+40)
        d=ImageDraw.Draw(base)
        for j in range(9):
            x=rng.randrange(size[0]);y=rng.randrange(size[1]);r=rng.randrange(15,90)
            d.ellipse((x-r,y-r,x+r,y+r),outline=(180+j*7,180,220),width=3)
        base.save(root/'fixtures'/f'{kind}-{i}.jpg',quality=83,progressive=False)
labels=['4K UHD','DOLBY','HEVC','FR / EN','TORBOX','HDR 10']
for i,label in enumerate(labels):
    im=Image.new('RGB',(128,44),[(126,32,90),(48,62,97),(36,88,92),(93,58,46),(49,87,49),(86,45,98)][i])
    d=ImageDraw.Draw(im);font=ImageFont.truetype(str(font_path),19)
    d.text((64,22),label,font=font,anchor='mm',fill='white')
    im.save(root/'fixtures'/f'badge-{i}.png')
