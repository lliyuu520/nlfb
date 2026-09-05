# -*- coding: utf-8 -*-
"""敌机素材重制落盘管线：去水印 → 抠透明底 → 切单体 → 输出 drafts/enemy_out3 + 绿底目检拼贴图。
用法: python tools/rework_enemies.py <新素材png路径>
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

SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "..", "tmp_ships", "敌机新素材.png")
WM_DIR = os.path.join(ROOT, "drafts", "enemy_rework")
OUT_DIR = os.path.join(ROOT, "drafts", "enemy_out3")
CHECK = os.path.join(WM_DIR, "绿底目检.png")

os.makedirs(WM_DIR, exist_ok=True)
# 清空旧切图防残留干扰验证
if os.path.exists(OUT_DIR):
    shutil.rmtree(OUT_DIR)
os.makedirs(OUT_DIR, exist_ok=True)

# 1) 去右下角 AI 水印
wm_free = os.path.join(WM_DIR, "敌机新素材-去水印.png")
remove_watermark(SRC, wm_free)
bgr = imread_unicode(wm_free)
h, w = bgr.shape[:2]

# 2) 透明底（敌机固参：bg_tol 防暗装甲渗漏, bg_open=5）
BG_TOL = int(sys.argv[2]) if len(sys.argv) > 2 else 40
alpha = extract_alpha(bgr, bg_tol=BG_TOL, bg_open=5)
rgba = np.dstack([bgr, alpha])
imwrite_unicode(os.path.join(OUT_DIR, "敌机-透明底整图.png"), rgba)

# 3) 切单体（四象限互离，split_ratio=0 关谷值二分）
boxes = cut_items(rgba, split_ratio=0)
if len(boxes) != 4:
    print(f"WARN: 检出 {len(boxes)} 个连通域（应为 4）")
crops = []
for idx, (x0, y0, x1, y1) in enumerate(sorted(boxes, key=lambda b: (b[1], b[0])), 1):
    crop = rgba[y0:y1, x0:x1]
    imwrite_unicode(os.path.join(OUT_DIR, f"敌机-{idx:02d}.png"), crop)
    crops.append(crop)
    a = crop[:, :, 3]
    l = int((a[:, :a.shape[1]//2] > 40).sum()); r = int((a[:, a.shape[1]//2:] > 40).sum())
    print(f"OK 敌机-{idx:02d}: {crop.shape[1]}x{crop.shape[0]} 不对称度={abs(l-r)/(l+r):.1%}")

# 4) 绿底拼贴目检图（2x2，留边距）
pad = 40
cw = max(c.shape[1] for c in crops) + pad * 2
ch = max(c.shape[0] for c in crops) + pad * 2
canvas = np.full((ch * 2, cw * 2, 3), (40, 200, 40), np.uint8)  # BGR 绿
for i, c in enumerate(crops[:4]):
    y, x = (i // 2) * ch + (ch - c.shape[0]) // 2, (i % 2) * cw + (cw - c.shape[1]) // 2
    sub = canvas[y:y+c.shape[0], x:x+c.shape[1]]
    m = c[:, :, 3:4].astype(float) / 255.0
    canvas[y:y+c.shape[0], x:x+c.shape[1]] = (c[:, :, :3] * m + sub * (1 - m)).astype(np.uint8)
imwrite_unicode(CHECK, canvas)
print(f"目检图: {CHECK}")
print("DONE")
