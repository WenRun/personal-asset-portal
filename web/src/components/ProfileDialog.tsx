import { useEffect, useState } from 'react'
import { useAuth } from '@/stores/auth'
import { useUI } from '@/stores/ui'
import { Badge, Button, Input, Modal } from '@/components/ui'

// ---------- ProfileDialog（点击侧栏头像区 → 修改用户名 / 密码） ----------
export function ProfileDialog() {
  const open = useUI((s) => s.profileOpen)
  const setProfile = useUI((s) => s.setProfile)
  const user = useAuth((s) => s.user)
  const updateProfile = useAuth((s) => s.updateProfile)

  const [username, setUsername] = useState('')
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  // 每次打开时重置为当前资料
  useEffect(() => {
    if (open) {
      setUsername(user?.username ?? '')
      setCurrent(''); setNext(''); setConfirm(''); setErr('')
    }
  }, [open, user?.username])

  if (!user) return null
  const name = username.trim()
  const wantName = name !== user.username
  const wantPass = next.length > 0
  const dirty = wantName || wantPass

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    setErr('')
    if (wantName && (name.length < 2 || name.length > 32)) { setErr('用户名需 2–32 个字符'); return }
    if (wantPass) {
      if (next.length < 8) { setErr('新密码至少 8 位'); return }
      if (next !== confirm) { setErr('两次输入的新密码不一致'); return }
    }
    if (!dirty) return
    setBusy(true)
    try {
      await updateProfile({
        ...(wantName ? { username: name } : {}),
        ...(wantPass ? { current_password: current, new_password: next } : {}),
      })
      setProfile(false)
    } catch (ex) {
      setErr((ex as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={() => setProfile(false)} className="w-[380px] p-6">
      <div className="mb-5 flex items-center gap-3">
        <div className="grid h-11 w-11 place-items-center rounded-full bg-brand-500 text-base font-semibold text-white">
          {user.username[0].toUpperCase()}
        </div>
        <div>
          <div className="text-sm font-semibold text-slate-900">个人资料</div>
          <div className="mt-0.5 flex items-center gap-1.5">
            <span className="text-xs text-slate-400">{user.role === 'admin' ? '管理员' : '注册用户'}</span>
            <Badge tone={user.role === 'admin' ? 'brand' : 'slate'}>{user.role}</Badge>
          </div>
        </div>
      </div>

      <form className="space-y-4" onSubmit={submit}>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">用户名（2–32 个字符）</label>
          <Input className="w-full" maxLength={32} value={username} onChange={(e) => setUsername(e.target.value)} />
        </div>

        <div className="border-t border-slate-100 pt-4">
          <div className="mb-3 text-xs font-medium text-slate-400">修改密码（不修改请全部留空）</div>
          <div className="space-y-3">
            <Input className="w-full" type="password" placeholder="当前密码" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
            <Input className="w-full" type="password" placeholder="新密码（至少 8 位）" autoComplete="new-password" maxLength={128} value={next} onChange={(e) => setNext(e.target.value)} />
            <Input className="w-full" type="password" placeholder="确认新密码" autoComplete="new-password" maxLength={128} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
        </div>

        {err && <div className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600">{err}</div>}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={() => setProfile(false)}>取消</Button>
          <Button type="submit" disabled={busy || !dirty}>{busy ? '保存中…' : '保存'}</Button>
        </div>
      </form>
    </Modal>
  )
}
