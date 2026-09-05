# -*- coding: utf-8 -*-
"""上传 lszj 运行时音频（BGM 等）到 OSS audio/ 目录。
用法: python oss_upload_audio.py
凭据优先级：环境变量 > 项目根 ../.env（与 oss_upload_sprites.py 同规则）。
SFX 体积小打进小游戏包内即点即播，仅 BGM 等 CDN 素材走本脚本上传。
"""
import os, sys, time, hmac, hashlib, base64, urllib.request, urllib.parse

def load_env():
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env")
    if not os.path.exists(env_path):
        return
    with open(env_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip())

load_env()

AK = os.environ["ALIYUN_OSS_ACCESS_KEY_ID"]
SK = os.environ["ALIYUN_OSS_ACCESS_KEY_SECRET"]
BUCKET = "lliyuu520"
HOST = "lliyuu520.oss-cn-chengdu.aliyuncs.com"
SRC = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "audio"))

# 待上传清单：文件名 → (OSS key, Content-Type)
UPLOADS = {
    "bgm.mp3": ("audio/bgm.mp3", "audio/mpeg"),
}

def put_object(key, path, ctype):
    date = time.strftime("%a, %d %b %Y %H:%M:%S GMT", time.gmtime())
    resource = f"/{BUCKET}/{key}"
    sts = f"PUT\n\n{ctype}\n{date}\n{resource}"
    sig = base64.b64encode(hmac.new(SK.encode(), sts.encode(), hashlib.sha1).digest()).decode()
    url = "https://" + HOST + "/" + urllib.parse.quote(key)
    body = open(path, "rb").read()
    req = urllib.request.Request(
        url, data=body, method="PUT",
        headers={"Date": date, "Content-Type": ctype, "Authorization": f"OSS {AK}:{sig}"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.status

def head_check(key):
    """上传后经 CDN 域名 HEAD 校验可见性与 Content-Type"""
    url = "https://oss.lliyuu520.cn/" + urllib.parse.quote(key)
    req = urllib.request.Request(url, method="HEAD")
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, r.headers.get("Content-Length"), r.headers.get("Content-Type")

def main():
    fail = 0
    for f, (key, ctype) in UPLOADS.items():
        path = os.path.join(SRC, f)
        if not os.path.exists(path):
            print(f"[MISS] {f} 不存在于 {SRC}")
            fail += 1
            continue
        try:
            status = put_object(key, path, ctype)
            hstatus, clen, ctyp = head_check(key)
            local = os.path.getsize(path)
            ok = clen and int(clen) == local
            print(f"[{status}] {key}  本地 {local:,}B / CDN {clen or '?'}B  type={ctyp}  {'一致 ✓' if ok else '大小不一致 ✗'}")
            if not ok: fail += 1
        except Exception as e:
            fail += 1
            print(f"[FAIL] {key}: {e}")
    sys.exit(1 if fail else 0)

main()
