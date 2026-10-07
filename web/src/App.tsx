import { ComponentType, lazy, Suspense, useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/layout'
import { GuestGate } from '@/components/ui'
import { useAuth } from '@/stores/auth'
import type { ReactNode } from 'react'

// 路由级代码拆分：每个页面独立 chunk（非 default 导出需手动包一层）
const page = (loader: () => Promise<Record<string, unknown>>, name: string) =>
  lazy(() => loader().then((m) => ({ default: m[name] as ComponentType })))

const LoginPage = page(() => import('@/features/auth/LoginPage'), 'LoginPage')
const SharePage = page(() => import('@/features/share/SharePage'), 'SharePage')
const DashboardPage = page(() => import('@/features/dashboard/DashboardPage'), 'DashboardPage')
const FontsPage = page(() => import('@/features/fonts/FontsPage'), 'FontsPage')
const FontDetailPage = page(() => import('@/features/fonts/FontDetailPage'), 'FontDetailPage')
const MusicPage = page(() => import('@/features/music/MusicPage'), 'MusicPage')
const AlbumDetailPage = page(() => import('@/features/music/AlbumDetailPage'), 'AlbumDetailPage')
const VideosPage = page(() => import('@/features/videos/VideosPage'), 'VideosPage')
const VideoDetailPage = page(() => import('@/features/videos/VideoDetailPage'), 'VideoDetailPage')
const BooksPage = page(() => import('@/features/books/BooksPage'), 'BooksPage')
const BookDetailPage = page(() => import('@/features/books/BookDetailPage'), 'BookDetailPage')
const ImagesPage = page(() => import('@/features/images/ImagesPage'), 'ImagesPage')
const ImageDetailPage = page(() => import('@/features/images/ImageDetailPage'), 'ImageDetailPage')
const SearchPage = page(() => import('@/features/search/SearchPage'), 'SearchPage')
const JobsPage = page(() => import('@/features/admin/JobsPage'), 'JobsPage')
const TagsPage = page(() => import('@/features/admin/TagsPage'), 'TagsPage')
const SettingsPage = page(() => import('@/features/admin/SettingsPage'), 'SettingsPage')
const ToolsPage = page(() => import('@/features/admin/ToolsPage'), 'ToolsPage')

function PageFallback() {
  return (
    <div className="grid h-full min-h-64 place-items-center text-sm text-slate-400">
      <span className="animate-pulse">加载中…</span>
    </div>
  )
}

/** 详情/搜索/管理路由要求登录；访客点击卡片时由页面内 LoginGate 拦截（§4.7 权限矩阵） */
function RequireUser({ children }: { children: ReactNode }) {
  const user = useAuth((s) => s.user)
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

function RequireAdmin({ children }: { children: ReactNode }) {
  const user = useAuth((s) => s.user)
  if (!user) return <Navigate to="/login" replace />
  if (user.role !== 'admin') return <Navigate to="/" replace />
  return <>{children}</>
}

/** 仪表盘要求登录；访客按设计文档 §7.2 重定向到 /videos 浏览页 */
function DashboardGate() {
  const user = useAuth((s) => s.user)
  if (!user) return <Navigate to="/videos" replace />
  return <DashboardPage />
}

export default function App() {
  const hydrate = useAuth((s) => s.hydrate)
  useEffect(() => { void hydrate() }, [hydrate])

  return (
    <>
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/share/:token" element={<SharePage />} />
          <Route element={<AppShell />}>
            <Route path="/" element={<DashboardGate />} />
            {/* 浏览页：公开（访客可浏览） */}
            <Route path="/fonts" element={<FontsPage />} />
            <Route path="/music" element={<MusicPage />} />
            <Route path="/videos" element={<VideosPage />} />
            <Route path="/books" element={<BooksPage />} />
            <Route path="/images" element={<ImagesPage />} />
            {/* 详情 / 搜索：要求登录 */}
            <Route path="/fonts/:id" element={<RequireUser><FontDetailPage /></RequireUser>} />
            <Route path="/music/albums/:id" element={<RequireUser><AlbumDetailPage /></RequireUser>} />
            <Route path="/videos/:id" element={<RequireUser><VideoDetailPage /></RequireUser>} />
            <Route path="/books/:id" element={<RequireUser><BookDetailPage /></RequireUser>} />
            <Route path="/images/:id" element={<RequireUser><ImageDetailPage /></RequireUser>} />
            <Route path="/search" element={<RequireUser><SearchPage /></RequireUser>} />
            {/* 管理端 */}
            <Route path="/jobs" element={<RequireAdmin><JobsPage /></RequireAdmin>} />
            <Route path="/tags" element={<RequireUser><TagsPage /></RequireUser>} />
            <Route path="/settings" element={<RequireAdmin><SettingsPage /></RequireAdmin>} />
            {/* 工具箱：打包/集合为 member 级，分享标签页内部按角色隐藏（与 API 权限一致） */}
            <Route path="/tools" element={<RequireUser><ToolsPage /></RequireUser>} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      <GuestGate />
    </>
  )
}
