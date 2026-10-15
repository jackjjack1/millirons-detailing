import {guard, logoutPost} from '../../_lib/auth.js'
export const onRequestPost = guard(logoutPost)
