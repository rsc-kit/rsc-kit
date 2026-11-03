import type { Storage } from '@rsc-kit/press'

/**
 * Keeps an upload inside the record itself, as a data: url - so the demo
 * needs no bucket, as its rows need no database. A real app keeps files in
 * S3, R2 or on its backend, and saves the url:
 *
 *     put: async (file) => {
 *       const key = `uploads/${crypto.randomUUID()}`
 *       await Bun.s3.write(key, file, { type: file.type })
 *       return `https://cdn.example.com/${key}`
 *     }
 */
export const inlineStorage: Storage = {
  async put(file) {
    return `data:${file.type};base64,${Buffer.from(await file.arrayBuffer()).toString('base64')}`
  },
}
