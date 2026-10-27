# OFFICE ARCADE · MEMORY

> Qoder 项目记忆快照，用于换机/丢失工作区后快速恢复上下文。
> **最后同步**：2026-10-28
> **仓库**：https://gitee.com/th1nker/office-arcade.git
> **本地路径**：`C:\Users\Administrator\Desktop\workspace\office-arcade`
> **基线**：`main` 分支，提交 `18c87e4`（版本 3.4.1）
> **当前状态（最后同步时）**：有一轮“全面版”优化未提交/未推送；本文件也未跟踪。

---

## 1. 文档位置（项目知识以此为准）

项目架构、业务流程、九款游戏、存储、接口、测试、部署等细节**不在这里重复**，按需要读：

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
5. 检查 `git log -1` 与本文基线是否一致。

> **重要**：若换机前没有 `git push`，本轮优化代码和本文件都不会随 clone 恢复；本文件只能恢复决策记忆，代码需提交/patch 或按第 4 节重做。

---

## 3. 当前工作区状态（会话记忆）

- 基线 `18c87e4`（v3.4.1）之上有一轮未提交优化，涉及服务端、前端、测试、文档和发版脚本。
- 本地额外文件：`runtime/`（Node 运行时）、`admins.json`（测试管理员）、`vendor/_cache`（运行时下载缓存），均被 `.gitignore` 排除。
- UI 测试会改写 `shots/*.png`；跑完应 `git checkout -- shots/` 还原，除非明确要更新截图。
- 本轮验证：`tools/test-all.js --with-ui` 19 个脚本全部通过（约 180s）；`bot-test` 连跑 10 次通过；首屏 gzip 后约 103 KB，snake/tank/shmup headless RAF p95 16.7ms。
- 未获用户明确要求不要 commit/push。

---

## 4. 2026-10-28 优化记录（文档之外的新增信息）

### P0 正确性
- 炸弹人连锁爆炸后倒序循环越界崩溃：`shared/games/bomber.js` 加判空；`game-test` 增加双炸弹连锁回归。
- 飞行棋玩家退场后起跑格按当前人数重排，导致剩余棋子瞬移、回合错位：`shared/games/ludo.js` 把起跑格冻结到 `player.start`，快照新增 `st`，渲染器按 `st`/id 取位置和颜色；`game-test` + `ui-v3` 覆盖。
- 畸形 Cookie 导致 WS 升级解析抛异常：`server/http-utils.js` 容错。
- `start` 仅允许 `lobby` 阶段（`server/ws.js`、`server/rooms.js`）。
- 后台标签页停止发送输入并重置键鼠状态（`js/main.js`）。

### P1 性能/交付
- 静态资源：gzip + 弱 ETag + `no-cache` 重验证；CSP 与安全响应头；API 保持 `no-store`（`server/http.js`、`server/http-utils.js`）。
- Canvas 光晕改为离屏 sprite 缓存（`js/render/common.js`），减少每帧径向渐变；尊重 `prefers-reduced-motion`。
- HUD 10Hz 更新、计时文本变化才写；大厅渲染按 key 跳过无变化重建（`js/ui.js`、`js/ui/game-ui.js`、`js/ui/lobby-room.js`）。
- 新增 `tools/perf-test.js`：首屏 transferSize + RAF 基线。

### P2 维护/工具/发版
- 修正 `server.js` WS 协议注释、ludo/shmup 过期注释；删除 `MAX_ROOM`、ludo 死循环、无用参数。
- 新增 `tools/check.js`、`tools/test-all.js`、`tools/regression-test.js`，并补充 `package.json` scripts。
- `publish-release.ps1` 在 `dist/release-notes.md` 缺失时按 `version.json` 自动生成；`build-release.ps1` 修正便携版启动器文案，`-Edition standard` 显式报错（标准版数据目录未实现）。

### P3 可访问性/安全
- 新增 `js/ui/a11y.js`：覆盖层 ARIA、打开聚焦、Tab 陷阱、关闭归还焦点；玩家行支持键盘打开菜单，菜单支持方向键/Home/End/Enter；全局 `:focus-visible`、减少动效 CSS。
- 管理后台弹窗焦点管理 + Esc + Tab 陷阱。
- 登录失败限流（同 IP + 用户名 60s 内最多 8 次失败）；管理员密码 timing-safe。
- 改密保留当前会话、失效其他会话；管理员重置密码/封禁删除旧会话并踢人；封禁用户 HTTP 接口立即 401。
- 新增 `ui-v7`、`admin-words-ui` 弹窗焦点、auth/admin/hardening 相关断言。

---

## 5. 记忆同步清单

> 同步约定：本文件是实际记忆的合并快照；更新记忆后同步更新本文。若两者不一致，以实际记忆为准。

**USER**（`C:\Users\Administrator\.qoder-cn\memory\`）
- `user-collaboration.md`
- `plan-first-then-execute.md`
- `MEMORY.md`

**PROJECT**（`C:\Users\Administrator\.qoder-cn\projects\C--Users-Administrator-Desktop-workspace\memory\`）
- `project-office-arcade.md`
- `reference-office-arcade.md`
- `MEMORY.md`

换机后若 Qoder 记忆目录为空：先读本文件，再按第 5 节重建记忆条目，项目细节按第 1 节读文档。

---

## 6. 协作偏好

- 中文交流；非平凡改动先给分阶段方案，由用户选择范围后再执行。
- 严格保持现有功能：允许修 bug、性能/交付/可访问性/安全加固；不改玩法、数值、时长、计分、交互、视觉风格，不破坏零依赖/零构建/离线。
- 重视实际测试与量化结果；未获明确要求不要 commit/push，不擅自改共享配置或删用户文件。
