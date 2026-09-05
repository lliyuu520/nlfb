#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""刷新 oss.lliyuu520.cn 上指定 sprites 路径的 CDN 缓存(RefreshObjectCaches)。
凭据: ~/.acme.sh/cdn_creds.env(与 cdn_cert_renew.py 同源,不入仓库)。
用法: python tools/cdn_purge_sprites.py
"""
import os, sys, time, hmac, hashlib, base64, uuid, datetime
import urllib.parse, urllib.request, urllib.error

HOME = os.path.expanduser("~")
CREDS = os.path.join(HOME, ".acme.sh", "cdn_creds.env")

def load_creds():
    kv = {}
    with open(CREDS, encoding="utf-8") as f:
        for line in f:
            k, _, v = line.partition("=")
            if k.strip() and v.strip():
                kv[k.strip()] = v.strip()
    return kv["ALIYUN_OSS_ACCESS_KEY_ID"], kv["ALIYUN_OSS_ACCESS_KEY_SECRET"]

def enc(s):
    return urllib.parse.quote(str(s), safe="-_.~")

def refresh(ak, sk, object_path):
    p = {
        "Action": "RefreshObjectCaches", "Version": "2018-05-10", "Format": "JSON",
        "AccessKeyId": ak, "SignatureMethod": "HMAC-SHA1", "SignatureVersion": "1.0",
        "SignatureNonce": str(uuid.uuid4()),
        "Timestamp": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "ObjectPath": object_path, "ObjectType": "File",
    }
    qs = "&".join(f"{enc(k)}={enc(v)}" for k, v in sorted(p.items()))
    sts = "POST&%2F&" + urllib.parse.quote(qs, safe="-_.~")
    sig = base64.b64encode(hmac.new((sk + "&").encode(), sts.encode(), hashlib.sha1).digest()).decode()
    req = urllib.request.Request("https://cdn.aliyuncs.com/",
        data=(qs + "&Signature=" + enc(sig)).encode(),
        headers={"Content-Type": "application/x-www-form-urlencoded"}, method="POST")
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode()

if __name__ == "__main__":
    ak, sk = load_creds()
    # 用法: python tools/cdn_purge_sprites.py [文件名1 文件名2 ...]  # 不传则默认战机分级-03/04
    names = sys.argv[1:] or ["战机分级-0" + n + ".png" for n in ("03", "04")]
    for name in names:
        path = "https://oss.lliyuu520.cn/sprites/" + urllib.parse.quote(name)
        try:
            print(name, refresh(ak, sk, path))
        except urllib.error.HTTPError as e:
            print(name, "HTTP", e.code, e.read().decode("utf-8", "replace")[:300]); sys.exit(1)
