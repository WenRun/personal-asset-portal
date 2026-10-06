import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Download } from 'lucide-react'
import { API_BASE } from '@/api/client'

interface ShareView {
  title: string
  type: string
  file_name: string
  size_bytes: number
  note: string | null
  allow_download: boolean
  preview_url: string | null
  download_url: string | null
}

const TYPE_LABEL: Record<string, string> = {
  font: '字体', music: '音乐', video: '视频', book: '书籍', image: '图片',
}

/** 公开分享页（/share/:token）：无需登录，token 即凭证；过期后 404。 */
export function SharePage() {
  const { token } = useParams()
  const [data, setData] = useState<ShareView | null>(null)
  const [err, setErr] = useState('')
  const [imgFail, setImgFail] = useState(false)

  useEffect(() => {
    fetch(`${API_BASE}/api/share/${token}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? `HTTP ${r.status}`)
        setData(await r.json())
      })
      .catch((e) => setErr((e as Error).message))
  }, [token])

  return (
    <div className="grid min-h-screen place-items-center bg-gradient-to-br from-brand-50 via-brand-100 to-brand-200 p-6">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-brand-600 text-lg font-bold text-white shadow-lg">资</div>
          <div className="text-xl font-bold">个人资源门户 · 分享</div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
          {err ? (
            <div className="p-10 text-center text-slate-500">{err}</div>
          ) : !data ? (
            <div className="p-10 text-center text-slate-400">加载中…</div>
          ) : (
            <div className="p-6 text-center">
              <div className="mx-auto mb-4 max-w-56 overflow-hidden rounded-xl border border-slate-100">
                {data.preview_url && !imgFail ? (
                  <img
                    src={API_BASE + data.preview_url}
                    alt={data.title}
                    className="w-full bg-slate-100 object-contain"
                    onError={() => setImgFail(true)}
                  />
                ) : (
                  <div className="grid aspect-square place-items-center bg-slate-100 text-4xl">
                    {data.type === 'music' ? '♪' : data.type === 'video' ? '▶' : '📦'}
                  </div>
                )}
              </div>
              <div className="mb-1 inline-block rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-700">
                {TYPE_LABEL[data.type] ?? data.type}分享
              </div>
              <h1 className="text-xl font-bold">{data.title}</h1>
              <div className="mt-1 text-xs text-slate-400">
                {data.file_name} · {(data.size_bytes / 1048576).toFixed(1)}MB
              </div>
              {data.note && <p className="mt-3 text-sm leading-relaxed text-slate-600">{data.note}</p>}
              {data.allow_download && data.download_url ? (
                <a
                  href={API_BASE + data.download_url}
                  className="mt-5 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand-600 py-2.5 text-sm font-medium text-white transition hover:bg-brand-700"
                >
                  <Download className="h-4 w-4" />下载文件
                </a>
              ) : (
                <div className="mt-5 rounded-lg bg-slate-50 py-2.5 text-xs text-slate-400">此分享仅预览，不提供下载</div>
              )}
            </div>
          )}
          <div className="border-t border-slate-100 px-6 py-3 text-center text-[10px] text-slate-400">
            分享链接带过期时间 · 到期自动失效
          </div>
        </div>
      </div>
    </div>
  )
}
