import assert from "node:assert/strict";
import { blankRoadmap } from "../shared/roadmap.js";
export async function taxonomyManagementContract(request, admin, member) {
  const call = (p, o = {}) => request(p, { cookie: admin, ...o });
  const catalog = async () => (await call("/taxonomy")).data;
  const mutate = async (id, body = {}, method = "PATCH") =>
    call("/taxonomy/options" + (id ? "/" + id : ""), {
      method,
      body: { revision: (await catalog()).revision, ...body },
    });
  const create = async (kind, name, parentId = "") => {
    const r = await mutate("", { kind, name, parentId }, "POST");
    assert.equal(r.status, 201, JSON.stringify(r.data));
    return r.data.option;
  };
  const a = await create("domain", "管理验证甲"),
    b = await create("domain", "管理验证乙");
  const c = await create("category", "共同分类", a.id),
    d = await create("category", "共同分类", b.id),
    e = await create("category", "移动分类", a.id);
  const tag = await create("tag", "管理验证标签");
  for (const cookie of [null, member]) {
    for (const p of [
      "/taxonomy/usage",
      "/taxonomy/options/" + c.id + "/content",
      "/taxonomy/options/" + a.id + "/impact?targetId=" + b.id,
    ])
      assert.equal((await call(p, { cookie })).status, cookie ? 403 : 401);
    assert.equal(
      (await call("/taxonomy/reorder", { cookie, method: "POST", body: {} }))
        .status,
      cookie ? 403 : 401,
    );
  }
  for (let i = 0; i < 21; i++) {
    const f = new FormData();
    Object.entries({
      title: "管理资料" + i,
      domain: a.id,
      categoryId: c.id,
      tagIds: JSON.stringify([tag.id]),
      kind: "link",
      url: "https://example.org",
      description: "保留内容",
    }).forEach(([k, v]) => f.set(k, v));
    const r = await call("/resources", { method: "POST", body: f });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    if (i === 0)
      assert.equal(
        (
          await call("/resources/" + r.data.id, {
            method: "PATCH",
            body: { hidden: true },
          })
        ).status,
        200,
      );
  }
  const doc = blankRoadmap({
    domain: a.id,
    categoryId: c.id,
    tagIds: [tag.id],
  });
  doc.title = "管理双版本路线";
  doc.nodes = [
    {
      id: "n",
      title: "学习节点",
      stageId: doc.stages[0].id,
      required: true,
      goal: "目标",
      description: "说明",
      task: "实践",
      position: { x: 0, y: 0 },
      resourceIds: [],
      links: [],
    },
  ];
  const r = await call("/roadmaps", {
    method: "POST",
    body: { document: doc },
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(
    (
      await call("/roadmaps/" + r.data.id + "/publish", {
        method: "POST",
        body: { version: 1 },
      })
    ).status,
    200,
  );
  const loaded = (await call("/roadmaps/" + r.data.id + "/draft")).data;
  assert.equal(
    (
      await call("/roadmaps/" + r.data.id + "/draft", {
        method: "PUT",
        body: {
          version: loaded.roadmap.version,
          document: { ...doc, domain: b.id, categoryId: d.id },
        },
      })
    ).status,
    200,
  );
  const r2 = await call("/roadmaps", {
    method: "POST",
    body: { document: doc },
  });
  assert.equal(r2.status, 201);
  let usage = (await call("/taxonomy/usage")).data.usage;
  assert.deepEqual(usage[c.id], { resources: 21, roadmaps: 2, categories: 0 });
  assert.equal(usage[d.id].roadmaps, 1);
  assert.equal(usage[tag.id].roadmaps, 2);
  const p1 = (
      await call("/taxonomy/options/" + c.id + "/content?type=resources")
    ).data,
    p2 = (
      await call("/taxonomy/options/" + c.id + "/content?type=resources&page=2")
    ).data;
  assert.equal(p1.items.length, 20);
  assert.equal(p2.items.length, 1);
  assert.equal(p1.total, 21);
  assert.equal(new Set([...p1.items, ...p2.items].map((r) => r.id)).size, 21);
  assert.equal([...p1.items, ...p2.items].filter((r) => r.hidden).length, 1);
  assert.deepEqual(Object.keys(p1.items[0]).sort(), ["hidden", "id", "title"]);
  const roads = (
    await call("/taxonomy/options/" + c.id + "/content?type=roadmaps")
  ).data;
  assert.equal(roads.total, 2);
  assert.equal(roads.items.filter((r) => r.published).length, 1);
  assert.ok(roads.items.every((r) => r.draft));
  assert.equal(
    (await call("/taxonomy/options/" + c.id + "/content?page=0")).status,
    400,
  );
  assert.equal((await call("/taxonomy/options/missing/content")).status, 404);
  const t = await catalog(),
    ids = t.domains.map((o) => o.id).reverse();
  const reorder = await call("/taxonomy/reorder", {
    method: "POST",
    body: { kind: "domain", orderedIds: ids, revision: t.revision },
  });
  assert.equal(reorder.status, 200);
  assert.equal(reorder.data.revision, t.revision + 1);
  assert.deepEqual(
    (await catalog()).domains.map((o) => o.id),
    ids,
  );
  assert.equal(
    (
      await call("/taxonomy/reorder", {
        method: "POST",
        body: { kind: "domain", orderedIds: ids, revision: t.revision },
      })
    ).status,
    409,
  );
  for (const invalid of [
    ids.slice(1),
    [...ids.slice(1), ids[1]],
    ["missing", ...ids.slice(1)],
  ])
    assert.equal(
      (
        await call("/taxonomy/reorder", {
          method: "POST",
          body: {
            kind: "domain",
            orderedIds: invalid,
            revision: (await catalog()).revision,
          },
        })
      ).status,
      400,
    );
  assert.equal((await mutate(c.id, { parentId: b.id })).status, 409);
  assert.equal((await mutate(e.id, { parentId: b.id })).status, 200);
  let cats = (await catalog()).categories.filter((o) => o.parent_id === b.id);
  assert.equal(cats.at(-1).id, e.id);
  const rev = (await catalog()).revision;
  assert.equal(
    (
      await call("/taxonomy/reorder", {
        method: "POST",
        body: {
          kind: "category",
          parentId: b.id,
          orderedIds: cats.map((o) => o.id).reverse(),
          revision: rev,
        },
      })
    ).status,
    200,
  );
  const moving = await create("category", "仅甲分类", a.id);
  const preview = await call(
    "/taxonomy/options/" + a.id + "/impact?targetId=" + b.id,
  );
  assert.equal(preview.status, 200);
  assert.equal(
    preview.data.children.find((x) => x.id === c.id).action,
    "merge",
  );
  assert.equal(
    preview.data.children.find((x) => x.id === moving.id).action,
    "move",
  );
  assert.equal((await mutate(a.id, {}, "DELETE")).status, 409);
  assert.equal((await mutate(a.id, { targetId: b.id }, "DELETE")).status, 200);
  usage = (await call("/taxonomy/usage")).data.usage;
  assert.equal(usage[d.id].resources, 21);
  assert.equal(usage[d.id].roadmaps, 2);
  assert.equal(usage[b.id].roadmaps, 2);
  assert.equal(
    (await catalog()).categories.find((o) => o.id === moving.id).parent_id,
    b.id,
  );
  assert.equal((await mutate(tag.id, {}, "DELETE")).status, 200);
  assert.equal(
    (await call("/taxonomy/options/" + d.id + "/content")).data.total,
    21,
  );
}
