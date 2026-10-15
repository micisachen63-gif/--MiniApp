import sys, json
from PIL import Image
for path in sys.argv[1:]:
    im=Image.open(path).convert('RGBA')
    print(path, im.size)
    for row in range(2):
        for col in range(3):
            rect=(col*512,row*512,(col+1)*512,(row+1)*512)
            crop=im.crop(rect)
            a=crop.getchannel('A').point(lambda v:255 if v>=16 else 0)
            print(row*3+col, a.getbbox())
