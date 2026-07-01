const { app, BrowserWindow, dialog } = require('electron')
const { spawn } = require('node:child_process')
const http = require('node:http')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { URL } = require('node:url')

const ROOT_DIR = path.resolve(__dirname, '..', '..')
const BUNDLE_DIR = app.isPackaged
  ? path.resolve(process.resourcesPath, 'bundle')
  : null
const SERVER_DIR = app.isPackaged
  ? path.resolve(process.resourcesPath, 'bundle')
  : path.resolve(ROOT_DIR, 'apps/server')
const SERVER_ENTRY = app.isPackaged
  ? path.resolve(BUNDLE_DIR, 'server-dist/main.js')
  : path.resolve(SERVER_DIR, 'dist/main.js')
const SERVER_RUNTIME = app.isPackaged ? process.execPath : 'node'
const WEB_DIST_DIR = app.isPackaged
  ? path.resolve(BUNDLE_DIR, 'web-dist')
  : path.resolve(ROOT_DIR, 'apps/web/dist')
const SERVER_PORT = Number(process.env.DESKTOP_SERVER_PORT || 3000)
const GATEWAY_PORT = Number(process.env.DESKTOP_GATEWAY_PORT || 5180)
const APP_DATA_DIR = app.getPath('userData')
const DESKTOP_UPLOAD_DIR = path.join(APP_DATA_DIR, 'uploads')
const DESKTOP_ENV_FILE = path.join(APP_DATA_DIR, 'desktop.env')
const RUNTIME_TEMPLATE_ENV = app.isPackaged
  ? path.resolve(BUNDLE_DIR, 'runtime-template.env')
  : path.resolve(__dirname, 'runtime-template.env')

let serverProcess = null
let gatewayServer = null
let usingExistingServer = false

function log(message) {
  const line = `[desktop] ${message}`
  console.log(line)
}

async function ensureDesktopRuntimeFiles() {
  await fsp.mkdir(APP_DATA_DIR, { recursive: true })
  await fsp.mkdir(DESKTOP_UPLOAD_DIR, { recursive: true })

  let envContent = [
    `APP_DATA_DIR=${APP_DATA_DIR}`,
    `UPLOAD_DIR=${DESKTOP_UPLOAD_DIR}`,
    `APP_HOST=127.0.0.1`,
    `APP_PORT=${SERVER_PORT}`,
    '',
  ].join('\n')

  if (fs.existsSync(RUNTIME_TEMPLATE_ENV)) {
    const template = await fsp.readFile(RUNTIME_TEMPLATE_ENV, 'utf8')
    envContent = template
      .replace(/^APP_DATA_DIR=.*$/m, `APP_DATA_DIR=${APP_DATA_DIR}`)
      .replace(/^UPLOAD_DIR=.*$/m, `UPLOAD_DIR=${DESKTOP_UPLOAD_DIR}`)
      .replace(/^APP_PORT=.*$/m, `APP_PORT=${SERVER_PORT}`)
      .replace(/^APP_HOST=.*$/m, 'APP_HOST=127.0.0.1')
  }

  await fsp.writeFile(DESKTOP_ENV_FILE, envContent, 'utf8')
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, (res) => resolve(res))
    req.on('error', reject)
    req.end()
  })
}

async function waitForHttpReady(url, retries = 60) {
  for (let index = 0; index < retries; index += 1) {
    try {
      const res = await request(url)
      res.resume()
      if (res.statusCode && res.statusCode < 500) {
        return
      }
    } catch {
      // Ignore and retry until timeout.
    }
    await wait(500)
  }

  throw new Error(`Service not ready: ${url}`)
}

async function isHttpReady(url) {
  try {
    const res = await request(url)
    res.resume()
    return Boolean(res.statusCode && res.statusCode < 500)
  } catch {
    return false
  }
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  const contentTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.ico': 'image/x-icon',
  }

  return contentTypes[ext] || 'application/octet-stream'
}

function sanitizeAssetPath(urlPath) {
  const cleanPath = decodeURIComponent(urlPath.split('?')[0])
  const normalized = path.normalize(cleanPath).replace(/^(\.\.[/\\])+/, '')
  return normalized === '/' ? '/index.html' : normalized
}

async function serveStaticFile(req, res) {
  const assetPath = sanitizeAssetPath(req.url || '/')
  const requestedPath = path.join(WEB_DIST_DIR, assetPath)
  const fallbackPath = path.join(WEB_DIST_DIR, 'index.html')

  const finalPath =
    fs.existsSync(requestedPath) && fs.statSync(requestedPath).isFile()
      ? requestedPath
      : fallbackPath

  const content = await fsp.readFile(finalPath)
  res.writeHead(200, { 'Content-Type': getContentType(finalPath) })
  res.end(content)
}

function proxyApiRequest(req, res) {
  const targetUrl = new URL(`http://127.0.0.1:${SERVER_PORT}${req.url}`)
  const proxyReq = http.request(
    targetUrl,
    {
      method: req.method,
      headers: req.headers,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 500, proxyRes.headers)
      proxyRes.pipe(res)
    },
  )

  proxyReq.on('error', (error) => {
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(
      JSON.stringify({
        message: '本地后端连接失败',
        detail: error.message,
      }),
    )
  })

  req.pipe(proxyReq)
}

async function startGatewayServer() {
  log(`Starting gateway on 127.0.0.1:${GATEWAY_PORT}`)

  if (!fs.existsSync(path.join(WEB_DIST_DIR, 'index.html'))) {
    throw new Error(
      '桌面端缺少前端构建产物，请先在 apps/web 执行 pnpm build。',
    )
  }

  gatewayServer = http.createServer(async (req, res) => {
    try {
      if ((req.url || '').startsWith('/api/')) {
        proxyApiRequest(req, res)
        return
      }

      await serveStaticFile(req, res)
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end(`Desktop gateway error: ${error.message}`)
    }
  })

  await new Promise((resolve, reject) => {
    gatewayServer.once('error', reject)
    gatewayServer.listen(GATEWAY_PORT, '127.0.0.1', resolve)
  })

  log(`Gateway ready on http://127.0.0.1:${GATEWAY_PORT}`)
}

function startLocalServer() {
  if (serverProcess) {
    return
  }

  log(`Starting bundled backend on 127.0.0.1:${SERVER_PORT}`)

  if (!fs.existsSync(SERVER_ENTRY)) {
    throw new Error(`桌面端缺少后端入口文件: ${SERVER_ENTRY}`)
  }

  serverProcess = spawn(
    SERVER_RUNTIME,
    [SERVER_ENTRY],
    {
      cwd: SERVER_DIR,
      env: {
        ...process.env,
        ...(app.isPackaged ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
        NODE_ENV: 'development',
        APP_PORT: String(SERVER_PORT),
        APP_HOST: '127.0.0.1',
        APP_DATA_DIR,
        UPLOAD_DIR: DESKTOP_UPLOAD_DIR,
        APP_ENV_FILE: DESKTOP_ENV_FILE,
      },
      stdio: 'pipe',
      windowsHide: true,
    },
  )

  serverProcess.on('error', (error) => {
    log(`Bundled backend failed to start: ${error.message}`)
    dialog.showErrorBox(
      '本地算薪后端启动失败',
      `无法启动内置后端：${error.message}\n\n通常这意味着应用打包不完整，或当前系统拦截了桌面程序创建本地服务进程。`,
    )
  })

  serverProcess.stdout.on('data', (chunk) => {
    process.stdout.write(`[desktop-server] ${chunk}`)
  })

  serverProcess.stderr.on('data', (chunk) => {
    process.stderr.write(`[desktop-server] ${chunk}`)
  })

  serverProcess.on('exit', (code) => {
    serverProcess = null
    if (code && code !== 0) {
      dialog.showErrorBox(
        '本地算薪后端已退出',
        `后端进程异常结束，退出码：${code}`,
      )
    }
  })
}

function stopLocalServer() {
  if (serverProcess) {
    serverProcess.kill()
    serverProcess = null
  }
}

async function stopGatewayServer() {
  if (!gatewayServer) {
    return
  }

  await new Promise((resolve) => gatewayServer.close(resolve))
  gatewayServer = null
}

async function createWindow() {
  await ensureDesktopRuntimeFiles()

  const healthUrl = `http://127.0.0.1:${SERVER_PORT}/api/health`
  log(`Checking backend health: ${healthUrl}`)
  usingExistingServer = await isHttpReady(healthUrl)

  if (!usingExistingServer) {
    startLocalServer()
  } else {
    log(`Reusing existing backend on 127.0.0.1:${SERVER_PORT}`)
  }

  await waitForHttpReady(healthUrl)
  await startGatewayServer()
  log('Creating desktop window')

  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1180,
    minHeight: 760,
    title: '财务算薪工具',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
    },
  })

  await window.loadURL(`http://127.0.0.1:${GATEWAY_PORT}`)
  log('Desktop window loaded')

  if (usingExistingServer) {
    window.webContents.once('did-finish-load', () => {
      log('Page finished loading with existing local backend')
    })
  }
}

process.on('uncaughtException', (error) => {
  console.error('[desktop] Uncaught exception:', error)
})

process.on('unhandledRejection', (error) => {
  console.error('[desktop] Unhandled rejection:', error)
})

app.whenReady().then(async () => {
  try {
    await createWindow()
  } catch (error) {
    dialog.showErrorBox(
      '桌面工具启动失败',
      `${error.message}\n\n请先确认：\n1. 应用文件完整，未从压缩包中缺失内容\n2. 首次打开时已在 macOS 安全提示中选择“仍要打开”\n3. 当前电脑允许应用在本地创建运行数据目录\n4. 如本机有 3000 端口占用，先关闭冲突程序后再试`,
    )
    app.quit()
  }

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow()
    }
  })
})

app.on('window-all-closed', async () => {
  await stopGatewayServer()
  stopLocalServer()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', async () => {
  await stopGatewayServer()
  stopLocalServer()
})
