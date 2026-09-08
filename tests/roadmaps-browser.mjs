import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import AxeBuilder from "@axe-core/playwright";
const require = createRequire(import.meta.url),
  { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright-core");
let server,
  base = process.env.TEST_URL;
mkdirSync("artifacts/roadmaps", { recursive: true });
if (!base) {
  mkdirSync("artifacts/qa-data", { recursive: true });
  const data = mkdtempSync(resolve("artifacts/qa-data/roadmaps-"));
  server = spawn(process.execPath, ["server/index.js", "--production"], {
    env: { ...process.env, PORT: "0", DATA_DIR: data },
    stdio: ["ignore", "pipe", "inherit"],
  });
  base = await new Promise((r, j) => {
    const t = setTimeout(() => j(Error("startup timeout")), 15000);
    server.stdout.on("data", (c) => {
      const m = c.toString().match(/http:\/\/127\.0\.0\.1:\d+/);
      if (m) {
        clearTimeout(t);
        r(m[0]);
      }
    });
    server.once("error", j);
  });
}
assert.notEqual(new URL(base).port, "5173", "Never use real team data");
const browser = await chromium.launch({ channel: "chrome", headless: true }),
  context = await browser.newContext({
    viewport: { width: 1440, height: 1050 },
    reducedMotion: "reduce",
  }),
  page = await context.newPage(),
  errors = [],
  results = [],
  checks = [];
page.on("pageerror", (e) => errors.push(e.message));
const check = (name) => {
  checks.push(name);
  console.log("PASS " + name);
};
const visible = (locator) =>
  locator.waitFor({ state: "visible", timeout: 12000 });
async function choose(label, text) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: text, exact: true }).click();
}
async function saved() {
  await page.waitForFunction(
    () => document.querySelector(".road-save-status")?.textContent === "已保存",
  );
}
async function inspect(name, width) {
  await page.getByRole("heading", { level: 1 }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.locator(".loading").waitFor({ state: "hidden" });
  if (await page.locator(".road-save-status").count()) await saved();
  const geometry = await page.evaluate(() => ({
    width: innerWidth,
    scroll: document.documentElement.scrollWidth,
    headings: [...document.querySelectorAll("main h1")]
      .filter((e) => e.scrollWidth > e.clientWidth + 2)
      .map((e) => e.textContent),
    small: [...document.querySelectorAll("main button")]
      .filter((e) => {
        const r = e.getBoundingClientRect();
        return (
          r.width &&
          r.height &&
          e.getAttribute("role") !== "checkbox" &&
          (r.width < 43 || r.height < 43)
        );
      })
      .map((e) => ({
        text: e.textContent,
        aria: e.getAttribute("aria-label"),
        w: e.getBoundingClientRect().width,
        h: e.getBoundingClientRect().height,
      })),
  }));
  assert.equal(
    geometry.scroll,
    width,
    `${name} overflow ${JSON.stringify(geometry)}`,
  );
  assert.deepEqual(geometry.headings, []);
  assert.deepEqual(geometry.small, [], `${name} touch target`);
  const audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  results.push({
    name,
    width,
    geometry,
    violations: audit.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => ({
        target: n.target,
        summary: n.failureSummary,
      })),
    })),
  });
  await page.screenshot({
    path: `artifacts/roadmaps/${name}-${width}.png`,
    fullPage: true,
  });
  assert.deepEqual(
    audit.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => ({
        target: n.target,
        summary: n.failureSummary,
      })),
    })),
    [],
    `${name} accessibility`,
  );
}
try {
  await page.goto(base + "/roadmaps");
  const setup = (
    await (await context.request.get(base + "/api/auth/status")).json()
  ).setupNeeded;
  if (setup) await page.getByLabel("你的姓名").fill("本地测试管理员");
  await page.getByLabel("邮箱", { exact: true }).fill("qa-admin@example.test");
  await page
    .getByLabel("密码", { exact: true })
    .fill("Local-test-password-123");
  await page
    .getByRole("button", {
      name: setup ? "创建管理员并进入" : "进入资料中心",
      exact: true,
    })
    .click();
  await visible(page.getByRole("button", { name: "创建路线", exact: true }));
  check("login returns to roadmap list");
  await page.getByRole("button", { name: "创建路线", exact: true }).click();
  await visible(page.getByRole("heading", { name: "编排学习路线" }));
  const id = new URL(page.url()).pathname.split("/")[2];
  const getDraft = async () =>
    await (
      await context.request.get(`${base}/api/roadmaps/${id}/draft`)
    ).json();
  await page
    .getByLabel("路线标题", { exact: true })
    .fill("电控入门 · 从代码到机器人");
  await page
    .getByLabel("路线简介")
    .fill(
      "示例路线：建立嵌入式基础，完成通信与电机控制，把知识应用到一台真正的机器人。",
    );
  await page.getByRole("button", { name: "添加节点", exact: true }).click();
  await page.getByLabel("节点标题").fill("C / C++ 与开发环境");
  await page
    .getByLabel("学习目标")
    .fill("掌握基础语法、指针与结构体，能够独立编译和调试工程。");
  await page
    .getByLabel("实践任务")
    .fill("配置工具链，编写一个环形缓冲区，并验证边界情况。");
  await saved();
  let first = (await getDraft()).document.nodes[0].id;
  await page.getByLabel("外链名称").fill("语言参考");
  await page.getByLabel("外链网址").fill("javascript:alert(1)");
  await page.getByRole("button", { name: "添加外链", exact: true }).click();
  await visible(
    page.getByText("请填写链接名称和有效的 HTTP 或 HTTPS 网址", {
      exact: true,
    }),
  );
  await page.getByLabel("外链网址").fill("https://en.cppreference.com/");
  await page.getByRole("button", { name: "添加外链", exact: true }).click();
  await page.getByLabel("搜索关联资料").fill("STM32");
  await page
    .locator(".road-resource-results")
    .getByRole("button")
    .first()
    .click();
  await saved();
  check(
    "create node, validate external URL and associate an existing resource",
  );
  await page.getByRole("button", { name: "添加节点", exact: true }).click();
  await page.getByLabel("节点标题").fill("STM32 外设与中断");
  await page
    .getByLabel("学习目标")
    .fill("理解 GPIO、定时器与中断，让程序与硬件连接起来。");
  await page.getByRole("combobox", { name: "添加前置节点" }).focus();
  await page.keyboard.press("Space");
  await page
    .getByRole("option", { name: "C / C++ 与开发环境", exact: true })
    .waitFor();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await saved();
  assert.equal((await getDraft()).document.edges.length, 1);
  const second = (await getDraft()).document.nodes[1].id;
  await page
    .locator(".road-outline-node")
    .filter({ hasText: "C / C++ 与开发环境" })
    .click();
  await choose("添加前置节点", "STM32 外设与中断");
  await visible(
    page.getByText("前置关系不能形成循环，请调整连线", { exact: true }),
  );
  check("keyboard prerequisite selection and cycle rejection");
  await page.getByLabel("节点标题").fill("临时改名");
  await page.getByRole("button", { name: "撤销修改", exact: true }).click();
  assert.equal(
    await page.getByLabel("节点标题").inputValue(),
    "C / C++ 与开发环境",
  );
  await page.getByRole("button", { name: "重做修改", exact: true }).click();
  assert.equal(await page.getByLabel("节点标题").inputValue(), "临时改名");
  await page.getByRole("button", { name: "撤销修改", exact: true }).click();
  await saved();
  await page.getByRole("button", { name: "一键整理", exact: true }).click();
  await saved();
  await visible(page.locator(".react-flow"));
  assert.ok(
    (await getDraft()).document.nodes[1].position.y >
      (await getDraft()).document.nodes[0].position.y,
  );
  check("undo, redo and lazy auto layout");
  const beforeMove=(await getDraft()).document.nodes.find(n=>n.id===first).position;
  await page.getByTestId(`rf__node-${first}`).focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowRight');
  await saved();
  assert.equal((await getDraft()).document.nodes.find(n=>n.id===first).position.x,beforeMove.x+5);
  const box=await page.getByTestId(`rf__node-${first}`).boundingBox();
  await page.mouse.move(box.x+40,box.y+30);await page.mouse.down();await page.mouse.move(box.x+75,box.y+65,{steps:8});await page.mouse.up();await saved();
  assert.ok((await getDraft()).document.nodes.find(n=>n.id===first).position.x>beforeMove.x+5);
  await page.getByRole('button',{name:'复制当前节点',exact:true}).click();await saved();assert.equal((await getDraft()).document.nodes.length,3);
  await page.getByRole('button',{name:'删除当前节点',exact:true}).click();await page.getByRole('alertdialog').getByRole('button',{name:'确认',exact:true}).click();await saved();assert.equal((await getDraft()).document.nodes.length,2);
  await page.locator('.road-outline-node').filter({hasText:'C / C++ 与开发环境'}).click();
  check('keyboard and mouse node positioning, node copy and confirmed deletion');
  await page.getByRole("button", { name: "预览", exact: true }).click();
  await visible(page.getByRole("heading", { name: "预览路线" }));
  assert.equal(await page.getByLabel("节点标题").count(), 0);
  await page.getByRole("button", { name: "返回编辑", exact: true }).click();
  await page.route(`**/api/roadmaps/${id}/draft`, async (route) => {
    if (route.request().method() === "PUT") await route.abort();
    else await route.continue();
  });
  await page.getByLabel("学习目标").fill("网络失败后仍应保留这份目标");
  await visible(
    page.locator(".road-save-status").filter({ hasText: "保存失败" }),
  );
  assert.equal(
    await page.getByLabel("学习目标").inputValue(),
    "网络失败后仍应保留这份目标",
  );
  let leavePrompt = false;
  page.once("dialog", async (d) => {
    leavePrompt = true;
    await d.dismiss();
  });
  await page.getByRole("link", { name: "我创建的路线", exact: true }).click();
  assert.equal(leavePrompt, true);
  assert.ok(page.url().includes("/edit"));
  await page.unroute(`**/api/roadmaps/${id}/draft`);
  await page.getByRole("button", { name: "重试保存", exact: true }).click();
  await saved();
  check("failed autosave retains content, leave guard and retry");
  const other = await getDraft();
  other.document.description = "服务器上的并发修改";
  await context.request.put(`${base}/api/roadmaps/${id}/draft`, {
    data: { version: other.roadmap.version, document: other.document },
  });
  await page.getByLabel("学习目标").fill("冲突时保留我的修改");
  await visible(
    page.locator(".road-save-status").filter({ hasText: "版本冲突" }),
  );
  assert.equal(
    await page.getByLabel("学习目标").inputValue(),
    "冲突时保留我的修改",
  );
  await page.getByRole("button", { name: "重新加载版本" }).click();
  await visible(page.getByRole("alertdialog"));
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("alertdialog").count(), 0);
  await page.waitForFunction(
    () => document.activeElement?.textContent === "重新加载版本",
  );
  await page.getByRole("button", { name: "重新加载版本" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await saved();
  check("version conflict, confirmation Escape and focus restore");
  await page.getByRole("button", { name: "发布路线", exact: true }).click();
  await visible(page.getByRole("button", { name: "开始学习", exact: true }));
  await page.getByRole("button", { name: "开始学习", exact: true }).click();
  await page.getByRole("button", { name: "已完成", exact: true }).click();
  await visible(page.getByText("学习状态已保存", { exact: true }));
  await page.getByRole("button", { name: "分享路线", exact: true }).click();
  await visible(page.getByRole("dialog"));
  assert.ok(
    (await page.getByLabel("队内路线链接").inputValue()).includes("node="),
  );
  await page.keyboard.press("Escape");
  check("publish, start learning, mark progress and share node link");
  // Published copy stays stable until an explicit update.
  await page.getByRole("link", { name: "编辑路线", exact: true }).click();
  await page.getByLabel("路线简介").fill("尚未发布的简介");
  await saved();
  assert.equal(
    (await (await context.request.get(`${base}/api/roadmaps/${id}`)).json())
      .document.description,
    "服务器上的并发修改",
  );
  await page.getByRole("button", { name: "发布更新", exact: true }).click();
  await visible(page.getByRole("button", { name: "分享路线", exact: true }));
  assert.equal(
    (
      await (
        await context.request.get(`${base}/api/roadmaps/${id}/progress`)
      ).json()
    ).progress.states[first],
    "completed",
  );
  check("draft preview isolation and progress survives publication");
  // Extend isolated fixture for realistic screenshots and mobile controls.
  const seed = await getDraft(),
    doc = seed.document;
  doc.description =
    "示例路线：从嵌入式基础出发，逐步完成通信、电机控制与整机联调。每个阶段都配有学习资料和动手任务。";
  doc.nodes[0].goal =
    "掌握基础语法与工程调试方法，建立嵌入式开发的第一块基石。";
  const stage2 = crypto.randomUUID();
  doc.stages.push({ id: stage2, title: "通信与控制" });
  for (const [title, goal, task, required] of [
    [
      "CAN 总线通信",
      "理解仲裁机制与报文结构，建立可靠的数据通路。",
      "编写双板通信程序，记录并处理丢帧与超时。",
      true,
    ],
    [
      "电机驱动与 PID",
      "从开环到闭环，理解控制器参数与系统响应。",
      "完成电机速度闭环，记录阶跃响应并调整参数。",
      true,
    ],
    [
      "底盘联调与安全检查",
      "把模块组合起来，建立可重复的调试流程。",
      "完成断联保护、急停检查和低速巡航测试。",
      true,
    ],
    [
      "拓展：控制理论笔记",
      "进一步理解反馈、稳定性与频域分析。",
      "阅读拓展资料，对比不同控制策略。",
      false,
    ],
  ]) {
    const nid = crypto.randomUUID();
    doc.nodes.push({
      id: nid,
      title,
      goal,
      task,
      required,
      stageId: stage2,
      description:
        "先阅读关联资料，再完成实践任务。遇到问题时记录现象、条件和排查过程，与队友一起复盘。",
      resourceIds: [],
      links: [],
      position: {
        x: (doc.nodes.length % 2) * 320 + 40,
        y: Math.floor(doc.nodes.length / 2) * 250 + 40,
      },
    });
  }
  doc.nodes.forEach((n, i) => {
    n.position = { x: (i % 2) * 320 + 40, y: Math.floor(i / 2) * 250 + 40 };
  });
  doc.edges = [
    { id: crypto.randomUUID(), source: first, target: second },
    ...doc.nodes
      .slice(2)
      .map((n, i) => ({
        id: crypto.randomUUID(),
        source: i ? doc.nodes[i + 1].id : second,
        target: n.id,
      })),
  ];
  await context.request.put(`${base}/api/roadmaps/${id}/draft`, {
    data: { version: seed.roadmap.version, document: doc },
  });
  await context.request.post(`${base}/api/roadmaps/${id}/publish`, {
    data: { version: seed.roadmap.version + 1 },
  });
  // Real second account logs in at a deep node URL.
  const invite = await (
      await context.request.post(`${base}/api/invitations`, { data: {} })
    ).json(),
    newContext = await browser.newContext();
  await newContext.request.post(`${base}/api/auth/register`, {
    data: {
      name: "路线测试队员",
      email: `learner-${Date.now()}@example.test`,
      password: "Test-learner-12345",
      token: invite.token,
    },
  });
  const cookies = await newContext.cookies();
  await newContext.clearCookies();
  const memberPage = await newContext.newPage();
  await memberPage.goto(`${base}/roadmaps/${id}?node=${second}`);
  await memberPage.getByLabel("邮箱", { exact: true }).fill(
    await (async () => {
      await newContext.addCookies(cookies);
      const me = await (await newContext.request.get(`${base}/api/me`)).json();
      await newContext.clearCookies();
      return me.user.email;
    })(),
  );
  await memberPage
    .getByLabel("密码", { exact: true })
    .fill("Test-learner-12345");
  await memberPage
    .getByRole("button", { name: "进入资料中心", exact: true })
    .click();
  await memberPage.getByRole("button", { name: "已完成", exact: true }).click();
  await memberPage.getByText("学习状态已保存", { exact: true }).waitFor();
  assert.ok(memberPage.url().includes(`node=${second}`));
  assert.equal(
    (
      await (
        await newContext.request.get(`${base}/api/roadmaps/${id}/progress`)
      ).json()
    ).progress.states[first],
    "idle",
  );
  await newContext.close();
  check("member deep-link login and progress isolation");
  for (const width of [1440, 768, 360]) {
    await page.setViewportSize({ width, height: 1050 });
    await page.goto(base + "/roadmaps");
    await inspect("list", width);
    await page.goto(`${base}/roadmaps/${id}?node=${first}`);
    await inspect("reader", width);
    await page.goto(`${base}/roadmaps/${id}/edit`);
    await inspect("editor", width);
  }
  check("three pages at desktop, tablet and mobile with accessibility audit");
  // Full mobile edit and publication with form-based prerequisite controls.
  await page.getByRole("button", { name: "添加节点", exact: true }).click();
  await page.getByLabel("节点标题").fill("手机新增节点");
  await choose("添加前置节点", "C / C++ 与开发环境");
  await saved();
  await page.getByRole("button", { name: "发布更新", exact: true }).click();
  await visible(page.getByRole("button", { name: "分享路线", exact: true }));
  check("mobile node creation, prerequisite form and publication");
  await page.getByRole("link", { name: "编辑路线", exact: true }).click();
  await page.getByRole("button", { name: "管理员下架", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await visible(page.getByRole("button", { name: "恢复路线", exact: true }));
  assert.equal(
    await page
      .getByRole("button", { name: "发布更新", exact: true })
      .isDisabled(),
    true,
  );
  await page.getByRole("button", { name: "恢复路线", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await visible(page.getByRole("button", { name: "管理员下架", exact: true }));
  check("administrator hide and restore");
  await page.getByRole('button',{name:'撤回发布',exact:true}).click();await page.getByRole('alertdialog').getByRole('button',{name:'确认',exact:true}).click();await visible(page.getByRole('button',{name:'发布路线',exact:true}));assert.equal((await context.request.get(`${base}/api/roadmaps/${id}`)).status(),404);
  await page.getByRole('button',{name:'发布路线',exact:true}).click();await visible(page.getByRole('button',{name:'分享路线',exact:true}));
  await page.getByRole('button',{name:'复制',exact:true}).click();await visible(page.getByRole('heading',{name:'编排学习路线'}));const copiedId=new URL(page.url()).pathname.split('/')[2];assert.notEqual(copiedId,id);await page.getByRole('button',{name:'删除路线',exact:true}).click();await page.getByRole('alertdialog').getByRole('button',{name:'确认',exact:true}).click();await visible(page.getByRole('button',{name:'创建路线',exact:true}));assert.equal((await context.request.get(`${base}/api/roadmaps/${copiedId}/draft`)).status(),404);
  check('withdrawal, republish, route copy and permanent deletion');
  const fallbackContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await fallbackContext.addCookies(await context.cookies());
  const fallback = await fallbackContext.newPage();
  await fallback.route("**/assets/Canvas-*.js", (r) => r.abort());
  await fallback.route('**/api/resources',r=>r.abort());
  await fallback.goto(`${base}/roadmaps/${id}`);
  await fallback
    .getByRole("button", { name: "使用阶段清单", exact: true })
    .click();
  await fallback.locator(".road-checklist").waitFor();
  await fallback.getByRole("button", { name: "学习中", exact: true }).click();
  await fallback.getByText("学习状态已保存", { exact: true }).waitFor();
  await fallbackContext.close();
  check("canvas chunk failure leaves reading and progress usable");
  assert.deepEqual(errors, []);
  writeFileSync(
    "artifacts/roadmaps/checks.json",
    JSON.stringify({ checks, results, errors }, null, 2),
  );
  console.log(
    `${checks.length} roadmap browser groups passed; ${results.length} responsive audits passed`,
  );
} catch (e) {
  await page.screenshot({
    path: "artifacts/roadmaps/failure.png",
    fullPage: true,
  });
  writeFileSync(
    "artifacts/roadmaps/checks.json",
    JSON.stringify({ checks, results, errors, failure: e.message }, null, 2),
  );
  throw e;
} finally {
  await browser.close();
  server?.kill();
}
