const { spawn } = require('node:child_process')
const { createHash } = require('node:crypto')
const { createReadStream } = require('node:fs')
const { lstat, realpath } = require('node:fs/promises')
const path = require('node:path')

async function launchUpdateInstaller(candidate, { stagingDirectory, spawnChild = spawn }) {
  const { path: stagedPath, sha256, version } = candidate
  if (typeof version !== 'string' || !/^v?\d+\.\d+\.\d+$/.test(version)) {
    throw new Error('The update has an invalid version.')
  }
  if (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error('The update checksum is missing or invalid.')
  }
  if (typeof stagedPath !== 'string' || typeof stagingDirectory !== 'string' ||
      !path.isAbsolute(stagedPath) || !path.isAbsolute(stagingDirectory)) {
    throw new Error('The update installer path is invalid.')
  }

  const directory = await realpath(stagingDirectory)
  const installer = await realpath(stagedPath)
  const assetName = `WinJoy-Setup-${version.replace(/^v/, '')}-x64.exe`
  if (path.relative(path.join(directory, assetName), installer) || !(await lstat(stagedPath)).isFile()) {
    throw new Error('The update installer does not match the staged WinJoy release.')
  }

  const hash = createHash('sha256')
  for await (const chunk of createReadStream(installer)) hash.update(chunk)
  if (hash.digest('hex') !== sha256) {
    throw new Error('The installer checksum changed. Download the update again.')
  }

  await new Promise((resolve, reject) => {
    const child = spawnChild(installer, [`/WAITPID=${process.pid}`], {
      cwd: directory,
      detached: true,
      shell: false,
      stdio: 'ignore',
      // NSIS is a GUI executable. Its wizard needs to appear after the PID wait.
      windowsHide: false,
    })
    child.once('error', error => reject(new Error('Could not launch the update installer. Try again.', { cause: error })))
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

module.exports = { launchUpdateInstaller }
