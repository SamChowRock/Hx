# Dockerfile：构建上下文、Layer、缓存与多阶段构建

> [返回本模块目录](README.md)

## 1. Build Context

```bash
docker build -f Dockerfile .
```

最后的 `.` 是 Build Context。`COPY` 只能访问 Context 中的文件。Context 过大会：

- 发送慢；
- Cache 频繁失效；
- 可能把 `.env`、Git 历史和本地垃圾送给 Builder。

使用 `.dockerignore` 排除：

```text
.git
node_modules
dist
coverage
.env
*.log
```

Secret 不仅要忽略，还应使用 BuildKit Secret Mount，而不是 ARG/ENV。

## 2. 当前多阶段 Dockerfile

```text
base
├─ dependencies
│  ├─ build
│  └─ migration
└─ runtime（复制 build 结果）
```

职责：

- `base`：Node、工作目录、非 root 用户；
- `dependencies`：Frozen Lockfile 安装；
- `build`：复制源码、生成 Prisma、编译、Prune；
- `migration`：只携带 Prisma/Migration 工具；
- `runtime`：只复制生产依赖和 dist。

Multi-stage 减少 Runtime Image，不把 TypeScript Compiler、测试文件和 Build Tool 带进生产。

## 3. Cache Friendly 顺序

```dockerfile
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
```

依赖只在 Manifest/Lockfile 变化时重装。源码变化只重跑后续 Build。

## 4. `--frozen-lockfile`

保证 Build 不偷偷修改依赖解析。相同 Lockfile 更接近可重复构建。还需要固定基础 Image Digest，避免 Tag 指向新内容。

```dockerfile
FROM node:24.19.0-alpine@sha256:...
```

固定 Digest 提升可重复性，但需要定期主动更新安全补丁。

## 5. Alpine 的取舍

Alpine 小，使用 musl libc；某些原生 Node Module 在 musl 下需要特殊 Binary/编译。Debian slim 更大但兼容 glibc 生态。选择要基于：

- Argon2/Prisma Native Dependency；
- Debug 工具；
- CVE/补丁；
- Image 大小和启动；
- 团队运维经验。

小 Image 不自动更安全；关键是最少包、及时更新、扫描和非 root。

## 6. ARG 与 ENV

- `ARG` 主要 Build 时可用；
- `ENV` 会进入 Image/Runtime；
- 二者都不适合 Secret，因为可能出现在 History/Metadata。

生产 Secret 在运行时通过 Secret Manager 注入。

## 7. COPY Ownership

Runtime：

```dockerfile
COPY --from=build --chown=app:app /app/node_modules ./node_modules
USER app
```

非 root 用户需要能读文件，但不应拥有不必要写权限。

## 8. Entrypoint 与 Command

Image 默认：

```dockerfile
CMD ["node", "dist/apps/api/src/main.js"]
```

Worker 在 Compose Override：

```yaml
command: ['node', 'dist/apps/worker/src/main.js']
```

Migration 使用独立 Target/Command，避免每个 API Replica 都跑 Migration。

## 9. 构建检查

```bash
docker compose build migration api worker
docker image ls
docker history nestjs-production-scaffold:local
docker inspect nestjs-production-scaffold:local
```

查看是否包含不期望 Layer/ENV。不要在输出中泄露 Secret。

## 10. Cache 实验

连续 Build 两次，记录 Cached Step。然后：

1. 只改一个 `.ts`；
2. 再 Build；
3. 改 `package.json`；
4. 再 Build。

解释哪些 Layer 失效、为什么。

## 11. Runtime Smoke Test

```bash
docker run --rm --read-only \
  --tmpfs /tmp \
  -e NODE_ENV=test \
  -e DATABASE_URL='postgresql://...' \
  nestjs-production-scaffold:local
```

更完整验证使用 Compose 网络和健康检查。

## 12. 供应链

- 依赖/镜像扫描；
- SBOM；
- 签名与 Provenance；
- 固定/更新基础 Image；
- 不运行未知 Install Script；
- CI Build 权限最小化；
- Registry Immutable Tag/Digest；
- Runtime 无 Docker Socket。

## 13. 验收问题

1. 为什么 `.env` 即使后续删除也不能先 COPY？
2. Multi-stage 如何降低攻击面？
3. 为什么不在 API 启动时自动 Migration？
4. Alpine 和 Debian slim 如何选择？
5. Tag 与 Digest 有何不同？
6. 为什么 Build Cache 会影响本地效率但不应改变产物正确性？

---

[上一章：Docker 运行模型](01-docker-mental-model.md) · [返回模块目录](README.md) · [下一章：Compose 网络与存储](03-compose-network-storage.md)
