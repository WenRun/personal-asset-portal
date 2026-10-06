import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Download, Link2, Package, Plus, Trash2 } from 'lucide-react'
import { api } from '@/api/client'
import { useAssetNav } from '@/components/ui'
import { Badge, Button, Chip, PageHeader } from '@/components/ui'
import { fmtTime } from '@/lib/utils'

const TYPES = [
  { key: 'font', label: '字体' },
  { key: 'music', label: '音乐' },
  { key: 'video', label: '视频' },
  { key: 'book', label: '书籍' },
  { key: 'image', label: '图片' },
]

/** M6 工具箱（admin）：打包下载 / 分享链接 / 智能集合 */
export function ToolsPage() {
  const qc = useQueryClient()
  const nav = useAssetNav()
  const [tab, setTab] = useState<'pack' | 'share' | 'collection'>('pack')
  const [packType, setPackType] = useState('image')
  const [packFav, setPackFav] = useState(false)
  const [shareAsset, setShareAsset] = useState('')
  const [shareDays, setShareDays] = useState(3)
  const [shareDl, setShareDl] = useState(true)
  const [copied, setCopied] = useState('')
  const [colName, setColName] = useState('')
  const [colType, setColType] = useState('font')
  const [colQ, setColQ] = useState('')

  const { data: packs } = useQuery({ queryKey: ['packs'], queryFn: api.packs, refetchInterval: 8_000 })
  const { data: shares } = useQuery({ queryKey: ['shares'], queryFn: api.shares })
  const { data: collections } = useQuery({ queryKey: ['collections'], queryFn: api.collections })

  const createPack = useMutation({
    mutationFn: () => api.createPack({ type: packType, favorite: packFav }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['packs'] }),
  })
  const createShare = useMutation({
    mutationFn: () => api.createShare(shareAsset.trim(), shareDays * 24, shareDl),
    onSuccess: () => { setShareAsset(''); void qc.invalidateQueries({ queryKey: ['shares'] }) },
  })
  const revoke = useMutation({
    mutationFn: (token: string) => api.revokeShare(token),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shares'] }),
  })
  const createCol = useMutation({
    mutationFn: () => api.createCollection(colName.trim(), colType, colQ.trim() ? { q: colQ.trim() } : {}),
    onSuccess: () => { setColName(''); setColQ(''); void qc.invalidateQueries({ queryKey: ['collections'] }) },
  })
  const delCol = useMutation({
    mutationFn: (id: string) => api.deleteCollection(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['collections'] }),
  })

  const copy = (text: string) => {
    void navigator.clipboard.writeText(location.origin + text)
    setCopied(text)
    setTimeout(() => setCopied(''), 2000)
  }

  return (
    <div className="p-4 md:p-6">
      <PageHeader title="工具箱" sub="打包下载 · 分享链接 · 智能集合（M6）" />

      <div className="mt-4 flex w-fit gap-1 rounded-lg bg-slate-200/70 p-1 text-sm">
        {([['pack', '打包下载', Package], ['share', '分享链接', Link2], ['collection', '智能集合', Plus]] as const).map(([k, label, Icon]) => (
          <button key={k} className={`flex items-center gap-1.5 rounded-md px-4 py-1.5 transition ${tab === k ? 'bg-white font-medium shadow-sm' : 'text-slate-500 hover:text-slate-700'}`} onClick={() => setTab(k)}>
            <Icon className="h-3.5 w-3.5" />{label}
          </button>
        ))}
      </div>

      {tab === 'pack' && (
        <div className="mt-4 max-w-3xl">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-3 text-sm font-semibold">新建打包</div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-slate-400">类型</span>
              {TYPES.map((t) => (
                <Chip key={t.key} active={packType === t.key} onClick={() => setPackType(t.key)}>{t.label}</Chip>
              ))}
              <label className="ml-2 flex items-center gap-1.5 text-slate-500">
                <input type="checkbox" className="accent-brand-600" checked={packFav} onChange={(e) => setPackFav(e.target.checked)} />仅收藏
              </label>
              <Button size="sm" className="ml-auto" disabled={createPack.isPending} onClick={() => createPack.mutate()}>
                <Package className="h-3.5 w-3.5" />创建打包
              </Button>
            </div>
          </div>

          <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-400"><tr>
                <th className="px-4 py-2 text-left font-medium">状态</th>
                <th className="px-4 py-2 text-left font-medium">内容</th>
                <th className="px-4 py-2 text-left font-medium">文件数</th>
                <th className="px-4 py-2 text-left font-medium">大小</th>
                <th className="px-4 py-2 text-left font-medium">创建时间</th>
                <th></th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {(packs ?? []).map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-2.5">
                      <Badge tone={p.status === 'done' ? 'green' : p.status === 'failed' ? 'red' : p.status === 'running' ? 'brand' : 'slate'}>
                        {p.status === 'done' ? '完成' : p.status === 'failed' ? '失败' : p.status === 'running' ? '打包中' : '队列中'}
                      </Badge>
                      {p.error && <div className="mt-0.5 text-[10px] text-rose-500">{p.error}</div>}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{String(p.params.type ?? "指定资产")}{p.params.favorite ? "（仅收藏）" : ""}</td>
                    <td className="px-4 py-2.5 text-slate-400">{p.file_count ?? '—'}</td>
                    <td className="px-4 py-2.5 text-slate-400">{p.size_bytes ? `${(p.size_bytes / 1048576).toFixed(2)}MB` : '—'}</td>
                    <td className="px-4 py-2.5 text-slate-400">{new Date(p.created_at).toLocaleString('zh-CN')}</td>
                    <td className="px-4 py-2.5 text-right">
                      {p.status === 'done' && (
                        <a href={api.packFileUrl(p.id)} className="inline-flex items-center gap-1 text-xs text-brand-600 hover:underline">
                          <Download className="h-3.5 w-3.5" />下载
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
                {(packs ?? []).length === 0 && (
                  <tr><td colSpan={6} className="p-10 text-center text-slate-400">还没有打包记录</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'share' && (
        <div className="mt-4 max-w-3xl space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-3 text-sm font-semibold">新建分享（带过期时间，可选允许下载）</div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <input
                value={shareAsset} onChange={(e) => setShareAsset(e.target.value)}
                placeholder="资产 UUID（可从各详情页地址栏取）"
                className="min-w-56 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-brand-500"
              />
              <span className="text-slate-400">过期</span>
              <input type="number" min={1} max={720} value={shareDays} onChange={(e) => setShareDays(Number(e.target.value))} className="w-16 rounded-lg border border-slate-200 px-2 py-2 text-center text-xs" />
              <span className="text-slate-400">天</span>
              <label className="flex items-center gap-1.5 text-slate-500">
                <input type="checkbox" className="accent-brand-600" checked={shareDl} onChange={(e) => setShareDl(e.target.checked)} />允许下载
              </label>
              <Button size="sm" disabled={!shareAsset.trim() || createShare.isPending} onClick={() => createShare.mutate()}>生成链接</Button>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-400"><tr>
                <th className="px-4 py-2 text-left font-medium">资产</th><th className="px-4 py-2 text-left font-medium">权限</th>
                <th className="px-4 py-2 text-left font-medium">过期时间</th><th className="px-4 py-2 text-left font-medium">链接</th><th></th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {(shares ?? []).map((s) => (
                  <tr key={s.token} className={s.expired ? 'opacity-50' : ''}>
                    <td className="px-4 py-2.5 text-slate-600">{s.asset_title}</td>
                    <td className="px-4 py-2.5">{s.allow_download ? '预览+下载' : '仅预览'}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-400">{new Date(s.expires_at).toLocaleString('zh-CN')}{s.expired && '（已过期）'}</td>
                    <td className="px-4 py-2.5">
                      <button className="inline-flex items-center gap-1 text-xs text-brand-600 hover:underline" onClick={() => copy(`/share/${s.token}`)}>
                        <Copy className="h-3 w-3" />{copied === `/share/${s.token}` ? '已复制' : '复制链接'}
                      </button>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button className="text-slate-300 hover:text-rose-500" onClick={() => revoke.mutate(s.token)}><Trash2 className="h-4 w-4" /></button>
                    </td>
                  </tr>
                ))}
                {(shares ?? []).length === 0 && (
                  <tr><td colSpan={5} className="p-10 text-center text-slate-400">还没有分享链接</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'collection' && (
        <div className="mt-4 max-w-3xl space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-3 text-sm font-semibold">新建智能集合（保存的筛选条件）</div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <input value={colName} onChange={(e) => setColName(e.target.value)} placeholder="集合名称"
                className="w-40 rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-brand-500" />
              <select value={colType} onChange={(e) => setColType(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-2 text-xs">
                {TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
              <input value={colQ} onChange={(e) => setColQ(e.target.value)} placeholder="关键词（可空）"
                className="w-44 rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-brand-500" />
              <Button size="sm" disabled={!colName.trim() || createCol.isPending} onClick={() => createCol.mutate()}>保存</Button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {(collections ?? []).map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
                <button className="min-w-0 text-left" onClick={() => nav(`/${c.asset_type ?? 'fonts'}?q=${encodeURIComponent(String(c.params?.q ?? ''))}`)}>
                  <div className="truncate font-medium hover:text-brand-600">{c.name}</div>
                  <div className="truncate text-[10px] text-slate-400">{c.asset_type} {c.params?.q ? `· 「${String(c.params.q)}」` : ''}</div>
                </button>
                <button className="text-slate-300 hover:text-rose-500" onClick={() => delCol.mutate(c.id)}><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
            {(collections ?? []).length === 0 && (
              <div className="col-span-full rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-400">还没有智能集合</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
