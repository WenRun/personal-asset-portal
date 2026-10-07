import React, { useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Heart } from 'lucide-react'
import { cn, fmtDate } from '@/lib/utils'
import { useUI } from '@/stores/ui'
import { useAuth } from '@/stores/auth'

// ---------- Button ----------
type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'outline' | 'ghost' | 'dark'
  size?: 'sm' | 'md'
}
export function Button({ variant = 'primary', size = 'md', className, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition disabled:opacity-50 disabled:cursor-not-allowed',
        size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-2 text-sm',
        variant === 'primary' && 'bg-brand-600 text-white hover:bg-brand-700',
        variant === 'outline' && 'border border-slate-200 bg-white hover:bg-slate-50 text-slate-700',
        variant === 'ghost' && 'hover:bg-slate-100 text-slate-500',
        variant === 'dark' && 'bg-slate-900 text-white hover:bg-slate-700',
        className,
      )}
      {...props}
    />
  )
}

// ---------- Input ----------
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          'rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition placeholder:text-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-100',
          className,
        )}
        {...props}
      />
    )
  },
)

// ---------- Badge ----------
export function Badge({ tone = 'slate', className, children }: { tone?: 'slate' | 'brand' | 'green' | 'red' | 'amber' | 'violet'; className?: string; children: React.ReactNode }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-600',
    brand: 'bg-brand-100 text-brand-700',
    green: 'bg-emerald-100 text-emerald-700',
    red: 'bg-rose-100 text-rose-700',
    amber: 'bg-amber-100 text-amber-700',
    violet: 'bg-violet-100 text-violet-700',
  }
  return <span className={cn('inline-block rounded px-1.5 py-0.5 text-[10px] leading-4', tones[tone], className)}>{children}</span>
}

// ---------- Modal ----------
export function Modal({ open, onClose, className, children }: { open: boolean; onClose: () => void; className?: string; children: React.ReactNode }) {
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className={cn('rounded-2xl bg-white shadow-2xl', className)} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}

// ---------- FilterChips ----------
export function Chip({ active, onClick, children }: { active?: boolean; onClick?: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-full px-3 py-1.5 text-sm transition',
        active ? 'bg-brand-600 text-white' : 'border border-slate-200 bg-white text-slate-600 hover:border-brand-400',
      )}
    >
      {children}
    </button>
  )
}

// ---------- RatingStars ----------
export function RatingStars({ value, onChange, size = 'text-amber-400 text-lg' }: { value: number; onChange?: (v: number) => void; size?: string }) {
  return (
    <span className={cn('tracking-wide', size)}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={cn(i <= value ? 'text-amber-400' : 'text-slate-300', onChange && 'cursor-pointer hover:text-amber-300')}
          onClick={onChange ? () => onChange(i) : undefined}
        >
          ★
        </span>
      ))}
    </span>
  )
}

// ---------- HueCover（渐变占位封面，M0 接入真实缩略图后替换为 <img>） ----------
export function HueCover({ hue, dir = 135, className, children }: { hue: number; dir?: number; className?: string; children?: React.ReactNode }) {
  return (
    <div
      className={cn('relative overflow-hidden', className)}
      style={{ background: `linear-gradient(${dir}deg, hsl(${hue} 65% 58%), hsl(${(hue + 45) % 360} 60% 30%))` }}
    >
      {children}
    </div>
  )
}

// ---------- EqBars（正在播放动画） ----------
export function EqBars({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex h-3 items-end gap-0.5 align-middle', className)}>
      {[60, 100, 40].map((h, i) => (
        <i key={i} className="w-0.5 origin-bottom rounded bg-brand-500 animate-eq" style={{ height: `${h}%`, animationDelay: `${i * 0.15}s` }} />
      ))}
    </span>
  )
}

// ---------- PageHeader ----------
export function PageHeader({ title, sub, right }: { title: string; sub?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
      <h1 className="shrink-0 whitespace-nowrap text-xl font-bold">{title}</h1>
      {sub && <span className="min-w-0 text-sm text-slate-400">{sub}</span>}
      {right && <div className="ml-auto flex shrink-0 items-center gap-2">{right}</div>}
    </div>
  )
}

// ---------- GuestGate（访客点击卡片 → 注册引导，对应原型 07 的弹层） ----------
export function GuestGate() {
  const open = useUI((s) => s.gateOpen)
  const setGate = useUI((s) => s.setGate)
  const nav = useNavigate()
  return (
    <Modal open={open} onClose={() => setGate(false)} className="w-[360px] p-8 text-center">
      <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-brand-50">
        <Heart className="h-6 w-6 text-brand-600" />
      </div>
      <div className="mb-1 font-semibold">登录后可查看详情与预览</div>
      <p className="mb-5 text-sm text-slate-500">访客仅可浏览资源列表；搜索、详情预览、在线播放与下载均需登录。</p>
      <Button className="w-full" onClick={() => { setGate(false); nav('/login') }}>登录 / 注册</Button>
      <Button variant="outline" className="mt-2 w-full" onClick={() => setGate(false)}>继续随便逛逛</Button>
    </Modal>
  )
}

// ---------- RequireLink（未登录点击 → 引导弹层） ----------
export function useAssetNav() {
  const user = useAuth((s) => s.user)
  const setGate = useUI((s) => s.setGate)
  const nav = useNavigate()
  return (to: string) => {
    if (!user) setGate(true)
    else nav(to)
  }
}

// ---------- BackLink ----------
export function BackLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link to={to} className="flex items-center gap-1 text-sm text-slate-500 transition hover:text-brand-600">
      ← {children}
    </Link>
  )
}

// ---------- 日期小助手 ----------
export { fmtDate }
