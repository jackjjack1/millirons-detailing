import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {
  DIRECT_PUSH_TITLE,
  agentNotesChanged,
  assessPullRequest,
  associatedWithMergedPullRequest,
  deletionDecision,
  directPushIssueBody,
  existingDirectPushIssue,
  hasSection,
  mergeCommits,
  pullsPath,
  rulesReminder,
  runDirectPush,
  subjectForIssue,
  deleteMergedBranch,
} from '../.github/scripts/rules-lib.mjs'

const root = new URL('..', import.meta.url)
const read = name => readFileSync(new URL(name, root), 'utf8')

function numberedRules(markdown) {
  return [...markdown.matchAll(/^\d+\. .+$/gm)].map(match => match[0])
}

test('pull request text needs a summary, a testing section, and an AGENT_NOTES change', () => {
  const files = [{filename: 'AGENT_NOTES.md'}]
  const body = '## Summary\n\nShipped the rules.\n\n## How it was tested\n\nRan the test suite.\n'
  assert.deepEqual(assessPullRequest({body, files}), [])
  assert.equal(hasSection(body, 'summary'), true)

  const missingNotes = assessPullRequest({body, files: [{filename: 'README.md'}]})
  assert.match(missingNotes[0], /AGENT_NOTES.md/)

  const renamed = agentNotesChanged([{filename: 'docs/AGENT_NOTES.md', previous_filename: 'AGENT_NOTES.md'}])
  assert.equal(renamed, true)

  const hidden = '## Summary\n\n<!-- secret note -->\n\n## How it was tested\n\nRan it.\n'
  assert.match(assessPullRequest({body: hidden, files}).join('\n'), /Summary section/)

  const alias = '## Summary\n\nDone.\n\n## Testing\n\nRan it.\n'
  assert.deepEqual(assessPullRequest({body: alias, files}), [])
})

test('the pull request template satisfies the summary and testing check', () => {
  const template = read('.github/pull_request_template.md')
  const errors = assessPullRequest({
    body: template,
    files: [{filename: 'AGENT_NOTES.md'}],
  })
  assert.deepEqual(errors, [])
})

test('branch deletion stays inside this repository and never deletes main', () => {
  assert.equal(deletionDecision({
    headRepo: 'other/millirons-detailing',
    thisRepo: 'jackjjack1/millirons-detailing',
    branch: 'feature',
  }).delete, false)

  assert.equal(deletionDecision({
    headRepo: 'jackjjack1/millirons-detailing',
    thisRepo: 'jackjjack1/millirons-detailing',
    branch: 'main',
  }).delete, false)

  assert.equal(deletionDecision({
    headRepo: 'jackjjack1/millirons-detailing',
    thisRepo: 'jackjjack1/millirons-detailing',
    branch: 'trunk',
    defaultBranch: 'trunk',
  }).delete, false)

  const decision = deletionDecision({
    headRepo: 'jackjjack1/millirons-detailing',
    thisRepo: 'jackjjack1/millirons-detailing',
    branch: 'cursor/team-rules-checks-fe92',
  })
  assert.equal(decision.delete, true)
  assert.equal(decision.ref, 'heads/cursor%2Fteam-rules-checks-fe92')
})

test('a closed pull request that did not merge does not delete the branch', async () => {
  let deleted = false
  const result = await deleteMergedBranch({
    merged: 'false',
    headRepo: 'jackjjack1/millirons-detailing',
    thisRepo: 'jackjjack1/millirons-detailing',
    branch: 'feature',
    github: {async delete() { deleted = true; return {status: 204} }},
    log() {},
  })
  assert.equal(result.delete, false)
  assert.equal(deleted, false)
})

test('an already deleted branch is treated as done', async () => {
  const lines = []
  const result = await deleteMergedBranch({
    merged: true,
    headRepo: 'jackjjack1/millirons-detailing',
    thisRepo: 'jackjjack1/millirons-detailing',
    branch: 'feature',
    github: {async delete(path) {
      assert.equal(path, 'repos/jackjjack1/millirons-detailing/git/refs/heads/feature')
      return {status: 422}
    }},
    log(line) { lines.push(line) },
  })
  assert.equal(result.alreadyGone, true)
  assert.match(lines.at(-1), /already gone/)
})

test('direct push issues name the commit and skip commits from a merged pull request', async () => {
  assert.equal(associatedWithMergedPullRequest([{merged_at: '2026-10-20T00:00:00Z', number: 4}]), true)
  assert.equal(associatedWithMergedPullRequest([{merged_at: null, number: 5}]), false)
  assert.equal(associatedWithMergedPullRequest([]), false)
  assert.equal(pullsPath('acme/app', 'abc123'), 'repos/acme/app/commits/abc123/pulls')

  const safe = directPushIssueBody({
    sha: 'abc123',
    url: 'https://github.com/acme/app/commit/abc123',
    author: 'jordan',
    message: 'Add the booking form\n\nMore detail',
  })
  assert.equal(DIRECT_PUSH_TITLE, 'Direct push to main')
  assert.match(safe, /Commit: abc123/)
  assert.match(safe, /Message: Add the booking form/)
  assert.doesNotMatch(safe, /More detail/)
  assert.equal(subjectForIssue('sk_live_example'), '(subject left out because it looked like a secret)')
  assert.equal(existingDirectPushIssue([{title: DIRECT_PUSH_TITLE, body: safe}], 'abc123').title, DIRECT_PUSH_TITLE)

  const posts = []
  const github = {
    async get(path) {
      if (path.startsWith('repos/acme/app/compare/')) {
        return {
          total_commits: 2,
          commits: [
            {sha: 'mergedsha', commit: {message: 'from the pull request'}, author: {login: 'bot'}, html_url: 'https://github.com/acme/app/commit/mergedsha'},
            {sha: 'directsha', commit: {message: 'pushed straight to main'}, author: {login: 'someone'}, html_url: 'https://github.com/acme/app/commit/directsha'},
          ],
        }
      }
      if (path.startsWith('repos/acme/app/issues?')) return []
      if (path.startsWith('repos/acme/app/commits/mergedsha/pulls')) {
        return [{number: 9, merged_at: '2026-10-20T00:00:00Z'}]
      }
      if (path.startsWith('repos/acme/app/commits/directsha/pulls')) return []
      throw new Error(`unexpected ${path}`)
    },
    async post(path, body) {
      posts.push({path, body})
      return {number: 40}
    },
  }
  const result = await runDirectPush({
    repo: 'acme/app',
    before: 'aaa',
    after: 'bbb',
    github,
    retryMs: 0,
    log() {},
  })
  assert.deepEqual(result.opened, [{sha: 'directsha', number: 40}])
  assert.equal(posts.length, 1)
  assert.equal(posts[0].body.title, 'Direct push to main')
  assert.match(posts[0].body.body, /Commit: directsha/)
})

test('event commits are included when compare has not caught up', () => {
  const commits = mergeCommits('acme/app', [], [{
    id: 'eventsha',
    message: 'hello',
    url: 'https://github.com/acme/app/commit/eventsha',
    author: {username: 'jordan'},
  }])
  assert.equal(commits[0].sha, 'eventsha')
  assert.equal(commits[0].author, 'jordan')
})

test('the rules reminder is visible and quotes AGENTS.md', () => {
  const reminder = rulesReminder('# Team rules\n\n1. Never push to main.')
  assert.match(reminder, /^Rules reminder from rules-check/)
  assert.match(reminder, /Never push to main/)
})

test('every mirror copies the AGENTS.md rules in plain text', () => {
  const agents = read('AGENTS.md')
  const rules = numberedRules(agents)
  assert.equal(rules.length, 18)
  assert.match(agents, /Codex reads AGENTS.md natively/)
  assert.match(agents, /Google AI Studio, Grok \(Grok Bot\), Freebuff, Codex, Claude, and Cloudroom/)
  assert.doesNotMatch(agents, /Windsurf/)
  assert.doesNotMatch(read('README.md'), /Windsurf/)

  const mirrors = [
    'README.md',
    'AGENT_NOTES.md',
    'CLAUDE.md',
    'GEMINI.md',
    '.cursor/rules/millirons-rules.mdc',
    '.github/copilot-instructions.md',
  ]
  for (const file of mirrors) {
    const text = read(file)
    assert.match(text, /Follow the rules in AGENTS.md before every change and push/, file)
    for (const rule of rules) {
      assert.ok(text.includes(rule), `${file} is missing: ${rule}`)
    }
  }

  const template = read('.github/pull_request_template.md')
  for (const rule of rules) {
    const sentence = rule.replace(/^\d+\.\s+/, '')
    assert.ok(template.includes(sentence), `pull request template is missing: ${sentence}`)
  }
  assert.match(read('README.md'), /Read before every push/)
  assert.match(read('AGENT_NOTES.md'), /Read before every push/)
})

test('workflow permissions stay narrow and use GITHUB_TOKEN only', () => {
  const rulesCheck = read('.github/workflows/rules-check.yml')
  assert.match(rulesCheck, /name: rules-check/)
  assert.match(rulesCheck, /pull_request:/)
  assert.match(rulesCheck, /contents: read/)
  assert.match(rulesCheck, /issues: write/)

  const cleanup = read('.github/workflows/delete-merged-branch.yml')
  assert.match(cleanup, /contents: write/)
  assert.match(cleanup, /types: \[closed\]/)
  assert.doesNotMatch(cleanup, /issues:|pull-requests:|id-token:/)

  const direct = read('.github/workflows/direct-push.yml')
  assert.match(direct, /branches: \[main\]/)
  assert.match(direct, /issues: write/)
  assert.match(direct, /contents: read/)
  assert.match(direct, /pull-requests: read/)

  for (const file of [
    '.github/workflows/rules-check.yml',
    '.github/workflows/delete-merged-branch.yml',
    '.github/workflows/direct-push.yml',
  ]) {
    const text = read(file)
    const secretNames = [...text.matchAll(/secrets\.([A-Z0-9_]+)/g)].map(match => match[1])
    assert.deepEqual([...new Set(secretNames)], ['GITHUB_TOKEN'], file)
    assert.doesNotMatch(text, /CLOUDFLARE|STRIPE|SESSION_SECRET|ADMIN_SETUP_CODE/)
  }

  const deploy = read('.github/workflows/deploy.yml')
  assert.match(deploy, /Deploy to Cloudflare Pages/)
})
