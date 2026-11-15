const { BrowserWindow, screen } = require('electron')

const width = 300
const height = 66
const feedbackDurationMs = 1500
let overlay
let overlayLoaded
let hideTimer
let feedbackId = 0

function soundDataUri(notes) {
  const rate = 16000
  const noteLength = Math.round(rate * 0.07)
  const gapLength = Math.round(rate * 0.012)
  const fadeLength = Math.round(rate * 0.008)
  const frames = notes.length * noteLength + (notes.length - 1) * gapLength
  const audioBytes = frames * 2
  const audio = Buffer.alloc(44 + audioBytes)

  audio.write('RIFF', 0)
  audio.writeUInt32LE(36 + audioBytes, 4)
  audio.write('WAVEfmt ', 8)
  audio.writeUInt32LE(16, 16)
  audio.writeUInt16LE(1, 20)
  audio.writeUInt16LE(1, 22)
  audio.writeUInt32LE(rate, 24)
  audio.writeUInt32LE(rate * 2, 28)
  audio.writeUInt16LE(2, 32)
  audio.writeUInt16LE(16, 34)
  audio.write('data', 36)
  audio.writeUInt32LE(audioBytes, 40)

  for (const [index, frequency] of notes.entries()) {
    const start = index * (noteLength + gapLength)
    for (let frame = 0; frame < noteLength; frame++) {
      const envelope = Math.min(1, frame / fadeLength, (noteLength - frame - 1) / fadeLength)
      const sample = Math.sin(2 * Math.PI * frequency * frame / rate) * envelope
      audio.writeInt16LE(Math.round(sample * 6200), 44 + (start + frame) * 2)
    }
  }

  return `data:audio/wav;base64,${audio.toString('base64')}`
}

const overlayHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; media-src data:">
  <title>WinJoy keyboard capture</title>
  <style>
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; background: transparent; margin: 0; overflow: hidden; }
    body { display: grid; place-items: center; font: 600 16px "Segoe UI Variable Text", "Segoe UI", sans-serif; }
    .feedback { display: flex; align-items: center; gap: 11px; padding: 0 18px; width: calc(100% - 8px); height: calc(100% - 8px); border: 1px solid #404c60; border-radius: 13px; color: #fff; background: #182234; }
    .indicator { width: 10px; height: 10px; border-radius: 50%; background: #ffd18a; flex: 0 0 auto; }
    [data-capture="on"] .indicator { background: #68e1c6; }
  </style>
</head>
<body>
  <div class="feedback">
    <span class="indicator" aria-hidden="true"></span>
    <span id="message" role="status"></span>
  </div>
  <audio id="on-sound" preload="auto" src="${soundDataUri([660, 880])}"></audio>
  <audio id="paused-sound" preload="auto" src="${soundDataUri([494, 370])}"></audio>
  <script>
    let previousSound;
    window.setCaptureFeedback = (enabled) => {
      const capture = enabled ? 'on' : 'paused';
      document.documentElement.dataset.capture = capture;
      document.getElementById('message').textContent = enabled ? 'Keyboard capture ON' : 'Keyboard capture PAUSED';
      if (previousSound) previousSound.pause();
      const sound = document.getElementById(capture + '-sound');
      previousSound = sound;
      sound.currentTime = 0;
      void sound.play().catch(() => {});
    };
  </script>
</body>
</html>`

function openOverlay() {
  if (overlay && !overlay.isDestroyed()) return overlayLoaded

  const window = new BrowserWindow({
    width,
    height,
    title: 'WinJoy keyboard capture',
    frame: false,
    transparent: true,
    resizable: false,
    hasShadow: false,
    show: false,
    focusable: false,
    skipTaskbar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      autoplayPolicy: 'no-user-gesture-required',
      backgroundThrottling: false,
      focusOnNavigation: false,
    },
  })
  overlay = window
  window.setIgnoreMouseEvents(true)
  window.setAlwaysOnTop(true, 'pop-up-menu')
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  window.once('closed', () => {
    if (overlay !== window) return
    clearTimeout(hideTimer)
    overlay = undefined
    overlayLoaded = undefined
  })
  overlayLoaded = window.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(overlayHtml)}`).then(
    () => window,
    error => {
      if (!window.isDestroyed()) window.destroy()
      throw error
    },
  )
  return overlayLoaded
}

async function showCaptureFeedback(enabled) {
  const id = ++feedbackId
  try {
    const window = await openOverlay()
    if (id !== feedbackId || window.isDestroyed()) return
    const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const x = workArea.x + Math.round((workArea.width - width) / 2)
    window.setPosition(x, workArea.y + 24)
    await window.webContents.executeJavaScript(`window.setCaptureFeedback(${enabled === true})`)
    if (id !== feedbackId || window.isDestroyed()) return

    window.showInactive()
    clearTimeout(hideTimer)
    hideTimer = setTimeout(() => {
      if (!window.isDestroyed()) window.hide()
    }, feedbackDurationMs)
  } catch (error) {
    if (id === feedbackId) console.warn('Could not display WinJoy capture feedback.', error)
  }
}

function closeCaptureFeedback() {
  feedbackId++
  clearTimeout(hideTimer)
  if (overlay && !overlay.isDestroyed()) overlay.destroy()
}

module.exports = { showCaptureFeedback, closeCaptureFeedback }
