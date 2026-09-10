const parse = (value) =>
  typeof value === "string" ? JSON.parse(value) : value;
const ids = (d) =>
  [
    d.domain,
    d.categoryId || d.category_id,
    ...(parse(d.tagIds || d.tag_ids || []) || []),
  ].filter(Boolean);
export function managementData(options, resources, roadmaps) {
  const usage = Object.fromEntries(
    options.map((o) => [o.id, { resources: 0, roadmaps: 0, categories: 0 }]),
  );
  for (const o of options)
    if (o.kind === "category" && usage[o.parent_id])
      usage[o.parent_id].categories++;
  const content = { resources: [], roadmaps: [] };
  for (const r of resources) {
    const optionIds = [...new Set(ids(r))];
    optionIds.forEach((id) => {
      if (usage[id]) usage[id].resources++;
    });
    content.resources.push({
      id: r.id,
      title: r.title,
      hidden: !!r.hidden,
      optionIds,
    });
  }
  for (const r of roadmaps) {
    const draft = r.draft ? parse(r.draft) : null,
      published = r.published ? parse(r.published) : null;
    const optionIds = [
      ...new Set([draft, published].filter(Boolean).flatMap(ids)),
    ];
    optionIds.forEach((id) => {
      if (usage[id]) usage[id].roadmaps++;
    });
    content.roadmaps.push({
      id: r.id,
      title: draft?.title || published?.title || "未命名路线",
      draft: !!draft,
      published: !!published,
      optionIds,
    });
  }
  return { usage, content };
}
export function contentPage(data, id, query, fail) {
  const type = query.type || "resources",
    page = Number(query.page || 1);
  if (
    !["resources", "roadmaps"].includes(type) ||
    !Number.isSafeInteger(page) ||
    page < 1
  )
    fail(400, "列表参数无效");
  const rows = data.content[type]
    .filter((r) => r.optionIds.includes(id))
    .sort((a, b) => a.id.localeCompare(b.id));
  return {
    items: rows
      .slice((page - 1) * 20, page * 20)
      .map(({ optionIds, ...r }) => r),
    total: rows.length,
    page,
    pageSize: 20,
  };
}
export function mergePreview(old, targetId, get, categories, lookup, fail) {
  if (!targetId) return { target: null, children: [] };
  const target = get(targetId);
  if (!target || target.kind !== old.kind || target.id === old.id)
    fail(400, "合并目标无效");
  return {
    target: { id: target.id, name: target.name },
    children:
      old.kind !== "domain"
        ? []
        : categories
            .filter((c) => c.parent_id === old.id)
            .map((c) => {
              const same = lookup("category", c.name, target.id);
              return {
                id: c.id,
                name: c.name,
                action: same ? "merge" : "move",
                targetId: same?.id || c.id,
                targetName: same?.name || c.name,
              };
            }),
  };
}
export function reorderIds(options, body, fail) {
  const { kind, parentId = "", orderedIds } = body;
  if (
    !["domain", "category"].includes(kind) ||
    (kind === "domain" && parentId) ||
    (kind === "category" &&
      !options.some((o) => o.id === parentId && o.kind === "domain"))
  )
    fail(400, "排序范围无效");
  const siblings = options.filter(
    (o) => o.kind === kind && o.parent_id === parentId,
  );
  if (
    !Array.isArray(orderedIds) ||
    orderedIds.length !== siblings.length ||
    new Set(orderedIds).size !== siblings.length ||
    orderedIds.some((id) => !siblings.some((o) => o.id === id))
  )
    fail(400, "请提交完整且不重复的同级顺序");
  return orderedIds;
}
