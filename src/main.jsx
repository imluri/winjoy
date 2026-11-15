import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import DesktopShell from './DesktopShell'
import { Icon } from './icons'
import { KEYBOARD_BINDINGS } from './controls'
import './styles.css'

const bridge = window.winjoy
const defaultPort = 4747
const loopback = { address: '127.0.0.1', name: 'This PC only' }
const idle = { phase: 'idle', mode: null, status: '', capture: null, connected: false, invite: null, latencyMs: null }
const idleUpdate = { phase: 'idle', status: '', currentVersion: '' }

const brand = { name: 'WinJoy', caption: 'Keyboard to controller', mark: <Icon name="gamepad" size={21} /> }
const items = [
  { id: 'host', label: 'Host', icon: <Icon name="host" /> },
  { id: 'guest', label: 'Join', icon: <Icon name="join" /> },
  { id: 'controls', label: 'Controls', icon: <Icon name="keyboard" /> },
  { id: 'updates', label: 'Updates', icon: <Icon name="download" /> },
]

function errorText(error) {
  return error?.message?.replace(/^Error invoking remote method '[^']+': Error: /, '') || String(error)
}

function formatInvite({ address, token }) {
  return `WinJoy invite\nAddress: ${address}\nCode: ${token}`
}

function parseInvite(value) {
  const invite = /^WinJoy invite\s*\r?\nAddress:\s*([^\s]+)\s*\r?\nCode:\s*([^\s]+)$/i.exec(value.trim())
  if (!invite) throw new Error('Paste the complete invite from the host, including the address and code.')
  return { address: invite[1], token: invite[2] }
}

function Section({ title, description, children, className = '' }) {
  return (
    <section className={`setting-section ${className}`}>
      <header className="setting-section-heading">
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </header>
      {children}
    </section>
  )
}

function Field({ id, label, description, children, wide }) {
  return (
    <div className={`setting-field${wide ? ' setting-field--wide' : ''}`}>
      <div className="setting-copy">
        <label className="setting-label" htmlFor={id}>{label}</label>
        <p className="setting-description" id={`${id}-help`}>{description}</p>
      </div>
      <div className="setting-control">{children}</div>
    </div>
  )
}

function HostSetup({ addresses, networkPending, bind, setBind, port, setPort, onSubmit, locked }) {
  return (
    <form id="host-form" onSubmit={onSubmit}>
      <Section title="Connection">
        <div className="setting-fields">
          <Field id="host-bind" label="Network interface" description="Choose a LAN or private VPN address your friend can reach.">
            <select className="setting-input" id="host-bind" value={bind} aria-describedby="host-bind-help"
              onChange={event => setBind(event.target.value)} disabled={locked || networkPending}>
              {networkPending && !bind && <option value="">Finding network addresses…</option>}
              {addresses.map(({ address, name }) => <option key={address} value={address}>{name} ({address})</option>)}
            </select>
          </Field>
          <Field id="host-port" label="Port" description="Use the same port in the invite and in your firewall settings.">
            <input className="setting-input setting-number" id="host-port" type="number" inputMode="numeric"
              aria-describedby="host-port-help" required min="1" max="65535" step="1" value={port}
              onChange={event => setPort(event.target.value)} disabled={locked} />
          </Field>
        </div>
      </Section>
      <Section title="Playing together" className="play-guide">
        <p>Share the WinJoy invite and start your local multiplayer game. If you stream through Steam Remote Play Together, keep guest keyboard and mouse sharing off in Steam.</p>
        <p>With the game focused, press <kbd>F8</kbd> to enable keyboard capture. Press it again to pause before typing elsewhere.</p>
      </Section>
    </form>
  )
}

function GuestSetup({ invite, setInvite, onSubmit, locked }) {
  return (
    <form id="guest-form" onSubmit={onSubmit}>
      <Section title="Connection">
        <div className="setting-fields">
          <Field id="guest-invite" label="Host invite" description="Paste what your friend copied from their Host page." wide>
            <textarea id="guest-invite" className="setting-input invite-input" aria-describedby="guest-invite-help" rows={4}
              required spellCheck={false} autoComplete="off" value={invite} onChange={event => setInvite(event.target.value)}
              placeholder={`WinJoy invite\nAddress: http://…\nCode: …`} disabled={locked} />
          </Field>
        </div>
      </Section>
      <Section title="Keyboard capture" className="play-guide">
        <p>Focus your friend’s game stream and press <kbd>F8</kbd> to enable capture. Press it again to pause before typing elsewhere.</p>
      </Section>
    </form>
  )
}

function SessionDetails({ session, onCopy, copied }) {
  const host = session.mode === 'host'
  const connectedText = host ? 'Player 2 connected' : 'Connected to host'
  const waitingText = host ? 'Waiting for player 2' : 'Waiting for the host'
  const capturing = Boolean(session.capture?.active)
  const latency = session.connected && Number.isFinite(session.latencyMs)
    ? session.latencyMs < 1 ? '<1 ms' : `${Math.round(session.latencyMs)} ms`
    : session.connected ? 'Measuring…' : '—'

  return (
    <>
      <Section title={host ? 'Hosting' : 'Guest session'}>
        <dl className="session-details">
          <div>
            <dt>Connection</dt>
            <dd role="status"><span className="status-dot" data-active={session.connected} />{session.connected ? connectedText : waitingText}</dd>
          </div>
          <div>
            <dt>Round-trip latency</dt>
            <dd className="session-latency">{latency}</dd>
          </div>
          <div>
            <dt>Keyboard</dt>
            <dd role="status"><span className="status-dot" data-active={capturing} />{capturing ? 'Capturing keys' : 'Paused'}</dd>
          </div>
        </dl>
        <p className="session-capture-help">
          {capturing ? <>Press <kbd>F8</kbd> to pause capture.</>
            : <>Focus {host ? 'your game' : 'the game stream'} and press <kbd>F8</kbd> to enable capture.</>}
        </p>
      </Section>
      {session.invite && (
        <Section title="Invite player 2" description="Send this invite to your friend. They can paste it on the Join page.">
          <div className="invite-details">
            <dl className="invite-address">
              <dt>Host address</dt>
              <dd><code>{session.invite.address}</code></dd>
            </dl>
            <button type="button" className="button button-primary" onClick={onCopy}>
              <Icon name={copied ? 'check' : 'copy'} size={16} />
              {copied ? 'Invite copied' : 'Copy invite'}
            </button>
          </div>
        </Section>
      )}
    </>
  )
}

function Controls() {
  const actionBindings = KEYBOARD_BINDINGS.slice(4)
  return (
    <Section title="Default key mapping" description="The action names follow Cuphead’s Xbox layout. Other games can assign different actions to the same buttons.">
      <dl className="control-list">
        <div><dt>Move</dt><dd><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></dd></div>
        {actionBindings.map(({ name, key }) => <div key={key}><dt>{name}</dt><dd><kbd>{key}</kbd></dd></div>)}
        <div><dt>Enable or pause keyboard capture</dt><dd><kbd>F8</kbd></dd></div>
      </dl>
    </Section>
  )
}

function Updates({ update, action, active, sessionPending, error, onCheck, onInstall }) {
  const ready = update.phase === 'ready'
  const downloading = update.phase === 'downloading'
  const checking = update.phase === 'checking'
  const installLabel = active ? 'Stop session and update' : 'Install update'
  const progress = Number.isFinite(update.progress) ? Math.max(0, Math.min(100, Math.round(update.progress))) : undefined
  const status = error || update.status || (bridge
    ? 'WinJoy checks for updates automatically.'
    : 'Open WinJoy as a desktop app to check for updates.')

  return (
    <Section title="WinJoy updates">
      <dl className="session-details">
        <div>
          <dt>Installed version</dt>
          <dd>{update.currentVersion || '—'}</dd>
        </div>
        {update.version && update.version !== update.currentVersion && <div>
          <dt>Update version</dt>
          <dd>{update.version}</dd>
        </div>}
      </dl>
      {downloading && (
        <div className="update-progress">
          <progress aria-label="Update download progress" max={100} value={progress} />
          {progress !== undefined && <span>{progress}%</span>}
        </div>
      )}
      <div className="update-actions">
        <div className="update-copy">
          <p role={error || update.phase === 'error' ? 'alert' : 'status'}>{status}</p>
          {ready && active && <p>Installing the update ends your current session and closes WinJoy.</p>}
        </div>
        {ready
          ? <button className="button button-primary" type="button" onClick={onInstall}
              disabled={!bridge || Boolean(action) || sessionPending}>{action === 'install' ? 'Installing…' : installLabel}</button>
          : <button className="button button-secondary" type="button" onClick={onCheck}
              disabled={!bridge || Boolean(action) || checking || downloading || update.phase === 'available'}>
              {checking ? 'Checking…' : 'Check for updates'}
            </button>}
      </div>
    </Section>
  )
}

function App() {
  const [page, setPage] = useState('host')
  const [session, setSession] = useState(idle)
  const [update, setUpdate] = useState(idleUpdate)
  const [updateAction, setUpdateAction] = useState(null)
  const [updateError, setUpdateError] = useState('')
  const [addresses, setAddresses] = useState([])
  const [bind, setBind] = useState(bridge ? '' : loopback.address)
  const [hostPort, setHostPort] = useState(String(defaultPort))
  const [inviteText, setInviteText] = useState('')
  const [pending, setPending] = useState(false)
  const [networkPending, setNetworkPending] = useState(Boolean(bridge))
  const [networkError, setNetworkError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const scheme = matchMedia('(prefers-color-scheme: dark)')
    function updateTheme() {
      document.documentElement.dataset.theme = scheme.matches ? 'dark' : 'light'
    }
    updateTheme()
    scheme.addEventListener('change', updateTheme)
    return () => scheme.removeEventListener('change', updateTheme)
  }, [])

  useEffect(() => {
    if (!bridge) return
    let mounted = true
    let receivedEvent = false
    const unsubscribe = bridge.onState(state => {
      receivedEvent = true
      if (mounted) setSession(state)
    })
    bridge.getState().then(state => {
      if (mounted && !receivedEvent) setSession(state)
    }).catch(error => {
      if (mounted) setFeedback(errorText(error))
    })
    bridge.getAddresses().then(networks => {
      if (!mounted) return
      setAddresses(networks)
      const preferred = networks.find(network => network.name.toLowerCase().includes('tailscale'))
        ?? networks.find(network => network.address !== loopback.address)
      setBind(preferred?.address ?? loopback.address)
    }).catch(error => {
      if (!mounted) return
      setNetworkError(errorText(error))
      setBind(loopback.address)
    }).finally(() => {
      if (mounted) setNetworkPending(false)
    })
    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!bridge) return
    let mounted = true
    let receivedEvent = false
    const unsubscribe = bridge.onUpdateState(state => {
      receivedEvent = true
      if (mounted) setUpdate(state)
    })
    bridge.getUpdateState().then(state => {
      if (mounted && !receivedEvent) setUpdate(state)
    }).catch(error => {
      if (mounted) setUpdateError(errorText(error))
    })
    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  const active = ['starting', 'running', 'stopping'].includes(session.phase)
  const sessionPage = page === 'host' || page === 'guest'
  const currentSession = session.mode === page
  const installing = updateAction === 'install'
  const locked = !bridge || pending || active || installing
  const displayAddresses = addresses.some(network => network.address === loopback.address)
    ? addresses
    : [...addresses, loopback]

  async function request(action) {
    setPending(true)
    setCopied(false)
    setFeedback('')
    try {
      await action()
    } catch (error) {
      setFeedback(errorText(error))
    } finally {
      setPending(false)
    }
  }

  function startHost(event) {
    event.preventDefault()
    if (locked || !bind) return
    void request(() => bridge.startHost({ bind, port: Number(hostPort) }))
  }

  function startGuest(event) {
    event.preventDefault()
    if (locked) return
    void request(() => bridge.startGuest(parseInvite(inviteText)))
  }

  async function requestUpdate(action) {
    setUpdateAction(action)
    setUpdateError('')
    try {
      if (action === 'check') await bridge.checkForUpdates()
      else await bridge.installUpdate()
    } catch (error) {
      setUpdateError(errorText(error))
    } finally {
      setUpdateAction(null)
    }
  }

  async function copyInvite() {
    setFeedback('')
    try {
      await bridge.copy(formatInvite(session.invite))
      setCopied(true)
    } catch (error) {
      setFeedback(errorText(error))
    }
  }

  const startLabel = page === 'host' ? 'Start hosting' : 'Join session'
  const error = feedback || (sessionPage && session.phase === 'error' ? session.status : '') || (page === 'host' ? networkError : '')
  const footer = (sessionPage || active) && (
    <footer className="action-bar">
      <div className="action-bar-content">
        <div className="save-message" role="status">
          {!bridge && 'Open WinJoy as a desktop app to start a session.'}
          {active && session.phase !== 'running' && session.status}
          {session.phase === 'running' && !currentSession && (session.mode === 'host' ? 'Host session active' : 'Guest session active')}
        </div>
        {active ? <button key="stop" type="button" className="button button-secondary" disabled={pending || installing || session.phase === 'stopping'}
          onClick={() => void request(() => bridge.stop())}>Stop session</button>
          : <button key="start" type="submit" form={`${page}-form`} className="button button-primary"
            disabled={locked || (page === 'host' && networkPending)}>{startLabel}</button>}
      </div>
    </footer>
  )

  return (
    <DesktopShell brand={brand} items={items} page={page} windowControls={window.desktopWindow} footer={footer}
      onNavigate={next => {
        setFeedback('')
        setPage(next)
      }}>
      <div className="page-content">
        <header className="page-heading">
          {page === 'host' && <><h1>Host a game</h1><p>Run a local multiplayer game on this PC and connect two keyboards as separate Xbox controllers.</p></>}
          {page === 'guest' && <><h1>Join a game</h1><p>Use your keyboard as the second controller on your friend’s PC.</p></>}
          {page === 'controls' && <h1>Controls</h1>}
          {page === 'updates' && <h1>Updates</h1>}
        </header>
        {error && <p className="session-error" role="alert">{error}</p>}
        {page === 'controls' && <Controls />}
        {page === 'updates' && <Updates update={update} action={updateAction} active={active}
          sessionPending={pending || session.phase === 'stopping'} error={updateError}
          onCheck={() => void requestUpdate('check')} onInstall={() => void requestUpdate('install')} />}
        {sessionPage && active && !currentSession && (
          <Section title="Session in progress" description="Stop your current session to switch between hosting and joining." />
        )}
        {sessionPage && currentSession && session.phase === 'running' && (
          <SessionDetails session={session} onCopy={copyInvite} copied={copied} />
        )}
        {page === 'host' && (!active || (currentSession && session.phase !== 'running')) && (
          <HostSetup addresses={displayAddresses} networkPending={networkPending} bind={bind} setBind={setBind}
            port={hostPort} setPort={setHostPort} onSubmit={startHost} locked={locked} />
        )}
        {page === 'guest' && (!active || (currentSession && session.phase !== 'running')) && (
          <GuestSetup invite={inviteText} setInvite={setInviteText} onSubmit={startGuest} locked={locked} />
        )}
      </div>
    </DesktopShell>
  )
}

createRoot(document.getElementById('root')).render(<App />)
