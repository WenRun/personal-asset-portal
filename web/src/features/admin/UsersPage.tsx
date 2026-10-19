import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Search, ShieldCheck, ShieldOff, Trash2, UserCheck, UserX } from 'lucide-react'
import { api, type AdminUser } from '@/api/client'
import { useAuth } from '@/stores/auth'
import { Badge, Button, Input, Modal, PageHeader } from '@/components/ui'

const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' }) : '—'

const actBtn = 'rounded p-1.5 text-slate-400 transition hover:bg-slate-100'

/** 用户管理（§6.1）：admin 查看全部用户，改角色 / 停用启用 / 重置密码 / 删除。
 *  本人行不展示操作（后端亦有护栏：不能停用/删除自己、不能动最后一名管理员）。 */
export function UsersPage() {
  const qc = useQueryClient()
  const me = useAuth((s) => s.user)
  const { data, isLoading } = useQuery({ queryKey: ['admin-users'], queryFn: () => api.adminUsers() })
  const [q, setQ] = useState('')
  const [err, setErr] = useState('')
  // 重置密码弹层
  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [resetErr, setResetErr] = useState('')

  const users = data?.items ?? []
  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase()
    if (!kw) return users
    return users.filter((u) =>
      [u.username, u.email ?? '', u.phone ?? ''].some((v) => v.toLowerCase().includes(kw)),
    )
  }, [users, q])

  const refresh = () => void qc.invalidateQueries({ queryKey: ['admin-users'] })

  const patch = useMutation({
    mutationFn: (p: { id: string; body: { role?: 'admin' | 'member'; is_active?: boolean } }) => api.patchUser(p.id, p.body),
    onSuccess: () => { setErr(''); refresh() },
    onError: (e) => setErr((e as Error).message),
  })
  const resetPwd = useMutation({
    mutationFn: () => {
      if (!resetTarget) throw new Error('未选择用户')
      return api.resetUserPassword(resetTarget.id, newPassword)
    },
    onSuccess: () => { setResetTarget(null); setNewPassword(''); setResetErr('') },
    onError: (e) => setResetErr((e as Error).message),
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteUser(id),
    onSuccess: () => { setErr(''); refresh() },
    onError: (e) => setErr((e as Error).message),
  })

  const confirmRemove = (u: AdminUser) => {
    if (confirm(`删除用户「${u.username}」？\n将同时删除其登录会话、收藏、打包、集合、进度与分享记录，且不可恢复。`)) {
      remove.mutate(u.id)
    }
  }

  return (
    <div className="p-4 md:p-6">
      <PageHeader
        title="用户管理"
        sub={`共 ${data?.total ?? 0} 位用户；管理角色、启停账号、重置密码与删除`}
        right={
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              className="w-56 pl-9"
              placeholder="搜索用户名 / 邮箱 / 手机号"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        }
      />

      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-xs text-slate-400">
              <th className="px-4 py-3 font-medium">用户</th>
              <th className="px-4 py-3 font-medium">角色</th>
              <th className="px-4 py-3 font-medium">状态</th>
              <th className="px-4 py-3 font-medium">邮箱</th>
              <th className="px-4 py-3 font-medium">手机号</th>
              <th className="px-4 py-3 font-medium">注册时间</th>
              <th className="px-4 py-3 font-medium">最后登录</th>
              <th className="px-4 py-3 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400">加载中…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400">{q ? '没有匹配的用户' : '还没有用户'}</td></tr>
            ) : filtered.map((u) => {
              const self = u.id === me?.id
              return (
                <tr key={u.id} className={u.is_active ? 'border-b border-slate-50 last:border-0' : 'border-b border-slate-50 last:border-0 opacity-60'}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-500 text-sm font-semibold text-white">
                        {u.username[0].toUpperCase()}
                      </div>
                      <span className="font-medium text-slate-800">{u.username}</span>
                      {self && <Badge tone="brand">我</Badge>}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {u.role === 'admin' ? <Badge tone="violet">管理员</Badge> : <Badge>注册用户</Badge>}
                  </td>
                  <td className="px-4 py-3">
                    {u.is_active ? <Badge tone="green">正常</Badge> : <Badge tone="red">已停用</Badge>}
                  </td>
                  <td className="max-w-44 truncate px-4 py-3 text-slate-500">{u.email ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-500">{u.phone ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-500">{fmtTime(u.created_at)}</td>
                  <td className="px-4 py-3 text-slate-500">{fmtTime(u.last_login_at)}</td>
                  <td className="px-4 py-3">
                    {self ? (
                      <span className="text-xs text-slate-300">当前登录</span>
                    ) : (
                      <div className="flex items-center justify-end gap-0.5">
                        {u.role === 'admin' ? (
                          <button className={`${actBtn} hover:bg-slate-100 hover:text-slate-600`} title="设为普通用户"
                            onClick={() => patch.mutate({ id: u.id, body: { role: 'member' } })}>
                            <ShieldOff className="h-4 w-4" />
                          </button>
                        ) : (
                          <button className={`${actBtn} hover:bg-brand-50 hover:text-brand-600`} title="设为管理员"
                            onClick={() => patch.mutate({ id: u.id, body: { role: 'admin' } })}>
                            <ShieldCheck className="h-4 w-4" />
                          </button>
                        )}
                        {u.is_active ? (
                          <button className={`${actBtn} hover:bg-amber-50 hover:text-amber-600`} title="停用账号（立即踢下线）"
                            onClick={() => patch.mutate({ id: u.id, body: { is_active: false } })}>
                            <UserX className="h-4 w-4" />
                          </button>
                        ) : (
                          <button className={`${actBtn} hover:bg-green-50 hover:text-green-600`} title="启用账号"
                            onClick={() => patch.mutate({ id: u.id, body: { is_active: true } })}>
                            <UserCheck className="h-4 w-4" />
                          </button>
                        )}
                        <button className={`${actBtn} hover:bg-slate-100 hover:text-slate-600`} title="重置密码"
                          onClick={() => { setResetTarget(u); setNewPassword(''); setResetErr('') }}>
                          <KeyRound className="h-4 w-4" />
                        </button>
                        <button className={`${actBtn} hover:bg-rose-50 hover:text-rose-600`} title="删除用户"
                          onClick={() => confirmRemove(u)}>
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {err && <div className="mt-2 text-xs text-rose-600">{err}</div>}

      <Modal open={!!resetTarget} onClose={() => setResetTarget(null)} className="w-[380px] p-6">
        <div className="mb-4 font-semibold">重置「{resetTarget?.username}」的密码</div>
        <div className="space-y-3 text-sm">
          <div>
            <div className="mb-1 text-xs text-slate-400">新密码（至少 8 位）</div>
            <Input
              className="w-full" type="password" value={newPassword} placeholder="输入新密码" autoFocus
              onChange={(e) => setNewPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && newPassword.length >= 8) resetPwd.mutate() }}
            />
          </div>
          <p className="text-xs text-slate-400">重置后该用户的所有登录会话立即失效，需用新密码重新登录。</p>
          {resetErr && <div className="text-xs text-rose-600">{resetErr}</div>}
          <div className="flex gap-2 pt-1">
            <Button className="flex-1" disabled={newPassword.length < 8 || resetPwd.isPending} onClick={() => resetPwd.mutate()}>
              重置
            </Button>
            <Button variant="outline" onClick={() => setResetTarget(null)}>取消</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
