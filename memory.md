# OFFICE ARCADE · MEMORY

> Qoder 项目记忆快照，用于换机/丢失工作区后快速恢复上下文。
> **最后同步**：2026-10-29
> **仓库**：https://gitee.com/th1nker/office-arcade.git
> **本地路径**：`C:\Users\Administrator\Desktop\workspace\office-arcade`
> **版本**：3.6.0（2026-10-29）
> **当前分支**：`main`；3.6.0 发布提交 `4c08b56`（tag `v3.6.0`）
> **当前状态**：3.6.0 发布内容——已移除蛇球大作战、炸弹人、极速环线、飞行棋，剩余六款：坦克竞技场、俄罗斯方块对战、合作弹幕、你画我猜、五子棋、谁是卧底；管理后台新增「谁是卧底词库」。

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

---

## 3. 当前工作区状态（会话记忆）

- `main` HEAD `157e72b`：`feat: 新增谁是卧底并扩展为十款游戏`（该提交已把谁是卧底合并进 main）。
- 当前工作区在 `main` 上，已删除四款游戏的全部源码、渲染器、测试引用和截图；**未提交、未推送**。
- 移除的四款：蛇球大作战、炸弹人、极速环线、飞行棋。
- 剩余六款：坦克竞技场、俄罗斯方块对战、合作弹幕、你画我猜、五子棋、谁是卧底。
- 已同步 README、`docs/开发手册.md`、`docs/发版流程.md`、`memory.md` 与测试；谁是卧底截图 `shots/89`~`94` 保留。
- 全量验证：`tools/test-all.js --with-ui` **21 个脚本全部通过（220.0s）**；`perf-test` 通过（首屏 gzip 后 106.8 KB，tank/tetris/shmup headless RAF p95 16.7ms）。
- 管理后台新增「谁是卧底词库」页签：`GET /api/admin/undercover-words` 返回 120 对、10 个分类；支持分类筛选和搜索；截图 `shots/82b-admin-undercover.png`。
- UI 测试会改写 `shots/*.png`；本次已删除四款游戏的旧截图，保留六款游戏对应的新截图。
- 本地额外文件：`runtime/`（Node 运行时）、`admins.json`（测试管理员）、`vendor/_cache`（运行时下载缓存），均被 `.gitignore` 排除。
- 本次按用户要求执行提交、推送与 3.6.0 发布。

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

- **v3.6.0 三平台发行版已发布**：https://gitee.com/th1nker/office-arcade/releases/tag/v3.6.0
  - tag `v3.6.0` → `4c08b56`（release id 1251446）
  - 附件：win-x64.zip、linux-x64.tar.gz、darwin-arm64.tar.gz + Gitee 自动源码归档
  - 发布说明由 `version.json` 生成；旧版发行版页面保留，未清理
- v3.5.0 历史发行版：https://gitee.com/th1nker/office-arcade/releases/tag/v3.5.0（tag `v3.5.0` → `b8d250e`，十款版本）
- `157e72b`（谁是卧底）已合并 main；3.6.0 发布提交其后，包含四款游戏移除和后台卧底词库。
- 本机无 Python，Unix 包用 `tar.exe` 打包；解压后 `start.sh` 会自愈执行权限，必要时手动 `chmod +x runtime/node start.sh`。

---

## 6. 协作偏好

- **推送前硬性门禁（最高优先级）**：任何代码改动在 `git push` 前必须完成全量测试（`tools/check.js` + `tools/test-all.js --with-ui`，涉及渲染/性能再加 `tools/perf-test.js`），并同步 README / `docs/*.md` / `memory.md` 与对应记忆条目；UI 测试后还原或有意更新 `shots/`。未完成测试和文档同步不得推送。
- 仅文档/记忆改动可以跳过全量测试，但仍需同步 `memory.md`，并说明“本次无代码改动”。
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
- `MEMORY.md`

换机后若 Qoder 记忆目录为空：先读本文件，再按本节重建记忆条目，项目细节按第 1 节读文档。
