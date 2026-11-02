# OFFICE ARCADE · MEMORY

> Qoder 项目记忆快照，用于换机/丢失工作区后快速恢复上下文。
> **最后同步**：2026-11-02
> **仓库**：https://gitee.com/th1nker/office-arcade.git
> **本地路径**：`C:\Users\Administrator\Desktop\workspace\office-arcade`
> **版本**：3.6.2（2026-11-02）
> **当前分支**：`main`；`feature/gomoku-hover-preview` 已合并
> **当前状态**：3.6.2 新增五子棋落子位置预标记并包含白名单打包，已打版本号待发布；3.6.1 已发布。

---

## 1. 文档位置（项目知识以此为准）

项目架构、业务流程、六款游戏、存储、接口、测试、部署等细节**不在这里重复**，按需要读：

| 文档 | 内容 |
| --- | --- |
| [README.md](README.md) | 使用者视角：功能、玩法、账号/大厅/房间、接口一览、技术架构、测试、已知限制、运行方式 |
| [docs/开发手册.md](docs/开发手册.md) | 接手开发者：架构、一次对局数据流、游戏模块契约、存储与迁移、前端结构、WS 协议、测试矩阵、发版、踩坑 |
| [docs/发版流程.md](docs/发版流程.md) | 从拉代码到发版的完整操作 |

> 需要项目细节时先读对应章节；本文件只记录“文档之外”的会话记忆。

---

## 2. 换机恢复

1. `git clone https://gitee.com/th1nker/office-arcade.git`
2. 按第 1 节读 [README.md](README.md) 的“我要改代码”部分和 [docs/开发手册.md](docs/开发手册.md)。
3. 准备运行时、管理员配置、启动服务——完全按 README 操作，不在这里重复命令。
   - `admins.json` 不入库；管理后台测试夹具按 `tools/admin-test.js` 使用 `admin888`，仅限临时测试。
4. 验证命令见 README 的“测试”章节；本机基线为 `tools/check.js`、`tools/test-all.js --with-ui`、`tools/perf-test.js` 通过。
5. 检查 `git log -1` 与本文基线是否一致；未提交的移除改动按 `git status` 判断。

> GitHub 私有镜像：`git remote add github https://github.com/TH1nker2/office-arcade.git`（凭据用本机 GitHub PAT / 凭据管理器，勿写入 remote URL）。日常推送 `git push github main`，发版后 `git push github --tags`。

---

## 3. 当前工作区状态（会话记忆）

- 已配置 `github` 远程指向私有镜像；本地 `main` 上游仍为 `origin/main`（Gitee）。
- 2026-10-29：GitHub 17 个 Release、66 个安装包资产恢复完成（约 2.57 GB）；完整备份在 `C:\Users\Administrator\Desktop\workspace\arcade-release-backup`。
- `tools/publish-release.ps1` 已改为：默认不删任何发行版页面；900 MB 附件预检；只有 `-PruneOldReleases` 才清理旧附件（默认保留最近 3 个版本），删除前检查 GitHub 归档并要求确认；`-CheckOnly` 可只读预检。
- 新增 `.github/workflows/mirror-release-assets.yml`：推送 `v*` tag 时自动从 Gitee 下载三个安装包并镜像到 GitHub Release。
- `main` 的 3.6.0 发布提交为 `4c08b56`，tag `v3.6.0`；之后有文档提交 `fc4531d`。
- 功能分支 `feature/undercover-fixed-config` 已完成固定配置与输入法修复，并合并到 `main`。
- 谁是卧底人数上限从 10 调整为 12；轮数和卧底数固定：4 人 2 轮 1 卧底，5-7 人 3 轮 1 卧底，8-10 人 4 轮 2 卧底，11 人 4 轮 3 卧底，12 人 5 轮 3 卧底。
- 每人描述时限从 15 秒改为 30 秒；房间内轮数选择已完全移除，服务端也不再接受 rounds 设置。
- 输入法修复：新增 `AR.Dom.bindEnter`，组合输入期间的回车只交给 IME 上屏，不发送；覆盖卧底描述、房间/大厅聊天、加入房间、管理弹窗、登录/注册输入框。
- README、docs、memory 已同步；新截图覆盖 `shots/89`~`94`。
- 全量验证：`tools/test-all.js --with-ui` **24 个脚本全部通过（229.2s：13 个非浏览器 + 11 个浏览器）**；perf 首屏 gzip 107.5 KB、坦克/俄罗斯方块/弹幕 p95 16.7ms。
- 2026-10-30 审计修复：12 色调色板、俄罗斯方块输入队列上限、WebSocket 背压/本机 token 限制、SQLite 打开失败不再静默回退 JSON、异步 scrypt、卧底背景缓存、画猜笔迹边界；新增 `store-json-test`、`store-migration-test` 与相关回归断言；README/开发手册/发版流程按职责去重。
- 2026-10-30 修复五子棋人机悔棋：人机同意后同时撤回玩家上一手和电脑应手，避免电脑立刻重下导致棋盘看起来没回退；新增 `ui-v10-test.js`。
- 3.6.1：五子棋悔棋统一为“只能在自己回合发起，同意后撤回自己上一手和对手应手”，并包含配色、输入队列、WS 背压、存储回退、异步密码哈希等审计修复。
- 2026-10-30 发行包改为显式白名单：只带运行源码、runtime/node、对应平台启动器、LICENSE，再生成 admins.json/首次使用.txt；tools/docs/memory/README/package.json/CI 配置不再进包，Linux 包不再带 macOS 的 start.command。静态门禁新增白名单断言。
  - 全量测试 24/24 通过（229.4s）；三个新包 Windows 37.0 MB / Linux 42.6 MB / macOS 37.6 MB；Windows 包解压冒烟 `/api/version` 返回 3.6.1、首页 200。
  - 本地已重建 v3.6.1 三个包，但**未重新发布**，线上 v3.6.1 附件仍是旧包；下次发版生效。
- 2026-11-02 五子棋新增落子位置预标记：轮到自己时悬停空交叉点显示半透明预落子和青色准星；对方回合、已有棋子、等待回复或鼠标离开时自动隐藏。新增 `ui-v11-test.js`（双浏览器回归），同步 README 与开发手册；截图 `shots/95-gomoku-hover-preview.png`。
- 2026-11-02 全量测试 **25/25 通过（239.4s）** 后升至 3.6.2；`feature/gomoku-hover-preview`（`c8c111b`）已合并到 main（`0f9a34d`）。**未打 tag、未发布发行版。**
---

## 4. 2026-10-29 发布 3.6.0（移除四款游戏）

- 删除 `shared/games/{snake,bomber,racing,ludo}.js`、`js/render/{snake,bomber,racing,ludo}.js`，并从 `server.js` 取消 require。
- `shared/registry.js` 现只保留六款；`shared/games/constants.js` 删除 `LUDO` 常量。
- 清理 `js/input.js` 的蛇/飞行棋/赛车/炸弹人输入分支；`js/ui.js` 的对应 HUD 分支；`js/ui/game-ui.js` 的飞行棋点击；房间 `planes` 设置与 HTML 控件。
- `tools/game-test.js`、`bot-test.js`、`audit-test.js`、`auth-test.js`、`regression-test.js`、`hardening-test.js`、`proxy-test.js`、`player-profile-test.js`、`offline-test.js`、`perf-test.js`、`ui-v2/v3/v4/v6` 已改为剩余六款游戏；UI 截图替换为坦克/俄罗斯方块/六款大厅版本。
- 移除后 API/房间/资料/静态交付/安全/代理测试均通过；详细命令与结果见 README 测试章节。
- 版本号已升至 3.6.0，按用户要求执行 commit/push/三平台构建与 Gitee 发行。

---

## 5. 已知发布状态

- **v3.6.2 已打版本号，尚未发布**（2026-11-02）：五子棋落子位置预标记 + 发行包白名单；无 tag、无 Release、无安装包上传。
- **v3.6.1 三平台发行版已发布**：https://gitee.com/th1nker/office-arcade/releases/tag/v3.6.1
  - tag `v3.6.1` → `69d4549`，Gitee release id 1255556
  - 附件：win-x64.zip、linux-x64.tar.gz、darwin-arm64.tar.gz + Gitee 自动源码归档
  - GitHub Release id 428645951，三个资产已自动镜像；Gitee/GitHub 的 latest 均为 v3.6.1
  - 旧发行版页面继续保留，未清理
- **v3.6.0 三平台发行版已发布**：https://gitee.com/th1nker/office-arcade/releases/tag/v3.6.0
  - tag `v3.6.0` → `4c08b56`（重排后 release id 1254255；旧 id 1251446）
  - 附件：win-x64.zip、linux-x64.tar.gz、darwin-arm64.tar.gz + Gitee 自动源码归档
  - 发布说明由 `version.json` 生成；旧版发行版页面保留，未清理
- 2026-10-29 按版本从旧到新重建 Gitee 17 个发行版页面，修复“顺序反了”：现在页面顺序为 v3.6.0 → v3.5.0 → v3.4.1 → … → v2.6.0，`/releases/latest` 返回 v3.6.0。
  - 重排后 release id：v3.4.1 = 1254233，v3.5.0 = 1254243，v3.6.0 = 1254255
  - 说明正文、tag 指向和安装包均已校验一致
- v3.5.0 历史发行版：https://gitee.com/th1nker/office-arcade/releases/tag/v3.5.0（tag `v3.5.0` → `b8d250e`，十款版本）
- GitHub 私有镜像：https://github.com/TH1nker2/office-arcade（main + 18 tags；Releases 18 个、69 个安装包资产，约 2.69 GB）
- 本地完整备份：`C:\Users\Administrator\Desktop\workspace\arcade-release-backup`（原始包 + 重建包 + `SHA256SUMS.txt` / `manifest.json`）
- `157e72b`（谁是卧底）已合并 main；3.6.0 发布提交其后，包含四款游戏移除和后台卧底词库。
- 本机无 Python，Unix 包用 `tar.exe` 打包；解压后 `start.sh` 会自愈执行权限，必要时手动 `chmod +x runtime/node start.sh`。

---

## 6. 协作偏好

- **推送前硬性门禁（最高优先级）**：任何代码改动在 `git push` 前必须完成全量测试（`tools/check.js` + `tools/test-all.js --with-ui`，涉及渲染/性能再加 `tools/perf-test.js`），并同步 README / `docs/*.md` / `memory.md` 与对应记忆条目；UI 测试后还原或有意更新 `shots/`。未完成测试和文档同步不得推送。
- 仅文档/记忆改动可以跳过全量测试，但仍需同步 `memory.md`，并说明“本次无代码改动”。
- 推送到 GitHub 镜像同样受本门禁约束；Gitee 是主下载源，GitHub 同时归档代码/tag 与发行包；推送 `v*` tag 会自动触发安装包镜像。
- Gitee 配额策略：默认只保留最近 3 个版本的安装包；旧版本只删附件、不删页面；任何删除前先确认 GitHub 已有归档并征得用户同意。完整说明见 `docs/发版流程.md`「Gitee 附件配额与旧版本清理」。
- 中文交流；非平凡改动先给分阶段方案，由用户选择范围后再执行。
- 严格保持现有功能：允许修 bug、性能/交付/可访问性/安全加固；不改玩法、数值、时长、计分、交互、视觉风格，不破坏零依赖/零构建/离线。
- 重视实际测试与量化结果；未获明确要求不要 commit/push，不擅自改共享配置或删用户文件。

---

## 7. 记忆同步清单

> 同步约定：本文件是实际记忆的合并快照；更新记忆后同步更新本文。若两者不一致，以实际记忆为准。

**USER**（`C:\Users\Administrator\.qoder-cn\memory\`）
- `user-collaboration.md`
- `plan-first-then-execute.md`
- `MEMORY.md`

**PROJECT**（`C:\Users\Administrator\.qoder-cn\projects\C--Users-Administrator-Desktop-workspace\memory\`）
- `project-office-arcade.md`
- `reference-office-arcade.md`
- `feedback-full-test-before-push.md`
- `release-recovery-2026-10-29.md`
- `MEMORY.md`

换机后若 Qoder 记忆目录为空：先读本文件，再按本节重建记忆条目，项目细节按第 1 节读文档。
