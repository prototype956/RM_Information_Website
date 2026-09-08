import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
let server, base, admin, author, learner, roadmapId, resourceId;
const dir = mkdtempSync(path.join(tmpdir(), "rm-roadmap-test-"));
const node = (id, required = true) => ({
  id,
  title: `学习 ${id}`,
  stageId: "stage1",
  required,
  goal: "学习目标",
  description: "说明",
  task: "实践",
  position: { x: 0, y: 0 },
  resourceIds: [],
  links: [],
});
const fixture = () => ({
  title: "电控学习路线",
  description: "测试示例",
  domain: "rm",
  category: "电控与嵌入式",
  stages: [{ id: "stage1", title: "入门" }],
  nodes: [node("n1"), node("n2"), node("n3", false)],
  edges: [{ id: "e1", source: "n1", target: "n2" }],
});
async function request(url, { cookie = author, method = "GET", body } = {}) {
  const response = await fetch(base + "/api" + url, {
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
    status: response.status,
    data: await response.json(),
    cookie: response.headers.get("set-cookie")?.split(";")[0],
  };
}
const draft = async () => {
  const r = await request(`/roadmaps/${roadmapId}/draft`);
  assert.equal(r.status, 200);
  return r.data;
};
async function update(document) {
  const r = await draft();
  return request(`/roadmaps/${roadmapId}/draft`, {
    method: "PUT",
    body: { version: r.roadmap.version, document },
  });
}
async function action(kind, cookie = author, extra = {}) {
  const r = await request(`/roadmaps/${roadmapId}/draft`, { cookie });
  return request(`/roadmaps/${roadmapId}/${kind}`, {
    cookie,
    method: kind === "visibility" ? "PATCH" : "POST",
    body: { version: r.data.roadmap.version, ...extra },
  });
}
before(async () => {
  server = spawn(process.execPath, ["server/index.js"], {
    env: { ...process.env, NODE_ENV: "test", DATA_DIR: dir, PORT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("server timeout")), 15000);
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
        email: "admin@roadmap.test",
        password: "test-password-123",
        examples: false,
      },
    })
  ).cookie;
  for (const [name, email] of [
    ["作者", "author@roadmap.test"],
    ["学习者", "learner@roadmap.test"],
  ]) {
    const invite = await request("/invitations", {
      cookie: admin,
      method: "POST",
      body: {},
    });
    const r = await request("/auth/register", {
      cookie: "",
      method: "POST",
      body: {
        name,
        email,
        password: "test-password-123",
        token: invite.data.token,
      },
    });
    if (name === "作者") author = r.cookie;
    else learner = r.cookie;
  }
  const form = new FormData();
  Object.entries({
    title: "内部学习资料",
    domain: "rm",
    category: "电控与嵌入式",
    kind: "link",
    url: "https://example.org",
    description: "说明",
    tags: "[]",
  }).forEach(([k, v]) => form.set(k, v));
  resourceId = (await request("/resources", { method: "POST", body: form }))
    .data.id;
});
after(async () => {
  server?.kill();
  if (server && server.exitCode === null)
    await new Promise((r) => server.once("exit", r));
  const target = path.resolve(dir);
  if (
    target.startsWith(path.resolve(tmpdir()) + path.sep) &&
    path.basename(target).startsWith("rm-roadmap-test-")
  )
    rmSync(target, { recursive: true, force: true });
});
test("roadmap authentication, draft visibility and author ownership", async () => {
  assert.equal((await request("/roadmaps", { cookie: "" })).status, 401);
  const doc = fixture();
  doc.nodes[0].resourceIds = [resourceId];
  const r = await request("/roadmaps", {
    method: "POST",
    body: { document: doc },
  });
  assert.equal(r.status, 201);
  roadmapId = r.data.id;
  assert.equal(
    (await request(`/roadmaps/${roadmapId}/draft`, { cookie: learner })).status,
    403,
  );
  assert.equal(
    (await request(`/roadmaps/${roadmapId}`, { cookie: learner })).status,
    404,
  );
  assert.equal((await request("/roadmaps", { cookie: learner })).data.total, 0);
  assert.equal((await request("/roadmaps?scope=mine")).data.total, 1);
  assert.equal(
    (await request("/roadmaps?scope=manage", { cookie: learner })).status,
    403,
  );
  assert.equal(
    (
      await request(`/roadmaps/${roadmapId}/publish`, {
        cookie: learner,
        method: "POST",
        body: { version: 1 },
      })
    ).status,
    403,
  );
});
test("publication snapshots remain unchanged during draft edits; stale writes rejected", async () => {
  assert.equal((await action("publish")).status, 200);
  const original = await draft();
  const document = structuredClone(original.document);
  document.title = "尚未发布的新标题";
  assert.equal((await update(document)).status, 200);
  assert.equal(
    (await request(`/roadmaps/${roadmapId}`)).data.document.title,
    "电控学习路线",
  );
  assert.equal(
    (
      await request(`/roadmaps/${roadmapId}/draft`, {
        method: "PUT",
        body: { version: original.roadmap.version, document },
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request(`/roadmaps/${roadmapId}/publish`, {
        method: "POST",
        body: { version: original.roadmap.version },
      })
    ).status,
    409,
  );
  assert.equal((await action("publish")).status, 200);
  assert.equal(
    (await request(`/roadmaps/${roadmapId}`)).data.document.title,
    "尚未发布的新标题",
  );
});
test("graph validation rejects self edges, duplicates, cycles, missing nodes and duplicate IDs", async () => {
  const valid = (await draft()).document;
  for (const edges of [
    [...valid.edges, { id: "bad", source: "n1", target: "n1" }],
    [...valid.edges, { id: "bad", source: "n1", target: "n2" }],
    [...valid.edges, { id: "bad", source: "n2", target: "n1" }],
    [{ id: "bad", source: "missing", target: "n1" }],
  ])
    assert.equal((await update({ ...valid, edges })).status, 400);
  assert.equal(
    (await update({ ...valid, nodes: [...valid.nodes, valid.nodes[0]] }))
      .status,
    400,
  );
  assert.equal(
    (
      await update({
        ...valid,
        nodes: [{ ...valid.nodes[0], stageId: "missing" }],
        edges: [],
      })
    ).status,
    400,
  );
});
test("node boundaries and HTTP links validated; routes larger than legacy 100KB save correctly", async () => {
  const valid = (await draft()).document;
  assert.equal(
    (
      await update({
        ...valid,
        nodes: [
          {
            ...node("n1"),
            links: [{ title: "unsafe", url: "javascript:alert(1)" }],
          },
        ],
        edges: [],
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await update({
        ...valid,
        nodes: [{ ...node("n1"), resourceIds: ["does-not-exist"] }],
        edges: [],
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await update({
        ...valid,
        nodes: Array.from({ length: 201 }, (_, i) => node("n" + i)),
        edges: [],
      })
    ).status,
    400,
  );
  const large = {
    ...valid,
    nodes: Array.from({ length: 200 }, (_, i) => ({
      ...node("n" + i),
      description: "学习资料".repeat(1000),
    })),
    edges: [],
  };
  assert.ok(JSON.stringify(large).length > 100000);
  assert.equal((await update(large)).status, 200);
  assert.equal((await update(valid)).status, 200);
});
test("progress is per user, permits skipping prerequisites and rejects other-user writes", async () => {
  const mark = await request(`/roadmaps/${roadmapId}/progress`, {
    cookie: learner,
    method: "PUT",
    body: { nodeId: "n2", state: "completed" },
  });
  assert.equal(mark.status, 200);
  assert.equal(mark.data.progress.states.n1, "idle");
  assert.equal(mark.data.progress.percent, 50);
  assert.equal(
    (await request(`/roadmaps/${roadmapId}/progress`)).data.progress.completed,
    0,
  );
  assert.equal(
    (await request("/roadmaps?scope=learning", { cookie: learner })).data.total,
    1,
  );
  assert.equal((await request("/roadmaps?scope=learning")).data.total, 0);
  assert.equal(
    (
      await request(`/roadmaps/${roadmapId}/progress`, {
        method: "PUT",
        body: { nodeId: "n2", state: "completed", userId: "someone" },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(`/roadmaps/${roadmapId}/progress`, {
        method: "PUT",
        body: { nodeId: "unknown", state: "completed" },
      })
    ).status,
    400,
  );
});
test("publishing edits retains stable node progress, new nodes idle, removed nodes excluded", async () => {
  const d = (await draft()).document;
  d.nodes = d.nodes.filter((n) => n.id !== "n1");
  d.nodes.find((n) => n.id === "n2").title = "改名保留学习进度";
  d.nodes.push(node("new"));
  d.edges = [];
  await update(d);
  await action("publish");
  const p = (
    await request(`/roadmaps/${roadmapId}/progress`, { cookie: learner })
  ).data.progress;
  assert.equal(p.states.n2, "completed");
  assert.equal(p.states.new, "idle");
  assert.equal(p.states.n1, undefined);
  assert.equal(p.percent, 50);
  d.nodes = d.nodes.map((n) => ({ ...n, required: false }));
  await update(d);
  await action("publish");
  const optional = (
    await request(`/roadmaps/${roadmapId}/progress`, { cookie: learner })
  ).data.progress;
  assert.equal(optional.percent, null);
  assert.equal(optional.optionalCompleted, 1);
});
test("resource permission resolution does not expose hidden titles; copying strips inaccessible references", async () => {
  const d = (await draft()).document;
  d.nodes[0].resourceIds = [resourceId];
  await update(d);
  await action("publish");
  await request(`/resources/${resourceId}`, {
    cookie: admin,
    method: "PATCH",
    body: { hidden: true },
  });
  const r = await request(`/roadmaps/${roadmapId}`, { cookie: learner });
  assert.equal(r.data.resources[resourceId], null);
  assert.ok(!JSON.stringify(r.data).includes("内部学习资料"));
  const c = await request(`/roadmaps/${roadmapId}/copy`, {
    cookie: learner,
    method: "POST",
    body: {},
  });
  assert.equal(c.status, 201);
  const copy = (
    await request(`/roadmaps/${c.data.id}/draft`, { cookie: learner })
  ).data;
  assert.equal(copy.roadmap.published, false);
  assert.equal(copy.roadmap.progress.started, false);
  assert.equal(copy.document.nodes[0].resourceIds.length, 0);
  assert.notEqual(copy.document.nodes[0].id, d.nodes[0].id);
  assert.equal((await request(`/roadmaps/${c.data.id}/draft`)).status, 403);
});
test("administrator moderation cannot be bypassed by owner; restore and withdrawal preserve progress", async () => {
  assert.equal(
    (await action("visibility", admin, { hidden: true })).status,
    200,
  );
  assert.equal((await action("publish")).status, 403);
  assert.equal(
    (await action("visibility", author, { hidden: false })).status,
    403,
  );
  assert.equal(
    (await request(`/roadmaps/${roadmapId}`, { cookie: learner })).status,
    404,
  );
  assert.equal(
    (
      await request(`/roadmaps/${roadmapId}/progress`, {
        cookie: learner,
        method: "PUT",
        body: {},
      })
    ).status,
    404,
  );
  assert.equal(
    (await action("visibility", admin, { hidden: false })).status,
    200,
  );
  assert.equal(
    (await request(`/roadmaps/${roadmapId}/progress`, { cookie: learner })).data
      .progress.states.n2,
    "completed",
  );
  assert.equal((await action("withdraw")).status, 200);
  assert.equal((await request(`/roadmaps/${roadmapId}`)).status, 404);
  assert.equal((await action("publish")).status, 200);
  assert.equal(
    (await request(`/roadmaps/${roadmapId}/progress`, { cookie: learner })).data
      .progress.states.n2,
    "completed",
  );
});
test("route filtering, pagination, delete permission and cascade cleanup", async () => {
  for (let i = 0; i < 13; i++) {
    const d = fixture();
    d.title = `分页路线 ${i}`;
    await request("/roadmaps", { method: "POST", body: { document: d } });
  }
  const first = await request("/roadmaps?scope=mine&q=分页路线&page=1");
  assert.equal(first.data.roadmaps.length, 12);
  assert.equal(first.data.total, 13);
  assert.equal(
    (await request("/roadmaps?scope=mine&q=分页路线&page=2")).data.roadmaps
      .length,
    1,
  );
  assert.equal(
    (await request("/roadmaps?scope=mine&category=机械")).data.total,
    0,
  );
  const v = (await draft()).roadmap.version;
  assert.equal(
    (
      await request(`/roadmaps/${roadmapId}`, {
        cookie: learner,
        method: "DELETE",
        body: { version: v },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request(`/roadmaps/${roadmapId}`, {
        method: "DELETE",
        body: { version: v },
      })
    ).status,
    200,
  );
  assert.equal(
    (await request(`/roadmaps/${roadmapId}/progress`, { cookie: learner }))
      .status,
    404,
  );
  assert.equal(
    (await request("/roadmaps?scope=learning", { cookie: learner })).data.total,
    0,
  );
});
