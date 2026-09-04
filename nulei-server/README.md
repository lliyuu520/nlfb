# nulei-server

《怒雷风暴》微信小游戏**世界排行榜**后端。纯 Go 标准库单文件实现，无第三方依赖，
数据落 `data/scores.json`（原子写），登录走微信 `code2Session`，token 为 HMAC 无状态签名。

好友榜不经过本服务（走微信开放数据域，零后端），本服务只负责世界榜。

## 接口

前缀由配置 `basePath` 决定，线上为 `/nulei/api`（经 nginx `game.lliyuu520.cn` 反代）。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET  | `/ping` | 健康检查 |
| POST | `/login` | `{code}` → `{token, name, best, custom}`，code 为 `wx.login()` 的 code |
| POST | `/score` | `Authorization: Bearer <token>` + `{score, duration(秒)}` → `{best, rank, updated}` |
| GET  | `/rank?limit=100` | 可选 Bearer token → `{list:[{rank,name,score,custom}], me, total}` |
| POST | `/nickname` | Bearer token + `{nickname}` → `{name, custom}` |

防作弊：分数硬上限 `maxScore`、单局"分数 ≤ maxScoreRate×时长+2000"合理性校验、
每玩家每日上报次数上限、按 IP 的登录频次限制。token 默认 30 天，过期客户端静默重登。

## 本地调试

```bash
mkdir -p data
# 写一份 devLogin=true 的 data/config.json（appId/appSecret 留空即可）
go build -o bin/nulei-server.exe . && ./bin/nulei-server.exe
```

`devLogin=true` 时 `/login` 的 code 直接当 openid 用（`dev_<code>`），不请求微信。

## 部署（阿里云 自用阿里云）

```bash
./deploy.sh          # 编译 linux/amd64 → 上传 → systemd 启动
```

首次部署后需要：

1. `ssh 自用阿里云`，编辑 `/opt/nulei-server/data/config.json` 填入 `appId`/`appSecret`，
   然后 `systemctl restart nulei-server`；
2. nginx：把 `deploy/nginx-nulei-location.conf` 的 location 块加进
   `/etc/nginx/nginx.conf` 中 `server_name game.lliyuu520.cn` 的 server 块（放 `location /` 前），
   `nginx -t && nginx -s reload`；
3. 微信公众平台「开发设置 → 服务器域名 → request 合法域名」加 `https://game.lliyuu520.cn`。

## 运维注意

- 证书：origin 证书由 acme.sh 续期（`/etc/nginx/ssl/_.lliyuu520.cn.pem`，SAN 含
  `*.lliyuu520.cn`），**续期后必须 `nginx -s reload`**，否则 nginx 一直用内存里的旧证书
  （2026-09 发现过线上证书已临期未加载新证书的情况）。
- 备份：直接备份 `data/scores.json`。
- 配置里 `tokenSecret` 首次启动自动生成；**换它会让所有玩家 token 失效**（会自动重新登录，无感）。
