import { create } from 'zustand'

interface UiState {
  paletteOpen: boolean
  gateOpen: boolean
  sidebarOpen: boolean
  profileOpen: boolean
  setPalette: (open: boolean) => void
  setGate: (open: boolean) => void
  setSidebar: (open: boolean) => void
  setProfile: (open: boolean) => void
}

export const useUI = create<UiState>()((set) => ({
  paletteOpen: false,
  gateOpen: false,
  sidebarOpen: false,
  profileOpen: false,
  setPalette: (paletteOpen) => set({ paletteOpen }),
  setGate: (gateOpen) => set({ gateOpen }),
  setSidebar: (sidebarOpen) => set({ sidebarOpen }),
  setProfile: (profileOpen) => set({ profileOpen }),
}))
