# 个人资源门户 · 前端（web/）

Vite + React 18 + TypeScript + TailwindCSS + React Router + TanStack Query + Zustand + lucide-react。
**已接入真实后端**（`server/`，默认 http://localhost:8000，可用 `VITE_API_BASE` 覆盖）：cookie 会话、
REST 数据、Meilisearch 聚合搜索、真实上传与任务中心。后端 M0 返回通用资产数据，
领域字段（字族/曲目/系列/EXIF）由前端映射层补默认值，随 M1–M5 后端解析器就绪自然填充。

## 运行

```bash
cd web
npm install
npm run dev     # http://localhost:5173（API 默认 :8000，需先启动 server + worker）
npm run build
```

## 账号（真实会话，argon2id + 服务端 cookie）

- 管理员：`admin` / `admin1234`（后端首次启动由环境变量引导创建）
- 访客：不登录即可浏览列表；搜索/详情/下载会触发登录引导（§4.7 权限矩阵）

## 数据层说明

- `src/api/client.ts`：唯一数据出口。REST 请求 + 通用资产 → 五类视图模型的映射
  （色相由 id 哈希派生做封面占位；后端出缩略图后替换 `HueCover` 即可）。
- `src/stores/auth.ts`：登录/注册/登出走真实 API；`hydrate()` 在启动时用 cookie 校正本地缓存。
- 搜索：`GET /api/search`（Meilisearch multi-search 代理），CommandPalette 与 /search 共用。
- 上传：顶栏「上传」（admin）→ `POST /api/admin/uploads`，与目录扫描共用入库管道。

## 已实现交互

三级角色与路由守卫、⌘K 搜索（键盘导航）、字体样张墙（全局文案/字重）、音乐播放条（mock 计时，
真实音频流随 M4）、视频 mock 播放与进度记忆（真实 Direct Play 随 M5）、书籍阅读器弹层（M3）、
图片 Lightbox + EXIF（真实 EXIF 随 M1）、任务中心（真实 jobs，10s 刷新）、标签、设置（注册开关真实读写）。
