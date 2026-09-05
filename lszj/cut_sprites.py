# -*- coding: utf-8 -*-
"""素材图透明底处理：
1. 以四角中值色为背景参考色，取候选背景；
2. 仅移除与图像边界连通的背景区（保护机体内部的暗色细节）；
3. 移除小连通域（星点等杂质）；
4. alpha 轻度收缩+羽化去深色描边；
5. 按连通域切出单体素材（bbox+pad），另存整张透明底图。
用法: python cut_sprites.py <src_dir> <out_dir>
"""
import cv2
import numpy as np
import os, sys

def imread_unicode(path):
    return cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_UNCHANGED)

def imwrite_unicode(path, img):
    ext = os.path.splitext(path)[1] or ".png"
    ok, buf = cv2.imencode(ext, img)
    if ok:
        buf.tofile(path)
    return ok

def extract_alpha(bgr, bg_tol=60, min_island_frac=0.0005, edge_erode=1, feather=3,
                  bg_open=0, hole_fill=True):
    h, w = bgr.shape[:2]
    img = bgr[:, :, :3]
    corners = np.stack([img[0, 0], img[0, -1], img[-1, 0], img[-1, -1]])
    c0 = np.median(corners, axis=0).astype(int)
    dist = np.max(np.abs(img.astype(int) - c0), axis=2)
    cand = (dist < bg_tol).astype(np.uint8)
    if bg_open > 0:  # 开运算断开细缝渗漏桥
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (bg_open, bg_open))
        cand = cv2.morphologyEx(cand, cv2.MORPH_OPEN, k)
    # 仅移除与边界连通的背景
    num, labels = cv2.connectedComponents(cand)
    border_ids = set(np.unique(np.concatenate(
        [labels[0, :], labels[-1, :], labels[:, 0], labels[:, -1]])))
    border_ids.discard(0)
    bg = np.isin(labels, list(border_ids))
    alpha = np.where(bg, 0, 255).astype(np.uint8)
    if hole_fill:  # 补洞：仅填充不与边界连通的透明区（物体内部空腔）
        inv = (alpha == 0).astype(np.uint8)
        num3, labels3 = cv2.connectedComponents(inv)
        all_ids = set(range(num3)) - {0}
        border_labels = set(np.unique(np.concatenate(
            [labels3[0, :], labels3[-1, :], labels3[:, 0], labels3[:, -1]])))
        holes = np.isin(labels3, list(all_ids - border_labels))
        alpha[holes] = 255
    # 去小岛（星点等）
    num2, labels2, stats2, _ = cv2.connectedComponentsWithStats((alpha > 0).astype(np.uint8))
    min_area = min_island_frac * h * w
    for i in range(1, num2):
        if stats2[i, cv2.CC_STAT_AREA] < min_area:
            alpha[labels2 == i] = 0
    # 收缩边缘去深色描边，再羽化
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    for _ in range(edge_erode):
        alpha = cv2.erode(alpha, k)
    alpha = cv2.GaussianBlur(alpha, (feather * 2 + 1, feather * 2 + 1), 0)
    return alpha

def cut_items(rgba, min_item_frac=0.003, pad=12, close_k=15, split_ratio=0.15, wide_split=False):
    """按连通域切单体，返回 [(x0,y0,x1,y1)] 列表"""
    h, w = rgba.shape[:2]
    solid = (rgba[:, :, 3] > 40).astype(np.uint8)
    # 闭运算把同一物体的碎块连起来
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (close_k, close_k))
    merged = cv2.morphologyEx(solid, cv2.MORPH_CLOSE, k)
    num, labels, stats, _ = cv2.connectedComponentsWithStats(merged)
    boxes = []
    for i in range(1, num):
        if stats[i, cv2.CC_STAT_AREA] < min_item_frac * h * w:
            continue
        x, y, bw, bh = stats[i, cv2.CC_STAT_LEFT], stats[i, cv2.CC_STAT_TOP], \
            stats[i, cv2.CC_STAT_WIDTH], stats[i, cv2.CC_STAT_HEIGHT]
        x0, y0 = max(0, x - pad), max(0, y - pad)
        x1, y1 = min(w, x + bw + pad), min(h, y + bh + pad)
        boxes.append((x0, y0, x1, y1))
    # 从左到右、从上到下排序
    boxes.sort(key=lambda b: (b[1] // 100, b[0]))

    # 粘连二分：wide_split 时按宽度阈值(>0.35w)，否则按密度谷值
    def split_wide(box):
        x0, y0, x1, y1 = box
        if wide_split:
            if x1 - x0 < int(w * 0.35):
                return [box]
            col_density = solid[y0:y1, x0:x1].sum(axis=0).astype(float)
            lo, hi = int((x1 - x0) * 0.3), int((x1 - x0) * 0.7)
            mid = lo + int(np.argmin(col_density[lo:hi]))
            return [(x0, y0, x0 + mid, y1), (x0 + mid, y0, x1, y1)]
        col_density = solid[y0:y1, x0:x1].sum(axis=0).astype(float)
        if col_density.max() <= 0 or x1 - x0 < 60:
            return [box]
        lo, hi = int((x1 - x0) * 0.3), int((x1 - x0) * 0.7)
        seg = col_density[lo:hi]
        mid = lo + int(np.argmin(seg))
        if seg.min() > col_density.max() * split_ratio:  # 谷值不够深，是同一物体
            return [box]
        return [(x0, y0, x0 + mid, y1), (x0 + mid, y0, x1, y1)]

    out = []
    for b in boxes:
        out.extend(split_wide(b))
    return out

def process(src, out_dir, base_name, bg_tol=60, bg_open=0, close_k=15, split_ratio=0.15, wide_split=False):
    bgr = imread_unicode(src)
    if bgr is None:
        print(f"SKIP unreadable: {src}")
        return
    if bgr.ndim == 2:
        bgr = cv2.cvtColor(bgr, cv2.COLOR_GRAY2BGR)
    h, w = bgr.shape[:2]
    alpha = extract_alpha(bgr, bg_tol=bg_tol, bg_open=bg_open)
    rgba = np.dstack([bgr, alpha])

    # 整张透明底图
    imwrite_unicode(os.path.join(out_dir, f"{base_name}-透明底整图.png"), rgba)

    # 单体切图
    boxes = cut_items(rgba, close_k=close_k, split_ratio=split_ratio, wide_split=wide_split)
    for idx, (x0, y0, x1, y1) in enumerate(boxes, 1):
        crop = rgba[y0:y1, x0:x1]
        imwrite_unicode(os.path.join(out_dir, f"{base_name}-{idx:02d}.png"), crop)
    print(f"OK {base_name}: 整图+{len(boxes)} 个单体")

if __name__ == "__main__":
    src_dir, out_dir = sys.argv[1], sys.argv[2]
    os.makedirs(out_dir, exist_ok=True)
    jobs = [
        ("怒雷风暴-素材-玩家战机分级.png", "战机分级", dict(bg_tol=35, bg_open=5, close_k=9, wide_split=True)),
        ("怒雷风暴-素材-Buff道具v2.png", "Buff道具", dict()),
        ("怒雷风暴-素材-掉落物.png", "掉落物", dict()),
        ("怒雷风暴-素材-Boss设计.png", "Boss", dict(bg_tol=50, bg_open=7, close_k=31)),
        ("怒雷风暴-素材-杂兵敌机.png", "敌机", dict(bg_tol=40, bg_open=5, split_ratio=0)),  # 四象限互离，关闭谷值切分防鞍形机误切
    ]
    for fname, base, kw in jobs:
        p = os.path.join(src_dir, fname)
        if os.path.exists(p):
            process(p, out_dir, base, **kw)
        else:
            print(f"MISSING: {p}")
