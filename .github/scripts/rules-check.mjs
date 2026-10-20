// Print the team rules, post them on the pull request, and fail when the
// pull request is missing a dated AGENT_NOTES.md change or the summary
// and testing sections.
import {appendFileSync, readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import {createGitHub, getPages} from './github-api.mjs'
import {assessPullRequest, rulesReminder} from './rules-lib.mjs'

const MARKER = 'Rules reminder from rules-check. Follow the rules in AGENTS.md before every change and push.'

export async function main({env = process.env, log = console.log} = {}) {
  const agentsPath = new URL('../../AGENTS.md', import.meta.url)
  const agents = readFileSync(agentsPath, 'utf8')
  const reminder = rulesReminder(agents)
  log(reminder)
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${reminder}\n`)

  const token = env.GITHUB_TOKEN
  const repo = env.GITHUB_REPOSITORY
  const pr = env.PR_NUMBER
  if (!token || !repo || !pr) {
    log('The rules were printed above. The pull request check needs GITHUB_TOKEN, GITHUB_REPOSITORY, and PR_NUMBER.')
    return 1
  }

  const github = createGitHub(token)
  try {
    const comments = await getPages(github, `repos/${repo}/issues/${pr}/comments`)
    const existing = comments.find(comment => typeof comment.body === 'string' && comment.body.startsWith(MARKER))
    if (existing) {
      await github.patch(`repos/${repo}/issues/comments/${existing.id}`, {body: reminder})
      log('Updated the rules reminder on the pull request.')
    } else {
      await github.post(`repos/${repo}/issues/${pr}/comments`, {body: reminder})
      log('Posted the rules reminder on the pull request.')
    }
  } catch (error) {
    log('Could not post the reminder on the pull request. The reminder is printed above.')
    log(error instanceof Error ? error.message : 'The reminder comment failed.')
  }

  const pull = await github.get(`repos/${repo}/pulls/${pr}`)
  const files = await getPages(github, `repos/${repo}/pulls/${pr}/files`)
  const errors = assessPullRequest({body: pull.body, files})
  if (errors.length) {
    for (const error of errors) log(error)
    return 1
  }
  log('AGENT_NOTES.md was changed, and the description has a summary and a testing section.')
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(code => {
    process.exit(code)
  }).catch(error => {
    console.log(error instanceof Error ? error.message : 'The rules check failed.')
    process.exit(1)
  })
}
