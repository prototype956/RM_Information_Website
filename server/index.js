import express from "express";
import multer from "multer";
import { DatabaseSync } from "node:sqlite";
import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { seedResources } from "./seed.js";
import { installRoadmaps } from "./roadmaps.js";
import { createTaxonomy } from "./taxonomy.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, "data"));
const fileDir = path.join(dataDir, "files");
fs.mkdirSync(fileDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, "resources.db"));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),expires INTEGER);
 CREATE TABLE IF NOT EXISTS invitations(id TEXT PRIMARY KEY,token_hash TEXT UNIQUE,created_by TEXT,expires INTEGER,used INTEGER DEFAULT 0);
 CREATE TABLE IF NOT EXISTS resources(id TEXT PRIMARY KEY,title TEXT,domain TEXT,category TEXT,tags TEXT,kind TEXT,url TEXT,description TEXT,owner_id TEXT REFERENCES users(id),created_at INTEGER,updated_at INTEGER,sample INTEGER DEFAULT 0,hidden INTEGER DEFAULT 0);
 CREATE TABLE IF NOT EXISTS attachments(id TEXT PRIMARY KEY,resource_id TEXT REFERENCES resources(id) ON DELETE CASCADE,storage_key TEXT,name TEXT,mime TEXT,size INTEGER);
 CREATE TABLE IF NOT EXISTS favorites(user_id TEXT REFERENCES users(id),resource_id TEXT REFERENCES resources(id) ON DELETE CASCADE,PRIMARY KEY(user_id,resource_id));
 CREATE TABLE IF NOT EXISTS recent(user_id TEXT REFERENCES users(id),resource_id TEXT REFERENCES resources(id) ON DELETE CASCADE,viewed_at INTEGER,PRIMARY KEY(user_id,resource_id));
`);
const app = express();
const taxonomy = createTaxonomy(db);
app.disable("x-powered-by");
const hashToken = (token) => createHash("sha256").update(token).digest("hex");
const publicUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
});
const passwordHash = (password) => {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
};
const passwordMatches = (password, stored) => {
  const [salt, hash] = stored.split(":");
  return timingSafeEqual(
    Buffer.from(hash, "hex"),
    scryptSync(password, salt, 64),
  );
};
const fail = (res, status, error) => res.status(status).json({ error });
const setupNeeded = () => !db.prepare("SELECT id FROM users LIMIT 1").get();
const validAccount = (body) =>
  typeof body.name === "string" &&
  body.name.trim().length >= 1 &&
  body.name.trim().length <= 40 &&
  typeof body.email === "string" &&
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email) &&
  typeof body.password === "string" &&
  body.password.length >= 10 &&
  body.password.length <= 128;
const cookieSecure = process.env.COOKIE_SECURE === "1" ? "; Secure" : "";
function session(res, user) {
  const token = randomBytes(32).toString("hex");
  db.prepare("DELETE FROM sessions WHERE expires < ?").run(Date.now());
  db.prepare("INSERT INTO sessions VALUES (?,?,?)").run(
    hashToken(token),
    user.id,
    Date.now() + 7 * 86400000,
  );
  res.setHeader(
    "Set-Cookie",
    `rm_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${cookieSecure}`,
  );
  return publicUser(user);
}
app.use("/api", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && req.headers.origin) {
    try {
      if (new URL(req.headers.origin).host !== req.headers.host)
        return fail(res, 403, "请求来源不受信任");
    } catch {
      return fail(res, 403, "请求来源无效");
    }
  }
  next();
});
app.use("/api/roadmaps", express.json({ limit: "8mb" }));
app.use(express.json({ limit: "100kb" }));
const attempts = new Map();
app.use("/api/auth", (req, res, next) => {
  if (req.method === "GET") return next();
  const key = req.ip;
  const now = Date.now();
  let entry = attempts.get(key);
  if (!entry || entry.until < now) {
    entry = { count: 0, until: now + 60000 };
    attempts.set(key, entry);
  }
  if (++entry.count > 30) return fail(res, 429, "操作过于频繁，请稍后再试");
  next();
});
app.get("/api/auth/status", (req, res) =>
  res.json({ setupNeeded: setupNeeded() }),
);
app.post("/api/auth/setup", (req, res) => {
  if (!setupNeeded()) return fail(res, 403, "管理员已经创建，请登录");
  // First-admin bootstrap is restricted to a connection from the local machine.
  if (
    !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress)
  )
    return fail(res, 403, "请在服务器本机初始化管理员");
  if (!validAccount(req.body))
    return fail(res, 400, "请填写有效姓名、邮箱及 10–128 位密码");
  const user = {
    id: randomUUID(),
    name: req.body.name.trim(),
    email: req.body.email.trim().toLowerCase(),
    role: "admin",
  };
  db.exec("BEGIN");
  try {
    db.prepare("INSERT INTO users VALUES (?,?,?,?,?)").run(
      user.id,
      user.name,
      user.email,
      passwordHash(req.body.password),
      user.role,
    );
    if (req.body.examples !== false) seedResources(db, user.id, fileDir);
    taxonomy.migrateContent();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  res.status(201).json({ user: session(res, user) });
});
app.post("/api/auth/login", (req, res) => {
  if (
    typeof req.body.email !== "string" ||
    typeof req.body.password !== "string" ||
    req.body.password.length > 128
  )
    return fail(res, 400, "请输入邮箱和密码");
  const user = db
    .prepare("SELECT * FROM users WHERE email=?")
    .get(req.body.email.trim().toLowerCase());
  if (!user || !passwordMatches(req.body.password, user.password))
    return fail(res, 401, "邮箱或密码不正确");
  res.json({ user: session(res, user) });
});
app.get("/api/auth/invitation/:token", (req, res) => {
  const invite = db
    .prepare("SELECT * FROM invitations WHERE token_hash=?")
    .get(hashToken(req.params.token));
  if (!invite || invite.used || invite.expires < Date.now())
    return fail(res, 410, "邀请已失效或已被使用，请联系管理员重新邀请");
  res.json({ valid: true, expires: invite.expires });
});
app.post("/api/auth/register", (req, res) => {
  const invite =
    typeof req.body.token === "string" &&
    db
      .prepare("SELECT * FROM invitations WHERE token_hash=?")
      .get(hashToken(req.body.token));
  if (!invite || invite.used || invite.expires < Date.now())
    return fail(res, 410, "邀请已失效或已被使用");
  if (!validAccount(req.body))
    return fail(res, 400, "请填写有效姓名、邮箱及 10–128 位密码");
  const email = req.body.email.trim().toLowerCase();
  if (db.prepare("SELECT id FROM users WHERE email=?").get(email))
    return fail(res, 409, "该邮箱已注册，请登录");
  const user = {
    id: randomUUID(),
    name: req.body.name.trim(),
    email,
    role: "member",
  };
  db.exec("BEGIN");
  try {
    db.prepare("INSERT INTO users VALUES (?,?,?,?,?)").run(
      user.id,
      user.name,
      email,
      passwordHash(req.body.password),
      user.role,
    );
    db.prepare("UPDATE invitations SET used=1 WHERE id=?").run(invite.id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  res.status(201).json({ user: session(res, user) });
});
app.use("/api", (req, res, next) => {
  const token = (req.headers.cookie || "")
    .split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith("rm_session="))
    ?.slice(11);
  const user =
    token &&
    db
      .prepare(
        "SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE token=? AND expires>?",
      )
      .get(hashToken(token), Date.now());
  if (!user) return fail(res, 401, "请先登录队伍账号");
  req.user = user;
  req.sessionToken = token;
  next();
});
app.get("/api/me", (req, res) => res.json({ user: publicUser(req.user) }));
app.post("/api/auth/logout", (req, res) => {
  db.prepare("DELETE FROM sessions WHERE token=?").run(
    hashToken(req.sessionToken),
  );
  res.setHeader(
    "Set-Cookie",
    `rm_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${cookieSecure}`,
  );
  res.json({ ok: true });
});
const adminOnly = (req, res, next) =>
  req.user.role === "admin" ? next() : fail(res, 403, "此操作需要管理员权限");
app.get("/api/invitations", adminOnly, (req, res) =>
  res.json({
    invitations: db
      .prepare(
        "SELECT id,expires,used FROM invitations ORDER BY expires DESC LIMIT 50",
      )
      .all(),
  }),
);
app.post("/api/invitations", adminOnly, (req, res) => {
  const token = randomBytes(24).toString("hex");
  const id = randomUUID();
  const expires = Date.now() + 7 * 86400000;
  db.prepare(
    "INSERT INTO invitations(id,token_hash,created_by,expires) VALUES (?,?,?,?)",
  ).run(id, hashToken(token), req.user.id, expires);
  res.status(201).json({ id, token, expires });
});
app.delete("/api/invitations/:id", adminOnly, (req, res) => {
  db.prepare("UPDATE invitations SET expires=0 WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});
function resource(row, userId) {
  return {
    ...taxonomy.present(row),
    author:
      db.prepare("SELECT name FROM users WHERE id=?").get(row.owner_id)?.name ||
      "队伍成员",
    favorite: !!db
      .prepare("SELECT 1 FROM favorites WHERE user_id=? AND resource_id=?")
      .get(userId, row.id),
    attachments: db
      .prepare("SELECT id,name,mime,size FROM attachments WHERE resource_id=?")
      .all(row.id),
  };
}
function accessible(req, id) {
  const row = db.prepare("SELECT * FROM resources WHERE id=?").get(id);
  if (
    !row ||
    (row.hidden && row.owner_id !== req.user.id && req.user.role !== "admin")
  )
    return null;
  return row;
}
function canEdit(req, row) {
  return row.owner_id === req.user.id || req.user.role === "admin";
}
app.get("/api/resources", (req, res) => {
  const rows = db
    .prepare(
      "SELECT * FROM resources WHERE hidden=0 OR owner_id=? OR ?='admin' ORDER BY updated_at DESC",
    )
    .all(req.user.id, req.user.role);
  const recent = db
    .prepare(
      "SELECT resource_id FROM recent WHERE user_id=? ORDER BY viewed_at DESC LIMIT 6",
    )
    .all(req.user.id)
    .map((r) => r.resource_id);
  res.json({ resources: rows.map((r) => resource(r, req.user.id)), recent });
});
app.get("/api/resources/:id", (req, res) => {
  const row = accessible(req, req.params.id);
  if (!row) return fail(res, 404, "资料不存在或已下架");
  db.prepare(
    "INSERT INTO recent VALUES (?,?,?) ON CONFLICT(user_id,resource_id) DO UPDATE SET viewed_at=excluded.viewed_at",
  ).run(req.user.id, row.id, Date.now());
  res.json({ resource: resource(row, req.user.id) });
});
const upload = multer({
  storage: multer.diskStorage({
    destination: fileDir,
    filename: (req, file, cb) => cb(null, randomUUID()),
  }),
  limits: { fileSize: 50 * 1024 * 1024, files: 5, fields: 12 },
});
function validResource(body) {
  if (
    typeof body.title !== "string" ||
    !body.title.trim() ||
    body.title.length > 120
  )
    return "标题需要 1–120 个字符";
  if (
    typeof body.domain !== "string" ||
    (typeof body.category !== "string" && typeof body.categoryId !== "string")
  )
    return "请选择资料分类";
  if (!["file", "link"].includes(body.kind)) return "资料形式无效";
  if (body.kind === "link") {
    try {
      const url = new URL(body.url);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password
      )
        return "请填写有效的 HTTP 或 HTTPS 链接";
    } catch {
      return "请填写有效的 HTTP 或 HTTPS 链接";
    }
  }
  if (typeof body.description !== "string" || body.description.length > 5000)
    return "简介不能超过 5000 个字符";
  try {
    const tags = JSON.parse(body.tags || "[]");
    if (
      !Array.isArray(tags) ||
      tags.length > 12 ||
      tags.some((t) => typeof t !== "string" || t.length > 30)
    )
      return "最多 12 个标签，每个不超过 30 字";
  } catch {
    return "标签格式无效";
  }
  try {
    Object.assign(body, taxonomy.normalize(body));
    body.tags = JSON.stringify(body.tags);
  } catch (e) {
    return e.message;
  }
}
function cleanUpload(files) {
  for (const f of files || []) {
    try {
      fs.unlinkSync(f.path);
    } catch {}
  }
}
app.post("/api/resources", upload.array("files", 5), (req, res) => {
  const error = validResource(req.body);
  if (
    error ||
    (req.body.kind === "file" && !req.files?.length) ||
    (req.body.kind === "link" && req.files?.length)
  ) {
    cleanUpload(req.files);
    return fail(res, 400, error || "请选择文件，文件资料与外链请分别发布");
  }
  const b = req.body;
  const id = randomUUID();
  const now = Date.now();
  db.exec("BEGIN");
  try {
    db.prepare(
      "INSERT INTO resources(id,title,domain,category,tags,kind,url,description,owner_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      id,
      b.title.trim(),
      b.domain,
      b.category.trim(),
      b.tags || "[]",
      b.kind,
      b.kind === "link" ? b.url : "",
      b.description,
      req.user.id,
      now,
      now,
    );
    taxonomy.storeResource(id, { ...b, tags: JSON.parse(b.tags) });
    for (const file of req.files || []) {
      const name = Buffer.from(file.originalname, "latin1").toString("utf8");
      db.prepare("INSERT INTO attachments VALUES (?,?,?,?,?,?)").run(
        randomUUID(),
        id,
        file.filename,
        name,
        file.mimetype,
        file.size,
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    cleanUpload(req.files);
    throw error;
  }
  res.status(201).json({ id });
});
app.patch("/api/resources/:id", (req, res) => {
  const row = accessible(req, req.params.id);
  if (!row) return fail(res, 404, "资料不存在");
  if (!canEdit(req, row)) return fail(res, 403, "只能修改自己上传的资料");
  if ("hidden" in req.body) {
    if (
      Object.keys(req.body).length !== 1 ||
      typeof req.body.hidden !== "boolean"
    )
      return fail(res, 400, "请将上下架操作与资料编辑分开提交");
    if (req.user.role !== "admin")
      return fail(res, 403, "下架操作需要管理员权限");
    db.prepare("UPDATE resources SET hidden=?,updated_at=? WHERE id=?").run(
      req.body.hidden ? 1 : 0,
      Date.now(),
      row.id,
    );
  } else {
    const b = { ...req.body, kind: row.kind };
    const error = validResource(b);
    if (error) return fail(res, 400, error);
    db.prepare(
      "UPDATE resources SET title=?,domain=?,category=?,tags=?,description=?,url=?,updated_at=? WHERE id=?",
    ).run(
      b.title.trim(),
      b.domain,
      b.category.trim(),
      b.tags || "[]",
      b.description,
      row.kind === "link" ? b.url : "",
      Date.now(),
      row.id,
    );
    taxonomy.storeResource(row.id, { ...b, tags: JSON.parse(b.tags) });
  }
  res.json({ ok: true });
});
app.delete("/api/resources/:id", (req, res) => {
  const row = accessible(req, req.params.id);
  if (!row) return fail(res, 404, "资料不存在");
  if (!canEdit(req, row)) return fail(res, 403, "只能删除自己上传的资料");
  const files = db
    .prepare("SELECT storage_key FROM attachments WHERE resource_id=?")
    .all(row.id);
  db.prepare("DELETE FROM resources WHERE id=?").run(row.id);
  for (const file of files) {
    try {
      fs.unlinkSync(path.join(fileDir, file.storage_key));
    } catch {}
  }
  res.json({ ok: true });
});
app.post("/api/resources/:id/favorite", (req, res) => {
  if (!accessible(req, req.params.id)) return fail(res, 404, "资料不存在");
  const existing = db
    .prepare("SELECT 1 FROM favorites WHERE user_id=? AND resource_id=?")
    .get(req.user.id, req.params.id);
  if (existing)
    db.prepare("DELETE FROM favorites WHERE user_id=? AND resource_id=?").run(
      req.user.id,
      req.params.id,
    );
  else
    db.prepare("INSERT INTO favorites VALUES (?,?)").run(
      req.user.id,
      req.params.id,
    );
  res.json({ favorite: !existing });
});
app.get("/api/files/:id", (req, res) => {
  const attachment = db
    .prepare("SELECT * FROM attachments WHERE id=?")
    .get(req.params.id);
  if (!attachment || !accessible(req, attachment.resource_id))
    return fail(res, 404, "附件不存在或没有访问权限");
  const absolute = path.join(fileDir, attachment.storage_key);
  if (!fs.existsSync(absolute))
    return fail(res, 404, "附件文件不可用，请联系上传者");
  const inline =
    req.query.preview === "1" &&
    [
      "application/pdf",
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/gif",
      "image/svg+xml",
      "text/plain",
    ].includes(attachment.mime);
  res.setHeader(
    "Content-Security-Policy",
    "sandbox; default-src 'none'; style-src 'unsafe-inline'",
  );
  res.setHeader(
    "Content-Type",
    inline ? attachment.mime : "application/octet-stream",
  );
  res.setHeader(
    "Content-Disposition",
    `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(attachment.name)}`,
  );
  res.sendFile(absolute);
});
installRoadmaps(app, db, accessible, taxonomy);
taxonomy.register(app);
app.use("/api", (req, res) => fail(res, 404, "接口不存在"));
app.use((error, req, res, next) => {
  cleanUpload(req.files);
  if (error.type === "entity.too.large")
    return fail(res, 413, "内容过大，请减少节点说明或关联资料后重试");
  if (error instanceof multer.MulterError)
    return fail(
      res,
      400,
      error.code === "LIMIT_FILE_SIZE"
        ? "单个文件不能超过 50 MB"
        : "最多上传 5 个文件，请检查文件大小与数量",
    );
  if (error instanceof SyntaxError) return fail(res, 400, "请求格式无效");
  console.error(error);
  fail(res, 500, "服务暂时不可用，请稍后重试");
});
if (process.env.NODE_ENV !== "test") {
  if (process.argv.includes("--production")) {
    app.use(express.static(path.join(root, "dist")));
    app.get("/{*path}", (req, res) =>
      res.sendFile(path.join(root, "dist/index.html")),
    );
  } else {
    const { createServer } = await import("vite");
    const vite = await createServer({
      root,
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }
}
const port = Number(process.env.PORT || 5173);
const server = app.listen(port, process.env.HOST || "127.0.0.1", () =>
  console.log(`RM resource center: http://127.0.0.1:${server.address().port}`),
);
function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
