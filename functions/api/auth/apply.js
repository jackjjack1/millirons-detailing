import {guard, applyPost} from '../../_lib/auth.js'
export const onRequestPost = guard(applyPost)
