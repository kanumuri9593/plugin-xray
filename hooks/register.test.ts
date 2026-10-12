import { expect, test } from 'claude-code/testing'

const SUMMARY = {
  tokens: 2700, items: 6, connectors: 46, overlaps: 14, attention: 1, unused: 2, change: -2500,
  recommendations: [{ level: 'save', title: 'Remove 2 unused plugins', detail: 'vercel, feature-dev.', action: 'xray clean' }],
  rows: [
    { name: 'vercel', tokens: 2300, level: 'attention', enabled: true, used: 'unused 30d', what: 'Vercel guidance', remove: true },
    { name: 'Baton', tokens: 90, level: 'review', enabled: true, used: 'used today', what: 'Run apps', remove: false },
  ],
  latestHtml: null,
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`band shows the totals with icon buttons on ${surface}`, async ($, on) => {
    const runs: string[][] = []
    const submitted: string[] = []
    on('process.run', async (_$, e) => {
      runs.push([...e.argv])
      return { value: { exitCode: 0, stdout: JSON.stringify(SUMMARY), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } as any
    })
    // Another plugin's band beneath (Baton's runs): X-ray's line goes on top, theirs stays.
    on('ui.render', async () => ({ type: 'Text', props: {}, children: ['Baton runs'] }) as any)
    on('command.register', async () => ({ value: true }) as any)
    on('session.start', async (_$, e) => ({ cwd: e.cwd }))
    on('prompt.submit', async (_$, e) => { submitted.push(e.text); return { text: e.text } as any })

    await $.session.start({ cwd: '/tmp', surface } as any)
    await new Promise(r => setTimeout(r, 50))
    expect(runs[0].slice(-2)).toEqual(['summary', '--json'])

    const ui = await $.ui.mount({ plugin: 'plugin-xray', surface, component: 'AbovePrompt', props: { hasSurvey: false } as any })
    expect(await ui.find({ text: '≈2.7k' })).toBeDefined()
    expect(await ui.find({ text: /2 unused/ })).toBeDefined()
    expect(await ui.find({ text: 'Baton runs' })).toBeDefined()
    for (const key of ['pane', 'clean', 'report', 'rescan', 'hide']) expect(await ui.find({ key })).toBeDefined()

    await ui.press({ key: 'clean' })
    expect(submitted[0]).toMatch(/Plugin X-ray cleanup/)

    await ui.press({ key: 'hide' })
    expect(await ui.find({ key: 'pane' })).toBeUndefined()
  })
}
