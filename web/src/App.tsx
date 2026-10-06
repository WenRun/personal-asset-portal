import { useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/layout'
import { GuestGate } from '@/components/ui'
import { useAuth } from '@/stores/auth'
import type { ReactNode } from 'react'

import { LoginPage } from '@/features/auth/LoginPage'
import { DashboardPage } from '@/features/dashboard/DashboardPage'
import { FontsPage } from '@/features/fonts/FontsPage'
import { FontDetailPage } from '@/features/fonts/FontDetailPage'
import { MusicPage } from '@/features/music/MusicPage'
import { AlbumDetailPage } from '@/features/music/AlbumDetailPage'
import { VideosPage } from '@/features/videos/VideosPage'
import { VideoDetailPage } from '@/features/videos/VideoDetailPage'
import { BooksPage } from '@/features/books/BooksPage'
import { BookDetailPage } from '@/features/books/BookDetailPage'
import { ImagesPage } from '@/features/images/ImagesPage'
import { ImageDetailPage } from '@/features/images/ImageDetailPage'
import { SearchPage } from '@/features/search/SearchPage'
import { JobsPage } from '@/features/admin/JobsPage'
import { TagsPage } from '@/features/admin/TagsPage'
import { SettingsPage } from '@/features/admin/SettingsPage'

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
      <Routes>
        <Route path="/login" element={<LoginPage />} />
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
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <GuestGate />
    </>
  )
}
