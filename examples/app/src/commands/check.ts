export const description = 'Exit 0 when told "ok", 3 when not'

export default async function (args: string[]) {
  return args[0] === 'ok' ? 0 : 3
}
