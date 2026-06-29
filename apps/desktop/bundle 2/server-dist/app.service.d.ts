import { ConfigService } from '@nestjs/config';
import { PrismaService } from './prisma/prisma.service';
export declare class AppService {
    private readonly prismaService;
    private readonly configService;
    constructor(prismaService: PrismaService, configService: ConfigService);
    getHealth(): {
        ok: boolean;
        service: string;
        timestamp: string;
        storage: {
            uploadDir: string;
            uploadRecordMode: string;
        };
    };
}
