import {guard, accountsGet, accountsPatch} from '../../_lib/auth.js'
export const onRequestGet = guard(accountsGet)
export const onRequestPatch = guard(accountsPatch)
