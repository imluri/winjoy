import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import DesktopShell from './DesktopShell'
import { Icon } from './icons'
import { KEYBOARD_BINDINGS } from './controls'
import './styles.css'

const bridge = window.winjoy
const defaultPort = 4747
const loopback = { address: '127.0.0.1', name: 'This PC only' }
const idle = { phase: 'idle', mode: null, status: '', capture: null, connected: false, invite: null }

const brand = { name: 'WinJoy', caption: 'Keyboard to controller', mark: <Icon name="gamepad" size={21} /> }
const items = [
  { id: 'host', label: 'Host', icon: <Icon name="host" /> },
  { id: 'guest', label: 'Join', icon: <Icon name="join" /> },
  { id: 'controls', label: 'Controls', icon: <Icon name="keyboard" /> },
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

function HostSetup({ addresses, networkPending, bind, setBind, port, setPort, windowTitle, setWindowTitle, onSubmit, locked }) {
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
          <Field id="host-window" label="Game window" description="WinJoy captures keys while a window with this text in its title is focused.">
            <input className="setting-input" id="host-window" aria-describedby="host-window-help" value={windowTitle}
              required placeholder="Cuphead" onChange={event => setWindowTitle(event.target.value)} disabled={locked} />
          </Field>
        </div>
      </Section>
      <Section title="Playing together" className="play-guide">
        <p>Share the WinJoy invite, launch Cuphead, and invite your friend through Steam Remote Play Together. Keep guest keyboard and mouse sharing off in Steam. Once your friend connects to WinJoy, have them press <kbd>P</kbd> or <kbd>J</kbd> to join in Cuphead.</p>
      </Section>
    </form>
  )
}

function GuestSetup({ invite, setInvite, windowTitle, setWindowTitle, onSubmit, locked }) {
  return (
    <form id="guest-form" onSubmit={onSubmit}>
      <Section title="Connection">
        <div className="setting-fields">
          <Field id="guest-invite" label="Host invite" description="Paste what your friend copied from their Host page." wide>
            <textarea id="guest-invite" className="setting-input invite-input" aria-describedby="guest-invite-help" rows={4}
              required spellCheck={false} autoComplete="off" value={invite} onChange={event => setInvite(event.target.value)}
              placeholder={`WinJoy invite\nAddress: http://…\nCode: …`} disabled={locked} />
          </Field>
          <Field id="guest-window" label="Capture window (optional)" description="Enter part of your game stream window’s title, or leave blank to capture from any window while enabled.">
            <input className="setting-input" id="guest-window" aria-describedby="guest-window-help" value={windowTitle}
              placeholder="Any window" onChange={event => setWindowTitle(event.target.value)} disabled={locked} />
          </Field>
        </div>
      </Section>
      <Section title="Keyboard capture" className="play-guide">
        <p>Focus the Steam Remote Play Together stream and press <kbd>F8</kbd> to enable capture. Press <kbd>F8</kbd> again to pause before typing elsewhere.</p>
      </Section>
    </form>
  )
}

function SessionDetails({ session, onCopy, copied }) {
  const host = session.mode === 'host'
  const connectedText = host ? 'Player 2 connected' : 'Connected to host'
  const waitingText = host ? 'Waiting for player 2' : 'Waiting for the host'
  const capture = session.capture
  const captureStatus = capture?.active ? 'Capturing keys' : capture?.enabled ? 'Waiting for the target window' : 'Paused'
  const description = capture?.enabled ? 'Press F8 to pause capture.' : 'Press F8 to enable capture.'

  return (
    <>
      <Section title={host ? 'Hosting' : 'Guest session'}>
        <dl className="session-details">
          <div>
            <dt>Connection</dt>
            <dd role="status"><span className="status-dot" data-active={session.connected} />{session.connected ? connectedText : waitingText}</dd>
          </div>
          <div>
            <dt>Keyboard</dt>
            <dd role="status"><span className="status-dot" data-active={capture?.active ?? false} />{captureStatus}</dd>
          </div>
        </dl>
        <p className="session-capture-help">{description}</p>
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
    <Section title="Cuphead controls" description="Use the same keyboard layout on both PCs.">
      <dl className="control-list">
        <div><dt>Move</dt><dd><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></dd></div>
        {actionBindings.map(({ name, key }) => <div key={key}><dt>{name}</dt><dd><kbd>{key}</kbd></dd></div>)}
        <div><dt>Enable or pause keyboard capture</dt><dd><kbd>F8</kbd></dd></div>
      </dl>
    </Section>
  )
}

function App() {
  const [page, setPage] = useState('host')
  const [session, setSession] = useState(idle)
  const [addresses, setAddresses] = useState([])
  const [bind, setBind] = useState(bridge ? '' : loopback.address)
  const [hostPort, setHostPort] = useState(String(defaultPort))
  const [hostWindow, setHostWindow] = useState('Cuphead')
  const [guestWindow, setGuestWindow] = useState('')
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
      setBind(networks.find(network => network.address !== loopback.address)?.address ?? loopback.address)
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

  const active = ['starting', 'running', 'stopping'].includes(session.phase)
  const currentSession = session.mode === page
  const locked = !bridge || pending || active
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
    void request(() => {
      if (!hostWindow.trim()) throw new Error('Enter part of the game window’s title.')
      return bridge.startHost({ bind, port: Number(hostPort), windowTitle: hostWindow.trim() })
    })
  }

  function startGuest(event) {
    event.preventDefault()
    if (locked) return
    void request(() => bridge.startGuest({ ...parseInvite(inviteText), windowTitle: guestWindow.trim() || undefined }))
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
  const error = feedback || (session.phase === 'error' ? session.status : '') || (page === 'host' ? networkError : '')
  const footer = (page !== 'controls' || active) && (
    <footer className="action-bar">
      <div className="action-bar-content">
        <div className="save-message" role="status">
          {!bridge && 'Open WinJoy as a desktop app to start a session.'}
          {active && session.phase !== 'running' && session.status}
          {session.phase === 'running' && !currentSession && (session.mode === 'host' ? 'Host session active' : 'Guest session active')}
        </div>
        {active ? <button key="stop" type="button" className="button button-secondary" disabled={pending || session.phase === 'stopping'}
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
          {page === 'host' && <><h1>Host a game</h1><p>Run Cuphead on this PC and connect two keyboards as separate Xbox controllers.</p></>}
          {page === 'guest' && <><h1>Join a game</h1><p>Use your keyboard as the second controller on your friend’s PC.</p></>}
          {page === 'controls' && <h1>Controls</h1>}
        </header>
        {error && <p className="session-error" role="alert">{error}</p>}
        {page === 'controls' && <Controls />}
        {page !== 'controls' && active && !currentSession && (
          <Section title="Session in progress" description="Stop your current session to switch between hosting and joining." />
        )}
        {page !== 'controls' && currentSession && session.phase === 'running' && (
          <SessionDetails session={session} onCopy={copyInvite} copied={copied} />
        )}
        {page === 'host' && (!active || (currentSession && session.phase !== 'running')) && (
          <HostSetup addresses={displayAddresses} networkPending={networkPending} bind={bind} setBind={setBind}
            port={hostPort} setPort={setHostPort} windowTitle={hostWindow} setWindowTitle={setHostWindow}
            onSubmit={startHost} locked={locked} />
        )}
        {page === 'guest' && (!active || (currentSession && session.phase !== 'running')) && (
          <GuestSetup invite={inviteText} setInvite={setInviteText} windowTitle={guestWindow} setWindowTitle={setGuestWindow}
            onSubmit={startGuest} locked={locked} />
        )}
      </div>
    </DesktopShell>
  )
}

createRoot(document.getElementById('root')).render(<App />)
