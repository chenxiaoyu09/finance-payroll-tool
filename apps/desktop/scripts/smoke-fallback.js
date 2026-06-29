const { spawn } = require('node:child_process')
const fs = require('node:fs/promises')
const path = require('node:path')

const rootDir = path.resolve(__dirname, '..', '..', '..')
const serverDir = path.resolve(rootDir, 'apps/server')
const performanceSample = path.resolve(
  serverDir,
  'uploads/performance/1782650610986-5ebe956d-dfd4-4246-a9c6-536b6b97aa39.xlsx',
)
const salarySample = path.resolve(
  serverDir,
  'uploads/salary/1782650821258-62fdd0c0-5490-4991-bc12-614b158a82fe.xlsx',
)

const port = Number(process.env.SMOKE_PORT || 3015)
const baseUrl = `http://127.0.0.1:${port}/api`
const appDataDir = path.resolve('/private/tmp', 'finance-payroll-smoke-script')
const uploadDir = path.resolve(appDataDir, 'uploads')

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForHealth(retries = 40) {
  for (let index = 0; index < retries; index += 1) {
    try {
      const response = await fetch(`${baseUrl}/health`)
      if (response.ok) {
        return response.json()
      }
    } catch {
      // retry
    }
    await wait(500)
  }

  throw new Error('Smoke server health check timed out')
}

async function uploadExcel(category, filePath) {
  const fileBuffer = await fs.readFile(filePath)
  const form = new FormData()
  form.append('category', category)
  form.append(
    'file',
    new Blob([fileBuffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    path.basename(filePath),
  )

  const response = await fetch(`${baseUrl}/uploads/excel`, {
    method: 'POST',
    body: form,
  })

  if (!response.ok) {
    throw new Error(
      `Upload failed for ${category}: ${response.status} ${await response.text()}`,
    )
  }

  return response.json()
}

async function getJson(urlPath, init) {
  const response = await fetch(`${baseUrl}${urlPath}`, init)
  if (!response.ok) {
    throw new Error(
      `Request failed ${urlPath}: ${response.status} ${await response.text()}`,
    )
  }
  return response.json()
}

async function expectExcel(urlPath) {
  const response = await fetch(`${baseUrl}${urlPath}`)
  if (!response.ok) {
    throw new Error(
      `Export failed ${urlPath}: ${response.status} ${await response.text()}`,
    )
  }

  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('spreadsheetml.sheet')) {
    throw new Error(`Export ${urlPath} did not return xlsx content`)
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  if (!buffer.subarray(0, 2).equals(Buffer.from('PK'))) {
    throw new Error(`Export ${urlPath} did not return a valid zip/xlsx header`)
  }

  return {
    contentLength: Number(response.headers.get('content-length') || buffer.length),
  }
}

async function main() {
  await fs.rm(appDataDir, { recursive: true, force: true })

  const child = spawn('node', ['dist/main.js'], {
    cwd: serverDir,
    env: {
      ...process.env,
      DATABASE_URL: 'mysql://invalid:invalid@127.0.0.1:39999/invalid_db',
      APP_DATA_DIR: appDataDir,
      UPLOAD_DIR: uploadDir,
      APP_PORT: String(port),
      APP_HOST: '127.0.0.1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  child.stdout.on('data', (chunk) => {
    process.stdout.write(`[smoke-server] ${chunk}`)
  })

  child.stderr.on('data', (chunk) => {
    process.stderr.write(`[smoke-server] ${chunk}`)
  })

  try {
    const health = await waitForHealth()
    const performanceUpload = await uploadExcel('performance', performanceSample)
    const statusAfterPerformance = await getJson('/uploads/workflow-status')
    const confirmPerformance = await getJson('/uploads/performance/confirm', {
      method: 'POST',
    })
    const salaryUpload = await uploadExcel('salary', salarySample)
    const statusAfterSalary = await getJson('/uploads/workflow-status')
    const draft = await getJson('/uploads/payroll-draft')
    const performanceExport = await expectExcel('/uploads/performance-result/export')
    const performanceFillExport = await expectExcel(
      '/uploads/performance-template-fill/export',
    )
    const payrollDraftExport = await expectExcel('/uploads/payroll-draft/export')
    const payrollFillExport = await expectExcel(
      '/uploads/payroll-template-fill/export',
    )

    const summary = {
      health,
      performanceUpload: {
        id: performanceUpload.id,
        originalName: performanceUpload.originalName,
      },
      statusAfterPerformance,
      confirmPerformance,
      salaryUpload: {
        id: salaryUpload.id,
        originalName: salaryUpload.originalName,
      },
      statusAfterSalary,
      draftSummary: draft.summary,
      exports: {
        performanceExport,
        performanceFillExport,
        payrollDraftExport,
        payrollFillExport,
      },
      appDataDir,
    }

    process.stdout.write(`\nSMOKE_FALLBACK_OK\n${JSON.stringify(summary, null, 2)}\n`)
  } finally {
    child.kill()
  }
}

main().catch((error) => {
  console.error('\nSMOKE_FALLBACK_FAILED')
  console.error(error)
  process.exitCode = 1
})
