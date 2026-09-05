#!/usr/bin/env python3
"""lliyuu520.cn CDN 证书自动续期（怒雷风暴 oss.lliyuu520.cn）

流程：
1. acme.sh --renew（未到期会自行 Skip，属正常）；CF DNS 凭据由 ~/.acme.sh/account.conf 自管。
2. 若完成续签：读 ~/.acme.sh/lliyuu520.cn_ecc/ 的 fullchain/key，
   调阿里云 CDN API SetCdnDomainSSLCertificate（CertType=upload）重新挂载。
3. 验证 oss.lliyuu520.cn 边缘证书 notAfter 距今 > 30 天。

AK 凭据文件：~/.acme.sh/cdn_creds.env（两行 KEY=VALUE，不入仓库）。
"""
import os, sys, time, hmac, hashlib, base64, uuid, subprocess, datetime
import urllib.parse, urllib.request, urllib.error

HOME = os.path.expanduser("~")
ACME = os.path.join(HOME, ".acme.sh")
CERTDIR = os.path.join(ACME, "lliyuu520.cn_ecc")
CREDS = os.path.join(ACME, "cdn_creds.env")
DOMAIN = "oss.lliyuu520.cn"

def find_bash():
    # PATH 上的 bash 可能是 WSL bash（看不到 C:/ 路径），优先 Git Bash 固定位置
    import shutil
    for c in (r"C:\Program Files\Git\bin\bash.exe", r"C:\Program Files\Git\usr\bin\bash.exe"):
        if os.path.exists(c):
            return c
    return shutil.which("bash") or "bash"

def run_renew():
    # Git Bash 不认反斜杠路径，统一转正斜杠
    acme_sh = os.path.join(ACME, "acme.sh").replace("\\", "/")
    r = subprocess.run(
        [find_bash(), acme_sh, "--renew", "-d", "lliyuu520.cn", "--ecc"],
        capture_output=True, text=True, timeout=900)
    out = (r.stdout or "") + (r.stderr or "")
    low = out.lower()
    if "skipping" in low:
        print("SKIP: 未到续期窗口（acme.sh 判定无需续签）")
        sys.exit(0)
    if r.returncode != 0:
        print("RENEW_FAIL:\n" + out[-2500:])
        sys.exit(1)
    print("RENEW_OK: 已签发新证书")
    return out

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

def upload_to_cdn(ak, sk):
    pub = open(os.path.join(CERTDIR, "fullchain.cer"), encoding="utf-8").read()
    pri = open(os.path.join(CERTDIR, "lliyuu520.cn.key"), encoding="utf-8").read()
    p = {
        "Action": "SetCdnDomainSSLCertificate", "Version": "2018-05-10", "Format": "JSON",
        "AccessKeyId": ak, "SignatureMethod": "HMAC-SHA1", "SignatureVersion": "1.0",
        "SignatureNonce": str(uuid.uuid4()),
        "Timestamp": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "DomainName": DOMAIN, "SSLProtocol": "on", "CertType": "upload",
        "CertName": "acme-lliyuu520-" + time.strftime("%Y%m%d"),
        "SSLPub": pub, "SSLPri": pri,
    }
    qs = "&".join(f"{enc(k)}={enc(v)}" for k, v in sorted(p.items()))
    sts = "POST&%2F&" + urllib.parse.quote(qs, safe="-_.~")
    sig = base64.b64encode(hmac.new((sk + "&").encode(), sts.encode(), hashlib.sha1).digest()).decode()
    req = urllib.request.Request("https://cdn.aliyuncs.com/",
        data=(qs + "&Signature=" + enc(sig)).encode(),
        headers={"Content-Type": "application/x-www-form-urlencoded"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            body = r.read().decode()
        if "RequestId" in body:
            print("UPLOAD_OK: 新证书已挂载 CDN")
            return
        print("UPLOAD_FAIL:", body[:500]); sys.exit(1)
    except urllib.error.HTTPError as e:
        print("UPLOAD_FAIL HTTP", e.code, e.read().decode("utf-8", "replace")[:500]); sys.exit(1)

def verify():
    import ssl, socket
    ctx = ssl.create_default_context()
    for _ in range(6):  # CDN 边缘生效可能有延迟，重试 60s
        try:
            ip = socket.getaddrinfo(DOMAIN, 443)[0][4][0]
            with ctx.wrap_socket(socket.create_connection((ip, 443), timeout=10),
                                 server_hostname=DOMAIN) as s:
                d = s.getpeercert()["notAfter"]
                exp = datetime.datetime.strptime(d, "%b %d %H:%M:%S %Y GMT").replace(tzinfo=datetime.timezone.utc)
                days = (exp - datetime.datetime.now(datetime.timezone.utc)).days
                if days > 30:
                    print(f"VERIFY_OK: 边缘证书剩余 {days} 天（{d}）")
                    return
                print(f"VERIFY_WARN: 边缘证书仍剩 {days} 天，可能未生效（{d}）")
        except Exception as e:
            print("verify 重试:", e)
        time.sleep(10)
    sys.exit(1)

if __name__ == "__main__":
    run_renew()
    ak, sk = load_creds()
    upload_to_cdn(ak, sk)
    verify()
    print("DONE")
