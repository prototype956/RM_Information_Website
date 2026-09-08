import { randomUUID } from "node:crypto";
export function installTaxonomyRequests(
  app,
  db,
  { get, lookup, insert, bump, transaction, nameOK, fail },
) {
  db.exec(`CREATE TABLE IF NOT EXISTS taxonomy_requests (
 id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),kind TEXT NOT NULL,parent_id TEXT NOT NULL DEFAULT '',parent_name TEXT NOT NULL DEFAULT '',name TEXT NOT NULL,normalized TEXT NOT NULL,reason TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'pending',review_note TEXT NOT NULL DEFAULT '',reviewer_id TEXT REFERENCES users(id),option_id TEXT,created_at INTEGER NOT NULL,reviewed_at INTEGER,version INTEGER NOT NULL DEFAULT 1);
 CREATE UNIQUE INDEX IF NOT EXISTS taxonomy_request_pending ON taxonomy_requests(user_id,kind,parent_id,normalized) WHERE status='pending';
 CREATE INDEX IF NOT EXISTS taxonomy_request_queue ON taxonomy_requests(status,created_at);`);
  const wrap =
    (fn, admin = false) =>
    (req, res, next) => {
      try {
        if (admin && req.user.role !== "admin")
          fail(403, "审核申请需要管理员权限");
        fn(req, res);
      } catch (e) {
        if (e.status) res.status(e.status).json({ error: e.message });
        else next(e);
      }
    };
  const text = (value, label) => {
    if (value === undefined) return "";
    if (typeof value !== "string" || value.length > 500)
      fail(400, `${label}最多 500 字`);
    return value.trim();
  };
  const present = (r) => ({
    ...r,
    parentName: r.parent_id
      ? get(r.parent_id)?.name || `${r.parent_name}（已删除）`
      : "",
    applicant:
      db.prepare("SELECT name FROM users WHERE id=?").get(r.user_id)?.name ||
      "队伍成员",
    reviewer: r.reviewer_id
      ? db.prepare("SELECT name FROM users WHERE id=?").get(r.reviewer_id)?.name
      : null,
    optionAvailable: !!get(r.option_id),
  });
  app.get(
    "/api/taxonomy/requests",
    wrap((req, res) => {
      const review = req.query.scope === "review";
      if (review && req.user.role !== "admin")
        fail(403, "审核申请需要管理员权限");
      const status = req.query.status || "";
      if (
        status &&
        !["pending", "approved", "rejected", "withdrawn"].includes(status)
      )
        fail(400, "申请状态无效");
      const page = Math.max(1, Math.min(100000, parseInt(req.query.page) || 1)),
        where = [],
        args = [];
      if (!review) {
        where.push("user_id=?");
        args.push(req.user.id);
      }
      if (status) {
        where.push("status=?");
        args.push(status);
      }
      const clause = where.length ? " WHERE " + where.join(" AND ") : "";
      const total = db
        .prepare("SELECT count(*) AS n FROM taxonomy_requests" + clause)
        .get(...args).n;
      const rows = db
        .prepare(
          "SELECT * FROM taxonomy_requests" +
            clause +
            " ORDER BY created_at DESC,id LIMIT 20 OFFSET ?",
        )
        .all(...args, (page - 1) * 20);
      res.json({
        requests: rows.map(present),
        total,
        page,
        pendingCount: review
          ? db
              .prepare(
                "SELECT count(*) AS n FROM taxonomy_requests WHERE status='pending'",
              )
              .get().n
          : undefined,
      });
    }),
  );
  app.post(
    "/api/taxonomy/requests",
    wrap((req, res) => {
      const { kind, parentId = "" } = req.body || {};
      if (!["tag", "category", "domain"].includes(kind))
        fail(400, "申请类型无效");
      const name = nameOK(req.body.name, kind),
        reason = text(req.body.reason, "申请说明");
      if (
        kind === "category" &&
        (typeof parentId !== "string" || get(parentId)?.kind !== "domain")
      )
        fail(400, "请选择有效的所属资料库");
      const parent = kind === "category" ? parentId : "";
      const result = transaction(() => {
        const existing = lookup(kind, name, parent);
        if (existing) fail(409, "该选项已存在，可刷新选项后直接选择");
        const normalized = name.normalize("NFKC").toLowerCase();
        const pending = db
          .prepare(
            "SELECT * FROM taxonomy_requests WHERE user_id=? AND kind=? AND parent_id=? AND normalized=? AND status='pending'",
          )
          .get(req.user.id, kind, parent, normalized);
        if (pending) return { request: present(pending), reused: true };
        const id = randomUUID();
        db.prepare(
          "INSERT INTO taxonomy_requests(id,user_id,kind,parent_id,parent_name,name,normalized,reason,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
        ).run(
          id,
          req.user.id,
          kind,
          parent,
          get(parent)?.name || "",
          name,
          normalized,
          reason,
          Date.now(),
        );
        return {
          request: present(
            db.prepare("SELECT * FROM taxonomy_requests WHERE id=?").get(id),
          ),
          reused: false,
        };
      });
      res.status(result.reused ? 200 : 201).json(result);
    }),
  );
  const current = (req) => {
    const row = db
      .prepare("SELECT * FROM taxonomy_requests WHERE id=?")
      .get(req.params.id);
    if (!row) fail(404, "申请不存在");
    return row;
  };
  const pending = (row, req) => {
    if (row.status !== "pending" || req.body?.version !== row.version)
      fail(409, "申请已被处理，请刷新后查看结果");
  };
  app.post(
    "/api/taxonomy/requests/:id/withdraw",
    wrap((req, res) => {
      const result = transaction(() => {
        const r = current(req);
        if (r.user_id !== req.user.id) fail(403, "只能撤回自己的申请");
        pending(r, req);
        db.prepare(
          "UPDATE taxonomy_requests SET status='withdrawn',reviewed_at=?,version=version+1 WHERE id=?",
        ).run(Date.now(), r.id);
        return present(current(req));
      });
      res.json({ request: result });
    }),
  );
  app.post(
    "/api/taxonomy/requests/:id/review",
    wrap((req, res) => {
      const { decision } = req.body || {};
      if (!["approved", "rejected"].includes(decision))
        fail(400, "请选择通过或驳回");
      const note = text(req.body.note, "审核说明");
      if (decision === "rejected" && !note) fail(400, "请填写驳回原因");
      const result = transaction(() => {
        const r = current(req);
        pending(r, req);
        let option = null;
        if (decision === "approved") {
          if (r.kind === "category" && get(r.parent_id)?.kind !== "domain")
            fail(409, "所属资料库已删除，请驳回并请成员重新选择资料库申请");
          option = lookup(r.kind, r.name, r.parent_id);
          if (
            option &&
            r.kind === "category" &&
            option.parent_id !== r.parent_id
          )
            fail(409, "同名分类已迁移，请驳回并说明应使用的分类");
          if (!option) {
            option = insert(r.kind, r.name, r.parent_id);
            bump();
          }
        }
        db.prepare(
          "UPDATE taxonomy_requests SET status=?,review_note=?,reviewer_id=?,option_id=?,reviewed_at=?,version=version+1 WHERE id=?",
        ).run(
          decision,
          note,
          req.user.id,
          option?.id || null,
          Date.now(),
          r.id,
        );
        return { request: present(current(req)), option };
      });
      res.json(result);
    }, true),
  );
}
