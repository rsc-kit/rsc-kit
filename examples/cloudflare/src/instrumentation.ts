import { installVersionSource } from '@rsc-kit/core/changed'
import { versions } from './versions'

export function register() {
  installVersionSource(versions)
}
