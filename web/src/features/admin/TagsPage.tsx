import { useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, FolderTree, Pencil, Plus, Trash2 } from 'lucide-react'
import { api } from '@/api/client'
import { useAuth } from '@/stores/auth'
import { Badge, Button, Input, Modal, PageHeader } from '@/components/ui'
import { cn } from '@/lib/utils'

interface TagRow { id: string; name: string; parent_id: string | null; count: number }

interface TagNode { tag: TagRow; children: TagNode[] }

/** 平铺标签 → 层级树（父缺失/环兜底为顶级；同级按名称排序）。 */
function buildTree(tags: TagRow[]): TagNode[] {
  const nodes = new Map<string, TagNode>(tags.map((t) => [t.id, { tag: t, children: [] }]))
  const roots: TagNode[] = []
  for (const node of nodes.values()) {
    const p = node.tag.parent_id ? nodes.get(node.tag.parent_id) : undefined
    if (p && p !== node) p.children.push(node)
    else roots.push(node)
  }
  const byName = (a: TagNode, b: TagNode) => a.tag.name.localeCompare(b.tag.name, 'zh-Hans-CN')
  const sortAll = (n: TagNode) => { n.children.sort(byName); n.children.forEach(sortAll) }
  roots.sort(byName).forEach(sortAll)
  return roots
}

/** 标签层级树（§4.5）：递归展示 + admin 新建（可指定父标签）/改名/移动/删除。 */
export function TagsPage() {
  const qc = useQueryClient()
  const isAdmin = useAuth((s) => s.user)?.role === 'admin'
  const { data: tags } = useQuery({ queryKey: ['tags'], queryFn: api.tags })
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  // 新建/编辑弹层共用：editing=null 表示新建
  const [editing, setEditing] = useState<TagRow | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [formName, setFormName] = useState('')
  const [formParent, setFormParent] = useState('')
  const [err, setErr] = useState('')

  const tree = useMemo(() => buildTree(tags ?? []), [tags])
  const refresh = () => void qc.invalidateQueries({ queryKey: ['tags'] })

  const openCreate = (parentId?: string) => {
    setEditing(null)
    setFormName('')
    setFormParent(parentId ?? '')
    setErr('')
    setDialogOpen(true)
  }
  const openEdit = (t: TagRow) => {
    setEditing(t)
    setFormName(t.name)
    setFormParent(t.parent_id ?? '')
    setErr('')
    setDialogOpen(true)
  }

  const save = useMutation({
    mutationFn: async () => {
      const parentId = formParent || null
      if (editing) return api.renameTag(editing.id, formName.trim(), parentId)
      return api.createTag(formName.trim(), parentId)
    },
    onSuccess: () => { setDialogOpen(false); refresh() },
    onError: (e) => setErr((e as Error).message),
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteTag(id),
    onSuccess: refresh,
    onError: (e) => setErr((e as Error).message),
  })

  // 编辑时可选父标签：排除自己与自己的子树（防环；后端亦校验）
  const movableParents = useMemo(() => {
    const all = tags ?? []
    if (!editing) return all
    const banned = new Set<string>([editing.id])
    let changed = true
    while (changed) {
      changed = false
      for (const t of all) if (t.parent_id && banned.has(t.parent_id) && !banned.has(t.id)) { banned.add(t.id); changed = true }
    }
    return all.filter((t) => !banned.has(t.id))
  }, [tags, editing])

  const toggle = (id: string) =>
    setExpanded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const renderNodes = (nodes: TagNode[], depth: number): ReactNode =>
    nodes.map(({ tag, children }) => {
      const isOpen = expanded.has(tag.id) || depth === 0
      return (
        <div key={tag.id}>
          <div
            className="group flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm transition hover:bg-slate-50"
            style={{ paddingLeft: depth * 20 + 8 }}
          >
            {children.length > 0 ? (
              <button
                className={cn('grid h-4 w-4 shrink-0 place-items-center text-slate-400 transition-transform', isOpen && 'rotate-90')}
                onClick={() => toggle(tag.id)}
                title={isOpen ? '收起' : '展开'}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            ) : <span className="w-4 shrink-0" />}
            <FolderTree className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            <span className="min-w-0 truncate font-medium">{tag.name}</span>
            <Badge className="ml-0.5">{tag.count}</Badge>
            <div className="ml-auto hidden shrink-0 items-center gap-1 group-hover:flex">
              {isAdmin && (
                <>
                  <button className="rounded p-1 text-slate-300 hover:bg-brand-50 hover:text-brand-600" title={`在「${tag.name}」下新建子标签`} onClick={() => openCreate(tag.id)}>
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                  <button className="rounded p-1 text-slate-300 hover:bg-slate-100 hover:text-slate-600" title="改名 / 移动" onClick={() => openEdit(tag)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button className="rounded p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-600" title="删除标签" onClick={() => { if (confirm(`删除标签「${tag.name}」？将同时解除所有资产上的挂载。`)) remove.mutate(tag.id) }}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
            </div>
          </div>
          {isOpen && children.length > 0 && <div>{renderNodes(children, depth + 1)}</div>}
        </div>
      )
    })

  return (
    <div className="p-4 md:p-6">
      <PageHeader
        title="标签管理"
        sub="五类资源共用一套层级标签；详情页标签可点击跳转筛选"
        right={isAdmin ? <Button size="sm" onClick={() => openCreate()}><Plus className="h-3.5 w-3.5" />新建标签</Button> : undefined}
      />

      <div className="mt-4 max-w-2xl overflow-hidden rounded-xl border border-slate-200 bg-white p-2">
        {tree.length > 0 ? renderNodes(tree, 0) : (
          <div className="p-10 text-center text-sm text-slate-400">
            还没有标签{isAdmin ? ' —— 右上角「新建标签」开始' : ''}
          </div>
        )}
      </div>
      {err && <div className="mt-2 text-xs text-rose-600">{err}</div>}

      <Modal open={dialogOpen} onClose={() => setDialogOpen(false)} className="w-[380px] p-6">
        <div className="mb-4 font-semibold">{editing ? `编辑「${editing.name}」` : '新建标签'}</div>
        <div className="space-y-3 text-sm">
          <div>
            <div className="mb-1 text-xs text-slate-400">名称</div>
            <Input
              className="w-full" value={formName} placeholder="标签名称"
              autoFocus
              onChange={(e) => setFormName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && formName.trim()) save.mutate() }}
            />
          </div>
          <div>
            <div className="mb-1 text-xs text-slate-400">父标签（留空为顶级）</div>
            <select
              value={formParent}
              onChange={(e) => setFormParent(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500"
            >
              <option value="">（顶级标签）</option>
              {movableParents.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          {err && <div className="text-xs text-rose-600">{err}</div>}
          <div className="flex gap-2 pt-1">
            <Button className="flex-1" disabled={!formName.trim() || save.isPending} onClick={() => save.mutate()}>
              {editing ? '保存' : '创建'}
            </Button>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
