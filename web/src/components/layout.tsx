import { useEffect } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  BookOpen, Film, Image as ImageIcon, LayoutDashboard, LogOut, Menu, Music,
  Search, Settings, Tag, Type, Wrench, X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/stores/auth'
import { useUI } from '@/stores/ui'
import { STATS } from '@/mocks/data'
import { Button } from '@/components/ui'
import { PlayerBar } from '@/components/PlayerBar'
import { CommandPalette } from '@/components/CommandPalette'

const NAV = [
  { to: '/', label: '仪表盘', icon: LayoutDashboard, count: '' },
  { to: '/fonts', label: '字体', icon: Type, count: STATS.fontsFiles },
  { to: '/music', label: '音乐', icon: Music, count: STATS.albums + ' 张' },
  { to: '/videos', label: '视频', icon: Film, count: String(STATS.seriesCount + STATS.clips) },
  { to: '/books', label: '书籍', icon: BookOpen, count: '1.3w' },
  { to: '/images', label: '图片', icon: ImageIcon, count: STATS.images },
]

function Sidebar() {
  const user = useAuth((s) => s.user)
  const logout = useAuth((s) => s.logout)
  const sidebarOpen = useUI((s) => s.sidebarOpen)
  const setSidebar = useUI((s) => s.setSidebar)
  const nav = useNavigate()

  const inner = (
    <div className="flex h-full flex-col bg-slate-900 text-slate-300">
      <div className="flex h-16 shrink-0 items-center gap-2 border-b border-slate-800 px-5">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-brand-500 font-bold text-white">资</div>
        <div>
          <div className="text-sm font-semibold leading-tight text-white">个人资源门户</div>
          <div className="text-[10px] text-slate-500">Asset Portal</div>
        </div>
        <button className="ml-auto text-slate-400 md:hidden" onClick={() => setSidebar(false)}><X className="h-5 w-5" /></button>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4 text-sm">
        {NAV.map(({ to, label, icon: Icon, count }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            onClick={() => setSidebar(false)}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 transition',
                isActive ? 'bg-brand-600/20 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white',
              )
            }
          >
            <Icon className="h-4 w-4" />
            {label}
            {count && <span className={cn('ml-auto text-xs', to === '/' ? 'text-slate-500' : 'text-slate-500')}>{count}</span>}
          </NavLink>
        ))}
        <div className="mt-3 space-y-1 border-t border-slate-800 pt-3">
          <a className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-slate-400 hover:bg-slate-800 hover:text-white" onClick={() => nav('/tags')}>
            <Tag className="h-4 w-4" />标签管理
          </a>
          <a className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-slate-400 hover:bg-slate-800 hover:text-white" onClick={() => nav('/jobs')}>
            <Wrench className="h-4 w-4" />任务中心
            {STATS.jobsFailed > 0 && <span className="ml-auto rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] text-white">{STATS.jobsFailed}</span>}
          </a>
          <a className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-slate-400 hover:bg-slate-800 hover:text-white" onClick={() => nav('/settings')}>
            <Settings className="h-4 w-4" />设置
          </a>
        </div>
      </nav>

      <div className="flex shrink-0 items-center gap-3 border-t border-slate-800 p-4">
        {user ? (
          <>
            <div className="grid h-8 w-8 place-items-center rounded-full bg-brand-500 text-sm font-semibold text-white">
              {user.username[0].toUpperCase()}
            </div>
            <div className="min-w-0 text-sm">
              <div className="truncate text-white">{user.username}</div>
              <div className="text-[10px] text-slate-500">{user.role === 'admin' ? '管理员' : '注册用户'}</div>
            </div>
            <button className="ml-auto p-1.5 text-slate-400 hover:text-white" title="登出" onClick={() => { logout(); nav('/login') }}>
              <LogOut className="h-4 w-4" />
            </button>
          </>
        ) : (
          <>
            <div className="grid h-8 w-8 place-items-center rounded-full bg-slate-700 text-sm text-white">访</div>
            <div className="text-sm">
              <div className="text-white">未登录访客</div>
              <div className="text-[10px] text-slate-500">仅可浏览</div>
            </div>
            <Button size="sm" className="ml-auto" onClick={() => nav('/login')}>登录</Button>
          </>
        )}
      </div>
    </div>
  )

  return (
    <>
      <aside className="hidden w-60 shrink-0 md:block">{inner}</aside>
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSidebar(false)} />
          <div className="absolute inset-y-0 left-0 w-60">{inner}</div>
        </div>
      )}
    </>
  )
}

function Topbar() {
  const user = useAuth((s) => s.user)
  const setPalette = useUI((s) => s.setPalette)
  const setGate = useUI((s) => s.setGate)
  const setSidebar = useUI((s) => s.setSidebar)
  const nav = useNavigate()

  return (
    <>
      {user ? null : (
        <div className="bg-brand-600 px-4 py-1.5 text-center text-xs text-white">
          您正在以访客身份浏览：仅可查看资源列表。登录后可搜索、查看详情与在线预览、下载。
          <a className="font-medium underline" onClick={(e) => { e.preventDefault(); nav('/login') }} href="/login">立即登录 / 注册 →</a>
        </div>
      )}
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 md:px-6">
        <button className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 md:hidden" onClick={() => setSidebar(true)}>
          <Menu className="h-5 w-5" />
        </button>
        {user ? (
          <button
            className="flex w-64 max-w-full items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-400 transition hover:bg-slate-200 md:w-72 xl:w-80"
            onClick={() => setPalette(true)}
          >
            <Search className="h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate text-left">搜索字体、音乐、视频、书籍、图片…</span>
            <kbd className="shrink-0 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[10px]">⌘K</kbd>
          </button>
        ) : (
          <div
            className="flex w-72 max-w-full cursor-not-allowed select-none items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-400"
            title="登录后可搜索"
          >
            <Search className="h-4 w-4" />
            搜索（登录后可用）
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          {user?.role === 'admin' ? (
            <Button size="md" onClick={() => nav('/jobs')}>上传</Button>
          ) : user ? null : (
            <>
              <Button variant="outline" onClick={() => nav('/login')}>登录</Button>
              <Button onClick={() => nav('/login')}>注册</Button>
            </>
          )}
        </div>
      </header>
    </>
  )
}

export function AppShell() {
  const user = useAuth((s) => s.user)
  const setPalette = useUI((s) => s.setPalette)
  const setGate = useUI((s) => s.setGate)

  // 全局 ⌘K / Ctrl+K：访客弹登录引导
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        if (user) setPalette(true)
        else setGate(true)
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [user, setPalette, setGate])

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
        <PlayerBar />
      </div>
      <CommandPalette />
    </div>
  )
}
