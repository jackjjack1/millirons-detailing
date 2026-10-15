import {guard, inviteAcceptPost} from '../../../_lib/auth.js'
export const onRequestPost = guard(inviteAcceptPost)
