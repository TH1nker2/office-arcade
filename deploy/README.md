# 部署指南

三种形态，按“想省事 → 想稳定”排序：

| 形态 | 适合 | 优点 | 代价 |
| --- | --- | --- | --- |
| **A. 直接跑** `node server.js` | 同事之间临时开一局 | 零配置，双击 bat 就行 | 关窗口就停，没有进程守护 |
| **B. nginx 反向代理** | 部门内长期开着 | 统一 80 端口、可加日志/限流 | 多一个 nginx，多一份配置 |
| **C. Docker Compose** ★ | 有 Docker 的服务器 | 两个原生镜像、一条命令起停、数据挂卷 | 房间状态在内存，只能单副本 |

> 关键结论：**应用本身不需要为反代做任何改动**。前端所有请求都是相对路径，
> WebSocket 地址由 `location.host` 推导。

---

## A. 直接跑（最简单）

```bash
node server.js            # 默认 0.0.0.0:8090
node server.js 8091       # 换端口
```

Windows 直接双击 `启动游戏厅.bat`。

---

## B. Linux + systemd + nginx（裸机）

### 1. 放代码

```bash
sudo mkdir -p /opt/office-arcade
sudo cp -r ./* /opt/office-arcade/
sudo useradd -r -s /sbin/nologin arcade
sudo chown -R arcade:arcade /opt/office-arcade
```

推荐 Node **22.5+**（内置 `node:sqlite`）；实测 22.20 与 24.21 都直接可用。
Node 18/20 也能跑，只是会自动回退 JSON 存储（启动日志里会写）。

### 2. 注册服务

```bash
sudo cp deploy/office-arcade.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now office-arcade
systemctl status office-arcade
journalctl -u office-arcade -f
```

服务里已经设置 `HOST=127.0.0.1`，所以 Node 只监听本机，外部只能从 nginx 进来。

### 3. 反向代理

```bash
sudo cp deploy/nginx.conf /etc/nginx/conf.d/office-arcade.conf
sudo vim /etc/nginx/conf.d/office-arcade.conf   # 改 server_name
sudo nginx -t && sudo systemctl reload nginx
```

配置里有两条 `location`：

- `/ws` —— 必须带 `Upgrade` / `Connection: upgrade`，并把 `proxy_read_timeout` 放宽到 1 小时，
  否则大厅连接每 60 秒被掐一次，前端会不停重连
- `/` —— 普通反代，其余交给 Node

---

## C. Docker Compose（两个原生镜像，推荐）

**不构建任何自定义镜像**：`node:24-alpine` 跑服务，`nginx:alpine` 做入口，代码以只读方式挂进容器。

```bash
cd office-arcade
cp .env.example .env        # 可选：改对外端口，默认 8080
docker compose up -d
docker compose ps
docker compose logs -f app
```

浏览器打开 `http://<宿主机IP>:8080`。

```
浏览器 ──8080──▶ nginx:alpine ──app:8090──▶ node:24-alpine
                                              └── ./data:/app/data
```

几个设计点：

- 代码 `.:/app:ro` 只读挂载，容器里改不了宿主机文件；`./data` 单独挂载且可写
- nginx 用 Docker 内置 DNS（`resolver 127.0.0.11`）解析 `app`，容器重建换 IP 也不会 502
- `depends_on: service_healthy`：等 `/api/board` 健康检查通过再启动 nginx
- 对外端口写在 `.env`，不用改 compose 文件
- 应用只放行 `/index.html`、`/css/`、`/js/`、`/shared/`，`/data/arcade.sqlite` 不会被下载

| 操作 | 命令 |
| --- | --- |
| 更新代码 | `git pull && docker compose restart app` |
| 只改 nginx 配置 | `docker compose restart nginx` |
| 看应用日志 | `docker compose logs -f app` |
| 停掉全部 | `docker compose down` |
| 备份数据 | `docker compose stop app && cp data/arcade.sqlite ~/arcade-$(date +%F).sqlite && docker compose start app` |

**离线环境**：先在能联网的机器上 `docker pull node:24-alpine nginx:alpine`，
再 `docker save` 成 tar 拷过去 `docker load`。

**存储**：镜像里的 Node 若没编进 `node:sqlite`，应用会自动回退到 JSON，
启动日志里会打印 `[store] SQLite 不可用…回退到 JSON 存储`，功能不受影响。

---

## D. Windows 常驻

双击 bat 会占用一个控制台窗口，注销就停。想常驻用下面任一种：

**NSSM（推荐）**

```bat
nssm install OfficeArcade "C:\Program Files\nodejs\node.exe" "C:\arcade\server.js"
nssm set OfficeArcade AppDirectory C:\arcade
nssm set OfficeArcade AppEnvironmentExtra HOST=127.0.0.1 PORT=8090
nssm start OfficeArcade
```

**任务计划程序**：触发器选“计算机启动时”，操作填 `node.exe`，参数 `C:\arcade\server.js`，
起始于 `C:\arcade`，勾选“不管用户是否登录都运行”。

Windows 版 nginx 同样适用本目录的 `nginx.conf`，把 `upstream` 端口对上即可。

---

## E. 单容器（可选）

不想用 Compose 时，也可以自己构建一个镜像：

```bash
docker build -f deploy/Dockerfile -t office-arcade .
docker run -d --name arcade -p 127.0.0.1:8090:8090 \
  -v arcade-data:/app/data --restart unless-stopped office-arcade
```

然后自己再配一个 nginx 反代；Compose 方式已经把这两步合在一起了。

**不要** `--scale` 多个副本：房间和在线状态都在进程内存里，多副本会各管各的。

---

## 必读的 5 个坑

1. **必须部署在根路径 `/`**
   前端用的是 `/api/...`、`/js/...`、`/ws` 这类绝对路径。挂到 `/arcade/`
   子路径会 404，除非同时改前端并加 `sub_filter`。

2. **只能跑一个 Node 实例**
   房间、邀请、在线状态都是内存态。要多实例必须先把这些改成共享存储（Redis/DB），
   不要直接上负载均衡。

3. **WebSocket 的 `Upgrade` 头不能丢**
   少了 `proxy_set_header Upgrade $http_upgrade` 和 `Connection "upgrade"`，
   页面能打开但会一直“正在重连”。

4. **别给 js/css 加长缓存**
   更新后用户会拿到旧脚本。应用已经发了 `Cache-Control: no-cache`，
   nginx 这边不要覆盖成 `expires 7d`。

5. **端口与防火墙**
   放 nginx 后面时把 Node 设成 `HOST=127.0.0.1`，只暴露 nginx 的 80 端口；
   Windows 直连模式记得放行对应端口。

---

## 备份与升级

裸机：

```bash
# 备份（停服后拷一个文件即可）
sudo systemctl stop office-arcade
sudo cp /opt/office-arcade/data/arcade.sqlite ~/arcade-$(date +%F).sqlite
sudo systemctl start office-arcade

# 升级：替换代码，保留 data/
sudo rsync -a --exclude data ./ user@host:/opt/office-arcade/
sudo systemctl restart office-arcade
```

Compose：

```bash
docker compose stop app
cp data/arcade.sqlite ~/arcade-$(date +%F).sqlite
docker compose start app
```

SQLite 使用 WAL 模式，运行中直接复制 `arcade.sqlite` 可能拿到不完整快照，
所以建议先停服再拷；或者用 `sqlite3 data/arcade.sqlite ".backup backup.sqlite"` 在线备份。
