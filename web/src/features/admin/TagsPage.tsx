import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import { Button, Input, PageHeader } from '@/components/ui'

export function TagsPage() {
  const { data: tags } = useQuery({ queryKey: ['tags'], queryFn: api.tags })
  const [extra, setExtra] = useState<{ id: string; name: string; count: number }[]>([])
  const [name, setName] = useState('')

  const list = [...(tags ?? []), ...extra]

  return (
    <div className="p-4 md:p-6">
      <PageHeader title="标签管理" sub="五类资源共用一套层级标签（mock：平铺展示）" />
      <div className="mt-4 flex max-w-md items-center gap-2">
        <Input className="flex-1" placeholder="新标签名称，回车创建" value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && name.trim()) {
              setExtra((x) => [...x, { id: `local-${x.length}`, name: name.trim(), count: 0 }])
              setName('')
            }
          }}
        />
        <Button onClick={() => { if (name.trim()) { setExtra((x) => [...x, { id: `local-${x.length}`, name: name.trim(), count: 0 }]); setName('') } }}>创建</Button>
      </div>

      <div className="mt-5 grid max-w-3xl grid-cols-2 gap-3 md:grid-cols-4">
        {list.map((t) => (
          <div key={t.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
            <span className="font-medium">{t.name}</span>
            <span className="font-mono text-xs text-slate-400">{t.count}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 max-w-3xl rounded-xl border border-dashed border-slate-300 p-4 text-xs leading-relaxed text-slate-400">
        真实实现（详细设计 §2.2）：层级标签存 tags 表（parent_id），同级同名唯一；打标签走 POST /api/assets/&#123;id&#125;/tags；
        智能集合 = 保存的筛选条件 JSON。此页在 M6 打磨阶段补全层级树、重命名与合并。
      </div>
    </div>
  )
}
