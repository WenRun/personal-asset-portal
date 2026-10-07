# 个人资源管理门户 · 详细设计文档（LLD）

> 版本 v0.1 · 2026-10-05
> 配套文档：《总体规划设计》v0.3（[personal-asset-portal-plan.md](./personal-asset-portal-plan.md)）
> 关系：规划文档定结论，本文给实现级细节（表结构 / 接口签名 / 端点清单 / 时序 / 目录规范）。两者冲突时以规划结论为准，并回改本文。
> 阅读指引：M0 实现 §2–§4、§6、§8；M1–M5 分别实现 §5.5、§5.1、§5.4、§5.2、§5.3；M6 收尾 §9–§11。

---

## 1. 系统上下文与运行架构

### 1.1 进程与部署模型

> 2026-10-07 拓扑定稿：生产环境 NGINX / PostgreSQL / Meilisearch 均为既有独立容器且同一 Docker 网络，
> 门户 compose 分组（server / worker / web）以 external network 接入，统一由 **NGINX 反代**（不引入 Caddy）。

```mermaid
graph LR
    subgraph 既有容器（用户环境）
        NGINX[NGINX<br/>TLS 入口 + 反代]
        PG[(postgres 13+)]
        MEILI[(meilisearch)]
    end
    subgraph Docker Compose（portal 分组）
        API[portal-server<br/>uvicorn → FastAPI :8000]
        WORKER[portal-worker<br/>python -m app.core.worker]
        WEB[portal-web<br/>nginx:alpine 静态 + SPA 回退]
    end
    USER[浏览器] --> NGINX
    NGINX -->|/api/| API
    NGINX -->|/| WEB
    API --> PG
    API --> MEILI
    WORKER --> PG
    WORKER --> MEILI
    WORKER -.->|ffmpeg / Pillow / fontTools| FS[(portal_data 卷)]
    API -.->|流式读写| FS
```

- `portal-server` 与 `portal-worker` 用同一个镜像、不同启动命令，**共享 `portal_data` 卷**（worker 写派生物、server 读）。
- `portal-web` 多阶段构建（node 构建 → nginx:alpine 托管 dist）：SPA 回退 + 带哈希产物 immutable 缓存；构建时 `VITE_API_BASE` 必须留空走同源相对路径，否则请求会回落到开发地址。
- NGINX 侧要点（样例见 `deploy/nginx-portal.conf`）：`/api/` 反代 + `client_max_body_size` 对齐上传上限（默认 1MB 会 413）+ SSE location 关闭 `proxy_buffering`；`/` 反代到 portal-web。音视频 Range 流默认透传。
- 一期 worker 并发 = 2（环境变量可调）；`server` 单进程 + 异步 IO，以 `--proxy-headers` 启动信任反代链路头。
- 资源根目录统一挂载到容器 `/data/library/<alias>/`，派生物在 `/data/derived/`。

### 1.2 配置清单（环境变量）

| 变量 | 默认 | 说明 |
|---|---|---|
| `DATABASE_URL` | — | `postgresql+asyncpg://portal:***@postgres:5432/portal` |
| `MEILI_URL` / `MEILI_MASTER_KEY` | — | Meilisearch 地址与密钥 |
| `DATA_ROOT` | `/data` | 库根目录（含 `library/`、`derived/`） |
| `BOOTSTRAP_ADMIN_USERNAME` / `BOOTSTRAP_ADMIN_PASSWORD` | — | 首次启动创建 admin，已存在则跳过 |
| `SESSION_TTL_DAYS` | `30` | 会话滑动过期 |
| `WORKER_CONCURRENCY` | `2` | worker 线程并发数 |
| `MAX_UPLOAD_GB` | `8` | 单文件上传上限 |

运行期可变配置存数据库 `settings` 表（管理端修改，无需重启）：`scan_roots`（`[{alias, path, types}]`）、`registration_open`、`font_preview_text`、`list_page_size`。

---

## 2. 数据库详细设计

命名规范：表名复数小写下划线；主键 `id UUID`；时间一律 `TIMESTAMPTZ`；软删只用 `assets.deleted_at`。

### 2.1 用户与鉴权

```sql
CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username      TEXT NOT NULL UNIQUE CHECK (char_length(username) BETWEEN 2 AND 32),
    password_hash TEXT NOT NULL,                    -- argon2id（passlib）
    role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,    -- 停用后所有会话立即失效
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at TIMESTAMPTZ
);

CREATE TABLE sessions (
    id         TEXT PRIMARY KEY,                    -- secrets.token_urlsafe(32)
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
-- 登录：校验密码 → upsert session → Set-Cookie portal_session=...; HttpOnly; SameSite=Lax; Secure; Max-Age=30d
-- 每次请求校验：session 存在且未过期且 user.is_active，否则按未登录处理；滑动续期（距过期 <7d 时刷新）
```

### 2.2 资产内核

```sql
CREATE TABLE assets (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_type  TEXT NOT NULL CHECK (asset_type IN ('font','music','video','book','image')),
    status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','parsing','ready','failed')),   -- 入库状态机（§4.2）
    title       TEXT NOT NULL DEFAULT '',
    storage_key TEXT NOT NULL,                     -- 格式 "{root_alias}:{相对路径}"，如 "fonts:serif/Noto.ttf"
    file_name   TEXT NOT NULL,
    size_bytes  BIGINT NOT NULL CHECK (size_bytes >= 0),
    file_mtime  BIGINT NOT NULL DEFAULT 0,         -- epoch 纳秒，扫描变更检测用
    mime_type   TEXT,
    fingerprint TEXT NOT NULL,                     -- "sha256:<hex>" 或 "quick:<size>-<mtime>-<hash>"（§4.2）
    meta        JSONB NOT NULL DEFAULT '{}',
    rating      SMALLINT CHECK (rating BETWEEN 0 AND 5),
    note        TEXT,
    is_favorite BOOLEAN NOT NULL DEFAULT FALSE,
    deleted_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (storage_key)
);
CREATE INDEX idx_assets_list   ON assets(asset_type, deleted_at, created_at DESC, id DESC);
CREATE INDEX idx_assets_fp     ON assets(fingerprint);
CREATE INDEX idx_assets_status ON assets(status) WHERE status <> 'ready';
CREATE INDEX idx_assets_meta   ON assets USING GIN (meta jsonb_path_ops);
CREATE INDEX idx_assets_alive  ON assets(deleted_at) WHERE deleted_at IS NULL;

CREATE TABLE tags (
    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name      TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 32),
    parent_id UUID REFERENCES tags(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX uq_tag_sibling ON tags(COALESCE(parent_id,'00000000-0000-0000-0000-000000000000'::uuid), name);
CREATE TABLE asset_tags (
    asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    tag_id   UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (asset_id, tag_id)
);
CREATE INDEX idx_asset_tags_tag ON asset_tags(tag_id);

CREATE TABLE settings (
    key        TEXT PRIMARY KEY,
    value      JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- **递归查询**：标签树用 `WITH RECURSIVE tag_tree AS (...)` 展开；同级同名靠上面的函数唯一索引约束。
- **重复检测**：`SELECT fingerprint FROM assets WHERE deleted_at IS NULL GROUP BY fingerprint HAVING count(*) > 1`。

### 2.3 领域扩展表

```sql
-- 视频：系列 + 技术详情
CREATE TABLE video_series (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    cover_path  TEXT                                -- 派生物路径，取首集封面
);
CREATE TABLE video_details (
    asset_id    UUID PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL CHECK (kind IN ('clip','tutorial')),
    series_id   UUID REFERENCES video_series(id) ON DELETE SET NULL,
    episode     SMALLINT,
    duration_ms INT,
    width INT, height INT,
    container   TEXT, video_codec TEXT, audio_codec TEXT,
    cover_path  TEXT                                -- 手动换封面后覆盖自动值
);
CREATE INDEX idx_video_series_order ON video_details(series_id, episode);

-- 字体
CREATE TABLE font_details (
    asset_id     UUID PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
    family       TEXT NOT NULL,
    style        TEXT,
    weight       SMALLINT,                          -- OS/2 usWeightClass 100-900
    italic       BOOLEAN NOT NULL DEFAULT FALSE,
    is_variable  BOOLEAN NOT NULL DEFAULT FALSE,
    formats      TEXT[] NOT NULL DEFAULT '{}',      -- 该 family 内此文件的格式
    glyph_count  INT,
    languages    TEXT[] NOT NULL DEFAULT '{}',      -- 由 cmap 覆盖推断：latin/cjk-hans/...
    license      TEXT, version TEXT, designer TEXT
);
CREATE INDEX idx_font_family ON font_details(family);

-- 音乐：艺术家 / 专辑 / 曲目 三级
CREATE TABLE music_artists (
    id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE
);
CREATE TABLE music_albums (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    artist_id  UUID REFERENCES music_artists(id) ON DELETE SET NULL,
    name       TEXT NOT NULL,
    year       SMALLINT,
    cover_path TEXT,
    UNIQUE (artist_id, name)
);
CREATE TABLE music_tracks (
    asset_id       UUID PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
    album_id       UUID REFERENCES music_albums(id) ON DELETE SET NULL,
    artist_id      UUID REFERENCES music_artists(id) ON DELETE SET NULL,
    track_no SMALLINT, disc_no SMALLINT,
    duration_ms INT,
    format TEXT, bitrate_kbps INT, sample_rate_hz INT, has_lyrics BOOLEAN DEFAULT FALSE
);
CREATE INDEX idx_tracks_album ON music_tracks(album_id, disc_no, track_no);

-- 书籍
CREATE TABLE book_details (
    asset_id     UUID PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
    authors      TEXT[] NOT NULL DEFAULT '{}',
    publisher TEXT, pub_year SMALLINT, isbn TEXT,
    series_name TEXT, series_index SMALLINT,
    language TEXT,
    format TEXT CHECK (format IN ('epub','pdf','mobi','azw3'))
);

-- 图片
CREATE TABLE image_details (
    asset_id UUID PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
    taken_at TIMESTAMPTZ,
    camera_make TEXT, camera_model TEXT, lens TEXT,
    iso INT, aperture NUMERIC(5,2), shutter TEXT, focal_length_mm NUMERIC(6,2),
    gps_lat NUMERIC(9,6), gps_long NUMERIC(9,6),
    orientation SMALLINT, width INT, height INT
);
CREATE TABLE image_albums (
    id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name   TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('directory','manual')),
    dir_path TEXT                                            -- source=directory 时非空
);
CREATE TABLE image_album_items (
    album_id UUID NOT NULL REFERENCES image_albums(id) ON DELETE CASCADE,
    asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    PRIMARY KEY (album_id, asset_id)
);

-- 用户进度（视频观看 / 书籍阅读 共用）
CREATE TABLE user_progress (
    user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    asset_id  UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    position  JSONB NOT NULL,      -- 视频 {"seconds": 123} / 书 {"locator": "...", "percent": 42.5}
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, asset_id)
);

-- 下载打包
CREATE TABLE download_packs (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status     TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed')),
    params     JSONB NOT NULL,       -- {"asset_ids":[...]} 或 {"filters":{...}}
    file_path  TEXT,
    error      TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 2.4 `meta` JSONB 与列的字段分配原则

进列（扩展表）：筛选/排序高频字段（上方 DDL 已列）。进 `meta`：展示低频与原始兜底数据。各类型 `meta` 约定：

| 类型 | meta 内容示例 |
|---|---|
| font | `name_table_raw`（原始 name 记录）、`units_per_em`、`variable_axes`（`[{tag,min,max,default}]`） |
| music | `lyrics`（LRC 文本）、`encoder`、`original_filename_tags` |
| video | `streams_raw`（ffprobe 原始输出节选）、`recognized_pattern`（命中的系列识别规则）、`need_confirm`（系列识别存疑标记） |
| book | `epub_opf_raw`、`toc`（目录大纲） |
| image | `exif_raw`（完整 EXIF 字典）、`live_photo_pair_key` |

---

## 3. 存储抽象

```python
class StorageProvider(Protocol):
    def stat(self, key: str) -> FileStat:                 # size / mtime_ns / is_dir
    def open(self, key: str) -> BinaryIO:                 # 解析器读取
    def iter_files(self, root_alias: str, extensions: Iterable[str]) -> Iterator[FileStat]
    def stream_range(self, key: str, start: int | None, end: int | None) -> StreamingResponse
    def save(self, key: str, fileobj: BinaryIO) -> None   # 仅上传暂存区使用
    def delete(self, key: str) -> None                    # 仅 purge 且用户勾选“删原始文件”时调用

class LocalStorage:  # 一期唯一实现
    """storage_key = '{root_alias}:{relative_path}'，root_alias 在 settings.scan_roots 中注册。
    所有路径必须 resolve 后校验前缀在 DATA_ROOT 内，拒绝 '..' 与符号链接逃逸（防路径穿越）。"""
```

- 解析器、预览、下载**只拿 `storage_key`**，不接触绝对路径。
- 上传暂存区固定 `uploads:staging/{yyyy-mm}/{uuid}.{ext}`，解析通过后即视为正式资产（文件不搬移，暂存区本身注册为一个 scan root）。

### 3.1 指纹（fingerprint）策略

| 条件 | 策略 | 前缀 |
|---|---|---|
| size ≤ 512MB（字体/音乐/书籍/大多数图片） | 全文件 SHA-256 | `sha256:` |
| size > 512MB（视频为主） | `size + mtime_ns + 首尾各 1MB 的 SHA-256` | `quick:` |

大文件秒传与去重以 `storage_key` 精确匹配为准，`quick:` 指纹仅作疑似重复提示。

---

## 4. 内核机制详细设计

### 4.1 工程目录（server 侧细化）

```
server/app/
├── core/
│   ├── config.py          # pydantic-settings：读环境变量
│   ├── db.py              # asyncpg 引擎、session 依赖
│   ├── storage.py         # StorageProvider + LocalStorage + key 解析/校验
│   ├── fingerprints.py
│   ├── auth/              # security.py(哈希) / deps.py(require_member, require_admin, get_current_user)
│   ├── scanner.py         # 目录扫描 → 变更检测 → 登记 + 派任务
│   ├── pipeline.py        # 状态机流转、parse 分发（按扩展名查 Parser 注册表）
│   ├── jobs.py            # enqueue / claim / retry / 完成回调
│   ├── worker.py          # 独立进程入口：线程池循环
│   ├── search.py          # Meili 客户端、文档构建、增量/全量同步
│   ├── downloads.py       # 流式下载、打包任务
│   └── events.py          # 进程内事件总线 → SSE
├── domains/
│   ├── fonts/    parser.py specimen.py charset.py schemas.py router.py
│   ├── music/    parser.py library.py(艺术家专辑聚合) router.py
│   ├── videos/   parser.py series.py(系列识别) router.py
│   ├── books/    parser.py router.py
│   └── images/   parser.py thumbs.py albums.py router.py
├── api/
│   ├── deps.py
│   ├── errors.py          # 统一异常 → {code, message, detail}
│   └── v1.py              # 路由聚合
└── main.py
```

### 4.2 入库管道与状态机

```
                    ┌─────────┐   parse 失败重试 3 次耗尽
 scan 发现 / 上传 → │ pending │ ──→ parsing ──→ ready
                    └─────────┘        │
                         ↑      failed ←┘（任务中心可重跑 → parsing）
```

1. **发现**：`scan_root` 任务遍历 `iter_files(root, 注册的扩展名全集)`；按 `storage_key` 查库：
   - 不存在 → 建 `assets(status=pending)` + 入队 `fingerprint`；
   - 存在但 `file_mtime/size_bytes` 变化 → 更新列 + 重入队 `fingerprint`（fingerprint 变了则标记旧资产 `meta.superseded_by`）；
   - 无变化 → 跳过。
2. **fingerprint 任务**：按 §3.1 策略计算，写回，入队 `parse:{type}`。
3. **parse 任务**：调对应 Parser → 写 `title / meta / 扩展表` → 产出派生任务（`derive:*`）与 `index_meili` → `status=ready`。
4. **Parser 注册表**：`PARSERS: dict[str, Parser]`，键为扩展名小写（`.ttf/.otf/.woff/.woff2 → FontParser`，`.mp3/.flac/.m4a/.ogg/.wav → MusicParser`，`.mp4/.mkv/.mov/.webm/.avi → VideoParser`，`.epub/.pdf/.mobi/.azw3 → BookParser`，`.jpg/.jpeg/.png/.webp/.gif/.heic → ImageParser`）。

```python
@dataclass
class ParseResult:
    title: str
    meta: dict
    detail: dict                      # 对应扩展表的列
    relations: dict                   # music: {"artist":..., "album":...} / video: {"series":..., "episode":n}
    derived_jobs: list[DeriveSpec]    # (kind, params, priority)

class Parser(Protocol):
    extensions: ClassVar[tuple[str, ...]]
    def parse(self, asset_id: UUID, stream_factory: Callable[[], BinaryIO]) -> ParseResult: ...
```

### 4.3 任务系统（DB 队列）

```sql
CREATE TABLE jobs (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind       TEXT NOT NULL,
    payload    JSONB NOT NULL,
    status     TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed')),
    priority   SMALLINT NOT NULL DEFAULT 5,      -- 数字越小越优先：1 浏览触发 / 5 批量派生 / 8 索引
    attempts   SMALLINT NOT NULL DEFAULT 0,
    last_error TEXT,
    run_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    worker_id  TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ
);
CREATE INDEX idx_jobs_claim ON jobs(status, priority, run_at);
```

worker 主循环（每线程）：

```python
JOB = """
UPDATE jobs SET status='running', worker_id=:wid, attempts=attempts+1
WHERE id = (
  SELECT id FROM jobs
  WHERE status='queued' AND run_at <= now()
  ORDER BY priority, run_at
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
RETURNING id, kind, payload;
"""
while True:
    job = claim(JOB)               # 空转则 sleep(1.5s)
    try: run(job); finish('done')
    except Exception as e:
        finish('failed', error=str(e))
        if job.attempts < 3: requeue(run_at=now() + backoff(attempts))   # 30s / 5min / 30min
```

- **幂等**：所有 `derive:*` 先写 `{target}.tmp` 再原子 `rename`；`index_meili` 以 Meili upsert 语义天然幂等。
- **SSE 推送**：worker 完成/失败时发布进程内事件；同进程模式直接转发；跨进程模式由 API 侧轮询 `jobs` 表最近变更（1s）合成事件流。事件格式：`event: job.updated\ndata: {"job_id","kind","asset_id","status","error"}`。
- **任务种类注册表**：`fingerprint`、`parse:{type}`、`derive:thumb_image`、`derive:cover_frame`、`derive:font_specimen`、`derive:font_charset`、`derive:hls`（二期）、`index_meili`、`pack_zip`、`scan_root`。

### 4.4 搜索同步（Meilisearch）

- 5 个 index：`fonts / music / videos / books / images`，主键 `id`。
- 文档字段映射（写入端在 `core/search.py` 统一构建）：

| index | searchableAttributes | filterableAttributes | sortableAttributes |
|---|---|---|---|
| fonts | title, family, file_name, note | tags, formats, languages, weight, is_variable, rating | title, weight, created_at |
| music | title, artist, album, file_name, note | tags, artist, album, format, rating | title, created_at |
| videos | title, series, file_name, note | tags, kind, series, resolution_class, format, rating | title, episode, created_at |
| books | title, authors, series_name, publisher, file_name, note | tags, authors, format, language, rating | title, pub_year, created_at |
| images | title, file_name, note | tags, album, camera_model, year_month, rating | taken_at, created_at |

- `year_month` 由 `taken_at` 冗余为 `YYYY-MM`（facet 用）；`resolution_class` ∈ {`<=720p`,`1080p`,`2K`,`4K+`}。
- 同步时机：`parse` 完成、`PATCH` 资产、标签变更、软删/恢复/清除 → 入队 `index_meili`（软删与清除为删除文档）。
- 全量重建：`python -m app.cli reindex --type {all|font|...}`（分批 1000 条 upsert）。

### 4.5 权限依赖与统一错误

```python
async def get_current_user(...) -> User | None            # 匿名返回 None
require_member = Depends(...)                             # None → 401
require_admin = Depends(...)                              # role != admin → 403
```

错误响应统一：`{"code": "...", "message": "...", "detail": {...}}`，code ∈ `UNAUTHENTICATED(401) / FORBIDDEN(403) / NOT_FOUND(404) / VALIDATION_ERROR(422) / CONFLICT(409) / INTERNAL(500)`；业务异常类 `ApiError(code, message, status)` 由全局 handler 捕获。分页统一游标：请求 `?cursor=&page_size=`（默认 60，上限 200），响应 `{items, next_cursor}`。

---

## 5. 领域模块详细设计

### 5.1 字体

| 项 | 设计 |
|---|---|
| 解析 | fontTools `TTFont`（woff2 先 `fontTools.ttLib.woff2.decompress`）读 `name`(1/2/16/17)、`OS/2`、`cmap`、`fvar`、`head`；family 聚合键 = nameID16 优先，回落 nameID1 |
| 字段 | weight/italic/is_variable/glyph_count/languages/license 进 `font_details`；`units_per_em`、`variable_axes`、name 原文进 `meta` |
| 派生 | `derive:font_specimen`：Pillow 用该字体渲染样张图 1024×512（预览文案取 settings.font_preview_text，默认「永 东 Aa Bb 1234」）→ `derived/fonts/{id}/specimen.png`；`derive:font_charset`：cmap 汇总为按 Unicode 区块的覆盖率 `derived/fonts/{id}/charset.json` |
| 在线预览 | 前端 `FontFace` 加载 `GET /api/fonts/{id}/file`（原文件流，woff/ttf 浏览器原生支持）；可变字体用 opentype.js 读 fvar 渲染轴滑杆；字符集浏览器渲染 charset.json，缺字置灰 |
| 下载 | 单文件 `GET /api/assets/{id}/download`；字族打包 = 按当前 family 聚合资产入 `pack_zip`；（二期）fontTools subset 子集化下载 |
| 端点 | `GET /api/fonts`（列表，含 family 聚合视图参数 `group_by=family`）、`GET /api/fonts/{id}`、`GET /api/fonts/{id}/file`（登录）、`GET /api/assets/{id}/preview/specimen`（公开，样张图属浏览页） |

### 5.2 音乐

| 项 | 设计 |
|---|---|
| 解析 | mutagen 按格式读标签（TIT2/TALB/TPE1/TRCK/TDRC、Vorbis Comment、©nam/©ART）；无标签按 `{artist}/{album}/{track}` 目录约定兜底；`has_lyrics` 检测 USLT/©lyr，LRC 文本进 `meta.lyrics` |
| 聚合 | artist/album 按 `name` 归一（strip + 大小折叠）upsert 到 `music_artists/music_albums`；专辑封面取任一曲目内嵌图 → `derived/music/{id}/cover.webp`，`music_albums.cover_path` 指向首曲派生物 |
| 流播放 | `GET /api/music/{id}/stream`：`LocalStorage.stream_range` 支持 `Range: bytes=start-end`（206），Content-Type 按 mime；浏览器原生格式直播，ape/tak 等解析期标记 `meta.streamable=false`，前端显示「仅下载」 |
| 端点 | `GET /api/music/albums`、`GET /api/music/albums/{id}/tracks`、`GET /api/music/{id}/stream`（登录） |

### 5.3 视频

| 项 | 设计 |
|---|---|
| 解析 | `ffprobe -v quiet -print_format json -show_format -show_streams` 取时长/分辨率/编码/音轨字幕流；`meta.streams_raw` 存节选 |
| 封面帧 | `derive:cover_frame`：ffmpeg `-ss {duration*0.1} -frames:v 1` 抽 3 候选帧（10%/35%/60%）→ `derived/videos/{id}/cover_{1..3}.webp`；默认取第 1 张写 `video_details.cover_path`，管理端 `PUT /api/videos/{id}/cover {variant: 1|2|3}` 更换 |
| 系列识别 | 规则表（正则，顺序匹配）：`(?P<series>.+)[ ._-]+S(?P<s>\d+)E(?P<e>\d+)`、`(?P<series>.+?)第(?P<e>\d+)[讲集课]`、`(?P<series>.+?)[ ._-]+EP?0*(?P<e>\d+)$`；父目录名作 series 兜底；多解或 0 解时 `meta.need_confirm=true` 进「入库确认队列」（管理端页面批量人工校对：选系列/建系列/改集数） |
| Direct Play | `GET /api/videos/{id}/stream`：容器/编码 ∈ {mp4|webm/mov, h264|hevc*|vp9, aac|mp3|opus} 走 Range 流；mkv/avi 等返回 415 + `meta.streamable=false`（*hevc 依赖浏览器解码能力，前端探测失败自动降级为「仅下载」提示） |
| 进度 | 播放中每 5s `POST /api/progress {asset_id, position:{seconds}}`；详情返回 `user_progress`，前端 ≥5% 且 <95% 视为「继续观看」，系列页汇总为「继续看第 N 集」 |
| 二期 | `derive:hls`（ffmpeg → `derived/videos/{id}/hls/master.m3u8` + VAAPI/NVENC 开关）、srt/ass→WebVTT、缩略图条 |
| 端点 | `GET /api/videos/series`（公开，浏览页系列卡片）、`POST /api/videos/series`、`GET /api/videos/series/{id}/episodes`（登录，含每集进度）、`GET /api/videos/{id}/stream`（登录） |

### 5.4 书籍

| 项 | 设计 |
|---|---|
| 解析 | epub：zip 内读 `content.opf`（dc:title/creator/publisher/date/identifier、manifest cover）+ 解压封面；pdf：PyMuPDF 读 metadata + 第 1 页渲染封面；mobi/azw3：`mobi` 库解析，失败用文件名兜底并 `meta.parse_warning` |
| 派生 | `derive:thumb_image` → `derived/books/{id}/cover.webp`（256/1024 两级） |
| 在线预览 | pdf → pdf.js（`GET /api/books/{id}/file` 流 + Range）；epub → foliate-js 加载同一 file 端点；mobi/azw3 前端展示「仅下载」；进度 `POST /api/progress {position:{locator, percent}}`（cfi/页码） |
| 端点 | `GET /api/books/{id}`、`GET /api/books/{id}/file`（登录，Range） |

### 5.5 图片

| 项 | 设计 |
|---|---|
| 解析 | exiftool JSON 输出提取 EXIF（taken_at/camera/参数/GPS/orientation）；尺寸用 Pillow；HEIC 解析失败标记仅下载（二期接 libheif） |
| 缩略图 | `derive:thumb_image` 三级：`thumb_256 / thumb_1024 / thumb_2560.webp`（libvips 更佳，Pillow 起步）；按 EXIF orientation 预旋转 |
| 相册 | 扫描期按父目录自动建 `image_albums(source=directory)` 并挂 `image_album_items`；管理端可建 manual 相册手工挂载 |
| 浏览 | 时间线按 `taken_at`（缺失回退 `created_at`）月分组 + 游标分页；`GET /api/images/{id}/thumbnail?size=256|1024|2560`（公开，属浏览页）；原图 `GET /api/images/{id}/original`（登录） |
| 端点 | `GET /api/images/timeline?cursor=&album_id=`、`GET /api/images/albums`（公开） |

> 预览权限口径（对规划 §4.7 的细化）：**列表网格内的缩略图/样张图/封面帧视为「浏览」的一部分，公开**；打开详情、原文件流、阅读器、音视频流均需登录。此口径与权限矩阵逐条对应。

---

## 6. API 端点总表

权限缩写：`公` 匿名可访问；`员` 需登录（member）；`管` 需 admin。

### 6.1 认证

| 方法 路径 | 权限 | 说明 |
|---|---|---|
| POST /api/auth/register `{username,password}` | 公 | 受 settings.registration_open 控制；成功即建立会话 |
| POST /api/auth/login | 公 | 失败统一 401（不区分用户名/密码错误） |
| POST /api/auth/logout | 员 | 吊销当前 session |
| GET /api/auth/me | 员 | `{id, username, role}` |

### 6.2 通用资产

| 方法 路径 | 权限 | 说明 |
|---|---|---|
| GET /api/{type} `?cursor=&page_size=&sort=&tag_ids=&favorite=&rating=` | 公 | `{type}` ∈ fonts/music/videos/books/images；**匿名请求禁止携带 `q`**（见 6.4）；无登录态时响应不含下载地址 |
| GET /api/assets/{id} | 员 | 详情：meta + 扩展表 + tags + progress |
| PATCH /api/assets/{id} `{title?,note?,rating?,is_favorite?,meta?}` | 管 | 触发 `index_meili` |
| DELETE /api/assets/{id} `?purge=&delete_file=` | 管 | 默认软删；`purge=true` 硬删（清派生物，原始文件仅 `delete_file=true` 时删） |
| POST /api/assets/{id}/restore | 管 | 回收站恢复 |
| POST /api/assets/{id}/tags `{tag_ids}` / DELETE 同路径 | 管 | |
| GET /api/assets/{id}/download | 员 | `Content-Disposition: attachment`，流式 |
| GET /api/assets/{id}/preview/specimen｜cover｜thumb | 公 | 各类型浏览页派生图（§5） |
| GET /api/trash / POST /api/trash/purge | 管 | 30 天前的软删项由 worker 定期硬删（清派生物，不动原始文件） |
| GET /api/admin/duplicates | 管 | 指纹分组 |

### 6.3 标签 / 系列 / 进度

| 方法 路径 | 权限 |
|---|---|
| GET /api/tags（树）、POST /api/tags、PATCH/DELETE /api/tags/{id} | 读`公` 写`管` |
| GET /api/videos/series（公开）｜POST、PATCH、DELETE /api/videos/series/{id}（管） | |
| GET /api/videos/series/{id}/episodes | 员 |
| PUT /api/videos/{id}/cover `{variant}` | 管 |
| POST /api/progress `{asset_id, position}` / GET /api/progress?asset_id= | 员 |

### 6.4 搜索（Meili 代理）

`GET /api/search?q=&types=fonts,music&filters=...&page=`（**员**）——服务端调 Meili multi-search 聚合 5 索引，返回 `{type, hits, estimatedTotal, facetsDistribution}`；匿名携带 `q` 返回 401（规划约束：访客不可搜索）。列表页内的类型内搜索同样必须登录。

### 6.5 上传 / 扫描 / 任务 / 打包（管）

| 方法 路径 | 说明 |
|---|---|
| POST /api/admin/uploads（multipart） | 校验扩展名白名单与 `MAX_UPLOAD_GB` → 存暂存区 → 走同一入库管道 |
| POST /api/admin/scan `{root_alias}` | 入队 `scan_root` |
| GET /api/admin/jobs `?status=&kind=` / POST /api/admin/jobs/{id}/retry | 任务中心 |
| POST /api/admin/download-packs `{asset_ids[] \| filters}` | 入队 `pack_zip`（>1GB 强制走任务），返回 pack id |
| GET /api/download-packs/{id}`（员，限本人）` → `GET /api/download-packs/{id}/file` | 完成后取包 |
| GET /api/events | SSE 任务事件流（员） |

### 6.6 用户 / 设置（管）

`GET/PATCH /api/admin/users`（停用/改角色/重置密码）；`GET/PUT /api/admin/settings`（scan_roots、registration_open、font_preview_text 等）。

---

## 7. 前端详细设计

### 7.1 技术与目录

React 18 + TS + Vite + TanStack Query + TanStack Virtual + zustand（播放器/预览文案等全局态）+ shadcn/ui + TailwindCSS。

```
web/src/
├── shared/
│   ├── layout/AppShell.tsx        # 左类型导航 + 顶搜索框 + 主区
│   ├── search/CommandPalette.tsx  # Cmd+K
│   ├── asset/AssetGrid.tsx / DetailPanel.tsx / TagPicker.tsx / DownloadButton.tsx
│   └── hooks/useAuth.ts / useSse.ts / useCursorQuery.ts
├── features/
│   ├── fonts/   FontWall.tsx / FontSpecimen.tsx / CharsetBrowser.tsx / VariableAxisSliders.tsx
│   ├── music/   AlbumWall.tsx / AlbumDetail.tsx / player/PlayerBar.tsx / player/store.ts
│   ├── videos/  VideoWall.tsx / SeriesCard.tsx / VideoDetail.tsx / VideoPlayer.tsx
│   ├── books/   BookWall.tsx / BookDetail.tsx / reader/PdfReader.tsx / reader/EpubReader.tsx
│   ├── images/  Timeline.tsx / Lightbox.tsx / ExifPanel.tsx / AlbumPicker.tsx
│   └── admin/   JobsPage.tsx / ConfirmQueue.tsx / SettingsPage.tsx / UsersPage.tsx / TrashPage.tsx
└── routes.tsx
```

### 7.2 路由与页面

| 路由 | 页面 | 权限门 |
|---|---|---|
| /login /register | 登录 / 注册 | 公开 |
| / | 仪表盘（最近入库、统计、任务摘要） | 登录；访客重定向到 /videos |
| /fonts /music /videos /books /images | 各资源浏览页（网格/墙） | 公开浏览 |
| /{type}/:id | 详情页（侧栏抽屉式，含预览区） | 登录（访客点开弹出注册引导） |
| /search?q= | 全局搜索结果 | 登录 |
| /jobs /settings /users /trash | 管理页 | admin |

访客态规则：搜索框显示但聚焦即弹「登录后可搜索」；网格卡片点击弹注册引导；缩略图正常显示。

### 7.3 数据获取与实时

- Query key 约定：`['assets', type, paramsHash]`、`['asset', id]`、`['search', q, filtersHash]`；mutation 成功后 `invalidate` 对应 key。
- `useSse`：订阅 `/api/events`，收到 `job.updated` 按 `kind→query key` 映射做精准失效（如 `derive:thumb_image` 完成 → 失效该资产的缩略图 query）。
- 网格虚拟化：图片页 masonry（按宽高比占位，数据来自 `image_details.width/height`），其余类型等高网格；全部走 TanStack Virtual。

### 7.4 关键组件规格

- **CommandPalette（Cmd+K）**：150ms 防抖 → `GET /api/search`；按类型分组展示 Top5，`Tab` 切换聚焦类型，回车进详情页。
- **FontSpecimen**：全局预览文案（zustand，字体页顶栏可改）；`new FontFace(family, url(...))` 加载后渲染三行样张（自定义文案 / 字母数字 / 全部命中汉字样例）；可变字体渲染 wght/wdth 滑杆；加载失败（不支持的容器）回落显示 specimen.png。
- **PlayerBar（全局底部播放条）**：zustand store 持有 `{queue, index, playing}`；`<audio>` 原生 Range 拉流；跨页不中断（组件挂在 AppShell 层）。
- **VideoPlayer**：`<video>` 直连 `/api/videos/{id}/stream`；`onTimeUpdate` 节流 5s 上报进度；挂载时若存在进度且 5%<pos<95% 弹「从 xx:xx 继续播放」。
- **PdfReader / EpubReader**：pdf.js 逐页懒加载；foliate-js 视图 + cfi 定位；均接 `GET /api/books/{id}/file`。
- **Lightbox**：双指/滚轮缩放、旋转（读 orientation）、方向键翻页、EXIF 面板侧滑。

---

## 8. 关键时序图

### 8.1 扫描入库

```mermaid
sequenceDiagram
    participant A as Admin
    participant API as server
    participant DB as PostgreSQL
    participant W as worker
    participant FS as /data
    A->>API: POST /api/admin/scan {root_alias}
    API->>DB: INSERT jobs(scan_root)
    W->>FS: iter_files(root)
    loop 每个新文件
        W->>DB: INSERT assets(status=pending) + jobs(fingerprint)
        W->>FS: 计算指纹
        W->>DB: UPDATE fingerprint + jobs(parse:type)
        W->>FS: 解析（ffprobe/fontTools/mutagen…）
        W->>DB: 写 title/meta/扩展表, status=ready
        W->>DB: jobs(derive:*, index_meili)
        W->>API: 事件 job.updated（SSE 广播）
    end
```

### 8.2 上传入库

```mermaid
sequenceDiagram
    participant A as Admin
    participant API as server
    participant FS as /data
    participant W as worker
    A->>API: POST /api/admin/uploads (multipart)
    API->>FS: 写 uploads:staging/{ym}/{uuid}.ext
    API->>W: INSERT assets(pending) + jobs(fingerprint)（同事务）
    W->>W: 指纹 → 解析 → 派生 → 索引（同 8.1）
    A->>A: 前端 SSE 收到 ready → 列表刷新
```

### 8.3 全局搜索

```mermaid
sequenceDiagram
    participant U as 用户(已登录)
    participant FE as 前端 CommandPalette
    participant API as server
    participant M as Meilisearch
    U->>FE: 输入（150ms 防抖）
    FE->>API: GET /api/search?q=…&types=…
    API->>M: multi-search（5 索引，filter: 非软删）
    M-->>API: 各索引 hits + facetsDistribution
    API-->>FE: 聚合响应（每类型 Top5 + 总数）
    U->>FE: 回车 → 跳 /{type}/{id}
```

### 8.4 视频播放与进度

```mermaid
sequenceDiagram
    participant U as 用户
    participant VP as VideoPlayer
    participant API as server
    U->>VP: 打开详情（含上次进度）
    VP->>API: GET /api/videos/{id}/stream (Range: bytes=0-)
    API-->>VP: 206 分段流
    loop 每 5s
        VP->>API: POST /api/progress {seconds}
    end
    U->>VP: 暂停/离开
    VP->>API: 最终进度上报
```

---

## 9. 派生物目录规范（完整）

```
/data/derived/
├── fonts/{asset_id}/    specimen.png, charset.json
├── music/{asset_id}/    cover.webp
├── videos/{asset_id}/   cover_1.webp cover_2.webp cover_3.webp, hls/（二期）
├── books/{asset_id}/    cover.webp
├── images/{asset_id}/   thumb_256.webp thumb_1024.webp thumb_2560.webp
└── packs/{pack_id}.zip
```

规则：先写 `.tmp` 再原子改名；worker 重试安全；清除资产时整目录递归删除。派生物响应（样张/缩略图/封面）由**应用侧**直接携带 `Cache-Control: public, max-age=31536000, immutable`（派生物路径含资产 id，内容不变），反代透传即可，无需在 NGINX 重复配置。

---

## 10. 测试策略

| 层 | 工具 | 覆盖要点 |
|---|---|---|
| 单元（后端） | pytest | 各 Parser golden 测试（`tests/fixtures/` 放样例字体/音频/书籍文件，断言解析字段）；指纹策略；系列识别正则表；权限依赖 |
| 集成（后端） | pytest + testcontainers（postgres、meilisearch） | 入库管道端到端：放文件 → scan → ready → 搜索命中 → 下载；SSE 事件；Range 请求边界 |
| 单元（前端） | vitest + MSW | Query key 失效逻辑、访客态 UI 降级、Cmd+K 分组逻辑 |
| E2E | Playwright | M0 冒烟：注册 → 登录 → 上传 → 搜索 → 下载；访客不可搜索/预览 |

解析器要求 ≥90% 分支覆盖（各格式异常文件必须返回 `meta.parse_warning` 而非让任务崩溃）。

---

## 11. 里程碑交付物对照

| 里程碑 | 本文对应实现范围 |
|---|---|
| M0 内核骨架 | §1 全部、§2.1–2.2、§3、§4 全部、§6.1–6.2、§6.5、§7.1–7.3 + AppShell/登录注册/AssetGrid/CommandPalette 骨架、§10 基建 |
| M1 图片 | §2.3 图片表、§5.5、§7.4 Lightbox/Timeline |
| M2 字体 | §2.3 字体表、§5.1、§7.4 FontSpecimen/CharsetBrowser |
| M3 书籍 | §2.3 书籍表、§5.4、§7.4 两 Reader |
| M4 音乐 | §2.3 音乐表、§5.2、§7.4 PlayerBar |
| M5 视频 | §2.3 视频表、§5.3、§7.4 VideoPlayer/ConfirmQueue |
| M6 打磨 | §6.3 剩余、智能集合（保存筛选 JSON 到 settings.user 域）、打包下载全链路、备份脚本（pg_dump + rsync /data/library）、反代与派生物缓存调优（NGINX，见 §1.1） |
