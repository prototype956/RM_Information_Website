import { taxonomyManagementContract } from "./taxonomy-management-contract.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createTaxonomy } from "../server/taxonomy.js";
import {
  resolveOption,
  resolveClassification,
} from "../src/taxonomy/helpers.js";
const dir = mkdtempSync(path.join(tmpdir(), "rm-taxonomy-test-"));
let server,
  base,
  admin,
  member,
  resourceId,
  roadmapId,
  category,
  tag,
  otherTag,
  domain;
async function request(url, { cookie = admin, method = "GET", body } = {}) {
  const r = await fetch(base + "/api" + url, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body && !(body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
    },
    body:
      body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  return {
    status: r.status,
    data: await r.json(),
    cookie: r.headers.get("set-cookie")?.split(";")[0],
  };
}
const catalog = async () => (await request("/taxonomy")).data;
const mutate = async (id, body = {}, method = "PATCH") =>
  request("/taxonomy/options" + (id ? "/" + id : ""), {
    method,
    body: { revision: (await catalog()).revision, ...body },
  });
const draft = async () => (await request(`/roadmaps/${roadmapId}/draft`)).data;
before(async () => {
  server = spawn(process.execPath, ["server/index.js"], {
    env: { ...process.env, NODE_ENV: "test", DATA_DIR: dir, PORT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("timeout")), 15000);
    server.stdout.on("data", (c) => {
      const m = c.toString().match(/http:\/\/127\.0\.0\.1:\d+/);
      if (m) {
        clearTimeout(timer);
        resolve(m[0]);
      }
    });
    server.once("error", reject);
  });
  admin = (
    await request("/auth/setup", {
      cookie: "",
      method: "POST",
      body: {
        name: "管理员",
        email: "admin@taxonomy.test",
        password: "test-password-123",
        examples: false,
      },
    })
  ).cookie;
  const invite = await request("/invitations", { method: "POST", body: {} });
  member = (
    await request("/auth/register", {
      cookie: "",
      method: "POST",
      body: {
        name: "队员",
        email: "member@taxonomy.test",
        password: "test-password-123",
        token: invite.data.token,
      },
    })
  ).cookie;
});
after(async () => {
  server?.kill();
  if (server && server.exitCode === null)
    await new Promise((r) => server.once("exit", r));
  if (
    path.resolve(dir).startsWith(path.resolve(tmpdir()) + path.sep) &&
    path.basename(dir).startsWith("rm-taxonomy-test-")
  )
    rmSync(dir, { recursive: true, force: true });
});
test("taxonomy authentication, admin maintenance and member tag reuse", async () => {
  assert.equal((await request("/taxonomy", { cookie: "" })).status, 401);
  const t = await catalog();
  assert.equal(t.domains.length, 2);
  assert.equal(
    (
      await request("/taxonomy/options", {
        cookie: member,
        method: "POST",
        body: { revision: t.revision, kind: "domain", name: "越权" },
      })
    ).status,
    403,
  );
  assert.equal(
    (await request("/taxonomy/options/rm/impact", { cookie: member })).status,
    403,
  );
  tag = (
    await request("/taxonomy/tags", {
      cookie: admin,
      method: "POST",
      body: { name: "  ＳＴＭ３２  " },
    })
  ).data.tag;
  const same = (
    await request("/taxonomy/tags", {
      cookie: member,
      method: "POST",
      body: { name: "stm32" },
    })
  ).data.tag;
  assert.equal(same.id, tag.id);
  assert.equal(
    (
      await request("/taxonomy/options/" + tag.id, {
        cookie: member,
        method: "DELETE",
        body: { revision: (await catalog()).revision },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request("/taxonomy/tags", {
        method: "POST",
        body: { name: "x".repeat(31) },
      })
    ).status,
    400,
  );
});
test("create hierarchy, reject duplicate and stale catalog mutation", async () => {
  domain = (await mutate("", { kind: "domain", name: "测试资料库" }, "POST"))
    .data.option;
  category = (
    await mutate(
      "",
      { kind: "category", name: "控制基础", parentId: domain.id },
      "POST",
    )
  ).data.option;
  assert.equal(
    (
      await mutate(
        "",
        { kind: "category", name: " 控制基础 ", parentId: domain.id },
        "POST",
      )
    ).status,
    409,
  );
  const old = await catalog();
  assert.equal((await mutate(category.id, { position: 3 })).status, 200);
  assert.equal(
    (
      await request("/taxonomy/options/" + category.id, {
        method: "PATCH",
        body: { revision: old.revision, name: "不应覆盖" },
      })
    ).status,
    409,
  );
  assert.equal(
    (await mutate(category.id, { parentId: "missing" })).status,
    400,
  );
});
test("resource and roadmap reference same stable categories and tags", async () => {
  const form = new FormData();
  Object.entries({
    title: "分类迁移资料",
    domain: domain.id,
    categoryId: category.id,
    category: category.name,
    tagIds: JSON.stringify([tag.id]),
    tags: "[]",
    kind: "link",
    url: "https://example.org",
    description: "正文必须保留",
  }).forEach(([k, v]) => form.set(k, v));
  const r = await request("/resources", {
    method: "POST",
    body: form,
    cookie: member,
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  resourceId = r.data.id;
  const document = {
    title: "分类迁移路线",
    description: "路线正文",
    domain: domain.id,
    categoryId: category.id,
    tagIds: [tag.id],
    stages: [{ id: "s", title: "入门" }],
    nodes: [
      {
        id: "n",
        title: "实践",
        stageId: "s",
        required: true,
        goal: "目标",
        description: "学习说明",
        task: "任务",
        position: { x: 0, y: 0 },
        resourceIds: [resourceId],
        links: [],
      },
    ],
    edges: [],
  };
  const road = await request("/roadmaps", {
    method: "POST",
    body: { document },
  });
  assert.equal(road.status, 201, JSON.stringify(road.data));
  roadmapId = road.data.id;
  assert.equal(
    (
      await request(`/roadmaps/${roadmapId}/publish`, {
        method: "POST",
        body: { version: 1 },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request(`/roadmaps/${roadmapId}/progress`, {
        cookie: member,
        method: "PUT",
        body: { nodeId: "n", state: "completed" },
      })
    ).status,
    200,
  );
  const impact = (await request("/taxonomy/options/" + category.id + "/impact"))
    .data.impact;
  assert.deepEqual(impact, { resources: 1, roadmaps: 1, categories: 0 });
});
test("rename reflects in snapshots and resource labels without losing progress or stable IDs", async () => {
  const prior = await draft();
  await mutate(category.id, { name: "控制与通信" });
  await mutate(domain.id, { name: "机器人学习" });
  await mutate(tag.id, { name: "嵌入式" });
  const r = (await request("/resources/" + resourceId)).data.resource;
  assert.equal(r.categoryId, category.id);
  assert.equal(r.category, "控制与通信");
  assert.equal(r.domainName, "机器人学习");
  assert.deepEqual(r.tags, ["嵌入式"]);
  const d = await draft();
  assert.equal(d.roadmap.version, prior.roadmap.version);
  assert.deepEqual(d.document.nodes, prior.document.nodes);
  const pub = (await request("/roadmaps/" + roadmapId, { cookie: member }))
    .data;
  assert.equal(pub.document.category, "控制与通信");
  assert.deepEqual(pub.document.tags, ["嵌入式"]);
  assert.equal(pub.roadmap.progress.completed, 1);
  const t = await catalog();
  assert.equal(
    resolveOption(t, "category", "控制基础", domain.id),
    category.id,
  );
  assert.equal(resolveOption(t, "tag", "STM32"), tag.id);
});
test("used deletion requires target and cross-library move rejects stale drafts", async () => {
  assert.equal((await mutate(category.id, {}, "DELETE")).status, 409);
  const old = await draft();
  assert.equal((await mutate(category.id, { parentId: "rm" })).status, 200);
  const r = (await request("/resources/" + resourceId)).data.resource;
  assert.equal(r.domain, "rm");
  assert.deepEqual(
    resolveClassification(await catalog(), domain.id, category.id),
    { domain: "rm", category: category.id },
  );
  const d = await draft();
  assert.ok(d.roadmap.version > old.roadmap.version);
  assert.equal(d.document.domain, "rm");
  assert.equal(
    (
      await request(`/roadmaps/${roadmapId}/draft`, {
        method: "PUT",
        body: { version: old.roadmap.version, document: old.document },
      })
    ).status,
    409,
  );
});
test("merge category migrates resource, draft, publication and old-ID aliases", async () => {
  const target = (await catalog()).categories.find(
    (c) => c.parent_id === "rm" && c.name === "通用工具",
  );
  assert.equal(
    (await mutate(category.id, { targetId: target.id }, "DELETE")).status,
    200,
  );
  const r = (await request("/resources/" + resourceId)).data.resource;
  assert.equal(r.categoryId, target.id);
  const pub = (await request("/roadmaps/" + roadmapId, { cookie: member }))
    .data;
  assert.equal(pub.document.categoryId, target.id);
  assert.equal(pub.roadmap.progress.completed, 1);
  assert.equal(
    resolveOption(await catalog(), "category", category.id),
    target.id,
  );
  category = target;
});
test("library deletion merges same-name categories and moves remaining categories", async () => {
  const twin = (
    await mutate(
      "",
      { kind: "category", parentId: domain.id, name: "通用工具" },
      "POST",
    )
  ).data.option;
  const extra = (
    await mutate(
      "",
      { kind: "category", parentId: "rm", name: "独立课程" },
      "POST",
    )
  ).data.option;
  assert.equal(
    (await mutate("rm", { targetId: domain.id }, "DELETE")).status,
    200,
  );
  const t = await catalog();
  assert.equal(
    t.domains.some((d) => d.id === "rm"),
    false,
  );
  assert.equal(
    t.categories.find((c) => c.id === extra.id).parent_id,
    domain.id,
  );
  assert.equal(
    t.categories.filter(
      (c) => c.parent_id === domain.id && c.name === "通用工具",
    ).length,
    1,
  );
  const r = (await request("/resources/" + resourceId)).data.resource;
  assert.equal(r.domain, domain.id);
  assert.equal(r.categoryId, twin.id);
  assert.equal(resolveOption(t, "domain", "rm"), domain.id);
  assert.equal(resolveOption(t, "category", "通用工具", "rm"), twin.id);
  category = twin;
});
test("tag merge deduplicates references and deletion removes only associations", async () => {
  otherTag = (
    await request("/taxonomy/tags", {
      method: "POST",
      body: { name: "工具链" },
    })
  ).data.tag;
  let d = await draft();
  d.document.tagIds.push(otherTag.id);
  assert.equal(
    (
      await request(`/roadmaps/${roadmapId}/draft`, {
        method: "PUT",
        body: { version: d.roadmap.version, document: d.document },
      })
    ).status,
    200,
  );
  assert.equal(
    (await mutate(tag.id, { targetId: otherTag.id }, "DELETE")).status,
    200,
  );
  d = await draft();
  assert.deepEqual(d.document.tagIds, [otherTag.id]);
  assert.equal(resolveOption(await catalog(), "tag", "STM32"), otherTag.id);
  assert.deepEqual(
    (await request("/resources/" + resourceId)).data.resource.tagIds,
    [otherTag.id],
  );
  assert.equal((await mutate(otherTag.id, {}, "DELETE")).status, 200);
  assert.deepEqual((await draft()).document.tagIds, []);
  assert.equal(
    (await request("/resources/" + resourceId)).data.resource.description,
    "正文必须保留",
  );
  assert.equal(
    (await request(`/roadmaps/${roadmapId}/progress`, { cookie: member })).data
      .progress.completed,
    1,
  );
});
test("empty options can be deleted; invalid category/tag references cannot be saved", async () => {
  const unused = (await mutate("", { kind: "domain", name: "空库" }, "POST"))
    .data.option;
  assert.equal((await mutate(unused.id, {}, "DELETE")).status, 200);
  const d = await draft();
  assert.equal(
    (
      await request(`/roadmaps/${roadmapId}/draft`, {
        method: "PUT",
        body: {
          version: d.roadmap.version,
          document: { ...d.document, tagIds: ["missing"] },
        },
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request(`/roadmaps/${roadmapId}/draft`, {
        method: "PUT",
        body: {
          version: d.roadmap.version,
          document: { ...d.document, categoryId: "missing" },
        },
      })
    ).status,
    409,
  );
});
test("legacy migration is idempotent and preserves files, content, node IDs and progress", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(
    `CREATE TABLE resources(id TEXT PRIMARY KEY,domain TEXT,category TEXT,tags TEXT,title TEXT); CREATE TABLE roadmaps(id TEXT PRIMARY KEY,draft TEXT,published TEXT,version INTEGER); CREATE TABLE attachments(id TEXT,name TEXT); CREATE TABLE roadmap_progress(user_id TEXT,roadmap_id TEXT,states TEXT); INSERT INTO attachments VALUES('file','原始文件.pdf'); INSERT INTO roadmap_progress VALUES('member','road','{"n":"completed"}');`,
  );
  db.prepare("INSERT INTO resources VALUES(?,?,?,?,?)").run(
    "res",
    "rm",
    "自定义课程",
    '["PID","pid"]',
    "原标题",
  );
  const doc = {
    title: "原路线",
    domain: "rm",
    category: "自定义课程",
    nodes: [{ id: "n", title: "保留内容" }],
    stages: [],
    edges: [],
  };
  db.prepare("INSERT INTO roadmaps VALUES(?,?,?,?)").run(
    "road",
    JSON.stringify(doc),
    JSON.stringify(doc),
    5,
  );
  createTaxonomy(db);
  const snapshot = () =>
    JSON.stringify({
      r: db.prepare("SELECT * FROM resources").all(),
      m: db.prepare("SELECT * FROM roadmaps").all(),
      t: db.prepare("SELECT * FROM taxonomy_options").all(),
      a: db.prepare("SELECT * FROM attachments").all(),
      p: db.prepare("SELECT * FROM roadmap_progress").all(),
    });
  const first = snapshot();
  createTaxonomy(db);
  assert.equal(snapshot(), first);
  assert.equal(db.prepare("SELECT version FROM roadmaps").get().version, 6);
  assert.equal(
    JSON.parse(db.prepare("SELECT draft FROM roadmaps").get().draft).nodes[0]
      .id,
    "n",
  );
  assert.equal(
    JSON.parse(db.prepare("SELECT tag_ids FROM resources").get().tag_ids)
      .length,
    1,
  );
  db.close();
});

test("taxonomy management usage, preview, pagination, ordering and permissions", async () => { await taxonomyManagementContract(request, admin, member); });
