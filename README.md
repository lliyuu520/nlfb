# nlfb — 《怒雷风暴》

个人项目单仓库（monorepo）：微信小游戏《怒雷风暴》(Nu-Thunder) 及其世界排行榜后端。

## 目录

| 目录 | 内容 | 说明 |
|------|------|------|
| `lszj/` | 微信小游戏客户端 | 竖版街机飞行射击，原生 Canvas 2D（`wx.createCanvas`），无第三方游戏引擎，靠激励视频/Banner 广告变现。项目规范见 `lszj/AGENTS.md` |
| `nulei-server/` | 世界榜后端 | 纯 Go 标准库单文件实现，数据落 `data/scores.json`（原子写），部署于阿里云（nginx 反代 `game.lliyuu520.cn`）。详见 `nulei-server/README.md` |

好友榜走微信开放数据域（`openDataContext`，零后端），`nulei-server` 只负责世界榜。

## 仓库约定

- 单仓库包含两个子项目，根 `.gitignore` 排除编辑器/系统杂物；
  `nulei-server/.gitignore` 继续排除 `bin/ data/`（`data/config.json` 含 appSecret，严禁入库）。
- 两子项目原独立仓库的历史已通过 vendor 合并保留在主分支中（`lszj`、`nulei-server`
  的原提交均可通过 merge parent 追溯）。
