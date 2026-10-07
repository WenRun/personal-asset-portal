# 部署指南 · 飞牛 NAS（fnOS）Docker 部署

> 适用：fnOS NAS（192.168.31.31，SSH 已开放、Docker 已安装），已存在 NGINX / PostgreSQL(13+) / Meilisearch 独立容器且同一 Docker 网络。
> 部署物对应：`docker-compose.yml`（生产拓扑）、`.env.example`、`web/Dockerfile`、`deploy/nginx-portal.conf`、`deploy/backup.sh`（2026-10-07 定稿，决策记录见规划文档 §15-8）。
> 本文按 **SSH + 命令行**主线编写（fnOS 的 Docker 图形界面可用来看容器/日志，但 compose build 类项目建议命令行操作，UI 各版本对 build 支持不一）。

---

## 0. 前置确认（5 分钟）

SSH 登录 NAS（Windows 用 PowerShell `ssh 用户名@192.168.31.31`，Mac/Linux 同理；用户名是 fnOS 管理员账号）：

```bash
# 1) 三样依赖都在、都在同一网络
docker ps --format '{{.Names}}\t{{.Image}}\t{{.Networks}}'
docker network ls

# 记下：NGINX/PG/Meili 容器各自所在的网络名（以 nginx 容器为准最保险）
docker inspect <nginx容器名> -f '{{json .NetworkSettings.Networks}}' | python3 -m json.tool
# 或没有 python 时：docker inspect <nginx容器名> | grep -A6 Networks

# 2) PG 版本 ≥ 13（gen_random_uuid 为内置）
docker exec <pg容器名> psql -U postgres -c "SELECT version();"

# 3) Meili 的 master key（compose 的 MEILI_MASTER_KEY 必须与它一致）
docker inspect <meili容器名> | grep -i MEILI_MASTER_KEY
```

要记下的四样：**网络名、PG 容器名、PG 的 postgres 口令、Meili master key**。

---

## 1. 把代码弄到 NAS

⚠️ **先解决版本问题**：GitHub 上的 `WenRun/personal-asset-portal` 停在旧版本，本地 main 领先远程 **27 个提交**（含全部功能补全与部署接线）。直接 clone 会拿到旧代码。

**方案 A（推荐，方便以后更新）——先推送再 clone：**

```bash
# 在开发机（当前这台 Mac）上：
cd ~/Workspace/personal-asset-portal
git push origin main          # 首次推送如被拒，按提示 git pull --rebase 后再推

# 在 NAS 上：
mkdir -p /vol1/docker && cd /vol1/docker    # 目录按你的习惯调整，下文以此为准
git clone https://github.com/WenRun/personal-asset-portal.git asset-portal
cd asset-portal
```

仓库若是私有，clone 时输 GitHub 用户名 + Personal Access Token（GitHub → Settings → Developer settings → Tokens）。

**方案 B（不推送）——打包上传：** 开发机 `git archive -o portal.zip HEAD`，经 fnOS 文件管理器/SMB 上传解压到 `/vol1/docker/asset-portal`。以后每次更新都要重复此步，略麻烦。

---

## 2. 初始化数据库（一次）

在 PG 容器里建 portal 库与专用用户（口令自定，下文与 .env 保持一致）：

```bash
docker exec -it <pg容器名> psql -U postgres -c "CREATE USER portal WITH PASSWORD '你的强口令';"
docker exec -it <pg容器名> psql -U postgres -c "CREATE DATABASE portal OWNER portal;"
```

> 库表不用手动建：server 首次启动会自动执行 Alembic 迁移（21 张表）并创建引导管理员。

Meili 无需初始化：server 启动时自动建五个索引；`MEILI_MASTER_KEY` 填第 0 步查到的值即可。

---

## 3. 配置 .env

```bash
cd /vol1/docker/asset-portal
cp .env.example .env
vi .env    # 或 fnOS 文件管理器里编辑
```

按注释逐项填写，关键几项（示例值换成你第 0 步记下的实际值）：

| 变量 | 填什么 | 示例 |
|---|---|---|
| `DOCKER_NETWORK` | 第 0 步记下的网络名 | `fnos-net` |
| `PG_HOST` / `PG_DB` / `PG_USER` / `PG_PASSWORD` | PG 容器名 / 库名 / 用户 / 口令（与第 2 步一致） | `postgres` / `portal` / `portal` / `…` |
| `MEILI_HOST` / `MEILI_MASTER_KEY` | Meili 容器名 / master key | `meilisearch` / `…` |
| `BOOTSTRAP_ADMIN_PASSWORD` | 门户管理员初始口令（仅首次建号用） | 强口令 |
| `PUBLIC_ORIGIN` | 局域网访问地址（与第 5 步 NGINX 端口一致） | `http://192.168.31.31:8080` |
| `COOKIE_SECURE` | **纯局域网 HTTP 必须 false**（true 时浏览器会丢弃 cookie，无法登录） | `false` |

> 将来上 HTTPS（反代加证书 + 域名）后，把 `PUBLIC_ORIGIN` 改为 https 地址、`COOKIE_SECURE` 改回 true，`docker compose up -d` 重建即可。

---

## 4. （推荐）让资源文件落在 NAS 磁盘上

默认 `portal_data` 是 Docker 命名卷，媒体文件存在卷里，不方便 SMB 直接拷贝和用 NAS 自带工具备份。**推荐改成 bind mount**——编辑 `docker-compose.yml`，把 server 与 worker 两个服务的

```yaml
    volumes:
      - portal_data:/data
```

都改为：

```yaml
    volumes:
      - ./data:/data        # 与 compose 同目录的 data/，即 /vol1/docker/asset-portal/data
```

并删除文件末尾的 `volumes: portal_data:` 段。之后五个资源根就是这些目录（**首次部署前先创建**）：

```bash
mkdir -p data/library/{fonts,music,videos,books,images,uploads}
```

这样你可以通过 fnOS 的 SMB 共享直接把字体/音乐/照片拷进对应目录，再到门户「设置 → 扫描根目录」触发扫描；也可以用 NAS 的备份工具直接备份 `data/` 目录。

不想改就用默认命名卷，功能完全一样，只是文件都在卷里（备份方式见 §7）。

---

## 5. 构建并启动

```bash
cd /vol1/docker/asset-portal
docker compose up -d --build
```

首次构建约几分钟（前端 node 构建 + python 依赖）。构建产物有缓存，之后更新很快。

启动后检查（三个容器都应是 running）：

```bash
docker compose ps
docker compose logs portal-server | tail -30
```

portal-server 日志里依次应看到：Alembic 迁移执行（首次 `Running upgrade -> e256f2a718d5`）、`bootstrap admin created`（首次）、Meili 索引就绪；没有 ERROR 即正常。

不经过 NGINX 的容器内自检：

```bash
docker compose exec portal-server curl -s localhost:8000/health   # {"ok":true}
```

---

## 6. NGINX 站点接入（你的 NGINX 容器）

`deploy/nginx-portal.conf` 是现成样例，改两处后并入你的 NGINX 配置：

1. `listen 443 ssl` → 局域网先改 `listen 8080;`（端口随意，与 `PUBLIC_ORIGIN` 一致）；`server_name portal.example.com` → `_`（或 IP）；
2. 删掉证书相关行（HTTP 阶段不需要）。

落到你 NGINX 容器的方式取决于它现有配置的组织：

- **挂载 conf.d 目录的**：把改好的文件放进宿主机对应目录（如 `xxx/nginx/conf.d/portal.conf`），容器内 `nginx -t && nginx -s reload`（或重启 NGINX 容器）。
- **单个 nginx.conf 的**：把 server 块内容粘进 http 段。
- 该配置已包含三个关键点：`client_max_body_size 8g`（否则网页上传 413）、SSE location `proxy_buffering off`（任务中心实时刷新）、音视频 Range 流透传（默认支持，无需配置）。

完成后浏览器打开 `http://192.168.31.31:8080` → 用 admin + 你在 `.env` 里设的 `BOOTSTRAP_ADMIN_PASSWORD` 登录。

---

## 7. 部署验证清单

登录后逐项过（对应核心链路）：

| 验证点 | 操作 | 预期 |
|---|---|---|
| 登录 | admin 登录 | 进入仪表盘 |
| 上传入库 | 右上角上传一个小字体/图片 | toast「已入库」；任务中心任务链 queued→running→done **实时刷新**（SSE 通了） |
| 目录扫描 | SMB 拷几个文件进 `data/library/images/`，设置页触发扫描 | 文件出现在图片墙 |
| 搜索 | ⌘K 搜文件名 | 五索引命中 |
| 播放/预览 | 点一首歌播放、打开歌词 | 播放条出声、歌词面板高亮 |
| 打包 | 图片页批量选 2 张 → 加入打包 | 工具箱出现可下载 ZIP |
| 分享 | 详情页生成分享链接 | 无痕窗口打开可预览 |
| 权限 | 无痕窗口不登录浏览 | 仅见列表，搜索/详情/下载被拦 |

---

## 8. 日常运维

**更新版本**（方案 A 的情况下）：

```bash
cd /vol1/docker/asset-portal
git pull
docker compose up -d --build     # 数据库迁移在 server 启动时自动执行
```

> 若用「git archive | tar」方式同步代码（本机推送给 NAS 的等价流程）：fnOS 下 tar 解包可能出现 `d---------`（000）目录权限，导致 fnOS 文件管理打不开目录、看不到资源文件夹。同步后执行一次 `chmod -R u+rwX,go+rX <项目目录>` 即可（2026-10-07 实机踩过）。

**备份**（`deploy/backup.sh`，容器化 PG 模式）：

```bash
PG_CONTAINER=<pg容器名> PG_USER=portal BACKUP_DIR=/vol1/docker/backups ./deploy/backup.sh
# library 在 bind mount 模式下：LIBRARY_DIR=/vol1/docker/asset-portal/data/library 会自动同步
# 命名卷模式下：导出命令见脚本头注释
```

**日志**：`docker compose logs -f portal-server`（或 fnOS Docker UI → 容器 → 日志）。

**常见问题**：

| 症状 | 原因 | 处理 |
|---|---|---|
| 上传报 413 | NGINX 未配 `client_max_body_size` | 按第 6 步样例配置 |
| 登录后立即又变未登录 | HTTP 下 `COOKIE_SECURE=true` | `.env` 改 false 后 `docker compose up -d` |
| 任务中心不实时刷新、要等很久 | NGINX 缓冲了 SSE | 确认 `/api/` location 有 `proxy_buffering off` |
| server 起不来报连不上 PG/Meili | 网络名/容器名不对，或依赖容器不在该网络 | `docker inspect` 核对第 0 步信息 |
| 首次构建 npm 失败/超时 | NAS 内存/网络波动 | 重试；或在本机构建后 `docker save/load` 迁移镜像 |
