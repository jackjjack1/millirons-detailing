import {isTestJob} from './testJobs.js'

export function TestBadge({job}) {
  if (!isTestJob(job)) return null
  return <span className="test-badge" data-testid="test-badge">TEST</span>
}
