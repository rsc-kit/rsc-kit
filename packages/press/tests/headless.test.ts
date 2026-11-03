import { describe, expect, test } from 'bun:test'
import { Glob } from 'bun'

const drawing = /^(import|export) .*from '((\.\.?\/)+shadcn\/|(lucide-react|@base-ui\/react|sonner|class-variance-authority|cn|@tanstack\/react-table)')/

describe('the core and the panel draw nothing', () => {
  test('neither imports the shadcn theme or what it draws with', async () => {
    const files = [...new Glob('src/*.ts').scanSync('.'), ...new Glob('src/admin/**/*.{ts,tsx}').scanSync('.')]

    expect(files.length).toBeGreaterThan(10)

    for (const file of files) {
      const drawn = (await Bun.file(file).text()).split('\n').filter((line) => drawing.test(line))

      expect({ file, drawn }).toEqual({ file, drawn: [] })
    }
  })
})
