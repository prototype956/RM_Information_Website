import {
  managementData,
  contentPage,
  mergePreview,
  reorderIds,
} from "../shared/taxonomy-management.js";
import { fail, parse, fold } from "./db.js";

export async function taxonomy(db) {
  let options = await db.all(
    "SELECT * FROM taxonomy_options ORDER BY position,name",
  );
  let aliases = await db.all("SELECT * FROM taxonomy_aliases");
  let revision =
    (await db.get("SELECT revision FROM taxonomy_meta WHERE id=1"))?.revision ||
    1;
  const get = (id) => options.find((o) => o.id === id);
  const lookup = (kind, name, parent = "") =>
    typeof name === "string" &&
    (options.find(
      (o) =>
        o.kind === kind &&
        o.parent_id === parent &&
        o.normalized === fold(name),
    ) ||
      get(
        aliases.find(
          (a) =>
            a.kind === kind && a.parent_id === parent && a.name === fold(name),
        )?.target_id,
      ));
  const nameOK = (name, kind) => {
    if (
      typeof name !== "string" ||
      !name.trim() ||
      name.trim().length > (kind === "tag" ? 30 : 60)
    )
      fail(400, "请填写有效名称，标签最多 30 字，其他选项最多 60 字");
    return name.trim().normalize("NFKC");
  };
  const bump = () => {
    revision++;
    db.run("UPDATE taxonomy_meta SET revision=revision+1 WHERE id=1");
  };
  const insert = (kind, name, parent = "") => {
    name = nameOK(name, kind);
    if (lookup(kind, name, parent))
      fail(409, "名称已存在或曾被合并，请使用已有选项");
    const row = {
      id: crypto.randomUUID(),
      kind,
      parent_id: parent,
      name,
      normalized: fold(name),
      position:
        Math.max(
          -1,
          ...options
            .filter((o) => o.kind === kind && o.parent_id === parent)
            .map((o) => o.position),
        ) + 1,
    };
    db.run(
      "INSERT INTO taxonomy_options VALUES(?,?,?,?,?,?)",
      row.id,
      kind,
      parent,
      name,
      row.normalized,
      row.position,
    );
    options.push(row);
    return row;
  };
  const normalize = (data) => {
    const domain = get(data.domain),
      category = data.categoryId
        ? get(data.categoryId)
        : lookup("category", data.category, data.domain);
    if (
      domain?.kind !== "domain" ||
      category?.kind !== "category" ||
      category.parent_id !== domain.id
    )
      fail(409, "分类已被调整，请刷新选项并重新选择");
    let ids;
    try {
      ids =
        data.tagIds !== undefined
          ? parse(data.tagIds)
          : parse(data.tags || []).map((name) => {
              const tag = lookup("tag", name);
              if (!tag) fail(403, "新标签需要申请并经管理员审核");
              return tag.id;
            });
    } catch (e) {
      if (e.status) throw e;
      fail(400, "标签格式无效");
    }
    if (
      !Array.isArray(ids) ||
      ids.length > 12 ||
      ids.some((id) => get(id)?.kind !== "tag")
    )
      fail(409, "标签已被调整，请刷新选项");
    ids = [...new Set(ids)];
    return {
      domain: domain.id,
      domainName: domain.name,
      categoryId: category.id,
      category: category.name,
      tagIds: ids,
      tags: ids.map((id) => get(id).name),
    };
  };
  const present = (data) => {
    const category = get(data.categoryId || data.category_id),
      ids = data.tagIds || parse(data.tag_ids || "[]");
    return {
      ...data,
      domainName: get(data.domain)?.name || "资料库不可用",
      categoryId: category?.id || data.categoryId || data.category_id,
      category: category?.name || data.category,
      tagIds: ids.filter((id) => get(id)?.kind === "tag"),
      tags: ids.map((id) => get(id)?.name).filter(Boolean),
    };
  };
  const alias = (old, target = "") => {
    for (const name of [old.normalized, old.id]) {
      db.run(
        "INSERT OR REPLACE INTO taxonomy_aliases VALUES(?,?,?,?)",
        old.kind,
        old.parent_id,
        name,
        target,
      );
      aliases = aliases.filter(
        (a) =>
          !(
            a.kind === old.kind &&
            a.parent_id === old.parent_id &&
            a.name === name
          ),
      );
      aliases.push({
        kind: old.kind,
        parent_id: old.parent_id,
        name,
        target_id: target,
      });
    }
    db.run(
      "UPDATE taxonomy_aliases SET target_id=? WHERE target_id=?",
      target,
      old.id,
    );
    aliases.forEach((a) => {
      if (a.target_id === old.id) a.target_id = target;
    });
  };
  const remove = (old) => {
    options = options.filter((o) => o.id !== old.id);
    db.run("DELETE FROM taxonomy_options WHERE id=?", old.id);
  };
  const storeResource = (id, n) =>
    db.run(
      "UPDATE resources SET domain=?,category=?,category_id=?,tags=?,tag_ids=? WHERE id=?",
      n.domain,
      n.category,
      n.categoryId,
      JSON.stringify(n.tags),
      JSON.stringify(n.tagIds),
      id,
    );
  const impact = async (old) => {
    const match = (d) =>
      old.kind === "tag"
        ? (d.tagIds || parse(d.tag_ids || "[]")).includes(old.id)
        : old.kind === "domain"
          ? d.domain === old.id
          : (d.categoryId || d.category_id) === old.id;
    return {
      resources: (
        await db.all("SELECT domain,category_id,tag_ids FROM resources")
      ).filter(match).length,
      roadmaps: (await db.all("SELECT draft,published FROM roadmaps")).filter(
        (r) =>
          [r.draft, r.published].filter(Boolean).map(JSON.parse).some(match),
      ).length,
      categories:
        old.kind === "domain"
          ? options.filter((o) => o.parent_id === old.id).length
          : 0,
    };
  };
  const management = async () =>
    managementData(
      options,
      await db.all(
        "SELECT id,title,hidden,domain,category_id,tag_ids FROM resources",
      ),
      await db.all("SELECT id,draft,published FROM roadmaps"),
    );
  // Classification edits apply the same transformation to both route snapshots.
  const rewrite = async (transform, conflict = true) => {
    for (const row of await db.all("SELECT * FROM resources")) {
      const n = present(transform(present(row)));
      if (
        JSON.stringify([
          row.domain,
          row.category,
          row.category_id,
          row.tags,
          row.tag_ids,
        ]) !==
        JSON.stringify([
          n.domain,
          n.category,
          n.categoryId,
          JSON.stringify(n.tags),
          JSON.stringify(n.tagIds),
        ])
      )
        storeResource(row.id, n);
    }
    for (const row of await db.all("SELECT id,draft,published FROM roadmaps")) {
      const map = (raw) =>
        raw ? JSON.stringify(present(transform(JSON.parse(raw)))) : null;
      const draft = map(row.draft),
        published = map(row.published);
      if (draft !== row.draft || published !== row.published)
        db.run(
          "UPDATE roadmaps SET draft=?,published=?,version=version+? WHERE id=?",
          draft,
          published,
          conflict ? 1 : 0,
          row.id,
        );
    }
  };
  return {
    get,
    lookup,
    nameOK,
    insert,
    bump,
    normalize,
    present,
    storeResource,
    impact,
    snapshot: () => ({
      revision,
      domains: options.filter((o) => o.kind === "domain"),
      categories: options.filter((o) => o.kind === "category"),
      tags: options.filter((o) => o.kind === "tag"),
      aliases,
    }),
    async handle(c, segments) {
      const { body: b, method: m, user } = c;
      if (!segments.length && m === "GET") return this.snapshot();
      if (segments[0] === "tags" && m === "POST") {
        const name = nameOK(b.name, "tag");
        let tag = lookup("tag", name);
        if (!tag) {
          c.admin();
          tag = insert("tag", name);
          bump();
        }
        return { tag, revision };
      }
      c.admin();
      if (segments[0] === "usage" && m === "GET")
        return { usage: (await management()).usage, revision };
      if (segments[0] === "reorder" && m === "POST") {
        if (b.revision !== revision)
          fail(409, "选项已更新，请刷新管理页面后重试");
        reorderIds(options, b, fail).forEach((id, i) => {
          get(id).position = i;
          db.run("UPDATE taxonomy_options SET position=? WHERE id=?", i, id);
        });
        bump();
        return { revision };
      }
      if (segments[0] !== "options") fail(404, "接口不存在");
      const old = get(segments[1]);
      if (m === "GET" && segments[2] === "content") {
        if (!old) fail(404, "选项不存在");
        return contentPage(await management(), old.id, c.query, fail);
      }
      if (m === "GET" && segments[2] === "impact") {
        if (!old) fail(404, "选项不存在");
        return {
          impact: await impact(old),
          revision,
          ...mergePreview(
            old,
            c.query.targetId,
            get,
            options.filter((o) => o.kind === "category"),
            lookup,
            fail,
          ),
        };
      }
      if (b.revision !== revision)
        fail(409, "选项已更新，请刷新管理页面后重试");
      if (m === "POST" && segments.length === 1) {
        const { kind, name, parentId = "" } = b;
        if (!["tag", "category", "domain"].includes(kind))
          fail(400, "选项类型无效");
        if (kind === "category" && get(parentId)?.kind !== "domain")
          fail(400, "请选择所属资料库");
        const option = insert(kind, name, kind === "category" ? parentId : "");
        bump();
        c.status = 201;
        return { option, revision };
      }
      if (!old) fail(404, "选项不存在或已删除");
      if (m === "PATCH") {
        const before = { ...old },
          name = nameOK(b.name ?? old.name, old.kind),
          parent = old.kind === "category" ? (b.parentId ?? old.parent_id) : "";
        if (old.kind === "category" && get(parent)?.kind !== "domain")
          fail(400, "所属资料库无效");
        const duplicate = lookup(old.kind, name, parent);
        if (duplicate && duplicate.id !== old.id)
          fail(409, "目标名称已存在，请使用合并");
        if (
          b.position !== undefined &&
          (!Number.isInteger(b.position) ||
            b.position < 0 ||
            b.position > 100000)
        )
          fail(400, "排序数字应为 0–100000");
        if (name !== old.name || parent !== old.parent_id)
          alias(before, old.id);
        Object.assign(old, {
          name,
          normalized: fold(name),
          parent_id: parent,
          position:
            parent !== before.parent_id
              ? Math.max(
                  -1,
                  ...options
                    .filter(
                      (c) => c.kind === "category" && c.parent_id === parent,
                    )
                    .map((c) => c.position),
                ) + 1
              : (b.position ?? old.position),
        });
        db.run(
          "UPDATE taxonomy_options SET name=?,normalized=?,parent_id=?,position=? WHERE id=?",
          name,
          old.normalized,
          parent,
          old.position,
          old.id,
        );
        await rewrite(
          (d) =>
            d.categoryId === old.id && parent !== before.parent_id
              ? { ...d, domain: parent }
              : d,
          parent !== before.parent_id,
        );
        bump();
        return { revision };
      }
      if (m === "DELETE") {
        const usage = await impact(old),
          target = b.targetId ? get(b.targetId) : null;
        if (
          b.targetId &&
          (!target || target.kind !== old.kind || target.id === old.id)
        )
          fail(400, "迁移目标无效");
        if (
          old.kind !== "tag" &&
          (usage.resources || usage.roadmaps || usage.categories) &&
          !target
        )
          fail(409, "选项仍被使用，请选择迁移目标后删除");
        const mapping = new Map();
        if (old.kind === "domain" && target)
          for (const child of options.filter(
            (o) => o.kind === "category" && o.parent_id === old.id,
          )) {
            const same = lookup("category", child.name, target.id);
            alias({ ...child }, same?.id || child.id);
            if (same) {
              mapping.set(child.id, same.id);
              remove(child);
            } else {
              child.parent_id = target.id;
              db.run(
                "UPDATE taxonomy_options SET parent_id=? WHERE id=?",
                target.id,
                child.id,
              );
            }
          }
        alias(old, target?.id);
        remove(old);
        await rewrite((d) => {
          if (old.kind === "tag")
            return {
              ...d,
              tagIds: [
                ...new Set(
                  (d.tagIds || []).flatMap((id) =>
                    id === old.id ? (target ? [target.id] : []) : [id],
                  ),
                ),
              ],
            };
          if (old.kind === "category" && d.categoryId === old.id && target)
            return { ...d, categoryId: target.id, domain: target.parent_id };
          if (old.kind === "domain" && d.domain === old.id && target)
            return {
              ...d,
              domain: target.id,
              categoryId: mapping.get(d.categoryId) || d.categoryId,
            };
          return d;
        });
        bump();
        return { revision, migrated: usage };
      }
      fail(404, "接口不存在");
    },
  };
}
