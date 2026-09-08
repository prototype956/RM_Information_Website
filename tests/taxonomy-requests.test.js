import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const dir = mkdtempSync(path.join(tmpdir(), "rm-requests-test-"));
let server, base, admin, member, other;
async function request(url, { cookie = member, method = "GET", body } = {}) {
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
const apply = (name, kind = "tag", extra = {}) =>
  request("/taxonomy/requests", {
    method: "POST",
    body: { kind, name, ...extra },
  });
const review = (r, decision = "approved", note = "", cookie = admin) =>
  request(`/taxonomy/requests/${r.id}/review`, {
    cookie,
    method: "POST",
    body: { version: r.version, decision, note },
  });
const catalog = async () => (await request("/taxonomy")).data;
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
        email: "admin@requests.test",
        password: "test-password-123",
        examples: false,
      },
    })
  ).cookie;
  for (const email of ["member", "other"]) {
    const invite = await request("/invitations", {
      cookie: admin,
      method: "POST",
      body: {},
    });
    const r = await request("/auth/register", {
      cookie: "",
      method: "POST",
      body: {
        name: email,
        email: email + "@requests.test",
        password: "test-password-123",
        token: invite.data.token,
      },
    });
    if (email === "member") member = r.cookie;
    else other = r.cookie;
  }
});
after(async () => {
  server?.kill();
  if (server && server.exitCode === null)
    await new Promise((r) => server.once("exit", r));
  if (
    path.resolve(dir).startsWith(path.resolve(tmpdir()) + path.sep) &&
    path.basename(dir).startsWith("rm-requests-test-")
  )
    rmSync(dir, { recursive: true, force: true });
});
test("authentication, own request isolation and admin review permission", async () => {
  assert.equal(
    (await request("/taxonomy/requests", { cookie: "" })).status,
    401,
  );
  const r = (await apply("私人申请", "tag", { reason: "原因" })).data.request;
  assert.equal(
    (await request("/taxonomy/requests", { cookie: other })).data.total,
    0,
  );
  assert.equal((await request("/taxonomy/requests?scope=review")).status, 403);
  assert.equal((await review(r, "approved", "", member)).status, 403);
  assert.equal(
    (
      await request(`/taxonomy/requests/${r.id}/withdraw`, {
        cookie: other,
        method: "POST",
        body: { version: 1 },
      })
    ).status,
    403,
  );
  assert.equal(
    (await request("/taxonomy/requests?scope=review", { cookie: admin })).data
      .total,
    1,
  );
});
test("pending requests are idempotent, validated and absent from selectable options", async () => {
  const first = await apply(" ＰＩＤ ");
  assert.equal(first.status, 201);
  const same = await apply("pid");
  assert.equal(same.data.request.id, first.data.request.id);
  assert.equal(same.data.reused, true);
  assert.equal(
    (await catalog()).tags.some((t) => t.name === "PID"),
    false,
  );
  assert.equal((await apply("x".repeat(31))).status, 400);
  assert.equal((await apply("越界", "role")).status, 400);
  assert.equal(
    (await apply("课程", "category", { parentId: "missing" })).status,
    400,
  );
  assert.equal(
    (await apply("标签", "tag", { reason: "x".repeat(501) })).status,
    400,
  );
});
test("legacy tag and content writes cannot bypass approval", async () => {
  assert.equal(
    (
      await request("/taxonomy/tags", {
        method: "POST",
        body: { name: "绕过直接创建" },
      })
    ).status,
    403,
  );
  const body = new FormData();
  Object.entries({
    title: "测试",
    domain: "rm",
    category: "通用工具",
    tags: '["绕过资源接口"]',
    kind: "link",
    url: "https://example.org",
    description: "",
  }).forEach(([k, v]) => body.set(k, v));
  assert.equal(
    (await request("/resources", { method: "POST", body })).status,
    400,
  );
  const doc = {
    title: "测试",
    description: "",
    domain: "rm",
    category: "通用工具",
    tags: ["绕过路线接口"],
    stages: [{ id: "s", title: "阶段" }],
    nodes: [],
    edges: [],
  };
  assert.equal(
    (await request("/roadmaps", { method: "POST", body: { document: doc } }))
      .status,
    403,
  );
  assert.equal(
    (await catalog()).tags.some((t) => t.name.includes("绕过")),
    false,
  );
});
test("approval atomically creates options; repeated and concurrent decisions cannot overwrite", async () => {
  const r = (await apply("审核标签")).data.request;
  const results = await Promise.all([
    review(r),
    review(r, "rejected", "另一个管理员"),
  ]);
  assert.deepEqual(results.map((x) => x.status).sort(), [200, 409]);
  const approved = results.find((x) => x.status === 200).data.request;
  assert.equal(approved.status, "approved");
  assert.equal(
    (await catalog()).tags.filter((t) => t.name === "审核标签").length,
    1,
  );
  assert.equal(
    (
      await request("/taxonomy/tags", {
        method: "POST",
        body: { name: "审核标签" },
      })
    ).status,
    200,
  );
});
test("same requests from different members reuse the approved option", async () => {
  const a = (await apply("共享名称")).data.request;
  const b = (
    await request("/taxonomy/requests", {
      cookie: other,
      method: "POST",
      body: { kind: "tag", name: "共享名称" },
    })
  ).data.request;
  const ra = await review(a),
    rb = await review(b);
  assert.equal(ra.data.option.id, rb.data.option.id);
  assert.equal((await apply("共享名称")).status, 409);
});
test("rejection requires reason; applicants may resubmit and withdraw", async () => {
  const r = (await apply("应调整名称")).data.request;
  assert.equal((await review(r, "rejected")).status, 400);
  const rejected = await review(r, "rejected", "请注明适用技术");
  assert.equal(rejected.data.request.review_note, "请注明适用技术");
  const second = (await apply("应调整名称")).data.request;
  assert.notEqual(r.id, second.id);
  assert.equal(
    (
      await request(`/taxonomy/requests/${second.id}/withdraw`, {
        method: "POST",
        body: { version: 1 },
      })
    ).status,
    200,
  );
  assert.equal((await review(second)).status, 409);
});
test("library and category approvals create real hierarchy; deleted parents block approval", async () => {
  const domain = (
    await review((await apply("新学习库", "domain")).data.request)
  ).data.option;
  const r = (await apply("新课程", "category", { parentId: domain.id })).data
    .request;
  const category = (await review(r)).data.option;
  assert.equal(category.parent_id, domain.id);
  const pending = (
    await apply("待审批课程", "category", { parentId: domain.id })
  ).data.request;
  const t = await catalog();
  assert.equal(
    (
      await request("/taxonomy/options/" + domain.id, {
        cookie: admin,
        method: "DELETE",
        body: { revision: t.revision, targetId: "rm" },
      })
    ).status,
    200,
  );
  assert.equal((await review(pending)).status, 409);
  assert.equal(
    (await review(pending, "rejected", "请改选 RM 学习资料库")).status,
    200,
  );
});
test("approved tags and categories are selectable; pending IDs are rejected; queue paginates", async () => {
  const tag = (await catalog()).tags.find((t) => t.name === "审核标签");
  const body = new FormData();
  Object.entries({
    title: "使用已审核选项",
    domain: "rm",
    category: "通用工具",
    tagIds: JSON.stringify([tag.id]),
    tags: "[]",
    kind: "link",
    url: "https://example.org",
    description: "",
  }).forEach(([k, v]) => body.set(k, v));
  assert.equal(
    (await request("/resources", { method: "POST", body })).status,
    201,
  );
  const pending = (await apply("未审标签")).data.request;
  body.set("tagIds", JSON.stringify([pending.id]));
  assert.equal(
    (await request("/resources", { method: "POST", body })).status,
    400,
  );
  for (let i = 0; i < 21; i++) await apply("分页申请" + i);
  const list = (await request("/taxonomy/requests?status=pending")).data;
  assert.equal(list.requests.length, 20);
  assert.ok(
    (await request("/taxonomy/requests?status=pending&page=2")).data.requests
      .length > 0,
  );
});
