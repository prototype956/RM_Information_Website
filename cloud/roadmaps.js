import { fail } from "./db.js";
import { cleanDocument } from "../server/roadmaps.js";
import { progressSummary } from "../shared/roadmap.js";
export async function roadmaps(c, parts) {
  const { db, tax, user, body: b, method: m, query: q } = c;
  const canEdit = (row) => row.owner_id === user.id || user.role === "admin";
  const progress = async (row, doc, override) => {
    const p =
        override ||
        (await db.get(
          "SELECT * FROM roadmap_progress WHERE user_id=? AND roadmap_id=?",
          user.id,
          row.id,
        )),
      old = p ? JSON.parse(p.states) : {};
    const states = Object.fromEntries(
      doc.nodes.map((n) => [n.id, old[n.id] || "idle"]),
    );
    return { started: !!p, states, ...progressSummary(doc, states) };
  };
  const info = async (row, doc) => ({
    id: row.id,
    ownerId: row.owner_id,
    author:
      (await db.get("SELECT name FROM users WHERE id=?", row.owner_id))?.name ||
      "队伍成员",
    canEdit: canEdit(row),
    hidden: !!row.hidden,
    published: !!row.published,
    version: row.version,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
    title: doc.title,
    description: doc.description,
    category: doc.category,
    categoryId: doc.categoryId,
    tags: doc.tags || [],
    tagIds: doc.tagIds || [],
    domain: doc.domain,
    nodeCount: doc.nodes.length,
    progress: await progress(
      row,
      row.published ? JSON.parse(row.published) : doc,
    ),
  });
  const resolved = async (doc) =>
    Object.fromEntries(
      await Promise.all(
        [...new Set(doc.nodes.flatMap((n) => n.resourceIds))].map(
          async (id) => {
            const r = await c.accessible(id);
            return [id, r ? { id: r.id, title: r.title, kind: r.kind } : null];
          },
        ),
      ),
    );
  const refs = async (doc, old) => {
    const previous = new Set(old?.nodes.flatMap((n) => n.resourceIds) || []);
    for (const id of new Set(doc.nodes.flatMap((n) => n.resourceIds)))
      if (!previous.has(id) && !(await c.accessible(id)))
        fail(400, "选中的站内资料不存在或无法访问");
  };
  const insert = (doc) => {
    const id = crypto.randomUUID(),
      now = Date.now();
    db.run(
      "INSERT INTO roadmaps(id,owner_id,draft,created_at,updated_at) VALUES(?,?,?,?,?)",
      id,
      user.id,
      JSON.stringify(doc),
      now,
      now,
    );
    c.status = 201;
    return { id, version: 1 };
  };
  if (!parts.length && m === "GET") {
    const scope = q.scope || "all";
    if (!["all", "mine", "learning", "manage"].includes(scope))
      fail(400, "列表范围无效");
    if (scope === "manage") c.admin();
    const where =
      scope === "manage"
        ? "1=1"
        : scope === "mine"
          ? "owner_id=?"
          : "published IS NOT NULL AND hidden=0";
    const rows = await db.all(
      "SELECT * FROM roadmaps WHERE " + where + " ORDER BY updated_at DESC",
      ...(scope === "mine" ? [user.id] : []),
    );
    const all = (
      await Promise.all(
        rows.map((r) =>
          info(
            r,
            JSON.parse(
              ["mine", "manage"].includes(scope) ? r.draft : r.published,
            ),
          ),
        ),
      )
    ).filter(
      (r) =>
        (scope !== "learning" || r.progress.started) &&
        (!q.q || r.title.toLowerCase().includes(q.q.toLowerCase())) &&
        (!q.category ||
          r.category === q.category ||
          r.categoryId === q.category) &&
        (!q.domain || r.domain === q.domain) &&
        (!q.tag || r.tagIds.includes(q.tag) || r.tags.includes(q.tag)),
    );
    const page = Math.max(1, Math.min(100000, parseInt(q.page) || 1));
    return {
      roadmaps: all.slice((page - 1) * 12, page * 12),
      total: all.length,
      page,
    };
  }
  if (!parts.length && m === "POST") {
    const doc = cleanDocument(b.document, tax);
    await refs(doc);
    return insert(doc);
  }
  const row = await db.get("SELECT * FROM roadmaps WHERE id=?", parts[0]);
  if (!row) fail(404, "学习路线不存在");
  const action = parts[1] || "";
  if (
    action === "draft" ||
    ["publish", "withdraw", "visibility"].includes(action) ||
    m === "DELETE"
  ) {
    if (!canEdit(row)) fail(403, "只能维护自己创建的路线");
  } else if (!row.published || row.hidden) fail(404, "路线未发布或已下架");
  if ((action === "draft" || !action) && m === "GET") {
    const doc = JSON.parse(action === "draft" ? row.draft : row.published);
    return {
      roadmap: await info(row, doc),
      document: doc,
      resources: await resolved(doc),
    };
  }
  if (action === "copy" && m === "POST") {
    const doc = JSON.parse(row.published),
      ids = new Map();
    doc.title = doc.title.slice(0, 110) + "（副本）";
    for (const s of doc.stages) {
      const id = crypto.randomUUID();
      ids.set(s.id, id);
      s.id = id;
    }
    for (const n of doc.nodes) {
      const id = crypto.randomUUID();
      ids.set(n.id, id);
      n.id = id;
      n.stageId = ids.get(n.stageId);
      const allowed = [];
      for (const rid of n.resourceIds)
        if (await c.accessible(rid)) allowed.push(rid);
      n.resourceIds = allowed;
    }
    doc.edges = doc.edges.map((e) => ({
      id: crypto.randomUUID(),
      source: ids.get(e.source),
      target: ids.get(e.target),
    }));
    return insert(doc);
  }
  if (action === "progress") {
    const doc = JSON.parse(row.published);
    if (m === "GET") return { progress: await progress(row, doc) };
    if (
      m !== "PUT" ||
      !b ||
      Object.keys(b).some((k) => !["nodeId", "state"].includes(k))
    )
      fail(400, "只能更新当前账号的学习状态");
    const old = await db.get(
        "SELECT states FROM roadmap_progress WHERE user_id=? AND roadmap_id=?",
        user.id,
        row.id,
      ),
      states = old ? JSON.parse(old.states) : {};
    if (Object.keys(b).length) {
      if (
        !doc.nodes.some((n) => n.id === b.nodeId) ||
        !["idle", "learning", "completed"].includes(b.state)
      )
        fail(400, "节点或学习状态无效");
      states[b.nodeId] = b.state;
    }
    const raw = JSON.stringify(states);
    db.run(
      "INSERT INTO roadmap_progress VALUES(?,?,?,?) ON CONFLICT(user_id,roadmap_id) DO UPDATE SET states=excluded.states,updated_at=excluded.updated_at",
      user.id,
      row.id,
      raw,
      Date.now(),
    );
    return { progress: await progress(row, doc, { states: raw }) };
  }
  if (b.version !== row.version)
    fail(409, "路线已在其他页面更新。当前内容已保留，请重新加载后再编辑。");
  if (action === "draft" && m === "PUT") {
    const doc = cleanDocument(b.document, tax);
    await refs(doc, JSON.parse(row.draft));
    db.run(
      "UPDATE roadmaps SET draft=?,version=version+1,updated_at=? WHERE id=?",
      JSON.stringify(doc),
      Date.now(),
      row.id,
    );
  } else if (action === "publish" && m === "POST") {
    if (row.hidden) fail(403, "路线已被管理员下架，请先联系管理员恢复");
    const doc = cleanDocument(JSON.parse(row.draft), tax);
    if (!doc.nodes.length) fail(400, "至少添加一个学习节点后才能发布");
    db.run(
      "UPDATE roadmaps SET published=draft,published_at=?,updated_at=?,version=version+1 WHERE id=?",
      Date.now(),
      Date.now(),
      row.id,
    );
  } else if (action === "withdraw" && m === "POST")
    db.run(
      "UPDATE roadmaps SET published=NULL,version=version+1,updated_at=? WHERE id=?",
      Date.now(),
      row.id,
    );
  else if (action === "visibility" && m === "PATCH") {
    c.admin();
    if (typeof b.hidden !== "boolean") fail(400, "上下架状态无效");
    db.run(
      "UPDATE roadmaps SET hidden=?,version=version+1,updated_at=? WHERE id=?",
      +b.hidden,
      Date.now(),
      row.id,
    );
  } else if (!action && m === "DELETE") {
    db.run("DELETE FROM roadmaps WHERE id=?", row.id);
    return { ok: true };
  } else fail(404, "接口不存在");
  return { version: row.version + 1 };
}
