# -*- coding: utf-8 -*-
"""上传指定 sprites 到 OSS(复用项目 .env 凭据)。
用法: python tools/upload_two_ships.py [文件名1 文件名2 ...]  # 不传则默认战机分级-03/04
"""
import os, sys, time, hmac, hashlib, base64, urllib.request, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, ".."))

env = {}
with open(os.path.join(ROOT, ".env"), encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("=")
            env[k.strip()] = v.strip()

AK = env["ALIYUN_OSS_ACCESS_KEY_ID"]
SK = env["ALIYUN_OSS_ACCESS_KEY_SECRET"]
BUCKET = "lliyuu520"
HOST = BUCKET + ".oss-cn-chengdu.aliyuncs.com"

def put(key, path):
    date = time.strftime("%a, %d %b %Y %H:%M:%S GMT", time.gmtime())
    sts = "PUT\n\nimage/png\n" + date + "\n/" + BUCKET + "/" + key
    sig = base64.b64encode(hmac.new(SK.encode(), sts.encode(), hashlib.sha1).digest()).decode()
    req = urllib.request.Request(
        "https://" + HOST + "/" + urllib.parse.quote(key),
        data=open(path, "rb").read(), method="PUT",
        headers={"Date": date, "Content-Type": "image/png",
                 "Authorization": "OSS " + AK + ":" + sig})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.status

names = sys.argv[1:] or ["战机分级-03.png", "战机分级-04.png"]
for name in names:
    status = put("sprites/" + name, os.path.join(ROOT, "assets", "sprites", name))
    print("[" + str(status) + "] sprites/" + name)
