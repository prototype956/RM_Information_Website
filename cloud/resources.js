import { fail, parse } from "./db.js";
import { uploads } from "./uploads.js";
export async function resources(c, parts) {
  const { db, tax, user, method: m, env } = c;
  const serialize = async (row) => ({
    ...tax.present(row),
    author:
      (await db.get("SELECT name FROM users WHERE id=?", row.owner_id))?.name ||
      "队伍成员",
    favorite: !!(await db.get(
      "SELECT 1 FROM favorites WHERE user_id=? AND resource_id=?",
      user.id,
      row.id,
    )),
    attachments: await db.all(
      "SELECT id,name,mime,size FROM attachments WHERE resource_id=?",
      row.id,
    ),
  });
  const valid = (b) => {
    if (typeof b.title !== "string" || !b.title.trim() || b.title.length > 120)
      fail(400, "标题需要 1–120 个字符");
    if (!["file", "link"].includes(b.kind)) fail(400, "资料形式无效");
    if (typeof b.description !== "string" || b.description.length > 5000)
      fail(400, "简介不能超过 5000 个字符");
    if (b.kind === "link") {
      try {
        const u = new URL(b.url);
        if (
          !["https:", "http:"].includes(u.protocol) ||
          u.username ||
          u.password
        )
          throw Error();
      } catch {
        fail(400, "请填写有效的 HTTP 或 HTTPS 链接");
      }
    }
    return { ...b, ...tax.normalize(b) };
  };
  if (!parts.length && m === "GET")
    return {
      resources: await Promise.all(
        (
          await db.all(
            "SELECT * FROM resources WHERE hidden=0 OR owner_id=? OR ?='admin' ORDER BY updated_at DESC",
            user.id,
            user.role,
          )
        ).map(serialize),
      ),
      recent: (
        await db.all(
          "SELECT resource_id FROM recent WHERE user_id=? ORDER BY viewed_at DESC LIMIT 6",
          user.id,
        )
      ).map((r) => r.resource_id),
    };
  if (!parts.length && m === "POST") {
    const { fields, files } = await uploads(c.request, env.FILES);
    c.cleanup.push(...files.map((f) => () => env.FILES.delete(f.storage_key)));
    const b = valid(fields);
    if (
      (b.kind === "file" && !files.length) ||
      (b.kind === "link" && files.length)
    )
      fail(400, "请选择文件，文件资料与外链请分别发布");
    const id = crypto.randomUUID(),
      now = Date.now();
    db.run(
      "INSERT INTO resources(id,title,domain,category,category_id,tags,tag_ids,kind,url,description,owner_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
      id,
      b.title.trim(),
      b.domain,
      b.category,
      b.categoryId,
      JSON.stringify(b.tags),
      JSON.stringify(b.tagIds),
      b.kind,
      b.kind === "link" ? b.url : "",
      b.description,
      user.id,
      now,
      now,
    );
    for (const f of files)
      db.run(
        "INSERT INTO attachments VALUES(?,?,?,?,?,?)",
        f.id,
        id,
        f.storage_key,
        f.name,
        f.mime,
        f.size,
      );
    c.status = 201;
    return { id };
  }
  const row = await c.accessible(parts[0]);
  if (!row) fail(404, "资料不存在或已下架");
  if (parts[1] === "favorite" && m === "POST") {
    const exists = await db.get(
      "SELECT 1 FROM favorites WHERE user_id=? AND resource_id=?",
      user.id,
      row.id,
    );
    db.run(
      exists
        ? "DELETE FROM favorites WHERE user_id=? AND resource_id=?"
        : "INSERT INTO favorites VALUES(?,?)",
      user.id,
      row.id,
    );
    return { favorite: !exists };
  }
  if (parts.length !== 1) fail(404, "接口不存在");
  if (m === "GET") {
    // Browsing recency is independent of editing conflicts.
    await env.DB.prepare(
      "INSERT INTO recent VALUES(?,?,?) ON CONFLICT(user_id,resource_id) DO UPDATE SET viewed_at=excluded.viewed_at",
    )
      .bind(user.id, row.id, Date.now())
      .run();
    return { resource: await serialize(row) };
  }
  if (row.owner_id !== user.id && user.role !== "admin")
    fail(403, "只能修改自己上传的资料");
  if (m === "PATCH") {
    const b = c.body;
    if ("hidden" in b) {
      c.admin();
      if (Object.keys(b).length !== 1 || typeof b.hidden !== "boolean")
        fail(400, "请将上下架操作与资料编辑分开提交");
      db.run(
        "UPDATE resources SET hidden=?,updated_at=? WHERE id=?",
        +b.hidden,
        Date.now(),
        row.id,
      );
    } else {
      const n = valid({ ...b, kind: row.kind });
      db.run(
        "UPDATE resources SET title=?,domain=?,category=?,category_id=?,tags=?,tag_ids=?,description=?,url=?,updated_at=? WHERE id=?",
        n.title.trim(),
        n.domain,
        n.category,
        n.categoryId,
        JSON.stringify(n.tags),
        JSON.stringify(n.tagIds),
        n.description,
        n.kind === "link" ? n.url : "",
        Date.now(),
        row.id,
      );
    }
    return { ok: true };
  }
  if (m === "DELETE") {
    const files = await db.all(
      "SELECT storage_key FROM attachments WHERE resource_id=?",
      row.id,
    );
    db.run("DELETE FROM resources WHERE id=?", row.id);
    c.after.push(...files.map((f) => () => env.FILES.delete(f.storage_key)));
    return { ok: true };
  }
  fail(404, "接口不存在");
}
export async function file(c, id) {
  const attachment = await c.db.get("SELECT * FROM attachments WHERE id=?", id);
  if (!attachment || !(await c.accessible(attachment.resource_id)))
    fail(404, "附件不存在或没有访问权限");
  const rangeRequested = c.request.headers.has("range");
  const object = await c.env.FILES.get(
    attachment.storage_key,
    rangeRequested ? { range: c.request.headers } : undefined,
  );
  if (!object) fail(404, "附件文件不可用，请联系上传者");
  const inline =
    c.query.preview === "1" &&
    [
      "application/pdf",
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/gif",
      "image/svg+xml",
      "text/plain",
    ].includes(attachment.mime);
  const headers = new Headers({
    "Content-Type": inline ? attachment.mime : "application/octet-stream",
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(attachment.name)}`,
    "Content-Security-Policy": "sandbox; default-src 'none'",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
    "Accept-Ranges": "bytes",
  });
  if (rangeRequested && object.range) {
    headers.set(
      "Content-Range",
      `bytes ${object.range.offset}-${object.range.offset + object.range.length - 1}/${object.size}`,
    );
    headers.set("Content-Length", String(object.range.length));
  } else headers.set("Content-Length", String(object.size));
  return new Response(object.body, {
    status: rangeRequested && object.range ? 206 : 200,
    headers,
  });
}
