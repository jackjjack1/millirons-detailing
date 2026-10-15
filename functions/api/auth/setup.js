import {guard, setupGet, setupPost} from '../../_lib/auth.js'
export const onRequestGet = guard(setupGet)
export const onRequestPost = guard(setupPost)
