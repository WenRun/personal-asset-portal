import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AlignJustify,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Columns,
  List,
  Loader2,
  Maximize2,
  Minimize2,
  Moon,
  Palette,
  RotateCcw,
  Search,
  Sun,
  Type,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { api } from '@/api/client'
import { Button } from '@/components/ui'
import type { Book } from '@/types'

export type ReaderTheme = 'day' | 'sepia' | 'green' | 'night'
export type ReaderMode = 'paged' | 'scroll'
export type ReaderFontFamily = 'sans' | 'serif' | 'kai'

interface ThemeConfig {
  id: ReaderTheme
  name: string
  bg: string
  text: string
  barBg: string
  barBorder: string
  barText: string
  cardBg: string
  activeBg: string
  pdfFilter?: string
}

const THEMES: Record<ReaderTheme, ThemeConfig> = {
  day: {
    id: 'day',
    name: '日间',
    bg: '#ffffff',
    text: '#1e293b',
    barBg: 'rgba(255, 255, 255, 0.95)',
    barBorder: '#e2e8f0',
    barText: '#334155',
    cardBg: '#f8fafc',
    activeBg: '#e2e8f0',
  },
  sepia: {
    id: 'sepia',
    name: '羊皮纸',
    bg: '#f6f1e7',
    text: '#3c3226',
    barBg: 'rgba(244, 237, 224, 0.95)',
    barBorder: '#ded2be',
    barText: '#4c3f30',
    cardBg: '#ece3d2',
    activeBg: '#ded2be',
    pdfFilter: 'sepia(0.35) brightness(0.96)',
  },
  green: {
    id: 'green',
    name: '豆沙绿',
    bg: '#e8f2e7',
    text: '#223624',
    barBg: 'rgba(224, 238, 222, 0.95)',
    barBorder: '#c3dbbf',
    barText: '#2e4830',
    cardBg: '#d6ebd4',
    activeBg: '#c3dbbf',
    pdfFilter: 'sepia(0.35) hue-rotate(70deg) saturate(1.2) brightness(0.96)',
  },
  night: {
    id: 'night',
    name: '深夜',
    bg: '#141417',
    text: '#d4d4d8',
    barBg: 'rgba(28, 28, 32, 0.95)',
    barBorder: '#3f3f46',
    barText: '#e4e4e7',
    cardBg: '#232328',
    activeBg: '#3f3f46',
    pdfFilter: 'invert(0.88) hue-rotate(180deg) brightness(0.95) contrast(1.05)',
  },
}

export function BookReader({
  book,
  format,
  initialChapter,
  initialPct,
  onClose,
  onProgress,
}: {
  book: Book
  format: string
  initialChapter: number
  initialPct: number
  onClose: () => void
  onProgress: (p: { pct: number; chapter?: number }) => void
}) {
  const isPdf = format.toUpperCase() === 'PDF'

  // 用户排版偏好本地持久化
  const [theme, setTheme] = useState<ReaderTheme>(() => {
    return (localStorage.getItem('portal_reader_theme') as ReaderTheme) || 'sepia'
  })
  const [mode, setMode] = useState<ReaderMode>(() => {
    return (localStorage.getItem('portal_reader_mode') as ReaderMode) || 'paged'
  })
  const [fontSize, setFontSize] = useState<number>(() => {
    const s = localStorage.getItem('portal_reader_fontSize')
    return s ? Number(s) : 17
  })
  const [lineHeight, setLineHeight] = useState<number>(() => {
    const s = localStorage.getItem('portal_reader_lineHeight')
    return s ? Number(s) : 1.8
  })
  const [maxWidth, setMaxWidth] = useState<string>(() => {
    return localStorage.getItem('portal_reader_maxWidth') || 'max-w-3xl'
  })
  const [fontFamily, setFontFamily] = useState<ReaderFontFamily>(() => {
    return (localStorage.getItem('portal_reader_fontFamily') as ReaderFontFamily) || 'sans'
  })

  // 界面状态
  const [showBars, setShowBars] = useState(true)
  const [showSettings, setShowSettings] = useState(false)
  const [showToc, setShowToc] = useState(false)
  const [tocFilter, setTocFilter] = useState('')
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [pdfZoom, setPdfZoom] = useState<number>(100)
  const containerRef = useRef<HTMLDivElement>(null)

  // 保存排版偏好
  useEffect(() => {
    localStorage.setItem('portal_reader_theme', theme)
    localStorage.setItem('portal_reader_mode', mode)
    localStorage.setItem('portal_reader_fontSize', String(fontSize))
    localStorage.setItem('portal_reader_lineHeight', String(lineHeight))
    localStorage.setItem('portal_reader_maxWidth', maxWidth)
    localStorage.setItem('portal_reader_fontFamily', fontFamily)
  }, [theme, mode, fontSize, lineHeight, maxWidth, fontFamily])

  // 全屏切换
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      void containerRef.current?.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {})
    } else {
      void document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {})
    }
  }

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  // 流式书籍（EPUB / TXT / MOBI / AZW3）查询
  const { data: contents } = useQuery({
    queryKey: ['book-contents', book.id],
    queryFn: () => api.bookContents(book.id),
    enabled: !isPdf,
  })
  const chapters = contents?.chapters ?? []

  // PDF 元数据查询
  const { data: pdfMeta } = useQuery({
    queryKey: ['book-pdf-meta', book.id],
    queryFn: () => api.pdfMeta(book.id),
    enabled: isPdf,
  })

  const curTheme = THEMES[theme]

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 flex h-screen w-screen select-none flex-col overflow-hidden transition-colors duration-300"
      style={{ backgroundColor: curTheme.bg, color: curTheme.text }}
    >
      {/* 顶部悬浮控制栏 */}
      <header
        className={`absolute top-0 left-0 right-0 z-30 flex h-14 items-center justify-between border-b px-4 backdrop-blur-md transition-all duration-200 ${
          showBars ? 'translate-y-0 opacity-100' : '-translate-y-full opacity-0 pointer-events-none'
        }`}
        style={{
          backgroundColor: curTheme.barBg,
          borderColor: curTheme.barBorder,
          color: curTheme.barText,
        }}
      >
        <div className="flex min-w-0 items-center gap-3">
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition hover:bg-black/5 dark:hover:bg-white/10"
            title="退出阅读 (Esc)"
          >
            <X className="h-4 w-4" />
            <span className="hidden sm:inline">退出</span>
          </button>
          <div className="h-4 w-[1px] bg-slate-300 dark:bg-zinc-700" />
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-semibold">{book.title}</span>
            <span className="text-[11px] opacity-70">
              {book.author ? `${book.author} · ` : ''}
              {format.toUpperCase()} 格式
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1 sm:gap-2">
          {/* 快速主题色彩切换指示 (日间 / 羊皮纸 / 豆沙绿 / 深夜) */}
          <div
            className="hidden sm:flex items-center gap-1 rounded-xl border p-1"
            style={{ borderColor: curTheme.barBorder }}
          >
            {(Object.keys(THEMES) as ReaderTheme[]).map((tKey) => {
              const cfg = THEMES[tKey]
              const isCur = theme === tKey
              return (
                <button
                  key={tKey}
                  onClick={() => setTheme(tKey)}
                  className={`h-5 w-5 rounded-full transition-transform ${
                    isCur ? 'scale-110 ring-2 ring-brand-500' : 'opacity-70 hover:scale-105 hover:opacity-100'
                  }`}
                  style={{ backgroundColor: cfg.bg, border: `1px solid ${cfg.barBorder}` }}
                  title={`切换为「${cfg.name}」主题`}
                />
              )
            })}
          </div>

          {/* PDF 专属顶部快捷缩放控件 */}
          {isPdf && (
            <div
              className="flex items-center gap-1 rounded-lg border px-1.5 py-1 text-xs"
              style={{ borderColor: curTheme.barBorder }}
            >
              <button
                onClick={() => setPdfZoom((z) => Math.max(50, z - 15))}
                className="rounded p-1 opacity-70 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
                title="缩小 (快捷键 - / Ctrl+滚轮下)"
              >
                <ZoomOut className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setPdfZoom(100)}
                className="min-w-[42px] px-1 text-center font-mono text-[11px] font-medium opacity-80 transition hover:opacity-100 hover:underline"
                title="重置为 100% 原始大小 (快捷键 0)"
              >
                {pdfZoom}%
              </button>
              <button
                onClick={() => setPdfZoom((z) => Math.min(250, z + 15))}
                className="rounded p-1 opacity-70 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
                title="放大 (快捷键 + / Ctrl+滚轮上 / 双击)"
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* 目录抽屉按钮 */}
          <button
            onClick={() => {
              setShowToc((v) => !v)
              setShowSettings(false)
            }}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              showToc ? 'bg-black/10 dark:bg-white/15' : 'hover:bg-black/5 dark:hover:bg-white/10'
            }`}
            title="查看目录 (TOC)"
          >
            <List className="h-4 w-4" />
            <span className="hidden md:inline">目录</span>
          </button>

          {/* 主题与排版设置按钮 (PDF 模式显示「主题」，流式模式显示「排版」) */}
          <button
            onClick={() => {
              setShowSettings((v) => !v)
              setShowToc(false)
            }}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              showSettings ? 'bg-black/10 dark:bg-white/15' : 'hover:bg-black/5 dark:hover:bg-white/10'
            }`}
            title={isPdf ? '护眼主题与显示设置' : '排版与护眼主题设置'}
          >
            {isPdf ? <Palette className="h-4 w-4" /> : <Type className="h-4 w-4" />}
            <span className="hidden md:inline">{isPdf ? '主题' : '排版'}</span>
          </button>

          {/* 阅读模式快速切换 */}
          {!isPdf && (
            <button
              onClick={() => setMode((m) => (m === 'paged' ? 'scroll' : 'paged'))}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition hover:bg-black/5 dark:hover:bg-white/10"
              title={mode === 'paged' ? '当前为仿真分页，点击切换为连续滚动' : '当前为连续滚动，点击切换为仿真分页'}
            >
              {mode === 'paged' ? <Columns className="h-4 w-4" /> : <AlignJustify className="h-4 w-4" />}
              <span className="hidden lg:inline">{mode === 'paged' ? '仿真翻页' : '连续滚动'}</span>
            </button>
          )}

          {/* 全屏切换 */}
          <button
            onClick={toggleFullscreen}
            className="rounded-lg p-2 transition hover:bg-black/5 dark:hover:bg-white/10"
            title={isFullscreen ? '退出全屏 (F)' : '沉浸全屏阅读 (F)'}
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        </div>
      </header>

      {/* 目录抽屉 (TOC Drawer) */}
      {showToc && (
        <aside
          className="absolute top-14 bottom-0 left-0 z-40 flex w-80 max-w-[85vw] flex-col border-r shadow-2xl backdrop-blur-xl transition-transform duration-200"
          style={{
            backgroundColor: curTheme.barBg,
            borderColor: curTheme.barBorder,
            color: curTheme.barText,
          }}
        >
          <div className="flex items-center justify-between border-b p-3" style={{ borderColor: curTheme.barBorder }}>
            <span className="text-xs font-bold tracking-wider opacity-80">书籍目录大纲</span>
            <button
              onClick={() => setShowToc(false)}
              className="rounded p-1 hover:bg-black/5 dark:hover:bg-white/10"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="border-b p-2" style={{ borderColor: curTheme.barBorder }}>
            <div className="relative flex items-center">
              <Search className="absolute left-2.5 h-3.5 w-3.5 opacity-50" />
              <input
                type="text"
                placeholder="搜索章节标题…"
                value={tocFilter}
                onChange={(e) => setTocFilter(e.target.value)}
                className="w-full rounded-md bg-black/5 py-1.5 pr-2 pl-8 text-xs outline-none focus:ring-1 focus:ring-brand-500 dark:bg-white/10"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {isPdf ? (
              <PdfTocList
                toc={pdfMeta?.toc ?? []}
                filter={tocFilter}
                onSelect={(page) => {
                  window.dispatchEvent(new CustomEvent('reader-jump-pdf', { detail: { page } }))
                  setShowToc(false)
                }}
              />
            ) : (
              <FlowTocList
                chapters={chapters}
                filter={tocFilter}
                onSelect={(idx) => {
                  window.dispatchEvent(new CustomEvent('reader-jump-chapter', { detail: { chapter: idx } }))
                  setShowToc(false)
                }}
              />
            )}
          </div>
        </aside>
      )}

      {/* 排版设置抽屉/面板 */}
      {showSettings && (
        <div
          className="absolute top-16 right-4 z-40 w-80 rounded-2xl border p-4 shadow-2xl backdrop-blur-xl transition-all"
          style={{
            backgroundColor: curTheme.barBg,
            borderColor: curTheme.barBorder,
            color: curTheme.barText,
          }}
        >
          <div className="mb-3 flex items-center justify-between border-b pb-2" style={{ borderColor: curTheme.barBorder }}>
            <span className="text-xs font-bold tracking-wider opacity-80">
              {isPdf ? 'PDF 护眼主题与显示设置' : '阅读排版与护眼主题'}
            </span>
            <button onClick={() => setShowSettings(false)} className="rounded p-1 hover:bg-black/5 dark:hover:bg-white/10">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-4 text-xs">
            {/* 主题选择 (通用) */}
            <div>
              <div className="mb-2 font-medium opacity-70">色彩主题</div>
              <div className="grid grid-cols-4 gap-2">
                {(Object.keys(THEMES) as ReaderTheme[]).map((tKey) => {
                  const cfg = THEMES[tKey]
                  const isCur = theme === tKey
                  return (
                    <button
                      key={tKey}
                      onClick={() => setTheme(tKey)}
                      className={`flex flex-col items-center gap-1 rounded-xl p-2 transition ${
                        isCur ? 'ring-2 ring-brand-500 ring-offset-2' : 'hover:scale-105'
                      }`}
                      style={{ backgroundColor: cfg.bg, color: cfg.text, border: `1px solid ${cfg.barBorder}` }}
                    >
                      <div className="flex h-5 w-5 items-center justify-center rounded-full" style={{ backgroundColor: cfg.activeBg }}>
                        {isCur && <Check className="h-3 w-3" />}
                      </div>
                      <span className="text-[11px] font-medium">{cfg.name}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            {isPdf ? (
              <>
                {/* PDF 专属缩放控制 */}
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="font-medium opacity-70">页面缩放</span>
                    <span className="font-mono text-xs">{pdfZoom}%</span>
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {[75, 100, 125, 150].map((z) => (
                      <button
                        key={z}
                        onClick={() => setPdfZoom(z)}
                        className={`rounded-lg py-1.5 text-center font-medium transition ${
                          pdfZoom === z ? 'bg-brand-500 text-white' : 'bg-black/5 hover:bg-black/10 dark:bg-white/10'
                        }`}
                      >
                        {z}%
                      </button>
                    ))}
                  </div>
                </div>

                {/* PDF 护眼模式温馨提示 */}
                <div className="rounded-xl border border-black/5 bg-black/5 p-3 dark:border-white/10 dark:bg-white/5">
                  <div className="flex items-start gap-2 text-[11px] leading-relaxed opacity-80">
                    <span className="shrink-0 text-base">💡</span>
                    <span>
                      PDF 采用高精度版面栅格化渲染。切换色彩主题将自动应用自适应滤镜，在完整保留原版排版与图表的同时，实现柔和暖阳与深夜暗色反色护眼。
                    </span>
                  </div>
                </div>
              </>
            ) : (
              <>
                {/* 字号调节 */}
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="font-medium opacity-70">字号大小</span>
                    <span className="font-mono text-xs">{fontSize}px</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 flex-1 text-xs"
                      disabled={fontSize <= 13}
                      onClick={() => setFontSize((s) => Math.max(13, s - 1))}
                    >
                      A- 缩小
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 flex-1 text-xs"
                      disabled={fontSize >= 25}
                      onClick={() => setFontSize((s) => Math.min(25, s + 1))}
                    >
                      A+ 放大
                    </Button>
                  </div>
                </div>

                {/* 行间距 */}
                <div>
                  <div className="mb-1.5 font-medium opacity-70">行距</div>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: '紧凑', val: 1.5 },
                      { label: '舒适', val: 1.8 },
                      { label: '宽松', val: 2.1 },
                    ].map((item) => (
                      <button
                        key={item.label}
                        onClick={() => setLineHeight(item.val)}
                        className={`rounded-lg py-1.5 text-center font-medium transition ${
                          lineHeight === item.val ? 'bg-brand-500 text-white' : 'bg-black/5 hover:bg-black/10 dark:bg-white/10'
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 字体族 */}
                <div>
                  <div className="mb-1.5 font-medium opacity-70">字体风格</div>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: 'sans', label: '无衬线' },
                      { id: 'serif', label: '宋体' },
                      { id: 'kai', label: '楷体' },
                    ].map((item) => (
                      <button
                        key={item.id}
                        onClick={() => setFontFamily(item.id as ReaderFontFamily)}
                        className={`rounded-lg py-1.5 text-center font-medium transition ${
                          fontFamily === item.id ? 'bg-brand-500 text-white' : 'bg-black/5 hover:bg-black/10 dark:bg-white/10'
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 版心宽度 */}
                <div>
                  <div className="mb-1.5 font-medium opacity-70">版心宽度</div>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: 'max-w-xl', label: '紧凑' },
                      { id: 'max-w-3xl', label: '适中' },
                      { id: 'max-w-5xl', label: '宽版' },
                    ].map((item) => (
                      <button
                        key={item.id}
                        onClick={() => setMaxWidth(item.id)}
                        className={`rounded-lg py-1.5 text-center font-medium transition ${
                          maxWidth === item.id ? 'bg-brand-500 text-white' : 'bg-black/5 hover:bg-black/10 dark:bg-white/10'
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* 主阅读内容区域 */}
      <main className="relative flex-1 overflow-hidden">
        {isPdf ? (
          <PdfReaderCore
            book={book}
            theme={theme}
            zoomLevel={pdfZoom}
            onZoomChange={setPdfZoom}
            showBars={showBars}
            onToggleBars={() => setShowBars((b) => !b)}
            onProgress={onProgress}
          />
        ) : (
          <FlowReaderCore
            book={book}
            format={format}
            chapters={chapters}
            initialChapter={initialChapter}
            mode={mode}
            theme={theme}
            fontSize={fontSize}
            lineHeight={lineHeight}
            fontFamily={fontFamily}
            maxWidth={maxWidth}
            showBars={showBars}
            onToggleBars={() => setShowBars((b) => !b)}
            onProgress={onProgress}
          />
        )}
      </main>
    </div>
  )
}

// ==========================================
// 流式书籍渲染核心（EPUB / TXT / MOBI / AZW3）
// ==========================================

function FlowReaderCore({
  book,
  format,
  chapters,
  initialChapter,
  mode,
  theme,
  fontSize,
  lineHeight,
  fontFamily,
  maxWidth,
  showBars,
  onToggleBars,
  onProgress,
}: {
  book: Book
  format: string
  chapters: { index: number; href: string; title: string }[]
  initialChapter: number
  mode: ReaderMode
  theme: ReaderTheme
  fontSize: number
  lineHeight: number
  fontFamily: ReaderFontFamily
  maxWidth: string
  showBars: boolean
  onToggleBars: () => void
  onProgress: (p: { pct: number; chapter?: number }) => void
}) {
  const [chapterIdx, setChapterIdx] = useState(() =>
    Math.min(Math.max(0, initialChapter), Math.max(0, chapters.length - 1))
  )
  const [pageIndex, setPageIndex] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [targetPageOnLoad, setTargetPageOnLoad] = useState<number | 'last' | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const contentInnerRef = useRef<HTMLDivElement>(null)
  const lastWheelTime = useRef(0)
  const isScrollingToPage = useRef(false)

  // 监听外部目录跳章事件
  useEffect(() => {
    const handleJump = (e: Event) => {
      const { chapter } = (e as CustomEvent<{ chapter: number }>).detail
      if (chapter >= 0 && chapter < chapters.length) {
        setChapterIdx(chapter)
        setTargetPageOnLoad(0)
      }
    }
    window.addEventListener('reader-jump-chapter', handleJump)
    return () => window.removeEventListener('reader-jump-chapter', handleJump)
  }, [chapters.length])

  const curChapter = chapters[chapterIdx]

  // 拉取章节 HTML 内容
  const { data: rawHtml, isLoading } = useQuery({
    queryKey: ['chapter-resource', book.id, curChapter?.href],
    queryFn: () => (curChapter ? api.bookResource(book.id, curChapter.href) : ''),
    enabled: !!curChapter,
  })

  // 清洗与优化 HTML
  const safeHtml = useMemo(() => {
    if (!rawHtml) return ''
    return rawHtml
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/javascript:/gi, '')
  }, [rawHtml])

  // 计算视口几何尺寸与真实总页数
  const recomputePages = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    const viewportH = container.clientHeight
    const contentH = container.scrollHeight
    if (viewportH <= 0) return

    const pageStep = Math.max(160, viewportH - 80)
    const maxScroll = Math.max(0, contentH - viewportH)
    const pages = maxScroll === 0 ? 1 : Math.max(1, Math.ceil(maxScroll / pageStep) + 1)
    setTotalPages(pages)

    if (targetPageOnLoad === 'last') {
      const lastPage = pages - 1
      setPageIndex(lastPage)
      container.scrollTo({ top: maxScroll, behavior: 'auto' })
      setTargetPageOnLoad(null)
    } else if (typeof targetPageOnLoad === 'number') {
      const target = Math.min(pages - 1, targetPageOnLoad)
      setPageIndex(target)
      container.scrollTo({ top: Math.min(maxScroll, target * pageStep), behavior: 'auto' })
      setTargetPageOnLoad(null)
    } else {
      setPageIndex((cur) => Math.min(cur, pages - 1))
    }
  }, [targetPageOnLoad])

  // 监听内容高度变化（排版调整、图片加载完成、窗口缩放）
  useLayoutEffect(() => {
    if (isLoading || !safeHtml) return
    recomputePages()

    const container = containerRef.current
    const inner = contentInnerRef.current
    if (!container || !inner) return

    const ro = new ResizeObserver(() => {
      recomputePages()
    })
    ro.observe(inner)

    const imgs = inner.querySelectorAll('img')
    imgs.forEach((img) => {
      if (!img.complete) {
        img.addEventListener('load', recomputePages, { once: true })
      }
    })

    window.addEventListener('resize', recomputePages)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', recomputePages)
    }
  }, [safeHtml, isLoading, fontSize, lineHeight, maxWidth, fontFamily, recomputePages])

  // 进度上报与页码同步
  useEffect(() => {
    if (chapters.length === 0) return
    const chProgress = chapterIdx / chapters.length
    const pageProgress = totalPages > 1 ? (pageIndex / totalPages) * (1 / chapters.length) : 0
    const pct = Math.min(100, Math.round((chProgress + pageProgress) * 1000) / 10)
    onProgress({ pct, chapter: chapterIdx })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterIdx, pageIndex, totalPages, chapters.length])

  // 滚动时反查当前阅读所在页
  const handleScroll = () => {
    if (isScrollingToPage.current) return
    const container = containerRef.current
    if (!container) return
    const viewportH = container.clientHeight
    const pageStep = Math.max(160, viewportH - 80)
    const curTop = container.scrollTop
    const detected = Math.min(totalPages - 1, Math.round(curTop / pageStep))
    setPageIndex((prev) => (prev !== detected ? detected : prev))
  }

  // 翻页操作（平滑位移一屏）
  const scrollToPage = (p: number) => {
    const container = containerRef.current
    if (!container) return
    const viewportH = container.clientHeight
    const contentH = container.scrollHeight
    const maxScroll = Math.max(0, contentH - viewportH)
    const pageStep = Math.max(160, viewportH - 80)
    const targetTop = Math.min(maxScroll, p * pageStep)

    isScrollingToPage.current = true
    container.scrollTo({ top: targetTop, behavior: 'smooth' })
    setPageIndex(p)
    setTimeout(() => {
      isScrollingToPage.current = false
    }, 350)
  }

  const goPrevPage = () => {
    if (pageIndex > 0) {
      scrollToPage(pageIndex - 1)
    } else if (chapterIdx > 0) {
      setTargetPageOnLoad('last')
      setChapterIdx((c) => c - 1)
    }
  }

  const goNextPage = () => {
    if (pageIndex < totalPages - 1) {
      scrollToPage(pageIndex + 1)
    } else if (chapterIdx < chapters.length - 1) {
      setTargetPageOnLoad(0)
      setChapterIdx((c) => c + 1)
    }
  }

  // 滚轮翻页（防抖控制：每次滚动触发一页翻页，末尾切下一章）
  const handleWheel = (e: React.WheelEvent) => {
    if (mode === 'scroll') return
    const now = Date.now()
    if (now - lastWheelTime.current < 260) return
    if (e.deltaY > 25) {
      lastWheelTime.current = now
      goNextPage()
    } else if (e.deltaY < -25) {
      lastWheelTime.current = now
      goPrevPage()
    }
  }

  // 键盘快捷键监听
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) {
        e.preventDefault()
        goNextPage()
      } else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) {
        e.preventDefault()
        goPrevPage()
      } else if (e.key === ']' && chapterIdx < chapters.length - 1) {
        e.preventDefault()
        setTargetPageOnLoad(0)
        setChapterIdx((c) => c + 1)
      } else if (e.key === '[' && chapterIdx > 0) {
        e.preventDefault()
        setTargetPageOnLoad(0)
        setChapterIdx((c) => c - 1)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  })

  // 字体样式
  const fontStyle = {
    fontSize: `${fontSize}px`,
    lineHeight: lineHeight,
    fontFamily:
      fontFamily === 'serif'
        ? '"Songti SC", STSong, "Noto Serif SC", SimSun, serif'
        : fontFamily === 'kai'
          ? '"Kaiti SC", STKaiti, "Noto Sans CJK SC", KaiTi, serif'
          : '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
  }

  const curTheme = THEMES[theme]

  return (
    <div className="relative h-full w-full select-none overflow-hidden">
      {/* 仿真分页与滚动通用阅读视口 */}
      <div
        ref={containerRef}
        onWheel={handleWheel}
        onScroll={handleScroll}
        className={`relative h-full w-full overflow-y-auto ${
          mode === 'paged'
            ? 'scrollbar-none [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden'
            : ''
        }`}
      >
        <div
          ref={contentInnerRef}
          className={`mx-auto min-h-full px-8 py-10 sm:px-16 md:px-24 ${maxWidth}`}
          style={fontStyle}
        >
          {isLoading ? (
            <div className="flex h-64 items-center justify-center text-sm opacity-50">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 加载章节中…
            </div>
          ) : (
            <div
              className="prose prose-slate max-w-none dark:prose-invert [&_img]:mx-auto [&_img]:my-6 [&_img]:max-h-[85vh] [&_img]:w-auto [&_img]:rounded-lg [&_p]:my-4 [&_p]:indent-8 [&_h1]:mb-8 [&_h1]:text-center [&_h1]:text-2xl [&_h2]:mb-6 [&_h2]:text-center [&_h2]:text-xl"
              dangerouslySetInnerHTML={{ __html: safeHtml }}
            />
          )}

          {/* 连续滚动模式下的章末翻章提示条 */}
          {mode === 'scroll' && !isLoading && (
            <div
              className="mt-16 flex items-center justify-between border-t py-8 opacity-80"
              style={{ borderColor: curTheme.barBorder }}
            >
              <Button
                variant="outline"
                disabled={chapterIdx <= 0}
                onClick={() => {
                  setChapterIdx((c) => Math.max(0, c - 1))
                  containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
                }}
              >
                <ChevronLeft className="h-4 w-4" /> 上一章
              </Button>
              <span className="text-xs">{curChapter?.title ?? `第 ${chapterIdx + 1} 节`}</span>
              <Button
                variant="outline"
                disabled={chapterIdx >= chapters.length - 1}
                onClick={() => {
                  setChapterIdx((c) => Math.min(chapters.length - 1, c + 1))
                  containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
                }}
              >
                下一章 <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* 仿真分页模式交互热区：左 20% 上一页，中 60% 控制栏，右 20% 下一页 */}
      {mode === 'paged' && (
        <>
          <div
            className="absolute top-0 bottom-0 left-0 z-20 w-1/5 cursor-w-resize"
            onClick={goPrevPage}
            title="点击翻到上一页 (← / 滚轮上滑)"
          />
          <div
            className="absolute top-0 bottom-0 left-[20%] z-10 w-3/5 cursor-pointer"
            onClick={onToggleBars}
            title="点击呼出 / 隐藏控制栏"
          />
          <div
            className="absolute top-0 bottom-0 right-0 z-20 w-1/5 cursor-e-resize"
            onClick={goNextPage}
            title="点击翻到下一页 (→ / 滚轮下滑)"
          />

          {/* 悬浮翻页箭头按钮（大屏鼠标滑过显示） */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              goPrevPage()
            }}
            disabled={chapterIdx <= 0 && pageIndex <= 0}
            className="absolute left-3 top-1/2 z-30 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/25 text-white opacity-0 shadow-lg backdrop-blur transition-all duration-200 hover:scale-110 hover:bg-black/50 hover:opacity-100 disabled:pointer-events-none disabled:opacity-0"
            title="上一页"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              goNextPage()
            }}
            disabled={chapterIdx >= chapters.length - 1 && pageIndex >= totalPages - 1}
            className="absolute right-3 top-1/2 z-30 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/25 text-white opacity-0 shadow-lg backdrop-blur transition-all duration-200 hover:scale-110 hover:bg-black/50 hover:opacity-100 disabled:pointer-events-none disabled:opacity-0"
            title="下一页"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        </>
      )}

      {/* 底部悬浮控制与进度栏 */}
      <footer
        className={`absolute bottom-0 left-0 right-0 z-30 flex h-12 items-center justify-between border-t px-4 backdrop-blur-md transition-all duration-200 ${
          showBars ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0 pointer-events-none'
        }`}
        style={{
          backgroundColor: curTheme.barBg,
          borderColor: curTheme.barBorder,
          color: curTheme.barText,
        }}
      >
        <div className="flex items-center gap-2 text-xs">
          <Button
            size="sm"
            variant="ghost"
            disabled={chapterIdx <= 0 && pageIndex <= 0}
            onClick={goPrevPage}
            className="h-7 px-2"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            {mode === 'paged' ? (pageIndex === 0 ? '上一章' : '上一页') : '上一章'}
          </Button>
        </div>

        <div className="flex flex-1 items-center justify-center gap-3 px-4">
          <span className="truncate text-xs opacity-80">
            {curChapter?.title ?? `第 ${chapterIdx + 1} 节`}
          </span>
          {mode === 'paged' && (
            <span className="shrink-0 font-mono text-[11px] opacity-70">
              第 {pageIndex + 1} / {totalPages} 页
            </span>
          )}
          <span className="shrink-0 font-mono text-[11px] font-semibold text-brand-600 dark:text-brand-400">
            {chapters.length > 0 ? Math.round(((chapterIdx + 1) / chapters.length) * 100) : 0}%
          </span>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <Button
            size="sm"
            variant="ghost"
            disabled={chapterIdx >= chapters.length - 1 && pageIndex >= totalPages - 1}
            onClick={goNextPage}
            className="h-7 px-2"
          >
            {mode === 'paged' ? (pageIndex >= totalPages - 1 ? '下一章' : '下一页') : '下一章'}
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </footer>
    </div>
  )
}

// ==========================================
// PDF 高清极速分页渲染核心
// ==========================================

function PdfReaderCore({
  book,
  theme,
  zoomLevel,
  onZoomChange,
  showBars,
  onToggleBars,
  onProgress,
}: {
  book: Book
  theme: ReaderTheme
  zoomLevel: number
  onZoomChange: React.Dispatch<React.SetStateAction<number>>
  showBars: boolean
  onToggleBars: () => void
  onProgress: (p: { pct: number; chapter?: number }) => void
}) {
  const [currentPage, setCurrentPage] = useState(1)
  const [imgLoading, setImgLoading] = useState(true)
  const [imgError, setImgError] = useState(false)
  const [retryKey, setRetryKey] = useState(0)

  // 放大后的拖拽平移状态
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 })
  const [isDraggingActive, setIsDraggingActive] = useState(false)
  const isDragging = useRef(false)
  const dragStart = useRef({ x: 0, y: 0 })
  const hasDragged = useRef(false)
  const lastWheelTime = useRef(0)

  const { data: meta } = useQuery({
    queryKey: ['book-pdf-meta', book.id],
    queryFn: () => api.pdfMeta(book.id),
  })

  const totalPages = meta?.page_count ?? 1

  // 监听外部跳转 PDF 页码事件
  useEffect(() => {
    const handleJump = (e: Event) => {
      const { page } = (e as CustomEvent<{ page: number }>).detail
      if (page >= 1 && page <= totalPages) {
        setCurrentPage(page)
      }
    }
    window.addEventListener('reader-jump-pdf', handleJump)
    return () => window.removeEventListener('reader-jump-pdf', handleJump)
  }, [totalPages])

  // 上报阅读进度
  useEffect(() => {
    if (totalPages <= 0) return
    const pct = Math.min(100, Math.round((currentPage / totalPages) * 1000) / 10)
    onProgress({ pct, chapter: currentPage })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, totalPages])

  // 页面切换时重置加载状态与平移偏移
  useEffect(() => {
    setImgLoading(true)
    setImgError(false)
    setPanOffset({ x: 0, y: 0 })
  }, [currentPage, retryKey])

  // 重置缩放比例为 100% 时自动归零平移
  useEffect(() => {
    if (zoomLevel === 100) {
      setPanOffset({ x: 0, y: 0 })
    }
  }, [zoomLevel])

  // 预加载下一页
  useEffect(() => {
    if (currentPage < totalPages) {
      const img = new Image()
      img.src = api.pdfPageUrl(book.id, currentPage + 1)
    }
  }, [book.id, currentPage, totalPages])

  const goPrev = () => setCurrentPage((p) => Math.max(1, p - 1))
  const goNext = () => setCurrentPage((p) => Math.min(totalPages, p + 1))

  // 鼠标滚轮缩放与翻页
  const handleWheel = (e: React.WheelEvent) => {
    // 1. 优先捕获触控板双指缩放手势或 Ctrl/Cmd + 鼠标滚轮缩放
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      if (e.deltaY < 0) {
        onZoomChange((z) => Math.min(250, z + 10))
      } else if (e.deltaY > 0) {
        onZoomChange((z) => Math.max(50, z - 10))
      }
      return
    }

    // 2. 普通滚轮：上下翻页（带 260ms 防抖控制）
    const now = Date.now()
    if (now - lastWheelTime.current < 260) return
    if (e.deltaY > 25) {
      lastWheelTime.current = now
      goNext()
    } else if (e.deltaY < -25) {
      lastWheelTime.current = now
      goPrev()
    }
  }

  // 键盘快捷键监听（翻页与缩放）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) {
        e.preventDefault()
        goNext()
      } else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) {
        e.preventDefault()
        goPrev()
      } else if (['+', '=', 'Add'].includes(e.key) && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        onZoomChange((z) => Math.min(250, z + 15))
      } else if (['-', '_', 'Subtract'].includes(e.key) && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        onZoomChange((z) => Math.max(50, z - 15))
      } else if (e.key === '0' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        onZoomChange(100)
        setPanOffset({ x: 0, y: 0 })
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  })

  // 放大状态下的拖拽平移处理
  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoomLevel > 100 && e.button === 0) {
      isDragging.current = true
      dragStart.current = { x: e.clientX - panOffset.x, y: e.clientY - panOffset.y }
      hasDragged.current = false
      setIsDraggingActive(true)
    }
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging.current && zoomLevel > 100) {
      const newX = e.clientX - dragStart.current.x
      const newY = e.clientY - dragStart.current.y
      if (Math.abs(newX - panOffset.x) > 4 || Math.abs(newY - panOffset.y) > 4) {
        hasDragged.current = true
      }
      setPanOffset({ x: newX, y: newY })
    }
  }

  const handleMouseUp = () => {
    isDragging.current = false
    setIsDraggingActive(false)
  }

  // 双击快速放大/还原
  const handleDoubleClick = () => {
    if (zoomLevel <= 100) {
      onZoomChange(150)
    } else {
      onZoomChange(100)
      setPanOffset({ x: 0, y: 0 })
    }
  }

  const handleCenterClick = () => {
    if (hasDragged.current) {
      hasDragged.current = false
      return
    }
    onToggleBars()
  }

  const curTheme = THEMES[theme]

  return (
    <div
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      className={`relative flex h-full w-full select-none flex-col items-center justify-center overflow-hidden p-4 sm:p-6 ${
        zoomLevel > 100 ? (isDraggingActive ? 'cursor-grabbing' : 'cursor-grab') : ''
      }`}
    >
      {/* PDF 页面图像展示区 */}
      <div
        className="relative flex min-h-0 max-w-full flex-1 items-center justify-center overflow-hidden"
        onDoubleClick={handleDoubleClick}
      >
        {imgLoading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center text-sm opacity-50 pointer-events-none">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> 加载页面中…
          </div>
        )}

        {imgError ? (
          <div className="z-10 flex flex-col items-center justify-center rounded-xl border border-red-500/20 bg-red-500/5 p-8 text-center text-xs text-red-500">
            <p className="mb-3 font-medium">第 {currentPage} 页图像渲染失败</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setRetryKey((k) => k + 1)}
              className="h-8 gap-1"
            >
              <RotateCcw className="h-3.5 w-3.5" /> 重新渲染
            </Button>
          </div>
        ) : (
          <img
            key={`${currentPage}-${retryKey}`}
            src={api.pdfPageUrl(book.id, currentPage)}
            alt={`第 ${currentPage} 页`}
            onLoad={() => setImgLoading(false)}
            onError={() => {
              setImgLoading(false)
              setImgError(true)
            }}
            className={`max-h-[85vh] max-w-full rounded-md ${
              theme === 'night' ? 'ring-1 ring-white/15' : 'shadow-2xl'
            } ${imgLoading ? 'opacity-20' : 'opacity-100'}`}
            style={{
              transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomLevel / 100})`,
              transformOrigin: 'center center',
              transition: isDraggingActive ? 'none' : 'transform 150ms ease-out',
              filter: curTheme.pdfFilter || 'none',
            }}
            draggable={false}
          />
        )}
      </div>

      {/* 屏幕级交互点击翻页区：左 20% 上一页，中 60% 控制栏/双击缩放，右 20% 下一页 */}
      <div
        className="absolute top-0 bottom-0 left-0 z-20 w-1/5 cursor-w-resize"
        onClick={() => {
          if (hasDragged.current) {
            hasDragged.current = false
            return
          }
          goPrev()
        }}
        title="点击翻到上一页 (← / 滚轮上滑)"
      />
      <div
        className="absolute top-0 bottom-0 left-[20%] z-10 w-3/5 cursor-pointer"
        onClick={handleCenterClick}
        onDoubleClick={handleDoubleClick}
        title="点击切换控制栏，双击快速缩放"
      />
      <div
        className="absolute top-0 bottom-0 right-0 z-20 w-1/5 cursor-e-resize"
        onClick={() => {
          if (hasDragged.current) {
            hasDragged.current = false
            return
          }
          goNext()
        }}
        title="点击翻到下一页 (→ / 滚轮下滑)"
      />

      {/* 屏幕级悬浮翻页箭头按钮（屏幕左右两侧） */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          goPrev()
        }}
        disabled={currentPage <= 1}
        className="absolute left-3 top-1/2 z-30 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/25 text-white opacity-0 shadow-lg backdrop-blur transition-all duration-200 hover:scale-110 hover:bg-black/50 hover:opacity-100 disabled:pointer-events-none disabled:opacity-0"
        title="上一页"
      >
        <ChevronLeft className="h-6 w-6" />
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation()
          goNext()
        }}
        disabled={currentPage >= totalPages}
        className="absolute right-3 top-1/2 z-30 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/25 text-white opacity-0 shadow-lg backdrop-blur transition-all duration-200 hover:scale-110 hover:bg-black/50 hover:opacity-100 disabled:pointer-events-none disabled:opacity-0"
        title="下一页"
      >
        <ChevronRight className="h-6 w-6" />
      </button>

      {/* 底部悬浮翻页控制栏 */}
      <footer
        className={`absolute bottom-0 left-0 right-0 z-30 flex h-12 items-center justify-between border-t px-4 backdrop-blur-md transition-all duration-200 ${
          showBars ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0 pointer-events-none'
        }`}
        style={{
          backgroundColor: curTheme.barBg,
          borderColor: curTheme.barBorder,
          color: curTheme.barText,
        }}
      >
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" disabled={currentPage <= 1} onClick={goPrev} className="h-7 px-2">
            <ChevronLeft className="h-3.5 w-3.5" />上一页
          </Button>
        </div>

        <div className="flex items-center gap-4 text-xs font-mono">
          <input
            type="range"
            min={1}
            max={totalPages}
            value={currentPage}
            onChange={(e) => setCurrentPage(Number(e.target.value))}
            className="w-32 accent-brand-600 sm:w-56"
          />
          <span>
            第 {currentPage} / {totalPages} 页 ({Math.round((currentPage / totalPages) * 100)}%)
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* 缩放按钮 */}
          <button
            onClick={() => onZoomChange((z) => Math.max(50, z - 15))}
            className="rounded p-1 opacity-70 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
            title="缩小 (快捷键 - / Ctrl+滚轮下)"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => {
              onZoomChange(100)
              setPanOffset({ x: 0, y: 0 })
            }}
            className="min-w-[42px] px-1 text-center font-mono text-[11px] font-medium opacity-80 transition hover:opacity-100 hover:underline"
            title="点击重置为 100% 原始大小 (快捷键 0)"
          >
            {zoomLevel}%
          </button>
          <button
            onClick={() => onZoomChange((z) => Math.min(250, z + 15))}
            className="rounded p-1 opacity-70 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
            title="放大 (快捷键 + / Ctrl+滚轮上 / 双击)"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>

          <Button size="sm" variant="ghost" disabled={currentPage >= totalPages} onClick={goNext} className="h-7 px-2">
            下一页<ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </footer>
    </div>
  )
}

// ==========================================
// 目录组件辅助函数
// ==========================================

function FlowTocList({
  chapters,
  filter,
  onSelect,
}: {
  chapters: { index: number; href: string; title: string }[]
  filter: string
  onSelect: (idx: number) => void
}) {
  const filtered = chapters.filter((c) =>
    filter ? c.title.toLowerCase().includes(filter.toLowerCase()) : true
  )

  if (filtered.length === 0) {
    return <div className="py-8 text-center text-xs opacity-50">未匹配到相关章节</div>
  }

  return (
    <ul className="space-y-1 text-xs">
      {filtered.map((chap) => (
        <li key={chap.index}>
          <button
            onClick={() => onSelect(chap.index)}
            className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left transition hover:bg-black/5 dark:hover:bg-white/10"
          >
            <span className="truncate">{chap.title}</span>
            <span className="ml-2 font-mono text-[10px] opacity-40">#{chap.index + 1}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function PdfTocList({
  toc,
  filter,
  onSelect,
}: {
  toc: { level: number; title: string; page: number }[]
  filter: string
  onSelect: (page: number) => void
}) {
  const filtered = toc.filter((item) =>
    filter ? item.title.toLowerCase().includes(filter.toLowerCase()) : true
  )

  if (filtered.length === 0) {
    return <div className="py-8 text-center text-xs opacity-50">未发现 PDF 书签目录</div>
  }

  return (
    <ul className="space-y-1 text-xs">
      {filtered.map((item, idx) => (
        <li key={idx} style={{ paddingLeft: `${Math.max(0, (item.level - 1) * 12)}px` }}>
          <button
            onClick={() => onSelect(item.page)}
            className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left transition hover:bg-black/5 dark:hover:bg-white/10"
          >
            <span className="truncate">{item.title}</span>
            <span className="ml-2 font-mono text-[10px] opacity-50">P.{item.page}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}
