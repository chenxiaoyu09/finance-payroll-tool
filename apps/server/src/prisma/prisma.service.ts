import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

type UploadRecordEntity = {
  id: bigint;
  originalName: string;
  storedName: string;
  mimeType: string;
  size: number;
  category: string;
  filePath: string;
  createdAt: Date;
};

type UploadRecordJson = {
  id: string;
  originalName: string;
  storedName: string;
  mimeType: string;
  size: number;
  category: string;
  filePath: string;
  createdAt: string;
};

type FindFirstArgs = {
  where?: {
    category?: string;
    id?: bigint;
    originalName?: {
      contains?: string;
    };
  };
  orderBy?: {
    createdAt?: 'asc' | 'desc';
  };
};

type FindManyArgs = {
  where?: {
    category?: string;
    id?: {
      not?: bigint;
    };
  };
  orderBy?: {
    createdAt?: 'asc' | 'desc';
  };
  take?: number;
};

type CreateArgs = {
  data: {
    originalName: string;
    storedName: string;
    mimeType: string;
    size: number;
    category: string;
    filePath: string;
  };
};

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  private readonly logger = new Logger(PrismaService.name);
  private useFileFallback = false;
  private readonly uploadRecordsFile: string;

  constructor(private readonly configService: ConfigService) {
    super();

    const appDataDir =
      configService.get<string>('APP_DATA_DIR') || process.cwd();
    const uploadDir =
      configService.get<string>('UPLOAD_DIR') || join(appDataDir, 'uploads');
    this.uploadRecordsFile = join(uploadDir, 'upload-records.json');
  }

  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log('Prisma connected, using database persistence');
    } catch (error) {
      this.useFileFallback = true;
      this.logger.warn(
        `Prisma connection failed, fallback to local file storage: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await this.ensureFileFallbackReady();
    }
  }

  isUsingFileFallback() {
    return this.useFileFallback;
  }

  async uploadFileCreate(args: CreateArgs): Promise<UploadRecordEntity> {
    if (!this.useFileFallback) {
      return super.uploadFile.create(args as never) as Promise<UploadRecordEntity>;
    }

    const records = await this.readUploadRecords();
    const nextId =
      records.length > 0
        ? records.reduce((max, item) => (item.id > max ? item.id : max), 0n) + 1n
        : 1n;

    const created: UploadRecordEntity = {
      id: nextId,
      originalName: args.data.originalName,
      storedName: args.data.storedName,
      mimeType: args.data.mimeType,
      size: args.data.size,
      category: args.data.category,
      filePath: args.data.filePath,
      createdAt: new Date(),
    };

    records.push(created);
    await this.writeUploadRecords(records);
    return created;
  }

  async uploadFileFindMany(
    args?: FindManyArgs,
  ): Promise<UploadRecordEntity[]> {
    if (!this.useFileFallback) {
      return super.uploadFile.findMany(args as never) as Promise<UploadRecordEntity[]>;
    }

    const records = await this.readUploadRecords();
    let filtered = this.applyWhere(records, args?.where);
    filtered = this.applyOrder(filtered, args?.orderBy);

    if (typeof args?.take === 'number') {
      filtered = filtered.slice(0, args.take);
    }

    return filtered;
  }

  async uploadFileFindFirst(
    args?: FindFirstArgs,
  ): Promise<UploadRecordEntity | null> {
    if (!this.useFileFallback) {
      return super.uploadFile.findFirst(args as never) as Promise<UploadRecordEntity | null>;
    }

    const items = await this.uploadFileFindMany({
      where: {
        category: args?.where?.category,
      },
      orderBy: args?.orderBy,
    });

    const filtered = items.filter((item) => {
      if (args?.where?.id !== undefined && item.id !== args.where.id) {
        return false;
      }

      const contains = args?.where?.originalName?.contains;
      if (contains && !item.originalName.includes(contains)) {
        return false;
      }

      return true;
    });

    return filtered[0] || null;
  }

  private applyWhere(
    records: UploadRecordEntity[],
    where?: { category?: string; id?: { not?: bigint } },
  ) {
    return records.filter((item) => {
      if (where?.category && item.category !== where.category) {
        return false;
      }

      if (where?.id?.not !== undefined && item.id === where.id.not) {
        return false;
      }

      return true;
    });
  }

  private applyOrder(
    records: UploadRecordEntity[],
    orderBy?: { createdAt?: 'asc' | 'desc' },
  ) {
    if (!orderBy?.createdAt) {
      return [...records];
    }

    const direction = orderBy.createdAt === 'asc' ? 1 : -1;
    return [...records].sort(
      (left, right) =>
        (left.createdAt.getTime() - right.createdAt.getTime()) * direction,
    );
  }

  private async ensureFileFallbackReady() {
    await mkdir(dirname(this.uploadRecordsFile), { recursive: true });

    try {
      await readFile(this.uploadRecordsFile, 'utf-8');
    } catch {
      await writeFile(this.uploadRecordsFile, '[]', 'utf-8');
    }
  }

  private async readUploadRecords(): Promise<UploadRecordEntity[]> {
    await this.ensureFileFallbackReady();
    const content = await readFile(this.uploadRecordsFile, 'utf-8');
    const raw = JSON.parse(content) as UploadRecordJson[];

    return raw.map((item) => ({
      id: BigInt(item.id),
      originalName: item.originalName,
      storedName: item.storedName,
      mimeType: item.mimeType,
      size: item.size,
      category: item.category,
      filePath: item.filePath,
      createdAt: new Date(item.createdAt),
    }));
  }

  private async writeUploadRecords(records: UploadRecordEntity[]) {
    await this.ensureFileFallbackReady();
    const payload: UploadRecordJson[] = records.map((item) => ({
      id: item.id.toString(),
      originalName: item.originalName,
      storedName: item.storedName,
      mimeType: item.mimeType,
      size: item.size,
      category: item.category,
      filePath: item.filePath,
      createdAt: item.createdAt.toISOString(),
    }));

    await writeFile(
      this.uploadRecordsFile,
      JSON.stringify(payload, null, 2),
      'utf-8',
    );
  }
}
