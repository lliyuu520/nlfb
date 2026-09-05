# -*- coding: utf-8 -*-
"""把 ImageGen 输出的白底 PNG 抠成透明底 RGBA 并裁剪内容包围盒。
用法: python tools/knockout_white.py <in.png> <out.png> [阈值=225]
只抠与图像边缘连通的近白像素（BFS flood-fill），机身内部的白色高光不受影响。
"""
import sys
from collections import deque
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
thr = int(sys.argv[3]) if len(sys.argv) > 3 else 225

im = Image.open(src).convert("RGB")
w, h = im.size
px = im.load()

def is_bg(x, y):
    r, g, b = px[x, y]
    return min(r, g, b) >= thr  # 近白（背景实测最低 235，阈值 225 留裕量）

seen = [[False] * w for _ in range(h)]
q = deque()
for x in range(w):
    for y in (0, h - 1):
        if is_bg(x, y) and not seen[y][x]:
            seen[y][x] = True; q.append((x, y))
for y in range(h):
    for x in (0, w - 1):
        if is_bg(x, y) and not seen[y][x]:
            seen[y][x] = True; q.append((x, y))
while q:
    x, y = q.popleft()
    for nx, ny in ((x+1,y),(x-1,y),(x,y+1),(x,y-1)):
        if 0 <= nx < w and 0 <= ny < h and not seen[ny][nx] and is_bg(nx, ny):
            seen[ny][nx] = True; q.append((nx, ny))

out = Image.new("RGBA", (w, h))
op = out.load()
n_trans = 0
for y in range(h):
    for x in range(w):
        r, g, b = px[x, y]
        if seen[y][x]:
            op[x, y] = (r, g, b, 0); n_trans += 1
        else:
            op[x, y] = (r, g, b, 255)

bbox = out.getbbox()
out = out.crop(bbox)
out.save(dst)
print(f"{src} -> {dst}  {w}x{h} -> {out.size[0]}x{out.size[1]}  抠除 {n_trans/(w*h):.1%}")
