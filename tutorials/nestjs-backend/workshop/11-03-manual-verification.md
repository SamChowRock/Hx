# 手工验证与完成标准

> [返回教程首页](../README.md) · [本模块目录](README.md)

## 11.7 第七步：验证接口

最可靠的方式是复用注册或 E2E 测试得到的 Session。手动调用时：

1. 登录或注册；
2. 保存 Cookie；
3. 调 `GET /api/auth/session` 获取 CSRF Token；
4. 创建 Project；
5. 创建 Task；
6. 查询 Task；
7. 检查 `audit_events` 是否有 `task.created`。

示意 curl：

```bash
curl -c cookies.txt -b cookies.txt \
  -H 'Origin: http://localhost:5173' \
  -H 'Content-Type: application/json' \
  -d '{"identifier":"sam@example.test","password":"correct horse battery staple"}' \
  http://localhost:3000/api/auth/login/password

curl -c cookies.txt -b cookies.txt \
  http://localhost:3000/api/auth/session

curl -c cookies.txt -b cookies.txt \
  -H 'Origin: http://localhost:5173' \
  -H 'X-CSRF-Token: <上一步返回的 csrfToken>' \
  -H 'Content-Type: application/json' \
  -d '{"title":"Write the first service"}' \
  http://localhost:3000/api/organizations/<organizationId>/projects/<projectId>/tasks
```

## 11.8 第八步：完成 Definition of Done

- [ ] OWNER/ADMIN/MEMBER 可创建；
- [ ] VIEWER 返回 403；
- [ ] 非成员返回 403；
- [ ] 另一个 Organization 的 Project ID 返回 404；
- [ ] 空标题、超长标题返回 400 Problem Details；
- [ ] Task 与 AuditEvent 同时提交；
- [ ] Migration 已提交且能从旧数据库升级；
- [ ] `pnpm format:check` 通过；
- [ ] `pnpm lint` 通过；
- [ ] `pnpm typecheck` 通过；
- [ ] `pnpm test` 通过；
- [ ] `pnpm test:e2e` 通过；
- [ ] `pnpm build` 通过。
