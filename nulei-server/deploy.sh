#!/usr/bin/env bash
# 部署 nulei-server 到阿里云服务器
# 用法: ./deploy.sh [ssh别名]   （默认 自用阿里云）
set -euo pipefail

HOST="${1:-自用阿里云}"
DIR="/opt/nulei-server"

echo "==> 本地交叉编译 linux/amd64"
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags "-s -w" -o bin/nulei-server .

echo "==> 远程准备目录与运行用户"
ssh "$HOST" "mkdir -p $DIR/data && (id nulei >/dev/null 2>&1 || useradd -r -s /usr/sbin/nologin nulei) && chmod 700 $DIR/data"

echo "==> 上传二进制 / systemd unit / 配置模板"
scp bin/nulei-server "$HOST:$DIR/nulei-server.new"
scp deploy/nulei-server.service "$HOST:/etc/systemd/system/nulei-server.service"
scp config.example.json "$HOST:$DIR/config.example.json"

echo "==> 远程安装并重启"
ssh "$HOST" "set -e
  cd $DIR
  [ -f nulei-server ] && cp nulei-server nulei-server.bak || true
  mv nulei-server.new nulei-server && chmod 755 nulei-server
  chown -R nulei:nulei $DIR
  if [ ! -f data/config.json ]; then
    cp config.example.json data/config.json
    chown nulei:nulei data/config.json
    echo '!! 已生成默认配置，请编辑 /opt/nulei-server/data/config.json 填入 appId/appSecret 后再重启服务'
  fi
  systemctl daemon-reload
  systemctl enable --now nulei-server
  systemctl restart nulei-server
  sleep 1
  systemctl is-active nulei-server && echo '==> nulei-server 部署完成'
  curl -s http://127.0.0.1:12700/nulei/api/ping"
