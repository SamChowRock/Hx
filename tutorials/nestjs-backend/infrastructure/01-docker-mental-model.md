# Docker 运行模型：镜像、容器、进程与文件系统

> [返回本模块目录](README.md)

## 1. Docker 首先是进程隔离，不是一台轻量虚拟机

虚拟机通常包含自己的 Guest Kernel；Linux Container 与 Host 共享 Kernel，通过 Namespace、Cgroup、Capability 和分层文件系统隔离。

```text
Virtual Machine:
Hardware → Host OS/Hypervisor → Guest Kernel → Processes

Container:
Hardware → Host Kernel → Namespaces/Cgroups → Processes
```

因此：

- Container 启动很快，因为不是启动完整 OS；
- Container 内的 Node 仍是 Host Kernel 管理的进程；
- Kernel 漏洞和 Runtime 配置仍影响隔离；
- macOS/Windows 的 Docker Desktop 实际通过 Linux VM 运行 Linux Container；
- Container 不是安全边界的全部，仍需非 root、Capability 和网络策略。

## 2. Image 与 Container

- Image：只读模板，由 Layer 组成；
- Container：Image 加一层可写层和运行配置；
- 一个 Image 可创建多个 Container；
- 删除 Container 不删除 Image；
- Container 可写层不是持久数据库存储。

当前项目：

```text
nestjs-production-scaffold:local Image
  ├─ API Container
  └─ Worker Container（相同 Image，不同 command）
```

这体现“Build Once, Run Different Process Types”。

## 3. Image Layer

Dockerfile 中大多数指令产生 Layer：

```dockerfile
FROM node:24.19.0-alpine
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
```

如果源代码变化但 Lockfile 不变，依赖 Layer 可复用。反过来先 `COPY . .` 再 Install，会让任何文件变化都使依赖缓存失效。

Layer 是不可变的。后续 `RUN rm large-file` 只在新 Layer 隐藏文件，早期 Layer 中的数据仍可能存在并增加 Image；Secret 绝不能 Copy 进 Build Context/Layer 后再删除。

## 4. Container 文件系统

Container 有临时可写层：

```text
Read-only Image Layers
+ Container Writable Layer
= Container View
```

Container 删除时，可写层通常丢失。所以 PostgreSQL 使用 Named Volume：

```yaml
volumes:
  - postgres-data:/var/lib/postgresql/data
```

API/Worker 则设置 `read_only: true`，因为应用不应依赖本地写入；临时文件只允许 `/tmp` tmpfs。

## 5. Namespace

主要隔离：

- PID：Container 看到自己的进程编号；
- Network：自己的网卡、路由、端口；
- Mount：自己的文件系统视图；
- UTS：Hostname；
- IPC：进程通信；
- User：用户 ID 映射。

Namespace 提供“看起来独立”的视图，不意味着资源无限。

## 6. Cgroup

Cgroup 控制/统计：

- CPU；
- Memory；
- PIDs；
- I/O。

如果没有资源 Limit，一个导出任务可能占满 Host。Production 应给 API、Worker 和数据库合理 Request/Limit，并观察 OOMKilled、CPU Throttle 和 I/O。

## 7. PID 1 与信号

Container 中 Entrypoint/Command 进程常是 PID 1。PID 1 有特殊职责：

- 接收 SIGTERM；
- 转发/处理信号；
- 回收 Zombie Child Process。

Compose 使用：

```yaml
init: true
```

它加入轻量 Init，改善信号和 Zombie 处理。Nest 还调用 `enableShutdownHooks()`，Worker 在 Shutdown 停止 Poll。

不要用会吞信号的 Shell 包装：

```dockerfile
CMD node app.js       # shell form，可能经过 /bin/sh
CMD ["node", "app.js"] # exec form，Node 直接接收信号
```

## 8. Container 生命周期

```text
create → start → running → stopping → exited → removed
```

Container Exited 不代表数据 Volume 删除。Restart 创建/启动进程，不会自动修复坏 Migration、错误配置或永久 Provider 故障。

## 9. Port 与进程监听

应用在 Container 内监听：

```ts
app.listen(PORT, '0.0.0.0');
```

监听 `127.0.0.1` 只允许 Container 自己访问；监听 `0.0.0.0` 才能经 Container Network/Port Publish 访问。

```yaml
ports:
  - '3000:3000'
```

左边 Host Port，右边 Container Port。Container 间通信不使用 Host Port，而使用服务名和 Container Port。

## 10. 实验

```bash
docker compose ps
docker compose top api
docker compose exec api id
docker compose exec api ps
docker inspect nestjs-production-scaffold-api-1
```

Container 名可能因 Compose Project 名变化，优先用 `docker compose exec <service>`。

检查只读文件系统：

```bash
docker compose exec api sh -lc 'touch /app/should-fail'
docker compose exec api sh -lc 'touch /tmp/should-work'
```

## 11. 验收问题

1. 为什么删掉 API Container 不应丢业务数据？
2. 为什么删 PostgreSQL Volume 会丢数据？
3. 为什么 API 和 Worker 可以用同一 Image？
4. `EXPOSE 3000` 与 `ports` 有什么区别？
5. 为什么 Container 内的 localhost 不是 Host？
6. OOMKilled 与普通应用异常有什么区别？
7. 为什么 PID 1 和 SIGTERM 会影响重复投递？

---

[返回模块目录](README.md) · [下一章：Dockerfile、Layer 与多阶段构建](02-dockerfile-build.md)
