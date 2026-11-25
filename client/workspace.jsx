import React, { useEffect, useRef, useState } from 'react'
import { Activity, ArrowLeft, ChevronLeft, ChevronRight, CircleCheck, Inbox, LogOut, Plus, Search, Ticket, X } from 'lucide-react'
import { activityLabels, categories, priorities, statuses } from '../shared/options'
import { dateLabel, request, ticketRef } from './api'
import { Brand } from './brand'

const defaultFilters = { q: '', status: '', priority: '', sort: 'updated' }

function Options({ values, blank }) {
  return <>{blank && <option value="">{blank}</option>}{Object.entries(values).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</>
}

function Badge({ value, values }) {
  return <span className={'badge ' + value}><span />{values[value]}</span>
}

function Modal({ title, children, onClose }) {
  const ref = useRef(null)
  useEffect(() => {
    ref.current.showModal()
  }, [])
  return <dialog ref={ref} onCancel={onClose} aria-labelledby="dialog-title">
    <header className="dialog-head"><h2 id="dialog-title">{title}</h2><button className="icon-button" type="button" aria-label="Close dialog" onClick={onClose}><X size={21} /></button></header>
    {children}
  </dialog>
}

function SubmitForm({ children, onSubmit, label, className = 'fields', onCancel }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  async function submit(event) {
    event.preventDefault()
    const form = event.currentTarget
    setPending(true)
    setError('')
    try {
      await onSubmit(Object.fromEntries(new FormData(form)))
      if (form.isConnected) form.reset()
    } catch (failure) {
      setError(failure.message)
    } finally {
      setPending(false)
    }
  }

  return <form onSubmit={submit} className={className}>
    {children}
    {error && <p className="error" role="alert">{error}</p>}
    <div className="actions">
      {onCancel && <button type="button" className="secondary" onClick={onCancel}>Cancel</button>}
      <button className="primary" disabled={pending}>{pending ? 'Saving…' : label}</button>
    </div>
  </form>
}

function TicketForm({ ticket, onClose, onSubmit }) {
  return <Modal title={ticket ? 'Edit ticket' : 'New support ticket'} onClose={onClose}>
    <SubmitForm onSubmit={onSubmit} label={ticket ? 'Save changes' : 'Submit ticket'} onCancel={onClose}>
      <label>Title<input name="title" defaultValue={ticket?.title} required minLength={4} maxLength={120} placeholder="Summarize the issue" /></label>
      <label>Description<textarea name="description" defaultValue={ticket?.description} required minLength={10} maxLength={5000} rows={5} placeholder="Tell us what happened and what you expected." /></label>
      <div className="field-row">
        <label>Category<select name="category" defaultValue={ticket?.category ?? 'general'}><Options values={categories} /></select></label>
        <label>Priority<select name="priority" defaultValue={ticket?.priority ?? 'medium'}><Options values={priorities} /></select></label>
      </div>
    </SubmitForm>
  </Modal>
}

function TicketList({ admin, onSelect, onNew, revision, onSessionExpired }) {
  const [filters, setFilters] = useState(defaultFilters)
  const [page, setPage] = useState(1)
  const [list, setList] = useState(null)
  const [counts, setCounts] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(true)
  useEffect(() => {
    const controller = new AbortController()
    request('/tickets/stats', { signal: controller.signal }).then(setCounts).catch(failure => {
      if (failure.status === 401) onSessionExpired()
    })
    return () => controller.abort()
  }, [revision, onSessionExpired])
  useEffect(() => {
    const controller = new AbortController()
    setBusy(true)
    setError('')
    const timer = setTimeout(async () => {
      const query = new URLSearchParams({ page: String(page) })
      for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value)
      try {
        const result = await request('/tickets?' + query, { signal: controller.signal })
        const lastPage = Math.max(1, Math.ceil(result.total / result.limit))
        if (page > lastPage) {
          setPage(lastPage)
        } else {
          setList(result)
          setBusy(false)
        }
      } catch (failure) {
        if (controller.signal.aborted) return
        if (failure.status === 401) onSessionExpired()
        setError(failure.message)
        setBusy(false)
      }
    }, 180)
    return () => { clearTimeout(timer); controller.abort() }
  }, [filters, page, revision, onSessionExpired])

  function updateFilter(key, value) {
    setFilters(current => ({ ...current, [key]: value }))
    setPage(1)
  }

  const cards = [
    { key: 'total', label: 'Total tickets', icon: Ticket, color: 'violet' },
    { key: 'open', label: 'Open', icon: Inbox, color: 'blue' },
    { key: 'in_progress', label: 'In progress', icon: Activity, color: 'amber' },
    { key: 'resolved', label: 'Resolved', icon: CircleCheck, color: 'green' }
  ]
  const pages = list ? Math.max(1, Math.ceil(list.total / list.limit)) : 1
  const filtered = Boolean(filters.q || filters.status || filters.priority)

  return <>
    <header className="page-heading">
      <div><h1>{admin ? 'Support queue' : 'My tickets'}</h1><p>{admin ? 'Manage incoming requests and keep users informed.' : 'Track your requests and follow up with the support team.'}</p></div>
      {!admin && <button className="primary" onClick={onNew}><Plus size={19} /> New ticket</button>}
    </header>
    <div className="stats" aria-label="Ticket counts">
      {cards.map(({ key, label, icon: Icon, color }) => <div className="stat" key={key}><span className={'stat-icon ' + color}><Icon size={20} /></span><div><span>{label}</span><strong>{counts?.[key] ?? '—'}</strong></div></div>)}
    </div>
    <section className="panel queue" aria-labelledby="queue-title" aria-busy={busy}>
      <header className="queue-heading"><h2 id="queue-title">{admin ? 'All tickets' : 'Submitted tickets'}</h2></header>
      <div className="filters">
        <label className="search"><Search size={18} /><input aria-label="Search tickets" placeholder="Search tickets…" maxLength={120} value={filters.q} onChange={e => updateFilter('q', e.target.value)} /></label>
        <select aria-label="Filter by status" value={filters.status} onChange={e => updateFilter('status', e.target.value)}><Options values={statuses} blank="All statuses" /></select>
        <select aria-label="Filter by priority" value={filters.priority} onChange={e => updateFilter('priority', e.target.value)}><Options values={priorities} blank="All priorities" /></select>
        <select aria-label="Sort tickets" value={filters.sort} onChange={e => updateFilter('sort', e.target.value)}><Options values={{ updated: 'Recently updated', newest: 'Newest first', oldest: 'Oldest first' }} /></select>
      </div>
      {error ? <p className="error inline-feedback" role="alert">{error}</p> : !list ? <div className="empty" role="status">Loading tickets…</div> : list.tickets.length ? <>
        <div className="table-scroll"><table><thead><tr><th>Ticket</th>{admin && <th>Submitted by</th>}<th>Status</th><th>Priority</th><th>Updated</th></tr></thead><tbody>
          {list.tickets.map(ticket => <tr key={ticket.id}>
            <td><button className="ticket-link" onClick={() => onSelect(ticket.id)}>{ticket.title}</button><span className="ticket-meta">{ticketRef(ticket.id)} · {categories[ticket.category]}</span></td>
            {admin && <td>{ticket.owner_name}</td>}
            <td><Badge value={ticket.status} values={statuses} /></td><td><Badge value={ticket.priority} values={priorities} /></td><td>{dateLabel(ticket.updated_at)}</td>
          </tr>)}
        </tbody></table></div>
        <footer className="pagination">
          <span>{list.total} {list.total === 1 ? 'ticket' : 'tickets'} · Page {list.page} of {pages}</span>
          <div><button className="icon-button" aria-label="Previous page" disabled={busy || page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft size={19} /></button><button className="icon-button" aria-label="Next page" disabled={busy || page >= pages} onClick={() => setPage(page + 1)}><ChevronRight size={19} /></button></div>
        </footer>
      </> : <div className="empty">
        <span className="stat-icon violet"><Inbox size={23} /></span>
        <h3>{filtered ? 'No matching tickets' : 'No tickets yet'}</h3>
        <p>{filtered ? 'Try a different search or clear the filters.' : admin ? 'New requests will appear here as users submit them.' : 'Submit a ticket to get help from the support team.'}</p>
        {filtered && <button className="secondary" onClick={() => { setFilters(defaultFilters); setPage(1) }}>Clear filters</button>}
        {!filtered && !admin && <button className="secondary" onClick={onNew}>Create a ticket</button>}
      </div>}
    </section>
  </>
}

function Detail({ data, admin, back, edit, remove, change, comment }) {
  const { ticket, comments, activity } = data
  const editable = !admin && ticket.status === 'open'
  return <>
    <button className="plain back" onClick={back}><ArrowLeft size={17} /> Back to tickets</button>
    <header className="page-heading"><div>
      <div className="ticket-meta">{ticketRef(ticket.id)} · {categories[ticket.category]}</div>
      <h1>{ticket.title}</h1><p>Submitted by {ticket.owner_name} · {dateLabel(ticket.created_at)}</p>
    </div>{editable && <div className="actions"><button className="secondary" onClick={edit}>Edit ticket</button><button className="danger" onClick={remove}>Delete ticket</button></div>}</header>
    <div className="detail-grid">
      <div className="detail-main">
        <section className="panel detail-panel"><h2>Description</h2><p className="preserve">{ticket.description}</p></section>
        <section className="panel detail-panel">
          <h2>Conversation <span className="counter">{comments.length}</span></h2>
          {comments.length ? <ul className="comments">{comments.map(item => <li key={item.id}>
            <div className="comment-meta"><strong>{item.author_name}</strong>{item.author_role === 'admin' && <span className="admin-label">Support</span>}<time dateTime={item.created_at}>{dateLabel(item.created_at)}</time></div>
            <p className="preserve">{item.body}</p>
          </li>)}</ul> : <p className="muted">No comments yet.</p>}
          <SubmitForm onSubmit={comment} label="Post comment">
            <label>Comment<textarea name="body" required rows={3} maxLength={2000} placeholder="Write a reply…" /></label>
          </SubmitForm>
        </section>
      </div>
      <aside className="detail-main">
        <section className="panel detail-panel">
          <h2>Ticket properties</h2>
          {admin ? <SubmitForm key={ticket.status + ticket.priority} onSubmit={change} label="Save properties">
            <label>Status<select name="status" defaultValue={ticket.status}><Options values={statuses} /></select></label>
            <label>Priority<select name="priority" defaultValue={ticket.priority}><Options values={priorities} /></select></label>
          </SubmitForm> : <dl className="properties"><div><dt>Status</dt><dd><Badge value={ticket.status} values={statuses} /></dd></div><div><dt>Priority</dt><dd><Badge value={ticket.priority} values={priorities} /></dd></div></dl>}
        </section>
        <section className="panel detail-panel"><h2>Activity</h2><ol className="timeline">
          {activity.map(item => <li key={item.id}><span><strong>{item.actor_name}</strong> {activityLabels[item.type]}
            {item.type === 'status_changed' && <> from {statuses[item.details.from]} to {statuses[item.details.to]}</>}.</span><time dateTime={item.created_at}>{dateLabel(item.created_at)}</time></li>)}
        </ol></section>
      </aside>
    </div>
  </>
}

export function Workspace({ user, onLogout }) {
  const admin = user.role === 'admin'
  const [selected, setSelected] = useState(null)
  const [detail, setDetail] = useState(null)
  const [modal, setModal] = useState(null)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const activeTicket = useRef(null)

  function openTicket(id) {
    activeTicket.current = id
    setDetail(null)
    setSelected(id)
    setError('')
  }

  useEffect(() => {
    if (!selected) return
    const controller = new AbortController()
    request('/tickets/' + selected, { signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) {
        setError('')
        setDetail(result)
      }
    }).catch(failure => {
      if (controller.signal.aborted) return
      if (failure.status === 401) return onLogout()
      setError(failure.message)
    })
    return () => controller.abort()
  }, [selected, revision, onLogout])

  async function mutate(path, method, body) {
    const id = selected
    try {
      const result = await request(path, { method, body })
      setRevision(value => value + 1)
      if (method === 'DELETE' && activeTicket.current === id) openTicket(null)
      else if (!id && result?.ticket) openTicket(result.ticket.id)
      setModal(null)
    } catch (failure) {
      if (failure.status === 401) onLogout()
      throw failure
    }
  }

  async function logout() {
    try {
      await request('/auth/logout', { method: 'POST' })
      onLogout()
    } catch (failure) {
      setError(failure.message)
    }
  }

  return <div className="workspace">
    <aside className="sidebar">
      <Brand />
      <div className="navigation"><span className="eyebrow">WORKSPACE</span><button className="nav-link" onClick={() => openTicket(null)}><Ticket size={19} />{admin ? 'Support queue' : 'My tickets'}</button></div>
      <div className="profile"><span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span><div><strong>{user.name}</strong><span>{admin ? 'Administrator' : 'Requester'}</span></div><button type="button" className="icon-button" onClick={logout} aria-label="Sign out" title="Sign out"><LogOut size={19} /></button></div>
    </aside>
    <main className="workspace-main">
      {error && <p className="error" role="alert">{error}</p>}
      <div hidden={Boolean(selected)}>
        <TicketList admin={admin} onSelect={openTicket} onNew={() => setModal('new')} revision={revision} onSessionExpired={onLogout} />
      </div>
      {selected ? detail ? <Detail data={detail} admin={admin} back={() => openTicket(null)} edit={() => setModal('edit')} remove={() => setModal('delete')}
        change={body => mutate('/tickets/' + selected, 'PATCH', body)}
        comment={body => mutate('/tickets/' + selected + '/comments', 'POST', body)}
      /> : error ? <button className="plain back" onClick={() => openTicket(null)}><ArrowLeft size={17} /> Back to tickets</button> : <p role="status">Loading ticket…</p> : null}
    </main>
    {(modal === 'new' || modal === 'edit') && <TicketForm ticket={modal === 'edit' ? detail.ticket : null} onClose={() => setModal(null)}
      onSubmit={body => mutate(modal === 'edit' ? '/tickets/' + selected : '/tickets', modal === 'edit' ? 'PATCH' : 'POST', body)} />}
    {modal === 'delete' && <Modal title="Delete this ticket?" onClose={() => setModal(null)}>
      <SubmitForm label="Delete ticket" onCancel={() => setModal(null)} onSubmit={() => mutate('/tickets/' + selected, 'DELETE')}>
        <p>The ticket and its conversation will be removed from the support queue.</p>
      </SubmitForm>
    </Modal>}
  </div>
}
