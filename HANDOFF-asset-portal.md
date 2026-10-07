# HANDOFF · 个人资源门户（personal-asset-portal）

> 交接日期：2026-10-06 · 状态：M0–M6 全部里程碑完成，13+ 个 UX/缺陷修复提交，共 16 commits（本地 main，origin 未推送）
> 本文面向接手开发的人。规划与详细设计见 `docs/` 两份文档，本文只写"文档之外的实况"。

---

## 1. 目标与需求边界

**一句话**：自建个人门户网站，统一管理**字体、音乐、视频、书籍、图片**五类资源，覆盖入库维护、检索、在线预览、下载、分享。

**需求边界（已与需求方确认，勿轻易扩大）**：
- 所有管理模块**自行实现**（明确否决：对接 Jellyfin/Immich 等现成系统的 API；开源项目只读源码作参考）。
- 多用户三级角色：未登录访客**仅可浏览列表**（搜索/详情/预览/下载一律 401/前端拦截）；注册用户可搜/预览/下载；管理员才可上传、编辑、删除、扫描、设置、任务中心、工具箱。
- 明确**不做**：社区/评论、分布式、HLS 转码（二期）、人脸识别与 AI 标签（二期）、PWA/原生端（响应式 Web 即可）、Calibre 兼容、联网元数据刮削（视频/书籍元数据只来自文件本身 + 手动维护）。
- 原始文件**只读不搬移**：入库不重命名、不移动，系统只登记索引。
- 部署形态：单机 Docker Compose / 本机进程，共享机器上的通用 postgres 与 meilisearch 容器（见 §6）。

## 2. 已完成的部分

### 2.1 里程碑与 commit 对照（main 分支，全部本地）

| commit | 内容 |
|---|---|
| c88cc79 | 初始提交（docs 两份设计文档 + prototype/ 15 屏 UI 原型） |
| caf7e4b | M0 收尾：前端切到真实 REST API；后端补 /api/stats、/api/recent |
| 2c5d9f2 | M1 图片：Pillow EXIF → image_details；三级 webp 缩略图；时间线/Lightbox |
| e9e8cf5 | M2 字体：fontTools 解析字族/字重/可变轴/语言；样张+字符集派生；FontFace 真渲染 |
| 3a72755 | M3 书籍：epub OPF / pdf(PyMuPDF) / mobi 兜底解析；封面；自建章节阅读器；进度云同步 |
| 33cfcb4 | M4 音乐：mutagen 三级聚合（艺术家/专辑/曲目）；内嵌封面；Range 音频流；真实播放条 |
| d97f8f2 + 1957831 | M5 视频：ffprobe + 封面帧；系列识别正则+确认队列；Direct Play `<video>`；观看进度 |
| 56f1fa5 | M6 打磨：打包下载全链路；分享链接（token 过期+权限）；智能集合；backup.sh；Caddyfile |
| b46ffd7 / 2afa703 | UX 修复：上传结果 toast、FileList 提前清空 bug |
| 1db40af / a82fdba / 7e8cbe5 | UX 修复：图片查看器溢出挤压、箭头居中、时间格式化、胶片条重做 |

### 2.2 已实现能力（均可验证）

- 五类资源：目录扫描 + 网页上传双入库（同一管道：fingerprint → parse:{type} → derive:* → index_meili）。
- 全局搜索：⌘K 弹层 + /search 页，Meilisearch multi-search 聚合五索引（访客带 q 直接 401）。
- 在线预览：图片 Lightbox（EXIF/胶片条/方向键）、字体样张墙（FontFace 真渲染+字符集覆盖）、音频流播放条（跨页不断）、视频 Direct Play（进度记忆/续播/系列集数）、epub 章节阅读器 + PDF 原生。
- 下载：单文件鉴权流式下载；打包 zip（按 asset_ids 或 类型+收藏 筛选，异步任务）。
- 分享：token 链接（过期时间、仅预览/可下载），公开分享页无需登录。
- 管理端：任务中心（真实 jobs 轮询+重试）、入库确认队列（视频系列人工校对）、标签管理、设置（注册开关/扫描根）、工具箱（打包/分享/智能集合）。

## 3. 关键决策与理由（含被否决的方案）

| # | 决策 | 理由 | 否决过的替代 |
|---|---|---|---|
| D1 | 统一资产表 `assets` + 各域 detail 扩展表 + meta JSONB | 标签/搜索/任务/下载/权限写一遍五处复用 | 每类独立模型（字段大量重复）；把一切塞 JSONB（筛选字段无法高效索引） |
| D2 | 原始文件只读；`storage_key = {root_alias}:{相对路径}`；uploads 暂存区注册为扫描根 | 用户目录结构是事实标准；上传与扫描天然共用管道 | 入库时搬运/重命名（破坏用户目录）；绝对路径入库（换盘即废） |
| D3 | 任务队列 = `jobs` 表 + `FOR UPDATE SKIP LOCKED` 轮询 | 单人项目少一个常驻组件；任务与业务同事务一致 | 一开始就上 Redis+Celery（过重）；**注意 `enqueue()` 必须自带 commit**（曾因只 flush 导致 commit 后入队的任务被回滚丢失） |
| D4 | PostgreSQL 16（JSONB/事务性 DDL/部分索引/数组/pgvector 预留） | 见规划 §3.1 对比 MySQL 的完整论证 | MySQL（JSONB 索引弱、DDL 非事务、二期 AI 需另配向量库） |
| D5 | Meilisearch 五索引 + 后端 multi-search 代理 | 中文分词/容错/facet 开箱即用 | PG FTS（中文要装扩展）；ES（运维过重） |
| D6 | argon2id + 服务端 sessions 表 + httpOnly Cookie | 可吊销、可在线管理会话 | JWT（不可吊销）；OAuth/第三方身份（过重） |
| D7 | **书籍阅读器自建章节模式，弃用 epub.js** | epub.js 在本环境（Vite dev + 跨域 API）open 与 rendition 接连静默挂起：定位到 StrictMode 双挂载竞态（renderTo 在 disposed 检查前调用）与 ArrayBuffer 打开无 baseUrl 两大根因并修复后仍不稳；自建方案（后端出章节目录+资源端点，前端按节渲染）依赖少、进度可控，且符合"全部自实现"的项目哲学 | foliate-js（无 npm 包需 vendor，风险同类）；继续硬调 epub.js |
| D8 | 视频封面帧用 **jpg** 而非 webp；ffmpeg 输出临时文件必须带已知扩展名 | brew ffmpeg 9 未编译 libwebp；`.tmp` 后缀会让 muxer 报错（exit 234 静默失败，靠复现 stderr 定位） | webp（方案层面一致，编码器不可用） |
| D9 | 权限口径：缩略图/样张/封面帧=浏览的一部分，**公开**；详情/原文件/音视频流/下载=登录 | 与"访客可浏览列表（含网格缩略图）、不可预览详情"的产品语义对齐，且让 `<img>` 天然工作 | 所有派生物都要登录（浏览页全裂） |
| D10 | 前端唯一数据出口 `web/src/api/client.ts`：REST + "通用资产 → 五类视图模型"映射层 | 后端 M0 只有通用资产数据，领域字段由映射层补默认值；后端解析器逐里程碑落地时前端零改动 | 每个页面自行 fetch（映射逻辑散落） |
| D11 | 图片查看器用 `absolute inset-0 + object-contain`，不用嵌套百分比 max-h | `max-h-[86%]` 穿过"滚动容器→多层 flex→grid"链路时百分比解析不稳定（实测溢出挤压） | 继续调百分比/手动 ResizeObserver |
| D12 | 上传 FileList 先拷贝为数组再清空 input | input.value='' 会使 FileList 立即失效（"已入库 0 个"根因） | 直接传 FileList |

## 4. 未完成 / 待办清单

**功能缺口（按优先级）**
1. ~~**标签进搜索索引**~~（✅ 2026-10-07 完成：index_meili 查 asset_tags 写入 Meili 文档；rename/delete/detach 标签均触发受影响资产重建；/api/search 支持 tag 过滤 + facet_distribution；/api/{route} 列表支持 tag 过滤且返回 tags；前端搜索页 facet 芯片、四类列表页 ?tag= 过滤、详情页标签可点击、集合跳转修复路由映射并带 q/tag/favorite）
2. ~~**字族打包下载**~~（✅ 2026-10-07 完成：GET /api/fonts/{id}/family-pack 按字族即时打 zip，详情页按钮直连下载）
3. ~~**分享按钮下沉**~~（✅ 2026-10-07 完成：ShareDialog 组件接入五类详情页，admin 可见，支持有效期选择与允许下载开关；专辑页按曲目行分享——专辑 ID 非资产 ID）
4. ~~**浏览页批量多选 + 入包**~~（✅ 2026-10-07 完成：useBulkSelect + SelectionBar 接入字体（整族）/视频（系列=全部剧集）/书籍/图片列表页与音乐曲目视图；工具箱开放到 member 以便取包，分享页签仍 admin）
5. ~~**标签层级树 UI**~~（✅ 2026-10-07 完成：TagsPage 递归树 + 父标签选择弹层；PATCH /api/tags 支持换父含防环校验）
6. ~~**SSE 任务进度推送**~~（✅ 2026-10-07 完成：GET /api/admin/jobs/stream，pg_notify 驱动 + 快照语义 + 15s keepalive；任务中心 EventSource 订替换代轮询，带连接状态指示）
7. ~~**LRC 歌词展示**~~（✅ 2026-10-07 完成：新增 GET /api/music/{id}/lyrics；播放条歌词面板——LRC 时间轴高亮同步滚动、点击行跳播、纯文本兜底、过滤 [ti:] 等元数据行）
8. ~~**智能集合跳转**~~（✅ 2026-10-07 完成：见第 1 条；注意列表页 q 关键词仍只有后端支持、前端未读）

**工程债**
9. ~~**Alembic**~~（✅ 2026-10-07 完成：migrations/ 异步模板基线 `e256f2a718d5`（21 表，临时库验证升级/降级/零漂移）；lifespan 改为启动时 upgrade head；现有库已 stamp；用法见 server/README.md）
10. **自动化测试为零**：测试策略在详细设计 §10（pytest + testcontainers + Playwright），当前验证全靠 curl 冒烟 + 浏览器人工。
11. **Caddy 生产接线**：deploy/Caddyfile 是示例；compose 中无 caddy service。
12. **前端 chunk 343KB**：epubjs 移除后仍偏大，可做 manualChunks。
13. 移动端：侧栏抽屉可用，详情页/查看器未做小屏适配细化。

**二期规划项（明确延期）**：HLS 转码+字幕、人脸识别/AI 标签（pgvector）、RAW 支持、视频缩略图进度条、分享粒度到集合。

## 5. 当前卡点或未验证的假设

1. ** epub 阅读器只有章级进度**：章内滚动位置未记录（position JSONB 预留了结构）；续播只到章首。
2. **ffprobe 健壮性未穷举**：损坏/冷门容器走 parse_warning 兜底路径，只测过 fake 文件与标准 mp4/mkv。
3. **大库性能未压测**：图片墙是 CSS columns + 游标分页，**未实装虚拟滚动**（设计 §7.3 写了 TanStack Virtual）；10w 张目标未验证。
4. **worker 单机假设**：SKIP LOCKED 支持多 worker，但 derive 产物目录与部署卷路径假设同机。
5. **搜索索引与 DB 的一致性**：软删/恢复/标签变更走 index_meili 任务最终一致；Meili 宕机期间的任务会失败重试 3 次后放弃，**没有对账机制**（建议 M6.5 加 `reindex` 定时任务，CLI 目前只有启动时 ensure_indexes）。
6. **生产安全假设**：BOOTSTRAP_ADMIN_PASSWORD 默认 admin1234、COOKIE_SECURE=false、Caddy 未上——生产部署前必须过一遍 §1.2 环境变量。
7. **基础设施依赖用户机器**：postgres-dev / meilisearch-dev 是这台机器上的通用容器（详见 §6），换机需按 server/README.md 重建。
8. **未推送**：origin = git@github.com:WenRun/personal-asset-portal.git，**是否 push 由需求方决定**。

## 6. 复现与验证命令

**基础设施**（通用容器，通常已在跑）：
```bash
docker start postgres-dev meilisearch-dev   # 若未运行
# postgres-dev: 宿主 5432，库名 portal（连接串见 server/.env）
# meilisearch-dev: 宿主 7700，密钥 dev-meili-master-key（新建方法见 server/README.md）
```

**后端**（Python 3.12，venv 已建好在 server/.venv）：
```bash
cd server
.venv/bin/uvicorn app.main:app --reload --port 8000     # API + /docs；日志 /tmp/portal-server.log
.venv/bin/python -m app.core.worker                     # 另开终端；日志 /tmp/portal-worker.log
# ⚠️ 改后端代码后 server 和 worker 都要重启（worker 不热载）
```

**前端**：
```bash
cd web && npm run dev        # :5173；日志 /tmp/portal-web.log
npm run build                # tsc + vite build（提交前必须过）
```

**冒烟验收**（完整命令集见 server/README.md，关键几条）：
```bash
curl localhost:8000/health
curl -s -c /tmp/jar -X POST localhost:8000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin1234"}'
curl -s -b /tmp/jar -X POST localhost:8000/api/admin/scan -H 'Content-Type: application/json' -d '{"root_alias":"fonts"}'
curl -s -b /tmp/jar "localhost:8000/api/search?q=思源"
# 权限矩阵自检：不带 cookie 访问 /api/search → 401；/api/fonts → 200
```

**备份**：`DATABASE_URL=... BACKUP_DIR=... ./deploy/backup.sh`

**测试**：当前无自动化测试（见 §4-10）；验收以 curl 冒烟 + 浏览器人工走查为准（五类各：上传/扫描 → 列表可见 → 详情预览 → 搜索命中 → 下载 200）。

**账号**：admin/admin1234（管理员）、demo/demo1234（普通用户，注册所得）。

## 7. 相关文件清单

### 文档与原型
| 路径 | 作用 |
|---|---|
| docs/personal-asset-portal-plan.md | 总体规划 v0.3：架构/选型/里程碑/决策记录（§15） |
| docs/personal-asset-portal-detail-design.md | 详细设计 v0.1：DDL/端点/时序/目录规范（实现以它为准） |
| prototype/*.html | 15 屏 UI 原型（方案 A 静态页，M0 前的视觉基准，已基本被真实前端取代） |

### 后端 server/
| 路径 | 作用 |
|---|---|
| server/requirements.txt / Dockerfile / .env.example | 依赖清单 / 部署镜像 / 环境变量模板 |
| server/.env | 本机实际配置（**已 gitignore，含数据库口令**） |
| server/app/main.py | 应用装配：lifespan 建表+引导管理员+Meili 索引；路由注册顺序（assets 的 /{route} 兜底必须最后） |
| server/app/core/config.py | pydantic-settings 环境变量 |
| server/app/core/db.py | asyncpg 引擎与会话 |
| server/app/core/models.py | 全部 ORM 表（M0 七表 + M1-M5 领域表 + M6 三表），改表结构只动这里 |
| server/app/core/storage.py | 存储抽象 + LocalStorage：storage_key 解析与路径逃逸防护 |
| server/app/core/fingerprints.py | 指纹策略（≤512MB 全 sha256 / 大文件 quick） |
| server/app/core/security.py | argon2id 哈希/校验 |
| server/app/core/deps.py | get_current_user / require_member / require_admin / settings KV |
| server/app/core/errors.py | 统一错误 {code,message,detail} |
| server/app/core/registry.py | 扩展名 → 资产类型注册表（新格式先改这里） |
| server/app/core/pipeline.py | 入库状态机 + 通用 parse 任务 + roots_of；**新领域 parse 在此注销通用版** |
| server/app/core/jobs.py | DB 队列：enqueue（自带 commit）/ claim（SKIP LOCKED）/ worker 循环 |
| server/app/core/worker.py | worker 进程入口：**新领域模块必须在此 import** 以注册处理器 |
| server/app/core/search.py | Meili 客户端：索引设置/文档结构/multi-search 代理 |
| server/app/core/downloads.py | M6 pack_zip 处理器（打包任务） |
| server/app/api/auth.py | 注册/登录/登出/me |
| server/app/api/assets.py | 资产列表（游标分页+领域字段合并）/详情/下载/编辑/软删/恢复/标签挂载/上传；含 /api/stats、/api/recent |
| server/app/api/tags.py | 标签 CRUD |
| server/app/api/search.py | /api/search multi-search 代理 |
| server/app/api/admin.py | 扫描触发/任务中心/系统设置 |
| server/app/api/m6.py | 打包/分享/智能集合端点 |
| server/app/domains/images/ | M1：parser（EXIF）/ thumbs（三级 webp）/ router（thumbnail 公开、original 登录） |
| server/app/domains/fonts/ | M2：parser（fontTools）/ specimen / charset / router（file/charset/specimen） |
| server/app/domains/books/ | M3：parser（epub OPF/pdf/mobi）/ thumbs / router（file/cover/progress/contents/resource） |
| server/app/domains/music/ | M4：parser（mutagen）/ thumbs / router（albums/tracks/stream/cover） |
| server/app/domains/videos/ | M5：probe（ffprobe+抽帧）/ series（识别正则）/ parser / router（series/episodes/stream/cover/confirm） |
| server/README.md | 启动步骤、冒烟命令、基础设施说明 |

### 前端 web/
| 路径 | 作用 |
|---|---|
| web/src/api/client.ts | **唯一数据出口**：REST 封装 + 通用资产→五类视图模型映射 + 各资源 URL 构造 |
| web/src/types.ts | 五类视图模型类型（映射层的目标形状） |
| web/src/lib/search.ts | assetHit/HueCover 色相派生、分组标签（Meili 命中 → 展示模型） |
| web/src/lib/useFontFace.ts | 字体 FontFace 加载 hook |
| web/src/lib/utils.ts | cn / fmtTime / fmtDate |
| web/src/stores/auth.ts | 登录态（真实 API + hydrate 校正） |
| web/src/stores/player.ts | 播放队列/播放状态（曲目流地址由 PlayerBar 构造） |
| web/src/stores/prefs.ts | 字体预览文案 + mock 期进度（真实进度已走服务端，待清理） |
| web/src/stores/ui.ts | 弹层/抽屉开关 |
| web/src/components/layout.tsx | AppShell/Sidebar/Topbar（含 ⌘K 热键与访客横幅） |
| web/src/components/PlayerBar.tsx | 全局底部播放条（真实 audio 流） |
| web/src/components/CommandPalette.tsx | ⌘K 搜索弹层 |
| web/src/components/UploadButton.tsx | 上传按钮 + 结果 toast |
| web/src/components/ui.tsx | Button/Input/Badge/Modal/Chip/HueCover 等原语 + GuestGate + useAssetNav |
| web/src/features/{fonts,music,videos,books,images}/ | 五类浏览+详情页（每域两文件） |
| web/src/features/search/SearchPage.tsx | 全量搜索结果页 |
| web/src/features/dashboard/DashboardPage.tsx | 仪表盘（stats/recent） |
| web/src/features/admin/{JobsPage,TagsPage,SettingsPage,ToolsPage}.tsx | 任务中心+确认队列 / 标签 / 设置 / M6 工具箱 |
| web/src/features/auth/LoginPage.tsx | 登录/注册（含演示账号快捷填入） |
| web/src/features/share/SharePage.tsx | 公开分享页（/share/:token） |

### 部署
| 路径 | 作用 |
|---|---|
| docker-compose.yml | 仅 server+worker 两个服务（通过 host.docker.internal 访问通用容器）；本地开发不使用 |
| deploy/backup.sh | pg_dump + rsync library 备份脚本 |
| deploy/Caddyfile | 反代与派生物缓存示例 |
| .gitignore | 排除 server/.env（含口令）、server/data、venv、node_modules、.idea |

### 运行时位置（不在 git 内）
| 路径 | 作用 |
|---|---|
| server/data/library/{fonts,music,videos,books,images,uploads}/ | 资源根目录（uploads/staging 为上传落点） |
| server/data/derived/ | 派生物（缩略图/封面/样张/字符集/packs），可全量重建 |
| /tmp/portal-{server,worker,web}.log | 三个进程的运行日志 |
