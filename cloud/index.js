import { database, fail } from "./db.js";
import { taxonomy } from "./taxonomy.js";
import { requests } from "./requests.js";
import { roadmaps } from "./roadmaps.js";
import { resources, file } from "./resources.js";
import { auth, authenticate, publicUser, invitations, hash } from "./auth.js";

const importTables = [
  "users",
  "invitations",
  "resources",
  "attachments",
  "favorites",
  "recent",
  "roadmaps",
  "roadmap_progress",
  "taxonomy_options",
  "taxonomy_meta",
  "taxonomy_aliases",
  "taxonomy_requests",
];
async function limitedJSON(request, limit) {
  if (Number(request.headers.get("content-length")) > limit)
    fail(413, "提交内容过大");
  if (!request.body) return {};
  const reader = request.body.getReader(),
    chunks = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      fail(413, "提交内容过大");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes) || "{}");
  } catch {
    fail(400, "提交内容格式无效");
  }
}
async function migrate(request, env, url) {
  if (
    !env.MIGRATION_TOKEN ||
    Date.now() > Number(env.MIGRATION_EXPIRES) ||
    hash(request.headers.get("authorization") || "") !==
      hash("Bearer " + env.MIGRATION_TOKEN)
  )
    fail(404, "接口不存在");
  if (await env.DB.prepare("SELECT id FROM users LIMIT 1").first())
    fail(409, "数据已经迁移，拒绝覆盖");
  if (
    url.pathname.startsWith("/_migration/file/") &&
    request.method === "PUT"
  ) {
    const key = decodeURIComponent(
      url.pathname.slice("/_migration/file/".length),
    );
    if (!/^[a-zA-Z0-9._-]{1,120}$/.test(key)) fail(400, "文件标识无效");
    await env.FILES.put(key, request.body);
    return { ok: true };
  }
  if (url.pathname !== "/_migration/import" || request.method !== "POST")
    fail(404, "接口不存在");
  const data = await limitedJSON(request, 16 * 1048576),
    batch = [];
  if (!data.users?.length || !data.users.some((u) => u.role === "admin"))
    fail(400, "缺少管理员数据");
  // The singleton insert makes imports atomic and prevents simultaneous imports.
  batch.push(
    env.DB.prepare("INSERT INTO cloud_revision(id,revision) VALUES(1,1)"),
  );
  for (const table of importTables) {
    const columns = (
      await env.DB.prepare(`PRAGMA table_info(${table})`).all()
    ).results.map((c) => c.name);
    for (const row of data[table] || []) {
      const names = columns.filter((name) => Object.hasOwn(row, name));
      batch.push(
        env.DB.prepare(
          `INSERT INTO ${table}(${names.join(",")}) VALUES(${names.map(() => "?").join(",")})`,
        ).bind(...names.map((name) => row[name])),
      );
    }
  }
  await env.DB.batch(batch);
  return {
    ok: true,
    counts: Object.fromEntries(
      importTables.map((t) => [t, (data[t] || []).length]),
    ),
  };
}
export default {
  async fetch(request, env, execution) {
    const url = new URL(request.url),
      headers = new Headers({
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
    let c;
    try {
      if (
        !url.pathname.startsWith("/api/") &&
        !url.pathname.startsWith("/_migration/")
      ) {
        // Only the frontend build is an asset source; database and uploads never are.
        const asset = await env.ASSETS.fetch(request);
        if (asset.status !== 404 || url.pathname.includes(".")) return asset;
        return env.ASSETS.fetch(
          new Request(new URL("/index.html", request.url), request),
        );
      }
      if (
        !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
        request.headers.has("origin") &&
        new URL(request.headers.get("origin")).origin !== url.origin
      )
        fail(403, "请求来源不受信任");
      if (url.pathname.startsWith("/_migration/"))
        return Response.json(await migrate(request, env, url), { headers });
      const db = await database(env.DB),
        parts = url.pathname.slice(5).split("/").map(decodeURIComponent),
        method = request.method;
      const body = request.headers
        .get("content-type")
        ?.includes("application/json")
        ? await limitedJSON(
            request,
            parts[0] === "roadmaps" ? 8 * 1048576 : 100 * 1024,
          )
        : {};
      if (!body || typeof body !== "object" || Array.isArray(body))
        fail(400, "提交内容格式无效");
      c = {
        request,
        env,
        db,
        body,
        method,
        headers,
        query: Object.fromEntries(url.searchParams),
        status: 200,
        cleanup: [],
        after: [],
        admin() {
          if (this.user?.role !== "admin") fail(403, "此操作需要管理员权限");
        },
      };
      c.user = await authenticate(c);
      let result;
      if (parts[0] === "auth") result = await auth(c, parts.slice(1));
      else {
        if (!c.user) fail(401, "请先登录队伍账号");
        c.accessible = async (id) => {
          const row = await db.get("SELECT * FROM resources WHERE id=?", id);
          return row &&
            (!row.hidden ||
              row.owner_id === c.user.id ||
              c.user.role === "admin")
            ? row
            : null;
        };
        if (parts[0] === "me" && method === "GET")
          result = { user: publicUser(c.user) };
        else if (
          parts[0] === "members" &&
          parts.length === 1 &&
          method === "GET"
        ) {
          c.admin();
          result = {
            members: await db.all(
              "SELECT id,name,email,role FROM users ORDER BY name COLLATE NOCASE,email COLLATE NOCASE,id",
            ),
          };
        } else if (parts[0] === "invitations")
          result = await invitations(c, parts.slice(1));
        else if (parts[0] === "files" && method === "GET")
          return await file(c, parts[1]);
        else {
          c.tax = await taxonomy(db);
          if (parts[0] === "taxonomy")
            result =
              parts[1] === "requests"
                ? await requests(c, parts.slice(2))
                : await c.tax.handle(c, parts.slice(1));
          else if (parts[0] === "roadmaps")
            result = await roadmaps(c, parts.slice(1));
          else if (parts[0] === "resources")
            result = await resources(c, parts.slice(1));
          else fail(404, "接口不存在");
        }
      }
      await db.commit();
      c.cleanup = [];
      if (c.after.length)
        execution.waitUntil(Promise.allSettled(c.after.map((fn) => fn())));
      return Response.json(result, { status: c.status, headers });
    } catch (error) {
      if (c?.cleanup.length)
        await Promise.allSettled(c.cleanup.map((fn) => fn()));
      if (!error.status)
        console.error(
          "Request failed",
          request.method,
          url.pathname,
          error.message,
        );
      headers.delete("Set-Cookie");
      return Response.json(
        { error: error.status ? error.message : "服务暂时不可用，请稍后重试" },
        { status: error.status || 500, headers },
      );
    }
  },
};
