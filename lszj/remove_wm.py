# -*- coding: utf-8 -*-
"""去除 AI 生成图右下角半透明「AI生成」水印 v2。
限定右下角固定区域，区域内 Otsu 自适应阈值提取亮色文字掩码，
膨胀覆盖辉光后 TELEA inpaint；掩码异常则回退整块修复。
"""
import cv2
import numpy as np
import sys, os

def imread_unicode(path):
    data = np.fromfile(path, dtype=np.uint8)
    return cv2.imdecode(data, cv2.IMREAD_COLOR)

def imwrite_unicode(path, img):
    ext = os.path.splitext(path)[1] or ".png"
    ok, buf = cv2.imencode(ext, img)
    if ok:
        buf.tofile(path)
    return ok

def remove_watermark(src_path, dst_path):
    img = imread_unicode(src_path)
    if img is None:
        print(f"SKIP (unreadable): {src_path}")
        return False
    h, w = img.shape[:2]
    # 水印「AI生成」固定位于右下角：约 x>=0.77w, y>=0.91h
    x0, y0 = int(w * 0.75), int(h * 0.90)
    roi = img[y0:, x0:]
    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)

    # Otsu 自适应阈值提取文字
    _, mask = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    # 亮背景图上 Otsu 可能全选/全不选，限制掩码占比在合理范围
    frac = cv2.countNonZero(mask) / mask.size
    if frac > 0.6 or frac < 0.005:
        mask = np.full(mask.shape, 255, np.uint8)  # 回退：整块修复

    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    mask = cv2.dilate(mask, kernel, iterations=2)

    full_mask = np.zeros((h, w), np.uint8)
    full_mask[y0:, x0:] = mask
    result = cv2.inpaint(img, full_mask, 7, cv2.INPAINT_TELEA)
    imwrite_unicode(dst_path, result)
    print(f"OK: {dst_path} (roi-bright-frac={frac:.3f}, mask-px={cv2.countNonZero(full_mask)})")
    return True

if __name__ == "__main__":
    src_dir, dst_dir = sys.argv[1], sys.argv[2]
    os.makedirs(dst_dir, exist_ok=True)
    for name in sorted(os.listdir(src_dir)):
        if name.lower().endswith(".png"):
            remove_watermark(os.path.join(src_dir, name), os.path.join(dst_dir, name))
