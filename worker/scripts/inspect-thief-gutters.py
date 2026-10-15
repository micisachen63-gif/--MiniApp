import sys, glob
from PIL import Image
import numpy as np
def summary(points):
    if not points: return []
    runs=[]
    for p in points:
        if runs and p==runs[-1][1]+1:runs[-1][1]=p
        else:runs.append([p,p])
    return runs
for file in [p for pattern in sys.argv[1:] for p in glob.glob(pattern)]:
    a=np.array(Image.open(file).convert('RGBA'))[:,:,3]
    print(file, a.shape)
    print('horizontal gutters',[(r,b,summary([x for x in range(b-80,b+121) if not(a[r*512:(r+1)*512,x]>=16).any()])) for r in [0,1] for b in [512,1024]])
    print('vertical gutters',[(c,summary([y for y in range(490,561) if not(a[y,c*512:(c+1)*512]>=16).any()])) for c in [0,1,2]])
