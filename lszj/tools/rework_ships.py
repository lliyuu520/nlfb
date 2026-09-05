# -*- coding: utf-8 -*-
"""战机分级-03/04 重制素材落盘管线：去水印 → cut_sprites 抠透明底 → 切单体 → 替换 assets/sprites。
用法: python tools/rework_ships.py <两张新素材所在目录(含 战机分级-03-新素材.png / 战机分级-04-新素材.png)>
"""
import os, sys, shutil

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, ".."))
sys.path.insert(0, ROOT)
sys.path.insert(0, HERE)

import cv2
import numpy as np
from cut_sprites import imread_unicode, imwrite_unicode, extract_alpha, cut_items
from remove_wm import remove_watermark

SRC_DIR = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "..", "tmp_ships")
WM_DIR = os.path.join(ROOT, "..", "tmp_ships", "_wm_removed")
OUT_DIR = os.path.join(ROOT, "assets", "sprites")
JOBS = [("战机分级-03-新素材.png", "战机分级-03"), ("战机分级-04-新素材.png", "战机分级-04")]

os.makedirs(WM_DIR, exist_ok=True)
for fname, out_name in JOBS:
    src = os.path.join(SRC_DIR, fname)
    if not os.path.exists(src):
        print(f"MISSING: {src}"); sys.exit(1)
    # 1) 去右下角 AI 水印
    wm_free = os.path.join(WM_DIR, fname)
    remove_watermark(src, wm_free)
    bgr = imread_unicode(wm_free)
    h, w = bgr.shape[:2]
    # 2) 透明底（沿用玩家战机分级的参数：白底、防渗漏开运算）
    alpha = extract_alpha(bgr, bg_tol=35, bg_open=5)
    rgba = np.dstack([bgr, alpha])
    # 3) 切单体（只应有一个大连通域；出现多个则取最大者并告警）
    boxes = cut_items(rgba, close_k=9)
    if len(boxes) == 0:
        print(f"FAIL {out_name}: 未检出机体"); sys.exit(1)
    if len(boxes) > 1:
        boxes = [max(boxes, key=lambda b: (b[2]-b[0])*(b[3]-b[1]))]
        print(f"WARN {out_name}: 检出多个连通域，已取最大者")
    x0, y0, x1, y1 = boxes[0]
    crop = rgba[y0:y1, x0:x1]
    # 4) 覆盖本地素材（原素材在 git 管控下，可随时回退）
    dst = os.path.join(OUT_DIR, out_name + ".png")
    if os.path.exists(dst):
        shutil.copy2(dst, os.path.join(WM_DIR, out_name + ".bak.png"))  # 顺手留一份备份
    imwrite_unicode(dst, crop)
    # 对称性体检：左右半区非透明像素占比差
    a = crop[:, :, 3]
    l = int((a[:, :a.shape[1]//2] > 40).sum()); r = int((a[:, a.shape[1]//2:] > 40).sum())
    print(f"OK {out_name}: {crop.shape[1]}x{crop.shape[0]} alphaL={l} alphaR={r} 不对称度={abs(l-r)/(l+r):.1%}")
print("DONE")
