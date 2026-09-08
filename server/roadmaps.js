import { randomUUID } from "node:crypto";
import { graphError, progressSummary } from "../shared/roadmap.js";

const idOK = (v) =>
  typeof v === "string" &&
  /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(v) &&
  !["constructor", "prototype", "__proto__"].includes(v);
const str = (v, max, required = false) =>
  typeof v === "string" &&
  v.length <= max &&
  (!required || v.trim().length > 0);
export function cleanDocument(d, taxonomy) {
  const bad = (message) => {
    throw Object.assign(new Error(message), { status: 400 });
  };
  if (
    !d ||
    !str(d.title, 120, true) ||
    !str(d.description, 5000) ||
    typeof d.domain !== "string" ||
    (!d.categoryId && !str(d.category, 60, true))
  )
    bad("请填写路线标题、分类和简介，标题最多 120 字");
  if (
    !Array.isArray(d.stages) ||
    d.stages.length < 1 ||
    d.stages.length > 50 ||
    d.stages.some((s) => !s || !idOK(s.id) || !str(s.title, 80, true)) ||
    new Set(d.stages.map((s) => s.id)).size !== d.stages.length
  )
    bad("请保留 1–50 个名称有效且标识唯一的阶段");
  if (
    !Array.isArray(d.nodes) ||
    d.nodes.length > 200 ||
    !Array.isArray(d.edges) ||
    d.edges.length > 2000
  )
    bad("每条路线最多 200 个节点、2000 条连线");
  const stages = new Set(d.stages.map((s) => s.id));
  const nodes = d.nodes.map((n) => {
    if (
      !n ||
      !idOK(n.id) ||
      !str(n.title, 120, true) ||
      !stages.has(n.stageId) ||
      typeof n.required !== "boolean" ||
      !str(n.goal, 2000) ||
      !str(n.description, 5000) ||
      !str(n.task, 3000)
    )
      bad("请检查节点标题、所属阶段和文字长度");
    if (
      !n.position ||
      !Number.isFinite(n.position.x) ||
      !Number.isFinite(n.position.y) ||
      Math.abs(n.position.x) > 1e6 ||
      Math.abs(n.position.y) > 1e6
    )
      bad("节点位置无效");
    if (
      !Array.isArray(n.resourceIds) ||
      n.resourceIds.length > 30 ||
      n.resourceIds.some((id) => !idOK(id)) ||
      new Set(n.resourceIds).size !== n.resourceIds.length
    )
      bad("节点关联资料无效，最多 30 份");
    if (!Array.isArray(n.links) || n.links.length > 30)
      bad("每个节点最多 30 个外链");
    const links = n.links.map((l) => {
      if (!l || !str(l.title, 120, true) || !str(l.url, 2000, true))
        bad("请填写外链名称和网址");
      try {
        const u = new URL(l.url);
        if (
          !["http:", "https:"].includes(u.protocol) ||
          u.username ||
          u.password
        )
          bad("外链仅支持有效的 HTTP 或 HTTPS 地址");
      } catch {
        bad("外链仅支持有效的 HTTP 或 HTTPS 地址");
      }
      return { title: l.title.trim(), url: l.url };
    });
    return {
      id: n.id,
      title: n.title.trim(),
      stageId: n.stageId,
      required: n.required,
      goal: n.goal,
      description: n.description,
      task: n.task,
      position: { x: n.position.x, y: n.position.y },
      resourceIds: n.resourceIds,
      links,
    };
  });
  if (new Set(nodes.map((n) => n.id)).size !== nodes.length)
    bad("节点标识不能重复");
  const edges = d.edges.map((e) => {
    if (!e || !idOK(e.id) || !idOK(e.source) || !idOK(e.target))
      bad("连线格式无效");
    return { id: e.id, source: e.source, target: e.target };
  });
  if (new Set(edges.map((e) => e.id)).size !== edges.length)
    bad("连线标识不能重复");
  const error = graphError(nodes, edges);
  if (error) bad(error);
  return {
    title: d.title.trim(),
    description: d.description,
    domain: d.domain,
    ...taxonomy.normalize(d),
    stages: d.stages.map((s) => ({ id: s.id, title: s.title.trim() })),
    nodes,
    edges,
  };
}

export function installRoadmaps(app, db, accessible, taxonomy) {
  db.exec(`CREATE TABLE IF NOT EXISTS roadmaps(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES users(id),draft TEXT NOT NULL,published TEXT,version INTEGER NOT NULL DEFAULT 1,hidden INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,published_at INTEGER);
    CREATE TABLE IF NOT EXISTS roadmap_progress(user_id TEXT NOT NULL REFERENCES users(id),roadmap_id TEXT NOT NULL REFERENCES roadmaps(id) ON DELETE CASCADE,states TEXT NOT NULL DEFAULT '{}',updated_at INTEGER NOT NULL,PRIMARY KEY(user_id,roadmap_id));
    CREATE INDEX IF NOT EXISTS roadmap_owner ON roadmaps(owner_id);`);
  const fail = (status, message) => {
    throw Object.assign(new Error(message), { status });
  };
  const wrap = (fn) => (req, res, next) => {
    try {
      fn(req, res);
    } catch (e) {
      if (e.status) res.status(e.status).json({ error: e.message });
      else next(e);
    }
  };
  const rowFor = (req) => {
    const row = db
      .prepare("SELECT * FROM roadmaps WHERE id=?")
      .get(req.params.id);
    if (!row) fail(404, "学习路线不存在");
    return row;
  };
  const canEdit = (req, row) =>
    row.owner_id === req.user.id || req.user.role === "admin";
  const editRow = (req) => {
    const row = rowFor(req);
    if (!canEdit(req, row)) fail(403, "只能维护自己创建的路线");
    return row;
  };
  const publishedRow = (req) => {
    const row = rowFor(req);
    if (!row.published || row.hidden) fail(404, "路线未发布或已下架");
    return row;
  };
  const versionCheck = (req, row) => {
    if (req.body?.version !== row.version)
      fail(409, "路线已在其他页面更新。当前内容已保留，请重新加载后再编辑。");
  };
  const progress = (req, row, doc) => {
    const p = db
      .prepare(
        "SELECT * FROM roadmap_progress WHERE user_id=? AND roadmap_id=?",
      )
      .get(req.user.id, row.id);
    const old = p ? JSON.parse(p.states) : {};
    const values = Object.fromEntries(
      doc.nodes.map((n) => [n.id, old[n.id] || "idle"]),
    );
    return { started: !!p, states: values, ...progressSummary(doc, values) };
  };
  const info = (req, row, doc) => ({
    id: row.id,
    ownerId: row.owner_id,
    author:
      db.prepare("SELECT name FROM users WHERE id=?").get(row.owner_id)?.name ||
      "队伍成员",
    canEdit: canEdit(req, row),
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
    progress: progress(
      req,
      row,
      row.published ? JSON.parse(row.published) : doc,
    ),
  });
  const resolved = (req, doc) =>
    Object.fromEntries(
      [...new Set(doc.nodes.flatMap((n) => n.resourceIds))].map((id) => {
        const r = accessible(req, id);
        return [id, r ? { id: r.id, title: r.title, kind: r.kind } : null];
      }),
    );
  const refsCheck = (req, doc, old) => {
    const previous = new Set(old?.nodes.flatMap((n) => n.resourceIds) || []);
    for (const id of doc.nodes.flatMap((n) => n.resourceIds))
      if (!previous.has(id) && !accessible(req, id))
        fail(400, "选中的站内资料不存在或无法访问");
  };
  function insert(req, doc) {
    const id = randomUUID(),
      now = Date.now();
    db.prepare(
      "INSERT INTO roadmaps(id,owner_id,draft,created_at,updated_at) VALUES (?,?,?,?,?)",
    ).run(id, req.user.id, JSON.stringify(doc), now, now);
    return { id, version: 1 };
  }
  app.get(
    "/api/roadmaps",
    wrap((req, res) => {
      const scope = req.query.scope || "all";
      if (!["all", "learning", "mine", "manage"].includes(scope))
        fail(400, "列表范围无效");
      if (scope === "manage" && req.user.role !== "admin")
        fail(403, "管理列表需要管理员权限");
      const q = String(req.query.q || "").toLowerCase(),
        category = String(req.query.category || "");
      const rows = db
        .prepare("SELECT * FROM roadmaps ORDER BY updated_at DESC")
        .all()
        .filter(
          (r) =>
            scope === "manage" ||
            (scope === "mine"
              ? r.owner_id === req.user.id
              : !!r.published && !r.hidden),
        );
      const all = rows
        .map((r) =>
          info(
            req,
            r,
            JSON.parse(
              scope === "mine" || scope === "manage" ? r.draft : r.published,
            ),
          ),
        )
        .filter(
          (r) =>
            (scope !== "learning" || r.progress.started) &&
            (!q || r.title.toLowerCase().includes(q)) &&
            (!category ||
              r.category === category ||
              r.categoryId === category) &&
            (!req.query.domain || r.domain === req.query.domain) &&
            (!req.query.tag ||
              r.tagIds.includes(req.query.tag) ||
              r.tags.includes(req.query.tag)),
        );
      const page = Math.max(1, Math.min(100000, Number(req.query.page) || 1));
      res.json({
        roadmaps: all.slice((page - 1) * 12, page * 12),
        total: all.length,
        page,
      });
    }),
  );
  app.post(
    "/api/roadmaps",
    wrap((req, res) => {
      const doc = cleanDocument(req.body?.document, taxonomy);
      refsCheck(req, doc);
      res.status(201).json(insert(req, doc));
    }),
  );
  app.get(
    "/api/roadmaps/:id/draft",
    wrap((req, res) => {
      const row = editRow(req),
        doc = JSON.parse(row.draft);
      res.json({
        roadmap: info(req, row, doc),
        document: doc,
        resources: resolved(req, doc),
      });
    }),
  );
  app.put(
    "/api/roadmaps/:id/draft",
    wrap((req, res) => {
      const row = editRow(req);
      versionCheck(req, row);
      const doc = cleanDocument(req.body.document, taxonomy);
      refsCheck(req, doc, JSON.parse(row.draft));
      db.prepare(
        "UPDATE roadmaps SET draft=?,version=version+1,updated_at=? WHERE id=?",
      ).run(JSON.stringify(doc), Date.now(), row.id);
      res.json({ version: row.version + 1 });
    }),
  );
  app.get(
    "/api/roadmaps/:id",
    wrap((req, res) => {
      const row = publishedRow(req),
        doc = JSON.parse(row.published);
      res.json({
        roadmap: info(req, row, doc),
        document: doc,
        resources: resolved(req, doc),
      });
    }),
  );
  app.post(
    "/api/roadmaps/:id/copy",
    wrap((req, res) => {
      const row = publishedRow(req),
        doc = JSON.parse(row.published),
        ids = new Map();
      doc.title = `${doc.title.slice(0, 110)}（副本）`;
      doc.stages.forEach((s) => {
        const id = randomUUID();
        ids.set(s.id, id);
        s.id = id;
      });
      doc.nodes.forEach((n) => {
        const id = randomUUID();
        ids.set(n.id, id);
        n.id = id;
        n.stageId = ids.get(n.stageId);
        n.resourceIds = n.resourceIds.filter((id) => !!accessible(req, id));
      });
      doc.edges = doc.edges.map((e) => ({
        id: randomUUID(),
        source: ids.get(e.source),
        target: ids.get(e.target),
      }));
      res.status(201).json(insert(req, doc));
    }),
  );
  app.post(
    "/api/roadmaps/:id/publish",
    wrap((req, res) => {
      const row = editRow(req);
      versionCheck(req, row);
      if (row.hidden) fail(403, "路线已被管理员下架，请先联系管理员恢复");
      const doc = cleanDocument(JSON.parse(row.draft), taxonomy);
      if (!doc.nodes.length) fail(400, "至少添加一个学习节点后才能发布");
      const now = Date.now();
      db.prepare(
        "UPDATE roadmaps SET published=draft,published_at=?,updated_at=?,version=version+1 WHERE id=?",
      ).run(now, now, row.id);
      res.json({ version: row.version + 1 });
    }),
  );
  app.post(
    "/api/roadmaps/:id/withdraw",
    wrap((req, res) => {
      const row = editRow(req);
      versionCheck(req, row);
      db.prepare(
        "UPDATE roadmaps SET published=NULL,version=version+1,updated_at=? WHERE id=?",
      ).run(Date.now(), row.id);
      res.json({ version: row.version + 1 });
    }),
  );
  app.patch(
    "/api/roadmaps/:id/visibility",
    wrap((req, res) => {
      if (req.user.role !== "admin") fail(403, "上下架操作需要管理员权限");
      const row = editRow(req);
      versionCheck(req, row);
      if (typeof req.body.hidden !== "boolean") fail(400, "上下架状态无效");
      db.prepare(
        "UPDATE roadmaps SET hidden=?,version=version+1,updated_at=? WHERE id=?",
      ).run(+req.body.hidden, Date.now(), row.id);
      res.json({ version: row.version + 1 });
    }),
  );
  app.delete(
    "/api/roadmaps/:id",
    wrap((req, res) => {
      const row = editRow(req);
      versionCheck(req, row);
      db.prepare("DELETE FROM roadmaps WHERE id=?").run(row.id);
      res.json({ ok: true });
    }),
  );
  app.get(
    "/api/roadmaps/:id/progress",
    wrap((req, res) => {
      const row = publishedRow(req);
      res.json({ progress: progress(req, row, JSON.parse(row.published)) });
    }),
  );
  app.put(
    "/api/roadmaps/:id/progress",
    wrap((req, res) => {
      const row = publishedRow(req),
        doc = JSON.parse(row.published),
        body = req.body;
      if (
        !body ||
        Object.keys(body).some((k) => !["nodeId", "state"].includes(k))
      )
        fail(400, "只能更新当前账号的学习状态");
      const old = db
        .prepare(
          "SELECT states FROM roadmap_progress WHERE user_id=? AND roadmap_id=?",
        )
        .get(req.user.id, row.id);
      const values = old ? JSON.parse(old.states) : {};
      if (Object.keys(body).length) {
        if (
          !doc.nodes.some((n) => n.id === body.nodeId) ||
          !["idle", "learning", "completed"].includes(body.state)
        )
          fail(400, "节点或学习状态无效");
        values[body.nodeId] = body.state;
      }
      db.prepare(
        "INSERT INTO roadmap_progress VALUES (?,?,?,?) ON CONFLICT(user_id,roadmap_id) DO UPDATE SET states=excluded.states,updated_at=excluded.updated_at",
      ).run(req.user.id, row.id, JSON.stringify(values), Date.now());
      res.json({ progress: progress(req, row, doc) });
    }),
  );
}
