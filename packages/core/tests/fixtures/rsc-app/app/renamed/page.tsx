import { currentName } from '../../renamed'

export default async function RenamedPage() {
  return <main id="renamed">name: {await currentName()}</main>
}
