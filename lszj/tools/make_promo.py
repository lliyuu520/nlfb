# -*- coding: utf-8 -*-
"""《怒雷风暴》微信小游戏竖版宣传图合成器
3 张 720x1280：①弹幕玩法 ②Boss战 ③武器升级/道具
背景 = AI 霓虹太空图（已去水印），前景 = 项目真实素材 + 程序化弹幕（复刻游戏绘制逻辑）
"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # lszj/
SPRITES = os.path.join(ROOT, "assets", "sprites")
LOGO = os.path.join(ROOT, "assets", "logo", "怒雷风暴-logo-512x512.png")
WORK = os.path.join(ROOT, "promo_work")

W, H = 720, 1280
S = 1.5  # 游戏逻辑像素(W=480) → 宣传图像素

FONT_ZH = "C:/Windows/Fonts/msyhbd.ttc"      # 微软雅黑 Bold
FONT_MONO = "C:/Windows/Fonts/consolab.ttf"  # Consolas Bold

# 游戏配色（取自 js/main.js）
C_BULLET = "#ffe66d"     # 玩家普通弹
C_HOMING = "#ff9d3c"     # 追踪弹
C_LASER = "#5df0ff"      # 激光
C_EBULLET = "#ff5d7a"    # 敌弹
C_GRUNT = "#e0555f"; C_WEAVER = "#b06ae0"; C_DIVER = "#ff8c42"; C_TURRET = "#6b7280"
C_CYAN = "#00f3ff"; C_PINK = "#ff0055"; C_GREEN = "#7dff8c"; C_GOLD = "#ffd23c"


def hex2rgb(h, a=255):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)) + (a,)


def load_sprite(name):
    p = os.path.join(SPRITES, name)
    return Image.open(p).convert("RGBA")


def glow_sprite(color, R):
    """径向衰减光斑，模拟游戏 glowSprite"""
    r = max(2, int(R))
    yy, xx = np.mgrid[-r:r + 1, -r:r + 1].astype(np.float32)
    d2 = xx * xx + yy * yy
    k = np.clip(1 - d2 / (r * r), 0, 1) ** 2  # 平方衰减更聚光
    rgb = np.array(hex2rgb(color)[:3], dtype=np.float32) / 255.0
    arr = np.zeros((2 * r + 1, 2 * r + 1, 4), dtype=np.float32)
    arr[..., :3] = rgb[None, None, :]
    arr[..., 3] = k
    return Image.fromarray((arr * 255).astype(np.uint8), "RGBA")


def screen_blend(base, top):
    """lighter/_screen 混合（弹幕发光感）"""
    a = np.asarray(base, dtype=np.float32)
    b = np.asarray(top, dtype=np.float32) / 255.0
    alpha = b[..., 3:4] / 255.0
    # screen: 1-(1-a)(1-b)
    blended = 1 - (1 - a[..., :3] / 255.0) * (1 - b[..., :3])
    out = a[..., :3] / 255.0 * (1 - alpha) + blended * alpha
    out = np.clip(out * 255, 0, 255).astype(np.uint8)
    return Image.fromarray(out, "RGB").convert("RGBA")


def draw_glow(canvas, color, x, y, R):
    g = glow_sprite(color, R)
    canvas.alpha_composite(g, (int(x - g.width / 2), int(y - g.height / 2)))


def paste_sprite_glow(canvas, img, cx, cy, w, glow_color=None, glow_rad=None):
    """贴素材 + 底部辉光：剪影贴到外扩画布上再大半径模糊，辉光自然溢出无方形边框"""
    h = int(w * img.height / img.width)
    sp = img.resize((w, h), Image.LANCZOS)
    if glow_color and glow_rad:
        pad = int(glow_rad * 2.5)
        sil = Image.new("RGBA", (w + pad * 2, h + pad * 2), (0, 0, 0, 0))
        alpha = sp.split()[3].point(lambda v: int(v * 0.6))
        tint = Image.new("RGBA", sp.size, hex2rgb(glow_color))
        tint.putalpha(alpha)
        sil.alpha_composite(tint, (pad, pad))
        gl = sil.filter(ImageFilter.GaussianBlur(glow_rad * 1.8))
        canvas.alpha_composite(gl, (int(cx - w / 2 - pad), int(cy - h / 2 - pad)))
    canvas.alpha_composite(sp, (int(cx - w / 2), int(cy - h / 2)))


def text_glow(canvas, text, cx, cy, size, color, font_path=FONT_ZH, blur=14, align="mm"):
    """霓虹发光文字（复刻游戏 shadowBlur 标题风格）"""
    font = ImageFont.truetype(font_path, size)
    tmp = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(tmp)
    bbox = d.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    if align == "mm":
        pos = (cx - tw / 2 - bbox[0], cy - th / 2 - bbox[1])
    elif align == "tm":  # 顶部对齐
        pos = (cx - tw / 2 - bbox[0], cy)
    else:
        pos = (cx, cy)
    d.text(pos, text, font=font, fill=hex2rgb(color))
    # 辉光层
    glow = tmp.filter(ImageFilter.GaussianBlur(blur))
    tglow = Image.new("RGBA", (W, H), hex2rgb(color, 0))
    tglow.paste(glow, (0, 0), glow)
    canvas.alpha_composite(screen_blend(canvas, tglow).convert("RGBA"))
    canvas.alpha_composite(tmp)
    return tw


def neon_panel(canvas, x, y, w, h, title, glow_color):
    """复刻 UI.drawNeonPanel 全息面板"""
    r = 8
    panel = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(panel)
    d.rounded_rectangle([0, 0, w - 1, h - 1], r, fill=(10, 14, 30, 217),
                        outline=hex2rgb(glow_color), width=2)
    d.line([(6, 5), (18, 5)], fill=(255, 255, 255, 76), width=1)
    d.line([(w - 18, 5), (w - 6, 5)], fill=(255, 255, 255, 76), width=1)
    if title:
        f = ImageFont.truetype(FONT_ZH, int(h * 0.30))
        d.text((12, h / 2), title, font=f, fill=hex2rgb(glow_color), anchor="lm")
    gl = panel.filter(ImageFilter.GaussianBlur(6))
    tglow = Image.new("RGBA", (W, H), hex2rgb(glow_color, 0))
    tglow.paste(gl, (x, y), gl)
    canvas.alpha_composite(screen_blend(canvas, tglow).convert("RGBA"))
    canvas.alpha_composite(panel, (x, y))


def draw_enemy(canvas, etype, x, y, scale=2.0, rot=0):
    """复刻 drawEnemy 的程序化敌机（scale 相对游戏逻辑像素）"""
    s = S * scale
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rectangle  # noqa
    import math
    if etype == "grunt":
        col, pts = C_GRUNT, [(0, 10), (-11, -8), (0, -3), (11, -8)]
        d.polygon([(x + px * s, y + py * s) for px, py in pts], fill=hex2rgb(col))
        d.rectangle([x - 2 * s, y - 4 * s, x + 2 * s, y], fill=hex2rgb("#ffd0d0"))
    elif etype == "weaver":
        d.ellipse([x - 13 * s, y - 8 * s, x + 13 * s, y + 8 * s], fill=hex2rgb(C_WEAVER))
        d.ellipse([x - 4 * s, y - 4 * s, x + 4 * s, y + 4 * s], fill=hex2rgb("#f0d0ff"))
    elif etype == "diver":
        ang = math.radians(90 + rot)
        def rp(px, py):
            ca, sa = math.cos(ang), math.sin(ang)
            return (x + (px * ca - py * sa) * s, y + (px * sa + py * ca) * s)
        d.polygon([rp(0, 12), rp(-9, -9), rp(0, -4), rp(9, -9)], fill=hex2rgb(C_DIVER))
    # 外发光
    gl = layer.filter(ImageFilter.GaussianBlur(5))
    canvas.alpha_composite(screen_blend(canvas, gl).convert("RGBA"))
    canvas.alpha_composite(layer)


def bullet(canvas, color, x, y, r, trail=None):
    """玩家/敌弹：光斑 + 可选拖尾（trail=拖尾长度px）"""
    if trail:
        t = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(t)
        d.line([(x, y + r * 3), (x, y + trail)], fill=hex2rgb(color, 170),
               width=max(2, int(r * 0.9)))
        gl = t.filter(ImageFilter.GaussianBlur(r * 0.7))
        canvas.alpha_composite(screen_blend(canvas, gl).convert("RGBA"))
        canvas.alpha_composite(t)
    draw_glow(canvas, color, x, y, r * 6)


def spark_cluster(canvas, x, y, color, n=14, spread=46, seed=3, ring=True):
    """爆点：光点粒子 + 可选冲击环（复刻 parts/shockwaves）"""
    rng = np.random.default_rng(seed)
    for _ in range(n):
        px = x + rng.uniform(-spread, spread)
        py = y + rng.uniform(-spread, spread)
        draw_glow(canvas, color, px, py, rng.uniform(6, 16))
    if ring:
        ring_img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(ring_img)
        rr = spread * 1.5
        d.ellipse([x - rr, y - rr, x + rr, y + rr], outline=hex2rgb(color, 200), width=4)
        gl = ring_img.filter(ImageFilter.GaussianBlur(3))
        canvas.alpha_composite(screen_blend(canvas, gl).convert("RGBA"))
        canvas.alpha_composite(ring_img)


def base_canvas(bg_path):
    bg = Image.open(bg_path).convert("RGBA")
    # 2K 9:16 → 裁切至 9:16 比例再缩放 720x1280
    bw, bh = bg.size
    target = W / H
    if bw / bh > target:
        nw = int(bh * target)
        bg = bg.crop(((bw - nw) // 2, 0, (bw + nw) // 2, bh))
    else:
        nh = int(bw / target)
        bg = bg.crop((0, 0, bw, nh))
    return bg.resize((W, H), Image.LANCZOS)


def logo_header(canvas, y=96, size=150, subtitle="赛博街机 · 弹幕射击"):
    lg = Image.open(LOGO).convert("RGBA")
    paste_sprite_glow(canvas, lg, W / 2, y, size, glow_color=C_CYAN, glow_rad=18)
    text_glow(canvas, subtitle, W / 2, y + size / 2 + 34, 30, C_CYAN, blur=12)


# ────────────────────────── 图1：核心玩法 ──────────────────────────
def make_promo1(bg_path):
    c = base_canvas(bg_path)
    logo_header(c, y=104, size=150)

    # 敌机编队（上密下疏）
    for row, yy in enumerate((330, 420)):
        for i in range(5):
            x = 110 + i * 125
            draw_enemy(c, "grunt", x, yy + (i % 2) * 18, scale=2.4)
    draw_enemy(c, "weaver", 130, 540, scale=2.6)
    draw_enemy(c, "weaver", 590, 520, scale=2.6)
    draw_enemy(c, "diver", 300, 610, scale=2.4, rot=20)
    draw_enemy(c, "diver", 430, 600, scale=2.4, rot=-15)

    # 敌弹（粉红斜向下）
    rng = np.random.default_rng(7)
    for _ in range(16):
        bullet(c, C_EBULLET, rng.uniform(60, W - 60), rng.uniform(700, 1000),
               4 * 1.2, trail=0)

    # 玩家战机（四级机·放大特写）
    ship = load_sprite("战机分级-04.png")
    sx, sy = W / 2, 1080
    paste_sprite_glow(c, ship, sx, sy, 170, glow_color=C_CYAN, glow_rad=16)

    # 主弹幕（黄色三列上射 + 橙色追踪）
    for xoff in (-58, 0, 58):
        for k in range(6):
            yy = sy - 150 - k * 105
            if yy > 240:
                bullet(c, C_BULLET, sx + xoff, yy, 3 * 1.6, trail=46)
    for xoff, ang in ((-120, 8), (115, -6)):
        bullet(c, C_HOMING, sx + xoff, 880, 4 * 1.5, trail=40)

    # 命中爆点
    spark_cluster(c, 235, 348, "#ff5d5d", n=12, spread=34, seed=1)
    spark_cluster(c, 480, 430, C_GOLD, n=10, spread=30, seed=5)

    # 玩法提示面板
    neon_panel(c, 150, 1168, 420, 72, "拖动操作 · 自动开火", C_CYAN)
    return c


# ────────────────────────── 图2：Boss 战 ──────────────────────────
def make_promo2(bg_path):
    c = base_canvas(bg_path)
    logo_header(c, y=92, size=140, subtitle="首领降临 · 全弹幕回避")

    # 警告横幅（复刻游戏 warnT 样式）
    text_glow(c, "警 告 · 首 领 接 近", W / 2, 380, 44, "#ff2244", blur=16)
    bar = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(bar)
    d.rectangle([W * 0.12, 412, W * 0.88, 415], fill=hex2rgb("#ff2244", 220))
    gl = bar.filter(ImageFilter.GaussianBlur(4))
    c.alpha_composite(screen_blend(c, gl).convert("RGBA"))
    c.alpha_composite(bar)

    # Boss 巨物特写（真实素材）
    boss = load_sprite("Boss-01.png")
    paste_sprite_glow(c, boss, W / 2, 640, 430, glow_color="#ff2244", glow_rad=22)

    # Boss 弹幕环（粉红放射）
    import math
    for i in range(14):
        ang = math.pi / 2 + (i - 6.5) * 0.32  # 扇形向下
        r = 250 if i % 2 else 300
        bullet(c, C_EBULLET, W / 2 + math.cos(ang) * r * 0.6,
               640 + math.sin(ang) * r, 5, trail=0)

    # 玩家战机（三级机）+ 激光
    ship = load_sprite("战机分级-03.png")
    sx, sy = W / 2, 1120
    paste_sprite_glow(c, ship, sx, sy, 150, glow_color=C_CYAN, glow_rad=14)
    # 青色激光束（穿透激光 lighter）
    beam = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(beam)
    d.rectangle([sx - 7, 500, sx + 7, sy - 78], fill=hex2rgb(C_LASER, 200))
    d.rectangle([sx - 2, 500, sx + 2, sy - 78], fill=(255, 255, 255, 230))
    gl = beam.filter(ImageFilter.GaussianBlur(8))
    c.alpha_composite(screen_blend(c, gl).convert("RGBA"))
    c.alpha_composite(screen_blend(c, beam).convert("RGBA"))
    c.alpha_composite(beam)
    # 弹着点（只留光点粒子，冲击环会像标注框）
    spark_cluster(c, sx, 560, C_LASER, n=16, spread=44, seed=9, ring=False)

    # 侧翼追踪弹
    bullet(c, C_GOLD, sx - 105, 1010, 4 * 1.5, trail=40)
    bullet(c, C_GOLD, sx + 105, 1024, 4 * 1.5, trail=40)

    neon_panel(c, 150, 1180, 420, 64, "弹幕地狱 · 极限走位", "#ff2244")
    return c


# ────────────────────────── 图3：升级 / 道具 ──────────────────────────
def make_promo3(bg_path):
    c = base_canvas(bg_path)
    logo_header(c, y=92, size=140, subtitle="武器升级 · 火力进化")

    # 掉落道具（真实素材 + 字母角标，飘浮排布）
    items = [
        ("Buff道具-02.png", "R", "#ff4d4d", 180, 360),
        ("掉落物-02.png", "B", "#4da6ff", 360, 320),
        ("Buff道具-06.png", "Y", "#ffd23c", 540, 360),
        ("Buff道具-04.png", "M", "#ff8c42", 225, 520),
        ("掉落物-06.png", "S", "#7dff8c", 495, 520),
    ]
    for name, letter, col, x, y in items:
        sp = load_sprite(name)
        paste_sprite_glow(c, sp, x, y, 110, glow_color=col, glow_rad=14)
        # 字母徽标（游戏道具 letter 风格）
        badge = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(badge)
        bx, by, bs = x + 38, y - 38, 19
        d.rounded_rectangle([bx - bs, by - bs, bx + bs, by + bs], 6,
                            fill=hex2rgb(col), outline=(255, 255, 255, 180), width=2)
        f = ImageFont.truetype(FONT_MONO, 24)
        d.text((bx, by), letter, font=f, fill=(10, 10, 18), anchor="mm")
        gl = badge.filter(ImageFilter.GaussianBlur(6))
        tglow = Image.new("RGBA", (W, H), hex2rgb(col, 0))
        tglow.paste(gl, (0, 0), gl)
        c.alpha_composite(screen_blend(c, tglow).convert("RGBA"))
        c.alpha_composite(badge)

    # 战机进化序列 01→04
    ships = ["战机分级-01.png", "战机分级-02.png", "战机分级-03.png", "战机分级-04.png"]
    xs = (120, 275, 440, 590)
    ws = (95, 115, 135, 160)
    ys = (760, 782, 810, 845)
    for name, x, w_, y in zip(ships, xs, ws, ys):
        sp = load_sprite(name)
        paste_sprite_glow(c, sp, x, y, w_, glow_color=C_CYAN, glow_rad=12)

    # 满级机火力展示（底部，扇形弹幕）
    ship = load_sprite("战机分级-04.png")
    sx, sy = 200, 1120
    paste_sprite_glow(c, ship, sx, sy, 140, glow_color=C_GOLD, glow_rad=14)
    import math
    for i in range(9):
        ang = -math.pi / 2 + (i - 4) * 0.22
        dx, dy = math.cos(ang), math.sin(ang)
        for k in (90, 170, 250, 330):
            bullet(c, C_BULLET, sx + dx * k, sy - 55 + dy * k, 4.5,
                   trail=0 if i in (0, 8) else 36)

    neon_panel(c, 340, 1090, 250, 66, "拾取道具 · 武器升级", C_GREEN)
    neon_panel(c, 150, 1180, 420, 64, "四级机体 · 火力全开", C_GOLD)
    return c


def save_jpeg_under(img, path, limit=200 * 1024):
    """二分 quality 压到 limit 以内"""
    lo, hi, best = 30, 95, None
    rgb = img.convert("RGB")
    while lo <= hi:
        mid = (lo + hi) // 2
        tmp = os.path.join(WORK, "_tmp.jpg")
        rgb.save(tmp, "JPEG", quality=mid, optimize=True)
        sz = os.path.getsize(tmp)
        if sz <= limit:
            best = (mid, sz)
            lo = mid + 1
        else:
            hi = mid - 1
    q, sz = best
    rgb.save(path, "JPEG", quality=q, optimize=True)
    return q, os.path.getsize(path)


if __name__ == "__main__":
    out_dir = os.path.join(ROOT, "assets", "promo")
    os.makedirs(out_dir, exist_ok=True)
    jobs = [
        (make_promo1, "promo_work/bg1.png", "怒雷风暴-宣传图1-弹幕玩法.jpg"),
        (make_promo2, "promo_work/bg2.png", "怒雷风暴-宣传图2-Boss战.jpg"),
        (make_promo3, "promo_work/bg3.png", "怒雷风暴-宣传图3-武器升级.jpg"),
    ]
    for fn, bg, name in jobs:
        c = fn(os.path.join(ROOT, bg))
        preview = os.path.join(WORK, "preview_" + name.replace(".jpg", ".png"))
        c.convert("RGB").save(preview, "PNG")
        q, sz = save_jpeg_under(c, os.path.join(out_dir, name))
        print(f"{name}: quality={q} size={sz/1024:.0f}KB")
    print("done ->", out_dir)
