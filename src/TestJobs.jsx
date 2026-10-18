import {useEffect, useState} from 'react'
import {authAccounts} from './authApi.js'
import {testJobsCreate, testJobsDelete} from './testJobsApi.js'
import {applyTestJobs, isTestJob, loadBookings, testJobChoices, TEST_JOB_LIMIT} from './testJobs.js'

function label(account) {
  const role = String(account.role || '').toLowerCase() === 'employee' ? 'Employee' : 'Customer'
  const status = account.status && account.status !== 'Approved' ? ` · ${account.status}` : ''
  return `${account.name} · ${account.email} · ${role}${status}`
}

export function TestJobs({user, bookings, onBookings}) {
  const [accounts, setAccounts] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [loadErr, setLoadErr] = useState('')
  const [customerPick, setCustomerPick] = useState('')
  const [employeePick, setEmployeePick] = useState('')
  const [count, setCount] = useState('1')
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)

  useEffect(() => {
    let on = true
    authAccounts({summary: true}).then(data => {
      if (!on) return
      setAccounts(data.accounts || [])
      setLoadErr('')
    }).catch(error => {
      if (!on) return
      setLoadErr(error.message || 'Could not load accounts.')
    }).finally(() => { if (on) setLoaded(true) })
    return () => { on = false }
  }, [])

  const choices = testJobChoices(accounts, user)
  const customerId = choices.customers.some(account => account.id === customerPick) ? customerPick : (choices.customer?.id || '')
  const employeeId = choices.employees.some(account => account.id === employeePick) ? employeePick : (choices.employee?.id || '')

  if (!user || user.role !== 'admin' || user.preview) return null
  const testCount = (bookings || []).filter(isTestJob).length
  const ready = !!customerId && !!employeeId && !busy && !loadErr

  const storeJobs = jobs => { onBookings(applyTestJobs(loadBookings(), jobs || [])) }

  const create = async () => {
    setErr('')
    setNote('')
    setBusy(true)
    try {
      const data = await testJobsCreate({customerId, employeeId, count: Number(count)})
      storeJobs(data.jobs)
      const n = Number(data.created) || 0
      setNote(n === 1 ? 'Created 1 test job.' : `Created ${n} test jobs.`)
      setConfirm(false)
    } catch (error) {
      setErr(error.message || 'Could not create a test job.')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setErr('')
    setNote('')
    setBusy(true)
    try {
      const data = await testJobsDelete()
      storeJobs(data.jobs)
      setNote(data.deleted ? `Deleted ${data.deleted} test job${data.deleted === 1 ? '' : 's'}.` : 'No test jobs to delete.')
      setConfirm(false)
    } catch (error) {
      setErr(error.message || 'Could not delete test jobs.')
    } finally {
      setBusy(false)
    }
  }

  return <div className="card flat test-jobs" id="test-jobs">
    <h3>Test jobs</h3>
    <p className="muted">Create a sample booking and assign it to a customer and an employee, including your own accounts on this email. A test job is marked TEST. It is not charged, not emailed or texted, and not included in revenue. Pending and unapproved employees can be assigned.</p>
    {!loaded && <p className="muted">Loading accounts…</p>}
    {loadErr && <p className="err" data-testid="test-job-load-error">{loadErr}</p>}
    {loaded && !loadErr && !!choices.customers.length && <label>Customer<select data-testid="test-job-customer" value={customerId} onChange={event => setCustomerPick(event.target.value)}>{choices.customers.map(account => <option key={account.id} value={account.id}>{label(account)}</option>)}</select></label>}
    {loaded && !loadErr && !!choices.employees.length && <label>Employee<select data-testid="test-job-employee" value={employeeId} onChange={event => setEmployeePick(event.target.value)}>{choices.employees.map(account => <option key={account.id} value={account.id}>{label(account)}</option>)}</select></label>}
    {loaded && !loadErr && !choices.customers.length && <p className="note leftn" data-testid="test-job-missing-customer">No customer account yet. <a href="#/login?role=customer&new=1">Create a customer account</a>. The same email can also be your admin account.</p>}
    {loaded && !loadErr && !choices.employees.length && <p className="note leftn" data-testid="test-job-missing-employee">No employee account yet. Pending and unapproved applications show up here after they are submitted. <a href="#/join">Open the detailer application</a>.</p>}
    <label>How many<select data-testid="test-job-count" value={count} onChange={event => setCount(event.target.value)}>
      <option value="1">One test job</option>
      <option value={String(TEST_JOB_LIMIT)}>Several varied test jobs</option>
    </select></label>
    <div className="acts">
      <button type="button" className="pill sm" data-testid="create-test-job" disabled={!ready} onClick={create}>{busy ? 'Working…' : 'Create test job'}</button>
      {!confirm && <button type="button" className="link" data-testid="delete-test-jobs" onClick={() => { setConfirm(true); setErr(''); setNote('') }}>Delete all test jobs</button>}
    </div>
    {confirm && <div className="test-confirm" role="group" aria-label="Confirm delete test jobs">
      <p>Delete all test jobs? This removes only jobs marked TEST{testCount ? ` (${testCount} on this screen)` : ''}. Real bookings stay.</p>
      <div className="acts">
        <button type="button" className="pill sm" data-testid="confirm-delete-test-jobs" disabled={busy} onClick={remove}>Delete test jobs</button>
        <button type="button" className="link" onClick={() => setConfirm(false)}>Cancel</button>
      </div>
    </div>}
    {note && <p className="muted" data-testid="test-job-result">{note}</p>}
    {err && <p className="err">{err}</p>}
  </div>
}
