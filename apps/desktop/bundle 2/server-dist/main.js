"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const common_1 = require("@nestjs/common");
const app_module_1 = require("./app.module");
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule);
    app.setGlobalPrefix('api');
    const corsOrigins = (process.env.CORS_ORIGINS || 'http://127.0.0.1:5173,http://localhost:5173')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    app.enableCors({
        origin: corsOrigins,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
        credentials: false,
    });
    app.useGlobalPipes(new common_1.ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
    }));
    const port = Number(process.env.APP_PORT || 3000);
    const host = process.env.APP_HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
    await app.listen(port, host);
    console.log(`finance-payroll-server running on http://${host}:${port}/api`);
}
bootstrap();
//# sourceMappingURL=main.js.map