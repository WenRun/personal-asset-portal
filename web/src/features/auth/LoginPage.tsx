import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '@/stores/auth'
import { Button, Input } from '@/components/ui'

export function LoginPage() {
  const user = useAuth((s) => s.user)
  const login = useAuth((s) => s.login)
  const nav = useNavigate()
  const [tab, setTab] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  if (user) return <Navigate to="/" replace />

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    setErr('')
    setBusy(true)
    try {
      await (tab === 'login' ? login(username, password) : login(username, password))
      nav('/')
    } catch (ex) {
      setErr((ex as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const quick = (u: string, p: string) => { setUsername(u); setPassword(p); setErr('') }

  return (
    <div className="grid min-h-screen place-items-center bg-gradient-to-br from-brand-50 via-brand-100 to-brand-200 p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center justify-center gap-2.5">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-brand-600 text-lg font-bold text-white shadow-lg">资</div>
          <div>
            <div className="text-xl font-bold">个人资源门户</div>
            <div className="text-xs text-slate-500">字体 · 音乐 · 视频 · 书籍 · 图片</div>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
          <div className="grid grid-cols-2 text-sm font-medium">
            <button
              className={`border-b-2 py-3 transition ${tab === 'login' ? 'border-brand-600 bg-white text-brand-600' : 'border-transparent bg-slate-50 text-slate-400 hover:text-slate-600'}`}
              onClick={() => setTab('login')}
            >登录</button>
            <button
              className={`border-b-2 py-3 transition ${tab === 'register' ? 'border-brand-600 bg-white text-brand-600' : 'border-transparent bg-slate-50 text-slate-400 hover:text-slate-600'}`}
              onClick={() => setTab('register')}
            >注册</button>
          </div>
          <form className="space-y-4 p-6" onSubmit={submit}>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">用户名</label>
              <Input className="w-full" placeholder="username" value={username} onChange={(e) => setUsername(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">密码</label>
              <Input className="w-full" type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            {err && <div className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600">{err}</div>}
            <div className="flex items-center justify-between text-xs">
              <label className="flex items-center gap-1.5 text-slate-500"><input type="checkbox" defaultChecked className="accent-brand-600" />记住我（30 天）</label>
              <span className="text-slate-400">argon2id + 服务端会话</span>
            </div>
            <Button type="submit" className="w-full" disabled={busy}>{busy ? '请稍候…' : tab === 'login' ? '登 录' : '注 册'}</Button>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" className="flex-1" onClick={() => quick('admin', 'admin1234')}>填入管理员</Button>
              <Button type="button" variant="outline" size="sm" className="flex-1" onClick={() => quick('demo', 'demo1234')}>填入普通用户</Button>
            </div>
          </form>
          <div className="px-6 pb-5 text-xs leading-relaxed text-slate-400">
            注册当前开放，注册后可搜索、预览与下载；上传与系统设置仅管理员可用。首个管理员账号由部署环境变量创建。
          </div>
        </div>

        <div className="mt-6 text-center">
          <button className="text-xs text-slate-400 underline hover:text-brand-600" onClick={() => nav('/videos')}>以访客身份浏览 →</button>
        </div>
      </div>
    </div>
  )
}
