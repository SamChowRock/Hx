# 容器运行、安全、优雅关闭与故障排查

> [返回本模块目录](README.md)

## 1. 最小权限运行

当前 Runtime：

```dockerfile
USER app
```

Compose：

```yaml
read_only: true
tmpfs:
  - /tmp
cap_drop:
  - ALL
security_opt:
  - no-new-privileges:true
```

意义：即使应用被利用，攻击者的文件写入、提权和 Kernel 能力受限。它不能替代修补漏洞、网络策略和 Secret 管理。

## 2. Capability

Linux Root 权力被拆成 Capability，例如绑定低端口、修改网络。普通 Node API 通常不需要，故 Drop All。若确实需要，只加单项，不恢复 Privileged。

`privileged: true` 几乎移除隔离，业务 Container 禁用。

## 3. Container User 与 Host User

Container 内 UID/GID 决定 Volume/Bind Mount 权限。开发环境常见“文件由 root 创建、Host 无法编辑”。使用明确用户、`--chown` 和合理 Mount 权限解决，不用 `chmod 777`。

## 4. Secret 注入

不要：

- 写进 Dockerfile ENV；
- COPY `.env`；
- 放命令行参数后被进程列表看到；
- 打印 `docker inspect` 到公共日志；
- Bake 进前端 Bundle。

生产使用平台 Secret 注入/文件 Mount，并控制读取身份、轮换和审计。

## 5. Graceful Shutdown

```text
SIGTERM
→ Readiness false
→ 停接新请求/Job
→ Drain in-flight
→ 关闭 DB/Redis
→ Exit before grace period
```

Docker 默认 Stop 会先发 SIGTERM，超时后 SIGKILL。SIGKILL 无清理机会。

实验：持续发请求/投递时执行：

```bash
docker compose stop api worker
docker compose logs --tail=100 api worker
```

检查 Shutdown Log 和重复副作用。

## 6. 资源限制与 OOM

Container Memory 达上限可能被 OOM Kill，Node 没机会 Catch。调查：

```bash
docker inspect <container>
docker stats
```

观察 Exit Code、OOMKilled。区分 Memory Leak、合理峰值、过低 Limit 和大 Body/导出。

## 7. 调试顺序

```bash
docker compose ps
docker compose logs --tail=200 <service>
docker compose exec <service> id
docker compose exec <service> env
docker compose exec <service> ps
docker compose config
docker inspect <container>
docker stats
```

打印 Environment 时避免泄漏 Secret。

## 8. 常见失败

### Container 立刻 Exit

- Command 路径错误；
- Env Schema 失败；
- Migration 失败；
- Native Module 不兼容；
- 文件权限；
- 连接依赖失败。

### Host 可连、Container 不可连

- 错用 localhost；
- Service DNS/Network；
- 目标只监听 127.0.0.1；
- TLS/凭据；
- 防火墙/网络策略。

### Volume 权限

- UID/GID 不一致；
- Host SELinux（Linux）；
- Read-only Mount；
- 旧 Volume 初始化用户不同。

## 9. 不要在生产 Container 内手改

`docker exec` 修改文件只存在某个实例可写层，重建消失且其他实例不一致。修复应进入源码、Image、配置或受审计运维流程。

## 10. 日志

应用写 stdout/stderr，让平台收集。不要依赖 Container 内本地日志文件；会占可写层、无法集中、随 Container 删除。

结构化 JSON、Request ID、脱敏和保留策略仍由应用/平台负责。

## 11. Image/Runtime 扫描

- 基础 Image CVE；
- OS Package；
- Node Dependency；
- Malware/Secret；
- SBOM；
- 签名；
- Runtime 异常行为。

扫描结果要结合可利用性和补丁计划，不是只追求零 CVE。

## 12. 综合故障演练

依次模拟：

1. PostgreSQL Stop；
2. Mailpit Stop；
3. API SIGTERM；
4. Worker SIGKILL；
5. Read-only 写入；
6. 错误 AUTH_SECRET；
7. Host 端口冲突；
8. Volume 删除（仅隔离环境）。

每项记录症状、日志、数据状态、恢复和防止复发。

## 13. 验收问题

1. 非 root 与 Drop Capability 分别保护什么？
2. 为什么 Read-only Root 仍保留 tmpfs？
3. SIGTERM 与 SIGKILL 的差异？
4. 为什么 Container 内手改不是发布？
5. OOM 时为什么可能没有应用错误日志？
6. stdout 日志如何进入集中平台？

---

[上一章：Compose 网络与存储](03-compose-network-storage.md) · [返回模块目录](README.md) · [下一章：PostgreSQL 运行架构](05-postgresql-mental-model.md)
