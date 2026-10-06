import { useState } from 'react'
import { usePrefs } from '@/stores/prefs'
import { Badge, Input, PageHeader } from '@/components/ui'

const SCAN_ROOTS = [
  { alias: 'fonts:', path: '/data/library/fonts', types: '字体' },
  { alias: 'music:', path: '/data/library/music', types: '音乐' },
  { alias: 'videos:', path: '/data/library/videos', types: '视频' },
  { alias: 'books:', path: '/data/library/books', types: '书籍' },
  { alias: 'images:', path: '/data/library/images', types: '图片' },
  { alias: 'uploads:', path: '/data/library/uploads', types: '上传暂存（注册为扫描根）' },
]

export function SettingsPage() {
  const { fontText, setFontPreview } = usePrefs()
  const [regOpen, setRegOpen] = useState(true)

  return (
    <div className="p-4 md:p-6">
      <PageHeader title="系统设置" sub="运行期配置存 settings 表，修改即时生效（mock）" />

      <div className="mt-4 max-w-2xl space-y-4">
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-1 text-sm font-semibold">注册开关</div>
          <p className="mb-3 text-xs text-slate-400">关闭后仅管理员可在用户管理页手工创建账号（详细设计 §4.7）。</p>
          <button
            className={`relative h-6 w-11 rounded-full transition ${regOpen ? 'bg-brand-600' : 'bg-slate-300'}`}
            onClick={() => setRegOpen(!regOpen)}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${regOpen ? 'left-[22px]' : 'left-0.5'}`} />
          </button>
          <span className="ml-3 text-sm text-slate-500">{regOpen ? '开放注册' : '已关闭'}</span>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-1 text-sm font-semibold">字体样张默认文案</div>
          <p className="mb-3 text-xs text-slate-400">字体样张墙与详情页的全局预览文案。</p>
          <Input className="w-full" value={fontText} onChange={(e) => setFontPreview({ fontText: e.target.value })} />
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-1 text-sm font-semibold">资源根目录（scan_roots）</div>
          <p className="mb-3 text-xs text-slate-400">storage_key = &#123;root_alias&#125;:&#123;相对路径&#125;；原始文件只读不搬移。</p>
          <div className="overflow-hidden rounded-lg border border-slate-100 text-sm">
            {SCAN_ROOTS.map((r) => (
              <div key={r.alias} className="flex items-center gap-3 border-b border-slate-100 px-3 py-2 last:border-0">
                <Badge tone="brand">{r.alias}</Badge>
                <code className="font-mono text-xs text-slate-500">{r.path}</code>
                <span className="ml-auto text-xs text-slate-400">{r.types}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-rose-200 bg-rose-50/50 p-5">
          <div className="mb-1 text-sm font-semibold text-rose-700">备份</div>
          <p className="text-xs leading-relaxed text-rose-500">
            pg_dump + rsync /data/library；派生物可全量重建，不纳入备份（M6 交付 cron 脚本）。
          </p>
        </section>
      </div>
    </div>
  )
}
