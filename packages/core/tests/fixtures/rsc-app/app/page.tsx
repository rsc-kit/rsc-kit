import { Counter } from '../Counter'
import { Greeter } from '../Greeter'
import { CardButton } from '../CardButton'

export const metadata = { title: 'Ada Page', description: 'A test page' }

export default async function Page({ name = 'world' }: { name?: string }) {
  const user = (await (globalThis as any).rpc('getUser', name)) as { display: string }
  return (
    <main>
      <h1>Hello {user.display}</h1>
      <Counter />
      <Greeter />
      <CardButton />
    </main>
  )
}
