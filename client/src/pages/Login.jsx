import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle, ArrowRight, BarChart3, CheckCircle2, Eye, EyeOff, FileText, Info, Layers, Loader2, Lock, User, Users,
} from 'lucide-react'
import { api, session } from '../api'
import Logo from '../components/Logo'

const FEATURES = [
  { icon: BarChart3, title: 'Project & Job Cost Management' },
  { icon: Layers, title: 'Inventory & Material Control' },
  { icon: FileText, title: 'Purchasing & Accounts Receivable' },
  { icon: Users, title: 'Payroll & Workforce Management' },
]

export default function Login() {
  const nav = useNavigate()
  const remembered = session.rememberedUsername
  const [username, setUsername] = useState(remembered)
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(!!remembered)
  const [show, setShow] = useState(false)
  const [error, setError] = useState('')
  const [touched, setTouched] = useState(false)
  const [status, setStatus] = useState('idle') // idle | busy | success
  const [forgot, setForgot] = useState(false)

  const userErr = touched && !username.trim() ? 'Enter your username or email' : ''
  const pwErr = touched && !password ? 'Enter your password' : ''

  async function submit(e) {
    e.preventDefault()
    setTouched(true)
    setError('')
    if (!username.trim() || !password) return
    setStatus('busy')
    try {
      const { user } = await api('/auth/login', { method: 'POST', body: { username: username.trim(), password, remember } })
      session.save(user, remember)
      session.rememberedUsername = remember ? username.trim() : ''
      setStatus('success')
      setTimeout(() => nav('/', { replace: true }), 450)
    } catch (err) {
      setError(err.message)
      setStatus('idle')
    }
  }

  return (
    <div className="login-wrap">
      {/* Left: brand panel with photo and wave edge */}
      <aside className="login-art">
        <div className="login-photo" aria-hidden="true" />
        <svg className="login-wave" viewBox="0 0 160 1000" preserveAspectRatio="none" aria-hidden="true">
          <path d="M70 0 C 20 160, 10 330, 46 500 C 82 670, 60 850, 0 1000 L160 1000 L160 0 Z" className="wave-band" />
          <path d="M100 0 C 50 160, 40 330, 76 500 C 112 670, 90 850, 30 1000 L160 1000 L160 0 Z" className="wave-fill" />
        </svg>

        <div className="login-brand">
          <span className="login-logo-badge"><Logo size={76} /></span>
          <span>
            <span className="lb-name">STAFFWARE</span>
            <span className="lb-sub">Enterprise Resource Planning</span>
          </span>
        </div>

        <div className="login-hero">
          <h2>ERP for<br />Electrical Contracting</h2>
          <p>Plan. Procure. Manage. Track. A complete business solution for electrical contractors.</p>
          <ul className="login-features">
            {FEATURES.map(({ icon: Icon, title }) => (
              <li key={title}>
                <span className="lf-icon"><Icon size={17} /></span>
                <span className="lf-title">{title}</span>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      {/* Right: sign-in card */}
      <main className="login-panel">
        <form className="login-card" onSubmit={submit} noValidate>
          <div className="login-card-brand">
            <Logo size={76} />
            <span>
              <span className="lcb-name">STAFFWARE</span>
              <span className="lcb-sub">Republic Electric West</span>
            </span>
          </div>
          <span className="brand-rule" aria-hidden="true" />

          <div className="login-heading">
            <h1>Sign in to StaffWare</h1>
            <p>Access your ERP workspace</p>
          </div>

          {status === 'success' && (
            <div className="success-state" role="status"><CheckCircle2 size={16} /> Signed in. Opening your dashboard…</div>
          )}
          {error && <div className="error-state" role="alert"><AlertTriangle size={16} /> {error}</div>}

          <div className="field">
            <label htmlFor="login-user" className="sr-only">Username or email</label>
            <div className={`input-icon${userErr ? ' invalid' : ''}`}>
              <User size={18} />
              <input id="login-user" value={username} onChange={(e) => setUsername(e.target.value)}
                autoFocus={!remembered} autoComplete="username" placeholder="Username or Email"
                aria-invalid={!!userErr} aria-describedby={userErr ? 'user-err' : undefined} disabled={status !== 'idle'} />
            </div>
            {userErr && <span id="user-err" className="field-error">{userErr}</span>}
          </div>

          <div className="field">
            <label htmlFor="login-pw" className="sr-only">Password</label>
            <div className={`input-icon pw${pwErr ? ' invalid' : ''}`}>
              <Lock size={18} />
              <input id="login-pw" type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
                autoFocus={!!remembered} autoComplete="current-password" placeholder="Password"
                aria-invalid={!!pwErr} aria-describedby={pwErr ? 'pw-err' : undefined} disabled={status !== 'idle'} />
              <button type="button" className="icon-btn" onClick={() => setShow((s) => !s)}
                aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}>
                {show ? <Eye size={18} /> : <EyeOff size={18} />}
              </button>
            </div>
            {pwErr && <span id="pw-err" className="field-error">{pwErr}</span>}
          </div>

          <div className="login-row">
            <label className="check">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              Remember me
            </label>
            <button type="button" className="link-btn" onClick={() => setForgot((f) => !f)} aria-expanded={forgot}>Forgot password?</button>
          </div>
          {forgot && (
            <div className="info-state" role="note">
              <Info size={16} />
              <span>Passwords are managed by your Staffware administrator. Ask them to reset it, then sign in with the new password.</span>
            </div>
          )}

          <button className="btn primary login-submit" disabled={status !== 'idle'}>
            {status === 'busy' ? <><Loader2 size={17} className="spin" /> Signing in…</>
              : status === 'success' ? <><CheckCircle2 size={17} /> Signed in</>
              : <>Sign In <ArrowRight size={17} /></>}
          </button>

          <p className="login-note">© {new Date().getFullYear()} StaffWare ERP. All rights reserved.</p>
        </form>
      </main>
    </div>
  )
}
