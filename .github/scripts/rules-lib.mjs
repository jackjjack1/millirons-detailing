// Plain checks for the team-rule workflows. No network calls live here.

export const DIRECT_PUSH_TITLE = 'Direct push to main'

const REMINDER_LEAD = 'Rules reminder from rules-check. Follow the rules in AGENTS.md before every change and push.'

const SECRETISH = /sk_live_|sk_test_|rk_live_|rk_test_|ghp_|github_pat_|xox[baprs]-|AKIA[0-9A-Z]{16}|-----BEGIN |SESSION_SECRET\s*=|ADMIN_SETUP_CODE\s*=|CLOUDFLARE_API_TOKEN\s*=/i

export function rulesReminder(agentsMarkdown) {
  return `${REMINDER_LEAD}\n\n${String(agentsMarkdown || '').trim()}\n`
}

export function sections(body) {
  const text = String(body || '')
  const matches = [...text.matchAll(/^(#{1,6})\s+(.+?)\s*$/gm)]
  return matches.map((match, index) => {
    const start = match.index + match[0].length
    const end = index + 1 < matches.length ? matches[index + 1].index : text.length
    const visible = text.slice(start, end).replace(/<!--[\s\S]*?-->/g, '').trim()
    return {title: match[2].trim(), visible}
  })
}

export function hasSection(body, title) {
  const want = title.toLowerCase()
  return sections(body).some(section => section.title.toLowerCase() === want && section.visible.length > 0)
}

export function agentNotesChanged(files) {
  return (files || []).some(file => file.filename === 'AGENT_NOTES.md' || file.previous_filename === 'AGENT_NOTES.md')
}

export function assessPullRequest({body, files}) {
  const errors = []
  if (!agentNotesChanged(files)) {
    errors.push('AGENT_NOTES.md was not changed in this pull request. Add a dated note signed with your assistant name.')
  }
  if (!hasSection(body, 'Summary')) {
    errors.push('The pull request description needs a Summary section with some text under the heading.')
  }
  if (!hasSection(body, 'How it was tested') && !hasSection(body, 'Testing')) {
    errors.push('The pull request description needs a How it was tested section with some text under the heading.')
  }
  return errors
}

export function deletionDecision({headRepo, thisRepo, branch, defaultBranch = 'main'}) {
  if (!headRepo || headRepo !== thisRepo) {
    return {
      delete: false,
      reason: 'The head branch is not in this repository. It was left in place.',
    }
  }
  const blocked = new Set(['main', defaultBranch].filter(Boolean))
  if (!branch || blocked.has(branch)) {
    return {
      delete: false,
      reason: `Refusing to delete ${branch || 'the default branch'}.`,
    }
  }
  return {
    delete: true,
    ref: `heads/${encodeURIComponent(branch)}`,
    reason: `Deleting ${branch}.`,
  }
}

export function pullsPath(repo, sha) {
  return `repos/${repo}/commits/${sha}/pulls`
}

export function associatedWithMergedPullRequest(pulls) {
  return Array.isArray(pulls) && pulls.some(pull => pull && pull.merged_at)
}

export function subjectForIssue(message) {
  const first = String(message || '').split(/\r?\n/)[0].trim()
  if (!first) return '(no subject)'
  if (SECRETISH.test(first)) return '(subject left out because it looked like a secret)'
  return first.slice(0, 200)
}

export function directPushIssueBody({sha, url, author, message}) {
  return [
    'This commit reached main without a merged pull request.',
    '',
    `Commit: ${sha}`,
    `Author: ${author || 'unknown'}`,
    `Message: ${subjectForIssue(message)}`,
    `Link: ${url}`,
    '',
    'Main deploys straight to millironsdetailing.com. A commit on main should come from a merged pull request. Only Jordan approves merges.',
  ].join('\n')
}

export function existingDirectPushIssue(issues, sha) {
  return (issues || []).find(issue =>
    issue.title === DIRECT_PUSH_TITLE &&
    typeof issue.body === 'string' &&
    issue.body.includes(sha)
  )
}

export function mergeCommits(repo, compareCommits, eventCommits) {
  const bySha = new Map()
  for (const commit of compareCommits || []) {
    if (!commit?.sha) continue
    bySha.set(commit.sha, {
      sha: commit.sha,
      message: commit.commit?.message || '',
      author: commit.author?.login || commit.commit?.author?.name || 'unknown',
      url: commit.html_url || `https://github.com/${repo}/commit/${commit.sha}`,
    })
  }
  for (const commit of eventCommits || []) {
    const sha = commit.id || commit.sha
    if (!sha || bySha.has(sha)) continue
    bySha.set(sha, {
      sha,
      message: commit.message || '',
      author: commit.author?.username || commit.author?.name || 'unknown',
      url: commit.url || `https://github.com/${repo}/commit/${sha}`,
    })
  }
  return [...bySha.values()]
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function deleteMergedBranch({
  merged = true,
  headRepo,
  thisRepo,
  branch,
  defaultBranch = 'main',
  github,
  log = console.log,
}) {
  if (merged !== true && merged !== 'true') {
    const reason = 'This pull request was not merged. The branch was left in place.'
    log(reason)
    return {delete: false, reason}
  }
  const decision = deletionDecision({headRepo, thisRepo, branch, defaultBranch})
  log(decision.reason)
  if (!decision.delete) return decision
  const result = await github.delete(`repos/${thisRepo}/git/refs/${decision.ref}`)
  if (result.status === 204) {
    log(`Deleted ${branch}.`)
    return {...decision, deleted: true}
  }
  if (result.status === 404 || result.status === 422) {
    log(`The branch ${branch} was already gone.`)
    return {...decision, deleted: false, alreadyGone: true}
  }
  throw new Error(`Could not delete ${branch}. GitHub returned ${result.status}.`)
}

async function listDirectPushIssues(github, repo) {
  const found = []
  for (let page = 1; page <= 5; page++) {
    const batch = await github.get(`repos/${repo}/issues?state=all&per_page=100&page=${page}`)
    if (!Array.isArray(batch) || batch.length === 0) break
    found.push(...batch.filter(issue => issue.title === DIRECT_PUSH_TITLE))
    if (batch.length < 100) break
  }
  return found
}

export async function runDirectPush({
  repo,
  before,
  after,
  eventCommits = [],
  github,
  retryMs = 15000,
  sleep: wait = sleep,
  log = console.log,
}) {
  if (!before || !after || before === after) {
    log('This push did not add a commit.')
    return {opened: []}
  }
  let compareCommits = []
  if (!/^0+$/.test(before)) {
    const compare = await github.get(`repos/${repo}/compare/${before}...${after}`)
    compareCommits = compare.commits || []
    const total = compare.total_commits ?? compareCommits.length
    if (total > compareCommits.length) {
      log(`GitHub returned ${compareCommits.length} of ${total} commits. Each returned commit was checked.`)
    }
  } else {
    log('This push has no previous commit to compare. Checking the commits included in the push event.')
  }
  const commits = mergeCommits(repo, compareCommits, eventCommits)
  if (commits.length === 0) {
    log('No commits to check.')
    return {opened: []}
  }
  const issues = await listDirectPushIssues(github, repo)
  const opened = []
  for (const commit of commits) {
    const path = `${pullsPath(repo, commit.sha)}?per_page=100`
    let pulls = await github.get(path)
    if (!associatedWithMergedPullRequest(pulls)) {
      log(`Commit ${commit.sha} is not tied to a merged pull request yet. Checking once more.`)
      if (retryMs > 0) await wait(retryMs)
      pulls = await github.get(path)
    }
    if (associatedWithMergedPullRequest(pulls)) {
      const merged = pulls.find(pull => pull && pull.merged_at)
      log(`Commit ${commit.sha} came from merged pull request #${merged.number}.`)
      continue
    }
    if (existingDirectPushIssue(issues, commit.sha)) {
      log(`Commit ${commit.sha} already has a Direct push to main issue.`)
      continue
    }
    const body = directPushIssueBody(commit)
    const created = await github.post(`repos/${repo}/issues`, {title: DIRECT_PUSH_TITLE, body})
    log(`Opened issue #${created.number} for commit ${commit.sha}.`)
    opened.push({sha: commit.sha, number: created.number})
    issues.push({title: DIRECT_PUSH_TITLE, body, number: created.number})
  }
  return {opened}
}
