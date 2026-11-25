import React, { useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowLeft, LifeBuoy } from 'lucide-react'
import { request } from './api'
import { Workspace } from './workspace'
import { Brand } from './brand'
import './styles.css'

function Auth({ onLogin }) {
  const [register, setRegister] = useState(false)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setError('')
    setPending(true)
    const body = Object.fromEntries(new FormData(event.currentTarget))
    try {
      const result = await request(register ? '/auth/register' : '/auth/login', { method: 'POST', body })
      onLogin(result.user)
    } catch (failure) {
      setError(failure.message)
    } finally {
      setPending(false)
    }
  }

  return <main className="auth-page">
    <aside className="auth-aside">
      <Brand />
      <div className="auth-art" aria-hidden="true"><div /><div /><div /><div /><span><LifeBuoy size={88} strokeWidth={0.8} /></span></div>
      <div className="auth-aside-copy"><span className="eyebrow">RELAY HELPDESK</span><h1>Support starts<br />here.</h1><p>Submit a request, follow its progress, and keep the conversation in one place.</p></div>
    </aside>
    <section className="auth-content">
      {register && <button className="plain back" onClick={() => { setRegister(false); setError('') }} disabled={pending}><ArrowLeft size={16} /> Back to sign in</button>}
      <h2>{register ? 'Create your account' : 'Sign in to Relay'}</h2>
      <p>{register ? 'Create an account to submit and track your requests.' : 'Enter your details to access your support workspace.'}</p>
      <form className="fields" onSubmit={submit} key={String(register)}>
        {register && <label>Full name<input name="name" autoComplete="name" required minLength={2} maxLength={80} placeholder="Your name" /></label>}
        <label>Email address<input name="email" type="email" autoComplete="email" required maxLength={254} placeholder="you@example.com" /></label>
        <label>Password<input name="password" type="password" autoComplete={register ? 'new-password' : 'current-password'} required minLength={register ? 10 : undefined} maxLength={128} placeholder={register ? 'At least 10 characters' : 'Your password'} /></label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary" disabled={pending}>{pending ? 'Please wait…' : register ? 'Create account' : 'Sign in'}</button>
      </form>
      {!register && <p className="auth-switch">New to Relay? <button className="plain" onClick={() => { setRegister(true); setError('') }} disabled={pending}>Create an account</button></p>}
    </section>
  </main>
}

function App() {
  const [user, setUser] = useState()
  const logout = useCallback(() => setUser(null), [])
  useEffect(() => {
    request('/auth/me').then(result => setUser(result.user)).catch(() => setUser(null))
  }, [])
  if (user === undefined) return <main className="startup" role="status">Loading Relay…</main>
  if (!user) return <Auth onLogin={setUser} />
  return <Workspace user={user} onLogout={logout} />
}

createRoot(document.getElementById('root')).render(<App />)
