import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from './prisma/prisma.service';

@Injectable()
export class AppService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  getHealth() {
    const appDataDir =
      this.configService.get<string>('APP_DATA_DIR') || process.cwd();
    const uploadDir =
      this.configService.get<string>('UPLOAD_DIR') || `${appDataDir}/uploads`;

    return {
      ok: true,
      service: 'finance-payroll-server',
      timestamp: new Date().toISOString(),
      storage: {
        uploadDir,
        uploadRecordMode: this.prismaService.isUsingFileFallback()
          ? 'local-json-fallback'
          : 'database',
      },
    };
  }
}
