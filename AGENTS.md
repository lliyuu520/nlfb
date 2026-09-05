# AGENTS.md

> 《怒雷风暴》(nlfb) 单仓库：`lszj/` 微信小游戏客户端 + `nulei-server/` 世界榜 Go 后端。

## 子项目规范入口（按改动范围必读）

- 改 `lszj/` 前：读 `lszj/AGENTS.md`——wx API 隔离（禁 DOM/BOM）、Canvas 2D 性能控制、触控与刘海适配、wechatide 预览门禁。
- 改 `nulei-server/` 前：读 `nulei-server/README.md`——接口表、devLogin 本地调试、deploy.sh 部署与 nginx/证书运维。
- 改两端共用的接口契约（如世界榜 API 协议）：两份都读，两端同步修改后再各自验证。

## 红线

- `nulei-server/data/`：含真实 appSecret 与玩家数据，严禁入库、严禁在回复/日志中外传。
- `nulei-server/deploy.sh`：直接部署阿里云线上，必须先获用户确认。

## Git 约定

- 提交 scope 对应子目录：`feat(lszj): …`、`fix(nulei-server): …`；跨两端改动不带 scope。
- 项目级 MCP 配置在工作区根 `.zcode/config.json`（本地使用，`.zcode/` 整体不入库）；原 `lszj/.zcode/` 下的同名配置已移除。
