import { fail, fold } from "./db.js";
export async function requests(c, parts) {
  const { db, tax: t, user, body: b, method: m, query: q } = c;
  const note = (value, label) => {
    if (value === undefined) return "";
    if (typeof value !== "string" || value.length > 500)
      fail(400, `${label}最多 500 字`);
    return value.trim();
  };
  const present = async (r) => ({
    ...r,
    parentName: r.parent_id
      ? t.get(r.parent_id)?.name || `${r.parent_name}（已删除）`
      : "",
    applicant:
      (await db.get("SELECT name FROM users WHERE id=?", r.user_id))?.name ||
      "队伍成员",
    reviewer: r.reviewer_id
      ? (await db.get("SELECT name FROM users WHERE id=?", r.reviewer_id))?.name
      : null,
    optionAvailable: !!t.get(r.option_id),
  });
  if (!parts.length && m === "GET") {
    const review = q.scope === "review";
    if (review) c.admin();
    if (
      q.status &&
      !["pending", "approved", "rejected", "withdrawn"].includes(q.status)
    )
      fail(400, "申请状态无效");
    const where = [],
      args = [];
    if (!review) {
      where.push("user_id=?");
      args.push(user.id);
    }
    if (q.status) {
      where.push("status=?");
      args.push(q.status);
    }
    const clause = where.length ? " WHERE " + where.join(" AND ") : "",
      page = Math.max(1, Math.min(100000, parseInt(q.page) || 1));
    const rows = await db.all(
      "SELECT * FROM taxonomy_requests" +
        clause +
        " ORDER BY created_at DESC,id LIMIT 20 OFFSET ?",
      ...args,
      (page - 1) * 20,
    );
    return {
      requests: await Promise.all(rows.map(present)),
      total: (
        await db.get(
          "SELECT count(*) AS n FROM taxonomy_requests" + clause,
          ...args,
        )
      ).n,
      page,
      pendingCount: review
        ? (
            await db.get(
              "SELECT count(*) AS n FROM taxonomy_requests WHERE status='pending'",
            )
          ).n
        : undefined,
    };
  }
  if (!parts.length && m === "POST") {
    const { kind, parentId = "" } = b;
    if (!["tag", "category", "domain"].includes(kind))
      fail(400, "申请类型无效");
    const name = t.nameOK(b.name, kind),
      reason = note(b.reason, "申请说明"),
      parent = kind === "category" ? parentId : "";
    if (kind === "category" && t.get(parent)?.kind !== "domain")
      fail(400, "请选择有效的所属资料库");
    if (t.lookup(kind, name, parent))
      fail(409, "该选项已存在，可刷新选项后直接选择");
    const pending = await db.get(
      "SELECT * FROM taxonomy_requests WHERE user_id=? AND kind=? AND parent_id=? AND normalized=? AND status='pending'",
      user.id,
      kind,
      parent,
      fold(name),
    );
    if (pending) return { request: await present(pending), reused: true };
    const row = {
      id: crypto.randomUUID(),
      user_id: user.id,
      kind,
      parent_id: parent,
      parent_name: t.get(parent)?.name || "",
      name,
      normalized: fold(name),
      reason,
      status: "pending",
      review_note: "",
      reviewer_id: null,
      option_id: null,
      created_at: Date.now(),
      reviewed_at: null,
      version: 1,
    };
    db.run(
      "INSERT INTO taxonomy_requests(id,user_id,kind,parent_id,parent_name,name,normalized,reason,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
      row.id,
      user.id,
      kind,
      parent,
      row.parent_name,
      name,
      row.normalized,
      reason,
      row.created_at,
    );
    c.status = 201;
    return { request: await present(row), reused: false };
  }
  const row = await db.get(
    "SELECT * FROM taxonomy_requests WHERE id=?",
    parts[0],
  );
  if (!row) fail(404, "申请不存在");
  if (parts[1] === "review") c.admin();
  else if (row.user_id !== user.id) fail(403, "只能撤回自己的申请");
  if (m !== "POST" || !["review", "withdraw"].includes(parts[1]))
    fail(404, "接口不存在");
  if (row.status !== "pending" || b.version !== row.version)
    fail(409, "申请已被处理，请刷新后查看结果");
  if (parts[1] === "withdraw") {
    Object.assign(row, {
      status: "withdrawn",
      reviewed_at: Date.now(),
      version: row.version + 1,
    });
    db.run(
      "UPDATE taxonomy_requests SET status='withdrawn',reviewed_at=?,version=version+1 WHERE id=?",
      row.reviewed_at,
      row.id,
    );
    return { request: await present(row) };
  }
  if (!["approved", "rejected"].includes(b.decision))
    fail(400, "请选择通过或驳回");
  const reviewNote = note(b.note, "审核说明");
  if (b.decision === "rejected" && !reviewNote) fail(400, "请填写驳回原因");
  let option = null;
  if (b.decision === "approved") {
    if (row.kind === "category" && t.get(row.parent_id)?.kind !== "domain")
      fail(409, "所属资料库已删除，请驳回并请成员重新选择资料库申请");
    option = t.lookup(row.kind, row.name, row.parent_id);
    if (option && row.kind === "category" && option.parent_id !== row.parent_id)
      fail(409, "同名分类已迁移，请驳回并说明应使用的分类");
    if (!option) {
      option = t.insert(row.kind, row.name, row.parent_id);
      t.bump();
    }
  }
  Object.assign(row, {
    status: b.decision,
    review_note: reviewNote,
    reviewer_id: user.id,
    option_id: option?.id || null,
    reviewed_at: Date.now(),
    version: row.version + 1,
  });
  db.run(
    "UPDATE taxonomy_requests SET status=?,review_note=?,reviewer_id=?,option_id=?,reviewed_at=?,version=version+1 WHERE id=?",
    row.status,
    row.review_note,
    row.reviewer_id,
    row.option_id,
    row.reviewed_at,
    row.id,
  );
  return { request: await present(row), option };
}
