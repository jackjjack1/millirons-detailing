import {guard, invitesGet, invitesPost} from '../../_lib/auth.js'
export const onRequestGet = guard(invitesGet)
export const onRequestPost = guard(invitesPost)
