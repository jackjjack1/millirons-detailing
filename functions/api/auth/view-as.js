import {guard, viewAsPost} from '../../_lib/auth.js'
export const onRequestPost = guard(viewAsPost)
