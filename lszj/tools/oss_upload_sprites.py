"""上传 lszj 运行时 sprites 到 OSS，并输出每张的内容包围盒（供绘制尺寸校准）。
用法: python oss_upload_sprites.py
凭据优先级：环境变量 > 项目根 ../.env（KEY=VALUE 每行一条，# 注释）。
"""
import os, sys, time, hmac, hashlib, base64, urllib.request, urllib.parse

def load_env():
    """从项目根 .env 读取缺失的环境变量"""
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
SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "sprites")
SRC = os.path.normpath(SRC)

SHEET_MARK = "透明底整图"  # 切图源稿，不上传

def put_object(key, path, ctype="image/png"):
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

def alpha_bbox(path):
    from PIL import Image
    im = Image.open(path).convert("RGBA")
    bbox = im.getbbox()  # 基于 alpha 与颜色，透明底 PNG 即内容范围
    w, h = im.size
    if not bbox:
        return w, h, 1.0, 1.0
    bw, bh = bbox[2] - bbox[0], bbox[3] - bbox[1]
    return w, h, bw / w, bh / h

def main():
    from PIL import Image
    names = sorted(f for f in os.listdir(SRC) if f.endswith(".png") and SHEET_MARK not in f)
    print(f"共 {len(names)} 张待上传")
    fail = 0
    for f in names:
        key = f"sprites/{f}"
        try:
            status = put_object(key, os.path.join(SRC, f))
            w, h, rw, rh = alpha_bbox(os.path.join(SRC, f))
            print(f"[{status}] sprites/{f}  {w}x{h} 内容占比 w={rw:.2f} h={rh:.2f}")
        except Exception as e:
            fail += 1
            print(f"[FAIL] sprites/{f}: {e}")
    sys.exit(1 if fail else 0)

main()
