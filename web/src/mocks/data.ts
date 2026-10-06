import type {
  Album, Book, Clip, ConfirmItem, FontFamily, Job, Photo, Series, Stats, Track,
} from '@/types'

// ============ 字体 ============
const CSS = {
  serif: 'ui-serif, Georgia, "Songti SC", serif',
  sans: 'system-ui, -apple-system, "PingFang SC", sans-serif',
  mono: 'ui-monospace, Menlo, monospace',
  kai: '"Kaiti SC", "STKaiti", serif',
  round: '"Yuanti SC", "PingFang SC", sans-serif',
  hand: '"Xingkai SC", "Kaiti SC", cursive',
}

function charset(han: number, gb: number, latin = 100, hangul = 0) {
  return [
    { name: '拉丁字母', pct: latin },
    { name: '常用汉字（3500）', pct: han },
    { name: 'GB2312 全集', pct: gb },
    { name: '谚文', pct: hangul },
  ]
}

export const FONTS: FontFamily[] = [
  {
    id: 'f1', family: '思源宋体', familyEn: 'Source Han Serif SC', variable: true,
    axes: [{ tag: 'wght', min: 200, max: 900, def: 400 }],
    files: [
      { styleName: 'ExtraLight 200', weight: 200, italic: false, format: 'OTF', sizeMB: 8.9 },
      { styleName: 'Light 300', weight: 300, italic: false, format: 'OTF', sizeMB: 8.9 },
      { styleName: 'Regular 400', weight: 400, italic: false, format: 'OTF', sizeMB: 9.1 },
      { styleName: 'Medium 500', weight: 500, italic: false, format: 'OTF', sizeMB: 9.0 },
      { styleName: 'Bold 700', weight: 700, italic: false, format: 'OTF', sizeMB: 9.2 },
      { styleName: 'Black 900', weight: 900, italic: false, format: 'OTF', sizeMB: 9.3 },
    ],
    glyphCount: 65535, languages: ['简体中文', '繁体中文', '日文', '拉丁'],
    license: 'SIL OFL 1.1', version: '2.003', designer: 'Adobe / Google',
    tags: ['衬线', '中文'], rating: 5, favorite: true, createdAt: '2026-08-02',
    charset: charset(99.8, 97.2), css: CSS.serif,
  },
  {
    id: 'f2', family: 'Inter', familyEn: 'Inter', variable: true,
    axes: [{ tag: 'wght', min: 100, max: 900, def: 400 }],
    files: [
      { styleName: 'Light 300', weight: 300, italic: false, format: 'TTF', sizeMB: 0.8 },
      { styleName: 'Regular 400', weight: 400, italic: false, format: 'TTF', sizeMB: 0.8 },
    ],
    glyphCount: 2834, languages: ['拉丁'],
    license: 'SIL OFL 1.1', version: '4.1', designer: 'Rasmus Andersson',
    tags: ['无衬线'], rating: 5, favorite: true, createdAt: '2026-07-18',
    charset: charset(0, 0), css: CSS.sans,
  },
  {
    id: 'f3', family: 'JetBrains Mono', familyEn: 'JetBrains Mono', variable: false,
    axes: [],
    files: [
      { styleName: 'Regular 400', weight: 400, italic: false, format: 'OTF', sizeMB: 0.3 },
      { styleName: 'Bold 700', weight: 700, italic: false, format: 'OTF', sizeMB: 0.3 },
      { styleName: 'Italic 400', weight: 400, italic: true, format: 'OTF', sizeMB: 0.3 },
      { styleName: 'Bold Italic 700', weight: 700, italic: true, format: 'OTF', sizeMB: 0.3 },
    ],
    glyphCount: 4512, languages: ['拉丁'],
    license: 'SIL OFL 1.1', version: '2.0', designer: 'JetBrains',
    tags: ['等宽'], rating: 5, favorite: false, createdAt: '2026-06-11',
    charset: charset(0, 0), css: CSS.mono,
  },
  {
    id: 'f4', family: '霞鹜文楷', familyEn: 'LXGW WenKai', variable: true,
    axes: [{ tag: 'wght', min: 300, max: 700, def: 400 }],
    files: [
      { styleName: 'Light 300', weight: 300, italic: false, format: 'TTF', sizeMB: 18.2 },
      { styleName: 'Regular 400', weight: 400, italic: false, format: 'TTF', sizeMB: 18.5 },
      { styleName: 'Bold 700', weight: 700, italic: false, format: 'TTF', sizeMB: 18.8 },
    ],
    glyphCount: 9231, languages: ['简体中文', '繁体中文'],
    license: 'SIL OFL 1.1', version: '1.5', designer: 'lxgw',
    tags: ['楷体', '中文'], rating: 5, favorite: true, createdAt: '2026-05-30',
    charset: charset(98.1, 95.0), css: CSS.kai,
  },
  {
    id: 'f5', family: '圆体示例', familyEn: 'Round Demo', variable: false,
    axes: [],
    files: [400, 500, 700, 800, 900].map((w) => ({ styleName: `${w}`, weight: w, italic: false, format: 'TTF', sizeMB: 4.2 })),
    glyphCount: 7102, languages: ['简体中文'],
    license: '商用需授权', version: '1.0', designer: 'Demo',
    tags: ['圆体', '中文'], rating: 4, favorite: false, createdAt: '2026-05-02',
    charset: charset(96.0, 92.3), css: CSS.round,
  },
  {
    id: 'f6', family: '衬线示例', familyEn: 'Serif Demo', variable: false,
    axes: [],
    files: [
      { styleName: 'Regular 400', weight: 400, italic: false, format: 'WOFF2', sizeMB: 0.4 },
      { styleName: 'Italic 400', weight: 400, italic: true, format: 'WOFF2', sizeMB: 0.4 },
    ],
    glyphCount: 2048, languages: ['拉丁'],
    license: 'SIL OFL 1.1', version: '1.2', designer: 'Demo',
    tags: ['衬线'], rating: 4, favorite: false, createdAt: '2026-04-19',
    charset: charset(0, 0), css: CSS.serif,
  },
  {
    id: 'f7', family: '黑体示例', familyEn: 'Hei Demo', variable: false,
    axes: [],
    files: [100, 200, 300, 400, 500, 600, 700, 800, 900].map((w) => ({ styleName: `${w}`, weight: w, italic: false, format: 'OTF', sizeMB: 6.1 })),
    glyphCount: 8106, languages: ['简体中文', '繁体中文', '日文'],
    license: 'SIL OFL 1.1', version: '3.0', designer: 'Demo',
    tags: ['无衬线', '中文'], rating: 4, favorite: false, createdAt: '2026-03-25',
    charset: charset(99.2, 96.5), css: CSS.sans,
  },
  {
    id: 'f8', family: '楷体示例', familyEn: 'Kai Demo', variable: false,
    axes: [],
    files: [{ styleName: 'Regular 400', weight: 400, italic: false, format: 'TTF', sizeMB: 11.4 }],
    glyphCount: 6803, languages: ['简体中文'],
    license: '免费商用', version: '1.0', designer: 'Demo',
    tags: ['楷体', '中文'], rating: 3, favorite: false, createdAt: '2026-03-01',
    charset: charset(97.0, 93.8), css: CSS.kai,
  },
  {
    id: 'f9', family: '手写体示例', familyEn: 'Handwriting Demo', variable: false,
    axes: [],
    files: [
      { styleName: 'Regular 400', weight: 400, italic: true, format: 'WOFF', sizeMB: 0.6 },
    ],
    glyphCount: 982, languages: ['拉丁'],
    license: 'SIL OFL 1.1', version: '1.0', designer: 'Demo',
    tags: ['手写'], rating: 3, favorite: false, createdAt: '2026-02-14',
    charset: charset(0, 0), css: CSS.hand,
  },
]

// ============ 音乐 ============
let trackSeq = 0
function tr(albumId: string, no: number, title: string, durationSec: number, bitrateK: number, lrc = false): Track {
  trackSeq += 1
  return { id: `t${trackSeq}`, albumId, no, title, durationSec, bitrateK, lrc }
}

export const ALBUMS: Album[] = [
  {
    id: 'a1', title: '冀西南林路行', artist: '万能青年旅店', year: 2020, genre: '摇滚',
    format: 'FLAC', khz: 44.1, bit: 24, hue: 245,
    tracks: [
      tr('a1', 1, '早', 372, 1046),
      tr('a1', 2, '泥河', 514, 1021, true),
      tr('a1', 3, '杀死那个石家庄人', 344, 1046, true),
      tr('a1', 4, '十万嬉皮', 419, 1038, true),
      tr('a1', 5, '在这颗行星所有的酒馆', 314, 1012),
      tr('a1', 6, '大石碎胸口', 481, 1049, true),
      tr('a1', 7, '采石', 387, 1027),
      tr('a1', 8, '山雀', 423, 1035, true),
    ],
    tags: ['华语', '摇滚'], rating: 5, favorite: true, createdAt: '2026-09-02',
    note: '乐队第二张录音室专辑。内嵌标签完整；第 3 轨歌词由 LRC 外挂文件匹配。',
  },
  {
    id: 'a2', title: '后青春期的诗', artist: '五月天', year: 2008, genre: '摇滚',
    format: 'FLAC', khz: 44.1, bit: 16, hue: 190,
    tracks: [tr('a2', 1, '突然好想你', 273, 986, true), tr('a2', 2, '如烟', 340, 970, true), tr('a2', 3, '你不是真正的快乐', 312, 995, true), tr('a2', 4, '笑忘歌', 305, 978)],
    tags: ['华语', '摇滚'], rating: 4, favorite: false, createdAt: '2026-08-21',
    note: '',
  },
  {
    id: 'a3', title: '范特西', artist: '周杰伦', year: 2001, genre: '流行',
    format: 'MP3', khz: 44.1, bit: 16, hue: 25,
    tracks: [tr('a3', 1, '爱在西元前', 287, 320, true), tr('a3', 2, '简单爱', 267, 315, true), tr('a3', 3, '双截棍', 232, 318, true), tr('a3', 4, '安静', 297, 322, true)],
    tags: ['华语', '流行'], rating: 5, favorite: true, createdAt: '2026-08-11',
    note: '',
  },
  {
    id: 'a4', title: 'Random Access Memories', artist: 'Daft Punk', year: 2013, genre: '电子',
    format: 'FLAC', khz: 44.1, bit: 24, hue: 215,
    tracks: [tr('a4', 1, 'Give Life Back to Music', 277, 1052), tr('a4', 2, 'Get Lucky', 369, 1048, true), tr('a4', 3, 'Instant Crush', 337, 1041), tr('a4', 4, 'Lose Yourself to Dance', 357, 1044)],
    tags: ['电子'], rating: 5, favorite: false, createdAt: '2026-07-30',
    note: '',
  },
  {
    id: 'a5', title: '如也', artist: '陈粒', year: 2015, genre: '民谣',
    format: 'FLAC', khz: 44.1, bit: 16, hue: 300,
    tracks: [tr('a5', 1, '奇妙能力歌', 246, 990, true), tr('a5', 2, '小半', 258, 985, true), tr('a5', 3, '易燃易爆炸', 231, 992, true)],
    tags: ['华语', '民谣'], rating: 4, favorite: false, createdAt: '2026-07-12',
    note: '',
  },
  {
    id: 'a6', title: '岁月鸿沟', artist: '惘闻', year: 2020, genre: '后摇',
    format: 'FLAC', khz: 44.1, bit: 24, hue: 75,
    tracks: [tr('a6', 1, '水之湄', 512, 1058), tr('a6', 2, '岁月鸿沟', 623, 1061), tr('a6', 3, ' Rain Watcher', 468, 1049)],
    tags: ['后摇', '器乐'], rating: 4, favorite: false, createdAt: '2026-06-28',
    note: '',
  },
  {
    id: 'a7', title: 'Ten', artist: 'Pearl Jam', year: 1991, genre: 'Grunge',
    format: 'FLAC', khz: 44.1, bit: 16, hue: 330,
    tracks: [tr('a7', 1, 'Once', 230, 982), tr('a7', 2, 'Even Flow', 337, 978), tr('a7', 3, 'Black', 342, 985, true), tr('a7', 4, 'Jeremy', 325, 980, true)],
    tags: ['欧美', '摇滚'], rating: 5, favorite: false, createdAt: '2026-06-05',
    note: '',
  },
  {
    id: 'a8', title: '濯缨', artist: '声音玩具', year: 2019, genre: '摇滚',
    format: 'FLAC', khz: 44.1, bit: 16, hue: 195,
    tracks: [tr('a8', 1, '你的城市', 389, 995, true), tr('a8', 2, '爱是昂贵的', 421, 998, true), tr('a8', 3, '超级城市', 356, 990)],
    tags: ['华语', '摇滚'], rating: 4, favorite: false, createdAt: '2026-05-19',
    note: '',
  },
  {
    id: 'a9', title: 'Toys in the Attic', artist: 'Aerosmith', year: 1975, genre: 'Hard Rock',
    format: 'FLAC', khz: 44.1, bit: 16, hue: 15,
    tracks: [tr('a9', 1, 'Toys in the Attic', 230, 970), tr('a9', 2, 'Walk This Way', 224, 975), tr('a9', 3, 'Sweet Emotion', 274, 972)],
    tags: ['欧美', '摇滚'], rating: 4, favorite: false, createdAt: '2026-04-25',
    note: '',
  },
  {
    id: 'a10', title: '山雀（单曲）', artist: '万能青年旅店', year: 2021, genre: '摇滚',
    format: 'MP3', khz: 44.1, bit: 16, hue: 25,
    tracks: [tr('a10', 1, '山雀（单曲版）', 418, 320, true)],
    tags: ['华语', '单曲'], rating: 4, favorite: false, createdAt: '2026-04-02',
    note: '',
  },
  {
    id: 'a11', title: '生来彷徨', artist: '汪峰', year: 2013, genre: '摇滚',
    format: 'MP3', khz: 44.1, bit: 16, hue: 320,
    tracks: [tr('a11', 1, '生来彷徨', 302, 316, true), tr('a11', 2, '存在', 331, 318, true), tr('a11', 3, '北京北京', 283, 320, true), tr('a11', 4, '春天里', 297, 315, true)],
    tags: ['华语', '摇滚'], rating: 3, favorite: false, createdAt: '2026-03-15',
    note: '',
  },
  {
    id: 'a12', title: 'Simple Things', artist: 'Zero 7', year: 2001, genre: 'Downtempo',
    format: 'FLAC', khz: 44.1, bit: 16, hue: 165,
    tracks: [tr('a12', 1, 'I Have Seen', 301, 988), tr('a12', 2, 'Destiny', 261, 992, true), tr('a12', 3, 'Give It Away', 288, 985)],
    tags: ['欧美', '电子'], rating: 4, favorite: false, createdAt: '2026-02-27',
    note: '',
  },
]

// ============ 视频 ============
function eps(count: number, titles: string[], baseDur = 2600, playableFrom = 999): Episode2[] {
  return Array.from({ length: count }, (_, i) => ({
    idx: i + 1,
    title: titles[i] ?? `第${String(i + 1).padStart(2, '0')}讲`,
    durationSec: baseDur + ((i * 137) % 900),
    playable: i + 1 <= playableFrom,
  }))
}
type Episode2 = { idx: number; title: string; durationSec: number; playable: boolean }

export const SERIES: Series[] = [
  {
    id: 's1', title: 'Rust 系统编程教程', kind: 'tutorial', sizeGB: 38.2,
    resolution: '1080p', codec: 'H.264 / AAC', playableAll: true, addedAt: '2026-08-12', hue: 220, watched: 3,
    tags: ['Rust', '编程', '教程'], note: '含源码压缩包，见第 24 集备注。',
    episodes: eps(24, [
      '第01讲：环境搭建与 Cargo', '第02讲：变量与基础类型', '第03讲：所有权与借用',
      '第04讲：结构体与枚举', '第05讲：Trait 与泛型', '第06讲：错误处理',
    ]),
  },
  {
    id: 's2', title: 'Go Web 开发实战', kind: 'tutorial', sizeGB: 24.5,
    resolution: '1080p', codec: 'H.264 / AAC', playableAll: true, addedAt: '2026-09-10', hue: 190, watched: 0,
    tags: ['Go', '编程', '教程'], note: '',
    episodes: eps(18, ['第01讲：net/http 基础', '第02讲：路由与中间件', '第03讲：数据库访问', '第04讲：模板渲染']),
  },
  {
    id: 's3', title: '算法导论（MIT 6.006）', kind: 'tutorial', sizeGB: 61.0,
    resolution: '720p', codec: 'H.264 / AAC', playableAll: true, addedAt: '2025-11-20', hue: 20, watched: 17,
    tags: ['算法', '教程'], note: 'mkv 容器版本已另行转码。',
    episodes: eps(32, ['Lecture 1: Algorithmic Thinking', 'Lecture 2: BSTs', 'Lecture 3: Sorting']),
  },
  {
    id: 's4', title: '深度学习入门：基于 Python', kind: 'tutorial', sizeGB: 29.8,
    resolution: '1080p', codec: 'H.264 / AAC', playableAll: true, addedAt: '2026-09-28', hue: 270, watched: 0,
    tags: ['AI', '教程'], note: '',
    episodes: eps(20, ['第01讲：感知机', '第02讲：神经网络', '第03讲：反向传播']),
  },
  {
    id: 's5', title: '摄影用光与构图课', kind: 'tutorial', sizeGB: 18.1,
    resolution: '4K', codec: 'H.265 / AAC', playableAll: true, addedAt: '2026-05-14', hue: 150, watched: 15,
    tags: ['摄影', '教程'], note: '',
    episodes: eps(15, ['第01讲：光的性质', '第02讲：自然光运用', '第03讲：布光基础']),
  },
  {
    id: 's6', title: '字体设计基础十二讲', kind: 'tutorial', sizeGB: 9.6,
    resolution: '1080p', codec: 'H.264 / AAC', playableAll: true, addedAt: '2026-10-01', hue: 45, watched: 1,
    tags: ['字体', '设计', '教程'], note: '',
    episodes: eps(12, ['第01讲：字形结构', '第02讲：骨架与重心', '第03讲：笔形语言']),
  },
]

export const CLIPS: Clip[] = [
  { id: 'c1', kind: 'clip', title: '航拍 · 雪山日出', durationSec: 42, addedAt: '2026-10-01', playable: true, resolution: '4K', sizeMB: 1200, hue: 210 },
  { id: 'c2', kind: 'clip', title: '会议录屏 · 架构评审', durationSec: 1690, addedAt: '2026-09-28', playable: true, resolution: '1080p', sizeMB: 640, hue: 190 },
  { id: 'c3', kind: 'clip', title: '产品演示 · App 操作走查', durationSec: 206, addedAt: '2026-09-22', playable: true, resolution: '1080p', sizeMB: 210, hue: 270 },
  { id: 'c4', kind: 'clip', title: '猫片 · 抓沙发', durationSec: 15, addedAt: '2026-09-20', playable: true, resolution: '4K', sizeMB: 88, hue: 330 },
  { id: 'c5', kind: 'clip', title: '生日聚会 · 家人', durationSec: 764, addedAt: '2026-09-12', playable: true, resolution: '1080p', sizeMB: 1100, hue: 150 },
  { id: 'c6', kind: 'clip', title: '延时 · 城市夜景', durationSec: 90, addedAt: '2026-09-08', playable: true, resolution: '4K', sizeMB: 340, hue: 45 },
  { id: 'c7', kind: 'clip', title: '采访片段 · 用户访谈 #7', durationSec: 482, addedAt: '2026-09-03', playable: true, resolution: '1080p', sizeMB: 720, hue: 20 },
  { id: 'c8', kind: 'clip', title: '屏幕录制 · bug 复现步骤', durationSec: 138, addedAt: '2026-08-30', playable: false, resolution: '1080p', sizeMB: 156, hue: 220 },
]

// ============ 书籍 ============
export const BOOKS: Book[] = [
  {
    id: 'b1', title: '三体', author: '刘慈欣', publisher: '重庆出版社', year: 2008, isbn: '978-7-5366-9293-0',
    series: { name: '三体三部曲', idx: 1, total: 3 },
    formats: [{ kind: 'EPUB', sizeMB: 2.8, readable: true }, { kind: 'MOBI', sizeMB: 2.1, readable: false }],
    progressPct: 100, rating: 5, tags: ['科幻', '中国作家'], hue: 245, createdAt: '2026-09-18',
    desc: '文化大革命期间，一次秘密的军事项目向宇宙发出了地球文明的信号，人类的命运从此被彻底改变……', language: '中文（简体）',
  },
  {
    id: 'b2', title: '三体Ⅱ·黑暗森林', author: '刘慈欣', publisher: '重庆出版社', year: 2008, isbn: '978-7-5366-9393-7',
    series: { name: '三体三部曲', idx: 2, total: 3 },
    formats: [{ kind: 'EPUB', sizeMB: 3.2, readable: true }, { kind: 'PDF', sizeMB: 12.4, readable: true }, { kind: 'MOBI', sizeMB: 2.1, readable: false }],
    progressPct: 42, lastChapter: '第二部 · 第 12 章「黑暗森林」', rating: 4, tags: ['科幻', '中国作家'], hue: 262, createdAt: '2026-09-21',
    desc: '巨大的三体舰队先锋已经逼近太阳系。面壁计划启动，罗辑从玩世不恭的学者，成为唯一能参透宇宙社会学两条公理的人……', language: '中文（简体）',
  },
  {
    id: 'b3', title: '三体Ⅲ·死神永生', author: '刘慈欣', publisher: '重庆出版社', year: 2010, isbn: '978-7-5366-9424-8',
    series: { name: '三体三部曲', idx: 3, total: 3 },
    formats: [{ kind: 'EPUB', sizeMB: 3.6, readable: true }, { kind: 'PDF', sizeMB: 14.1, readable: true }],
    progressPct: 0, rating: 5, tags: ['科幻', '中国作家'], hue: 220, createdAt: '2026-09-21',
    desc: '与三体文明的战争使人类第一次看到了宇宙黑暗的一面……', language: '中文（简体）',
  },
  {
    id: 'b4', title: 'Rust 程序设计（第2版）', author: 'Steve Klabnik / Carol Nichols', publisher: 'O\'Reilly', year: 2023, isbn: '978-1-7185-0310-6',
    formats: [{ kind: 'PDF', sizeMB: 9.8, readable: true }],
    progressPct: 15, lastChapter: '第 4 章 Understanding Ownership', rating: 5, tags: ['编程', 'Rust'], hue: 30, createdAt: '2026-10-01',
    desc: 'The Rust Programming Language 官方书的纸质版翻译版本。', language: '中文',
  },
  {
    id: 'b5', title: '设计中的设计', author: '原研哉', publisher: '山东人民出版社', year: 2006, isbn: '978-7-2090-4041-7',
    formats: [{ kind: 'EPUB', sizeMB: 8.4, readable: true }],
    progressPct: 15, lastChapter: '第 2 章 RE-DESIGN', rating: 4, tags: ['设计'], hue: 160, createdAt: '2026-09-25',
    desc: '「设计」到底是什么？原研哉以日常生活的再设计出发，探讨设计的本质。', language: '中文',
  },
  {
    id: 'b6', title: '百年孤独', author: '加西亚·马尔克斯', publisher: '南海出版公司', year: 2011, isbn: '978-7-5442-5994-4',
    formats: [{ kind: 'MOBI', sizeMB: 1.8, readable: false }, { kind: 'AZW3', sizeMB: 2.0, readable: false }],
    progressPct: 0, rating: 5, tags: ['文学'], hue: 350, createdAt: '2026-09-10',
    desc: '布恩迪亚家族七代人的传奇故事，加勒比海小镇马孔多的百年兴衰。', language: '中文',
  },
  {
    id: 'b7', title: '置身事内：中国政府与经济发展', author: '兰小欢', publisher: '上海人民出版社', year: 2021, isbn: '978-7-2081-6996-2',
    formats: [{ kind: 'EPUB', sizeMB: 4.2, readable: true }],
    progressPct: 0, rating: 4, tags: ['经济'], hue: 200, createdAt: '2026-09-05',
    desc: '以政府投融资对中国经济发展的作用为主线，深入浅出地介绍中国政治经济体制。', language: '中文（简体）',
  },
  {
    id: 'b8', title: 'The Elements of Typographic Style', author: 'Robert Bringhurst', publisher: 'Hartley & Marks', year: 2012, isbn: '978-0-8817-9212-6',
    formats: [{ kind: 'PDF', sizeMB: 22.6, readable: true }],
    progressPct: 0, rating: 5, tags: ['字体', '排版'], hue: 50, createdAt: '2026-08-30',
    desc: 'Typography 领域的经典之作，被誉为「字体的圣经」。', language: 'English',
  },
  {
    id: 'b9', title: '克拉拉与太阳', author: '石黑一雄', publisher: '上海译文出版社', year: 2021, isbn: '978-7-5327-8657-2',
    formats: [{ kind: 'EPUB', sizeMB: 2.9, readable: true }],
    progressPct: 0, rating: 4, tags: ['文学'], hue: 0, createdAt: '2026-08-22',
    desc: '人工智能机器人克拉拉眼中的世界与人类的爱。', language: '中文（简体）',
  },
  {
    id: 'b10', title: '代码大全（第2版）', author: 'Steve McConnell', publisher: '电子工业出版社', year: 2006, isbn: '978-7-1210-2298-5',
    formats: [{ kind: 'EPUB', sizeMB: 11.2, readable: true }, { kind: 'PDF', sizeMB: 31.5, readable: true }],
    progressPct: 78, lastChapter: '第 24 章 Refactoring', rating: 5, tags: ['编程'], hue: 90, createdAt: '2026-08-15',
    desc: '软件构建领域的百科全书。', language: '中文（简体）',
  },
  {
    id: 'b11', title: '判决书里的公司法', author: '刘俊海', publisher: '法律出版社', year: 2019, isbn: '978-7-5197-3585-7',
    formats: [{ kind: 'AZW3', sizeMB: 3.4, readable: false }],
    progressPct: 0, rating: 3, tags: ['法律'], hue: 210, createdAt: '2026-08-02',
    desc: '以判例切入的公司法通识读物。', language: '中文（简体）',
  },
]

// ============ 图片 ============
function ph(
  id: string, title: string, fileName: string, takenAt: string, album: string, hue: number, displayH: number,
  camera: string, lens: string, focal: string, aperture: string, shutter: string, iso: number,
  w: number, h: number, sizeMB: number, gps: string, tags: string[], rating: number, favorite: boolean,
): Photo {
  return { id, title, fileName, takenAt, album, hue, displayH, camera, lens, focal, aperture, shutter, iso, w, h, sizeMB, gps, tags, rating, favorite }
}

export const PHOTOS: Photo[] = [
  ph('p1', '雪山日照金山', 'DSC01234.ARW', '2026-10-01T07:42:18', '2026-10 川西', 235, 176, 'Sony A7M4', 'FE 24-70mm F2.8 GM', '35.0mm', 'f/2.8', '1/500s', 200, 8640, 5760, 42.3, '29.5832°N, 101.2571°E', ['风景', '雪山', '川西'], 4, true),
  ph('p2', '海子倒影', 'DSC01288.ARW', '2026-10-01T09:15:03', '2026-10 川西', 190, 288, 'Sony A7M4', 'FE 16-35mm F2.8 GM', '16.0mm', 'f/8.0', '1/125s', 100, 8640, 5760, 43.1, '29.5951°N, 101.2662°E', ['风景', '湖'], 5, true),
  ph('p3', '经幡与云', 'DSC01302.ARW', '2026-10-02T11:20:44', '2026-10 川西', 40, 224, 'Sony A7M4', 'FE 70-200mm F2.8 GM II', '135.0mm', 'f/4.0', '1/1000s', 160, 8640, 5760, 41.8, '29.5712°N, 101.2408°E', ['人文'], 3, false),
  ph('p4', '牦牛过河', 'DSC01319.ARW', '2026-10-02T15:08:51', '2026-10 川西', 320, 160, 'Sony A7M4', 'FE 70-200mm F2.8 GM II', '200.0mm', 'f/2.8', '1/2000s', 320, 8640, 5760, 42.7, '29.5490°N, 101.2255°E', ['动物'], 4, false),
  ph('p5', '星空 · 银河拱桥', 'DSC01345.ARW', '2026-10-02T23:41:09', '2026-10 川西', 255, 256, 'Sony A7M4', 'FE 14mm F1.8 GM', '14.0mm', 'f/1.8', '15s', 3200, 8640, 5760, 44.0, '29.5241°N, 101.2088°E', ['星空'], 5, true),
  ph('p6', '玛尼堆特写', 'IMG_8821.HEIC', '2026-10-03T10:02:33', '2026-10 川西', 15, 192, 'iPhone 16 Pro', 'Main 24mm', '24.0mm', 'f/1.78', '1/850s', 64, 8064, 6048, 3.2, '29.5180°N, 101.2011°E', ['人文'], 3, false),
  ph('p7', '垭口风马旗', 'DSC01367.ARW', '2026-10-03T13:55:27', '2026-10 川西', 210, 256, 'Sony A7M4', 'FE 24-70mm F2.8 GM', '24.0mm', 'f/5.6', '1/640s', 100, 8640, 5760, 42.9, '29.5051°N, 101.1902°E', ['人文', '风景'], 4, false),
  ph('p8', '晚餐 · 藏面', 'IMG_8855.HEIC', '2026-10-03T19:12:40', '2026-10 川西', 28, 176, 'iPhone 16 Pro', 'Main 24mm', '24.0mm', 'f/1.78', '1/60s', 500, 4032, 3024, 2.1, '29.4988°N, 101.1877°E', ['美食'], 3, false),
  ph('p9', '城市夜景延时帧', 'A7300911.JPG', '2026-09-08T21:24:10', '2026-09 城市', 45, 208, 'Sony A7CR', 'FE 35mm F1.4 GM', '35.0mm', 'f/4.0', '8s', 100, 9504, 6336, 38.5, '31.2304°N, 121.4737°E', ['城市', '夜景'], 4, false),
  ph('p10', '梧桐光影', 'A7300934.JPG', '2026-09-14T16:40:51', '2026-09 城市', 95, 160, 'Sony A7CR', 'FE 35mm F1.4 GM', '35.0mm', 'f/1.4', '1/2000s', 100, 9504, 6336, 37.2, '31.2304°N, 121.4737°E', ['街拍'], 4, false),
  ph('p11', '美术馆的楼梯', 'A7300962.JPG', '2026-09-20T14:03:29', '2026-09 城市', 262, 232, 'Sony A7CR', 'FE 24mm F1.4 GM', '24.0mm', 'f/2.8', '1/125s', 400, 9504, 6336, 36.8, '31.2304°N, 121.4737°E', ['建筑'], 5, true),
  ph('p12', '雨天车窗', 'A7300977.JPG', '2026-09-21T18:55:12', '2026-09 城市', 215, 168, 'Sony A7CR', 'FE 35mm F1.4 GM', '35.0mm', 'f/1.4', '1/250s', 640, 9504, 6336, 35.9, '31.2304°N, 121.4737°E', ['街拍'], 3, false),
  ph('p13', '咖啡拉花', 'IMG_8712.HEIC', '2026-09-23T09:31:45', '2026-09 城市', 25, 144, 'iPhone 16 Pro', 'Main 24mm', '24.0mm', 'f/1.78', '1/120s', 80, 4032, 3024, 2.0, '31.2304°N, 121.4737°E', ['美食'], 3, false),
  ph('p14', '滨江散步', 'A7300998.JPG', '2026-09-27T17:22:08', '2026-09 城市', 205, 272, 'Sony A7CR', 'FE 85mm F1.4 GM', '85.0mm', 'f/1.4', '1/1600s', 100, 9504, 6336, 37.7, '31.2304°N, 121.4737°E', ['人像'], 5, true),
  ph('p15', '旧书店一角', 'A7301012.JPG', '2026-09-28T15:47:33', '2026-09 城市', 35, 200, 'Sony A7CR', 'FE 35mm F1.4 GM', '35.0mm', 'f/2.0', '1/160s', 800, 9504, 6336, 36.1, '31.2304°N, 121.4737°E', ['人文'], 4, false),
  ph('p16', '晚高峰天际线', 'A7301030.JPG', '2026-09-30T18:31:56', '2026-09 城市', 230, 240, 'Sony A7CR', 'FE 24mm F1.4 GM', '24.0mm', 'f/5.6', '1/125s', 100, 9504, 6336, 38.0, '31.2304°N, 121.4737°E', ['城市', '夜景'], 4, false),
]

// ============ 管理 ============
export const JOBS: Job[] = [
  { id: 'j1', kind: 'parse:video', target: 'Rust 教程 第07讲.mp4', status: 'running', attempts: 1, at: '3 秒前' },
  { id: 'j2', kind: 'derive:thumb_image', target: 'IMG_20261001_8821.HEIC', status: 'running', attempts: 1, at: '12 秒前' },
  { id: 'j3', kind: 'derive:hls', target: '旧电脑备份_001.mkv', status: 'failed', attempts: 3, at: '2 小时前', error: 'ffmpeg: Codec hevc not supported in mp4 container' },
  { id: 'j4', kind: 'parse:book', target: 'corrupted.epub', status: 'failed', attempts: 3, at: '5 小时前', error: 'BadZipFile: not a valid epub package' },
  { id: 'j5', kind: 'derive:font_specimen', target: '黑体示例-Heavy.otf', status: 'queued', attempts: 0, at: '刚刚' },
  { id: 'j6', kind: 'scan_root', target: 'books:/新建收书', status: 'done', attempts: 1, at: '今天 09:12' },
  { id: 'j7', kind: 'pack_zip', target: '下载包 · 34 个文件 · 2.1GB', status: 'done', attempts: 1, at: '今天 08:40' },
  { id: 'j8', kind: 'index_meili', target: '全量重建 images 索引', status: 'done', attempts: 1, at: '昨天 23:10' },
]

export const CONFIRM_ITEMS: ConfirmItem[] = [
  { id: 'cf1', file: 'Go Web 开发实战 EP02.mp4', hint: '识别到模式 EP?N · 集数 2 · 系列名不确定', seriesGuess: 'Go Web 开发实战', episode: 2 },
  { id: 'cf2', file: '算法导论 第十二讲 动态规划.mkv', hint: 'mkv 容器 · 标记「仅下载」（Direct Play 不支持）', seriesGuess: '算法导论', episode: 12 },
]

export const TAGS = [
  { id: 'tg1', name: '风景', count: 3412 },
  { id: 'tg2', name: '雪山', count: 812 },
  { id: 'tg3', name: '街拍', count: 1204 },
  { id: 'tg4', name: '编程', count: 45 },
  { id: 'tg5', name: '科幻', count: 128 },
  { id: 'tg6', name: '华语', count: 234 },
  { id: 'tg7', name: '衬线', count: 92 },
  { id: 'tg8', name: '含中文', count: 186 },
  { id: 'tg9', name: '教程', count: 18 },
  { id: 'tg10', name: '设计', count: 67 },
]

export const STATS: Stats = {
  fontsFiles: '2.1k', fontFamilies: 428, albums: 826, tracks: 5214,
  seriesCount: 18, clips: 312, books: 13062, images: '10.4w',
  jobsQueued: 12, jobsRunning: 2, jobsFailed: 3, jobsDoneToday: 1482,
}
