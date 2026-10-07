import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, CheckCircle2, RefreshCw, ScanSearch } from 'lucide-react'
import { api } from '@/api/client'
import { usePrefs } from '@/stores/prefs'
import { Badge, Button, Input, PageHeader } from '@/components/ui'
import { cn } from '@/lib/utils'

export function SettingsPage() {
  const qc = useQueryClient()
  const { fontText, setFontPreview } = usePrefs()
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.settings })
  const [regOpen, setRegOpen] = useState<boolean | null>(null)
  const effectiveOpen = regOpen ?? settings?.registration_open ?? true
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const update = useMutation({
    mutationFn: (patch: { registration_open: boolean }) => api.updateSettings(patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  })

  const showToast = (kind: 'ok' | 'err', text: string) => {
    setToast({ kind, text })
    if (kind === 'ok') setTimeout(() => setToast(null), 8000) // 错误常驻需手动关，与上传一致
  }
  const scanOne = useMutation({
    mutationFn: (alias: string) => api.scan(alias),
    onSuccess: (_d, alias) => showToast('ok', `已创建「${alias}」扫描任务，指纹/解析/索引链路在任务中心实时可见`),
    onError: (e) => showToast('err', (e as Error).message),
  })
  const scanAll = useMutation({
    mutationFn: async () => {
      for (const r of settings?.scan_roots ?? []) await api.scan(r.alias)
    },
    onSuccess: () => showToast('ok', `已创建全部 ${settings?.scan_roots.length ?? 0} 个目录的扫描任务，入库进度见任务中心`),
    onError: (e) => showToast('err', (e as Error).message),
  })

  return (
    <div className="p-4 md:p-6">
      <PageHeader title="系统设置" sub="运行期配置存 settings 表（真实读写）" />

      <div className="mt-4 max-w-2xl space-y-4">
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-1 text-sm font-semibold">注册开关</div>
          <p className="mb-3 text-xs text-slate-400">关闭后仅管理员可创建账号（详细设计 §4.7）。</p>
          <button
            className={`relative h-6 w-11 rounded-full transition ${effectiveOpen ? 'bg-brand-600' : 'bg-slate-300'}`}
            onClick={() => { setRegOpen(!effectiveOpen); update.mutate({ registration_open: !effectiveOpen }) }}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${effectiveOpen ? 'left-[22px]' : 'left-0.5'}`} />
          </button>
          <span className="ml-3 text-sm text-slate-500">{effectiveOpen ? '开放注册' : '已关闭'}</span>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-1 text-sm font-semibold">字体样张默认文案</div>
          <p className="mb-3 text-xs text-slate-400">字体样张墙与详情页的全局预览文案（当前存浏览器本地，M2 移入服务端设置）。</p>
          <Input className="w-full" value={fontText} onChange={(e) => setFontPreview({ fontText: e.target.value })} />
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-1 flex items-center justify-between">
            <div className="text-sm font-semibold">资源根目录（scan_roots）</div>
            <Button
              size="sm" variant="outline"
              disabled={scanAll.isPending || (settings?.scan_roots ?? []).length === 0}
              onClick={() => scanAll.mutate()}
            >
              <ScanSearch className="h-3.5 w-3.5" />{scanAll.isPending ? '扫描中…' : '全部扫描'}
            </Button>
          </div>
          <p className="mb-3 text-xs text-slate-400">
            把文件放入对应目录（子目录会递归扫描）后点「扫描」入库；storage_key = &#123;root_alias&#125;:&#123;相对路径&#125;；原始文件只读不搬移。
          </p>
          <div className="overflow-hidden rounded-lg border border-slate-100 text-sm">
            {(settings?.scan_roots ?? []).map((r) => (
              <div key={r.alias} className="flex items-center gap-3 border-b border-slate-100 px-3 py-2 last:border-0">
                <Badge tone="brand">{r.alias}:</Badge>
                <code className="min-w-0 truncate font-mono text-xs text-slate-500">{r.path}</code>
                <Button
                  size="sm" variant="ghost" className="ml-auto shrink-0"
                  disabled={scanOne.isPending}
                  onClick={() => scanOne.mutate(r.alias)}
                  title={`扫描 ${r.path}`}
                >
                  <RefreshCw className="h-3 w-3" />扫描
                </Button>
              </div>
            ))}
            {(settings?.scan_roots ?? []).length === 0 && (
              <div className="p-4 text-center text-xs text-slate-400">加载中…</div>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-rose-200 bg-rose-50/50 p-5">
          <div className="mb-1 text-sm font-semibold text-rose-700">备份</div>
          <p className="text-xs leading-relaxed text-rose-500">
            pg_dump + rsync /data/library；派生物可全量重建，不纳入备份（M6 交付 cron 脚本）。
          </p>
        </section>
      </div>

      {toast && (
        <div className="fixed right-4 top-20 z-[60] max-w-md">
          <div
            className={cn(
              'flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm shadow-xl',
              toast.kind === 'err' ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700',
            )}
          >
            {toast.kind === 'err' ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
            <span className="min-w-0 break-all">{toast.text}</span>
            <button className="ml-2 shrink-0 opacity-50 hover:opacity-100" onClick={() => setToast(null)}>✕</button>
          </div>
        </div>
      )}
    </div>
  )
}
