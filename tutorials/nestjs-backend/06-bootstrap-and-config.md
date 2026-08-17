# 6. 理解 API 的启动和全局配置

> [返回教程首页](README.md)

## 6.1 `main.ts` 的启动顺序

`apps/api/src/main.ts` 做了这些工作：

1. `dotenv/config` 把 `.env` 加载到 `process.env`；
2. `loadEnvironment()` 用 Zod 校验配置；
3. `NestFactory.create(AppModule, { bufferLogs: true })` 创建应用；
4. 取出 Pino Logger 并替换 Nest 默认日志器；
5. 调用 `configureApplication()`；
6. 注册日志错误拦截器；
7. 启用优雅关闭；
8. 按配置设置反向代理信任；
9. 设置带凭据的 CORS；
10. 仅在 development/test 暴露 Swagger；
11. 监听 `0.0.0.0:PORT`。

## 6.2 `configureApplication()` 的职责

全局配置包括：

- Helmet 安全响应头；
- 对 `/api/auth` 响应添加 `no-store`；
- Cookie 解析；
- 全局 `ProblemDetailsFilter`；
- 全局路由前缀 `/api`。

因此 Controller 写的是：

```ts
@Controller('health')
```

最终 URL 却是 `/api/health`。

## 6.3 根模块 `AppModule`

根模块组装全部功能模块，并注册全局限流 Guard：

```ts
ThrottlerModule.forRoot([{ ttl: 60_000, limit: 30 }]);
```

即默认每 60 秒最多 30 次。健康检查通过 `@SkipThrottle()` 跳过限流。

Pino 配置会脱敏 Authorization、Cookie、CSRF Token、密码、验证码、Token 和 `Set-Cookie`。新增敏感字段时，要同步扩充 `redact.paths`。**不要通过打印请求体来解决调试问题。**

## 6.4 环境变量是应用契约

`libs/platform/src/config/environment.ts` 不只是读取字符串，还会：

- 转换 `PORT` 和布尔值；
- 限制 `NODE_ENV`、`LOG_LEVEL` 等枚举；
- 在 staging/production 禁止默认 `AUTH_SECRET`；
- 在部署环境要求 HTTPS；
- 检查 CORS 是否包含 Web Origin；
- 要求 OIDC 配置成组出现；
- 要求微信 Provider Key、AppID、AppSecret 成组出现；
- 禁止微信与 OIDC 使用相同 Provider Key；
- 启用 Twilio 时要求完整凭据。

Profile 的私有头像还使用一组 S3 兼容对象存储变量：`OBJECT_STORAGE_ENDPOINT`、Region、Access Key、Secret Key、Bucket 和 Path-style 开关。development/test 可用本地 MinIO 默认值；staging/production 必须使用 HTTPS Endpoint，且不能复用 `minioadmin` 本地凭据。这个差异是安全边界：本地自动建 Bucket 方便实验，生产应在部署前由基础设施和访问策略显式创建私有 Bucket。

新增配置的正确流程是：

1. 在 `environmentSchema` 中定义、转换和校验；
2. 更新 `Environment` 自动推导类型；
3. 更新 `.env.example`；
4. 更新 `docker-compose.yml`/部署 Secret；
5. 给合法值和非法值补配置单元测试；
6. 通过 `@Inject(ENVIRONMENT)` 使用，不在业务代码里散落 `process.env.X`。

---
