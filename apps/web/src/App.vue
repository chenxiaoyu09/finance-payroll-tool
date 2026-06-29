<script setup lang="ts">
import { onMounted, ref } from 'vue'

type HealthResponse = {
  ok: boolean
  service: string
  timestamp: string
}

type UploadResponse = {
  id: string
  originalName: string
  category: string
  size: number
  guess: {
    label: string
  }
}

type PerformanceResultResponse = {
  performanceWorkbook: { originalName: string }
  summary: {
    employeeCount: number
    doctorCount: number
    staffCount: number
    totalPay: number
  }
}

type TemplateFillResponse = {
  salaryWorkbook: { originalName: string }
  performanceWorkbook: { originalName: string } | null
  targetSheetName: string
  summary: {
    employeeCount: number
    matchedCount: number
    unmatchedCount: number
  }
  unmatchedEmployees: string[]
}

type WorkflowStatusResponse = {
  performance: {
    uploaded: boolean
    confirmed: boolean
    uploadId: string | null
    fileName: string | null
    confirmedAt: string | null
  }
  salary: {
    uploaded: boolean
    uploadId: string | null
    fileName: string | null
  }
  nextStep: 'upload_performance' | 'confirm_performance' | 'upload_salary' | 'generate_payroll'
}

const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() || '/api'

const health = ref<HealthResponse | null>(null)
const healthLoading = ref(false)
const healthError = ref('')

const workflow = ref<WorkflowStatusResponse | null>(null)
const workflowLoading = ref(false)
const workflowError = ref('')

const performanceFile = ref<File | null>(null)
const salaryFile = ref<File | null>(null)
const performanceUploadLoading = ref(false)
const performanceUploadError = ref('')
const performanceUploadResult = ref<UploadResponse | null>(null)
const salaryUploadLoading = ref(false)
const salaryUploadError = ref('')
const salaryUploadResult = ref<UploadResponse | null>(null)

const performanceResultLoading = ref(false)
const performanceResultError = ref('')
const performanceResult = ref<PerformanceResultResponse | null>(null)
const confirmPerformanceLoading = ref(false)
const confirmPerformanceError = ref('')
const confirmPerformanceSuccess = ref('')

const templateFillLoading = ref(false)
const templateFillError = ref('')
const templateFill = ref<TemplateFillResponse | null>(null)

const exportLoading = ref(false)
const exportError = ref('')

const performanceFileLabel = ref('未选择文件')
const salaryFileLabel = ref('未选择文件')

function formatBytes(size: number) {
  if (size < 1024) return `${size} 字节`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(2)} MB`
}

function decodeName(value: string | null | undefined) {
  if (!value) return '未命名'

  const text = String(value)
  const looksMojibake =
    /[ÃÂÐÑÆËÎÏÕÖØÙÚÛÜÝÞßæçèéêëìíîïðñòóôõö÷øùúûü]/.test(text) ||
    /a¹|a»|a¼|é|è|ç|æ|ç»/.test(text)

  if (!looksMojibake) {
    return text
  }

  try {
    const repaired = decodeURIComponent(
      Array.from(text)
        .map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`)
        .join(''),
    )
    return repaired || text
  } catch {
    return text
  }
}

function getCategoryLabel(categoryKey: string) {
  const labels: Record<string, string> = {
    salary: '工资表',
    performance: '绩效表',
    attendance: '考勤表',
    social: '社保表',
    tax: '个税表',
    other: '其他资料',
  }
  return labels[categoryKey] || categoryKey
}

function formatDateTime(value: string | null) {
  if (!value) return '未确认'
  return value.replace('T', ' ').slice(0, 19)
}

async function readErrorMessage(response: Response, fallback: string) {
  try {
    const contentType = response.headers.get('content-type') || ''

    if (contentType.includes('application/json')) {
      const payload = await response.json()
      if (typeof payload?.message === 'string' && payload.message.trim()) {
        return payload.message.trim()
      }
      if (Array.isArray(payload?.message) && payload.message.length > 0) {
        return payload.message.join('；')
      }
      if (typeof payload?.error === 'string' && payload.error.trim()) {
        return payload.error.trim()
      }
    }

    const text = (await response.text()).trim()
    return text || fallback
  } catch {
    return fallback
  }
}

function setFile(event: Event, type: 'performance' | 'salary') {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0] || null
  if (type === 'performance') {
    performanceFile.value = file
    performanceFileLabel.value = file?.name || '未选择文件'
    confirmPerformanceSuccess.value = ''
    confirmPerformanceError.value = ''
  } else {
    salaryFile.value = file
    salaryFileLabel.value = file?.name || '未选择文件'
  }
}

async function fetchHealth() {
  healthLoading.value = true
  healthError.value = ''
  try {
    const response = await fetch(`${apiBase}/health`)
    if (!response.ok) throw new Error('health failed')
    health.value = await response.json()
  } catch {
    healthError.value = '后端健康检查失败，请确认 3000 端口服务已启动'
  } finally {
    healthLoading.value = false
  }
}

async function fetchWorkflow() {
  workflowLoading.value = true
  workflowError.value = ''
  try {
    const response = await fetch(`${apiBase}/uploads/workflow-status`)
    if (!response.ok) throw new Error('workflow failed')
    workflow.value = await response.json()
  } catch {
    workflowError.value = '读取流程状态失败，请稍后重试'
  } finally {
    workflowLoading.value = false
  }
}

async function submitUpload(type: 'performance' | 'salary') {
  const file = type === 'performance' ? performanceFile.value : salaryFile.value
  const loadingRef = type === 'performance' ? performanceUploadLoading : salaryUploadLoading
  const errorRef = type === 'performance' ? performanceUploadError : salaryUploadError
  const resultRef = type === 'performance' ? performanceUploadResult : salaryUploadResult

  errorRef.value = ''
  resultRef.value = null

  if (type === 'salary' && !workflow.value?.performance.confirmed) {
    errorRef.value = '请先确认绩效结果，再进入工资计算阶段'
    return
  }

  if (!file) {
    errorRef.value = '请先选择一个 .xlsx 文件'
    return
  }

  const formData = new FormData()
  formData.append('category', type)
  formData.append('file', file)

  loadingRef.value = true
  try {
    const response = await fetch(`${apiBase}/uploads/excel`, {
      method: 'POST',
      body: formData,
    })
    if (!response.ok) throw new Error('upload failed')
    resultRef.value = await response.json()
    if (type === 'performance') {
      performanceResult.value = null
      templateFill.value = null
      salaryUploadResult.value = null
      salaryFile.value = null
      salaryFileLabel.value = '未选择文件'
    }
    await fetchWorkflow()
  } catch {
    errorRef.value = '上传失败，请确认后端服务正常并上传 .xlsx 文件'
  } finally {
    loadingRef.value = false
  }
}

async function fetchPerformanceResultPreview() {
  performanceResultLoading.value = true
  performanceResultError.value = ''
  try {
    const response = await fetch(`${apiBase}/uploads/performance-result`)
    if (!response.ok) throw new Error('performance result failed')
    performanceResult.value = await response.json()
  } catch {
    performanceResultError.value = '生成绩效结果失败，请先上传绩效表'
  } finally {
    performanceResultLoading.value = false
  }
}

async function confirmPerformance() {
  confirmPerformanceLoading.value = true
  confirmPerformanceError.value = ''
  confirmPerformanceSuccess.value = ''
  try {
    const response = await fetch(`${apiBase}/uploads/performance/confirm`, {
      method: 'POST',
    })
    if (!response.ok) throw new Error('confirm failed')
    const result = await response.json()
    confirmPerformanceSuccess.value = `已确认：${decodeName(result.originalName)}`
    await fetchWorkflow()
  } catch {
    confirmPerformanceError.value = '确认绩效结果失败，请先生成并核对绩效结果'
  } finally {
    confirmPerformanceLoading.value = false
  }
}

async function fetchTemplateFillPreview() {
  templateFillLoading.value = true
  templateFillError.value = ''
  try {
    const response = await fetch(`${apiBase}/uploads/payroll-template-fill`)
    if (!response.ok) throw new Error('template fill failed')
    templateFill.value = await response.json()
  } catch {
    templateFillError.value = '生成工资表补空预览失败，请先确认绩效结果并上传工资表'
  } finally {
    templateFillLoading.value = false
  }
}

async function exportWorkbook(type: 'performance' | 'template') {
  exportLoading.value = true
  exportError.value = ''
  const map = {
    performance: 'performance-template-fill/export',
    template: 'payroll-template-fill/export',
  } as const
  try {
    const response = await fetch(`${apiBase}/uploads/${map[type]}`)
    if (!response.ok) {
      const fallback =
        type === 'performance'
          ? '导出绩效表失败，请先完成绩效计算'
          : '导出工资表失败，请先确认绩效并完成工资计算'
      throw new Error(await readErrorMessage(response, fallback))
    }
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download =
      type === 'performance' ? '绩效原表补空结果.xlsx' : '工资表原表补空结果.xlsx'
    a.click()
    URL.revokeObjectURL(url)
  } catch (error) {
    exportError.value =
      error instanceof Error && error.message.trim()
        ? error.message.trim()
        : '导出失败，请稍后重试'
  } finally {
    exportLoading.value = false
  }
}

onMounted(async () => {
  await Promise.all([fetchHealth(), fetchWorkflow()])
})
</script>

<template>
  <main class="shell">
    <section class="hero">
      <p class="eyebrow">财务算薪系统</p>
      <h1>两阶段算薪工作台</h1>
      <p class="hero-copy">先处理绩效表并确认结果，再进入工资表计算。保留两张原始表的使用习惯，导出时只回填空缺数据，不改原样式。</p>
    </section>

    <section class="grid">
      <article class="panel">
        <div class="panel-head">
          <div>
            <p class="panel-kicker">后端服务</p>
            <h2>服务状态</h2>
          </div>
          <button class="ghost-button" @click="fetchHealth" :disabled="healthLoading">
            {{ healthLoading ? '刷新中...' : '刷新状态' }}
          </button>
        </div>
        <p v-if="healthError" class="error">{{ healthError }}</p>
        <div v-else class="status-card">
          <span class="badge ok">已连通</span>
          <dl>
            <div>
              <dt>服务名</dt>
              <dd>{{ health?.service }}</dd>
            </div>
            <div>
              <dt>响应时间</dt>
              <dd>{{ health?.timestamp }}</dd>
            </div>
            <div>
              <dt>接口地址</dt>
              <dd><code>{{ apiBase }}/health</code></dd>
            </div>
          </dl>
        </div>
      </article>

      <article class="panel">
        <div class="panel-head">
          <div>
            <p class="panel-kicker">流程状态</p>
            <h2>当前进度</h2>
          </div>
          <button class="ghost-button" @click="fetchWorkflow" :disabled="workflowLoading">
            {{ workflowLoading ? '刷新中...' : '刷新流程' }}
          </button>
        </div>
        <p v-if="workflowError" class="error">{{ workflowError }}</p>
        <div v-else class="status-card">
          <dl>
            <div>
              <dt>绩效表</dt>
              <dd>{{ workflow?.performance.uploaded ? decodeName(workflow?.performance.fileName) : '未上传' }}</dd>
            </div>
            <div>
              <dt>绩效确认</dt>
              <dd>{{ workflow?.performance.confirmed ? `已确认（${formatDateTime(workflow?.performance.confirmedAt)})` : '未确认' }}</dd>
            </div>
            <div>
              <dt>工资表</dt>
              <dd>{{ workflow?.salary.uploaded ? decodeName(workflow?.salary.fileName) : '未上传' }}</dd>
            </div>
            <div>
              <dt>下一步</dt>
              <dd>
                {{
                  workflow?.nextStep === 'upload_performance'
                    ? '先上传绩效表'
                    : workflow?.nextStep === 'confirm_performance'
                      ? '确认绩效结果'
                      : workflow?.nextStep === 'upload_salary'
                        ? '上传工资表'
                        : '生成工资结果'
                }}
              </dd>
            </div>
          </dl>
        </div>
      </article>

      <article class="panel panel-full">
        <div class="panel-head">
          <div>
            <p class="panel-kicker">第一阶段</p>
            <h2>绩效处理</h2>
          </div>
          <div class="panel-actions">
            <button class="primary-button" @click="fetchPerformanceResultPreview" :disabled="performanceResultLoading">
              {{ performanceResultLoading ? '生成中...' : '生成绩效结果' }}
            </button>
            <button class="ghost-button" @click="confirmPerformance" :disabled="confirmPerformanceLoading || !performanceResult">
              {{ confirmPerformanceLoading ? '确认中...' : '确认用于工资计算' }}
            </button>
          </div>
        </div>

        <div class="phase-layout">
          <div class="upload-box">
            <strong>上传绩效原表</strong>
            <p>这一步只处理绩效计算，先补空绩效表并导出给财务核对。</p>
            <input type="file" accept=".xlsx" @change="(event) => setFile(event, 'performance')" />
            <span class="file-name">{{ performanceFileLabel }}</span>
            <button class="primary-button" @click="submitUpload('performance')" :disabled="performanceUploadLoading">
              {{ performanceUploadLoading ? '上传中...' : '上传绩效表' }}
            </button>
            <p v-if="performanceUploadError" class="error">{{ performanceUploadError }}</p>
            <div v-if="performanceUploadResult" class="result-card">
              <dl>
                <div>
                  <dt>文件名</dt>
                  <dd>{{ decodeName(performanceUploadResult.originalName) }}</dd>
                </div>
                <div>
                  <dt>分类</dt>
                  <dd>{{ getCategoryLabel(performanceUploadResult.category) }}</dd>
                </div>
                <div>
                  <dt>大小</dt>
                  <dd>{{ formatBytes(performanceUploadResult.size) }}</dd>
                </div>
                <div>
                  <dt>业务识别</dt>
                  <dd>{{ performanceUploadResult.guess.label }}</dd>
                </div>
              </dl>
            </div>
          </div>

          <div class="result-card stage-card">
            <p v-if="performanceResultError" class="error">{{ performanceResultError }}</p>
            <p v-if="confirmPerformanceError" class="error">{{ confirmPerformanceError }}</p>
            <p v-if="confirmPerformanceSuccess" class="success-text">{{ confirmPerformanceSuccess }}</p>

            <template v-if="performanceResult">
              <dl>
                <div>
                  <dt>绩效文件</dt>
                  <dd>{{ decodeName(performanceResult.performanceWorkbook.originalName) }}</dd>
                </div>
                <div>
                  <dt>员工人数</dt>
                  <dd>{{ performanceResult.summary.employeeCount }}</dd>
                </div>
                <div>
                  <dt>医生人数</dt>
                  <dd>{{ performanceResult.summary.doctorCount }}</dd>
                </div>
                <div>
                  <dt>工作人员人数</dt>
                  <dd>{{ performanceResult.summary.staffCount }}</dd>
                </div>
                <div>
                  <dt>本月工资合计</dt>
                  <dd>{{ performanceResult.summary.totalPay }}</dd>
                </div>
              </dl>
              <div class="actions">
                <button class="ghost-button" @click="exportWorkbook('performance')" :disabled="exportLoading">
                  {{ exportLoading ? '导出中...' : '导出绩效补空结果' }}
                </button>
              </div>
            </template>
            <p v-else class="hint">先上传绩效表，再生成并确认绩效结果。</p>
          </div>
        </div>
      </article>

      <article class="panel panel-full">
        <div class="panel-head">
          <div>
            <p class="panel-kicker">第二阶段</p>
            <h2>工资处理</h2>
          </div>
          <div class="panel-actions">
            <button class="primary-button" @click="fetchTemplateFillPreview" :disabled="templateFillLoading || !workflow?.performance.confirmed || !workflow?.salary.uploaded">
              {{ templateFillLoading ? '生成中...' : '生成工资结果' }}
            </button>
          </div>
        </div>

        <div class="phase-layout">
          <div class="upload-box" :class="{ disabled: !workflow?.performance.confirmed }">
            <strong>上传工资原表</strong>
            <p>只有在绩效结果确认后，工资阶段才会开放，系统会读取已确认的绩效结果进行计算。</p>
            <input type="file" accept=".xlsx" @change="(event) => setFile(event, 'salary')" :disabled="!workflow?.performance.confirmed" />
            <span class="file-name">{{ salaryFileLabel }}</span>
            <button class="primary-button" @click="submitUpload('salary')" :disabled="salaryUploadLoading || !workflow?.performance.confirmed">
              {{ salaryUploadLoading ? '上传中...' : '上传工资表' }}
            </button>
            <p v-if="salaryUploadError" class="error">{{ salaryUploadError }}</p>
            <div v-if="salaryUploadResult" class="result-card">
              <dl>
                <div>
                  <dt>文件名</dt>
                  <dd>{{ decodeName(salaryUploadResult.originalName) }}</dd>
                </div>
                <div>
                  <dt>分类</dt>
                  <dd>{{ getCategoryLabel(salaryUploadResult.category) }}</dd>
                </div>
                <div>
                  <dt>大小</dt>
                  <dd>{{ formatBytes(salaryUploadResult.size) }}</dd>
                </div>
                <div>
                  <dt>业务识别</dt>
                  <dd>{{ salaryUploadResult.guess.label }}</dd>
                </div>
              </dl>
            </div>
          </div>

          <div class="result-card stage-card">
            <p v-if="templateFillError" class="error">{{ templateFillError }}</p>
            <p v-if="exportError" class="error">{{ exportError }}</p>

            <template v-if="templateFill">
              <dl>
                <div>
                  <dt>工资原表</dt>
                  <dd>{{ decodeName(templateFill.salaryWorkbook.originalName) }}</dd>
                </div>
                <div>
                  <dt>绩效来源</dt>
                  <dd>{{ decodeName(templateFill.performanceWorkbook?.originalName) }}</dd>
                </div>
                <div>
                  <dt>回填目标表</dt>
                  <dd>{{ templateFill.targetSheetName }}</dd>
                </div>
                <div>
                  <dt>员工人数</dt>
                  <dd>{{ templateFill.summary.employeeCount }}</dd>
                </div>
                <div>
                  <dt>成功补空</dt>
                  <dd>{{ templateFill.summary.matchedCount }}</dd>
                </div>
                <div>
                  <dt>未补空</dt>
                  <dd>{{ templateFill.summary.unmatchedCount }}</dd>
                </div>
              </dl>
              <div class="actions">
                <button class="ghost-button" @click="exportWorkbook('template')" :disabled="exportLoading">
                  {{ exportLoading ? '导出中...' : '导出工资补空结果' }}
                </button>
              </div>
            </template>
            <p v-else class="hint">这一步会使用“已确认的绩效结果”，再去计算并回填工资原表。</p>
          </div>
        </div>
      </article>
    </section>
  </main>
</template>
