# 个人资源门户 · 前端（web/）

Vite + React 18 + TypeScript + TailwindCSS + React Router + TanStack Query + Zustand + lucide-react。
当前为 **Mock 数据阶段**：全部页面与交互已完成，数据层通过 `src/api/client.ts` 接缝隔离，M0 后端就绪后逐函数替换为真实 REST API（页面代码零改动）。

## 运行

```bash
cd web
npm install
npm run dev     # http://localhost:5173
npm run build   # 产物在 dist/
```

## Mock 账号

- 管理员：`admin` / `admin1234`（登录页有快捷填入按钮）
- 普通用户：`demo` / `demo1234`
- 不登录 = 访客：仅可浏览列表，点卡片/搜索会弹登录引导（对应设计 §4.7 权限矩阵）

## 目录

```
src/
├── api/client.ts      # Mock API（延迟模拟 + 与未来 REST 同签名）
├── mocks/data.ts      # 五类资源 + jobs/confirm/tags/stats 的 mock 数据
├── stores/            # zustand：auth(持久化) / player(播放条) / ui(弹层) / prefs(预览文案+观看进度,持久化)
├── components/        # layout.tsx(AppShell/Sidebar/Topbar) / PlayerBar / CommandPalette / ui.tsx(原语)
├── features/          # auth dashboard fonts music videos books images search admin
├── lib/               # utils / search(mock 检索，对应 Meilisearch 聚合)
└── types.ts
```

## 已实现的交互（均为 mock）

- 三级角色与路由守卫、访客引导弹层、⌘K 全局搜索（键盘导航 + 回车跳详情）
- 字体：全局样张文案/字号/字重（跨页同步）、可变轴滑杆、筛选
- 音乐：专辑墙/艺术家视图、点曲目 → 底部播放条跨页计时播放、上一首/下一首/拖动进度
- 视频：系列/素材两级浏览、mock 播放器计时、观看进度记忆与续播、集数切换
- 书籍：系列分组、阅读进度记忆、阅读器弹层翻页
- 图片：月份/相机筛选、收藏、Lightbox 左右切换 + EXIF 面板
- 管理端：任务重试、入库确认队列、标签创建、设置项
