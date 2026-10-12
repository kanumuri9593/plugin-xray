export type XrayRow = {
  name: string
  tokens: number
  level: 'ok' | 'review' | 'attention'
  enabled: boolean
  used: string | null
  what: string
  remove: boolean
}

export type XrayRecommendation = {
  level: 'save' | 'attention' | 'tidy' | 'ok'
  title: string
  detail: string
  action: string | null
}

export type XraySummary = {
  tokens: number
  items: number
  connectors: number
  overlaps: number
  attention: number
  unused: number
  change: number | null
  recommendations: XrayRecommendation[]
  rows: XrayRow[]
  latestHtml: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'plugin-xray': { summary: XraySummary | null; isHidden: boolean; isBusy: boolean }
  }
}
