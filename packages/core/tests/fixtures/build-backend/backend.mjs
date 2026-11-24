// A backend answering a build's calls, as an adapter's command does.
import { appendFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const log = process.argv[2]
const say = (answer) => process.stdout.write('\n' + JSON.stringify(answer) + '\n')

appendFileSync(log, 'start\n')

if (process.argv[3] === 'boot-fails') {
  console.error('no such table: plans')
  process.exit(7)
}

for await (const line of createInterface({ input: process.stdin })) {
  const { id, function: name, args } = JSON.parse(line)

  appendFileSync(log, name + JSON.stringify(args) + '\n')

  if (name === 'echo') say({ id, status: 200, result: args })
  if (name === 'late') setTimeout(() => say({ id, status: 200, result: 'late' }), 100)
  if (name === 'object') say({ id, status: 200, result: { list: [] } })
  if (name === 'noisy') {
    process.stdout.write('dumped without a newline')
    say({ id, status: 200, result: 'answered' })
    process.stdout.write('{"id":999,"result":"not asked"}\n')
    console.error('a warning')
  }
  if (name === 'session') {
    say({ id, visitor: ['the session'], last: true })
    process.exit(0)
  }
  if (name === 'visitor') say({ id, visitor: ['a request header'] })
  if (name === 'dies') {
    console.error('Allowed memory size exhausted')
    process.exit(255)
  }
  if (name === 'never') continue
}
