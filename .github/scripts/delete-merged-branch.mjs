// Delete a merged pull request's head branch when it lives in this repository
// and is not main. Uses GITHUB_TOKEN only.
import {pathToFileURL} from 'node:url'
import {createGitHub} from './github-api.mjs'
import {deleteMergedBranch} from './rules-lib.mjs'

export async function main({env = process.env, log = console.log} = {}) {
  const token = env.GITHUB_TOKEN
  const thisRepo = env.THIS_REPO || env.GITHUB_REPOSITORY
  if (!token || !thisRepo) {
    log('This check needs GITHUB_TOKEN and the repository name.')
    return 1
  }
  const github = createGitHub(token)
  await deleteMergedBranch({
    merged: env.MERGED,
    headRepo: env.HEAD_REPO || '',
    thisRepo,
    branch: env.HEAD_BRANCH || '',
    defaultBranch: env.DEFAULT_BRANCH || 'main',
    github,
    log,
  })
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(code => {
    process.exit(code)
  }).catch(error => {
    console.log(error instanceof Error ? error.message : 'Could not delete the branch.')
    process.exit(1)
  })
}
