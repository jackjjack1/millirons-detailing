// On a push to main, open a "Direct push to main" issue for each commit that
// GitHub does not associate with a merged pull request.
import {readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import {createGitHub} from './github-api.mjs'
import {runDirectPush, sleep} from './rules-lib.mjs'

export async function main({env = process.env, log = console.log} = {}) {
  const token = env.GITHUB_TOKEN
  const repo = env.GITHUB_REPOSITORY
  const before = env.BEFORE
  const after = env.AFTER
  if (!token || !repo || !before || !after) {
    log('This check needs GITHUB_TOKEN, GITHUB_REPOSITORY, BEFORE, and AFTER.')
    return 1
  }
  let eventCommits = []
  if (env.GITHUB_EVENT_PATH) {
    const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'))
    eventCommits = event.commits || []
  }
  const github = createGitHub(token)
  await runDirectPush({
    repo,
    before,
    after,
    eventCommits,
    github,
    retryMs: Number(env.RETRY_MS ?? 15000),
    sleep,
    log,
  })
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(code => {
    process.exit(code)
  }).catch(error => {
    console.log(error instanceof Error ? error.message : 'The direct-push check failed.')
    process.exit(1)
  })
}
