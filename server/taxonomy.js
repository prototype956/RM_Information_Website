import {
  managementData,
  contentPage,
  mergePreview,
  reorderIds,
} from "../shared/taxonomy-management.js";
import { randomUUID } from "node:crypto";
import { installTaxonomyRequests } from "./taxonomy-requests.js";
const fold = (v) => v.trim().normalize("NFKC").toLowerCase();
const initial = {
  academic: {
    name: "期末复习",
    categories: [
      "高等数学",
      "线性代数",
      "大学物理",
      "概率论与数理统计",
      "程序设计",
      "电路分析",
      "其他课程",
    ],
  },
  rm: {
    name: "RM 学习",
    categories: [
      "机械",
      "电控与嵌入式",
      "视觉算法",
      "自主导航",
      "赛事规则",
      "通用工具",
    ],
  },
};
const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v);
export function createTaxonomy(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS taxonomy_options(id TEXT PRIMARY KEY,kind TEXT NOT NULL,parent_id TEXT NOT NULL DEFAULT '',name TEXT NOT NULL,normalized TEXT NOT NULL,position INTEGER NOT NULL DEFAULT 0,UNIQUE(kind,parent_id,normalized));
 CREATE TABLE IF NOT EXISTS taxonomy_meta(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS taxonomy_aliases(kind TEXT,parent_id TEXT,name TEXT,target_id TEXT,PRIMARY KEY(kind,parent_id,name));`);
  if (!db.prepare("SELECT * FROM taxonomy_meta").get()) {
    db.prepare("INSERT INTO taxonomy_meta VALUES(1,1)").run();
    Object.entries(initial).forEach(([id, d], i) => {
      db.prepare("INSERT INTO taxonomy_options VALUES(?,?,?,?,?,?)").run(
        id,
        "domain",
        "",
        d.name,
        fold(d.name),
        i,
      );
      d.categories.forEach((name, j) =>
        db
          .prepare("INSERT INTO taxonomy_options VALUES(?,?,?,?,?,?)")
          .run(randomUUID(), "category", id, name, fold(name), j),
      );
    });
  }
  if (
    !db
      .prepare("PRAGMA table_info(resources)")
      .all()
      .some((c) => c.name === "category_id")
  )
    db.exec(
      "ALTER TABLE resources ADD COLUMN category_id TEXT; ALTER TABLE resources ADD COLUMN tag_ids TEXT NOT NULL DEFAULT '[]';",
    );
  const get = (id) =>
    db.prepare("SELECT * FROM taxonomy_options WHERE id=?").get(id || "");
  const all = (kind) =>
    db
      .prepare(
        "SELECT * FROM taxonomy_options WHERE kind=? ORDER BY position,name",
      )
      .all(kind);
  const revision = () =>
    db.prepare("SELECT revision FROM taxonomy_meta WHERE id=1").get().revision;
  const bump = () =>
    db.prepare("UPDATE taxonomy_meta SET revision=revision+1 WHERE id=1").run();
  const nameOK = (name, kind) => {
    if (
      typeof name !== "string" ||
      !name.trim() ||
      name.trim().length > (kind === "tag" ? 30 : 60)
    )
      fail(
        400,
        kind === "tag" ? "标签需要 1–30 个字符" : "名称需要 1–60 个字符",
      );
    return name.trim().normalize("NFKC");
  };
  function lookup(kind, name, parent = "") {
    if (typeof name !== "string") return null;
    return (
      db
        .prepare(
          "SELECT * FROM taxonomy_options WHERE kind=? AND parent_id=? AND normalized=?",
        )
        .get(kind, parent, fold(name)) ||
      get(
        db
          .prepare(
            "SELECT target_id FROM taxonomy_aliases WHERE kind=? AND parent_id=? AND name=?",
          )
          .get(kind, parent, fold(name))?.target_id,
      )
    );
  }
  function insert(kind, name, parent = "", id = randomUUID()) {
    name = nameOK(name, kind);
    if (lookup(kind, name, parent))
      fail(409, "名称已存在或曾被合并，请使用已有选项");
    const position =
      (all(kind)
        .filter((x) => x.parent_id === parent)
        .at(-1)?.position ?? -1) + 1;
    db.prepare("INSERT INTO taxonomy_options VALUES(?,?,?,?,?,?)").run(
      id,
      kind,
      parent,
      name,
      fold(name),
      position,
    );
    return get(id);
  }
  function tagsFor(names, allowNewTags = false) {
    if (
      !Array.isArray(names) ||
      names.length > 12 ||
      names.some((n) => typeof n !== "string" || !n.trim() || n.length > 30)
    )
      fail(400, "最多 12 个标签，每个 1–30 字");
    if (!allowNewTags && names.some((name) => !lookup("tag", name)))
      fail(403, "新标签需要申请并经管理员审核，请先选择已有标签");
    return [
      ...new Set(
        names.map((name) => {
          let tag = lookup("tag", name);
          if (!tag) {
            tag = insert("tag", name);
            bump();
          }
          return tag.id;
        }),
      ),
    ];
  }
  function normalize(data, { migration = false } = {}) {
    let domain = get(data.domain);
    if (!domain || domain.kind !== "domain") {
      if (migration)
        domain = insert(
          "domain",
          data.domain || "未分类资料库",
          "",
          data.domain || randomUUID(),
        );
      else fail(409, "资料库已被调整，请刷新选项并重新选择");
    }
    let category = data.categoryId
      ? get(data.categoryId)
      : lookup("category", data.category, domain.id);
    if (!category && migration)
      category = insert("category", data.category || "未分类", domain.id);
    if (
      !category ||
      category.kind !== "category" ||
      category.parent_id !== domain.id
    )
      fail(409, "课程或技术方向已被调整，请刷新选项并重新选择");
    let tagIds;
    try {
      tagIds =
        data.tagIds !== undefined
          ? parse(data.tagIds)
          : tagsFor(parse(data.tags || []), migration);
    } catch (e) {
      if (e.status) throw e;
      fail(400, "标签格式无效");
    }
    if (
      !Array.isArray(tagIds) ||
      tagIds.length > 12 ||
      tagIds.some((id) => typeof id !== "string" || get(id)?.kind !== "tag")
    )
      fail(409, "标签已被调整，请刷新选项并移除失效标签");
    tagIds = [...new Set(tagIds)];
    return {
      domain: domain.id,
      domainName: domain.name,
      category: category.name,
      categoryId: category.id,
      tagIds,
      tags: tagIds.map((id) => get(id).name),
    };
  }
  const present = (data) => {
    const c = get(data.categoryId || data.category_id),
      ids = data.tagIds || parse(data.tag_ids || "[]");
    return {
      ...data,
      domainName: get(data.domain)?.name || "资料库不可用",
      categoryId: c?.id || data.categoryId || data.category_id,
      category: c?.name || data.category,
      tagIds: ids.filter((id) => get(id)?.kind === "tag"),
      tags: ids.map((id) => get(id)?.name).filter(Boolean),
    };
  };
  function storeResource(id, n) {
    db.prepare(
      "UPDATE resources SET domain=?,category=?,category_id=?,tags=?,tag_ids=? WHERE id=?",
    ).run(
      n.domain,
      n.category,
      n.categoryId,
      JSON.stringify(n.tags),
      JSON.stringify(n.tagIds),
      id,
    );
  }
  function migrateContent() {
    for (const r of db
      .prepare("SELECT * FROM resources WHERE category_id IS NULL")
      .all())
      storeResource(
        r.id,
        normalize({ ...r, tags: parse(r.tags) }, { migration: true }),
      );
    if (
      db.prepare("SELECT name FROM sqlite_master WHERE name='roadmaps'").get()
    )
      for (const r of db
        .prepare("SELECT id,draft,published FROM roadmaps")
        .all()) {
        let changed = false;
        const migrate = (raw) => {
          if (!raw) return null;
          const d = JSON.parse(raw);
          if (d.categoryId && d.tagIds) return raw;
          Object.assign(d, normalize(d, { migration: true }));
          changed = true;
          return JSON.stringify(d);
        };
        const draft = migrate(r.draft),
          published = migrate(r.published);
        if (changed)
          db.prepare(
            "UPDATE roadmaps SET draft=?,published=?,version=version+1 WHERE id=?",
          ).run(draft, published, r.id);
      }
  }
  const transaction = (fn) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  };
  transaction(migrateContent);
  function impact(option) {
    const catIds =
      option.kind === "domain"
        ? all("category")
            .filter((c) => c.parent_id === option.id)
            .map((c) => c.id)
        : [option.id];
    const matches = (d) =>
      option.kind === "tag"
        ? (d.tagIds || parse(d.tag_ids || "[]")).includes(option.id)
        : option.kind === "domain"
          ? d.domain === option.id
          : catIds.includes(d.categoryId || d.category_id);
    const resources = db
      .prepare("SELECT domain,category_id,tag_ids FROM resources")
      .all()
      .filter(matches).length;
    const roadmaps = db
      .prepare("SELECT draft,published FROM roadmaps")
      .all()
      .filter((r) =>
        [r.draft, r.published].filter(Boolean).map(JSON.parse).some(matches),
      ).length;
    return {
      resources,
      roadmaps,
      categories: option.kind === "domain" ? catIds.length : 0,
    };
  }
  function rewrite(transform, { conflict = true } = {}) {
    for (const r of db.prepare("SELECT * FROM resources").all()) {
      const d = present(r),
        n = present(transform({ ...d, tagIds: [...d.tagIds] }));
      if (
        JSON.stringify([
          r.domain,
          r.category,
          r.category_id,
          r.tags,
          r.tag_ids,
        ]) !==
        JSON.stringify([
          n.domain,
          n.category,
          n.categoryId,
          JSON.stringify(n.tags),
          JSON.stringify(n.tagIds),
        ])
      )
        storeResource(r.id, n);
    }
    for (const r of db.prepare("SELECT * FROM roadmaps").all()) {
      let changed = false;
      const map = (raw) => {
        if (!raw) return null;
        const d = JSON.parse(raw),
          n = present(transform({ ...d, tagIds: [...(d.tagIds || [])] }));
        if (JSON.stringify(n) !== raw) changed = true;
        return JSON.stringify(n);
      };
      const draft = map(r.draft),
        published = map(r.published);
      if (changed)
        db.prepare(
          "UPDATE roadmaps SET draft=?,published=?,version=version+? WHERE id=?",
        ).run(draft, published, conflict ? 1 : 0, r.id);
    }
  }
  const alias = (old, target) => {
    db.prepare("INSERT OR REPLACE INTO taxonomy_aliases VALUES(?,?,?,?)").run(
      old.kind,
      old.parent_id,
      old.normalized,
      target || "",
    );
    db.prepare("INSERT OR REPLACE INTO taxonomy_aliases VALUES(?,?,?,?)").run(
      old.kind,
      old.parent_id,
      old.id,
      target || "",
    );
    db.prepare("UPDATE taxonomy_aliases SET target_id=? WHERE target_id=?").run(
      target || "",
      old.id,
    );
  };
  function mergeCategory(old, target) {
    rewrite((d) =>
      d.categoryId === old.id
        ? {
            ...d,
            categoryId: target.id,
            category: target.name,
            domain: target.parent_id,
          }
        : d,
    );
    alias(old, target.id);
    db.prepare("DELETE FROM taxonomy_options WHERE id=?").run(old.id);
  }
  const management = () =>
    managementData(
      [...all("domain"), ...all("category"), ...all("tag")],
      db
        .prepare(
          "SELECT id,title,hidden,domain,category_id,tag_ids FROM resources",
        )
        .all(),
      db.prepare("SELECT id,draft,published FROM roadmaps").all(),
    );
  function register(app) {
    installTaxonomyRequests(app, db, {
      get,
      lookup,
      insert,
      bump,
      transaction,
      nameOK,
      fail,
    });
    const wrap =
      (fn, admin = false) =>
      (req, res, next) => {
        try {
          if (admin && req.user.role !== "admin")
            fail(403, "分类与标签管理需要管理员权限");
          fn(req, res);
        } catch (e) {
          if (e.status) res.status(e.status).json({ error: e.message });
          else next(e);
        }
      };
    const expected = (req) => {
      if (req.body?.revision !== revision())
        fail(409, "选项已被其他人更新，请刷新管理页面后重试");
    };
    const option = (req) => {
      const x = get(req.params.id);
      if (!x) fail(404, "选项不存在或已删除");
      return x;
    };
    app.get(
      "/api/taxonomy",
      wrap((req, res) =>
        res.json({
          revision: revision(),
          domains: all("domain"),
          categories: all("category"),
          tags: all("tag"),
          aliases: db.prepare("SELECT * FROM taxonomy_aliases").all(),
        }),
      ),
    );
    app.get(
      "/api/taxonomy/usage",
      wrap(
        (req, res) =>
          res.json({ usage: management().usage, revision: revision() }),
        true,
      ),
    );
    app.get(
      "/api/taxonomy/options/:id/content",
      wrap(
        (req, res) =>
          res.json(contentPage(management(), option(req).id, req.query, fail)),
        true,
      ),
    );
    app.post(
      "/api/taxonomy/reorder",
      wrap((req, res) => {
        transaction(() => {
          expected(req);
          const ids = reorderIds(
            [...all("domain"), ...all("category")],
            req.body,
            fail,
          );
          ids.forEach((id, i) =>
            db
              .prepare("UPDATE taxonomy_options SET position=? WHERE id=?")
              .run(i, id),
          );
          bump();
        });
        res.json({ revision: revision() });
      }, true),
    );
    app.post(
      "/api/taxonomy/tags",
      wrap((req, res) => {
        const name = nameOK(req.body?.name, "tag");
        const tag = transaction(() => {
          const existing = lookup("tag", name);
          if (existing) return existing;
          if (req.user.role !== "admin")
            fail(403, "新标签需要申请并经管理员审核");
          const added = insert("tag", name);
          bump();
          return added;
        });
        res.json({ tag, revision: revision() });
      }),
    );
    app.post(
      "/api/taxonomy/options",
      wrap((req, res) => {
        expected(req);
        const { kind, name, parentId = "" } = req.body;
        if (!["domain", "category", "tag"].includes(kind))
          fail(400, "选项类型无效");
        if (kind === "category" && get(parentId)?.kind !== "domain")
          fail(400, "请选择所属资料库");
        const created = transaction(() => {
          const r = insert(kind, name, kind === "category" ? parentId : "");
          bump();
          return r;
        });
        res.status(201).json({ option: created, revision: revision() });
      }, true),
    );
    app.get(
      "/api/taxonomy/options/:id/impact",
      wrap(
        (req, res) =>
          res.json({
            impact: impact(option(req)),
            revision: revision(),
            ...mergePreview(
              option(req),
              req.query.targetId,
              get,
              all("category"),
              lookup,
              fail,
            ),
          }),
        true,
      ),
    );
    app.patch(
      "/api/taxonomy/options/:id",
      wrap((req, res) => {
        expected(req);
        const old = option(req),
          name = nameOK(req.body.name ?? old.name, old.kind),
          parent =
            old.kind === "category" ? (req.body.parentId ?? old.parent_id) : "";
        if (old.kind === "category" && get(parent)?.kind !== "domain")
          fail(400, "所属资料库无效");
        const duplicate = lookup(old.kind, name, parent);
        if (duplicate && duplicate.id !== old.id)
          fail(409, "目标名称已存在，请使用合并或迁移删除");
        if (
          req.body.position !== undefined &&
          (!Number.isInteger(req.body.position) ||
            req.body.position < 0 ||
            req.body.position > 100000)
        )
          fail(400, "排序数字应为 0–100000");
        transaction(() => {
          if (name !== old.name || parent !== old.parent_id) alias(old, old.id);
          db.prepare(
            "UPDATE taxonomy_options SET name=?,normalized=?,parent_id=?,position=? WHERE id=?",
          ).run(
            name,
            fold(name),
            parent,
            parent !== old.parent_id
              ? Math.max(
                  -1,
                  ...all("category")
                    .filter((c) => c.parent_id === parent)
                    .map((c) => c.position),
                ) + 1
              : (req.body.position ?? old.position),
            old.id,
          );
          rewrite(
            (d) =>
              d.categoryId === old.id && parent !== old.parent_id
                ? { ...d, domain: parent }
                : d,
            { conflict: parent !== old.parent_id },
          );
          bump();
        });
        res.json({ revision: revision() });
      }, true),
    );
    app.delete(
      "/api/taxonomy/options/:id",
      wrap((req, res) => {
        expected(req);
        const old = option(req),
          usage = impact(old),
          target = req.body.targetId ? get(req.body.targetId) : null;
        if (target && (target.kind !== old.kind || target.id === old.id))
          fail(400, "迁移目标无效");
        if (req.body.targetId && !target) fail(400, "迁移目标不存在");
        if (
          old.kind !== "tag" &&
          (usage.resources || usage.roadmaps || usage.categories) &&
          !target
        )
          fail(409, "选项仍被使用，请选择迁移目标后删除");
        transaction(() => {
          if (old.kind === "category") {
            if (target) mergeCategory(old, target);
            else {
              alias(old, "");
              db.prepare("DELETE FROM taxonomy_options WHERE id=?").run(old.id);
            }
          }
          if (old.kind === "domain") {
            if (target) {
              for (const c of all("category").filter(
                (c) => c.parent_id === old.id,
              )) {
                const same = lookup("category", c.name, target.id);
                if (same) mergeCategory(c, same);
                else {
                  alias(c, c.id);
                  db.prepare(
                    "UPDATE taxonomy_options SET parent_id=? WHERE id=?",
                  ).run(target.id, c.id);
                }
              }
              rewrite((d) =>
                d.domain === old.id ? { ...d, domain: target.id } : d,
              );
            }
            alias(old, target?.id);
            db.prepare("DELETE FROM taxonomy_options WHERE id=?").run(old.id);
          }
          if (old.kind === "tag") {
            rewrite((d) => ({
              ...d,
              tagIds: [
                ...new Set(
                  (d.tagIds || []).flatMap((id) =>
                    id === old.id ? (target ? [target.id] : []) : [id],
                  ),
                ),
              ],
            }));
            alias(old, target?.id);
            db.prepare("DELETE FROM taxonomy_options WHERE id=?").run(old.id);
          }
          bump();
        });
        res.json({ revision: revision(), migrated: usage });
      }, true),
    );
  }
  return {
    get,
    all,
    normalize,
    present,
    storeResource,
    migrateContent,
    register,
  };
}
