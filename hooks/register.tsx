import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Context, Limit } from '../types'

const limits = atom({ plugin: 'nutzung-band', key: 'limits' } as const, [] as Limit[])
const context = atom({ plugin: 'nutzung-band', key: 'context' } as const, null as Context | null)
const isHidden = atom({ plugin: 'nutzung-band', key: 'isHidden' } as const, false)

const NAMES: Record<string, string> = {
  five_hour: '5 Std',
  seven_day: 'Woche',
  spend_limit: 'Budget',
}

// Ab wann ein Wert als kritisch gilt: Hinweis einmal beim Überschreiten, Balken rot
const WARN_LIMIT = 80
const WARN_CONTEXT = 70

const TRACK = '#3A3A3C' // dunkelgrau: die Gesamtmenge
const BLUE = '#4C8DFF' // Füllstand
const RED = '#F0524F' // Füllstand ab der Schwelle

// „Ausblenden“ ist in der App ein kleiner Text-Link (Knöpfe zeichnet sie in fester Größe).
// Gibt die App den Klick nicht weiter, öffnet der Link nur diese Repo-Seite.
const HIDE_URL = 'https://github.com/TJS-21/nutzung-band'
const SHOW_LABEL = 'Usage & Kontext einblenden'

const fill = (pct: number, limit: number) => (pct >= limit ? RED : BLUE)

// Terminal: kann keine Grafik, daher schmaler Textbalken in denselben Farben
const textBar = (pct: number) => {
  const filled = Math.max(0, Math.min(10, Math.round(pct / 10)))
  return { filled: '━'.repeat(filled), empty: '━'.repeat(10 - filled) }
}

// Desktop, Handy, Editor: dünner, abgerundeter Streifen
const BAR_W = 120
const BAR_H = 5
const svgBar = (pct: number, limit: number) => {
  const p = Math.max(0, Math.min(100, pct))
  const w = p === 0 ? 0 : Math.max(BAR_H, (BAR_W * p) / 100)
  const r = BAR_H / 2
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${BAR_W}" height="${BAR_H}" viewBox="0 0 ${BAR_W} ${BAR_H}">` +
    `<rect width="${BAR_W}" height="${BAR_H}" rx="${r}" fill="${TRACK}"/>` +
    (w > 0 ? `<rect width="${w.toFixed(1)}" height="${BAR_H}" rx="${r}" fill="${fill(p, limit)}"/>` : '') +
    `</svg>`
  )
}

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

type Row = { key: string; label: string; pct: number; limit: number; info: string }

// Live-Werte, wie sie auch das Nutzungs-Menü der Claude-App zeigt. Die Anmeldung setzt
// Claude Code selbst ein ($.session.authorize); die Mod sieht keine Zugangsdaten.
// Klappt die Abfrage nicht, bleiben die Werte der letzten Antwort dieser Sitzung.
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const LIVE_EVERY_MS = 2 * 60000
let hasLive = false

const fetchLive = async ($: EngineInterface): Promise<Limit[] | null> => {
  try {
    const a = await $.session.authorize()
    if (!a) return null
    const res = await $.http.fetch(USAGE_URL, { auth: a.handle, headers: { 'anthropic-beta': 'oauth-2025-04-20' } })
    if (!res.ok) return null
    const data = JSON.parse(res.text) as Record<string, unknown>
    const out: Limit[] = []
    for (const kind of ['five_hour', 'seven_day']) {
      const w = data[kind] as { utilization?: unknown; resets_at?: unknown } | null | undefined
      if (w && typeof w.utilization === 'number') {
        out.push({ kind, percentUsed: Math.round(w.utilization * 10) / 10, resetsAt: typeof w.resets_at === 'string' ? w.resets_at : undefined })
      }
    }
    return out.length > 0 ? out : null
  } catch {
    return null
  }
}

const refreshLive = async ($: EngineInterface) => {
  const live = await fetchLive($)
  if (live === null) return
  hasLive = true
  const before = await read($, limits)
  const ctx = await read($, context)
  await update($, limits, () => live)
  warn(t => $.ui.toast(t), before, live, ctx, ctx)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    // Jede Minute neu zeichnen, damit Restzeit und Reset mitlaufen
    $.clock.every(60000, () => $.ui.invalidate('ui.render'))
    // Alle zwei Minuten die Live-Werte holen
    $.clock.every(LIVE_EVERY_MS, () => void refreshLive($))
    const usage = await $.session.usage()
    const before = await read($, limits)
    const ctxBefore = await read($, context)
    const after = usage.rateLimits.length > 0 ? keep(usage.rateLimits) : before
    const ctxAfter = toContext(usage.context)
    await update($, limits, () => after)
    await update($, context, () => ctxAfter)
    warn(t => $.ui.toast(t), before, after, ctxBefore, ctxAfter)
    void refreshLive($)
    return result
  })

  on('session.measure', async ($, e, next) => {
    const before = await read($, limits)
    const ctxBefore = await read($, context)
    // Mit Live-Werten kommen die Kontingente von dort (frischer); die Antwort stößt nur eine Abfrage an
    const after = hasLive ? before : keep(e.rateLimits)
    if (hasLive && e.changed.includes('rateLimits')) void refreshLive($)
    const ctxAfter = toContext(e.context)
    await update($, limits, () => after)
    await update($, context, () => ctxAfter)
    warn(t => $.ui.toast(t), before, after, ctxBefore, ctxAfter)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, limits)
    const ctx = await read($, context)
    if (e.props.hasSurvey) return next(e)

    // Was andere Mods hier zeichnen (z. B. „Offene Punkte“), bleibt darunter stehen
    const below = await next(e)
    const ui = $.ui.resolve(e)
    const { Box, Button, Text, Markdown } = ui
    const hide = () => void update($, isHidden, () => true)
    const show = () => void update($, isHidden, () => false)
    // Das Terminal kann keine Grafik: dort Textbalken
    const Svg = e.surface !== 'terminal' && 'Svg' in ui ? ui.Svg : undefined

    // Ausgeblendet: nur ein schmaler grauer Streifen zum Wieder-Einblenden
    if (await read($, isHidden)) {
      return (
        <Box flexDirection="column">
          <Box key="collapsed" flexDirection="row" justifyContent="flex-end" backgroundColor={TRACK} paddingX={1}>
            {Svg === undefined ? (
              <Button key="show" onPress={show}>
                {SHOW_LABEL}
              </Button>
            ) : (
              <Markdown key="show" text={`[${SHOW_LABEL}](${HIDE_URL})`} pressableLinks={[HIDE_URL]} onLinkPress={show} />
            )}
          </Box>
          {below}
        </Box>
      )
    }

    const now = await $.clock.now()

    if (list.length === 0 && ctx === null) {
      return (
        <Box flexDirection="column">
          <Box key="waiting">
            <Text size="caption" dimColor>Nutzung: noch keine Messung – erscheint nach der ersten Antwort</Text>
          </Box>
          {below}
        </Box>
      )
    }

    const rows: Row[] = list.map(l => {
      // Ist der Reset-Zeitpunkt vorbei, ist das Kontingent wieder leer
      const at = l.resetsAt === undefined ? NaN : Date.parse(l.resetsAt)
      const isReset = !Number.isNaN(at) && at <= now
      return {
        key: l.kind,
        label: NAMES[l.kind] ?? l.kind,
        pct: isReset ? 0 : l.percentUsed,
        limit: WARN_LIMIT,
        info: isReset ? 'zurückgesetzt' : formatReset(l.resetsAt, now),
      }
    })
    if (ctx !== null) {
      rows.push({
        key: 'context',
        label: 'Chat',
        pct: ctx.percent,
        limit: WARN_CONTEXT,
        info: `Gesprächsspeicher ${k(ctx.tokens)} von ${k(ctx.window)}`,
      })
    }

    return (
      <Box flexDirection="column">
        {rows.map((r, i) => {
          const t = textBar(r.pct)
          const isLast = i === rows.length - 1
          return (
            <Box key={r.key} flexDirection="row" alignItems="center" justifyContent="space-between">
              <Box flexDirection="row" alignItems="center" gap={1}>
                <Box width={6}>
                  <Text size="caption" dimColor>{r.label}</Text>
                </Box>
                {Svg === undefined ? (
                  <Text>
                    <Text color={fill(r.pct, r.limit)}>{t.filled}</Text>
                    <Text color={TRACK}>{t.empty}</Text>
                  </Text>
                ) : (
                  <Svg source={svgBar(r.pct, r.limit)} alt={`${r.label} ${Math.round(r.pct)} %`} width={BAR_W} height={BAR_H} />
                )}
                <Box width={5}>
                  <Text size="caption" tabular weight="medium">{String(Math.round(r.pct)).padStart(3)}%</Text>
                </Box>
                <Text size="caption" dimColor>{r.info}</Text>
              </Box>
              {/* „Ausblenden“ ganz rechts in der letzten Zeile (meist „Chat“) */}
              {!isLast ? null : Svg === undefined ? (
                <Button key="hide" onPress={hide}>
                  Ausblenden
                </Button>
              ) : (
                <Markdown key="hide" text={`[Ausblenden](${HIDE_URL})`} pressableLinks={[HIDE_URL]} onLinkPress={hide} />
              )}
            </Box>
          )
        })}
        {below}
      </Box>
    )
  })
}
