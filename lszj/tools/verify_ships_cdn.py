# -*- coding: utf-8 -*-
"""验证 CDN 上两张战机素材与本地一致。用法: python tools/verify_ships_cdn.py"""
import urllib.request, urllib.parse, hashlib, os

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
for n in ["03", "04"]:
    name = "战机分级-" + n + ".png"
    u = "https://oss.lliyuu520.cn/sprites/" + urllib.parse.quote(name)
    data = urllib.request.urlopen(u, timeout=60).read()
    local = open(os.path.join(ROOT, "assets", "sprites", name), "rb").read()
    same = data == local
    print(name, "cdn=%dB md5=%s local=%dB md5=%s %s" % (
        len(data), hashlib.md5(data).hexdigest()[:10],
        len(local), hashlib.md5(local).hexdigest()[:10],
        "MATCH" if same else "MISMATCH(可能CDN边缘缓存,稍后再验)"))
