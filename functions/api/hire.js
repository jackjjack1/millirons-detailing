import {guard, hireGet, hirePost, hirePatch, hireDelete} from '../_lib/auth.js'
export const onRequestGet = guard(hireGet)
export const onRequestPost = guard(hirePost)
export const onRequestPatch = guard(hirePatch)
export const onRequestDelete = guard(hireDelete)
