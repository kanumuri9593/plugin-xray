// Plugin X-ray inside Claude: one colour-coded line above the prompt and a
// pane with everything installed. The numbers come from the X-ray CLI that
// ships in this plugin, so the band, the terminal and the report agree.
import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { XraySummary } from '../types'

const summary = atom({ plugin: 'plugin-xray', key: 'summary' } as const, null)
const isHidden = atom({ plugin: 'plugin-xray', key: 'isHidden' } as const, false)
const isBusy = atom({ plugin: 'plugin-xray', key: 'isBusy' } as const, false)
const PANE = 'plugin-xray'

const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))
const DOT = { ok: 'success', review: 'warning', attention: 'error' } as const

function root(r: string) {
  return r.replace(/[\\/]\.claude-plugin[\\/]?$/, '')
}

async function cli($: any, args: string[]) {
  return $.process.run(['node', `${root($.plugin.root)}/cli/xray.mjs`, ...args], { timeoutMs: 60_000 })
}

async function refresh($: any) {
  await update($, isBusy, () => true)
  try {
    const { exitCode, stdout } = await cli($, ['summary', '--json'])
    if (exitCode === 0) await update($, summary, () => JSON.parse(stdout) as XraySummary)
  } catch {
    // No Node on PATH, or the scan failed: the band stays hidden.
  }
  await update($, isBusy, () => false)
}

async function openReport($: any) {
  $.ui.toast('Writing the X-ray report…')
  const { exitCode } = await cli($, ['report', '--open'])
  $.ui.toast(exitCode === 0 ? 'X-ray report opened in your browser' : 'Could not write the X-ray report')
  await refresh($)
}

async function askClean($: any) {
  await $.prompt.submit({ text: 'Run the Plugin X-ray cleanup: show what I can remove with what each one does, and ask me which ones to remove.', asUser: true })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'xray-pane', description: 'Show Plugin X-ray: what each plugin costs, when you last used it, what to remove' })
    void refresh($)
    return next(e)
  })

  on('command.run', { command: 'xray-pane' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Plugin X-ray' })
    return { text: 'Plugin X-ray pane opened.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, summary)
    if (e.props.hasSurvey || !s || (await read($, isHidden))) return next(e)
    const busy = await read($, isBusy)
    const { Box, Button, Text } = $.ui.resolve(e)
    const saves = s.rows.filter(r => r.remove).reduce((a, r) => a + r.tokens, 0)
    // The band has one instance: draw X-ray's line on top of whatever the
    // plugins beneath draw (Baton's runs, say) instead of replacing it.
    const below = await next(e)

    const line = (
      <Box key="xray" flexDirection="row" gap={1}>
        <Text bold color="claude">X-ray</Text>
        <Text bold>≈{k(s.tokens)}</Text>
        <Text dimColor>tokens/turn</Text>
        {s.change != null && s.change !== 0 && (
          <Text color={s.change < 0 ? 'success' : 'warning'}>{s.change < 0 ? '▼' : '▲'}{k(Math.abs(s.change))}</Text>
        )}
        {s.unused > 0 && <Text color="warning">✂ {s.unused} unused{saves ? ` −${k(saves)}` : ''}</Text>}
        {s.attention > 0 && <Text color="error">● {s.attention}</Text>}
        {s.overlaps > 0 && <Text color="suggestion">⇄ {s.overlaps}</Text>}
        {s.unused === 0 && s.attention === 0 && <Text color="success">✓ all clear</Text>}
        <Button key="pane" onPress={() => $.ui.open({ id: PANE, title: 'Plugin X-ray' })}><Text>☰</Text></Button>
        {s.unused > 0 && <Button key="clean" onPress={() => askClean($)}><Text color="warning">✂</Text></Button>}
        <Button key="report" onPress={() => openReport($)}><Text color="claude">📄</Text></Button>
        <Button key="rescan" onPress={() => refresh($)}><Text dimColor={busy}>⟳</Text></Button>
        <Button key="hide" onPress={() => update($, isHidden, () => true)}><Text dimColor>✕</Text></Button>
      </Box>
    )
    return below ? <Box flexDirection="column">{line}{below}</Box> : line
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const s = await read($, summary)
    if (!s) return <Text dimColor>Scanning…</Text>
    const room = Math.max(4, (e.viewport?.rows ?? 30) - 12)

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" gap={2}>
          <Text bold color="claude">≈{k(s.tokens)} tokens every turn</Text>
          <Text>{s.items} on</Text>
          <Text>{s.connectors} connectors</Text>
          <Text color={s.overlaps ? 'suggestion' : 'success'}>⇄ {s.overlaps}</Text>
          <Text color={s.attention ? 'error' : 'success'}>● {s.attention}</Text>
        </Box>
        <Box flexDirection="column">
          {s.recommendations.map(r => (
            <Text key={r.title}>
              <Text color={r.level === 'attention' ? 'error' : r.level === 'save' ? 'success' : r.level === 'ok' ? 'success' : 'warning'}>{r.level === 'attention' ? '●' : r.level === 'save' ? '✂' : r.level === 'ok' ? '✓' : '◆'} </Text>
              <Text bold>{r.title}</Text>
              <Text dimColor> {r.detail}</Text>
            </Text>
          ))}
        </Box>
        <Box flexDirection="column">
          {s.rows.slice(0, room).map(r => (
            <Text key={r.name} dimColor={!r.enabled}>
              <Text color={DOT[r.level]}>● </Text>
              <Text bold>{r.name.padEnd(20).slice(0, 20)}</Text>
              <Text> ≈{k(r.tokens).padStart(5)} </Text>
              <Text color={r.remove ? 'error' : r.used?.startsWith('used') ? 'success' : 'inactive'}>{(r.used ?? '').padEnd(12)}</Text>
              <Text dimColor> {r.what}</Text>
            </Text>
          ))}
        </Box>
        <Box flexDirection="row" gap={2}>
          {s.unused > 0 && <Button key="clean" onPress={() => askClean($)}><Text color="warning">✂ Clean up</Text></Button>}
          <Button key="report" onPress={() => openReport($)}><Text color="claude">📄 Report</Text></Button>
          <Button key="rescan" onPress={() => refresh($)}><Text>⟳ Rescan</Text></Button>
        </Box>
      </Box>
    )
  })
}
