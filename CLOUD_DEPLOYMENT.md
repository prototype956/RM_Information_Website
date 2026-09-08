# Sites 部署

本地 Express 服务继续使用 `npm run dev`，原数据库及文件目录不变。云端使用独立的 Cloudflare Worker、D1 和 R2，前端与本地共用。

`npm run build:cloud` 输出 `dist/client` 与 `dist/server/index.js`；`npm run test:cloud` 在隔离的 Workers 模拟环境验证接口。原有服务回归为 `npm test`。

数据库结构由 `db/schema.ts` 和 `drizzle/` 管理。已经上线的迁移文件不可重写；修改结构后运行 `npx drizzle-kit generate` 并检查新迁移。

首次迁移通过限时秘密 `MIGRATION_TOKEN` 和 `MIGRATION_EXPIRES` 保护，只允许导入到没有用户的数据表。`scripts/migrate-cloud.mjs` 从标准输入读取地址与凭据，从本地数据库一致性快照读取数据；先上传文件，再原子导入数据。不迁移旧登录会话，原账号密码保持有效。成功后移除迁移环境变量并再次发布。报告只保留数量及文件校验值，位于忽略的 `artifacts/cloud/`。

云端每次写入使用 D1 原子批次和全局乐观版本检查。其他成员同时修改内容时可能提示重试，以避免分类变更和发布之间的引用丢失。文件使用 5 MiB 分片流式上传，最多 5 个文件，每个 50 MB。

Sites 访问权限与队伍账号权限分开。当前按仅所有者可访问发布；开放给队友前须设置 Sites 的访问范围，站内仍要求队伍邀请注册。

本地与云端迁移后是两份独立数据，不会自动双向同步。不要将 `data/`、`artifacts/`、本地凭据或登录会话提交进源代码、迁移 SQL 或前端资源。
