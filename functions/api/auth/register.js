import {guard, registerPost} from '../../_lib/auth.js'
export const onRequestPost = guard(registerPost)
