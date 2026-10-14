export const description = 'Wait until SIGTERM, then stop'

export default async function (_args: string[], { signal }: { signal: AbortSignal }) {
  console.log('work: started')

  await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()))

  console.log('work: stopped')
}
