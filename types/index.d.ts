export type Limit = { kind: string; percentUsed: number; resetsAt?: string }
export type Context = { percent: number; tokens: number; window: number }

declare module 'claude-code' {
  interface PluginState {
    'nutzung-band': { limits: Limit[]; context: Context | null; isHidden: boolean }
  }
}
