import { invitationContract } from "./invitation-contract.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import fs from "node:fs";
import { passwordHash } from "../cloud/auth.js";
import { blankRoadmap } from "../shared/roadmap.js";
let mf, db, admin, member, other, route, category, tag, resource, requestId;
const password = "Test-only-12345";
async function req(
  path,
  { cookie = admin, body, method = "GET", headers = {} } = {},
) {
  let payload = body ? JSON.stringify(body) : undefined;
  if (body instanceof FormData) {
    const encoded = new Request("http://localhost", { method: "POST", body });
    headers = {
      "content-type": encoded.headers.get("content-type"),
      ...headers,
    };
    payload = new Uint8Array(await encoded.arrayBuffer());
  }
  const r = await mf.dispatchFetch("http://localhost" + path, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body && !(body instanceof FormData)
        ? { "content-type": "application/json" }
        : {}),
      ...headers,
    },
    body: payload,
  });
  const data = await r.json().catch(() => null);
  return {
    status: r.status,
    data,
    cookie: r.headers.get("set-cookie")?.split(";")[0],
    headers: r.headers,
  };
}
async function api(path, options) {
  return req("/api" + path, options);
}
before(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: "rm-test",
          modules: true,
          scriptPath: "dist/server/index.js",
          compatibilityDate: "2026-09-08",
          compatibilityFlags: ["nodejs_compat"],
          d1Databases: ["DB"],
          r2Buckets: ["FILES"],
          bindings: {
            MIGRATION_TOKEN: "isolated-test-token",
            MIGRATION_EXPIRES: String(Date.now() + 3600000),
          },
        },
      ],
    }),
  );
  db = await mf.getD1Database("DB");
  for (const name of fs
    .readdirSync("drizzle")
    .filter((n) => n.endsWith(".sql")))
    for (const sql of fs
      .readFileSync("drizzle/" + name, "utf8")
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean))
      await db.prepare(sql).run();
  const imported = await req("/_migration/import", {
    cookie: null,
    method: "POST",
    headers: { authorization: "Bearer isolated-test-token" },
    body: {
      users: [
        {
          id: "test-admin",
          name: "测试管理员",
          email: "admin@example.test",
          password: passwordHash(password),
          role: "admin",
        },
      ],
      taxonomy_meta: [{ id: 1, revision: 1 }],
      taxonomy_options: [
        {
          id: "rm",
          kind: "domain",
          parent_id: "",
          name: "RM 学习",
          normalized: "rm 学习",
          position: 0,
        },
        {
          id: "control",
          kind: "category",
          parent_id: "rm",
          name: "电控",
          normalized: "电控",
          position: 0,
        },
      ],
    },
  });
  assert.equal(imported.status, 200, JSON.stringify(imported.data));
});
after(async () => {
  await mf?.dispose();
});
test("cloud import is atomic and cannot overwrite existing accounts", async () => {
  assert.equal(
    (
      await req("/_migration/import", {
        method: "POST",
        body: {},
        headers: { authorization: "Bearer isolated-test-token" },
      })
    ).status,
    409,
  );
  assert.equal(
    (await req("/_migration/import", { method: "POST", body: {} })).status,
    404,
  );
  assert.equal((await api("/resources", { cookie: null })).status, 401);
  assert.equal(
    (await api("/auth/setup", { method: "POST", body: {} })).status,
    403,
  );
});
test("cloud legacy-password login and invitation registration", async () => {
  const login = await api("/auth/login", {
    method: "POST",
    body: { email: "admin@example.test", password },
  });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  admin = login.cookie;
  assert.ok(admin);
  assert.ok(!login.data.user.password);
  for (const [email, set] of [
    ["member@example.test", (c) => (member = c)],
    ["other@example.test", (c) => (other = c)],
  ]) {
    const invite = await api("/invitations", { method: "POST", body: {} });
    assert.equal(invite.status, 201, JSON.stringify(invite.data));
    const r = await api("/auth/register", {
      method: "POST",
      cookie: null,
      body: { token: invite.data.token, name: "测试队员", email, password },
    });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    set(r.cookie);
    assert.equal(
      (await api("/auth/invitation/" + invite.data.token)).status,
      410,
    );
  }
  assert.equal((await api("/invitations", { cookie: member })).status, 403);
  assert.equal(
    (
      await api("/invitations", {
        method: "POST",
        body: {},
        headers: { origin: "https://evil.test" },
      })
    ).status,
    403,
  );
});
test("cloud request approval creates reusable options with private queues", async () => {
  let r = await api("/taxonomy/requests", {
    cookie: member,
    method: "POST",
    body: { kind: "tag", name: "PID", reason: "学习用途" },
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  requestId = r.data.request.id;
  assert.equal(
    (await api("/taxonomy/requests", { cookie: other })).data.total,
    0,
  );
  assert.equal(
    (
      await api("/taxonomy/requests/" + requestId + "/review", {
        cookie: member,
        method: "POST",
        body: { decision: "approved", version: 1 },
      })
    ).status,
    403,
  );
  r = await api("/taxonomy/requests/" + requestId + "/review", {
    method: "POST",
    body: { decision: "approved", version: 1 },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  tag = r.data.option.id;
  assert.equal(
    (
      await api("/taxonomy/requests/" + requestId + "/review", {
        method: "POST",
        body: { decision: "rejected", note: "过期操作", version: 1 },
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await api("/taxonomy/tags", {
        cookie: member,
        method: "POST",
        body: { name: "未批准" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await api("/taxonomy/tags", {
        cookie: member,
        method: "POST",
        body: { name: "PID" },
      })
    ).data.tag.id,
    tag,
  );
});
const resourceFields = () => ({
  title: "云端资料测试",
  domain: "rm",
  categoryId: "control",
  tagIds: JSON.stringify([tag]),
  kind: "file",
  url: "",
  description: "隔离测试文件",
});
test("cloud streams multipart into R2 and enforces download visibility", async () => {
  const body = new FormData();
  for (const [k, v] of Object.entries(resourceFields())) body.append(k, v);
  body.append(
    "files",
    new Blob(["cloud file content"], { type: "text/plain" }),
    "云端笔记.txt",
  );
  const r = await api("/resources", { cookie: member, method: "POST", body });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  resource = r.data.id;
  const detail = await api("/resources/" + resource, { cookie: member });
  assert.equal(detail.status, 200, JSON.stringify(detail.data));
  const attachment = detail.data.resource.attachments[0];
  assert.equal(attachment.name, "云端笔记.txt");
  const file = await mf.dispatchFetch(
    "http://localhost/api/files/" + attachment.id,
    { headers: { cookie: other } },
  );
  assert.equal(file.status, 200);
  assert.equal(await file.text(), "cloud file content");
  assert.equal(
    (await api("/files/" + attachment.id, { cookie: null })).status,
    401,
  );
  assert.equal(
    (
      await api("/resources/" + resource, {
        method: "PATCH",
        body: { hidden: true },
      })
    ).status,
    200,
  );
  assert.equal(
    (await api("/files/" + attachment.id, { cookie: other })).status,
    404,
  );
  await api("/resources/" + resource, {
    method: "PATCH",
    body: { hidden: false },
  });
  assert.equal(
    (
      await api("/resources/" + resource, {
        method: "DELETE",
        cookie: other,
        body: {},
      })
    ).status,
    403,
  );
});
test("cloud route drafts, graph validation and publication snapshots", async () => {
  const doc = {
    ...blankRoadmap({ domain: "rm", categoryId: "control", tagIds: [tag] }),
    title: "电控路线",
  };
  doc.nodes = [
    {
      id: "node-a",
      title: "学习 PID",
      stageId: doc.stages[0].id,
      goal: "理解反馈",
      description: "",
      task: "实验",
      required: true,
      position: { x: 0, y: 0 },
      resourceIds: [resource],
      links: [],
    },
  ];
  const r = await api("/roadmaps", {
    cookie: member,
    method: "POST",
    body: { document: doc },
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  route = r.data.id;
  assert.equal(
    (await api("/roadmaps/" + route + "/draft", { cookie: other })).status,
    403,
  );
  assert.equal(
    (await api("/roadmaps/" + route, { cookie: other })).status,
    404,
  );
  const cycle = {
    ...doc,
    edges: [{ id: "bad", source: "node-a", target: "node-a" }],
  };
  assert.equal(
    (
      await api("/roadmaps/" + route + "/draft", {
        cookie: member,
        method: "PUT",
        body: { document: cycle, version: 1 },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await api("/roadmaps/" + route + "/publish", {
        cookie: member,
        method: "POST",
        body: { version: 1 },
      })
    ).status,
    200,
  );
  doc.title = "未发布更新";
  assert.equal(
    (
      await api("/roadmaps/" + route + "/draft", {
        cookie: member,
        method: "PUT",
        body: { document: doc, version: 2 },
      })
    ).status,
    200,
  );
  assert.equal(
    (await api("/roadmaps/" + route, { cookie: other })).data.document.title,
    "电控路线",
  );
  assert.equal(
    (
      await api("/roadmaps/" + route + "/draft", {
        cookie: member,
        method: "PUT",
        body: { document: doc, version: 2 },
      })
    ).status,
    409,
  );
});
test("cloud personal progress survives publication, moderation and copies", async () => {
  const p = await api("/roadmaps/" + route + "/progress", {
    cookie: other,
    method: "PUT",
    body: { nodeId: "node-a", state: "completed" },
  });
  assert.equal(p.status, 200, JSON.stringify(p.data));
  assert.equal(p.data.progress.percent, 100);
  assert.equal(
    (await api("/roadmaps/" + route + "/progress", { cookie: member })).data
      .progress.percent,
    0,
  );
  assert.equal(
    (
      await api("/roadmaps/" + route + "/progress", {
        cookie: member,
        method: "PUT",
        body: { userId: "someone" },
      })
    ).status,
    400,
  );
  await api("/roadmaps/" + route + "/publish", {
    cookie: member,
    method: "POST",
    body: { version: 3 },
  });
  assert.equal(
    (await api("/roadmaps/" + route + "/progress", { cookie: other })).data
      .progress.percent,
    100,
  );
  const copy = await api("/roadmaps/" + route + "/copy", {
    cookie: other,
    method: "POST",
    body: {},
  });
  assert.equal(copy.status, 201);
  const draft = await api("/roadmaps/" + copy.data.id + "/draft", {
    cookie: other,
  });
  assert.equal(draft.data.roadmap.progress.started, false);
  assert.notEqual(draft.data.document.nodes[0].id, "node-a");
  await api("/roadmaps/" + route + "/visibility", {
    method: "PATCH",
    body: { version: 4, hidden: true },
  });
  assert.equal(
    (
      await api("/roadmaps/" + route + "/publish", {
        cookie: member,
        method: "POST",
        body: { version: 5 },
      })
    ).status,
    403,
  );
  assert.equal(
    (await api("/roadmaps/" + route, { cookie: other })).status,
    404,
  );
  await api("/roadmaps/" + route + "/visibility", {
    method: "PATCH",
    body: { version: 5, hidden: false },
  });
});
test("cloud taxonomy rename and merge preserve references and progress", async () => {
  let catalog = (await api("/taxonomy")).data;
  assert.equal(
    (
      await api("/taxonomy/options/control", {
        method: "PATCH",
        body: { revision: catalog.revision, name: "嵌入式" },
      })
    ).status,
    200,
  );
  assert.equal(
    (await api("/resources/" + resource, { cookie: member })).data.resource
      .category,
    "嵌入式",
  );
  assert.equal(
    (await api("/roadmaps/" + route, { cookie: other })).data.document.category,
    "嵌入式",
  );
  catalog = (await api("/taxonomy")).data;
  const created = await api("/taxonomy/options", {
    method: "POST",
    body: {
      revision: catalog.revision,
      kind: "category",
      parentId: "rm",
      name: "控制系统",
    },
  });
  assert.equal(created.status, 201);
  category = created.data.option.id;
  assert.equal(
    (
      await api("/taxonomy/options/control", {
        method: "DELETE",
        body: { revision: created.data.revision },
      })
    ).status,
    409,
  );
  const merged = await api("/taxonomy/options/control", {
    method: "DELETE",
    body: { revision: created.data.revision, targetId: category },
  });
  assert.equal(merged.status, 200, JSON.stringify(merged.data));
  assert.equal(
    (await api("/resources/" + resource, { cookie: member })).data.resource
      .categoryId,
    category,
  );
  assert.equal(
    (await api("/roadmaps/" + route + "/progress", { cookie: other })).data
      .progress.percent,
    100,
  );
});
test("cloud optimistic write conflict rolls back the whole batch", async () => {
  const { database } = await import("../cloud/db.js");
  const a = await database(db),
    b = await database(db);
  a.run(
    "INSERT INTO taxonomy_options VALUES('first','tag','','First','first',99)",
  );
  b.run(
    "INSERT INTO taxonomy_options VALUES('stale','tag','','Stale','stale',99)",
  );
  await a.commit();
  await assert.rejects(b.commit(), (e) => e.status === 409);
  assert.equal(
    await db
      .prepare("SELECT id FROM taxonomy_options WHERE id='stale'")
      .first(),
    null,
  );
});
test("cloud deletion cascades progress and attachment metadata", async () => {
  const d = await api("/roadmaps/" + route + "/draft", { cookie: member });
  assert.equal(
    (
      await api("/roadmaps/" + route, {
        cookie: member,
        method: "DELETE",
        body: { version: d.data.roadmap.version },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await db
        .prepare(
          "SELECT count(*) AS n FROM roadmap_progress WHERE roadmap_id=?",
        )
        .bind(route)
        .first()
    ).n,
    0,
  );
  assert.equal(
    (
      await api("/resources/" + resource, {
        cookie: member,
        method: "DELETE",
        body: {},
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await db
        .prepare("SELECT count(*) AS n FROM attachments WHERE resource_id=?")
        .bind(resource)
        .first()
    ).n,
    0,
  );
});

test("cloud short and legacy invitation registration contract", async () => {
  await invitationContract(api, admin, (sql, ...args) => db.prepare(sql).bind(...args).run());
});
