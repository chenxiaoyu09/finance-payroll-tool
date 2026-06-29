"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var PrismaService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrismaService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const client_1 = require("@prisma/client");
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
let PrismaService = PrismaService_1 = class PrismaService extends client_1.PrismaClient {
    constructor(configService) {
        super();
        this.configService = configService;
        this.logger = new common_1.Logger(PrismaService_1.name);
        this.useFileFallback = false;
        const appDataDir = configService.get('APP_DATA_DIR') || process.cwd();
        const uploadDir = configService.get('UPLOAD_DIR') || (0, node_path_1.join)(appDataDir, 'uploads');
        this.uploadRecordsFile = (0, node_path_1.join)(uploadDir, 'upload-records.json');
    }
    async onModuleInit() {
        try {
            await this.$connect();
            this.logger.log('Prisma connected, using database persistence');
        }
        catch (error) {
            this.useFileFallback = true;
            this.logger.warn(`Prisma connection failed, fallback to local file storage: ${error instanceof Error ? error.message : String(error)}`);
            await this.ensureFileFallbackReady();
        }
    }
    isUsingFileFallback() {
        return this.useFileFallback;
    }
    async uploadFileCreate(args) {
        if (!this.useFileFallback) {
            return super.uploadFile.create(args);
        }
        const records = await this.readUploadRecords();
        const nextId = records.length > 0
            ? records.reduce((max, item) => (item.id > max ? item.id : max), 0n) + 1n
            : 1n;
        const created = {
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
    async uploadFileFindMany(args) {
        if (!this.useFileFallback) {
            return super.uploadFile.findMany(args);
        }
        const records = await this.readUploadRecords();
        let filtered = this.applyWhere(records, args?.where);
        filtered = this.applyOrder(filtered, args?.orderBy);
        if (typeof args?.take === 'number') {
            filtered = filtered.slice(0, args.take);
        }
        return filtered;
    }
    async uploadFileFindFirst(args) {
        if (!this.useFileFallback) {
            return super.uploadFile.findFirst(args);
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
    applyWhere(records, where) {
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
    applyOrder(records, orderBy) {
        if (!orderBy?.createdAt) {
            return [...records];
        }
        const direction = orderBy.createdAt === 'asc' ? 1 : -1;
        return [...records].sort((left, right) => (left.createdAt.getTime() - right.createdAt.getTime()) * direction);
    }
    async ensureFileFallbackReady() {
        await (0, promises_1.mkdir)((0, node_path_1.dirname)(this.uploadRecordsFile), { recursive: true });
        try {
            await (0, promises_1.readFile)(this.uploadRecordsFile, 'utf-8');
        }
        catch {
            await (0, promises_1.writeFile)(this.uploadRecordsFile, '[]', 'utf-8');
        }
    }
    async readUploadRecords() {
        await this.ensureFileFallbackReady();
        const content = await (0, promises_1.readFile)(this.uploadRecordsFile, 'utf-8');
        const raw = JSON.parse(content);
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
    async writeUploadRecords(records) {
        await this.ensureFileFallbackReady();
        const payload = records.map((item) => ({
            id: item.id.toString(),
            originalName: item.originalName,
            storedName: item.storedName,
            mimeType: item.mimeType,
            size: item.size,
            category: item.category,
            filePath: item.filePath,
            createdAt: item.createdAt.toISOString(),
        }));
        await (0, promises_1.writeFile)(this.uploadRecordsFile, JSON.stringify(payload, null, 2), 'utf-8');
    }
};
exports.PrismaService = PrismaService;
exports.PrismaService = PrismaService = PrismaService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], PrismaService);
//# sourceMappingURL=prisma.service.js.map