import {guard, loginPost} from '../../_lib/auth.js'
export const onRequestPost = guard(loginPost)
