# 15. 测试：从单元测试到 E2E

> [返回教程首页](README.md)

## 15.1 当前测试布局

```text
apps/**/*.spec.ts       # 单元测试
test/*.e2e-spec.ts      # E2E 测试
jest.config.cjs         # 单元测试配置
jest.e2e.config.cjs     # E2E 配置
```

运行：

```bash
pnpm test
pnpm test:watch
pnpm test:e2e
```

E2E 需要可用 PostgreSQL 和已执行 Migration：

```bash
docker compose up --detach --wait postgres
pnpm prisma:migrate:deploy
pnpm test:e2e
```

## 15.2 单元测试测什么

单元测试适合：

- 角色矩阵；
- 校验和纯函数；
- Session/Token 规则；
- Worker 重试状态；
- 环境变量组合；
- Service 在依赖不同返回值时的分支。

授权测试采用轻量 Mock：

```ts
const database = {
  membership: {
    findUnique: jest.fn().mockResolvedValue({ role: 'VIEWER' }),
  },
};

const service = new AuthorizationService({} as never, database as never);
await expect(
  service.requireOrganizationAction(actor, organizationId, 'manage_tasks'),
).rejects.toBeInstanceOf(ForbiddenException);
```

不要把 Prisma 的行为全部 Mock 一遍，那会让测试只验证你自己的 Mock。

## 15.3 E2E 测什么

E2E 用 `Test.createTestingModule({ imports: [AppModule] })` 启动真实 Nest 应用，用 Supertest 调 HTTP，并连接真实 PostgreSQL。它适合验证：

- 路由是否真的注册；
- Cookie 是否在连续请求中保留；
- Origin/CSRF 是否生效；
- Zod 异常是否转成 Problem Details；
- Prisma Relation、Constraint 和 Transaction；
- 跨租户访问是否被拒绝；
- 最终数据库状态是否正确。

Tasks 至少应写以下 E2E：

1. OWNER 创建成功，返回 201，并有审计事件；
2. VIEWER 创建返回 403，Task 数量不变；
3. Outsider 创建返回 403；
4. 用组织 A Session + 组织 B Project ID 返回 404；
5. 空标题返回 400 和 `application/problem+json`；
6. 无 CSRF、错误 Origin 均返回 403。

## 15.4 测试隔离

现有 E2E 在每个用例前 `TRUNCATE ... CASCADE`。新增 `tasks` 表后，要更新清理 SQL，通常把 `tasks` 放在 `projects` 前面。该方式只适合专用测试数据库，绝不能指向开发共享库或生产库。

更成熟的选择包括：

- 每个测试 Suite 独立数据库；
- Testcontainers；
- 测试事务 + 回滚；
- 唯一命名空间和精准清理。

## 15.5 推荐测试比例

```text
大量：纯规则/Service 单元测试
适量：数据库与 HTTP E2E
少量：贯穿真实外部 Provider 的集成测试
```

认证、授权、支付、跨租户隔离等高风险路径，不要只写 Happy Path。

## 15.6 Arrange、Act、Assert

每个测试尽量保持三段清楚：

```ts
it('blocks a viewer from creating a project', async () => {
  // Arrange：准备 Viewer、Session、Organization

  // Act：发起创建请求
  const response = await request(app.getHttpServer())
    .post(url)
    .set('Cookie', viewerCookie)
    .set('Origin', webOrigin)
    .set('X-CSRF-Token', viewerCsrf)
    .send({ name: 'Forbidden project' });

  // Assert：HTTP 被拒绝，而且数据库没有副作用
  expect(response.status).toBe(403);
  await expect(database.project.count()).resolves.toBe(0);
});
```

只断言 403 不够：代码可能先写入数据库再错误返回。拒绝路径要同时断言“没有产生副作用”。

## 15.7 应该 Mock 什么，不应该 Mock 什么

单元测试可以 Mock：

- DatabaseService 的返回；
- SMTP/Twilio 等 Provider；
- 时间、随机数的边界；
- Logger；
- 下游 Service 接口。

不要在 E2E 中 Mock：

- Controller 路由注册；
- ProblemDetailsFilter；
- Cookie Parser；
- AuthorizationService；
- Prisma Relation/Constraint；
- Transaction 的核心结果。

否则所谓 E2E 只是在验证一串 Mock。

对真实外部 Provider 不应让普通 CI 每次发短信/邮件。用契约测试验证请求形状，再用少量受控 Staging Smoke Test 验证真实凭据和网络。

## 15.8 测试时间与随机性

认证代码有过期时间、最短响应时间和随机 Token。测试原则：

- Worker 定时轮询使用 Jest Fake Timers；
- 过期测试构造明确过去/未来 Date；
- 不断言随机 Token 的具体值，只断言类型、长度和一次性；
- 密码 Hash 慢是安全性质，不要把生产 Argon2 参数偷偷降到测试代码路径后忘记风险；
- 对并发上限写明确测试，不依赖机器刚好够快；
- 测试结束恢复 Real Timers，避免污染其他 Suite。

## 15.9 看懂一次失败测试

建议按这个顺序读：

1. 第一个真正失败的 Assertion，不要先看后续连锁错误；
2. Expected 与 Received 的最小差异；
3. HTTP 状态不对时先打印安全的 `response.status/body`，不要打印 Cookie；
4. 查应用日志中的 Request ID；
5. 查数据库最终状态，判断失败发生在授权前、事务中还是响应映射；
6. 单独运行该测试，判断是否顺序污染；
7. 再运行完整 Suite，验证隔离。

单独运行 Unit Test：

```bash
pnpm exec jest --runInBand apps/api/src/tasks/tasks.service.spec.ts
```

单独运行 E2E：

```bash
pnpm exec jest --config jest.e2e.config.cjs --runInBand test/tasks.e2e-spec.ts
```

## 15.10 测试数据库安全红线

现有 E2E 会执行 `TRUNCATE ... CASCADE`。因此必须确保：

- 使用专门的本地/CI 测试数据库；
- `NODE_ENV=test`；
- 数据库名符合测试命名规则；
- 生产凭据绝不出现在测试环境；
- 最好在 Test Bootstrap 中增加数据库名安全断言；
- CI 每次使用临时数据库实例。

可以增加类似保护：

```ts
const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
if (process.env.NODE_ENV !== 'test' || !databaseUrl.pathname.includes('test')) {
  throw new Error('Refusing to run destructive E2E setup outside a test database.');
}
```

当前默认 E2E URL 使用 `scaffold` 数据库，没有数据库名防护。学习或团队化改造时，应优先补上这一道安全保护。

---
