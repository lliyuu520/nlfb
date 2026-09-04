# personal 工作区

个人项目多项目工作区。根仓库只管理工作区级文件（本 README、`.gitignore`），
各子项目为独立 git 仓库，已在根 `.gitignore` 中排除，各自管理各自的提交。

## 子项目

| 目录 | 项目 | 说明 |
|------|------|------|
| `lszj/` | 《怒雷风暴》(Nu-Thunder) | 个人微信小游戏：竖版街机飞行射击，原生 Canvas 2D，无游戏引擎，靠激励视频/Banner 广告变现。规范见 `lszj/AGENTS.md` |
| `nulei-server/` | nulei-server | 上述小游戏的世界排行榜后端：纯 Go 标准库单文件实现，数据落 `data/scores.json`，部署于阿里云（nginx 反代 `game.lliyuu520.cn`）。详见 `nulei-server/README.md` |

## 说明

- 两个项目同属《怒雷风暴》：`lszj` 是客户端，`nulei-server` 是其世界榜服务端；
  好友榜走微信开放数据域，不经过后端。
- 根仓库不要执行 `git add -f` 强行跟踪子项目内容，子项目的提交/分支在各子目录内操作。
