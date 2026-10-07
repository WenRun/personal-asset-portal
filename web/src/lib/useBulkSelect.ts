import { useState } from 'react'

/** 浏览页批量多选状态：selMode 开启后卡片点击变为选中/取消（不打断导航语义）。 */
export function useBulkSelect() {
  const [selMode, setSelMode] = useState(false)
  const [sel, setSel] = useState<Set<string>>(new Set())
  /** 语义：组内任一已选 → 整组取消；否则整组加入（家族/系列整组切换） */
  const toggleMany = (ids: string[]) =>
    setSel((s) => {
      const n = new Set(s)
      const anySelected = ids.some((i) => n.has(i))
      for (const i of ids) (anySelected ? n.delete(i) : n.add(i))
      return n
    })
  const exit = () => { setSelMode(false); setSel(new Set()) }
  return { selMode, setSelMode, sel, toggleSel: toggleMany, exit }
}
