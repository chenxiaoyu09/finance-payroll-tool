import { OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
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
export declare class PrismaService extends PrismaClient implements OnModuleInit {
    private readonly configService;
    private readonly logger;
    private useFileFallback;
    private readonly uploadRecordsFile;
    constructor(configService: ConfigService);
    onModuleInit(): Promise<void>;
    isUsingFileFallback(): boolean;
    uploadFileCreate(args: CreateArgs): Promise<UploadRecordEntity>;
    uploadFileFindMany(args?: FindManyArgs): Promise<UploadRecordEntity[]>;
    uploadFileFindFirst(args?: FindFirstArgs): Promise<UploadRecordEntity | null>;
    private applyWhere;
    private applyOrder;
    private ensureFileFallbackReady;
    private readUploadRecords;
    private writeUploadRecords;
}
export {};
