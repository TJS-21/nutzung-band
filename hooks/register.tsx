import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Context, Limit } from '../types'

const limits = atom({ plugin: 'nutzung-band', key: 'limits' } as const, [] as Limit[])
const context = atom({ plugin: 'nutzung-band', key: 'context' } as const, null as Context | null)
const isHidden = atom({ plugin: 'nutzung-band', key: 'isHidden' } as const, false)

const NAMES: Record<string, string> = {
  five_hour: '5 Std',
  seven_day: 'Woche',
  spend_limit: 'Budget',
}

const bar = (pct: number) => {
  const filled = Math.max(0, Math.min(10, Math.round(pct / 10)))
  return '█'.repeat(filled) + '░'.repeat(10 - filled)
}

const color = (pct: number) => (pct >= 90 ? 'error' : pct >= 70 ? 'warning' : 'success')

const pad = (n: number) => String(n).padStart(2, '0')

// Reset als Berliner Uhrzeit plus Restzeit, z. B. "18:30 (in 2 Std 14 Min)"
const formatReset = (iso: string | undefined, now: number) => {
  if (!iso) return 'Reset unbekannt'
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return 'Reset unbekannt'
  const mins = Math.max(0, Math.round((at - now) / 60000))
  const d = Math.floor(mins / 1440)
  const h = Math.floor((mins % 1440) / 60)
  const m = mins % 60
  const rest = d > 0 ? `${d} T ${h} Std` : h > 0 ? `${h} Std ${m} Min` : `${m} Min`
  let clock: string
  try {
    clock = new Intl.DateTimeFormat('de-DE', {
      timeZone: 'Europe/Berlin',
      weekday: d > 0 ? 'short' : undefined,
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(at))
  } catch {
    const t = new Date(at + 2 * 3600000) // Fallback: MESZ
    clock = `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`
  }
  return `Reset ${clock} (in ${rest})`
}

const toContext = (c: { tokens?: number; window: number; percent?: number }): Context | null =>
  c.percent === undefined || c.tokens === undefined ? null : { percent: c.percent, tokens: c.tokens, window: c.window }

const k = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))

const keep = (list: { kind: string; percentUsed: number; resetsAt?: string }[]): Limit[] =>
  list.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt }))

// Ab wann ein Hinweis kommt (einmal beim Überschreiten, nicht bei jedem Punkt)
const WARN_LIMIT = 80
const WARN_CONTEXT = 70

type Toast = (text: string) => unknown

const warn = (toast: Toast, before: Limit[], after: Limit[], ctxBefore: Context | null, ctxAfter: Context | null) => {
  for (const l of after) {
    const was = before.find(b => b.kind === l.kind)?.percentUsed ?? 0
    if (l.percentUsed >= WARN_LIMIT && was < WARN_LIMIT) {
      toast(`Nutzung ${NAMES[l.kind] ?? l.kind}: ${Math.round(l.percentUsed)}%`)
    }
  }
  if (ctxAfter !== null && ctxAfter.percent >= WARN_CONTEXT && (ctxBefore?.percent ?? 0) < WARN_CONTEXT) {
    toast(`Gesprächsspeicher: ${ctxAfter.percent}% voll`)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const usage = await $.session.usage()
    const before = await read($, limits)
    const ctxBefore = await read($, context)
    const after = usage.rateLimits.length > 0 ? keep(usage.rateLimits) : before
    const ctxAfter = toContext(usage.context)
    await update($, limits, () => after)
    await update($, context, () => ctxAfter)
    warn(t => $.ui.toast(t), before, after, ctxBefore, ctxAfter)
    return result
  })

  on('session.measure', async ($, e, next) => {
    const before = await read($, limits)
    const ctxBefore = await read($, context)
    const after = keep(e.rateLimits)
    const ctxAfter = toContext(e.context)
    await update($, limits, () => after)
    await update($, context, () => ctxAfter)
    warn(t => $.ui.toast(t), before, after, ctxBefore, ctxAfter)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, limits)
    const ctx = await read($, context)
    if (e.props.hasSurvey || (await read($, isHidden))) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const now = await $.clock.now()

    if (list.length === 0 && ctx === null) {
      return (
        <Box>
          <Text dimColor>Nutzung: noch keine Messung – erscheint nach der ersten Antwort </Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {list.map(l => (
          <Box key={l.kind}>
            <Text dimColor>{(NAMES[l.kind] ?? l.kind).padEnd(6)} </Text>
            <Text color={color(l.percentUsed)} mono>{bar(l.percentUsed)}</Text>
            <Text tabular weight="semibold"> {String(Math.round(l.percentUsed)).padStart(3)}% </Text>
            <Text dimColor>· {formatReset(l.resetsAt, now)}</Text>
          </Box>
        ))}
        {ctx === null ? null : (
          <Box key="context">
            <Text dimColor>{'Chat'.padEnd(6)} </Text>
            <Text color={color(ctx.percent)} mono>{bar(ctx.percent)}</Text>
            <Text tabular weight="semibold"> {String(ctx.percent).padStart(3)}% </Text>
            <Text dimColor>· Gesprächsspeicher {k(ctx.tokens)} von {k(ctx.window)}</Text>
          </Box>
        )}
        <Box key="actions">
          <Button key="hide" label="Ausblenden" onPress={() => update($, isHidden, () => true)} />
        </Box>
      </Box>
    )
  })
}
