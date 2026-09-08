import {
  randomBytes,
  createHash,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { fail } from "./db.js";
export const hash = (value) => createHash("sha256").update(value).digest("hex");
export const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
});
export const passwordHash = (password) => {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
};
export const matches = (password, stored) => {
  const [salt, expected] = stored.split(":");
  const a = Buffer.from(expected, "hex"),
    b = scryptSync(password, salt, 64);
  return a.length === b.length && timingSafeEqual(a, b);
};
export async function authenticate(c) {
  const token = c.request.headers
    .get("cookie")
    ?.split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith("rm_session="))
    ?.slice(11);
  if (!token) return null;
  c.token = token;
  return c.db.get(
    "SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE token=? AND expires>?",
    hash(token),
    Date.now(),
  );
}
export async function auth(c, parts) {
  const { db, body: b, method: m, env } = c;
  if (parts[0] === "owner-reset" && m === "POST") {
    const expires = Number(env.ACCOUNT_RESET_EXPIRES);
    if (!env.ACCOUNT_RESET_TOKEN || !Number.isFinite(expires) || Date.now() > expires || hash(c.request.headers.get("authorization") || "") !== hash("Bearer " + env.ACCOUNT_RESET_TOKEN)) fail(404, "接口不存在");
    if (typeof b.password !== "string" || b.password.length < 10 || b.password.length > 128) fail(400, "密码需要 10–128 位");
    const user = await db.get("SELECT * FROM users WHERE email=?", env.ACCOUNT_RESET_EMAIL);
    if (!user || hash(user.password) !== env.ACCOUNT_RESET_EXPECTED) fail(409, "重置已完成或账号已变更");
    db.run("UPDATE users SET password=? WHERE id=?", passwordHash(b.password), user.id);
    db.run("DELETE FROM sessions WHERE user_id=?", user.id);
    return { ok: true };
  }
  const account = () => {
    if (
      typeof b.name !== "string" ||
      !b.name.trim() ||
      b.name.trim().length > 40 ||
      typeof b.email !== "string" ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email) ||
      typeof b.password !== "string" ||
      b.password.length < 10 ||
      b.password.length > 128
    )
      fail(400, "请填写有效姓名、邮箱及 10–128 位密码");
  };
  const session = (user) => {
    const token = randomBytes(32).toString("hex");
    db.run("DELETE FROM sessions WHERE expires < ?", Date.now());
    db.run(
      "INSERT INTO sessions VALUES(?,?,?)",
      hash(token),
      user.id,
      Date.now() + 7 * 86400000,
    );
    c.headers.set(
      "Set-Cookie",
      `rm_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${new URL(c.request.url).protocol === "https:" ? "; Secure" : ""}`,
    );
    return { user: publicUser(user) };
  };
  if (parts[0] === "status" && m === "GET")
    return { setupNeeded: !(await db.get("SELECT id FROM users LIMIT 1")) };
  if (parts[0] === "invitation" && m === "GET") {
    const invite = await db.get(
      "SELECT * FROM invitations WHERE token_hash=?",
      hash(parts[1] || ""),
    );
    if (!invite || invite.used || invite.expires < Date.now())
      fail(410, "邀请已失效或已被使用，请联系管理员重新邀请");
    return { valid: true, expires: invite.expires };
  }
  if (m !== "POST") fail(404, "接口不存在");
  if (parts[0] === "setup")
    fail(403, "线上管理员由原网站迁移，请使用原账号登录");
  if (parts[0] === "logout") {
    if (!c.user) fail(401, "请先登录队伍账号");
    db.run("DELETE FROM sessions WHERE token=?", hash(c.token));
    c.headers.set(
      "Set-Cookie",
      "rm_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Secure",
    );
    return { ok: true };
  }
  // D1-backed limits survive isolate restarts and do not share users' secrets.
  const key = hash(c.request.headers.get("cf-connecting-ip") || "unknown"),
    window = Math.floor(Date.now() / 60000);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM cloud_auth_limits WHERE window<?").bind(
      window - 2,
    ),
    env.DB.prepare(
      "INSERT INTO cloud_auth_limits(key,window,count) VALUES(?,?,1) ON CONFLICT(key,window) DO UPDATE SET count=count+1",
    ).bind(key, window),
  ]);
  if (
    (
      await env.DB.prepare(
        "SELECT count FROM cloud_auth_limits WHERE key=? AND window=?",
      )
        .bind(key, window)
        .first()
    ).count > 30
  )
    fail(429, "操作过于频繁，请稍后再试");
  if (parts[0] === "login") {
    if (
      typeof b.email !== "string" ||
      typeof b.password !== "string" ||
      b.password.length > 128
    )
      fail(400, "请输入邮箱和密码");
    const user = await db.get(
      "SELECT * FROM users WHERE email=?",
      b.email.trim().toLowerCase(),
    );
    if (!user || !matches(b.password, user.password))
      fail(401, "邮箱或密码不正确");
    return session(user);
  }
  if (parts[0] === "register") {
    const invite =
      typeof b.token === "string" &&
      (await db.get(
        "SELECT * FROM invitations WHERE token_hash=?",
        hash(b.token),
      ));
    if (!invite || invite.used || invite.expires < Date.now())
      fail(410, "邀请已失效或已被使用");
    account();
    const email = b.email.trim().toLowerCase();
    if (await db.get("SELECT id FROM users WHERE email=?", email))
      fail(409, "该邮箱已注册，请登录");
    const user = {
      id: crypto.randomUUID(),
      name: b.name.trim(),
      email,
      role: "member",
    };
    db.run(
      "INSERT INTO users VALUES(?,?,?,?,?)",
      user.id,
      user.name,
      email,
      passwordHash(b.password),
      user.role,
    );
    db.run("UPDATE invitations SET used=1 WHERE id=?", invite.id);
    c.status = 201;
    return session(user);
  }
  fail(404, "接口不存在");
}
export async function invitations(c, parts) {
  c.admin();
  const { db, method: m, user } = c;
  if (m === "GET" && !parts.length)
    return {
      invitations: await db.all(
        "SELECT id,expires,used FROM invitations ORDER BY expires DESC LIMIT 50",
      ),
    };
  if (m === "POST" && !parts.length) {
    const id = crypto.randomUUID(),
      token = randomBytes(24).toString("hex"),
      expires = Date.now() + 7 * 86400000;
    db.run(
      "INSERT INTO invitations(id,token_hash,created_by,expires) VALUES(?,?,?,?)",
      id,
      hash(token),
      user.id,
      expires,
    );
    c.status = 201;
    return { id, token, expires };
  }
  if (m === "DELETE" && parts.length === 1) {
    db.run("UPDATE invitations SET expires=0 WHERE id=?", parts[0]);
    return { ok: true };
  }
  fail(404, "接口不存在");
}
