# 个人资源门户 · 后端（server/）

FastAPI + SQLAlchemy 2 (async) + asyncpg + PostgreSQL 16 + Meilisearch + argon2id。
实现《详细设计》M0 内核：用户会话（三级角色）、存储抽象（storage_key 原始文件只读）、
扫描 + 上传双入库管道、DB 任务队列（SKIP LOCKED）、Meilisearch 五索引同步。

## 本地开发（基础设施为本机通用容器，不随项目启停）

```bash
# 0) 一次性准备（已就绪可跳过）
#    数据库：复用本机 postgres-dev 容器（宿主 5432），创建 portal 库：
#      docker exec postgres-dev psql -U postgres -c "CREATE DATABASE portal"
#    搜索：独立通用容器 meilisearch-dev（宿主 7700，密钥 dev-meili-master-key，
#      命名卷 meilisearch-dev-data，--restart unless-stopped，其他项目可共用）：
#      docker run -d --name meilisearch-dev --restart unless-stopped -p 7700:7700 \
#        -v meilisearch-dev-data:/meili_data -e MEILI_MASTER_KEY=dev-meili-master-key \
#        -e MEILI_NO_ANALYTICS=true getmeili/meilisearch:v1.11

# 1) 后端（python3.12）
cd server
python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env        # 复制后把 CHANGEME 改成 postgres-dev 实际口令
.venv/bin/uvicorn app.main:app --reload --port 8000    # API + /docs

# 2) 任务 worker（另开终端）
.venv/bin/python -m app.core.worker
```

首次启动自动：Alembic 迁移到 head → 创建引导管理员（`BOOTSTRAP_ADMIN_USERNAME/PASSWORD`，默认 admin/admin1234）→ 初始化 Meili 索引与默认扫描根（`DATA_ROOT/library/{fonts,music,videos,books,images,uploads}`）。

## 数据库迁移（Alembic）

表结构变更统一走 `migrations/`（规划 D 决策，2026-10-07 起）：改 `app/core/models.py` 后生成迁移并在下次启动时自动应用：

```bash
cd server
DATABASE_URL="postgresql+asyncpg://..." .venv/bin/alembic revision --autogenerate -m "说明"   # 与模型对比生成迁移
.venv/bin/alembic upgrade head    # 手动应用（应用启动时也会自动 upgrade head）
```

注意：`migrations/env.py` 经 pydantic-settings 读取 `server/.env`，上述命令需在 `server/` 目录下执行。已有库（历史 create_all 建表）首次接入时执行过一次 `alembic stamp head`，换新库则直接 `upgrade head` 从零建表。

## 全容器部署

`docker compose.yml` 只含本项目 server + worker，通过 `host.docker.internal` 访问上述通用容器：

```bash
docker compose up -d --build
```

## 冒烟（验收标准）

```bash
curl localhost:8000/health
# 注册/登录（cookie 会话）
curl -c jar -X POST localhost:8000/api/auth/register -H 'Content-Type: application/json' \
  -d '{"username":"demo","password":"demo1234"}'
# 访客可浏览列表；带 q 未登录 → 401
curl localhost:8000/api/fonts
curl "localhost:8000/api/fonts?q=思源"        # 401
curl -b jar "localhost:8000/api/fonts?q=思源"  # 命中
# 管理员扫描入库 → 任务消化 → 可搜索可下载
curl -c jar -X POST localhost:8000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin1234"}'
curl -b jar -X POST localhost:8000/api/admin/scan -H 'Content-Type: application/json' -d '{"root_alias":"fonts"}'
curl -b jar localhost:8000/api/admin/jobs?limit=5
curl -b jar "localhost:8000/api/search?q=思源"
```

## 结构

```
server/app/
├── core/        # config/db/models(M0 七表)/storage/fingerprints/security/deps/errors/
│                # registry(扩展名注册)/pipeline(任务处理器)/jobs(SKIP LOCKED)/search(Meili)/worker
├── api/         # auth / assets(浏览·详情·下载·编辑·上传) / tags / search / admin(扫描·任务·设置)
└── domains/     # M1–M5 领域解析器挂载点（parse:font 等已在 pipeline 注册为通用实现）
```

权限矩阵（§4.7）：浏览列表公开；搜索/详情/下载 member；写操作/扫描/上传/设置 admin；
访客列表带 `q` 直接 401。
