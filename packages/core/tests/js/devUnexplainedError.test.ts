import { describe, expect, test } from 'bun:test'
import { answerAsText, unexplainedActionError } from '../../src/js/devErrorOverlay'

// The shape of Laravel's debug page: what it says is in the body, among
// scripts and styles that are not.
const page = `<!DOCTYPE html><html><head><title>Laravel</title><style>body{color:red}</style></head>
<body><script>const markdown = "# RscKit RendererNotRunningException"</script>
<header><h1>RscKit\\RendererNotRunningException</h1></header>
<p>No RSC renderer is running, so this page cannot be rendered. Run \`npm run dev\` &amp; try again.</p>
<div><span>vendor/rsc-kit/laravel/src/RendererProxy.php</span> <span>:64</span></div></body></html>`

describe('a failed action the renderer did not describe, in development', () => {
  test('an HTML page is its words, not its markup, scripts or styles', () => {
    expect(answerAsText(page, 'text/html; charset=UTF-8')).toEqual([
      'RscKit\\RendererNotRunningException',
      'No RSC renderer is running, so this page cannot be rendered. Run `npm run dev` & try again.',
      'vendor/rsc-kit/laravel/src/RendererProxy.php :64',
    ])
  })

  test('anything else is shown as it came', () => {
    expect(answerAsText('upstream connect error\n\nreset reason: refused', 'text/plain')).toEqual([
      'upstream connect error',
      'reset reason: refused',
    ])
  })

  test('the overlay leads with the status and shows what was said, to a limit', () => {
    const shown = unexplainedActionError(502, 'Bad Gateway', answerAsText(page, 'text/html'))

    expect(shown.message).toBe('Server action failed with 502 Bad Gateway')
    expect(shown.stack).toContain('    No RSC renderer is running')

    const long = unexplainedActionError(500, '', Array.from({ length: 70 }, (_, i) => `line ${i}`))

    expect(long.message).toBe('Server action failed with 500')
    expect(long.stack).toContain('… 10 more lines')
    expect(long.stack).not.toContain('line 60')
  })

  test('an empty answer says so', () => {
    expect(unexplainedActionError(502, 'Bad Gateway', []).stack).toContain('The answer was empty')
  })
})
