import {guard, meGet, mePatch} from '../../_lib/auth.js'
export const onRequestGet = guard(meGet)
export const onRequestPatch = guard(mePatch)
