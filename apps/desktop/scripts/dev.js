const { spawn } = require('node:child_process')
const path = require('node:path')

const desktopDir = path.resolve(__dirname, '..')
const rootDir = path.resolve(desktopDir, '..', '..')
const serverDir = path.resolve(rootDir, 'apps/server')
const webDir = path.resolve(rootDir, 'apps/web')

function run(command, args, cwd, extraEnv = {}) {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...extraEnv },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })

  return child
}

const server = run('pnpm', ['dev'], serverDir)
const web = run('pnpm', ['dev'], webDir, {
  VITE_API_PROXY_TARGET: 'http://127.0.0.1:3000',
})
const desktop = run('npx', ['electron', '.'], desktopDir)

function shutdown() {
  server.kill()
  web.kill()
  desktop.kill()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
