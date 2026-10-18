import { redirect } from '@rsc-kit/core/redirect'
import { ELSEWHERE } from '../../../../handoff'

// Above every boundary: a real 3xx, or X-RSC-Redirect on a navigation.
export default function guard() {
  redirect(ELSEWHERE)
}
