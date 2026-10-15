import {guard, emailPost} from '../../_lib/auth.js'
export const onRequestPost = guard(emailPost)
