const { app, BrowserWindow, clipboard, ipcMain, net, protocol, session } = require('electron')
const { spawn } = require('node:child_process')
const { existsSync } = require('node:fs')
const { isIPv4 } = require('node:net')
const { networkInterfaces } = require('node:os')
const path = require('node:path')
const { createInterface } = require('node:readline')
const { pathToFileURL } = require('node:url')
const { launchUpdateInstaller } = require('./update-install.cjs')

const primaryInstance = app.requestSingleInstanceLock()
if (!primaryInstance) app.quit()

const scheme = 'desktop-ui'
const host = 'app'
const entryURL = `${scheme}://${host}/index.html`
const rendererDir = path.resolve(__dirname, '../dist/renderer')
const quitGraceMs = 15_000
const idle = {
  phase: 'idle', mode: null, status: 'Ready to host or join.',
  capture: null, connected: false, latencyMs: null, invite: null,
}
let state = idle
let activeWorker
let quitting = false
let updateWorker
let stagedInstaller
let installingUpdate = false
let updaterState = { phase: 'idle', currentVersion: app.getVersion(), status: 'WinJoy checks for updates when it starts.' }
const contentPolicy = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ')

protocol.registerSchemesAsPrivileged([
  { scheme, privileges: { standard: true, secure: true, supportFetchAPI: true } },
])

async function serveRenderer(request) {
  try {
    const url = new URL(request.url)
    if (url.hostname !== host || request.method !== 'GET') return new Response(null, { status: 404 })
    const filename = path.resolve(rendererDir, '.' + decodeURIComponent(url.pathname))
    const relative = path.relative(rendererDir, filename)
    if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
      return new Response(null, { status: 404 })
    }
    const response = await net.fetch(pathToFileURL(filename).href)
    if (relative !== 'index.html') return response
    const headers = new Headers(response.headers)
    headers.set('Content-Security-Policy', contentPolicy)
    return new Response(response.body, { status: response.status, headers })
  } catch {
    return new Response(null, { status: 404 })
  }
}

function windowFromEvent(event) {
  const frame = event.senderFrame
  if (!frame || frame !== event.sender.mainFrame || frame.url !== entryURL) return null
  return BrowserWindow.fromWebContents(event.sender)
}

function registerWindowActions() {
  ipcMain.on('window:minimize', event => windowFromEvent(event)?.minimize())
  ipcMain.on('window:close', event => windowFromEvent(event)?.close())
  ipcMain.handle('window:is-maximized', event => windowFromEvent(event)?.isMaximized() ?? false)
  ipcMain.handle('window:toggle-maximize', event => {
    const window = windowFromEvent(event)
    if (!window) return false
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
    return window.isMaximized()
  })
}

function updateState(patch) {
  state = { ...state, ...patch }
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('winjoy:state', state)
  }
}

function networkAddresses() {
  const addresses = new Map()
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    for (const { address, family, internal } of entries ?? []) {
      if (family !== 'IPv4' || internal || address === '0.0.0.0' || address.startsWith('169.254.')) continue
      addresses.set(address, { address, name })
    }
  }
  return [...addresses.values(), { address: '127.0.0.1', name: 'This PC only' }]
}

function normalizeHost(options) {
  const { bind, port } = options ?? {}
  if (typeof bind !== 'string' || !isIPv4(bind) || bind === '0.0.0.0') {
    throw new Error('Select a local network address to host on.')
  }
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error('Enter a port from 0 to 65535.')
  }
  return { mode: 'host', bind, port }
}

function normalizeGuest(options) {
  const { address, token } = options ?? {}
  if (typeof address !== 'string' || address.length > 1_024) throw new Error('Enter a host address.')
  const trimmed = address.trim()
  let url
  try {
    url = new URL(trimmed.includes('://') ? trimmed : `http://${trimmed}`)
  } catch {
    throw new Error('Enter a valid host address, such as http://192.168.1.10:4747.')
  }
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) ||
      !['/', '/input'].includes(url.pathname) || url.username || url.password || url.search || url.hash) {
    throw new Error('Use the WinJoy host address without a query, fragment, or username.')
  }
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{32}$/.test(token.trim())) {
    throw new Error('Enter the 32-character token from the host.')
  }
  return { mode: 'guest', address: url.href, token: token.trim() }
}

const bundledBin = path.join(process.resourcesPath, 'bin')
const bundledWorker = path.join(bundledBin, 'winjoy-worker.exe')

function spawnBunWorker() {
  const bundled = existsSync(bundledWorker)
  const command = bundled ? bundledWorker : process.env.WINJOY_BUN_EXE || 'bun'
  const args = bundled ? [] : [path.resolve(__dirname, '../src/worker.ts')]
  const env = { ...process.env }
  if (bundled && !env.WINJOY_VIGEM_DLL) env.WINJOY_VIGEM_DLL = path.join(bundledBin, 'ViGEmClient.dll')

  return spawn(command, args, { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
}

async function waitForChildExit(child, closed) {
  const timer = setTimeout(() => child.kill(), quitGraceMs)
  try {
    await closed
  } finally {
    clearTimeout(timer)
  }
}

function startWorker(options) {
  if (quitting || installingUpdate || activeWorker) throw new Error('Stop the current session before starting a new one.')
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('WinJoy requires Windows x64.')

  const child = spawnBunWorker()
  const worker = { child, stopping: false }
  activeWorker = worker
  updateState({ ...idle, mode: options.mode, phase: 'starting', status: 'Starting WinJoy…' })

  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
  lines.on('line', line => {
    if (activeWorker !== worker || worker.stopping) return
    let patch
    try {
      patch = JSON.parse(line)
    } catch {
      return
    }
    if (!patch || typeof patch !== 'object') return
    const changes = {}
    if (['running', 'error'].includes(patch.phase)) changes.phase = patch.phase
    if (typeof patch.status === 'string') changes.status = patch.status
    if (patch.capture === null || (typeof patch.capture?.enabled === 'boolean' &&
        typeof patch.capture?.active === 'boolean')) changes.capture = patch.capture
    if (typeof patch.connected === 'boolean') changes.connected = patch.connected
    if (patch.latencyMs === null || (Number.isFinite(patch.latencyMs) && patch.latencyMs >= 0)) changes.latencyMs = patch.latencyMs
    if (patch.invite === null || (typeof patch.invite?.address === 'string' &&
        typeof patch.invite?.token === 'string')) changes.invite = patch.invite
    if (Object.keys(changes).length) updateState(changes)
  })

  // The worker reports user-facing failures on stdout. Drain native diagnostics as well.
  child.stderr.resume()
  child.stdin.on('error', () => {})
  child.on('error', error => {
    if (activeWorker !== worker || worker.stopping) return
    const status = !existsSync(bundledWorker) && error.code === 'ENOENT'
      ? 'Bun 1.4.4 or newer is required. Install Bun or set WINJOY_BUN_EXE to its executable path.'
      : 'WinJoy could not start its background process.'
    updateState({ ...idle, mode: options.mode, phase: 'error', status })
  })

  worker.closed = new Promise(resolve => {
    child.once('close', code => {
      lines.close()
      if (activeWorker === worker) {
        activeWorker = undefined
        if (worker.stopping) updateState(idle)
        else {
          const status = state.phase === 'error'
            ? state.status
            : code === 0 ? 'The WinJoy session ended.' : 'The WinJoy background process stopped unexpectedly.'
          updateState({ ...idle, mode: options.mode, phase: 'error', status })
        }
      }
      resolve()
    })
  })

  child.stdin.write(JSON.stringify(options) + '\n')
  return state
}

async function stopWorker() {
  const worker = activeWorker
  if (!worker) {
    if (state.phase !== 'idle') updateState(idle)
    return state
  }
  if (!worker.stopping) {
    worker.stopping = true
    updateState({ ...idle, mode: state.mode, phase: 'stopping', status: 'Stopping WinJoy…' })
    worker.child.stdin.end()
  }
  await waitForChildExit(worker.child, worker.closed)
  return state
}

function publishUpdate({ phase, status, version, progress }) {
  updaterState = { phase, status, version, progress, currentVersion: app.getVersion() }
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('winjoy:update-state', updaterState)
  }
}

function updateDirectory() {
  return path.join(app.getPath('userData'), 'updates')
}

function checkForUpdates() {
  if (quitting || installingUpdate || updateWorker) return updaterState
  if (!existsSync(bundledWorker)) {
    publishUpdate({ phase: 'error', status: 'Open the packaged WinJoy app to check for updates.' })
    return updaterState
  }

  stagedInstaller = undefined
  const child = spawnBunWorker()
  const job = { child, closed: new Promise(resolve => child.once('close', resolve)) }
  updateWorker = job
  publishUpdate({ phase: 'checking', status: 'Checking GitHub for updates…' })
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
  let terminal = false
  lines.on('line', line => {
    let patch
    try { patch = JSON.parse(line) } catch { return }
    if (!patch || typeof patch.status !== 'string' || !['current', 'available', 'downloading', 'ready', 'error'].includes(patch.phase)) return
    if (patch.phase === 'ready') {
      const { installer } = patch
      if (!installer || typeof installer.path !== 'string' || typeof installer.sha256 !== 'string' || installer.version !== patch.version) return
      stagedInstaller = installer
    }
    terminal = ['current', 'ready', 'error'].includes(patch.phase)
    publishUpdate(patch)
  })
  child.stderr.resume()
  child.stdin.on('error', () => {})
  child.on('error', () => {})
  child.once('close', () => {
    lines.close()
    updateWorker = undefined
    if (!terminal && !quitting) publishUpdate({ phase: 'error', status: 'WinJoy could not finish checking for updates. Try again.' })
  })
  child.stdin.write(JSON.stringify({ mode: 'update', currentVersion: app.getVersion(), cacheDir: updateDirectory() }) + '\n')
  return updaterState
}

async function installUpdate() {
  if (installingUpdate || !stagedInstaller || updaterState.phase !== 'ready') throw new Error('There is no verified update ready to install.')
  installingUpdate = true
  try {
    if (activeWorker) await stopWorker()
    if (updateWorker) {
      const job = updateWorker
      job.child.stdin.end()
      await waitForChildExit(job.child, job.closed)
    }
    await launchUpdateInstaller(stagedInstaller, { stagingDirectory: updateDirectory() })
    app.quit()
  } catch (error) {
    installingUpdate = false
    throw error
  }
}

function registerWinJoyActions() {
  function handle(action, run) {
    ipcMain.handle(`winjoy:${action}`, (event, ...args) => {
      if (!windowFromEvent(event)) throw new Error('This action is only available in the WinJoy window.')
      return run(...args)
    })
  }

  handle('get-state', () => state)
  handle('get-addresses', networkAddresses)
  handle('start-local', () => startWorker({ mode: 'local' }))
  handle('start-host', options => startWorker(normalizeHost(options)))
  handle('start-guest', options => startWorker(normalizeGuest(options)))
  handle('stop', stopWorker)
  handle('get-update-state', () => updaterState)
  handle('check-for-updates', checkForUpdates)
  handle('install-update', installUpdate)
  handle('copy', text => {
    if (typeof text !== 'string' || text.length > 4_096) throw new Error('The text could not be copied.')
    clipboard.writeText(text)
  })
}

function createWindow() {
  const window = new BrowserWindow({
    title: 'WinJoy',
    width: 1210,
    height: 850,
    minWidth: 420,
    minHeight: 520,
    frame: false,
    show: false,
    backgroundColor: '#f5f7fb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  window.webContents.on('will-frame-navigate', event => event.preventDefault())
  window.once('ready-to-show', () => window.show())

  function reportMaximizeState() {
    if (!window.isDestroyed()) window.webContents.send('window:maximized-change', window.isMaximized())
  }
  window.on('maximize', reportMaximizeState)
  window.on('unmaximize', reportMaximizeState)
  window.loadURL(entryURL).catch(error => {
    console.error('Could not open WinJoy. Run bun run build first.', error)
    app.exit(1)
  })
}

app.whenReady().then(() => {
  if (!primaryInstance) return
  protocol.handle(scheme, serveRenderer)
  session.defaultSession.setPermissionCheckHandler(() => false)
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  registerWindowActions()
  registerWinJoyActions()
  createWindow()
  if (existsSync(bundledWorker)) setTimeout(checkForUpdates, 1500).unref()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('second-instance', () => {
  const [window] = BrowserWindow.getAllWindows()
  if (!window) return
  if (window.isMinimized()) window.restore()
  window.focus()
})

app.on('before-quit', event => {
  updateWorker?.child.stdin.end()
  if (!activeWorker) return
  event.preventDefault()
  if (quitting) return
  quitting = true
  const worker = activeWorker
  const forceQuit = setTimeout(() => {
    worker.child.kill()
    app.exit(1)
  }, quitGraceMs)
  void stopWorker().finally(() => {
    clearTimeout(forceQuit)
    app.quit()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
