import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle, Check, CheckCircle2, Pencil, Plus, RefreshCw, ScanSearch, Sparkles, Trash2,
} from 'lucide-react'
import { api } from '@/api/client'
import { usePrefs } from '@/stores/prefs'
import { Badge, Button, Input, Modal, PageHeader } from '@/components/ui'
import { cn } from '@/lib/utils'
import type { AssetType, ScanRoot } from '@/types'

const ALL_ASSET_TYPES: { type: AssetType; label: string }[] = [
  { type: 'font', label: '字体' },
  { type: 'music', label: '音乐' },
  { type: 'video', label: '视频' },
  { type: 'book', label: '书籍' },
  { type: 'image', label: '图片' },
]

const TYPE_TONES: Record<AssetType, 'slate' | 'violet' | 'amber' | 'brand' | 'green'> = {
  font: 'slate',
  music: 'violet',
  video: 'amber',
  book: 'brand',
  image: 'green',
}

export function SettingsPage() {
  const qc = useQueryClient()
  const { fontText, setFontPreview } = usePrefs()
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.settings })
  const [regOpen, setRegOpen] = useState<boolean | null>(null)
  const effectiveOpen = regOpen ?? settings?.registration_open ?? true
  const [uploadLimit, setUploadLimit] = useState<number | null>(null)
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  // 根目录配置弹窗状态
  const [modalOpen, setModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState<'add' | 'edit'>('add')
  const [editingAlias, setEditingAlias] = useState('')
  const [formAlias, setFormAlias] = useState('')
  const [formPath, setFormPath] = useState('')
  const [formTypes, setFormTypes] = useState<AssetType[]>([])

  const update = useMutation({
    mutationFn: (patch: {
      scan_roots?: ScanRoot[]; registration_open?: boolean; max_upload_gb?: number
      ai?: { enabled?: boolean; base_url?: string; api_key?: string; model?: string; proxy_url?: string; timeout_seconds?: number }
    }) => api.updateSettings(patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  })

  // ---- AI 识别配置（本地表单态：null = 沿用已保存值，输入过才覆盖提交）----
  const ai = settings?.ai
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null)
  const aiOn = aiEnabled ?? ai?.enabled ?? false
  const [aiBaseUrl, setAiBaseUrl] = useState<string | null>(null)
  const effBaseUrl = aiBaseUrl ?? ai?.base_url ?? ''
  const [aiModel, setAiModel] = useState<string | null>(null)
  const effModel = aiModel ?? ai?.model ?? ''
  const [aiKey, setAiKey] = useState('')
  const [aiProxy, setAiProxy] = useState<string | null>(null)
  const effProxy = aiProxy ?? ai?.proxy_url ?? ''
  const [aiTimeout, setAiTimeout] = useState<number | null>(null)
  const effTimeout = aiTimeout ?? ai?.timeout_seconds ?? 90
  const [aiTestResult, setAiTestResult] = useState<{ ok: boolean; text: string } | null>(null)

  const aiDirty = aiEnabled !== null || aiBaseUrl !== null || aiModel !== null || aiProxy !== null
    || aiTimeout !== null || aiKey.trim() !== '' || (ai?.enabled ?? false) !== aiOn

  const aiTest = useMutation({
    mutationFn: () => api.aiTest({
      base_url: effBaseUrl.trim(),
      model: effModel.trim(),
      // key 输入框留空 = 用已保存的 key（后端回落），填了 = 用新填的值试
      ...(aiKey.trim() ? { api_key: aiKey.trim() } : {}),
      ...(effProxy.trim() ? { proxy_url: effProxy.trim() } : {}),
      timeout_seconds: Math.min(effTimeout, 60),
    }),
    onSuccess: (r) => setAiTestResult({ ok: true, text: `连通正常 · ${r.model} · ${(r.latency_ms / 1000).toFixed(1)}s · 模型看到的小图是「${r.reply}」` }),
    onError: (e) => setAiTestResult({ ok: false, text: (e as Error).message }),
  })

  const saveAi = () => {
    update.mutate(
      {
        ai: {
          enabled: aiOn,
          base_url: effBaseUrl.trim(),
          model: effModel.trim(),
          proxy_url: effProxy.trim(),
          timeout_seconds: effTimeout,
          ...(aiKey.trim() ? { api_key: aiKey.trim() } : {}),
        },
      },
      {
        onSuccess: () => {
          setAiKey('')
          setAiBaseUrl(null); setAiModel(null); setAiProxy(null); setAiTimeout(null); setAiEnabled(null)
          showToast('ok', 'AI 识别配置已保存（worker 即时生效，无需重启）')
        },
        onError: (e) => showToast('err', (e as Error).message),
      },
    )
  }

  const showToast = (kind: 'ok' | 'err', text: string) => {
    setToast({ kind, text })
    if (kind === 'ok') setTimeout(() => setToast(null), 8000)
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

  const openAddModal = () => {
    setModalMode('add')
    setEditingAlias('')
    setFormAlias('')
    setFormPath('')
    setFormTypes(['music']) // 默认示例
    setModalOpen(true)
  }

  const openEditModal = (r: ScanRoot) => {
    setModalMode('edit')
    setEditingAlias(r.alias)
    setFormAlias(r.alias)
    setFormPath(r.path)
    setFormTypes(r.types ?? [])
    setModalOpen(true)
  }

  const handleSaveModal = () => {
    const alias = formAlias.trim()
    const path = formPath.trim()
    if (!alias) {
      showToast('err', '根目录别名不能为空')
      return
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(alias)) {
      showToast('err', '根目录别名仅支持英文、数字、中划线与下划线')
      return
    }
    if (!path) {
      showToast('err', '物理路径不能为空')
      return
    }

    const currentRoots = [...(settings?.scan_roots ?? [])]
    const effectiveTypes: AssetType[] = formTypes.length > 0 ? formTypes : ALL_ASSET_TYPES.map((x) => x.type)

    if (modalMode === 'add') {
      if (currentRoots.some((r) => r.alias === alias)) {
        showToast('err', `根目录别名「${alias}」已存在`)
        return
      }
      currentRoots.push({ alias, path, types: effectiveTypes })
    } else {
      const idx = currentRoots.findIndex((r) => r.alias === editingAlias)
      if (idx === -1) {
        showToast('err', '待修改的根目录不存在')
        return
      }
      currentRoots[idx] = { alias: editingAlias, path, types: effectiveTypes }
    }

    update.mutate(
      { scan_roots: currentRoots },
      {
        onSuccess: () => {
          setModalOpen(false)
          showToast('ok', `已成功${modalMode === 'add' ? '添加' : '更新'}根目录「${alias}」`)
        },
        onError: (e) => showToast('err', (e as Error).message),
      },
    )
  }

  const handleDelete = (alias: string) => {
    if (!window.confirm(`确定要移除根目录「${alias}」吗？\n注意：磁盘文件不会被删除，但系统将不再通过该别名扫描与索引。`)) {
      return
    }
    const currentRoots = (settings?.scan_roots ?? []).filter((r) => r.alias !== alias)
    update.mutate(
      { scan_roots: currentRoots },
      {
        onSuccess: () => showToast('ok', `已移除根目录「${alias}」`),
        onError: (e) => showToast('err', (e as Error).message),
      },
    )
  }

  return (
    <div className="p-4 md:p-6">
      <PageHeader title="系统设置" sub="运行期配置存 settings 表（真实读写）" />

      <div className="mt-4 max-w-3xl space-y-4">
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-1 text-sm font-semibold">注册开关</div>
          <p className="mb-3 text-xs text-slate-400">关闭后仅管理员可创建账号（详细设计 §4.7）。</p>
          <button
            className={`relative h-6 w-11 rounded-full transition ${effectiveOpen ? 'bg-brand-600' : 'bg-slate-300'}`}
            onClick={() => {
              setRegOpen(!effectiveOpen)
              update.mutate({ registration_open: !effectiveOpen })
            }}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                effectiveOpen ? 'left-[22px]' : 'left-0.5'
              }`}
            />
          </button>
          <span className="ml-3 text-sm text-slate-500">{effectiveOpen ? '开放注册' : '已关闭'}</span>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-1 text-sm font-semibold">单文件上传上限</div>
          <p className="mb-3 text-xs text-slate-400">控制网页端单次上传文件的最大体积限制（默认为 8GB，支持 1 ~ 128 GB）。</p>
          <div className="flex items-center gap-3">
            <Input
              type="number"
              min={1}
              max={128}
              className="w-28 font-mono"
              value={uploadLimit ?? settings?.max_upload_gb ?? 8}
              onChange={(e) => setUploadLimit(Math.max(1, Math.min(128, Number(e.target.value) || 1)))}
            />
            <span className="text-sm text-slate-500">GB</span>
            <Button
              size="sm"
              disabled={update.isPending || uploadLimit === null || uploadLimit === (settings?.max_upload_gb ?? 8)}
              onClick={() => {
                const target = uploadLimit ?? settings?.max_upload_gb ?? 8
                update.mutate(
                  { max_upload_gb: target },
                  {
                    onSuccess: () => showToast('ok', `已将单文件上传上限更新为 ${target} GB`),
                    onError: (e) => showToast('err', (e as Error).message),
                  },
                )
              }}
            >
              保存
            </Button>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-1 text-sm font-semibold">字体样张默认文案</div>
          <p className="mb-3 text-xs text-slate-400">字体样张墙与详情页的全局预览文案（当前存浏览器本地，M2 移入服务端设置）。</p>
          <Input className="w-full" value={fontText} onChange={(e) => setFontPreview({ fontText: e.target.value })} />
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-amber-500" />
            AI 识别（大模型补全元数据）
          </div>
          <p className="mb-3 text-xs leading-relaxed text-slate-400">
            在图片 / 视频 / 书籍 / 字体详情页可手动触发：AI 看封面或缩略图 + 文件信息，补全简介、推荐分类并给出标签等建议
            （只填空缺，绝不覆盖已有内容）。协议为 OpenAI 兼容接口——智谱、通义、OpenAI、局域网 Ollama 都能用同一套配置。
          </p>

          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <button
                className={`relative h-6 w-11 rounded-full transition ${aiOn ? 'bg-brand-600' : 'bg-slate-300'}`}
                onClick={() => setAiEnabled(!aiOn)}
              >
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${aiOn ? 'left-[22px]' : 'left-0.5'}`} />
              </button>
              <span className="text-sm text-slate-500">{aiOn ? '已启用' : '未启用'}</span>
              {ai && !ai.enabled && ai.api_key_set && <span className="text-xs text-slate-400">（已配置过，打开开关即可用）</span>}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">接口地址 base_url</label>
                <Input className="w-full font-mono text-xs" placeholder="如 https://open.bigmodel.cn/api/paas/v4"
                  value={effBaseUrl} onChange={(e) => setAiBaseUrl(e.target.value)} />
                <p className="mt-1 text-[11px] text-slate-400">到 /v4 或 /v1 这一级；局域网 Ollama 填 http://IP:11434/v1</p>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">模型名 model</label>
                <Input className="w-full font-mono text-xs" placeholder="如 glm-4.5v / qwen-vl-max"
                  value={effModel} onChange={(e) => setAiModel(e.target.value)} />
                <p className="mt-1 text-[11px] text-slate-400">必须选<b>支持看图</b>的视觉模型</p>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">API Key</label>
                <Input type="password" className="w-full font-mono text-xs" autoComplete="new-password"
                  placeholder={ai?.api_key_set ? `已配置（${ai.api_key_masked}），留空保持不变` : '供应商控制台申请'}
                  value={aiKey} onChange={(e) => setAiKey(e.target.value)} />
                <p className="mt-1 text-[11px] text-slate-400">只存本系统数据库，不出内网（仅发往你填的接口地址）</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">代理（可空）</label>
                  <Input className="w-full font-mono text-xs" placeholder="192.168.31.32:7890"
                    value={effProxy} onChange={(e) => setAiProxy(e.target.value)} />
                  <p className="mt-1 text-[11px] text-slate-400">国产供应商直连，留空</p>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">超时（秒）</label>
                  <Input type="number" min={10} max={600} className="w-full font-mono text-xs"
                    value={effTimeout} onChange={(e) => setAiTimeout(Math.max(10, Math.min(600, Number(e.target.value) || 90)))} />
                  <p className="mt-1 text-[11px] text-slate-400">视觉模型较慢，默认 90</p>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" disabled={!aiDirty || update.isPending} onClick={saveAi}>
                {update.isPending ? '保存中…' : '保存配置'}
              </Button>
              <Button size="sm" variant="outline" disabled={aiTest.isPending || !effBaseUrl.trim() || !effModel.trim()} onClick={() => aiTest.mutate()}>
                <Sparkles className="h-3.5 w-3.5" />
                {aiTest.isPending ? '测试中…' : '测试连通性'}
              </Button>
              <span className="text-xs text-slate-400">会发一张纯色小图做最小视觉调用（同时验证地址 / Key / 模型 / 看图能力）</span>
            </div>

            {aiTestResult && (
              <div className={cn(
                'flex items-start gap-2 rounded-lg border px-3 py-2 text-xs',
                aiTestResult.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-rose-200 bg-rose-50 text-rose-700',
              )}>
                {aiTestResult.ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                <span className="min-w-0 break-all">{aiTestResult.text}</span>
                <button className="ml-auto shrink-0 opacity-50 hover:opacity-100" onClick={() => setAiTestResult(null)}>✕</button>
              </div>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold">资源根目录与资产类型白名单（scan_roots）</div>
              <p className="mt-1 text-xs text-slate-400">
                可为每个目录配置允许入库的资产类型白名单（如音乐目录仅入库音频，封面等图片文件将自动跳过）。
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={openAddModal}>
                <Plus className="h-3.5 w-3.5" />添加根目录
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={scanAll.isPending || (settings?.scan_roots ?? []).length === 0}
                onClick={() => scanAll.mutate()}
              >
                <ScanSearch className="h-3.5 w-3.5" />{scanAll.isPending ? '扫描中…' : '全部扫描'}
              </Button>
            </div>
          </div>

          <div className="mt-4 overflow-hidden rounded-lg border border-slate-100 text-sm">
            {(settings?.scan_roots ?? []).map((r) => {
              const types = r.types ?? []
              const isAllTypes = types.length === 0 || types.length === ALL_ASSET_TYPES.length
              return (
                <div
                  key={r.alias}
                  className="flex flex-col gap-2 border-b border-slate-100 p-3 last:border-0 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="brand" className="font-mono text-xs font-semibold">
                        {r.alias}:
                      </Badge>
                      {isAllTypes ? (
                        <Badge tone="slate">全部类型</Badge>
                      ) : (
                        types.map((t) => (
                          <Badge key={t} tone={TYPE_TONES[t] ?? 'slate'}>
                            {ALL_ASSET_TYPES.find((x) => x.type === t)?.label ?? t}
                          </Badge>
                        ))
                      )}
                    </div>
                    <div className="truncate font-mono text-xs text-slate-500" title={r.path}>
                      {r.path}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 self-end shrink-0 sm:self-center">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={scanOne.isPending}
                      onClick={() => scanOne.mutate(r.alias)}
                      title={`立即扫描 ${r.path}`}
                    >
                      <RefreshCw className="h-3 w-3" />扫描
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => openEditModal(r)}
                      title="编辑根目录路径与类型白名单"
                    >
                      <Pencil className="h-3 w-3" />编辑
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-rose-500 hover:bg-rose-50 hover:text-rose-700"
                      onClick={() => handleDelete(r.alias)}
                      title="移除此根目录"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              )
            })}
            {(settings?.scan_roots ?? []).length === 0 && (
              <div className="p-6 text-center text-xs text-slate-400">暂无资源根目录配置，请点击上方按钮添加。</div>
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

      {/* 根目录编辑 / 新增弹窗 */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} className="w-[520px] max-w-[95vw] p-6">
        <div className="mb-4 text-base font-semibold text-slate-900">
          {modalMode === 'add' ? '添加资源根目录' : `编辑根目录（${editingAlias}）`}
        </div>
        <div className="space-y-4 text-sm">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">根目录别名 (alias)</label>
            <Input
              className="w-full font-mono text-sm"
              placeholder="例如：music / my_photos / fonts"
              value={formAlias}
              onChange={(e) => setFormAlias(e.target.value)}
              disabled={modalMode === 'edit'}
            />
            {modalMode === 'edit' ? (
              <p className="mt-1 text-[11px] text-slate-400">别名为入库资产路径索引标识，暂不支持修改。</p>
            ) : (
              <p className="mt-1 text-[11px] text-slate-400">用于生成 storage_key（如 alias:相对路径），保存后不可更改。</p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">磁盘物理绝对路径 (path)</label>
            <Input
              className="w-full font-mono text-sm"
              placeholder="例如：/data/library/music 或 /vol1/1000/music"
              value={formPath}
              onChange={(e) => setFormPath(e.target.value)}
            />
            <p className="mt-1 text-[11px] text-slate-400">服务器或 NAS 上的本地绝对路径，若目录不存在将自动创建。</p>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-xs font-medium text-slate-600">允许入库资产类型（白名单）</label>
              <div className="flex gap-2 text-xs">
                <button
                  type="button"
                  className="text-brand-600 hover:underline"
                  onClick={() => setFormTypes(ALL_ASSET_TYPES.map((x) => x.type))}
                >
                  全选
                </button>
                <span className="text-slate-300">|</span>
                <button
                  type="button"
                  className="text-slate-400 hover:underline"
                  onClick={() => setFormTypes([])}
                >
                  清空
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {ALL_ASSET_TYPES.map(({ type, label }) => {
                const active = formTypes.includes(type)
                return (
                  <button
                    key={type}
                    type="button"
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition',
                      active
                        ? 'border-brand-500 bg-brand-50 text-brand-700 shadow-sm'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50',
                    )}
                    onClick={() => {
                      setFormTypes((prev) =>
                        prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
                      )
                    }}
                  >
                    <span
                      className={cn(
                        'grid h-3.5 w-3.5 place-items-center rounded border text-[10px]',
                        active ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white',
                      )}
                    >
                      {active && <Check className="h-2.5 w-2.5 stroke-[3]" />}
                    </span>
                    {label}
                  </button>
                )
              })}
            </div>
            <p className="mt-2 text-[11px] text-slate-400">
              {formTypes.length === 0 || formTypes.length === ALL_ASSET_TYPES.length
                ? '提示：全选或全不选代表不限制类型（所有已知资产类型均入库）。'
                : `提示：仅允许【${formTypes.map((t) => ALL_ASSET_TYPES.find((x) => x.type === t)?.label).join('、')}】入库。此目录下的其它文件（如音乐专辑目录下的 cover.jpg 封面图片）将在扫描时自动跳过，不会入库为独立资产。`}
            </p>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2.5">
          <Button variant="outline" size="sm" onClick={() => setModalOpen(false)}>
            取消
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={update.isPending || !formAlias.trim() || !formPath.trim()}
            onClick={handleSaveModal}
          >
            {update.isPending ? '保存中…' : '保存'}
          </Button>
        </div>
      </Modal>

      {toast && (
        <div className="fixed right-4 top-20 z-[60] max-w-md">
          <div
            className={cn(
              'flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm shadow-xl',
              toast.kind === 'err'
                ? 'border-rose-200 bg-rose-50 text-rose-700'
                : 'border-emerald-200 bg-emerald-50 text-emerald-700',
            )}
          >
            {toast.kind === 'err' ? (
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            <span className="min-w-0 break-all">{toast.text}</span>
            <button className="ml-2 shrink-0 opacity-50 hover:opacity-100" onClick={() => setToast(null)}>
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
