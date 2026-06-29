import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Header,
  Res,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import * as multer from 'multer';
import { UploadFileDto } from './dto/upload-file.dto';
import { UploadsService } from './uploads.service';

@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  @Post('excel')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: multer.memoryStorage(),
      limits: {
        fileSize: 15 * 1024 * 1024,
      },
    }),
  )
  uploadExcel(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: UploadFileDto,
  ) {
    return this.uploadsService.saveFile(file, body.category);
  }

  @Get()
  listUploads() {
    return this.uploadsService.listUploads();
  }

  @Get('workflow-status')
  workflowStatus() {
    return this.uploadsService.getWorkflowStatus();
  }

  @Post('performance/confirm')
  confirmPerformance() {
    return this.uploadsService.confirmPerformanceResult();
  }

  @Get('payroll-draft')
  payrollDraft() {
    return this.uploadsService.buildPayrollDraft();
  }

  @Get('payroll-template-fill')
  payrollTemplateFill() {
    return this.uploadsService.buildTemplateFillPreview();
  }

  @Get('performance-result')
  performanceResult() {
    return this.uploadsService.buildPerformanceResultPreview();
  }

  @Get('performance-template-fill')
  performanceTemplateFill() {
    return this.uploadsService.buildPerformanceTemplateFillPreview();
  }

  @Get('payroll-draft/export')
  @Header(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  async exportPayrollDraft(@Res() response: any) {
    const buffer = await this.uploadsService.exportPayrollDraftWorkbook();
    const fileName = `算薪草稿-${new Date().toISOString().slice(0, 10)}.xlsx`;

    response.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    );
    response.send(buffer);
  }

  @Get('payroll-draft/export-anomalies')
  @Header(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  async exportPayrollAnomalies(@Res() response: any) {
    const buffer = await this.uploadsService.exportPayrollAnomalyWorkbook();
    const fileName = `异常名单-${new Date().toISOString().slice(0, 10)}.xlsx`;

    response.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    );
    response.send(buffer);
  }

  @Get('payroll-draft/export-slips')
  @Header(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  async exportPayrollSlips(@Res() response: any) {
    const buffer = await this.uploadsService.exportPayrollSlipWorkbook();
    const fileName = `员工工资单-${new Date().toISOString().slice(0, 10)}.xlsx`;

    response.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    );
    response.send(buffer);
  }

  @Get('payroll-template-fill/export')
  @Header(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  async exportFilledPayrollTemplate(@Res() response: any) {
    const buffer = await this.uploadsService.exportFilledSalaryWorkbook();
    const fileName = `工资表模板回填结果-${new Date().toISOString().slice(0, 10)}.xlsx`;

    response.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    );
    response.send(buffer);
  }

  @Get('performance-result/export')
  @Header(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  async exportPerformanceResult(@Res() response: any) {
    const buffer = await this.uploadsService.exportPerformanceResultWorkbook();
    const fileName = `绩效结果汇总-${new Date().toISOString().slice(0, 10)}.xlsx`;

    response.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    );
    response.send(buffer);
  }

  @Get('performance-template-fill/export')
  @Header(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  async exportFilledPerformanceTemplate(@Res() response: any) {
    const buffer = await this.uploadsService.exportFilledPerformanceWorkbook();
    const fileName = `绩效表补齐结果-${new Date().toISOString().slice(0, 10)}.xlsx`;

    response.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    );
    response.send(buffer);
  }
}
