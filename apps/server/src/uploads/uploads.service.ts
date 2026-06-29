import {
  BadRequestException,
  Logger,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

type WorkbookSheetSummary = {
  name: string;
  rowCount: number;
  columnCount: number;
  headers: string[];
};

type ParsedSheetPreview = WorkbookSheetSummary & {
  detectedHeaderRow: number | null;
  sampleRows: Array<Record<string, string>>;
};

type FieldMappingPreview = {
  targetField: string;
  matchedSheet: string;
  matchedHeader: string;
  confidence: 'high' | 'medium' | 'low';
};

type NormalizedFieldPreview = FieldMappingPreview & {
  sampleValues: string[];
};

type PayrollDraftRow = {
  employeeName: string;
  department: string;
  position: string;
  baseSalary: number;
  salaryPerformanceSalary: number;
  mergedPerformanceSalary: number;
  performanceSalary: number;
  salaryCommissionSalary: number;
  mergedCommissionSalary: number;
  commissionSalary: number;
  salaryAllowance: number;
  mergedAllowance: number;
  allowance: number;
  socialSecurity: number;
  housingFund: number;
  tax: number;
  grossPay: number;
  deductions: number;
  netPayDraft: number;
  sources: string[];
  anomalies: string[];
  detailBuckets: Array<{
    title: string;
    items: Array<{
      label: string;
      value: string | number;
    }>;
  }>;
  reconciliation: Array<{
    field: string;
    finalValue: number;
    rule: string;
    salaryValue: number;
    performanceValue: number;
    sourceLabel: string;
  }>;
};

type PayrollFieldRuleKey =
  | 'performanceSalary'
  | 'commissionSalary'
  | 'allowance';

type ManualSalaryFixedCell = {
  rowNumber: number;
  columnNumber: number;
  value: ExcelJS.CellValue;
};

type PayrollFieldRule = {
  key: PayrollFieldRuleKey;
  label: string;
  priority: Array<'performance' | 'salary'>;
};

type PayrollDraftResult = {
  salaryWorkbook: {
    id: string;
    originalName: string;
  };
  performanceWorkbook: {
    id: string;
    originalName: string;
  } | null;
  summary: {
    employeeCount: number;
    totalGrossPay: number;
    totalDeductions: number;
    totalNetPayDraft: number;
    anomalyCount: number;
  };
  rules: Array<{
    key: string;
    label: string;
    priority: Array<'performance' | 'salary'>;
  }>;
  previewRows: PayrollDraftRow[];
  allRows: PayrollDraftRow[];
};

type TemplateFillRow = {
  employeeName: string;
  department: string;
  position: string;
  baseSalary: number;
  commissionSalary: number;
  performanceSalary: number;
  bonus: number;
  allowance: number;
  sourceSheet: string;
  targetRowNumber: number | null;
};

type TemplateFillResult = {
  salaryWorkbook: {
    id: string;
    originalName: string;
  };
  performanceWorkbook: {
    id: string;
    originalName: string;
  } | null;
  targetSheetName: string;
  monthSheetName: string | null;
  summary: {
    employeeCount: number;
    matchedCount: number;
    unmatchedCount: number;
    totalBaseSalary: number;
    totalCommissionSalary: number;
    totalPerformanceSalary: number;
    totalBonus: number;
    totalAllowance: number;
  };
  allRows: TemplateFillRow[];
  previewRows: TemplateFillRow[];
  unmatchedEmployees: string[];
};

type PerformanceResultRow = {
  employeeName: string;
  department: string;
  employeeType: 'doctor' | 'staff';
  baseSalary: number;
  commissionSalary: number;
  performanceSalary: number;
  bonus: number;
  allowance: number;
  totalPay: number;
  sourceSheet: string;
};

type PerformanceResult = {
  performanceWorkbook: {
    id: string;
    originalName: string;
  };
  summary: {
    employeeCount: number;
    doctorCount: number;
    staffCount: number;
    totalBaseSalary: number;
    totalCommissionSalary: number;
    totalPerformanceSalary: number;
    totalBonus: number;
    totalAllowance: number;
    totalPay: number;
  };
  previewRows: PerformanceResultRow[];
  allRows: PerformanceResultRow[];
};

type PerformanceTemplateFillPreviewRow = {
  employeeName: string;
  employeeType: 'doctor' | 'staff';
  sheetName: string;
  rowNumber: number;
  baseSalary: number;
  commissionSalary: number;
  performanceSalary: number;
  bonus: number;
  allowance: number;
  totalPay: number;
};

type PerformanceTemplateFillResult = {
  performanceWorkbook: {
    id: string;
    originalName: string;
  };
  summary: {
    employeeCount: number;
    doctorMatchedCount: number;
    staffMatchedCount: number;
    totalPay: number;
  };
  allRows: PerformanceTemplateFillPreviewRow[];
  previewRows: PerformanceTemplateFillPreviewRow[];
};

type FooterRowMarkers = {
  totalRowNumber: number | null;
  checkRowNumber: number | null;
  balanceRowNumber: number | null;
};

type WorkflowState = {
  confirmedPerformanceUploadId: string | null;
  confirmedAt: string | null;
};

type SalaryMonthAuxiliaryData = {
  standardWorkDays: number;
  actualPaidDays: number;
  mealFee: number;
  employerSocialSecurity: number;
  socialSecurity: number;
  companyHousingFund: number;
  housingFund: number;
  tax: number;
};

const SALARY_MONTH_SPECIAL_BLANK_COMMISSION_NAMES = new Set([
  '郝联珍',
  '郭晓薇',
]);

const SALARY_MONTH_PERFORMANCE_FROM_COMMISSION_NAMES = new Set([
  '郭晓薇',
]);

const SALARY_MONTH_COMMISSION_SHARED_RULES: Record<string, string[]> = {
  席玉新: ['席云霞', '侯桂香'],
  郭发澄: ['郭有贞', '郭晓薇'],
  叶晨: ['叶再福'],
  吴敬都: ['黄宇榕', '张秀珠'],
  袁孝胜: ['崔春霞', '秦方方'],
  林惠强: ['林兰霞'],
};

// Monthly salary sheet keeps most business values as direct inputs.
// Only the subtotal/result columns should inherit formulas from a template.
const MONTH_SALARY_FORMULA_COLUMNS = [15, 17, 18, 21, 27];

type UploadRecord = {
  id: bigint;
  originalName: string;
  storedName: string;
  mimeType: string;
  size: number;
  category: string;
  filePath: string;
  createdAt: Date;
};

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);
  private readonly appDataDir: string;
  private readonly uploadRootDir: string;
  private readonly workflowStateFile: string;
  private readonly payrollFieldRules: PayrollFieldRule[] = [
    {
      key: 'performanceSalary',
      label: '绩效工资',
      priority: ['performance', 'salary'],
    },
    {
      key: 'commissionSalary',
      label: '抽成工资',
      priority: ['performance', 'salary'],
    },
    {
      key: 'allowance',
      label: '补贴',
      priority: ['performance', 'salary'],
    },
  ];

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.appDataDir =
      this.configService.get<string>('APP_DATA_DIR') || process.cwd();
    this.uploadRootDir =
      this.configService.get<string>('UPLOAD_DIR') ||
      join(this.appDataDir, 'uploads');
    this.workflowStateFile = join(
      this.uploadRootDir,
      'workflow-state.json',
    );
  }

  async saveFile(
    file: Express.Multer.File | undefined,
    category: string,
  ) {
    if (!file) {
      throw new BadRequestException('file is required');
    }

    const normalizedOriginalName = this.normalizeUploadedFileName(
      file.originalname,
    );

    if (!normalizedOriginalName.toLowerCase().endsWith('.xlsx')) {
      throw new BadRequestException('only .xlsx files are supported currently');
    }

    const targetDir = join(this.uploadRootDir, category);
    await mkdir(targetDir, { recursive: true });

    const storedName = `${Date.now()}-${randomUUID()}.xlsx`;
    const filePath = join(targetDir, storedName);

    try {
      await writeFile(filePath, file.buffer);
    } catch (error) {
      throw new InternalServerErrorException('failed to persist uploaded file');
    }

    const saved = await this.prisma.uploadFileCreate({
      data: {
        originalName: normalizedOriginalName,
        storedName,
        mimeType:
          file.mimetype ||
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        size: file.size,
        category,
        filePath,
      },
    });

    let sheets: ParsedSheetPreview[];
    try {
      sheets = await this.extractWorkbookSummary(filePath);
    } catch (error) {
      this.logger.error(
        `failed to parse workbook: ${filePath}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new InternalServerErrorException('failed to parse workbook');
    }

    if (category === 'performance') {
      await this.writeWorkflowState({
        confirmedPerformanceUploadId: null,
        confirmedAt: null,
      });
    }

    return {
      id: saved.id.toString(),
      originalName: this.normalizeUploadedFileName(saved.originalName),
      storedName: saved.storedName,
      category: saved.category,
      size: saved.size,
      filePath: saved.filePath,
      createdAt: saved.createdAt,
      workbook: {
        sheetCount: sheets.length,
        sheets,
      },
      guess: this.guessBusinessType(category, sheets),
      fieldMappings: this.buildFieldMappings(category, sheets),
      normalizedPreview: this.buildNormalizedPreview(category, sheets),
    };
  }

  async listUploads() {
    const uploads = await this.prisma.uploadFileFindMany({
      orderBy: {
        createdAt: 'desc',
      },
      take: 20,
    });

    return uploads.map((item) => ({
      id: item.id.toString(),
      originalName: this.normalizeUploadedFileName(item.originalName),
      storedName: item.storedName,
      category: item.category,
      size: item.size,
      filePath: item.filePath,
      createdAt: item.createdAt,
    }));
  }

  async getWorkflowStatus() {
    const latestPerformance = await this.prisma.uploadFileFindFirst({
      where: { category: 'performance' },
      orderBy: { createdAt: 'desc' },
    });
    const latestSalary = await this.prisma.uploadFileFindFirst({
      where: { category: 'salary' },
      orderBy: { createdAt: 'desc' },
    });
    const state = await this.readWorkflowState();

    const performanceConfirmed =
      Boolean(latestPerformance) &&
      state.confirmedPerformanceUploadId === latestPerformance?.id.toString();

    return {
      performance: {
        uploaded: Boolean(latestPerformance),
        confirmed: performanceConfirmed,
        uploadId: latestPerformance?.id.toString() || null,
        fileName: latestPerformance
          ? this.normalizeUploadedFileName(latestPerformance.originalName)
          : null,
        confirmedAt: performanceConfirmed ? state.confirmedAt : null,
      },
      salary: {
        uploaded: Boolean(latestSalary),
        uploadId: latestSalary?.id.toString() || null,
        fileName: latestSalary
          ? this.normalizeUploadedFileName(latestSalary.originalName)
          : null,
      },
      nextStep: !latestPerformance
        ? 'upload_performance'
        : !performanceConfirmed
          ? 'confirm_performance'
          : !latestSalary
            ? 'upload_salary'
            : 'generate_payroll',
    };
  }

  async confirmPerformanceResult() {
    const latestPerformance = await this.prisma.uploadFileFindFirst({
      where: { category: 'performance' },
      orderBy: { createdAt: 'desc' },
    });

    if (!latestPerformance) {
      throw new BadRequestException('performance workbook is required before confirmation');
    }

    const state = {
      confirmedPerformanceUploadId: latestPerformance.id.toString(),
      confirmedAt: new Date().toISOString(),
    };
    await this.writeWorkflowState(state);

    return {
      ok: true,
      performanceUploadId: state.confirmedPerformanceUploadId,
      confirmedAt: state.confirmedAt,
      originalName: this.normalizeUploadedFileName(latestPerformance.originalName),
    };
  }

  async buildPayrollDraft() {
    const draft = await this.buildPayrollDraftResult();

    return {
      salaryWorkbook: draft.salaryWorkbook,
      performanceWorkbook: draft.performanceWorkbook,
      summary: draft.summary,
      rules: draft.rules,
      previewRows: draft.previewRows,
    };
  }

  async exportPayrollDraftWorkbook() {
    const draft = await this.buildPayrollDraftResult();
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Codex Finance Payroll Tool';
    workbook.created = new Date();

    const summarySheet = workbook.addWorksheet('算薪汇总');
    summarySheet.columns = [
      { header: '指标', key: 'label', width: 20 },
      { header: '值', key: 'value', width: 24 },
    ];
    summarySheet.addRows([
      { label: '工资表文件', value: draft.salaryWorkbook.originalName },
      {
        label: '绩效表文件',
        value: draft.performanceWorkbook?.originalName || '未上传',
      },
      { label: '员工人数', value: draft.summary.employeeCount },
      { label: '应发合计', value: draft.summary.totalGrossPay },
      { label: '扣减合计', value: draft.summary.totalDeductions },
      { label: '实发草稿合计', value: draft.summary.totalNetPayDraft },
      { label: '异常人数', value: draft.summary.anomalyCount },
    ]);

    const detailSheet = workbook.addWorksheet('算薪明细');
    detailSheet.columns = [
      { header: '姓名', key: 'employeeName', width: 14 },
      { header: '部门', key: 'department', width: 18 },
      { header: '岗位', key: 'position', width: 18 },
      { header: '岗位薪资', key: 'baseSalary', width: 14 },
      { header: '绩效工资', key: 'performanceSalary', width: 14 },
      { header: '绩效来源', key: 'performanceSource', width: 18 },
      { header: '抽成工资', key: 'commissionSalary', width: 14 },
      { header: '抽成来源', key: 'commissionSource', width: 18 },
      { header: '补贴', key: 'allowance', width: 14 },
      { header: '补贴来源', key: 'allowanceSource', width: 18 },
      { header: '社保', key: 'socialSecurity', width: 14 },
      { header: '公积金', key: 'housingFund', width: 14 },
      { header: '税额估算', key: 'tax', width: 14 },
      { header: '应发合计', key: 'grossPay', width: 14 },
      { header: '扣减合计', key: 'deductions', width: 14 },
      { header: '实发草稿', key: 'netPayDraft', width: 14 },
      { header: '异常提示', key: 'anomalies', width: 48 },
    ];

    draft.allRows.forEach((row) => {
      const performanceRule = row.reconciliation.find(
        (item) => item.field === 'performanceSalary',
      );
      const commissionRule = row.reconciliation.find(
        (item) => item.field === 'commissionSalary',
      );
      const allowanceRule = row.reconciliation.find(
        (item) => item.field === 'allowance',
      );

      detailSheet.addRow({
        employeeName: row.employeeName,
        department: row.department || '-',
        position: row.position || '-',
        baseSalary: row.baseSalary,
        performanceSalary: row.performanceSalary,
        performanceSource: performanceRule?.sourceLabel || '',
        commissionSalary: row.commissionSalary,
        commissionSource: commissionRule?.sourceLabel || '',
        allowance: row.allowance,
        allowanceSource: allowanceRule?.sourceLabel || '',
        socialSecurity: row.socialSecurity,
        housingFund: row.housingFund,
        tax: row.tax,
        grossPay: row.grossPay,
        deductions: row.deductions,
        netPayDraft: row.netPayDraft,
        anomalies: row.anomalies.join('；') || '正常',
      });
    });

    const ruleSheet = workbook.addWorksheet('取值规则');
    ruleSheet.columns = [
      { header: '字段', key: 'label', width: 18 },
      { header: '优先级', key: 'priority', width: 24 },
    ];
    draft.rules.forEach((rule) => {
      ruleSheet.addRow({
        label: rule.label,
        priority: rule.priority
          .map((item) => (item === 'performance' ? '绩效表' : '工资表'))
          .join(' > '),
      });
    });

    [summarySheet, detailSheet, ruleSheet].forEach((sheet) => {
      const headerRow = sheet.getRow(1);
      headerRow.font = { bold: true };
      headerRow.eachCell((cell) => {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFE8F0DD' },
        };
        cell.border = {
          bottom: { style: 'thin', color: { argb: 'FFD0D5DD' } },
        };
      });
      sheet.views = [{ state: 'frozen', ySplit: 1 }];
    });

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  async exportPayrollAnomalyWorkbook() {
    const draft = await this.buildPayrollDraftResult();
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Codex Finance Payroll Tool';
    workbook.created = new Date();

    const anomalyRows = draft.allRows.filter((row) => row.anomalies.length > 0);
    const sheet = workbook.addWorksheet('异常名单');
    sheet.columns = [
      { header: '姓名', key: 'employeeName', width: 14 },
      { header: '部门', key: 'department', width: 18 },
      { header: '岗位', key: 'position', width: 18 },
      { header: '实发草稿', key: 'netPayDraft', width: 16 },
      { header: '异常数量', key: 'anomalyCount', width: 12 },
      { header: '异常详情', key: 'anomalies', width: 64 },
    ];

    anomalyRows.forEach((row) => {
      sheet.addRow({
        employeeName: row.employeeName,
        department: row.department || '-',
        position: row.position || '-',
        netPayDraft: row.netPayDraft,
        anomalyCount: row.anomalies.length,
        anomalies: row.anomalies.join('；'),
      });
    });

    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFBE6E3' },
      };
    });
    sheet.views = [{ state: 'frozen', ySplit: 1 }];

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  async exportPayrollSlipWorkbook() {
    const draft = await this.buildPayrollDraftResult();
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Codex Finance Payroll Tool';
    workbook.created = new Date();

    draft.allRows.forEach((row) => {
      const sheetName = this.safeWorksheetName(row.employeeName);
      const sheet = workbook.addWorksheet(sheetName);
      const performanceRule = row.reconciliation.find(
        (item) => item.field === 'performanceSalary',
      );
      const commissionRule = row.reconciliation.find(
        (item) => item.field === 'commissionSalary',
      );
      const allowanceRule = row.reconciliation.find(
        (item) => item.field === 'allowance',
      );

      sheet.columns = [
        { width: 18 },
        { width: 22 },
        { width: 18 },
        { width: 22 },
      ];

      sheet.mergeCells('A1:D1');
      sheet.getCell('A1').value = '员工工资单';
      sheet.getCell('A1').font = { size: 16, bold: true };
      sheet.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };

      const rows = [
        ['姓名', row.employeeName, '部门', row.department || '-'],
        ['岗位', row.position || '-', '岗位薪资', row.baseSalary],
        ['绩效工资', row.performanceSalary, '绩效来源', performanceRule?.sourceLabel || '-'],
        ['抽成工资', row.commissionSalary, '抽成来源', commissionRule?.sourceLabel || '-'],
        ['补贴', row.allowance, '补贴来源', allowanceRule?.sourceLabel || '-'],
        ['社保', row.socialSecurity, '公积金', row.housingFund],
        ['税额估算', row.tax, '扣减合计', row.deductions],
        ['应发合计', row.grossPay, '实发草稿', row.netPayDraft],
        ['异常提示', row.anomalies.join('；') || '正常', '', ''],
      ];

      rows.forEach((item, index) => {
        const excelRow = sheet.getRow(index + 3);
        excelRow.getCell(1).value = item[0];
        excelRow.getCell(2).value = item[1];
        excelRow.getCell(3).value = item[2];
        excelRow.getCell(4).value = item[3];
      });

      for (let rowNumber = 3; rowNumber <= 11; rowNumber += 1) {
        for (let column = 1; column <= 4; column += 1) {
          const cell = sheet.getRow(rowNumber).getCell(column);
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFD0D5DD' } },
            left: { style: 'thin', color: { argb: 'FFD0D5DD' } },
            bottom: { style: 'thin', color: { argb: 'FFD0D5DD' } },
            right: { style: 'thin', color: { argb: 'FFD0D5DD' } },
          };
          if (column === 1 || column === 3) {
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFE8F0DD' },
            };
            cell.font = { bold: true };
          }
        }
      }
    });

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  async buildTemplateFillPreview() {
    await this.ensureConfirmedPerformanceReady();
    const result = await this.buildTemplateFillResult();

    return {
      salaryWorkbook: result.salaryWorkbook,
      performanceWorkbook: result.performanceWorkbook,
      targetSheetName: result.targetSheetName,
      monthSheetName: result.monthSheetName,
      summary: result.summary,
      previewRows: result.previewRows,
      unmatchedEmployees: result.unmatchedEmployees,
    };
  }

  async exportFilledSalaryWorkbook() {
    this.logger.log('exportFilledSalaryWorkbook:start');
    await this.ensureConfirmedPerformanceReady();
    const { latestSalary, result, performanceUpload } =
      await this.prepareTemplateWorkbook();
    this.logger.log('exportFilledSalaryWorkbook:templatePrepared');
    const manualFixedCells = await this.snapshotManualSalaryFixedCellsFromSource(
      latestSalary.filePath,
    );
    const salaryExportBase = await this.loadSalaryExportBaseWorkbook(latestSalary);
    const workbook = salaryExportBase.workbook;
    this.logger.log('exportFilledSalaryWorkbook:exportBaseLoaded');
    await this.enrichMonthlySheetFormulaStructure(workbook, latestSalary.filePath);
    this.logger.log('exportFilledSalaryWorkbook:formulaStructureEnriched');
    const exportMonthSheet = this.findMonthSheet(workbook);

    if (!result.monthSheetName) {
      throw new BadRequestException('salary source month sheet not found');
    }

    if (!exportMonthSheet || exportMonthSheet.name !== result.monthSheetName) {
      throw new BadRequestException(
        `salary export month mismatch: source=${result.monthSheetName}, export=${exportMonthSheet?.name || 'unknown'}`,
      );
    }

    const targetSheet =
      workbook.getWorksheet(result.targetSheetName) ||
      workbook.getWorksheet('枋湖馆绩效提成');

    if (!targetSheet) {
      throw new BadRequestException('salary template sheet 枋湖馆绩效提成 not found');
    }

    const syncedFromSummary = await this.syncSalaryPerformanceSummarySheet(
      targetSheet,
      performanceUpload,
    );
    this.logger.log(
      `exportFilledSalaryWorkbook:summarySynced=${syncedFromSummary ? 'yes' : 'no'}`,
    );

    if (!syncedFromSummary) {
      result.allRows.forEach((row) => {
        if (!row.targetRowNumber) {
          return;
        }

        const sheetRow = targetSheet.getRow(row.targetRowNumber);
        sheetRow.getCell(6).value = row.baseSalary;
        sheetRow.getCell(7).value = row.commissionSalary;
        sheetRow.getCell(8).value = row.performanceSalary;
        sheetRow.getCell(9).value = row.bonus;
        sheetRow.getCell(10).value = row.allowance;
      });
    }

    // Even when we export from a same-month fallback workbook, the monthly
    // salary sheet can still contain intentionally blank input cells that must
    // be backfilled from the summary/performance data before formulas settle.
    this.fillMonthlySalarySheetFromSummary(workbook, targetSheet);
    this.logger.log('exportFilledSalaryWorkbook:monthSheetFilled');

    await this.applyMonthlySalaryBusinessTemplateRules(
      workbook,
      latestSalary.filePath,
    );
    const exportMonthSheetAfterBusinessRules = this.findMonthSheet(workbook);
    if (exportMonthSheetAfterBusinessRules) {
      this.applyMonthlySalarySpecialBusinessRules(
        exportMonthSheetAfterBusinessRules,
      );
    }
    this.logger.log('exportFilledSalaryWorkbook:businessTemplateRulesApplied');

    // Refresh formula-backed monthly salary results before export so the
    // workbook does not keep stale template values for employees whose inputs
    // were just backfilled in this run.
    this.refreshMonthlySalarySheetResults(workbook);
    this.logger.log('exportFilledSalaryWorkbook:monthSheetResultsRefreshed');

    const exportMonthSheetForReclassification = this.findMonthSheet(workbook);
    if (exportMonthSheetForReclassification) {
      this.restoreManualSalaryFixedCells(
        exportMonthSheetForReclassification,
        manualFixedCells,
      );
      this.refreshMonthlySalarySheetResults(workbook);
      this.logger.log('exportFilledSalaryWorkbook:commissionOffsetsReclassified');
    }

    this.reconcileMonthlyPayableSalaryWithTaxIncome(workbook);
    this.refreshMonthlySalarySheetResults(workbook);
    this.logger.log('exportFilledSalaryWorkbook:taxIncomeReconciled');

    // Keep the workbook formula-driven for export. We only fill source/input
    // cells here and let Excel complete the recalculation on open, which keeps
    // the exported workbook much closer to the original template structure.
    workbook.calcProperties.fullCalcOnLoad = true;
    this.sanitizeWorkbookForExport(workbook);

    const tempExportPath = join(
      tmpdir(),
      `payroll-template-fill-${randomUUID()}.xlsx`,
    );

    await workbook.xlsx.writeFile(tempExportPath);
    const exported = await readFile(tempExportPath);
    await unlink(tempExportPath).catch(() => undefined);

    this.logger.log('exportFilledSalaryWorkbook:bufferReady');
    return Buffer.from(exported);
  }

  private async enrichMonthlySheetFormulaStructure(
    workbook: ExcelJS.Workbook,
    currentSalaryPath: string,
  ) {
    const targetMonthSheet = this.findMonthSheet(workbook);
    if (!targetMonthSheet) {
      return;
    }

    const templatePath = await this.findSalaryFormulaTemplatePath(currentSalaryPath);
    if (!templatePath) {
      this.logger.warn('enrichMonthlySheetFormulaStructure:noTemplatePath');
      return;
    }
    this.logger.log(`enrichMonthlySheetFormulaStructure:templatePath=${templatePath}`);

    const templateWorkbook = new ExcelJS.Workbook();
    await templateWorkbook.xlsx.readFile(templatePath);
    const templateMonthSheet = this.findMonthSheet(templateWorkbook);
    if (!templateMonthSheet) {
      this.logger.warn('enrichMonthlySheetFormulaStructure:noTemplateMonthSheet');
      return;
    }
    this.logger.log(
      `enrichMonthlySheetFormulaStructure:templateMonthSheet=${templateMonthSheet.name}`,
    );

    const formulaColumns = MONTH_SALARY_FORMULA_COLUMNS;
    const templateRowByName = new Map<string, ExcelJS.Row>();
    for (let rowNumber = 7; rowNumber <= templateMonthSheet.rowCount; rowNumber += 1) {
      const templateRow = templateMonthSheet.getRow(rowNumber);
      const templateEmployeeName = this.normalizeHeaderValue(
        templateRow.getCell(2).value,
      );
      if (!this.isEmployeeName(templateEmployeeName)) {
        continue;
      }

      templateRowByName.set(templateEmployeeName, templateRow);
    }

    for (let rowNumber = 7; rowNumber <= targetMonthSheet.rowCount; rowNumber += 1) {
      const targetRow = targetMonthSheet.getRow(rowNumber);
      const employeeName = this.normalizeHeaderValue(targetRow.getCell(2).value);
      if (!this.isEmployeeName(employeeName)) {
        continue;
      }

      const templateRow = templateRowByName.get(employeeName);
      if (!templateRow) {
        continue;
      }

      for (const column of formulaColumns) {
        const targetCell = targetRow.getCell(column);
        if (this.isFormulaBackedCell(targetCell)) {
          continue;
        }

        const templateCell = templateRow.getCell(column);
        const formulaModel = this.getFormulaModel(templateCell);
        const resolvedFormula = this.resolveFormulaExpression(
          templateCell,
          templateMonthSheet,
          formulaModel,
        );
        if (!resolvedFormula) {
          continue;
        }

        const templateRef = this.parseCellRef(templateCell.address);
        const targetRef = this.parseCellRef(targetCell.address);
        const shiftedFormula = this.shiftFormulaReferences(
          resolvedFormula,
          targetRef.row - templateRef.row,
          targetRef.column - templateRef.column,
        );

        targetCell.value = {
          formula: shiftedFormula,
        } as ExcelJS.CellValue;
      }
    }
  }

  private async applyMonthlySalaryBusinessTemplateRules(
    workbook: ExcelJS.Workbook,
    currentSalaryPath: string,
  ) {
    const targetMonthSheet = this.findMonthSheet(workbook);
    if (!targetMonthSheet) {
      return;
    }

    const templatePath = await this.findSalaryFormulaTemplatePath(currentSalaryPath);
    if (!templatePath) {
      this.logger.warn('applyMonthlySalaryBusinessTemplateRules:noTemplatePath');
      return;
    }

    const templateWorkbook = new ExcelJS.Workbook();
    await templateWorkbook.xlsx.readFile(templatePath);
    const templateMonthSheet = this.findMonthSheet(templateWorkbook);
    if (!templateMonthSheet) {
      this.logger.warn('applyMonthlySalaryBusinessTemplateRules:noTemplateMonthSheet');
      return;
    }

    const templateRowByName = new Map<string, ExcelJS.Row>();
    for (let rowNumber = 7; rowNumber <= templateMonthSheet.rowCount; rowNumber += 1) {
      const row = templateMonthSheet.getRow(rowNumber);
      const employeeName = this.normalizeHeaderValue(row.getCell(2).value);
      if (this.isEmployeeName(employeeName)) {
        templateRowByName.set(employeeName, row);
      }
    }

    // These columns are the business chain validated in the April workbook.
    // Formula cells are structural rules; plain numbers are month-specific inputs
    // and must stay with the current month's workbook.
    const businessColumns = [12, 17, 18, 21];
    for (let rowNumber = 7; rowNumber <= targetMonthSheet.rowCount; rowNumber += 1) {
      const targetRow = targetMonthSheet.getRow(rowNumber);
      const employeeName = this.normalizeHeaderValue(targetRow.getCell(2).value);
      if (!this.isEmployeeName(employeeName)) {
        continue;
      }

      const templateRow = templateRowByName.get(employeeName);
      if (!templateRow) {
        continue;
      }

      for (const column of businessColumns) {
        this.copyMonthlyBusinessTemplateCell(
          templateRow.getCell(column),
          targetRow.getCell(column),
          templateMonthSheet,
          targetMonthSheet,
        );
      }
    }
  }

  private copyMonthlyBusinessTemplateCell(
    templateCell: ExcelJS.Cell,
    targetCell: ExcelJS.Cell,
    templateSheet: ExcelJS.Worksheet,
    targetSheet: ExcelJS.Worksheet,
  ) {
    const formulaModel = this.getFormulaModel(templateCell);
    if (formulaModel) {
      const resolvedFormula = this.resolveFormulaExpression(
        templateCell,
        templateSheet,
        formulaModel,
      );
      if (!resolvedFormula) {
        return;
      }

      const templateRef = this.parseCellRef(templateCell.address);
      const targetRef = this.parseCellRef(targetCell.address);
      const shiftedFormula = this.shiftFormulaReferences(
        resolvedFormula,
        targetRef.row - templateRef.row,
        targetRef.column - templateRef.column,
      );

      targetCell.value = {
        formula: shiftedFormula,
      } as ExcelJS.CellValue;
      const evaluated = this.evaluateFormulaCell(targetCell, targetSheet);
      if (evaluated !== null) {
        targetCell.value = {
          formula: shiftedFormula,
          result: this.roundMoney(
            evaluated,
          ),
        } as ExcelJS.CellValue;
      }
      return;
    }

    const resolvedValue = this.extractCellResolvedValue(templateCell, templateSheet);
    if (this.isBlankCellValue(targetCell.value) && resolvedValue != null) {
      targetCell.value = resolvedValue;
    }
  }

  private async findSalaryFormulaTemplatePath(currentSalaryPath: string) {
    let bestCandidate:
      | {
          filePath: string;
          score: number;
          sameMonth: boolean;
          mtimeMs: number;
        }
      | null = null;
    const currentUpload = (
      await this.prisma.uploadFileFindMany({
        where: {
          category: 'salary',
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      })
    ).find((item) => item.filePath === currentSalaryPath);
    const currentMonthKeyword =
      (currentUpload && (await this.readUploadMonthKeyword(currentUpload))) ||
      this.extractMonthKeywordFromText(currentSalaryPath);
    const candidatePaths = await this.collectTemplateCandidatePaths(
      'salary',
      [currentSalaryPath],
      [currentSalaryPath, currentUpload?.filePath || null],
      (fileName) =>
        fileName.toLowerCase().endsWith('.xlsx') &&
        !fileName.startsWith('.~') &&
        /薪资|工资表/.test(fileName) &&
        !/(test|测试|补空结果)/i.test(fileName),
    );

    for (const filePath of candidatePaths) {
      try {
        const candidateWorkbook = new ExcelJS.Workbook();
        await candidateWorkbook.xlsx.readFile(filePath);
        const candidateMonthSheet = this.findMonthSheet(candidateWorkbook);
        if (!candidateMonthSheet) {
          continue;
        }

        const formulaScore = this.countTemplateFormulaCoverage(candidateMonthSheet);
        if (formulaScore <= 0) {
          continue;
        }

        const fileStat = await stat(filePath);
        const sameMonth = Boolean(
          currentMonthKeyword &&
            candidateMonthSheet.name &&
            candidateMonthSheet.name === currentMonthKeyword,
        );

        if (
          !bestCandidate ||
          (sameMonth && !bestCandidate.sameMonth) ||
          (sameMonth === bestCandidate.sameMonth &&
            formulaScore > bestCandidate.score) ||
          (sameMonth === bestCandidate.sameMonth &&
            formulaScore === bestCandidate.score &&
            fileStat.mtimeMs > bestCandidate.mtimeMs)
        ) {
          bestCandidate = {
            filePath,
            score: formulaScore,
            sameMonth,
            mtimeMs: fileStat.mtimeMs,
          };
        }
      } catch {
        continue;
      }
    }

    return bestCandidate?.filePath || null;
  }

  private countTemplateFormulaCoverage(sheet: ExcelJS.Worksheet) {
    let score = 0;
    for (let rowNumber = 7; rowNumber <= Math.min(sheet.rowCount, 60); rowNumber += 1) {
      const row = sheet.getRow(rowNumber);
      const employeeName = this.normalizeHeaderValue(row.getCell(2).value);
      if (!this.isEmployeeName(employeeName)) {
        continue;
      }

      for (const column of MONTH_SALARY_FORMULA_COLUMNS) {
        if (this.isFormulaBackedCell(row.getCell(column))) {
          score += 1;
        }
      }
    }

    return score;
  }

  private async loadSalaryExportBaseWorkbook(
    latestSalary: { id: bigint; originalName: string; filePath: string },
  ) {
    const latestWorkbook = new ExcelJS.Workbook();
    await latestWorkbook.xlsx.readFile(latestSalary.filePath);

    if (!this.isBrokenSalaryTemplate(latestWorkbook)) {
      return {
        workbook: latestWorkbook,
        usedFallback: false,
        preserveComputedWorkbook: false,
      };
    }

    const monthSheet = this.findMonthSheet(latestWorkbook);
    const monthKeyword = monthSheet?.name || '';

    const candidates = await this.prisma.uploadFileFindMany({
      where: {
        category: 'salary',
        id: { not: latestSalary.id },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    const preferredFallback = candidates.find((item) => {
      const name = item.originalName || '';
      return (
        (!monthKeyword || name.includes(monthKeyword)) &&
        !/(test|测试)/i.test(name)
      );
    });
    const fallbackSalary = preferredFallback;

    if (!fallbackSalary) {
      const localFallbackPath = await this.findLocalSalaryExportBasePath(monthKeyword);
      if (localFallbackPath) {
        const localFallbackWorkbook = new ExcelJS.Workbook();
        await localFallbackWorkbook.xlsx.readFile(localFallbackPath);

        if (
          !this.isBrokenSalaryTemplate(localFallbackWorkbook) &&
          this.findMonthSheet(localFallbackWorkbook)?.name === monthKeyword
        ) {
          this.logger.log(
            `using local salary export base fallback: ${localFallbackPath}`,
          );
          return {
            workbook: localFallbackWorkbook,
            usedFallback: true,
            preserveComputedWorkbook: true,
          };
        }
      }

      this.logger.warn(
        `salary export base fallback not found for ${latestSalary.originalName}`,
      );
      return {
        workbook: latestWorkbook,
        usedFallback: false,
        preserveComputedWorkbook: false,
      };
    }

    const fallbackWorkbook = new ExcelJS.Workbook();
    await fallbackWorkbook.xlsx.readFile(fallbackSalary.filePath);

    if (this.isBrokenSalaryTemplate(fallbackWorkbook)) {
      const localFallbackPath = await this.findLocalSalaryExportBasePath(monthKeyword);
      if (localFallbackPath) {
        const localFallbackWorkbook = new ExcelJS.Workbook();
        await localFallbackWorkbook.xlsx.readFile(localFallbackPath);

        if (
          !this.isBrokenSalaryTemplate(localFallbackWorkbook) &&
          this.findMonthSheet(localFallbackWorkbook)?.name === monthKeyword
        ) {
          this.logger.log(
            `using local salary export base fallback after rejecting stored fallback: ${localFallbackPath}`,
          );
          return {
            workbook: localFallbackWorkbook,
            usedFallback: true,
            preserveComputedWorkbook: true,
          };
        }
      }

      this.logger.warn(
        `salary export base fallback is still broken for ${latestSalary.originalName}, using latest template writeback instead`,
      );
      return {
        workbook: latestWorkbook,
        usedFallback: false,
        preserveComputedWorkbook: false,
      };
    }

    return {
      workbook: fallbackWorkbook,
      usedFallback: true,
      preserveComputedWorkbook: true,
    };
  }

  private async findLocalSalaryExportBasePath(monthKeyword: string) {
    const uploadedCandidates = await this.prisma.uploadFileFindMany({
      where: { category: 'salary' },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    for (const candidate of uploadedCandidates) {
      try {
        if (
          monthKeyword &&
          (await this.readUploadMonthKeyword(candidate)) !== monthKeyword
        ) {
          continue;
        }

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(candidate.filePath);
        if (
          !this.isBrokenSalaryTemplate(workbook) &&
          this.findMonthSheet(workbook)?.name === monthKeyword
        ) {
          return candidate.filePath;
        }
      } catch {
        continue;
      }
    }

    const candidatePaths = await this.findWorkbookCandidatesInDirectories(
      await this.buildTemplateSearchDirectories([]),
      (fileName) =>
        fileName.toLowerCase().endsWith('.xlsx') &&
        !/(test|测试|补空结果)/i.test(fileName) &&
        (!monthKeyword || fileName.includes(monthKeyword)),
    );

    for (const filePath of candidatePaths) {
      try {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(filePath);
        if (
          !this.isBrokenSalaryTemplate(workbook) &&
          this.findMonthSheet(workbook)?.name === monthKeyword
        ) {
          return filePath;
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  private findMonthSheet(workbook: ExcelJS.Workbook) {
    return workbook.worksheets.find((sheet) => /20\d{4}/.test(sheet.name)) || null;
  }

  private isBrokenSalaryTemplate(workbook: ExcelJS.Workbook) {
    const monthSheet =
      workbook.worksheets.find((sheet) => /20\d{4}/.test(sheet.name)) || null;
    const targetSheet =
      workbook.getWorksheet('枋湖馆绩效提成') ||
      workbook.getWorksheet('0抽成绩效总表');

    const countMissingCells = (
      sheet: ExcelJS.Worksheet | null,
      startRow: number,
      endRow: number,
      columns: number[],
      nameColumn: number,
    ) => {
      if (!sheet) {
        return 0;
      }

      let count = 0;
      const maxRow = Math.min(endRow, sheet.rowCount);
      for (let rowNumber = startRow; rowNumber <= maxRow; rowNumber += 1) {
        const row = sheet.getRow(rowNumber);
        const employeeName = this.normalizeHeaderValue(row.getCell(nameColumn).value);
        if (!this.isEmployeeName(employeeName)) {
          continue;
        }
        for (const column of columns) {
          if (this.isBlankCellValue(row.getCell(column).value)) {
            count += 1;
          }
        }
      }
      return count;
    };

    const monthMissingCount = countMissingCells(
      monthSheet,
      7,
      80,
      [10, 11, 12, 13, 15, 16, 17, 19, 20, 22, 23, 24],
      2,
    );
    const targetMissingCount = countMissingCells(
      targetSheet || null,
      4,
      120,
      [6, 7, 8, 9],
      4,
    );

    const missingMonthFormulaCount = this.countMissingMonthFormulaCells(monthSheet);

    return (
      monthMissingCount >= 120 ||
      targetMissingCount >= 80 ||
      missingMonthFormulaCount >= 200
    );
  }

  private countMissingMonthFormulaCells(sheet: ExcelJS.Worksheet | null) {
    if (!sheet) {
      return 999;
    }

    let missingCount = 0;
    let employeeRowCount = 0;
    const formulaColumns = [7, 8, 9, 10, ...MONTH_SALARY_FORMULA_COLUMNS];

    for (let rowNumber = 7; rowNumber <= Math.min(sheet.rowCount, 60); rowNumber += 1) {
      const row = sheet.getRow(rowNumber);
      const employeeName = this.normalizeHeaderValue(row.getCell(2).value);
      if (!this.isEmployeeName(employeeName)) {
        continue;
      }

      employeeRowCount += 1;
      for (const column of formulaColumns) {
        const cell = row.getCell(column);
        if (!this.isFormulaBackedCell(cell)) {
          missingCount += 1;
        }
      }
    }

    if (employeeRowCount === 0) {
      return 999;
    }

    return missingCount;
  }

  private sanitizeWorkbookForExport(
    workbook: ExcelJS.Workbook,
    targetSheets?: Array<ExcelJS.Worksheet | null | undefined>,
  ) {
    const sheets =
      targetSheets?.filter(
        (sheet): sheet is ExcelJS.Worksheet => Boolean(sheet),
      ) || workbook.worksheets;

    sheets.forEach((sheet) => {
      const isMonthSheet = /20\d{4}/.test(sheet.name);
      for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
        const row = sheet.getRow(rowNumber);
        const isMonthEmployeeRow =
          isMonthSheet &&
          this.isEmployeeName(this.normalizeHeaderValue(row.getCell(2).value));
        row.eachCell((cell) => {
          const currentValue = cell.value as
            | ExcelJS.CellValue
            | ExcelJS.CellFormulaValue
            | null
            | undefined;

          if (typeof currentValue === 'number' && Number.isNaN(currentValue)) {
            cell.value = null;
            return;
          }

          if (!currentValue || typeof currentValue !== 'object') {
            return;
          }

          if (
            'result' in currentValue &&
            currentValue.result instanceof Date &&
            Number.isNaN(currentValue.result.getTime())
          ) {
            cell.value = {
              formula: cell.formula || this.getFormulaModel(cell)?.formula || '',
              result: undefined,
            } as ExcelJS.CellValue;
            return;
          }

          if (
            'result' in currentValue &&
            typeof currentValue.result === 'number' &&
            Number.isNaN(currentValue.result)
          ) {
            cell.value = null;
            return;
          }

          const formulaModel = this.getFormulaModel(cell);
          if (formulaModel) {
            const resolvedFormula = this.resolveFormulaExpression(
              cell,
              sheet,
              formulaModel,
            );
            const evaluated = this.evaluateFormulaCell(cell, sheet);

            if (resolvedFormula) {
              const columnNumber = Number(cell.col);
              if (
                isMonthEmployeeRow &&
                columnNumber === 18 &&
                evaluated === 0
              ) {
                cell.value = 0;
                return;
              }

              if (
                isMonthEmployeeRow &&
                columnNumber === 27 &&
                evaluated !== null &&
                evaluated <= 0
              ) {
                cell.value = 0;
                return;
              }

              cell.value = {
                formula: resolvedFormula,
                result:
                  evaluated !== null
                    ? this.roundMoney(evaluated)
                    : undefined,
              } as ExcelJS.CellValue;
              return;
            }

            if ('result' in currentValue && currentValue.result != null) {
              cell.value = currentValue.result as ExcelJS.CellValue;
            } else {
              cell.value = null;
            }
          }
        });
      }
    });
  }

  private async syncSalaryPerformanceSummarySheet(
    targetSheet: ExcelJS.Worksheet,
    performanceUpload?: UploadRecord | null,
  ) {
    const latestPerformance =
      performanceUpload || (await this.resolveActivePerformanceUpload());

    if (!latestPerformance) {
      return false;
    }

    const performanceWorkbook = await this.buildFilledPerformanceWorkbook(
      latestPerformance.filePath,
    );
    const summarySheet =
      performanceWorkbook.getWorksheet('0抽成绩效总表') ||
      performanceWorkbook.getWorksheet('枋湖馆绩效提成');

    if (!summarySheet) {
      return false;
    }

    const sourceRowByName = new Map<string, number>();
    for (let rowNumber = 4; rowNumber <= summarySheet.rowCount; rowNumber += 1) {
      const employeeName = this.normalizeHeaderValue(
        summarySheet.getRow(rowNumber).getCell(4).value,
      );
      if (this.isEmployeeName(employeeName)) {
        sourceRowByName.set(employeeName, rowNumber);
      }
    }

    let matchedCount = 0;
    for (let rowNumber = 4; rowNumber <= targetSheet.rowCount; rowNumber += 1) {
      const targetRow = targetSheet.getRow(rowNumber);
      const employeeName = this.normalizeHeaderValue(targetRow.getCell(4).value);
      if (!this.isEmployeeName(employeeName)) {
        continue;
      }

      const sourceRowNumber = sourceRowByName.get(employeeName);
      if (!sourceRowNumber) {
        continue;
      }

      const sourceRow = summarySheet.getRow(sourceRowNumber);
      this.mergePerformanceSummaryRow(targetRow, sourceRow);

      matchedCount += 1;
    }

    this.syncSalaryPerformanceSummaryFooter(targetSheet, summarySheet);

    return matchedCount > 0;
  }

  private mergePerformanceSummaryRow(
    targetRow: ExcelJS.Row,
    sourceRow: ExcelJS.Row,
  ) {
    const columns = [6, 7, 8, 9, 10];
    columns.forEach((column) => {
      const sourceCell = sourceRow.getCell(column);
      const targetCell = targetRow.getCell(column);
      const sourceValue = this.extractCellResolvedValue(
        sourceCell,
        sourceRow.worksheet,
      );

      const hasFormulaStructure = this.isFormulaBackedCell(targetCell);
      if (hasFormulaStructure) {
        if (sourceValue == null || this.isBlankCellValue(sourceValue)) {
          targetCell.value = null;
          return;
        }

        targetCell.value = this.parseNumber(
          this.normalizeHeaderValue(sourceValue),
        );
        return;
      }

      if (sourceValue == null || this.isBlankCellValue(sourceValue)) {
        targetCell.value = null;
        return;
      }

      targetCell.value = sourceValue;
    });

    const totalCell = targetRow.getCell(11);
    const sourceTotal = sourceRow.getCell(11);
    const totalValue = this.extractCellResolvedValue(
      sourceTotal,
      sourceRow.worksheet,
    );
    totalCell.value =
      totalValue == null || this.isBlankCellValue(totalValue)
        ? null
        : totalValue;
  }

  private syncSalaryPerformanceSummaryFooter(
    targetSheet: ExcelJS.Worksheet,
    sourceSheet: ExcelJS.Worksheet,
  ) {
    const sourceFooterRows = this.detectDoctorFooterRows(sourceSheet);
    const targetFooterRows = this.detectDoctorFooterRows(targetSheet);

    if (sourceFooterRows.totalRowNumber && targetFooterRows.totalRowNumber) {
      this.copyRowCellValues(
        sourceSheet.getRow(sourceFooterRows.totalRowNumber),
        targetSheet.getRow(targetFooterRows.totalRowNumber),
        [6, 7, 8, 9, 10, 11],
      );
    }

    if (sourceFooterRows.checkRowNumber && targetFooterRows.checkRowNumber) {
      this.copyRowCellValues(
        sourceSheet.getRow(sourceFooterRows.checkRowNumber),
        targetSheet.getRow(targetFooterRows.checkRowNumber),
        [9, 11, 12],
      );
    }

    if (sourceFooterRows.balanceRowNumber && targetFooterRows.balanceRowNumber) {
      this.copyRowCellValues(
        sourceSheet.getRow(sourceFooterRows.balanceRowNumber),
        targetSheet.getRow(targetFooterRows.balanceRowNumber),
        [5, 6, 7, 8],
      );
    }
  }

  private reconcileMonthlyPayableSalaryWithTaxIncome(workbook: ExcelJS.Workbook) {
    const monthSheet = this.findMonthSheet(workbook);
    if (!monthSheet) {
      return;
    }

    const taxIncomeByName = this.readTaxIncomeByNameFromWorkbook(workbook);
    if (taxIncomeByName.size === 0) {
      return;
    }

    for (let rowNumber = 7; rowNumber <= monthSheet.rowCount; rowNumber += 1) {
      const row = monthSheet.getRow(rowNumber);
      const employeeName = this.normalizeHeaderValue(row.getCell(2).value);
      if (!this.isEmployeeName(employeeName)) {
        continue;
      }

      const taxIncome = taxIncomeByName.get(employeeName) || 0;
      if (taxIncome === 0) {
        continue;
      }
      if (this.readCellNumber(row.getCell(26)) !== 0) {
        continue;
      }

      const payableSalary = this.calculateMonthlyPayableSalary(row, monthSheet);
      const difference = this.roundMoney(taxIncome - payableSalary);
      if (Math.abs(difference) < 0.01) {
        continue;
      }

      this.setCalculatedCellValue(
        row.getCell(14),
        this.roundMoney(this.readCellNumber(row.getCell(14)) + difference),
        {
          allowZero: true,
          overwriteNonFormula: true,
          preferLiteralOverwrite: true,
        },
      );

      const reconciledPayableSalary =
        this.calculateMonthlyPayableSalary(row, monthSheet);
      this.setCalculatedCellValue(row.getCell(18), reconciledPayableSalary, {
        allowZero: true,
        overwriteNonFormula: true,
        overwriteFormulaResult: true,
      });

      const companyTotalCost = this.calculateMonthlyCompanyTotalCost(
        row,
        monthSheet,
        reconciledPayableSalary,
      );
      this.setCalculatedCellValue(row.getCell(21), companyTotalCost, {
        allowZero: true,
        overwriteNonFormula: true,
        overwriteFormulaResult: true,
      });
    }
  }

  private copyRowCellValues(
    sourceRow: ExcelJS.Row,
    targetRow: ExcelJS.Row,
    columns: number[],
  ) {
    columns.forEach((column) => {
      const sourceCell = sourceRow.getCell(column);
      const targetCell = targetRow.getCell(column);
      const sourceValue = this.extractCellResolvedValue(sourceCell, sourceRow.worksheet);

      if (sourceValue == null || this.isBlankCellValue(sourceValue)) {
        targetCell.value = null;
        return;
      }

      targetCell.value = sourceValue;
    });
  }

  private extractCellResolvedValue(
    cell: ExcelJS.Cell,
    currentSheet?: ExcelJS.Worksheet,
  ): ExcelJS.CellValue | null {
    const rawValue = cell.value;
    if (rawValue == null) {
      return null;
    }

    if (typeof rawValue !== 'object') {
      return rawValue as ExcelJS.CellValue;
    }

    if ('formula' in rawValue) {
      const formulaValue = rawValue as ExcelJS.CellFormulaValue;
      if (formulaValue.result != null) {
        return formulaValue.result;
      }

      if (currentSheet) {
        const evaluated = this.evaluateFormulaCell(cell, currentSheet);
        if (evaluated !== null) {
          return this.roundMoney(evaluated);
        }
      }

      return null;
    }

    if ('result' in rawValue) {
      return (rawValue as { result?: ExcelJS.CellValue }).result ?? null;
    }

    return rawValue as ExcelJS.CellValue;
  }

  private refreshMonthlySalarySheetResults(workbook: ExcelJS.Workbook) {
    const monthSheet =
      workbook.worksheets.find((sheet) => /20\d{4}/.test(sheet.name)) || null;

    if (!monthSheet) {
      return;
    }

    this.restoreMonthlySalarySheetFormulas(monthSheet);

    const targetColumns = [12, ...MONTH_SALARY_FORMULA_COLUMNS];

    // Run multiple passes so dependent cells like R/U/AA and footer formulas can settle.
    for (let pass = 0; pass < 3; pass += 1) {
      for (let rowNumber = 1; rowNumber <= monthSheet.rowCount; rowNumber += 1) {
        const row = monthSheet.getRow(rowNumber);
        const employeeName = this.normalizeHeaderValue(row.getCell(2).value);
        const isEmployeeRow = this.isEmployeeName(employeeName);

        targetColumns.forEach((column) => {
          const cell = row.getCell(column);
          if (isEmployeeRow && column === 18) {
            const payableSalary = this.calculateMonthlyPayableSalary(
              row,
              monthSheet,
            );
            cell.value = {
              formula: `ROUND(SUM(J${rowNumber}:N${rowNumber})-SUM(O${rowNumber}:Q${rowNumber}),2)`,
              result: payableSalary,
            } as ExcelJS.CellValue;
            return;
          }

          if (!this.isFormulaBackedCell(cell)) {
            return;
          }

          const value = this.evaluateFormulaCell(cell, monthSheet);
          if (value === null) {
            return;
          }

          const roundedValue = this.roundMoney(value);
          this.setCalculatedCellValue(cell, roundedValue, {
            allowZero: true,
            overwriteNonFormula: false,
            overwriteFormulaResult: true,
          });
        });

        if (isEmployeeRow && !this.isFormulaBackedCell(row.getCell(18))) {
          const payableSalary = this.calculateMonthlyPayableSalary(
            row,
            monthSheet,
          );
          this.setCalculatedCellValue(row.getCell(18), payableSalary, {
            allowZero: true,
            overwriteNonFormula: true,
            overwriteFormulaResult: true,
            preferLiteralOverwrite: true,
          });
        }
      }
    }

    // Finance confirmed that net transfer salary should never be negative.
    // Clamp AA after formula refresh so template style stays intact while
    // preventing impossible payroll outputs.
    for (let rowNumber = 1; rowNumber <= monthSheet.rowCount; rowNumber += 1) {
      const row = monthSheet.getRow(rowNumber);
      const employeeName = this.normalizeHeaderValue(row.getCell(2).value);
      if (!this.isEmployeeName(employeeName)) {
        continue;
      }

      const netTransferCell = row.getCell(27);
      const netTransferValue = this.readComputedCellNumber(
        netTransferCell,
        monthSheet,
      );
      if (netTransferValue >= 0) {
        continue;
      }

      this.setCalculatedCellValue(netTransferCell, 0, {
        allowZero: true,
        overwriteNonFormula: false,
        overwriteFormulaResult: true,
      });
    }

  }

  private restoreMonthlySalarySheetFormulas(sheet: ExcelJS.Worksheet) {
    const formulaColumns = MONTH_SALARY_FORMULA_COLUMNS;

    for (let rowNumber = 7; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const row = sheet.getRow(rowNumber);
      const employeeName = this.normalizeHeaderValue(row.getCell(2).value);
      if (!this.isEmployeeName(employeeName)) {
        continue;
      }

      for (const column of formulaColumns) {
        const cell = row.getCell(column);
        if (this.isFormulaBackedCell(cell)) {
          continue;
        }
        if (!this.isBlankCellValue(cell.value)) {
          continue;
        }

        const restoredFormula = this.findRestorableRowFormula(
          sheet,
          rowNumber,
          column,
        );
        if (!restoredFormula) {
          continue;
        }

        cell.value = {
          formula: restoredFormula,
        } as ExcelJS.CellValue;
      }
    }
  }

  private findRestorableRowFormula(
    sheet: ExcelJS.Worksheet,
    rowNumber: number,
    column: number,
  ) {
    const searchOffsets = [
      -1, 1, -2, 2, -3, 3, -4, 4, -5, 5, -6, 6, -7, 7, -8, 8, -9, 9, -10, 10,
      -12, 12, -15, 15, -20, 20,
    ];

    for (const offset of searchOffsets) {
      const sourceRowNumber = rowNumber + offset;
      if (sourceRowNumber < 7 || sourceRowNumber > sheet.rowCount) {
        continue;
      }

      const sourceRow = sheet.getRow(sourceRowNumber);
      const sourceEmployeeName = this.normalizeHeaderValue(
        sourceRow.getCell(2).value,
      );
      if (!this.isEmployeeName(sourceEmployeeName)) {
        continue;
      }

      const sourceCell = sourceRow.getCell(column);
      const formulaModel = this.getFormulaModel(sourceCell);
      const resolvedFormula = this.resolveFormulaExpression(
        sourceCell,
        sheet,
        formulaModel,
      );

      if (!resolvedFormula) {
        continue;
      }

      return this.shiftFormulaReferences(
        resolvedFormula,
        rowNumber - sourceRowNumber,
        0,
      );
    }

    return null;
  }

  private fillMonthlySalarySheetFromSummary(
    workbook: ExcelJS.Workbook,
    summarySheet: ExcelJS.Worksheet,
  ) {
    const monthSheet =
      workbook.worksheets.find((sheet) => /20\d{4}/.test(sheet.name)) || null;

    if (!monthSheet) {
      return;
    }

    const summaryByName = new Map<
      string,
      {
        baseSalary: number;
        commissionSalary: number;
        performanceSalary: number;
        bonus: number;
        allowance: number;
      }
    >();

    for (let rowNumber = 4; rowNumber <= summarySheet.rowCount; rowNumber += 1) {
      const row = summarySheet.getRow(rowNumber);
      const employeeName = this.normalizeHeaderValue(row.getCell(4).value);
      if (!this.isEmployeeName(employeeName)) {
        continue;
      }

      summaryByName.set(employeeName, {
        baseSalary: this.readCellNumber(row.getCell(6)),
        commissionSalary: this.readCellNumber(row.getCell(7)),
        performanceSalary: this.readCellNumber(row.getCell(8)),
        bonus: this.readCellNumber(row.getCell(9)),
        allowance: this.readCellNumber(row.getCell(10)),
      });
    }

    const socialEmployerByName = this.readSocialEmployerByNameFromWorkbook(workbook);
    const socialByName = this.readSocialByNameFromWorkbook(workbook);
    const fundCompanyByName = this.readFundCompanyByNameFromWorkbook(workbook);
    const fundByName = this.readFundByNameFromWorkbook(workbook);
    const taxByName = this.readTaxByNameFromWorkbook(workbook);
    const mealFeeByName = this.readMealFeeByNameFromWorkbook(workbook);
    const attendanceByName = this.readAttendanceByNameFromWorkbook(workbook);
    const employeeBaseSalaryByName =
      this.readEmployeeBaseSalaryByNameFromWorkbook(workbook);

    for (let rowNumber = 1; rowNumber <= monthSheet.rowCount; rowNumber += 1) {
      const row = monthSheet.getRow(rowNumber);
      const employeeName = this.normalizeHeaderValue(row.getCell(2).value);
      if (!this.isEmployeeName(employeeName)) {
        continue;
      }

      const summary = summaryByName.get(employeeName);
      const hasSummary = Boolean(summary);
      const baseSalary = summary?.baseSalary || 0;
      const commissionSalary = summary?.commissionSalary || 0;
      const performanceSalary = summary?.performanceSalary || 0;
      const bonus = summary?.bonus || 0;
      const allowance = summary?.allowance || 0;
      const employerSocialSecurity = socialEmployerByName.get(employeeName) || 0;
      const socialSecurity = socialByName.get(employeeName) || 0;
      const companyHousingFund = fundCompanyByName.get(employeeName) || 0;
      const housingFund = fundByName.get(employeeName) || 0;
      const tax = taxByName.get(employeeName) || 0;
      const attendance = attendanceByName.get(employeeName);
      const mealFee = mealFeeByName.get(employeeName) || 0;
      const compensation = this.readCellNumber(row.getCell(25));
      const employeeInfoBaseSalary = this.readComputedCellNumber(
        row.getCell(7),
        monthSheet,
      );
      const employeeArchiveBaseSalary = employeeBaseSalaryByName.get(employeeName) || 0;
      const currentMonthBaseSalary = this.readCellNumber(row.getCell(10));
      const currentMonthPerformanceSalary = this.readCellNumber(row.getCell(11));
      const currentMonthCommissionSalary = this.readCellNumber(row.getCell(12));
      const currentMonthBonus = this.readCellNumber(row.getCell(13));
      const currentMonthAllowance = this.readCellNumber(row.getCell(14));
      const hasCurrentMonthBusinessInput =
        currentMonthPerformanceSalary !== 0 ||
        currentMonthCommissionSalary !== 0 ||
        currentMonthBonus !== 0 ||
        currentMonthAllowance !== 0;

      // Monthly sheet stores most business values as direct inputs. Overwrite
      // these cells with the current calculation result so stale template values
      // from another month cannot leak into this export.
      if (attendance) {
        this.setCalculatedCellValue(row.getCell(8), attendance.standardWorkDays, {
          allowZero: true,
          overwriteNonFormula: true,
          preferLiteralOverwrite: true,
        });
        this.setCalculatedCellValue(row.getCell(9), attendance.actualPaidDays, {
          allowZero: true,
          overwriteNonFormula: true,
          preferLiteralOverwrite: true,
        });
      }

      const targetBaseSalary = hasSummary
        ? baseSalary
        : currentMonthBaseSalary !== 0
          ? currentMonthBaseSalary
          : hasCurrentMonthBusinessInput
            ? 0
            : employeeArchiveBaseSalary !== 0
            ? employeeArchiveBaseSalary
            : employeeInfoBaseSalary;
      const targetPerformanceSalary =
        performanceSalary !== 0
          ? performanceSalary
          : SALARY_MONTH_PERFORMANCE_FROM_COMMISSION_NAMES.has(employeeName) &&
              commissionSalary !== 0
            ? commissionSalary
            : currentMonthPerformanceSalary !== 0
              ? currentMonthPerformanceSalary
              : 0;
      const targetCommissionSalary =
        commissionSalary !== 0
          ? commissionSalary
          : currentMonthCommissionSalary !== 0
            ? currentMonthCommissionSalary
            : 0;
      const targetBonus =
        bonus !== 0
          ? bonus
          : currentMonthBonus !== 0
            ? currentMonthBonus
            : 0;
      const targetAllowance =
        allowance !== 0
          ? allowance
          : currentMonthAllowance !== 0
            ? currentMonthAllowance
            : 0;

      this.setCalculatedCellValue(row.getCell(10), targetBaseSalary, {
        allowZero: true,
        overwriteNonFormula: true,
        preferLiteralOverwrite: true,
      });
      this.setCalculatedCellValue(row.getCell(11), targetPerformanceSalary, {
        allowZero: true,
        overwriteNonFormula: true,
        preferLiteralOverwrite: true,
      });
      if (!SALARY_MONTH_SPECIAL_BLANK_COMMISSION_NAMES.has(employeeName)) {
        this.setCalculatedCellValue(row.getCell(12), targetCommissionSalary, {
          allowZero: true,
          overwriteNonFormula: true,
          preferLiteralOverwrite: true,
        });
      } else if (!this.isFormulaBackedCell(row.getCell(12))) {
        row.getCell(12).value = null;
      }
      this.setCalculatedCellValue(row.getCell(13), targetBonus, {
        allowZero: true,
        overwriteNonFormula: true,
        preferLiteralOverwrite: true,
      });
      this.setCalculatedCellValue(row.getCell(14), targetAllowance, {
        allowZero: true,
        overwriteNonFormula: true,
        preferLiteralOverwrite: true,
      });
      this.setCalculatedCellValue(row.getCell(16), mealFee, {
        allowZero: true,
        overwriteNonFormula: true,
        preferLiteralOverwrite: true,
      });
      this.setCalculatedCellValue(
        row.getCell(17),
        companyHousingFund > 272
          ? this.roundMoney(companyHousingFund - 272)
          : 0,
        {
          allowZero: true,
          overwriteNonFormula: true,
          preferLiteralOverwrite: true,
        },
      );

      this.setCalculatedCellValue(row.getCell(19), employerSocialSecurity, {
        allowZero: true,
        overwriteNonFormula: true,
        preferLiteralOverwrite: true,
      });
      this.setCalculatedCellValue(row.getCell(20), companyHousingFund, {
        allowZero: true,
        overwriteNonFormula: true,
        preferLiteralOverwrite: true,
      });
      this.setCalculatedCellValue(
        row.getCell(21),
        this.roundMoney(employerSocialSecurity + companyHousingFund),
        {
          allowZero: true,
          overwriteNonFormula: true,
          overwriteFormulaResult: true,
        },
      );
      this.setCalculatedCellValue(row.getCell(22), socialSecurity, {
        allowZero: true,
        overwriteNonFormula: true,
        preferLiteralOverwrite: true,
      });
      this.setCalculatedCellValue(row.getCell(23), housingFund, {
        allowZero: true,
        overwriteNonFormula: true,
        preferLiteralOverwrite: true,
      });
      this.setCalculatedCellValue(row.getCell(24), tax, {
        allowZero: true,
        overwriteNonFormula: true,
        preferLiteralOverwrite: true,
      });

      const payableSalary = this.calculateMonthlyPayableSalary(row, monthSheet);
      this.setCalculatedCellValue(row.getCell(18), payableSalary, {
        allowZero: true,
        overwriteNonFormula: true,
        overwriteFormulaResult: true,
        preferLiteralOverwrite: true,
      });

      const companyTotalCost = this.calculateMonthlyCompanyTotalCost(
        row,
        monthSheet,
        payableSalary,
      );
      this.setCalculatedCellValue(row.getCell(21), companyTotalCost, {
        allowZero: true,
        overwriteNonFormula: true,
        overwriteFormulaResult: true,
      });

      if (
        compensation !== 0 &&
        !this.isFormulaBackedCell(row.getCell(25)) &&
        this.isBlankCellValue(row.getCell(25).value)
      ) {
        row.getCell(25).value = compensation;
      }

    }

    this.applyMonthlySalarySpecialBusinessRules(monthSheet);
  }

  private reclassifyAssistantCommissionOffsets(monthSheet: ExcelJS.Worksheet) {
    const summarySheet =
      monthSheet.workbook.getWorksheet('枋湖馆绩效提成') ||
      monthSheet.workbook.getWorksheet('0抽成绩效总表');
    const summaryNames = new Set<string>();
    if (summarySheet) {
      for (let rowNumber = 4; rowNumber <= summarySheet.rowCount; rowNumber += 1) {
        const employeeName = this.normalizeHeaderValue(
          summarySheet.getRow(rowNumber).getCell(4).value,
        );
        if (this.isEmployeeName(employeeName)) {
          summaryNames.add(employeeName);
        }
      }
    }

    for (let rowNumber = 8; rowNumber <= monthSheet.rowCount; rowNumber += 1) {
      const row = monthSheet.getRow(rowNumber);
      const employeeName = this.normalizeHeaderValue(row.getCell(2).value);
      if (!this.isEmployeeName(employeeName)) {
        continue;
      }

      const commissionSalary = this.readCellNumber(row.getCell(12));
      if (commissionSalary <= 0) {
        continue;
      }

      const commissionFormula = this.resolveFormulaExpression(
        row.getCell(12),
        monthSheet,
        this.getFormulaModel(row.getCell(12)),
      );
      if (!commissionFormula) {
        continue;
      }

      if (summaryNames.has(employeeName)) {
        continue;
      }

      const previousRow = monthSheet.getRow(rowNumber - 1);
      const previousEmployeeName = this.normalizeHeaderValue(
        previousRow.getCell(2).value,
      );
      if (!this.isEmployeeName(previousEmployeeName)) {
        continue;
      }

      const previousCommissionSalary = this.readComputedCellNumber(
        previousRow.getCell(12),
        monthSheet,
      );
      if (previousCommissionSalary !== 0) {
        continue;
      }

      const previousCommissionFormula = this.resolveFormulaExpression(
        previousRow.getCell(12),
        monthSheet,
        this.getFormulaModel(previousRow.getCell(12)),
      );
      if (
        previousCommissionFormula &&
        !new RegExp(`(?:-|:)L${rowNumber}\\b`).test(previousCommissionFormula)
      ) {
        continue;
      }

      const previousAllowance = this.readCellNumber(previousRow.getCell(14));
      if (previousAllowance === -commissionSalary) {
        this.setCalculatedCellValue(previousRow.getCell(14), 0, {
          allowZero: true,
          overwriteNonFormula: true,
          preferLiteralOverwrite: true,
        });
      }

      this.setCalculatedCellValue(row.getCell(12), 0, {
        allowZero: true,
        overwriteNonFormula: true,
        preferLiteralOverwrite: true,
      });
      this.setCalculatedCellValue(
        row.getCell(14),
        this.roundMoney(this.readCellNumber(row.getCell(14)) + commissionSalary),
        {
          allowZero: true,
          overwriteNonFormula: true,
          preferLiteralOverwrite: true,
        },
      );
    }
  }

  private snapshotManualSalaryFixedCells(
    monthSheet: ExcelJS.Worksheet,
    templateMonthSheet?: ExcelJS.Worksheet | null,
  ): ManualSalaryFixedCell[] {
    const fixedCells: ManualSalaryFixedCell[] = [];
    const templateRowByName = new Map<string, ExcelJS.Row>();
    if (templateMonthSheet) {
      for (
        let rowNumber = 7;
        rowNumber <= templateMonthSheet.rowCount;
        rowNumber += 1
      ) {
        const templateRow = templateMonthSheet.getRow(rowNumber);
        const employeeName = this.normalizeHeaderValue(templateRow.getCell(2).value);
        if (this.isEmployeeName(employeeName)) {
          templateRowByName.set(employeeName, templateRow);
        }
      }
    }

    for (let rowNumber = 7; rowNumber <= monthSheet.rowCount; rowNumber += 1) {
      const row = monthSheet.getRow(rowNumber);
      const employeeName = this.normalizeHeaderValue(row.getCell(2).value);
      if (!this.isEmployeeName(employeeName)) {
        continue;
      }
      const templateRow = templateRowByName.get(employeeName);

      for (let columnNumber = 7; columnNumber <= 27; columnNumber += 1) {
        const cell = row.getCell(columnNumber);
        const value = this.cloneCellValue(cell.value);
        if (this.isBlankCellValue(value) || this.isFormulaBackedCell(cell)) {
          continue;
        }
        if (
          templateRow &&
          this.isFormulaBackedCell(templateRow.getCell(columnNumber))
        ) {
          continue;
        }

        const numericValue = this.readCellNumber(cell);
        if (numericValue === 0) {
          continue;
        }

        fixedCells.push({
          rowNumber,
          columnNumber,
          value,
        });
      }
    }

    return fixedCells;
  }

  private async snapshotManualSalaryFixedCellsFromSource(currentSalaryPath: string) {
    const sourceWorkbook = new ExcelJS.Workbook();
    await sourceWorkbook.xlsx.readFile(currentSalaryPath);
    const sourceMonthSheet = this.findMonthSheet(sourceWorkbook);
    if (!sourceMonthSheet) {
      return [];
    }

    const templatePath = await this.findSalaryFormulaTemplatePath(currentSalaryPath);
    if (!templatePath) {
      return this.snapshotManualSalaryFixedCells(sourceMonthSheet);
    }

    const templateWorkbook = new ExcelJS.Workbook();
    await templateWorkbook.xlsx.readFile(templatePath);

    return this.snapshotManualSalaryFixedCells(
      sourceMonthSheet,
      this.findMonthSheet(templateWorkbook),
    );
  }

  private restoreManualSalaryFixedCells(
    monthSheet: ExcelJS.Worksheet,
    fixedCells: ManualSalaryFixedCell[],
  ) {
    for (const fixedCell of fixedCells) {
      const cell = monthSheet
        .getRow(fixedCell.rowNumber)
        .getCell(fixedCell.columnNumber);
      if (this.areCellValuesEquivalent(cell.value, fixedCell.value)) {
        continue;
      }

      cell.value = this.cloneCellValue(fixedCell.value);
    }
  }

  private cloneCellValue(value: ExcelJS.CellValue): ExcelJS.CellValue {
    if (value instanceof Date) {
      return new Date(value.getTime());
    }

    if (value && typeof value === 'object') {
      return {
        ...(value as unknown as Record<string, unknown>),
      } as unknown as ExcelJS.CellValue;
    }

    return value;
  }

  private areCellValuesEquivalent(
    currentValue: ExcelJS.CellValue,
    expectedValue: ExcelJS.CellValue,
  ) {
    if (typeof currentValue === 'number' && typeof expectedValue === 'number') {
      return Math.abs(currentValue - expectedValue) < 0.005;
    }

    return currentValue === expectedValue;
  }

  private applyMonthlySalarySpecialBusinessRules(monthSheet: ExcelJS.Worksheet) {
    this.applyMonthlySalarySharedCommissionRules(monthSheet);

    for (let rowNumber = 1; rowNumber <= monthSheet.rowCount; rowNumber += 1) {
      const row = monthSheet.getRow(rowNumber);
      const employeeName = this.normalizeHeaderValue(row.getCell(2).value);

      if (employeeName !== '池则逢') {
        continue;
      }

      const assistantRow = monthSheet.getRow(rowNumber + 1);
      const assistantName = this.normalizeHeaderValue(assistantRow.getCell(2).value);
      const assistantIncomeBeforeDeduction =
        this.readCellNumber(assistantRow.getCell(10)) +
        this.readCellNumber(assistantRow.getCell(11)) +
        this.readCellNumber(assistantRow.getCell(13)) -
        this.readComputedCellNumber(assistantRow.getCell(15), monthSheet);
      const assistantShare = Math.max(
        this.roundMoney(assistantIncomeBeforeDeduction - 2500),
        0,
      );

      // Finance's April verified rule: 池则逢需扣回固定 30000，
      // 再额外承担下一行医助超出 2500 的部分。
      if (assistantName === '杨彦榕') {
        const allowance = this.roundMoney(-30000 - assistantShare);
        this.setCalculatedCellValue(row.getCell(14), allowance, {
          allowZero: true,
          overwriteNonFormula: true,
          preferLiteralOverwrite: true,
        });

        const payableSalary = this.calculateMonthlyPayableSalary(row, monthSheet);
        this.setCalculatedCellValue(row.getCell(18), payableSalary, {
          allowZero: true,
          overwriteNonFormula: true,
          overwriteFormulaResult: true,
          preferLiteralOverwrite: true,
        });

        const companyTotalCost = this.calculateMonthlyCompanyTotalCost(
          row,
          monthSheet,
          payableSalary,
        );
        this.setCalculatedCellValue(row.getCell(21), companyTotalCost, {
          allowZero: true,
          overwriteNonFormula: true,
          overwriteFormulaResult: true,
        });
      }
    }
  }

  private applyMonthlySalarySharedCommissionRules(monthSheet: ExcelJS.Worksheet) {
    const rowNumberByName = this.indexMonthSheetRowsByEmployeeName(monthSheet);

    for (const [ownerName, sharedNames] of Object.entries(
      SALARY_MONTH_COMMISSION_SHARED_RULES,
    )) {
      const ownerRowNumber = rowNumberByName.get(ownerName);
      if (!ownerRowNumber) {
        continue;
      }

      const sharedRowNumbers = sharedNames
        .map((name) => rowNumberByName.get(name))
        .filter((rowNumber): rowNumber is number => Boolean(rowNumber));
      if (sharedRowNumbers.length === 0) {
        continue;
      }

      const ownerRow = monthSheet.getRow(ownerRowNumber);
      const formula =
        `VLOOKUP(B${ownerRowNumber},枋湖馆绩效提成!D:G,4,0)` +
        sharedRowNumbers
          .map((rowNumber) => `-L${rowNumber}`)
          .join('');
      ownerRow.getCell(12).value = {
        formula,
        result: this.roundMoney(
          this.evaluateFormulaText(formula, ownerRow.getCell(12), monthSheet) ??
            this.readCellNumber(ownerRow.getCell(12)),
        ),
      } as ExcelJS.CellValue;
    }
  }

  private indexMonthSheetRowsByEmployeeName(sheet: ExcelJS.Worksheet) {
    const result = new Map<string, number>();
    for (let rowNumber = 7; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const employeeName = this.normalizeHeaderValue(
        sheet.getRow(rowNumber).getCell(2).value,
      );
      if (this.isEmployeeName(employeeName)) {
        result.set(employeeName, rowNumber);
      }
    }
    return result;
  }

  private readMealFeeByNameFromWorkbook(workbook: ExcelJS.Workbook) {
    const mealSheet = workbook.getWorksheet('餐费');
    if (!mealSheet) {
      return new Map<string, number>();
    }

    const result = new Map<string, number>();
    mealSheet.eachRow((row) => {
      const name = this.normalizeHeaderValue(row.getCell(1).value);
      if (!this.isEmployeeName(name)) {
        return;
      }

      result.set(name, this.readComputedCellNumber(row.getCell(35), mealSheet));
    });

    return result;
  }

  private readAttendanceByNameFromWorkbook(workbook: ExcelJS.Workbook) {
    const attendanceSheet = workbook.getWorksheet('考勤信息');
    if (!attendanceSheet) {
      return new Map<string, SalaryMonthAuxiliaryData>();
    }

    const result = new Map<string, SalaryMonthAuxiliaryData>();
    attendanceSheet.eachRow((row) => {
      const name =
        this.normalizeHeaderValue(row.getCell(2).value) ||
        this.normalizeHeaderValue(row.getCell(1).value);
      if (!this.isEmployeeName(name)) {
        return;
      }

      result.set(name, {
        standardWorkDays: this.readCellNumber(row.getCell(4)),
        actualPaidDays: this.readCellNumber(row.getCell(5)),
        mealFee: 0,
        employerSocialSecurity: 0,
        socialSecurity: 0,
        companyHousingFund: 0,
        housingFund: 0,
        tax: 0,
      });
    });

    return result;
  }

  async buildPerformanceResultPreview() {
    const result = await this.buildPerformanceResult();

    return {
      performanceWorkbook: result.performanceWorkbook,
      summary: result.summary,
      previewRows: result.previewRows,
    };
  }

  async exportPerformanceResultWorkbook() {
    const result = await this.buildPerformanceResult();
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Codex Finance Payroll Tool';
    workbook.created = new Date();

    const summarySheet = workbook.addWorksheet('绩效汇总');
    summarySheet.columns = [
      { header: '指标', key: 'label', width: 24 },
      { header: '值', key: 'value', width: 18 },
    ];
    summarySheet.addRows([
      { label: '绩效文件', value: result.performanceWorkbook.originalName },
      { label: '员工人数', value: result.summary.employeeCount },
      { label: '医生人数', value: result.summary.doctorCount },
      { label: '工作人员人数', value: result.summary.staffCount },
      { label: '岗位薪资合计', value: result.summary.totalBaseSalary },
      { label: '抽成工资合计', value: result.summary.totalCommissionSalary },
      { label: '绩效工资合计', value: result.summary.totalPerformanceSalary },
      { label: '其他项目合计', value: result.summary.totalBonus },
      { label: '补贴合计', value: result.summary.totalAllowance },
      { label: '本月工资合计', value: result.summary.totalPay },
    ]);

    const detailSheet = workbook.addWorksheet('绩效结果明细');
    detailSheet.columns = [
      { header: '姓名', key: 'employeeName', width: 14 },
      { header: '部门/科室', key: 'department', width: 18 },
      { header: '人员类型', key: 'employeeType', width: 12 },
      { header: '岗位薪资', key: 'baseSalary', width: 14 },
      { header: '抽成工资', key: 'commissionSalary', width: 14 },
      { header: '绩效工资', key: 'performanceSalary', width: 14 },
      { header: '其他项目', key: 'bonus', width: 14 },
      { header: '补贴', key: 'allowance', width: 14 },
      { header: '本月工资', key: 'totalPay', width: 14 },
      { header: '来源工作表', key: 'sourceSheet', width: 24 },
    ];

    result.allRows.forEach((row) => {
      detailSheet.addRow({
        ...row,
        employeeType: row.employeeType === 'doctor' ? '医生' : '工作人员',
      });
    });

    [summarySheet, detailSheet].forEach((sheet) => {
      const headerRow = sheet.getRow(1);
      headerRow.font = { bold: true };
      headerRow.eachCell((cell) => {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFE8F0DD' },
        };
      });
      sheet.views = [{ state: 'frozen', ySplit: 1 }];
    });

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  async buildPerformanceTemplateFillPreview() {
    const result = await this.preparePerformanceTemplateWorkbook();
    return result;
  }

  async exportFilledPerformanceWorkbook() {
    const latestPerformance = await this.prisma.uploadFileFindFirst({
      where: { category: 'performance' },
      orderBy: { createdAt: 'desc' },
    });

    if (!latestPerformance) {
      throw new BadRequestException('performance workbook is required before performance fill');
    }
    const workbook = await this.buildFilledPerformanceWorkbook(
      latestPerformance.filePath,
    );

    workbook.calcProperties.fullCalcOnLoad = true;
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  private async applyPerformanceFormulaTemplate(
    workbook: ExcelJS.Workbook,
    currentPerformancePath: string,
    currentPerformanceName?: string,
  ) {
    const templatePath =
      await this.findPerformanceFormulaTemplatePath(
        currentPerformancePath,
        currentPerformanceName,
      );
    if (!templatePath) {
      this.logger.warn('applyPerformanceFormulaTemplate:noTemplatePath');
      return;
    }
    this.logger.log(`applyPerformanceFormulaTemplate:templatePath=${templatePath}`);

    const templateWorkbook = new ExcelJS.Workbook();
    await templateWorkbook.xlsx.readFile(templatePath);

    workbook.worksheets.forEach((targetSheet) => {
      const templateSheet =
        this.findPerformanceTemplateSheet(templateWorkbook, targetSheet.name);
      if (!templateSheet) {
        return;
      }

      const maxRow = Math.min(
        Math.max(targetSheet.rowCount, templateSheet.rowCount),
        templateSheet.rowCount,
      );
      const maxColumn = Math.min(
        Math.max(targetSheet.columnCount, templateSheet.columnCount),
        80,
      );

      for (let rowNumber = 1; rowNumber <= maxRow; rowNumber += 1) {
        const targetRow = targetSheet.getRow(rowNumber);
        const templateRow = templateSheet.getRow(rowNumber);

        for (let columnNumber = 1; columnNumber <= maxColumn; columnNumber += 1) {
          const targetCell = targetRow.getCell(columnNumber);
          if (this.isFormulaBackedCell(targetCell)) {
            continue;
          }
          if (!this.isBlankCellValue(targetCell.value)) {
            continue;
          }

          const templateCell = templateRow.getCell(columnNumber);
          const templateFormula = this.getFormulaModel(templateCell);
          if (!templateFormula) {
            continue;
          }

          const resolvedFormula = this.resolveFormulaExpression(
            templateCell,
            templateSheet,
            templateFormula,
          );
          if (!resolvedFormula) {
            continue;
          }

          targetCell.value = {
            formula: this.normalizeCopiedPerformanceFormula(resolvedFormula),
          } as ExcelJS.CellValue;
        }
      }
    });
  }

  private normalizeCopiedPerformanceFormula(formula: string) {
    const normalizedFormula = formula
      .replace(/'\[[^\]]+\]([^']+)'!/g, "'$1'!")
      .replace(/\[([^\]]+)\]([^'!\s]+)!/g, '$2!');

    return this.wrapFormulaVlookupError(normalizedFormula);
  }

  private wrapPerformanceVlookupFormulas(workbook: ExcelJS.Workbook) {
    workbook.worksheets.forEach((sheet) => {
      for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
        const row = sheet.getRow(rowNumber);
        for (
          let columnNumber = 1;
          columnNumber <= Math.min(sheet.columnCount, 80);
          columnNumber += 1
        ) {
          const cell = row.getCell(columnNumber);
          const formulaModel = this.getFormulaModel(cell);
          if (!formulaModel || !('formula' in formulaModel) || !formulaModel.formula) {
            continue;
          }

          const wrappedFormula = this.wrapFormulaVlookupError(
            formulaModel.formula,
          );
          if (wrappedFormula === formulaModel.formula) {
            continue;
          }

          cell.value = {
            ...formulaModel,
            formula: wrappedFormula,
          } as ExcelJS.CellValue;
        }
      }
    });
  }

  private wrapFormulaVlookupError(formula: string) {
    if (
      /VLOOKUP\s*\(/i.test(formula) &&
      !/^\s*IFERROR\s*\(/i.test(formula)
    ) {
      return `IFERROR(${formula},0)`;
    }

    return formula;
  }

  private findPerformanceTemplateSheet(
    templateWorkbook: ExcelJS.Workbook,
    targetSheetName: string,
  ) {
    if (targetSheetName === '0抽成绩效总表') {
      return (
        templateWorkbook.getWorksheet('HR手工核算数据') ||
        templateWorkbook.getWorksheet('AI生成') ||
        templateWorkbook.getWorksheet(targetSheetName)
      );
    }

    return templateWorkbook.getWorksheet(targetSheetName);
  }

  private async findPerformanceFormulaTemplatePath(
    currentPerformancePath: string,
    currentPerformanceName?: string,
  ) {
    const currentUpload = (
      await this.prisma.uploadFileFindMany({
        where: {
          category: 'performance',
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      })
    ).find((item) => item.filePath === currentPerformancePath);
    const currentMonthKeyword =
      (currentUpload && (await this.readUploadMonthKeyword(currentUpload))) ||
      this.extractMonthKeywordFromText(currentPerformanceName) ||
      this.extractMonthKeywordFromText(currentPerformancePath);

    let bestCandidate:
      | {
          filePath: string;
          sameMonth: boolean;
          score: number;
          mtimeMs: number;
        }
      | null = null;

    const candidatePaths = await this.collectTemplateCandidatePaths(
      'performance',
      [currentPerformancePath],
      [currentPerformancePath, currentUpload?.filePath || null],
      (fileName) =>
        fileName.toLowerCase().endsWith('.xlsx') &&
        !fileName.startsWith('~$') &&
        !fileName.startsWith('.~') &&
        /费用明细|绩效/.test(fileName) &&
        !/(test|测试|补空结果)/i.test(fileName),
    );

    for (const filePath of candidatePaths) {
      try {
        const fileStat = await stat(filePath);
        const candidateWorkbook = new ExcelJS.Workbook();
        await candidateWorkbook.xlsx.readFile(filePath);
        const hasHrTemplate = Boolean(
          candidateWorkbook.getWorksheet('HR手工核算数据'),
        );
        const hasAiTemplate = Boolean(candidateWorkbook.getWorksheet('AI生成'));
        const hasSummaryTemplate = Boolean(
          candidateWorkbook.getWorksheet('0抽成绩效总表'),
        );
        if (!hasHrTemplate && !hasAiTemplate && !hasSummaryTemplate) {
          continue;
        }

        const candidate = {
          filePath,
          sameMonth: currentMonthKeyword
            ? this.extractMonthKeywordFromText(filePath) === currentMonthKeyword
            : false,
          score: hasHrTemplate ? 3 : hasAiTemplate ? 2 : 1,
          mtimeMs: fileStat.mtimeMs,
        };
        if (
          !bestCandidate ||
          (candidate.sameMonth && !bestCandidate.sameMonth) ||
          (candidate.sameMonth === bestCandidate.sameMonth &&
            candidate.score > bestCandidate.score) ||
          (candidate.sameMonth === bestCandidate.sameMonth &&
            candidate.score === bestCandidate.score &&
            candidate.mtimeMs > bestCandidate.mtimeMs)
        ) {
          bestCandidate = candidate;
        }
      } catch {
        continue;
      }
    }

    return bestCandidate?.filePath || null;
  }

  private refreshPerformanceWorkbookResults(workbook: ExcelJS.Workbook) {
    for (let pass = 0; pass < 3; pass += 1) {
      workbook.worksheets.forEach((sheet) => {
        for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
          const row = sheet.getRow(rowNumber);
          for (
            let columnNumber = 1;
            columnNumber <= Math.min(sheet.columnCount, 80);
            columnNumber += 1
          ) {
            const cell = row.getCell(columnNumber);
            if (!this.isFormulaBackedCell(cell)) {
              continue;
            }

            const value = this.evaluateFormulaCell(cell, sheet, {
              forceRecalculate: true,
            });
            if (value === null) {
              continue;
            }

            this.setCalculatedCellValue(cell, value, {
              allowZero: true,
              overwriteNonFormula: false,
              overwriteFormulaResult: true,
            });
          }
        }
      });
    }
  }

  private async ensureConfirmedPerformanceReady() {
    const latestPerformance = await this.resolveActivePerformanceUpload();

    if (!latestPerformance) {
      throw new BadRequestException('performance workbook is required before payroll calculation');
    }

    const state = await this.readWorkflowState();
    if (state.confirmedPerformanceUploadId !== latestPerformance.id.toString()) {
      throw new BadRequestException('please confirm the latest performance result before payroll calculation');
    }
  }

  private async resolveActivePerformanceUpload() {
    const state = await this.readWorkflowState();
    if (state.confirmedPerformanceUploadId) {
      const confirmedId = BigInt(state.confirmedPerformanceUploadId);
      const confirmed = await this.prisma.uploadFileFindFirst({
        where: {
          category: 'performance',
          id: confirmedId,
        },
      });
      if (confirmed) {
        return confirmed;
      }
    }

    return this.prisma.uploadFileFindFirst({
      where: { category: 'performance' },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async resolveActiveSalaryUpload(monthKeyword?: string | null) {
    if (monthKeyword) {
      const matched = await this.prisma.uploadFileFindFirst({
        where: {
          category: 'salary',
          originalName: {
            contains: monthKeyword,
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (matched) {
        return matched;
      }
    }

    return this.prisma.uploadFileFindFirst({
      where: { category: 'salary' },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async readUploadMonthKeyword(upload: UploadRecord) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(upload.filePath);
    const monthFromSheet = this.findMonthSheet(workbook)?.name || null;
    if (monthFromSheet) {
      return monthFromSheet;
    }

    return this.extractMonthKeywordFromText(upload.originalName);
  }

  private extractMonthKeywordFromText(text: string | null | undefined) {
    const normalized = String(text || '');
    const directMatch = normalized.match(/(20\d{2})(0[1-9]|1[0-2])/);
    if (directMatch) {
      return `${directMatch[1]}${directMatch[2]}`;
    }

    const chineseMatch = normalized.match(/(20\d{2})年\s*(\d{1,2})月/);
    if (chineseMatch) {
      return `${chineseMatch[1]}${String(Number(chineseMatch[2])).padStart(2, '0')}`;
    }

    return null;
  }

  private async readWorkflowState(): Promise<WorkflowState> {
    try {
      const raw = await readFile(this.workflowStateFile, 'utf8');
      const parsed = JSON.parse(raw) as Partial<WorkflowState>;
      return {
        confirmedPerformanceUploadId:
          typeof parsed.confirmedPerformanceUploadId === 'string'
            ? parsed.confirmedPerformanceUploadId
            : null,
        confirmedAt:
          typeof parsed.confirmedAt === 'string' ? parsed.confirmedAt : null,
      };
    } catch {
      return {
        confirmedPerformanceUploadId: null,
        confirmedAt: null,
      };
    }
  }

  private async writeWorkflowState(state: WorkflowState) {
    await mkdir(this.uploadRootDir, { recursive: true });
    await writeFile(this.workflowStateFile, JSON.stringify(state, null, 2), 'utf8');
  }

  private fillEmptyValueCell(
    cell: ExcelJS.Cell,
    value: number,
    options?: {
      allowZero?: boolean;
    },
  ) {
    const allowZero = options?.allowZero ?? false;
    if (
      this.isFormulaBackedCell(cell) ||
      !this.isBlankCellValue(cell.value) ||
      !Number.isFinite(value) ||
      (!allowZero && value === 0)
    ) {
      return;
    }

    cell.value = value;
  }

  private setCalculatedCellValue(
    cell: ExcelJS.Cell,
    value: number,
    options?: {
      allowZero?: boolean;
      overwriteNonFormula?: boolean;
      overwriteFormulaResult?: boolean;
      preferLiteralOverwrite?: boolean;
    },
  ) {
    const allowZero = options?.allowZero ?? false;
    const overwriteNonFormula = options?.overwriteNonFormula ?? false;
    const overwriteFormulaResult = options?.overwriteFormulaResult ?? false;
    const preferLiteralOverwrite = options?.preferLiteralOverwrite ?? false;
    if (!Number.isFinite(value) || (!allowZero && value === 0)) {
      return;
    }

    if (preferLiteralOverwrite) {
      cell.value = value;
      return;
    }

    const formulaModel = this.getFormulaModel(cell);
    if (formulaModel) {
      const resolvedFormula = this.resolveFormulaExpression(
        cell,
        cell.worksheet,
        formulaModel,
      );
      if (resolvedFormula) {
        cell.value = {
          formula: resolvedFormula,
          result: value,
        } as ExcelJS.CellValue;
        return;
      }

      if (
        !overwriteFormulaResult &&
        'result' in formulaModel &&
        typeof formulaModel.result !== 'undefined' &&
        formulaModel.result !== null
      ) {
        const existingResult = this.parseNumber(
          this.normalizeHeaderValue(formulaModel.result as ExcelJS.CellValue),
        );
        if (Math.abs(existingResult - value) < 0.000001) {
          return;
        }
      }

      cell.value = {
        ...formulaModel,
        result: value,
      } as ExcelJS.CellValue;
      return;
    }

    if (overwriteNonFormula || this.isBlankCellValue(cell.value)) {
      cell.value = value;
    }
  }

  private getFormulaModel(cell: ExcelJS.Cell) {
    let directFormula: string | undefined;
    try {
      directFormula = cell.formula || undefined;
    } catch {
      directFormula = undefined;
    }

    const model = cell.model as
      | {
          formula?: string;
          sharedFormula?: string;
          shareType?: string;
          ref?: string;
          result?: ExcelJS.CellValue;
        }
      | undefined;

    if (directFormula) {
      return {
        formula: directFormula,
        result: model?.result,
      };
    }

    if (model?.formula) {
      return {
        formula: model.formula,
        ref: model.ref,
        shareType: model.shareType,
        result: model.result,
      };
    }

    if (model?.sharedFormula) {
      return {
        sharedFormula: model.sharedFormula,
        result: model.result,
      };
    }

    return null;
  }

  private isFormulaBackedCell(cell: ExcelJS.Cell) {
    let hasDirectFormula = false;
    try {
      hasDirectFormula = Boolean(cell.formula);
    } catch {
      hasDirectFormula = false;
    }

    const model = cell.model as
      | {
          formula?: string;
          sharedFormula?: string;
          shareType?: string;
        }
      | undefined;

    return Boolean(
      hasDirectFormula ||
        model?.formula ||
        model?.sharedFormula ||
        model?.shareType,
    );
  }

  private readCellNumber(cell: ExcelJS.Cell) {
    return this.parseNumber(this.normalizeHeaderValue(cell.value));
  }

  private resolveDoctorSummaryBonus(
    sheet: ExcelJS.Worksheet,
    rowNumber: number,
    employeeName: string,
    matched: PerformanceTemplateFillPreviewRow,
  ) {
    const bonusFromSummaryArea = this.findSummaryAreaBonusByName(sheet, employeeName);
    if (bonusFromSummaryArea !== 0) {
      return bonusFromSummaryArea;
    }

    if (matched.bonus !== 0) {
      return matched.bonus;
    }

    const row = sheet.getRow(rowNumber);
    const noteText = this.normalizeHeaderValue(row.getCell(12).value);
    const previousRowRevenue =
      rowNumber > 4 ? this.readCellNumber(sheet.getRow(rowNumber - 1).getCell(13)) : 0;

    if (noteText.includes('固定工资') && previousRowRevenue > 0) {
      if (previousRowRevenue < 90000) {
        return 0;
      }
      if (previousRowRevenue < 120000) {
        return 500;
      }
      if (previousRowRevenue < 150000) {
        return 1000;
      }
      return 1500;
    }

    const commissionMatch = noteText.match(/实收治疗费(\d+(?:\.\d+)?)%/);
    if (commissionMatch && previousRowRevenue > 0) {
      return this.roundMoney(previousRowRevenue * (Number(commissionMatch[1]) / 100));
    }

    if (employeeName === '刘小贞') {
      return 200;
    }

    return 0;
  }

  private refreshDoctorSummaryFooter(
    doctorSheet: ExcelJS.Worksheet,
    staffSheet: ExcelJS.Worksheet | undefined,
  ) {
    const footerRows = this.detectDoctorFooterRows(doctorSheet);
    if (!footerRows.totalRowNumber) {
      return;
    }

    const totalRowNumber = footerRows.totalRowNumber;
    const dataEndRow = totalRowNumber - 1;
    const sumRange = (column: number, startRow: number, endRow: number) => {
      let total = 0;
      for (let rowNumber = startRow; rowNumber <= endRow; rowNumber += 1) {
        total += this.readCellNumber(doctorSheet.getRow(rowNumber).getCell(column));
      }
      return this.roundMoney(total);
    };

    const setFormulaResult = (
      cell: ExcelJS.Cell,
      result: number | null,
      options?: { allowNull?: boolean },
    ) => {
      const formulaModel = this.getFormulaModel(cell);
      if (!formulaModel) {
        if (result !== null || options?.allowNull) {
          cell.value = result;
        }
        return;
      }

      cell.value = {
        ...formulaModel,
        result,
      } as ExcelJS.CellValue;
    };

    const totalBaseSalary = sumRange(6, 4, dataEndRow);
    const totalCommissionSalary = sumRange(7, 4, dataEndRow);
    const totalPerformanceSalary = sumRange(8, 4, dataEndRow);
    const totalBonus = sumRange(9, 4, dataEndRow);
    const totalAllowance = sumRange(10, 4, dataEndRow);
    const totalPay = sumRange(11, 4, dataEndRow);

    const totalRow = doctorSheet.getRow(totalRowNumber);
    setFormulaResult(totalRow.getCell(6), totalBaseSalary);
    setFormulaResult(totalRow.getCell(7), totalCommissionSalary);
    setFormulaResult(totalRow.getCell(8), totalPerformanceSalary);
    setFormulaResult(totalRow.getCell(9), totalBonus);
    setFormulaResult(
      totalRow.getCell(10),
      totalAllowance === 0 ? null : totalAllowance,
      { allowNull: true },
    );
    setFormulaResult(totalRow.getCell(11), totalPay);

    if (footerRows.checkRowNumber) {
      const checkCell = doctorSheet.getRow(footerRows.checkRowNumber).getCell(11);
      const checkValue = this.evaluateFormulaCell(checkCell, doctorSheet);
      if (checkValue !== null) {
        setFormulaResult(checkCell, this.roundMoney(checkValue));
      }
    }

    if (footerRows.balanceRowNumber) {
      const balanceRow = doctorSheet.getRow(footerRows.balanceRowNumber);
      for (const column of [6, 7, 8]) {
        const cell = balanceRow.getCell(column);
        const value = this.evaluateFormulaCell(cell, doctorSheet);
        if (value !== null) {
          const roundedValue = this.roundMoney(value);
          setFormulaResult(cell, Math.abs(roundedValue) < 0.01 ? 0 : roundedValue, {
            allowNull: true,
          });
        }
      }
    }
  }

  private detectDoctorFooterRows(sheet: ExcelJS.Worksheet): FooterRowMarkers {
    let totalRowNumber: number | null = null;
    let checkRowNumber: number | null = null;
    let balanceRowNumber: number | null = null;

    for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const row = sheet.getRow(rowNumber);
      const columnD = this.normalizeHeaderValue(row.getCell(4).value);
      const columnE = this.normalizeHeaderValue(row.getCell(5).value);
      const columnI = this.normalizeHeaderValue(row.getCell(9).value);

      if (!totalRowNumber && columnD === '合计') {
        totalRowNumber = rowNumber;
      }

      if (!checkRowNumber && columnI === 'check') {
        checkRowNumber = rowNumber;
      }

      if (!balanceRowNumber && columnE === 'check') {
        balanceRowNumber = rowNumber;
      }
    }

    return {
      totalRowNumber,
      checkRowNumber,
      balanceRowNumber,
    };
  }

  private evaluateFormulaCell(
    cell: ExcelJS.Cell,
    currentSheet: ExcelJS.Worksheet,
    options?: { forceRecalculate?: boolean },
  ) {
    const formulaModel = this.getFormulaModel(cell);
    if (!formulaModel) {
      return this.readCellNumber(cell);
    }

    const directResult =
      typeof (formulaModel as { result?: ExcelJS.CellValue }).result !== 'undefined'
        ? this.parseNumber(
            this.normalizeHeaderValue(
              (formulaModel as { result?: ExcelJS.CellValue }).result as
                | ExcelJS.CellValue
                | undefined,
            ),
          )
        : 0;

    const isMonthSheet = /20\d{4}/.test(currentSheet.name);
    if (!options?.forceRecalculate && !isMonthSheet && directResult !== 0) {
      return directResult;
    }

    const resolvedFormula = this.resolveFormulaExpression(
      cell,
      currentSheet,
      formulaModel,
    );

    if (!resolvedFormula) {
      if (directResult !== 0) {
        return directResult;
      }
      return this.readCellNumber(cell);
    }

    let expression = resolvedFormula;
    expression = expression.replace(/\$/g, '');
    expression = this.replacePercentageLiterals(expression);
    expression = this.evaluateVlookupFunctions(
      expression,
      currentSheet.workbook,
      currentSheet,
    );
    expression = this.evaluateIfErrorFunctions(expression, currentSheet);
    expression = this.evaluateIfFunctions(expression, currentSheet);
    expression = this.evaluateRoundFunctions(expression, currentSheet);
    expression = expression.replace(
      /SUM\(([A-Z]+\d+):([A-Z]+\d+)\)/g,
      (_match, startRef: string, endRef: string) =>
        String(this.sumRangeRefs(currentSheet, startRef, endRef)),
    );
    expression = expression.replace(
      /COUNT\(([A-Z]+\d+):([A-Z]+\d+)\)/g,
      (_match, startRef: string, endRef: string) =>
        String(this.countRangeRefs(currentSheet, startRef, endRef)),
    );

    expression = expression.replace(
      /'([^']+)'!([A-Z]+\d+)/g,
      (_match, sheetName: string, ref: string) =>
        String(
          this.readWorkbookCellNumber(currentSheet.workbook, sheetName, ref),
        ),
    );

    expression = expression.replace(
      /\b([A-Z]+\d+)\b/g,
      (_match, ref: string, offset: number, source: string) => {
        const previousChar = offset > 0 ? source[offset - 1] : '';
        const nextChar = offset + ref.length < source.length ? source[offset + ref.length] : '';
        if (!this.isCellReference(ref)) {
          return ref;
        }
        if (previousChar === '"' || previousChar === "'") {
          return ref;
        }
        if (nextChar === '(') {
          return ref;
        }
        try {
          this.parseCellRef(ref);
        } catch {
          this.logger.warn(
            `skip invalid formula ref ${ref} in expression ${source} for ${currentSheet.name}!${cell.address}`,
          );
          return ref;
        }
        return String(this.readComputedCellNumber(currentSheet.getCell(ref), currentSheet));
      },
    );

    try {
      const value = Function(`"use strict"; return (${expression});`)();
      if (!Number.isFinite(value)) {
        return null;
      }
      return value;
    } catch {
      return directResult !== 0 ? directResult : this.readCellNumber(cell);
    }
  }

  private evaluateFormulaText(
    formula: string,
    targetCell: ExcelJS.Cell,
    currentSheet: ExcelJS.Worksheet,
  ) {
    const previousValue = this.cloneCellValue(targetCell.value);
    targetCell.value = { formula } as ExcelJS.CellValue;
    const evaluated = this.evaluateFormulaCell(targetCell, currentSheet, {
      forceRecalculate: true,
    });
    targetCell.value = previousValue;
    return evaluated;
  }

  private readWorkbookCellNumber(
    workbook: ExcelJS.Workbook,
    sheetName: string,
    ref: string,
  ) {
    const sheet = workbook.getWorksheet(sheetName);
    if (!sheet || !this.isCellReference(ref)) {
      return 0;
    }

    return this.readComputedCellNumber(sheet.getCell(ref), sheet);
  }

  private sumRangeRefs(
    sheet: ExcelJS.Worksheet,
    startRef: string,
    endRef: string,
  ) {
    const start = this.parseCellRef(startRef);
    const end = this.parseCellRef(endRef);
    let total = 0;
    for (let rowNumber = start.row; rowNumber <= end.row; rowNumber += 1) {
      for (let column = start.column; column <= end.column; column += 1) {
        total += this.readComputedCellNumber(
          sheet.getRow(rowNumber).getCell(column),
          sheet,
        );
      }
    }
    return total;
  }

  private countRangeRefs(
    sheet: ExcelJS.Worksheet,
    startRef: string,
    endRef: string,
  ) {
    const start = this.parseCellRef(startRef);
    const end = this.parseCellRef(endRef);
    let total = 0;
    for (let rowNumber = start.row; rowNumber <= end.row; rowNumber += 1) {
      for (let column = start.column; column <= end.column; column += 1) {
        const rawValue = sheet.getRow(rowNumber).getCell(column).value;
        const normalized = this.normalizeHeaderValue(rawValue);
        if (normalized !== '' && normalized !== '/') {
          total += 1;
        }
      }
    }
    return total;
  }

  private readComputedCellNumber(
    cell: ExcelJS.Cell,
    sheet: ExcelJS.Worksheet,
  ) {
    if (this.isFormulaBackedCell(cell)) {
      const evaluated = this.evaluateFormulaCell(cell, sheet);
      if (evaluated !== null) {
        return evaluated;
      }
    }

    return this.readCellNumber(cell);
  }

  private resolveFormulaExpression(
    cell: ExcelJS.Cell,
    currentSheet: ExcelJS.Worksheet,
    formulaModel: ReturnType<UploadsService['getFormulaModel']>,
  ) {
    if (!formulaModel) {
      return null;
    }

    if ('formula' in formulaModel && formulaModel.formula) {
      return formulaModel.formula;
    }

    if ('sharedFormula' in formulaModel && formulaModel.sharedFormula) {
      const masterRef = formulaModel.sharedFormula;
      if (!this.isCellReference(masterRef)) {
        return null;
      }
      const masterCell = currentSheet.getCell(masterRef);
      const masterModel = this.getFormulaModel(masterCell);
      if (!masterModel || !('formula' in masterModel) || !masterModel.formula) {
        return null;
      }

      const currentRef = this.parseCellRef(cell.address);
      const baseRef = this.parseCellRef(masterRef);
      const rowOffset = currentRef.row - baseRef.row;
      const columnOffset = currentRef.column - baseRef.column;

      return this.shiftFormulaReferences(
        masterModel.formula,
        rowOffset,
        columnOffset,
      );
    }

    return null;
  }

  private shiftFormulaReferences(
    formula: string,
    rowOffset: number,
    columnOffset: number,
  ) {
    return formula.replace(
      /((?:'[^']+'!)?)(\$?)([A-Z]+)(\$?)(\d+)/g,
      (
        _match,
        sheetPrefix: string,
        absCol: string,
        colLetters: string,
        absRow: string,
        rowNumber: string,
      ) => {
        const originalColumn = this.columnLettersToNumber(colLetters);
        const originalRow = Number(rowNumber);
        const shiftedColumn = absCol
          ? originalColumn
          : Math.max(1, originalColumn + columnOffset);
        const shiftedRow = absRow
          ? originalRow
          : Math.max(1, originalRow + rowOffset);

        return `${sheetPrefix}${absCol}${this.columnNumberToLetters(
          shiftedColumn,
        )}${absRow}${shiftedRow}`;
      },
    );
  }

  private evaluateRoundFunctions(
    expression: string,
    currentSheet: ExcelJS.Worksheet,
  ) {
    let resolved = expression;
    let previous = '';
    while (previous !== resolved) {
      previous = resolved;
      resolved = this.replaceRoundOnce(resolved, currentSheet);
    }

    return resolved;
  }

  private replaceRoundOnce(
    expression: string,
    currentSheet: ExcelJS.Worksheet,
  ) {
    const roundStart = expression.indexOf('ROUND(');
    if (roundStart === -1) {
      return expression;
    }

    const argsStart = roundStart + 'ROUND('.length;
    let depth = 1;
    let endIndex = -1;
    for (let index = argsStart; index < expression.length; index += 1) {
      const char = expression[index];
      if (char === '(') {
        depth += 1;
      } else if (char === ')') {
        depth -= 1;
        if (depth === 0) {
          endIndex = index;
          break;
        }
      }
    }

    if (endIndex === -1) {
      return expression;
    }

    const argsText = expression.slice(argsStart, endIndex);
    let splitIndex = -1;
    depth = 0;
    for (let index = argsText.length - 1; index >= 0; index -= 1) {
      const char = argsText[index];
      if (char === ')') {
        depth += 1;
      } else if (char === '(') {
        depth -= 1;
      } else if (char === ',' && depth === 0) {
        splitIndex = index;
        break;
      }
    }

    if (splitIndex === -1) {
      return expression;
    }

    const innerExpression = argsText.slice(0, splitIndex).trim();
    const precisionText = argsText.slice(splitIndex + 1).trim();
    const value = this.evaluateArithmeticExpression(innerExpression, currentSheet);
    const digits = Number(precisionText);
    const replacement = Number.isFinite(value) && Number.isFinite(digits)
      ? String(Math.round(value * 10 ** digits) / 10 ** digits)
      : '0';

    return `${expression.slice(0, roundStart)}${replacement}${expression.slice(endIndex + 1)}`;
  }

  private evaluateIfFunctions(
    expression: string,
    currentSheet: ExcelJS.Worksheet,
  ) {
    let resolved = expression;
    let previous = '';
    while (previous !== resolved) {
      previous = resolved;
      resolved = this.replaceIfOnce(resolved, currentSheet);
    }

    return resolved;
  }

  private evaluateIfErrorFunctions(
    expression: string,
    currentSheet: ExcelJS.Worksheet,
  ) {
    let resolved = expression;
    let previous = '';
    while (previous !== resolved) {
      previous = resolved;
      resolved = this.replaceIfErrorOnce(resolved, currentSheet);
    }

    return resolved;
  }

  private replaceIfErrorOnce(
    expression: string,
    currentSheet: ExcelJS.Worksheet,
  ) {
    const ifErrorStart = expression.lastIndexOf('IFERROR(');
    if (ifErrorStart === -1) {
      return expression;
    }

    const argsStart = ifErrorStart + 'IFERROR('.length;
    let depth = 0;
    let endIndex = -1;
    for (let index = argsStart; index < expression.length; index += 1) {
      const char = expression[index];
      if (char === '(') {
        depth += 1;
      } else if (char === ')') {
        if (depth === 0) {
          endIndex = index;
          break;
        }
        depth -= 1;
      }
    }

    if (endIndex === -1) {
      return expression;
    }

    const argsText = expression.slice(argsStart, endIndex);
    const args = this.splitFormulaArguments(argsText);
    if (args.length !== 2) {
      return expression;
    }

    const primaryValue = this.evaluateArithmeticExpression(args[0], currentSheet);
    const fallbackValue = this.evaluateArithmeticExpression(args[1], currentSheet);
    const replacement = Number.isFinite(primaryValue)
      ? String(primaryValue)
      : String(Number.isFinite(fallbackValue) ? fallbackValue : 0);

    return `${expression.slice(0, ifErrorStart)}${replacement}${expression.slice(
      endIndex + 1,
    )}`;
  }

  private replaceIfOnce(expression: string, currentSheet: ExcelJS.Worksheet) {
    const ifStart = expression.lastIndexOf('IF(');
    if (ifStart === -1) {
      return expression;
    }

    const argsStart = ifStart + 3;
    let depth = 0;
    let endIndex = -1;
    for (let index = argsStart; index < expression.length; index += 1) {
      const char = expression[index];
      if (char === '(') {
        depth += 1;
      } else if (char === ')') {
        if (depth === 0) {
          endIndex = index;
          break;
        }
        depth -= 1;
      }
    }

    if (endIndex === -1) {
      return expression;
    }

    const argsText = expression.slice(argsStart, endIndex);
    const args = this.splitFormulaArguments(argsText);
    if (args.length !== 3) {
      return expression;
    }

    const condition = this.evaluateConditionExpression(args[0], currentSheet);
    const targetExpression = condition ? args[1] : args[2];
    const replacement = String(
      this.evaluateArithmeticExpression(targetExpression, currentSheet),
    );

    return `${expression.slice(0, ifStart)}${replacement}${expression.slice(
      endIndex + 1,
    )}`;
  }

  private splitFormulaArguments(argsText: string) {
    const args: string[] = [];
    let depth = 0;
    let start = 0;
    for (let index = 0; index < argsText.length; index += 1) {
      const char = argsText[index];
      if (char === '(') {
        depth += 1;
      } else if (char === ')') {
        depth -= 1;
      } else if (char === ',' && depth === 0) {
        args.push(argsText.slice(start, index).trim());
        start = index + 1;
      }
    }
    args.push(argsText.slice(start).trim());
    return args;
  }

  private evaluateVlookupFunctions(
    expression: string,
    workbook: ExcelJS.Workbook,
    currentSheet: ExcelJS.Worksheet,
  ) {
    const resolveLookup = (
      lookupExpression: string,
      sheet: ExcelJS.Worksheet,
      startRef: string,
      endRef: string,
      lookupIndex: string,
    ) => {
      const lookupValue = this.normalizeComparisonValue(
        this.resolveLookupValue(lookupExpression, workbook, currentSheet),
      );
      if (!lookupValue) {
        return '0';
      }

      const normalizedStartRef = startRef.replace(/\$/g, '');
      const normalizedEndRef = endRef.replace(/\$/g, '');
      const startMatch = normalizedStartRef.match(/^([A-Z]+)(\d+)?$/);
      const endMatch = normalizedEndRef.match(/^([A-Z]+)(\d+)?$/);
      if (!startMatch || !endMatch) {
        return '0';
      }

      const startColumn = this.columnLettersToNumber(startMatch[1]);
      const endColumn = this.columnLettersToNumber(endMatch[1]);
      const startRow = startMatch[2] ? Number(startMatch[2]) : 1;
      const endRow = endMatch[2] ? Number(endMatch[2]) : sheet.rowCount;
      const targetColumn = startColumn + Number(lookupIndex) - 1;

      for (let rowNumber = startRow; rowNumber <= endRow; rowNumber += 1) {
        const row = sheet.getRow(rowNumber);
        const candidate = this.normalizeComparisonValue(
          this.normalizeHeaderValue(row.getCell(startColumn).value),
        );
        if (!candidate || candidate !== lookupValue) {
          continue;
        }

        if (targetColumn < startColumn || targetColumn > endColumn) {
          return '0';
        }

        const cell = row.getCell(targetColumn);
        const formulaValue = this.getFormulaModel(cell)
          ? this.evaluateFormulaCell(cell, sheet)
          : this.readCellNumber(cell);

        const rawText = this.normalizeHeaderValue(cell.value);
        if (
          (formulaValue === 0 || !Number.isFinite(formulaValue)) &&
          rawText &&
          rawText !== '0'
        ) {
          return String(this.parseNumber(rawText));
        }

        return String(formulaValue || 0);
      }

      return '0';
    };

    const withExternalSheet = expression.replace(
      /VLOOKUP\(([^,]+),\s*(?:'([^']+)'|([^\s!,]+))!((?:\$?[A-Z]+\$?\d*)):((?:\$?[A-Z]+\$?\d*)),\s*(\d+),\s*0\)/g,
      (
        _match,
        lookupExpression: string,
        quotedSheetName: string | undefined,
        plainSheetName: string | undefined,
        startRef: string,
        endRef: string,
        lookupIndex: string,
      ) => {
        const sheetName = quotedSheetName || plainSheetName || '';
        const sheet = workbook.getWorksheet(sheetName);
        if (!sheet) {
          return '0';
        }

        return resolveLookup(
          lookupExpression,
          sheet,
          startRef,
          endRef,
          lookupIndex,
        );
      },
    );

    return withExternalSheet.replace(
      /VLOOKUP\(([^,]+),\s*((?:\$?[A-Z]+\$?\d*)):((?:\$?[A-Z]+\$?\d*)),\s*(\d+),\s*0\)/g,
      (
        _match,
        lookupExpression: string,
        startRef: string,
        endRef: string,
        lookupIndex: string,
      ) =>
        resolveLookup(
          lookupExpression,
          currentSheet,
          startRef,
          endRef,
          lookupIndex,
        ),
    );
  }

  private resolveLookupValue(
    lookupExpression: string,
    workbook: ExcelJS.Workbook,
    currentSheet: ExcelJS.Worksheet,
  ) {
    const trimmed = lookupExpression.trim().replace(/\$/g, '');
    const currentCellRef = trimmed.match(/^[A-Z]+\d+$/);
    if (currentCellRef) {
      return this.normalizeHeaderValue(currentSheet.getCell(trimmed).value);
    }

    const crossSheetRef = trimmed.match(/^(?:'([^']+)'|([^\s!]+))!([A-Z]+\d+)$/);
    if (crossSheetRef) {
      const sheetName = crossSheetRef[1] || crossSheetRef[2] || '';
      const ref = crossSheetRef[3];
      if (!this.isCellReference(ref)) {
        return '';
      }
      return this.normalizeHeaderValue(
        workbook.getWorksheet(sheetName)?.getCell(ref).value,
      );
    }

    return trimmed.replace(/^"|"$/g, '');
  }

  private evaluateConditionExpression(
    expression: string,
    currentSheet: ExcelJS.Worksheet,
  ) {
    const operators = ['>=', '<=', '<>', '>', '<', '='];
    for (const operator of operators) {
      const index = expression.indexOf(operator);
      if (index === -1) {
        continue;
      }

      const leftExpression = expression.slice(0, index);
      const rightExpression = expression.slice(index + operator.length);
      const left = this.evaluateArithmeticExpression(leftExpression, currentSheet);
      const right = this.evaluateArithmeticExpression(rightExpression, currentSheet);

      switch (operator) {
        case '>=':
          return left >= right;
        case '<=':
          return left <= right;
        case '<>':
          return left !== right;
        case '>':
          return left > right;
        case '<':
          return left < right;
        case '=':
          return left === right;
        default:
          return false;
      }
    }

    return this.evaluateArithmeticExpression(expression, currentSheet) !== 0;
  }

  private evaluateArithmeticExpression(
    expression: string,
    currentSheet: ExcelJS.Worksheet,
  ) {
    let resolved = expression.replace(/\$/g, '');
    resolved = this.replacePercentageLiterals(resolved);
    resolved = resolved.replace(
      /SUM\(([A-Z]+\d+):([A-Z]+\d+)\)/g,
      (_match, startRef: string, endRef: string) =>
        String(this.sumRangeRefs(currentSheet, startRef, endRef)),
    );
    resolved = resolved.replace(
      /COUNT\(([A-Z]+\d+):([A-Z]+\d+)\)/g,
      (_match, startRef: string, endRef: string) =>
        String(this.countRangeRefs(currentSheet, startRef, endRef)),
    );
    resolved = resolved.replace(
      /\b([A-Z]+\d+)\b/g,
      (_match, ref: string, offset: number, source: string) => {
        const previousChar = offset > 0 ? source[offset - 1] : '';
        const nextChar = offset + ref.length < source.length ? source[offset + ref.length] : '';
        if (!this.isCellReference(ref)) {
          return ref;
        }
        if (previousChar === '"' || previousChar === "'") {
          return ref;
        }
        if (nextChar === '(') {
          return ref;
        }
        try {
          this.parseCellRef(ref);
        } catch {
          this.logger.warn(
            `skip invalid arithmetic ref ${ref} in expression ${source} for sheet ${currentSheet.name}`,
          );
          return ref;
        }
        return String(this.readComputedCellNumber(currentSheet.getCell(ref), currentSheet));
      },
    );

    try {
      const value = Function(`"use strict"; return (${resolved});`)();
      return Number.isFinite(value) ? value : 0;
    } catch {
      return 0;
    }
  }

  private replacePercentageLiterals(expression: string) {
    return expression.replace(
      /(^|[=(,+\-*/<>])\s*(\d+(?:\.\d+)?)%/g,
      (_match, prefix: string, percentValue: string) =>
        `${prefix}(${percentValue}/100)`,
    );
  }

  private parseCellRef(ref: string) {
    const match = ref.match(/^([A-Z]+)(\d+)$/);
    if (!match) {
      throw new Error(`Invalid cell reference: ${ref}`);
    }

    const [, letters, digits] = match;
    let column = 0;
    for (const letter of letters) {
      column = column * 26 + (letter.charCodeAt(0) - 64);
    }

    return {
      column,
      row: Number(digits),
    };
  }

  private isCellReference(ref: string) {
    return /^[A-Z]{1,3}\d+$/.test(ref);
  }

  private columnLettersToNumber(letters: string) {
    let column = 0;
    for (const letter of letters) {
      column = column * 26 + (letter.charCodeAt(0) - 64);
    }
    return column;
  }

  private columnNumberToLetters(column: number) {
    let current = column;
    let letters = '';
    while (current > 0) {
      const remainder = (current - 1) % 26;
      letters = String.fromCharCode(65 + remainder) + letters;
      current = Math.floor((current - 1) / 26);
    }
    return letters;
  }

  private normalizeComparisonValue(value: string) {
    return value.replace(/\s+/g, '').trim();
  }

  private findSummaryAreaBonusByName(sheet: ExcelJS.Worksheet, employeeName: string) {
    for (let currentRow = 5; currentRow <= sheet.rowCount; currentRow += 1) {
      const summaryName = this.normalizeHeaderValue(sheet.getRow(currentRow).getCell(16).value);
      if (summaryName !== employeeName) {
        continue;
      }

      return this.readCellNumber(sheet.getRow(currentRow).getCell(18));
    }

    return 0;
  }

  private isBlankCellValue(
    value: ExcelJS.CellValue | ExcelJS.CellFormulaValue | null | undefined,
  ) {
    if (value === null || value === undefined) {
      return true;
    }

    if (typeof value === 'string') {
      return value.trim().length === 0;
    }

    return false;
  }

  private async buildPayrollDraftResult(): Promise<PayrollDraftResult> {
    const latestSalary = await this.prisma.uploadFileFindFirst({
      where: { category: 'salary' },
      orderBy: { createdAt: 'desc' },
    });

    if (!latestSalary) {
      throw new BadRequestException('salary workbook is required before calculation');
    }

    const salaryRows = await this.parseSalaryWorkbook(latestSalary.filePath);
    const performanceResult = await this.buildPerformanceResultFromAvailableSource();
    const performanceRows = performanceResult.rows;

    const performanceByName = new Map(
      performanceRows.map((item) => [item.employeeName, item]),
    );

    const rows: PayrollDraftRow[] = salaryRows.map((salary) => {
      const performance = performanceByName.get(salary.employeeName);
      const salaryPerformanceSalary = salary.performanceSalary;
      const salaryCommissionSalary = salary.commissionSalary;
      const salaryAllowance = salary.allowance;
      const mergedPerformanceSalary = this.coalesceNumber(
        performance?.performanceSalary,
        0,
      );
      const mergedCommissionSalary = this.coalesceNumber(
        performance?.commissionSalary,
        0,
      );
      const mergedAllowance = this.coalesceNumber(performance?.allowance, 0);
      const performanceDecision = this.resolveFieldValue(
        'performanceSalary',
        salaryPerformanceSalary,
        mergedPerformanceSalary,
      );
      const commissionDecision = this.resolveFieldValue(
        'commissionSalary',
        salaryCommissionSalary,
        mergedCommissionSalary,
      );
      const allowanceDecision = this.resolveFieldValue(
        'allowance',
        salaryAllowance,
        mergedAllowance,
      );
      const performanceSalary = performanceDecision.finalValue;
      const commissionSalary = commissionDecision.finalValue;
      const allowance = allowanceDecision.finalValue;
      const grossPay =
        salary.baseSalary + performanceSalary + commissionSalary + allowance;
      const deductions = salary.socialSecurity + salary.housingFund + salary.tax;
      const anomalies = this.detectPayrollAnomalies({
        department: salary.department,
        position: salary.position,
        salaryPerformanceSalary,
        mergedPerformanceSalary,
        salaryCommissionSalary,
        mergedCommissionSalary,
        salaryAllowance,
        mergedAllowance,
        socialSecurity: salary.socialSecurity,
        housingFund: salary.housingFund,
      });

      return {
        employeeName: salary.employeeName,
        department: salary.department,
        position: salary.position,
        baseSalary: salary.baseSalary,
        salaryPerformanceSalary,
        mergedPerformanceSalary,
        performanceSalary,
        salaryCommissionSalary,
        mergedCommissionSalary,
        commissionSalary,
        salaryAllowance,
        mergedAllowance,
        allowance,
        socialSecurity: salary.socialSecurity,
        housingFund: salary.housingFund,
        tax: salary.tax,
        grossPay: this.roundMoney(grossPay),
        deductions: this.roundMoney(deductions),
        netPayDraft: this.roundMoney(grossPay - deductions),
        sources: performance
          ? ['salary workbook', 'performance workbook']
          : ['salary workbook'],
        anomalies,
        detailBuckets: [
          {
            title: '基础信息',
            items: [
              { label: '姓名', value: salary.employeeName },
              { label: '部门', value: salary.department || '-' },
              { label: '岗位', value: salary.position || '-' },
              { label: '岗位薪资', value: salary.baseSalary },
            ],
          },
          {
            title: '收入构成',
            items: [
              { label: '绩效工资', value: performanceSalary },
              { label: '抽成工资', value: commissionSalary },
              { label: '补贴', value: allowance },
              { label: '应发合计', value: this.roundMoney(grossPay) },
            ],
          },
          {
            title: '扣款构成',
            items: [
              { label: '社保', value: salary.socialSecurity },
              { label: '公积金', value: salary.housingFund },
              { label: '税额估算', value: salary.tax },
              { label: '扣减合计', value: this.roundMoney(deductions) },
            ],
          },
          {
            title: '结果汇总',
            items: [
              { label: '实发草稿', value: this.roundMoney(grossPay - deductions) },
              { label: '来源', value: performance ? '工资表 + 绩效表' : '工资表' },
              { label: '异常数', value: anomalies.length },
            ],
          },
        ],
        reconciliation: [
          performanceDecision,
          commissionDecision,
          allowanceDecision,
        ],
      };
    });

    const anomalyCount = rows.filter((row) => row.anomalies.length > 0).length;
    const previewRows = rows
      .sort((a, b) => b.netPayDraft - a.netPayDraft)
      .slice(0, 20);

    return {
      salaryWorkbook: {
        id: latestSalary.id.toString(),
        originalName: latestSalary.originalName,
      },
      performanceWorkbook: performanceResult.workbook,
      summary: {
        employeeCount: rows.length,
        totalGrossPay: this.roundMoney(
          rows.reduce((sum, item) => sum + item.grossPay, 0),
        ),
        totalDeductions: this.roundMoney(
          rows.reduce((sum, item) => sum + item.deductions, 0),
        ),
        totalNetPayDraft: this.roundMoney(
          rows.reduce((sum, item) => sum + item.netPayDraft, 0),
        ),
        anomalyCount,
      },
      rules: this.payrollFieldRules.map((rule) => ({
        key: rule.key,
        label: rule.label,
        priority: rule.priority,
      })),
      previewRows,
      allRows: rows,
    };
  }

  private async buildTemplateFillResult(): Promise<TemplateFillResult> {
    this.logger.log('buildTemplateFillResult:start');
    const { result } = await this.prepareTemplateWorkbook();
    this.logger.log('buildTemplateFillResult:done');
    return result;
  }

  private async buildPerformanceResult(): Promise<PerformanceResult> {
    const performanceSource = await this.buildPerformanceResultFromAvailableSource();
    const rows = performanceSource.rows;
    if (!performanceSource.workbook) {
      throw new BadRequestException('performance workbook is required before payroll calculation');
    }
    const previewRows = rows.slice(0, 50);
    const doctorCount = rows.filter((item) => item.employeeType === 'doctor').length;
    const staffCount = rows.filter((item) => item.employeeType === 'staff').length;

    return {
      performanceWorkbook: performanceSource.workbook,
      summary: {
        employeeCount: rows.length,
        doctorCount,
        staffCount,
        totalBaseSalary: this.roundMoney(rows.reduce((sum, item) => sum + item.baseSalary, 0)),
        totalCommissionSalary: this.roundMoney(rows.reduce((sum, item) => sum + item.commissionSalary, 0)),
        totalPerformanceSalary: this.roundMoney(rows.reduce((sum, item) => sum + item.performanceSalary, 0)),
        totalBonus: this.roundMoney(rows.reduce((sum, item) => sum + item.bonus, 0)),
        totalAllowance: this.roundMoney(rows.reduce((sum, item) => sum + item.allowance, 0)),
        totalPay: this.roundMoney(rows.reduce((sum, item) => sum + item.totalPay, 0)),
      },
      previewRows,
      allRows: rows,
    };
  }

  private async preparePerformanceTemplateWorkbook(): Promise<PerformanceTemplateFillResult> {
    const latestPerformance = await this.prisma.uploadFileFindFirst({
      where: { category: 'performance' },
      orderBy: { createdAt: 'desc' },
    });

    if (!latestPerformance) {
      throw new BadRequestException('performance workbook is required before performance fill');
    }

    const rows = await this.parsePerformanceWorkbook(latestPerformance.filePath);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(latestPerformance.filePath);

    const doctorSheet =
      workbook.getWorksheet('0抽成绩效总表') || workbook.getWorksheet('枋湖馆绩效提成');
    const staffSheet = workbook.getWorksheet('2工作人员绩效情况表');

    const doctorRowByName = new Map<string, number>();
    const staffRowByName = new Map<string, number>();

    if (doctorSheet) {
      for (let rowNumber = 4; rowNumber <= doctorSheet.rowCount; rowNumber += 1) {
        const name = this.normalizeHeaderValue(doctorSheet.getRow(rowNumber).getCell(4).value);
        if (this.isEmployeeName(name)) {
          doctorRowByName.set(name, rowNumber);
        }
      }
    }

    if (staffSheet) {
      for (let rowNumber = 4; rowNumber <= staffSheet.rowCount; rowNumber += 1) {
        const name = this.normalizeHeaderValue(staffSheet.getRow(rowNumber).getCell(4).value);
        if (this.isEmployeeName(name)) {
          staffRowByName.set(name, rowNumber);
        }
      }
    }

    const resultByName = new Map(rows.map((row) => [row.employeeName, row]));
    const previewRows: PerformanceTemplateFillPreviewRow[] = [];

    if (doctorSheet) {
      for (let rowNumber = 4; rowNumber <= doctorSheet.rowCount; rowNumber += 1) {
        const row = doctorSheet.getRow(rowNumber);
        const employeeName = this.normalizeHeaderValue(row.getCell(4).value);
        if (!this.isEmployeeName(employeeName)) {
          continue;
        }

        const matched = resultByName.get(employeeName);
        previewRows.push({
          employeeName,
          employeeType: matched?.employeeType || 'staff',
          sheetName: doctorSheet.name,
          rowNumber,
          baseSalary: matched?.baseSalary || 0,
          commissionSalary: matched?.commissionSalary || 0,
          performanceSalary: matched?.performanceSalary || 0,
          bonus: matched?.bonus || 0,
          allowance: matched?.allowance || 0,
          totalPay: matched?.totalPay || 0,
        });
      }
    }

    if (staffSheet) {
      for (let rowNumber = 4; rowNumber <= staffSheet.rowCount; rowNumber += 1) {
        const row = staffSheet.getRow(rowNumber);
        const employeeName = this.normalizeHeaderValue(row.getCell(4).value);
        if (!this.isEmployeeName(employeeName)) {
          continue;
        }

        const matched = resultByName.get(employeeName);
        previewRows.push({
          employeeName,
          employeeType: matched?.employeeType || 'staff',
          sheetName: staffSheet.name,
          rowNumber,
          baseSalary: matched?.baseSalary || 0,
          commissionSalary: matched?.commissionSalary || 0,
          performanceSalary: matched?.performanceSalary || 0,
          bonus: matched?.bonus || 0,
          allowance: matched?.allowance || 0,
          totalPay: matched?.totalPay || 0,
        });
      }
    }

    return {
      performanceWorkbook: {
        id: latestPerformance.id.toString(),
        originalName: latestPerformance.originalName,
      },
      summary: {
        employeeCount: previewRows.length,
        doctorMatchedCount: previewRows.filter((item) => item.sheetName.includes('抽成') || item.sheetName.includes('绩效总表')).length,
        staffMatchedCount: previewRows.filter((item) => item.sheetName.includes('工作人员')).length,
        totalPay: this.roundMoney(previewRows.reduce((sum, item) => sum + item.totalPay, 0)),
      },
      allRows: previewRows,
      previewRows: previewRows.slice(0, 80),
    };
  }

  private async prepareTemplateWorkbook() {
    this.logger.log('prepareTemplateWorkbook:start');
    const performanceUpload = await this.resolveActivePerformanceUpload();
    this.logger.log(
      `prepareTemplateWorkbook:performanceUpload=${performanceUpload?.originalName || 'none'}`,
    );
    const monthKeyword = performanceUpload
      ? await this.readUploadMonthKeyword(performanceUpload)
      : null;
    this.logger.log(`prepareTemplateWorkbook:monthKeyword=${monthKeyword || 'none'}`);
    const latestSalary = await this.resolveActiveSalaryUpload(monthKeyword);
    if (!latestSalary) {
      throw new BadRequestException('salary workbook is required before template filling');
    }
    this.logger.log(
      `prepareTemplateWorkbook:salaryUpload=${latestSalary.originalName}`,
    );

    const salaryWorkbook = new ExcelJS.Workbook();
    await salaryWorkbook.xlsx.readFile(latestSalary.filePath);
    this.logger.log('prepareTemplateWorkbook:salaryWorkbookLoaded');

    const targetSheet =
      salaryWorkbook.getWorksheet('枋湖馆绩效提成') ||
      salaryWorkbook.getWorksheet('0抽成绩效总表');

    if (!targetSheet) {
      throw new BadRequestException('salary template sheet 枋湖馆绩效提成 not found');
    }

    const monthSheet =
      salaryWorkbook.worksheets.find((sheet) => /20\d{4}/.test(sheet.name)) || null;

    const targetRows = this.readTemplateFillTargetRows(targetSheet);
    this.logger.log(`prepareTemplateWorkbook:targetRows=${targetRows.length}`);
    const performanceResult = await this.buildPerformanceResultFromAvailableSource(
      latestSalary.filePath,
      performanceUpload || undefined,
    );
    this.logger.log(
      `prepareTemplateWorkbook:performanceRows=${performanceResult.rows.length}`,
    );
    const performanceRows = performanceResult.rows;

    const performanceByName = new Map(
      performanceRows.map((item) => [item.employeeName, item]),
    );

    const previewRows: TemplateFillRow[] = targetRows.map((item) => {
      const matched = performanceByName.get(item.employeeName);

      return {
        employeeName: item.employeeName,
        department: item.department,
        position: item.position,
        baseSalary: this.coalesceNumber(matched?.baseSalary, item.baseSalary),
        commissionSalary: this.coalesceNumber(
          matched?.commissionSalary,
          item.commissionSalary,
        ),
        performanceSalary: this.coalesceNumber(
          matched?.performanceSalary,
          item.performanceSalary,
        ),
        bonus: this.coalesceNumber(matched?.bonus, item.bonus),
        allowance: this.coalesceNumber(matched?.allowance, item.allowance),
        sourceSheet: matched?.sourceSheet || item.sourceSheet,
        targetRowNumber: item.targetRowNumber,
      };
    });

    const unmatchedEmployees = previewRows
      .filter((item) => !performanceByName.has(item.employeeName))
      .map((item) => item.employeeName);

    const matchedCount = previewRows.length - unmatchedEmployees.length;
    this.logger.log(
      `prepareTemplateWorkbook:matched=${matchedCount},unmatched=${unmatchedEmployees.length}`,
    );

    return {
      latestSalary,
      performanceUpload,
      result: {
        salaryWorkbook: {
          id: latestSalary.id.toString(),
          originalName: latestSalary.originalName,
        },
        performanceWorkbook: performanceResult.workbook,
        targetSheetName: targetSheet.name,
        monthSheetName: monthSheet?.name || null,
        summary: {
          employeeCount: previewRows.length,
          matchedCount,
          unmatchedCount: unmatchedEmployees.length,
          totalBaseSalary: this.roundMoney(
            previewRows.reduce((sum, item) => sum + item.baseSalary, 0),
          ),
          totalCommissionSalary: this.roundMoney(
            previewRows.reduce((sum, item) => sum + item.commissionSalary, 0),
          ),
          totalPerformanceSalary: this.roundMoney(
            previewRows.reduce((sum, item) => sum + item.performanceSalary, 0),
          ),
          totalBonus: this.roundMoney(
            previewRows.reduce((sum, item) => sum + item.bonus, 0),
          ),
          totalAllowance: this.roundMoney(
            previewRows.reduce((sum, item) => sum + item.allowance, 0),
          ),
        },
        allRows: previewRows,
        previewRows: previewRows.slice(0, 50),
        unmatchedEmployees,
      },
    };
  }

  private async buildPerformanceResultFromAvailableSource(
    salaryFallbackPath?: string,
    preferredPerformanceUpload?: UploadRecord,
  ): Promise<{
    workbook: { id: string; originalName: string } | null;
    rows: PerformanceResultRow[];
  }> {
    this.logger.log('buildPerformanceResultFromAvailableSource:start');
    const latestPerformance =
      preferredPerformanceUpload || (await this.resolveActivePerformanceUpload());

    if (latestPerformance) {
      this.logger.log(
        `buildPerformanceResultFromAvailableSource:usingPerformanceUpload=${latestPerformance.originalName}`,
      );
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(latestPerformance.filePath);
      await this.applyPerformanceFormulaTemplate(
        workbook,
        latestPerformance.filePath,
        latestPerformance.originalName,
      );
      this.wrapPerformanceVlookupFormulas(workbook);
      this.refreshPerformanceWorkbookResults(workbook);
      this.logger.log('buildPerformanceResultFromAvailableSource:performanceWorkbookLoaded');
      const rows = this.extractPerformanceSourceRows(workbook);
      this.logger.log(
        `buildPerformanceResultFromAvailableSource:rows=${rows.length}`,
      );
      return {
        workbook: {
          id: latestPerformance.id.toString(),
          originalName: latestPerformance.originalName,
        },
        rows,
      };
    }

    const fallbackPath = salaryFallbackPath;
    if (fallbackPath) {
      return {
        workbook: null,
        rows: await this.extractPerformanceRowsFromSalaryTemplate(fallbackPath),
      };
    }

    return {
      workbook: null,
      rows: [],
    };
  }

  private async extractWorkbookSummary(
    filePath: string,
  ): Promise<ParsedSheetPreview[]> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    return workbook.worksheets.map((sheet) => {
      const detected = this.detectHeaderRow(sheet);

      return {
        name: sheet.name,
        rowCount: sheet.rowCount,
        columnCount: sheet.columnCount,
        headers: detected.headers,
        detectedHeaderRow: detected.headerRowNumber,
        sampleRows: detected.sampleRows,
      };
    });
  }

  private detectHeaderRow(sheet: ExcelJS.Worksheet): {
    headerRowNumber: number | null;
    headers: string[];
    sampleRows: Array<Record<string, string>>;
  } {
    const maxScanRows = Math.min(10, Math.max(sheet.rowCount, 1));
    let bestRowNumber: number | null = null;
    let bestHeaders: string[] = [];
    let bestScore = -1;

    for (let rowNumber = 1; rowNumber <= maxScanRows; rowNumber += 1) {
      const row = sheet.getRow(rowNumber);
      const values = this.extractRowValues(row).slice(0, 24);
      const nonEmptyValues = values.filter((value) => value.length > 0);

      if (nonEmptyValues.length === 0) {
        continue;
      }

      const score = nonEmptyValues.reduce((total, value) => {
        const compact = value.replace(/\s+/g, '');
        const hasKeyword =
          /(姓名|部门|岗位|工资|薪资|绩效|抽成|社保|公积金|个税|天数|日期|编号|备注|合计|个人|公司)/.test(
            compact,
          );

        return total + (hasKeyword ? 3 : compact.length <= 10 ? 1 : 0);
      }, 0);

      if (score > bestScore) {
        bestScore = score;
        bestRowNumber = rowNumber;
        bestHeaders = nonEmptyValues.slice(0, 12);
      }
    }

    if (!bestRowNumber || bestHeaders.length === 0) {
      return {
        headerRowNumber: null,
        headers: [],
        sampleRows: [],
      };
    }

    const sampleRows: Array<Record<string, string>> = [];
    for (
      let rowNumber = bestRowNumber + 1;
      rowNumber <= Math.min(sheet.rowCount, bestRowNumber + 4);
      rowNumber += 1
    ) {
      const row = sheet.getRow(rowNumber);
      const values = this.extractRowValues(row);
      const record: Record<string, string> = {};

      bestHeaders.forEach((header, index) => {
        const cellValue = values[index] || '';
        if (cellValue.length > 0) {
          record[header] = cellValue;
        }
      });

      if (Object.keys(record).length > 0) {
        sampleRows.push(record);
      }
    }

    return {
      headerRowNumber: bestRowNumber,
      headers: bestHeaders,
      sampleRows,
    };
  }

  private extractRowValues(row: ExcelJS.Row): string[] {
    const rawValues = Array.isArray(row.values) ? row.values : [];
    return rawValues
      .slice(1)
      .map((value: ExcelJS.CellValue) => this.normalizeHeaderValue(value));
  }

  private normalizeHeaderValue(value: ExcelJS.CellValue): string {
    if (value == null) {
      return '';
    }

    if (value instanceof Date) {
      return this.formatDateValue(value);
    }

    if (typeof value === 'object') {
      if ('richText' in value && Array.isArray(value.richText)) {
        return value.richText
          .map((item) => item.text || '')
          .join('')
          .trim();
      }

      if ('text' in value && typeof value.text === 'string') {
        return value.text.trim();
      }

      if ('result' in value && value.result != null) {
        return this.normalizeHeaderValue(value.result as ExcelJS.CellValue);
      }

      if ('hyperlink' in value && typeof value.hyperlink === 'string') {
        return value.hyperlink.trim();
      }

      if ('formula' in value && value.formula && value.result == null) {
        return '';
      }

      if ('sharedFormula' in value && value.result != null) {
        return this.normalizeHeaderValue(value.result as ExcelJS.CellValue);
      }
    }

    return String(value).trim();
  }

  private formatDateValue(value: Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private guessBusinessType(
    category: string,
    sheets: WorkbookSheetSummary[],
  ): { label: string; reason: string } {
    const mergedText = sheets
      .flatMap((sheet) => [sheet.name, ...sheet.headers])
      .join(' ')
      .toLowerCase();

    if (mergedText.includes('工资') || mergedText.includes('个税')) {
      return {
        label: '工资结果类',
        reason: '检测到“工资 / 个税 / 社保 / 公积金”等关键词',
      };
    }

    if (mergedText.includes('绩效') || mergedText.includes('抽成')) {
      return {
        label: '绩效提成类',
        reason: '检测到“绩效 / 抽成 / 奖金”等关键词',
      };
    }

    if (mergedText.includes('考勤')) {
      return {
        label: '考勤类',
        reason: '检测到“考勤”关键词',
      };
    }

    return {
      label: `通用导入类（${category}）`,
      reason: '暂未命中明确业务关键词，按上传分类保留',
    };
  }

  private buildFieldMappings(
    category: string,
    sheets: ParsedSheetPreview[],
  ): FieldMappingPreview[] {
    const rules: Array<{
      targetField: string;
      keywords: string[];
    }> = [
      { targetField: 'employee_name', keywords: ['姓名'] },
      { targetField: 'department', keywords: ['部门', '科室'] },
      { targetField: 'position', keywords: ['岗位'] },
      { targetField: 'base_salary', keywords: ['岗位薪资', '基本薪资', '合同薪酬'] },
      { targetField: 'performance_salary', keywords: ['绩效工资', '绩效奖金'] },
      { targetField: 'commission_salary', keywords: ['抽成', '抽成工资', '提成'] },
      { targetField: 'allowance', keywords: ['补贴'] },
      { targetField: 'leave_deduction', keywords: ['请假扣款'] },
      { targetField: 'meal_fee', keywords: ['餐费'] },
      { targetField: 'social_security', keywords: ['社保', '医社保'] },
      { targetField: 'housing_fund', keywords: ['公积金'] },
      { targetField: 'tax', keywords: ['个税', '个人所得税'] },
      { targetField: 'net_salary', keywords: ['实发工资', '实发转账工资'] },
    ];

    const mappings: FieldMappingPreview[] = [];

    for (const rule of rules) {
      const match = this.findBestHeaderMatch(rule.keywords, sheets);
      if (match) {
        mappings.push({
          targetField: rule.targetField,
          matchedSheet: match.sheet,
          matchedHeader: match.header,
          confidence: match.confidence,
        });
      }
    }

    if (mappings.length === 0 && category === 'salary') {
      return [
        {
          targetField: 'salary_fields_pending',
          matchedSheet: '未识别',
          matchedHeader: '当前仅提取到工作表摘要，尚未命中字段规则',
          confidence: 'low',
        },
      ];
    }

    return mappings;
  }

  private findBestHeaderMatch(
    keywords: string[],
    sheets: ParsedSheetPreview[],
  ):
    | {
        sheet: string;
        header: string;
        confidence: 'high' | 'medium' | 'low';
      }
    | undefined {
    for (const sheet of sheets) {
      for (const header of sheet.headers) {
        const normalizedHeader = header.replace(/\s+/g, '');
        const exact = keywords.find((keyword) =>
          normalizedHeader.includes(keyword.replace(/\s+/g, '')),
        );

        if (exact) {
          return {
            sheet: sheet.name,
            header,
            confidence: normalizedHeader === exact ? 'high' : 'medium',
          };
        }
      }
    }

    return undefined;
  }

  private buildNormalizedPreview(
    category: string,
    sheets: ParsedSheetPreview[],
  ): {
    summary: string;
    fields: NormalizedFieldPreview[];
  } {
    const rules: Array<{
      targetField: string;
      label: string;
      keywords: string[];
    }> = [
      { targetField: 'employee_name', label: '姓名', keywords: ['姓名', '医生'] },
      { targetField: 'department', label: '部门', keywords: ['部门', '科室'] },
      { targetField: 'position', label: '岗位', keywords: ['岗位'] },
      { targetField: 'base_salary', label: '岗位薪资', keywords: ['岗位薪资', '基本工资', '合同薪酬', '基本薪资'] },
      { targetField: 'performance_salary', label: '绩效工资', keywords: ['绩效工资', '绩效奖金', '绩效金额'] },
      { targetField: 'commission_salary', label: '抽成工资', keywords: ['抽成', '抽成工资', '提成'] },
      { targetField: 'allowance', label: '补贴', keywords: ['补贴', '津贴', '其他项目'] },
      { targetField: 'leave_deduction', label: '请假扣款', keywords: ['请假扣款', '病假', '事假'] },
      { targetField: 'meal_fee', label: '餐费', keywords: ['餐费'] },
      { targetField: 'social_security', label: '社保个人', keywords: ['社保', '个人缴费', '本期基本养老保险费'] },
      { targetField: 'housing_fund', label: '公积金个人', keywords: ['公积金', '实际个人承担', '个人承担'] },
      { targetField: 'tax', label: '个税', keywords: ['个税', '个人所得税', '应补退税额'] },
      { targetField: 'net_salary', label: '实发工资', keywords: ['实发工资', '实发转账工资', '本月工资'] },
    ];

    const fields: NormalizedFieldPreview[] = [];

    for (const rule of rules) {
      const matched = this.findBestFieldWithSamples(rule.keywords, sheets);
      if (!matched) {
        continue;
      }

      fields.push({
        targetField: rule.targetField,
        matchedSheet: matched.sheet,
        matchedHeader: matched.header,
        confidence: matched.confidence,
        sampleValues: matched.sampleValues,
      });
    }

    const summary =
      category === 'salary'
        ? '已从工资相关工作表中提取标准字段候选，可作为后续自动算薪映射基础。'
        : category === 'performance'
          ? '已从绩效相关工作表中提取标准字段候选，可作为绩效汇总与回填工资表的基础。'
          : '已提取标准字段候选，可继续扩展为统一导入模型。';

    return {
      summary,
      fields,
    };
  }

  private findBestFieldWithSamples(
    keywords: string[],
    sheets: ParsedSheetPreview[],
  ):
    | {
        sheet: string;
        header: string;
        confidence: 'high' | 'medium' | 'low';
        sampleValues: string[];
      }
    | undefined {
    for (const sheet of sheets) {
      const headerIndex = sheet.headers.findIndex((header) => {
        const normalizedHeader = header.replace(/\s+/g, '');
        return keywords.some((keyword) =>
          normalizedHeader.includes(keyword.replace(/\s+/g, '')),
        );
      });

      if (headerIndex === -1) {
        continue;
      }

      const header = sheet.headers[headerIndex];
      const sampleValues = sheet.sampleRows
        .map((row) => row[header])
        .filter((value): value is string => Boolean(value))
        .slice(0, 3);

      return {
        sheet: sheet.name,
        header,
        confidence: keywords.includes(header.replace(/\s+/g, ''))
          ? 'high'
          : 'medium',
        sampleValues,
      };
    }

    return undefined;
  }

  private async parseSalaryWorkbook(filePath: string) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    const salarySheet =
      workbook.getWorksheet('202605') ||
      workbook.worksheets.find((sheet) => /20\d{4}/.test(sheet.name));
    const socialSheet = workbook.getWorksheet('社保');
    const fundSheet = workbook.getWorksheet('公积金');
    const taxSheet = workbook.getWorksheet('个税');

    if (!salarySheet) {
      throw new BadRequestException('salary result sheet not found');
    }

    const salaryRows = this.readStructuredRows(salarySheet, 6);
    const socialByName = socialSheet ? this.readSocialByName(socialSheet) : new Map();
    const fundByName = fundSheet ? this.readFundByName(fundSheet) : new Map();
    const taxByName = taxSheet ? this.readTaxByName(taxSheet) : new Map();

    return salaryRows
      .map((row) => {
        const employeeName = this.readString(row, ['姓名']);
        if (!this.isEmployeeName(employeeName)) {
          return null;
        }

        return {
          employeeName,
          department: this.readString(row, ['部门']),
          position: this.readString(row, ['岗位']),
          baseSalary: this.readNumber(row, ['岗位薪资', '基本工资', '合同薪酬']),
          performanceSalary: this.readNumber(row, ['绩效工资', '绩效奖金']),
          commissionSalary: this.readNumber(row, ['抽成', '抽成工资']),
          allowance: this.readNumber(row, ['补贴', '其他项目']),
          socialSecurity: this.coalesceNumber(socialByName.get(employeeName), 0),
          housingFund: this.coalesceNumber(fundByName.get(employeeName), 0),
          tax: this.coalesceNumber(taxByName.get(employeeName), 0),
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .filter((row) => this.hasMeaningfulPayrollData(row));
  }

  private async parsePerformanceWorkbook(filePath: string) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    return this.extractPerformanceSourceRows(workbook);
  }

  private readStructuredRows(sheet: ExcelJS.Worksheet, headerRowNumber: number) {
    const headers = this.extractRowValues(sheet.getRow(headerRowNumber));
    const rows: Array<Record<string, string>> = [];

    for (let rowNumber = headerRowNumber + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const values = this.extractRowValues(sheet.getRow(rowNumber));
      const record: Record<string, string> = {};

      headers.forEach((header, index) => {
        if (!header) {
          return;
        }
        const value = values[index] || '';
        if (value && value !== '[object Object]') {
          record[header] = value;
        }
      });

      if (Object.keys(record).length > 0) {
        rows.push(record);
      }
    }

    return rows;
  }

  private readSocialByName(sheet: ExcelJS.Worksheet) {
    const result = new Map<string, number>();
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber < 5) {
        return;
      }
      const name = this.normalizeHeaderValue(row.getCell(2).value);
      if (!name || name === '合计') {
        return;
      }
      result.set(name, this.readCellNumber(row.getCell(6)));
    });
    return result;
  }

  private readSocialEmployerByName(sheet: ExcelJS.Worksheet) {
    const result = new Map<string, number>();
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber < 5) {
        return;
      }
      const name = this.normalizeHeaderValue(row.getCell(2).value);
      if (!name || name === '合计') {
        return;
      }
      result.set(name, this.readCellNumber(row.getCell(5)));
    });
    return result;
  }

  private readSocialByNameFromWorkbook(workbook: ExcelJS.Workbook) {
    const socialSheet = workbook.getWorksheet('社保');
    const result = socialSheet
      ? this.readSocialByName(socialSheet)
      : new Map<string, number>();
    this.mergeAdvanceSocialSecurityByName(workbook, result, 'personal');
    return result;
  }

  private readSocialEmployerByNameFromWorkbook(workbook: ExcelJS.Workbook) {
    const socialSheet = workbook.getWorksheet('社保');
    const result = socialSheet
      ? this.readSocialEmployerByName(socialSheet)
      : new Map<string, number>();
    this.mergeAdvanceSocialSecurityByName(workbook, result, 'employer');
    return result;
  }

  private mergeAdvanceSocialSecurityByName(
    workbook: ExcelJS.Workbook,
    target: Map<string, number>,
    side: 'personal' | 'employer',
  ) {
    const advanceSheet = workbook.getWorksheet('代垫五险一金');
    if (!advanceSheet) {
      return;
    }

    const valueColumn = side === 'personal' ? 2 : 3;
    advanceSheet.eachRow((row) => {
      const name = this.normalizeHeaderValue(row.getCell(1).value);
      if (!this.isEmployeeName(name) || target.has(name)) {
        return;
      }

      const value = this.readComputedCellNumber(row.getCell(valueColumn), advanceSheet);
      if (value !== 0) {
        target.set(name, value);
      }
    });
  }

  private readFundByName(sheet: ExcelJS.Worksheet) {
    const result = new Map<string, number>();
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber < 5) {
        return;
      }
      const name = this.normalizeHeaderValue(row.getCell(4).value);
      if (!name || name === '合计') {
        return;
      }
      result.set(name, this.readCellNumber(row.getCell(12)));
    });
    return result;
  }

  private readFundCompanyByName(sheet: ExcelJS.Worksheet) {
    const result = new Map<string, number>();
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber < 5) {
        return;
      }
      const name = this.normalizeHeaderValue(row.getCell(4).value);
      if (!name || name === '合计') {
        return;
      }
      result.set(name, this.readCellNumber(row.getCell(11)));
    });
    return result;
  }

  private readFundByNameFromWorkbook(workbook: ExcelJS.Workbook) {
    const fundSheet = workbook.getWorksheet('公积金');
    return fundSheet ? this.readFundByName(fundSheet) : new Map<string, number>();
  }

  private readFundCompanyByNameFromWorkbook(workbook: ExcelJS.Workbook) {
    const fundSheet = workbook.getWorksheet('公积金');
    return fundSheet
      ? this.readFundCompanyByName(fundSheet)
      : new Map<string, number>();
  }

  private readTaxByName(sheet: ExcelJS.Worksheet) {
    const rows = this.readStructuredRows(sheet, 1);
    const result = new Map<string, number>();
    rows.forEach((row) => {
      const name = this.readString(row, ['姓名']);
      if (!name) {
        return;
      }
      const actualTax = this.readNumber(row, ['应补(退)税额', '应补退税额']);
      result.set(name, actualTax);
    });
    return result;
  }

  private readTaxByNameFromWorkbook(workbook: ExcelJS.Workbook) {
    const taxSheet = workbook.getWorksheet('个税');
    return taxSheet ? this.readTaxByName(taxSheet) : new Map<string, number>();
  }

  private readTaxIncomeByName(sheet: ExcelJS.Worksheet) {
    const rows = this.readStructuredRows(sheet, 1);
    const result = new Map<string, number>();
    rows.forEach((row) => {
      const name = this.readString(row, ['姓名']);
      if (!name) {
        return;
      }
      result.set(name, this.readNumber(row, ['本期收入']));
    });
    return result;
  }

  private readTaxIncomeByNameFromWorkbook(workbook: ExcelJS.Workbook) {
    const taxSheet = workbook.getWorksheet('个税');
    return taxSheet
      ? this.readTaxIncomeByName(taxSheet)
      : new Map<string, number>();
  }

  private readEmployeeBaseSalaryByNameFromWorkbook(workbook: ExcelJS.Workbook) {
    const employeeSheet = workbook.getWorksheet('员工基本信息');
    if (!employeeSheet) {
      return new Map<string, number>();
    }

    const result = new Map<string, number>();
    employeeSheet.eachRow((row, rowNumber) => {
      if (rowNumber < 4) {
        return;
      }

      const name = this.normalizeHeaderValue(row.getCell(2).value);
      if (!this.isEmployeeName(name)) {
        return;
      }

      const currentSalary = this.readCellNumber(row.getCell(11));
      const contractSalary = this.readCellNumber(row.getCell(10));
      const baseSalary = currentSalary !== 0 ? currentSalary : contractSalary;

      if (baseSalary !== 0) {
        result.set(name, baseSalary);
      }
    });

    return result;
  }

  private calculateMonthlyPayableSalary(
    row: ExcelJS.Row,
    monthSheet: ExcelJS.Worksheet,
  ) {
    const incomeTotal =
      this.readCellNumber(row.getCell(10)) +
      this.readCellNumber(row.getCell(11)) +
      this.readCellNumber(row.getCell(12)) +
      this.readCellNumber(row.getCell(13)) +
      this.readCellNumber(row.getCell(14));
    const deductionTotal =
      this.readComputedCellNumber(row.getCell(15), monthSheet) +
      this.readCellNumber(row.getCell(16)) +
      this.readCellNumber(row.getCell(17));
    return this.roundMoney(incomeTotal - deductionTotal);
  }

  private calculateMonthlyCompanyTotalCost(
    row: ExcelJS.Row,
    monthSheet: ExcelJS.Worksheet,
    payableSalary?: number,
  ) {
    const resolvedPayableSalary =
      typeof payableSalary === 'number'
        ? payableSalary
        : this.calculateMonthlyPayableSalary(row, monthSheet);
    const employerSocialSecurity = this.readCellNumber(row.getCell(19));
    const employerHousingFund = this.readCellNumber(row.getCell(20));
    const compensation = this.readComputedCellNumber(row.getCell(25), monthSheet);

    return this.roundMoney(
      resolvedPayableSalary +
        employerSocialSecurity +
        employerHousingFund +
        compensation,
    );
  }

  private readString(row: Record<string, string>, keys: string[]) {
    for (const key of keys) {
      const matchedKey = Object.keys(row).find((item) =>
        item.replace(/\s+/g, '').includes(key.replace(/\s+/g, '')),
      );
      if (matchedKey && row[matchedKey]) {
        const value = row[matchedKey];
        if (value === '[object Object]') {
          return '';
        }
        return value;
      }
    }
    return '';
  }

  private readNumber(row: Record<string, string>, keys: string[]) {
    const raw = this.readString(row, keys);
    return this.parseNumber(raw);
  }

  private parseNumber(value: string | number | undefined) {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : 0;
    }

    if (!value) {
      return 0;
    }

    const normalized = String(value).replace(/,/g, '').trim();
    if (
      normalized.length === 0 ||
      normalized === '[object Object]' ||
      normalized === '/' ||
      normalized === '-'
    ) {
      return 0;
    }
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private coalesceNumber(...values: Array<number | undefined>) {
    for (const value of values) {
      if (typeof value === 'number' && Number.isFinite(value) && value !== 0) {
        return value;
      }
    }
    return 0;
  }

  private roundMoney(value: number) {
    return Math.round(value * 100) / 100;
  }

  private detectPayrollAnomalies(input: {
    department: string;
    position: string;
    salaryPerformanceSalary: number;
    mergedPerformanceSalary: number;
    salaryCommissionSalary: number;
    mergedCommissionSalary: number;
    salaryAllowance: number;
    mergedAllowance: number;
    socialSecurity: number;
    housingFund: number;
  }) {
    const anomalies: string[] = [];

    if (
      input.salaryPerformanceSalary > 0 &&
      input.mergedPerformanceSalary > 0
    ) {
      anomalies.push('绩效字段存在双来源，当前优先使用绩效表口径');
    }

    if (
      input.salaryCommissionSalary > 0 &&
      input.mergedCommissionSalary > 0
    ) {
      anomalies.push('抽成字段存在双来源，当前优先使用绩效表口径');
    }

    if (input.salaryAllowance !== 0 && input.mergedAllowance !== 0) {
      anomalies.push('补贴字段存在双来源，当前优先使用绩效表口径');
    }

    if (!input.department || input.department === '/') {
      anomalies.push('部门缺失，建议回查员工基础信息表');
    }

    if (!input.position || input.position === '/') {
      anomalies.push('岗位缺失，建议回查员工基础信息表');
    }

    if (input.socialSecurity === 0 && input.housingFund === 0) {
      anomalies.push('五险一金未识别到个人扣款，需确认是否本月无需代扣');
    }

    return anomalies;
  }

  private resolveFieldValue(
    key: PayrollFieldRuleKey,
    salaryValue: number,
    performanceValue: number,
  ) {
    const rule = this.payrollFieldRules.find((item) => item.key === key);
    const priority = rule?.priority || ['salary', 'performance'];

    let finalValue = 0;
    let sourceLabel = '';
    for (const source of priority) {
      const candidate = source === 'performance' ? performanceValue : salaryValue;
      if (candidate !== 0) {
        finalValue = candidate;
        sourceLabel = source === 'performance' ? '绩效表' : '工资表';
        break;
      }
    }

    return {
      field: key,
      finalValue,
      rule: `${rule?.label || key}: ${priority.join(' > ')}`,
      salaryValue,
      performanceValue,
      sourceLabel: finalValue === 0 ? '未命中数值' : sourceLabel,
    };
  }

  private extractPerformanceRows(workbook: ExcelJS.Workbook): PerformanceResultRow[] {
    const commissionSheet =
      workbook.getWorksheet('0抽成绩效总表') ||
      workbook.getWorksheet('枋湖馆绩效提成');
    const bonusSheet = workbook.getWorksheet('2工作人员绩效情况表');

    const merged = new Map<
      string,
      PerformanceResultRow
    >();

    if (commissionSheet) {
      const rows = this.readStructuredRows(commissionSheet, 3);
      rows.forEach((row) => {
        const employeeName = this.readString(row, ['医生', '姓名']);
        if (!this.isEmployeeName(employeeName)) {
          return;
        }
        merged.set(employeeName, {
          employeeName,
          department: this.readString(row, ['科室', '部门']),
          employeeType: 'doctor',
          baseSalary: this.readNumber(row, ['岗位薪资', '基本薪资', '基本工资']),
          performanceSalary: this.readNumber(row, ['绩效工资', '绩效奖金']),
          commissionSalary: this.readNumber(row, ['抽成工资', '抽成']),
          bonus: this.readNumber(row, ['其他项目', '绩效奖金']),
          allowance: this.readNumber(row, ['补贴']),
          totalPay: this.readNumber(row, ['本月工资', '实发薪资']),
          sourceSheet: commissionSheet.name,
        });
      });
    }

    if (bonusSheet) {
      const rows = this.readStructuredRows(bonusSheet, 3);
      rows.forEach((row) => {
        const employeeName = this.readString(row, ['姓名']);
        if (!this.isEmployeeName(employeeName)) {
          return;
        }

        const departmentFromStaffSheet = this.readString(row, ['部门', '科室']);
        const looksLikeStaff =
          Boolean(departmentFromStaffSheet) ||
          this.readNumber(row, ['基础得分', '实际得分']) > 0 ||
          this.readNumber(row, ['绩效金额', '绩效奖金']) > 0;

        const existing = merged.get(employeeName) || {
          employeeName,
          department: departmentFromStaffSheet,
          employeeType: 'staff' as const,
          baseSalary: 0,
          performanceSalary: 0,
          commissionSalary: 0,
          bonus: 0,
          allowance: 0,
          totalPay: 0,
          sourceSheet: bonusSheet.name,
        };

        existing.department = departmentFromStaffSheet || existing.department;
        existing.baseSalary = this.coalesceNumber(
          this.readNumber(row, ['基本薪资', '岗位薪资']),
          existing.baseSalary,
        );
        existing.performanceSalary = this.coalesceNumber(
          this.readNumber(row, ['绩效奖金', '绩效工资', '绩效金额']),
          existing.performanceSalary,
        );
        existing.totalPay = this.coalesceNumber(
          this.readNumber(row, ['实发薪资', '本月工资']),
          existing.totalPay,
        );
        if (looksLikeStaff) {
          existing.employeeType = 'staff';
          existing.sourceSheet = bonusSheet.name;
          existing.commissionSalary = 0;
          existing.allowance = 0;
        } else {
          existing.sourceSheet = existing.sourceSheet || bonusSheet.name;
        }
        merged.set(employeeName, existing);
      });
    }

    return Array.from(merged.values())
      .map((row) => ({
        ...row,
        totalPay:
          row.totalPay ||
          this.roundMoney(
            row.baseSalary +
              row.commissionSalary +
              row.performanceSalary +
              row.bonus +
              row.allowance,
          ),
      }))
      .filter((row) =>
        row.baseSalary > 0 ||
        row.performanceSalary > 0 ||
        row.commissionSalary > 0 ||
        row.bonus !== 0 ||
        row.allowance !== 0 ||
        row.totalPay !== 0,
      );
  }

  private extractPerformanceSourceRows(
    workbook: ExcelJS.Workbook,
  ): PerformanceResultRow[] {
    const merged = new Map<string, PerformanceResultRow>();

    const summarySheet =
      workbook.getWorksheet('0抽成绩效总表') ||
      workbook.getWorksheet('枋湖馆绩效提成');
    const doctorCalcSheet = workbook.getWorksheet('1医生抽成计算表');
    const staffSheet = workbook.getWorksheet('2工作人员绩效情况表');
    const brandSheet = workbook.getWorksheet('2.6品牌绩效');
    const sheet13 = workbook.getWorksheet('1.3席科室抽成情况表');
    const sheet14 = workbook.getWorksheet('1.4郝科室抽成情况表');
    const sheet15 = workbook.getWorksheet('1.5周科室抽成情况表 ');

    const specialCommissionByName = new Map<string, number>();

    if (sheet13) {
      const seatDoctorCommission = this.readCellNumber(sheet13.getCell('B31'));
      if (seatDoctorCommission !== 0) {
        specialCommissionByName.set('席玉新', seatDoctorCommission);
      }
    }

    if (sheet14) {
      const rows = [
        { name: '洪晓云', totalCell: 'J14' },
        { name: '陈聪秀', totalCell: 'J15' },
      ];
      rows.forEach((item) => {
        const total = this.readComputedCellNumber(
          sheet14.getCell(item.totalCell),
          sheet14,
        );
        if (total !== 0) {
          specialCommissionByName.set(item.name, total);
        }
      });
    }

    if (sheet15) {
      const rows = [{ name: '郑亚玲', totalCell: 'J14' }];
      rows.forEach((item) => {
        const total = this.readComputedCellNumber(
          sheet15.getCell(item.totalCell),
          sheet15,
        );
        if (total !== 0) {
          specialCommissionByName.set(item.name, total);
        }
      });
    }

    const doctorBonusByName = new Map<string, number>();
    if (summarySheet) {
      for (let rowNumber = 5; rowNumber <= summarySheet.rowCount; rowNumber += 1) {
        const row = summarySheet.getRow(rowNumber);
        const employeeName = this.normalizeHeaderValue(row.getCell(16).value);
        if (!this.isEmployeeName(employeeName)) {
          continue;
        }
        const bonus = this.readComputedCellNumber(row.getCell(18), summarySheet);
        if (bonus !== 0) {
          doctorBonusByName.set(employeeName, bonus);
        }
      }
    }

    if (doctorCalcSheet) {
      for (let rowNumber = 8; rowNumber <= doctorCalcSheet.rowCount; rowNumber += 1) {
        const row = doctorCalcSheet.getRow(rowNumber);
        const employeeName = this.normalizeHeaderValue(row.getCell(4).value);
        if (!this.isEmployeeName(employeeName)) {
          continue;
        }

        const baseSalary = this.readComputedCellNumber(row.getCell(27), doctorCalcSheet);
        const commissionSalary = this.readComputedCellNumber(
          row.getCell(28),
          doctorCalcSheet,
        );
        const performanceSalary = this.readComputedCellNumber(
          row.getCell(29),
          doctorCalcSheet,
        );
        const bonus = doctorBonusByName.get(employeeName) || 0;
        const allowance = 0;
        const totalWithoutBonus = this.readComputedCellNumber(
          row.getCell(30),
          doctorCalcSheet,
        );
        const totalPay =
          totalWithoutBonus !== 0
            ? this.roundMoney(totalWithoutBonus + bonus + allowance)
            : this.roundMoney(
                baseSalary +
                  commissionSalary +
                  performanceSalary +
                  bonus +
                  allowance,
              );

        merged.set(employeeName, {
          employeeName,
          department: '',
          employeeType: 'doctor',
          baseSalary,
          commissionSalary:
            specialCommissionByName.get(employeeName) ?? commissionSalary,
          performanceSalary,
          bonus,
          allowance,
          totalPay:
            specialCommissionByName.has(employeeName)
              ? this.roundMoney(
                  baseSalary +
                    (specialCommissionByName.get(employeeName) || 0) +
                    performanceSalary +
                    bonus +
                    allowance,
                )
              : totalPay,
          sourceSheet: doctorCalcSheet.name,
        });
      }
    }

    specialCommissionByName.forEach((commissionSalary, employeeName) => {
      const existing = merged.get(employeeName);
      if (existing) {
        existing.commissionSalary = commissionSalary;
        existing.totalPay = this.roundMoney(
          existing.baseSalary +
            existing.commissionSalary +
            existing.performanceSalary +
            existing.bonus +
            existing.allowance,
        );
        existing.sourceSheet =
          employeeName === '席玉新'
            ? '1.3席科室抽成情况表'
            : employeeName === '郑亚玲'
              ? '1.5周科室抽成情况表'
              : '1.4郝科室抽成情况表';
        merged.set(employeeName, existing);
      } else {
        merged.set(employeeName, {
          employeeName,
          department: '',
          employeeType: 'doctor',
          baseSalary: 0,
          commissionSalary,
          performanceSalary: 0,
          bonus: 0,
          allowance: 0,
          totalPay: commissionSalary,
          sourceSheet:
            employeeName === '席玉新'
              ? '1.3席科室抽成情况表'
              : employeeName === '郑亚玲'
                ? '1.5周科室抽成情况表'
                : '1.4郝科室抽成情况表',
        });
      }
    });

    const staffBonusByName = new Map<string, number>();
    const staffTotalOverrideByName = new Map<string, number>();

    if (brandSheet) {
      for (let rowNumber = 28; rowNumber <= brandSheet.rowCount; rowNumber += 1) {
        const row = brandSheet.getRow(rowNumber);
        const employeeName = this.normalizeHeaderValue(row.getCell(1).value);
        if (!this.isEmployeeName(employeeName)) {
          continue;
        }
        const bonus = this.readComputedCellNumber(row.getCell(5), brandSheet);
        if (bonus !== 0) {
          staffBonusByName.set(employeeName, bonus);
        }
        const totalPay = this.readComputedCellNumber(row.getCell(6), brandSheet);
        if (totalPay !== 0) {
          staffTotalOverrideByName.set(employeeName, totalPay);
        }
      }
    }

    if (staffSheet) {
      for (let rowNumber = 4; rowNumber <= staffSheet.rowCount; rowNumber += 1) {
        const row = staffSheet.getRow(rowNumber);
        const employeeName = this.normalizeHeaderValue(row.getCell(4).value);
        if (!this.isEmployeeName(employeeName)) {
          continue;
        }

        const baseSalary = this.readComputedCellNumber(row.getCell(5), staffSheet);
        const performanceSalary = this.readComputedCellNumber(
          row.getCell(10),
          staffSheet,
        );
        const bonus = staffBonusByName.get(employeeName) || 0;
        const totalPay = this.readComputedCellNumber(row.getCell(11), staffSheet);
        const totalPayOverride = staffTotalOverrideByName.get(employeeName) || 0;

        merged.set(employeeName, {
          employeeName,
          department: '',
          employeeType: 'staff',
          baseSalary,
          commissionSalary: 0,
          performanceSalary,
          bonus,
          allowance: 0,
          totalPay:
            totalPayOverride !== 0
              ? totalPayOverride
              : totalPay !== 0
              ? totalPay
              : this.roundMoney(baseSalary + performanceSalary + bonus),
          sourceSheet: staffSheet.name,
        });
      }
    }

    const specialDepartmentStaffRows = [
      ...(sheet13 ? this.extractSpecialDepartmentStaffRows(sheet13) : []),
      ...(sheet14 ? this.extractSpecialDepartmentStaffRows(sheet14) : []),
      ...(sheet15 ? this.extractSpecialDepartmentStaffRows(sheet15) : []),
    ];

    specialDepartmentStaffRows.forEach((row) => {
      const existing = merged.get(row.employeeName);
      if (existing && existing.employeeType === 'doctor') {
        return;
      }

      merged.set(row.employeeName, {
        ...row,
        employeeType: 'staff',
        commissionSalary: 0,
        allowance: 0,
      });
    });

    return Array.from(merged.values()).filter((row) =>
      row.baseSalary !== 0 ||
      row.commissionSalary !== 0 ||
      row.performanceSalary !== 0 ||
      row.bonus !== 0 ||
      row.allowance !== 0 ||
      row.totalPay !== 0,
    );
  }

  private hasMeaningfulPerformanceResult(row: PerformanceResultRow) {
    return (
      row.baseSalary !== 0 ||
      row.commissionSalary !== 0 ||
      row.performanceSalary !== 0 ||
      row.bonus !== 0 ||
      row.allowance !== 0 ||
      row.totalPay !== 0
    );
  }

  private async buildFilledPerformanceWorkbook(filePath: string) {
    const prepared = await this.preparePerformanceTemplateWorkbook();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    const doctorSheet =
      workbook.getWorksheet('0抽成绩效总表') || workbook.getWorksheet('枋湖馆绩效提成');
    const staffSheet = workbook.getWorksheet('2工作人员绩效情况表');

    const performanceByName = new Map(
      prepared.allRows.map((item) => [
        `${item.sheetName}::${item.employeeName}`,
        item,
      ]),
    );
    const performanceByEmployeeName = new Map(
      prepared.allRows.map((item) => [item.employeeName, item]),
    );

    if (doctorSheet) {
      for (let rowNumber = 4; rowNumber <= doctorSheet.rowCount; rowNumber += 1) {
        const row = doctorSheet.getRow(rowNumber);
        const employeeName = this.normalizeHeaderValue(row.getCell(4).value);
        if (!this.isEmployeeName(employeeName)) {
          continue;
        }
        const matched =
          performanceByName.get(`${doctorSheet.name}::${employeeName}`) ||
          performanceByName.get(`2工作人员绩效情况表::${employeeName}`) ||
          performanceByEmployeeName.get(employeeName);
        if (!matched) {
          continue;
        }

        if (matched.employeeType === 'staff') {
          const carriedBonus = this.roundMoney(
            Math.max(
              matched.totalPay - matched.baseSalary - matched.performanceSalary,
              0,
            ),
          );

          this.setCalculatedCellValue(row.getCell(6), matched.baseSalary, {
            allowZero: true,
          });
          this.setCalculatedCellValue(row.getCell(7), 0, {
            allowZero: true,
          });
          this.setCalculatedCellValue(row.getCell(8), matched.performanceSalary, {
            allowZero: true,
          });
          this.setCalculatedCellValue(row.getCell(9), carriedBonus, {
            allowZero: true,
          });
          this.setCalculatedCellValue(row.getCell(10), matched.allowance, {
            allowZero: true,
          });
          this.setCalculatedCellValue(row.getCell(11), matched.totalPay, {
            allowZero: true,
            overwriteNonFormula: false,
          });
          continue;
        }

        const summaryBonus = this.resolveDoctorSummaryBonus(
          doctorSheet,
          rowNumber,
          employeeName,
          matched,
        );

        this.setCalculatedCellValue(row.getCell(6), matched.baseSalary);
        this.setCalculatedCellValue(row.getCell(7), matched.commissionSalary);
        this.setCalculatedCellValue(row.getCell(8), matched.performanceSalary);
        this.setCalculatedCellValue(row.getCell(9), summaryBonus, {
          allowZero: true,
        });
        this.setCalculatedCellValue(row.getCell(10), matched.allowance, {
          allowZero: true,
        });

        const totalPay = this.roundMoney(
          this.readCellNumber(row.getCell(6)) +
            this.readCellNumber(row.getCell(7)) +
            this.readCellNumber(row.getCell(8)) +
            this.readCellNumber(row.getCell(9)) +
            this.readCellNumber(row.getCell(10)),
        );
        this.setCalculatedCellValue(row.getCell(11), totalPay, {
          allowZero: true,
          overwriteNonFormula: false,
        });
      }
    }

    if (staffSheet) {
      for (let rowNumber = 4; rowNumber <= staffSheet.rowCount; rowNumber += 1) {
        const row = staffSheet.getRow(rowNumber);
        const employeeName = this.normalizeHeaderValue(row.getCell(4).value);
        if (!this.isEmployeeName(employeeName)) {
          continue;
        }
        const matched = performanceByName.get(`${staffSheet.name}::${employeeName}`);
        const resolvedMatched = matched || performanceByEmployeeName.get(employeeName);
        if (!resolvedMatched) {
          continue;
        }

        this.setCalculatedCellValue(row.getCell(5), resolvedMatched.baseSalary, {
          allowZero: true,
        });
        this.setCalculatedCellValue(
          row.getCell(6),
          resolvedMatched.performanceSalary || resolvedMatched.bonus,
          { allowZero: true },
        );
        this.setCalculatedCellValue(row.getCell(10), resolvedMatched.performanceSalary, {
          allowZero: true,
        });
        this.setCalculatedCellValue(row.getCell(11), resolvedMatched.totalPay, {
          allowZero: true,
          overwriteNonFormula: false,
        });
      }
    }

    if (doctorSheet) {
      this.refreshDoctorSummaryFooter(doctorSheet, staffSheet);
    }

    return workbook;
  }

  private extractSpecialDepartmentStaffRows(sheet: ExcelJS.Worksheet) {
    const rows: PerformanceResultRow[] = [];

    for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const headerValues = Array.from({ length: Math.min(sheet.columnCount, 20) }, (_, index) =>
        this.normalizeHeaderValue(sheet.getRow(rowNumber).getCell(index + 1).value),
      );

      const nameColumn = headerValues.findIndex((value) => value === '姓名') + 1;
      const totalColumn =
        headerValues.findIndex((value) => value.includes('工资总额')) + 1;
      const baseSalaryColumn =
        headerValues.findIndex((value) => value.includes('岗位薪资')) + 1;
      const performanceColumn =
        headerValues.findIndex(
          (value) =>
            value.includes('个人实际总绩效') ||
            value.includes('总提成（已按请假则算）'),
        ) + 1;

      if (!nameColumn || !totalColumn || !baseSalaryColumn) {
        continue;
      }

      for (let dataRowNumber = rowNumber + 1; dataRowNumber <= sheet.rowCount; dataRowNumber += 1) {
        const row = sheet.getRow(dataRowNumber);
        const employeeName = this.normalizeHeaderValue(row.getCell(nameColumn).value);

        if (!employeeName) {
          continue;
        }
        if (
          employeeName === '合计' ||
          employeeName === 'check' ||
          employeeName.startsWith('（')
        ) {
          break;
        }
        if (!this.isEmployeeName(employeeName)) {
          continue;
        }

        const baseSalary = this.readComputedCellNumber(
          row.getCell(baseSalaryColumn),
          sheet,
        );
        const performanceSalary = performanceColumn
          ? this.readComputedCellNumber(row.getCell(performanceColumn), sheet)
          : 0;
        const totalPay = this.readComputedCellNumber(row.getCell(totalColumn), sheet);

        rows.push({
          employeeName,
          department: '',
          employeeType: 'staff',
          baseSalary,
          commissionSalary: 0,
          performanceSalary,
          bonus: 0,
          allowance: 0,
          totalPay:
            totalPay !== 0
              ? totalPay
              : this.roundMoney(baseSalary + performanceSalary),
          sourceSheet: sheet.name,
        });
      }
    }

    return rows;
  }

  private extractPerformanceRowsFromFilledSummary(
    workbook: ExcelJS.Workbook,
  ): PerformanceResultRow[] {
    const summarySheet =
      workbook.getWorksheet('0抽成绩效总表') ||
      workbook.getWorksheet('枋湖馆绩效提成');

    if (!summarySheet) {
      return this.extractPerformanceSourceRows(workbook);
    }

    const rows: PerformanceResultRow[] = [];
    for (let rowNumber = 4; rowNumber <= summarySheet.rowCount; rowNumber += 1) {
      const row = summarySheet.getRow(rowNumber);
      const employeeName = this.normalizeHeaderValue(row.getCell(4).value);
      if (!this.isEmployeeName(employeeName)) {
        continue;
      }

      const baseSalary = this.readCellNumber(row.getCell(6));
      const commissionSalary = this.readCellNumber(row.getCell(7));
      const performanceSalary = this.readCellNumber(row.getCell(8));
      const bonus = this.readCellNumber(row.getCell(9));
      const allowance = this.readCellNumber(row.getCell(10));
      const totalPay = this.readCellNumber(row.getCell(11));

      const result: PerformanceResultRow = {
        employeeName,
        department: this.normalizeHeaderValue(row.getCell(3).value),
        employeeType: 'doctor',
        baseSalary,
        commissionSalary,
        performanceSalary,
        bonus,
        allowance,
        totalPay:
          totalPay !== 0
            ? totalPay
            : this.roundMoney(
                baseSalary +
                  commissionSalary +
                  performanceSalary +
                  bonus +
                  allowance,
              ),
        sourceSheet: summarySheet.name,
      };

      if (this.hasMeaningfulPerformanceResult(result)) {
        rows.push(result);
      }
    }

    return rows;
  }

  private readTemplateFillTargetRows(sheet: ExcelJS.Worksheet) {
    const rows: TemplateFillRow[] = [];

    for (let rowNumber = 4; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const row = sheet.getRow(rowNumber);
      const employeeName = this.normalizeHeaderValue(row.getCell(4).value);
      if (!this.isEmployeeName(employeeName)) {
        continue;
      }

      rows.push({
        employeeName,
        department: this.normalizeHeaderValue(row.getCell(3).value),
        position: '',
        baseSalary: this.readCellNumber(row.getCell(6)),
        commissionSalary: this.readCellNumber(row.getCell(7)),
        performanceSalary: this.readCellNumber(row.getCell(8)),
        bonus: this.readCellNumber(row.getCell(9)),
        allowance: this.readCellNumber(row.getCell(10)),
        sourceSheet: sheet.name,
        targetRowNumber: rowNumber,
      });
    }

    return rows;
  }

  private async extractPerformanceRowsFromSalaryTemplate(filePath: string) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    return this.extractPerformanceRows(workbook);
  }

  private isEmployeeName(name: string) {
    if (!name) {
      return false;
    }

    const compact = name.replace(/\s+/g, '');
    if (
      compact.length < 2 ||
      /(姓名|医生|编号|序号|合计|总计|部门|岗位|备注|实发薪资|本月工资)/.test(compact)
    ) {
      return false;
    }

    return !/[0-9]{4,}/.test(compact);
  }

  private hasMeaningfulPayrollData(row: {
    baseSalary: number;
    performanceSalary: number;
    commissionSalary: number;
    allowance: number;
    socialSecurity: number;
    housingFund: number;
    tax: number;
  }) {
    return (
      row.baseSalary !== 0 ||
      row.performanceSalary !== 0 ||
      row.commissionSalary !== 0 ||
      row.allowance !== 0 ||
      row.socialSecurity !== 0 ||
      row.housingFund !== 0 ||
      row.tax !== 0
    );
  }

  private safeWorksheetName(name: string) {
    return name.replace(/[\\/*?:[\]]/g, '').slice(0, 28) || '工资单';
  }

  private normalizeUploadedFileName(fileName: string | null | undefined) {
    if (!fileName) {
      return '';
    }

    const value = String(fileName).trim();
    if (!value) {
      return '';
    }

    const looksMojibake =
      /[ÃÂÐÑÆËÎÏÕÖØÙÚÛÜÝÞßæçèéêëìíîïðñòóôõö÷øùúûü]/.test(value) ||
      /a¹|a»|a¼|é|è|ç|æ|ç»/.test(value);

    if (!looksMojibake) {
      return value;
    }

    try {
      const repaired = Buffer.from(value, 'latin1').toString('utf8').trim();
      return repaired || value;
    } catch {
      return value;
    }
  }

  private async collectTemplateCandidatePaths(
    category: string,
    excludePaths: string[],
    referencePaths: Array<string | null>,
    matcher: (fileName: string) => boolean,
  ) {
    const uploadedCandidates = await this.prisma.uploadFileFindMany({
      where: { category },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    const uploadedPaths = uploadedCandidates
      .map((item) => item.filePath)
      .filter((filePath) => !excludePaths.includes(filePath));
    const directoryPaths = await this.findWorkbookCandidatesInDirectories(
      await this.buildTemplateSearchDirectories(referencePaths),
      matcher,
    );

    return this.uniqueStrings([...uploadedPaths, ...directoryPaths]).filter(
      (filePath) => !excludePaths.includes(filePath),
    );
  }

  private async buildTemplateSearchDirectories(referencePaths: Array<string | null>) {
    const uploadedFiles = await this.prisma.uploadFileFindMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return this.uniqueStrings(
      [
        ...referencePaths
          .filter((value): value is string => Boolean(value))
          .map((filePath) => dirname(filePath)),
        ...uploadedFiles.map((item) => dirname(item.filePath)),
        this.uploadRootDir,
        this.appDataDir,
      ],
    );
  }

  private async findWorkbookCandidatesInDirectories(
    directories: string[],
    matcher: (fileName: string) => boolean,
  ) {
    const candidates: Array<{ filePath: string; mtimeMs: number }> = [];

    for (const directory of directories) {
      try {
        const entries = await readdir(directory, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isFile() || !matcher(entry.name)) {
            continue;
          }

          const filePath = join(directory, entry.name);
          const fileStat = await stat(filePath);
          candidates.push({
            filePath,
            mtimeMs: fileStat.mtimeMs,
          });
        }
      } catch {
        continue;
      }
    }

    candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
    return this.uniqueStrings(candidates.map((item) => item.filePath));
  }

  private uniqueStrings(values: string[]) {
    return [...new Set(values.filter(Boolean))];
  }
}
