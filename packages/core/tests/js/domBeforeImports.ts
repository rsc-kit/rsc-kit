// A test file's first import: a DOM, before any component is loaded.
//
// Imports run in order, and a library that asks for a DOM when it is imported
// (Base UI picks useLayoutEffect or useEffect from `typeof document` once)
// keeps that answer for good. Registering later - in beforeAll, or after the
// component was imported - leaves its dialogs that never open.
import { registerDom } from './dom'

registerDom()
