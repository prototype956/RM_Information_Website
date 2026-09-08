import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import AxeBuilder from "@axe-core/playwright";
let server,
  base = process.env.TEST_URL;
mkdirSync("artifacts/taxonomy", { recursive: true });
if (!base) {
  mkdirSync("artifacts/qa-data", { recursive: true });
  const data = mkdtempSync(resolve("artifacts/qa-data/taxonomy-"));
  server = spawn(process.execPath, ["server/index.js", "--production"], {
    env: { ...process.env, DATA_DIR: data, PORT: "0" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("startup timeout")), 15000);
    server.stdout.on("data", (c) => {
      const m = c.toString().match(/http:\/\/127\.0\.0\.1:\d+/);
      if (m) {
        clearTimeout(timer);
        resolve(m[0]);
      }
    });
    server.once("error", reject);
  });
}
assert.notEqual(new URL(base).port, "5173");
const browser = await chromium.launch({ channel: "chrome", headless: true }),
  context = await browser.newContext({
    viewport: { width: 1440, height: 1050 },
    reducedMotion: "reduce",
  }),
  page = await context.newPage(),
  checks = [],
  audits = [],
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const visible = (l) => l.waitFor({ state: "visible", timeout: 12000 });
const check = (n) => {
  checks.push(n);
  console.log("PASS " + n);
};
const get = async (url) =>
  (await context.request.get(base + "/api" + url)).json();
async function choose(label, name, root = page) {
  await root.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name, exact: true }).click();
}
const dialog = () => page.getByRole("dialog");
const row = (name) =>
  page
    .locator(".taxonomy-row")
    .filter({
      has: page
        .locator("strong")
        .filter({ hasText: new RegExp("^" + name + "$") }),
    });
async function inspect(name, width) {
  await page.evaluate(() => document.fonts.ready);
  await visible(page.getByRole("heading", { level: 1 }));
  const geometry = await page.evaluate(() => ({
    width: innerWidth,
    scroll: document.documentElement.scrollWidth,
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
        label: e.getAttribute("aria-label"),
        width: e.getBoundingClientRect().width,
        height: e.getBoundingClientRect().height,
      })),
  }));
  assert.equal(geometry.scroll, width, JSON.stringify(geometry));
  assert.deepEqual(geometry.small, [], JSON.stringify(geometry));
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  assert.deepEqual(axe.violations, [], JSON.stringify(axe.violations));
  await page.screenshot({
    path: `artifacts/taxonomy/${name}-${width}.png`,
    fullPage: true,
  });
  audits.push({ name, width, violations: axe.violations.length });
}
try {
  const setup = (await get("/auth/status")).setupNeeded;
  if (setup)
    await context.request.post(base + "/api/auth/setup", {
      data: {
        name: "本地测试管理员",
        email: "qa-admin@example.test",
        password: "Local-test-password-123",
        examples: false,
      },
    });
  else
    await context.request.post(base + "/api/auth/login", {
      data: {
        email: "qa-admin@example.test",
        password: "Local-test-password-123",
      },
    });
  await page.goto(base + "/admin/taxonomy");
  await visible(page.getByRole("heading", { name: "分类与标签管理" }));
  const add = page.getByRole("button", { name: "新增资料库", exact: true });
  await add.click();
  await dialog().getByLabel("名称", { exact: true }).fill("UI 测试库");
  await page.keyboard.press("Escape");
  await dialog().waitFor({ state: "hidden" });
  await page.waitForFunction(() =>
    document.activeElement?.textContent.includes("新增资料库"),
  );
  await add.click();
  await dialog().getByLabel("名称", { exact: true }).fill("UI 测试库");
  await page.keyboard.press("Shift+Tab");
  assert.equal(
    await page.evaluate(
      () => !!document.activeElement?.closest('[role="dialog"]'),
    ),
    true,
  );
  await dialog().getByRole("button", { name: "保存选项" }).click();
  await visible(row("UI 测试库"));
  check("admin creates library; dialog focus trap, Escape and restoration");
  await page.getByRole("tab", { name: "课程／技术方向", exact: true }).click();
  await page.getByRole("button", { name: "新增课程／技术方向" }).click();
  await dialog().getByLabel("名称", { exact: true }).fill("UI 控制基础");
  await choose("所属资料库", "UI 测试库", dialog());
  await dialog().getByRole("button", { name: "保存选项" }).click();
  await visible(row("UI 控制基础"));
  let t = await get("/taxonomy");
  const domain = t.domains.find((d) => d.name === "UI 测试库"),
    category = t.categories.find((c) => c.name === "UI 控制基础");
  await page.goto(base + "/resources/new");
  await visible(page.getByLabel("资料标题", { exact: false }));
  await choose("所属资料库", "UI 测试库");
  await choose("课程 / 技术方向", "UI 控制基础");
  await page.getByRole("tab", { name: "分享链接" }).click();
  await page
    .getByLabel("资料标题", { exact: false })
    .fill("标签选择器验证资料");
  await page
    .getByLabel("资料链接", { exact: false })
    .fill("https://example.org");
  const tagInput = page.getByRole("combobox", { name: "标签", exact: true });
  await tagInput.fill("复用标签，批量标签");
  await tagInput.press("Enter");
  await visible(page.getByRole("button", { name: "移除标签 复用标签" }));
  await visible(page.getByRole("button", { name: "移除标签 批量标签" }));
  await tagInput.fill("提交时创建");
  await page.getByRole("button", { name: "发布资料", exact: true }).click();
  await visible(
    page.getByRole("heading", { name: "标签选择器验证资料", exact: true }),
  );
  const resourceId = page.url().split("/").pop();
  assert.equal(
    (await get("/resources/" + resourceId)).resource.tagIds.length,
    3,
  );
  check(
    "dynamic upload fields, batch tags and pending input committed on publish",
  );
  await page.goto(base + "/roadmaps");
  await page.getByRole("button", { name: "创建路线", exact: true }).click();
  await page.waitForURL("**/edit");
  const roadmapId = page.url().split("/").at(-2);
  await page.getByLabel("路线标题", { exact: true }).fill("可复用标签学习路线");
  await choose("资料领域", "UI 测试库");
  await page.waitForFunction(
    () =>
      document.querySelector(".road-save-status")?.textContent ===
      "请选择路线分类",
  );
  await choose("路线分类", "UI 控制基础");
  await page
    .getByRole("combobox", { name: "标签", exact: true })
    .fill("复用标签");
  await page
    .getByRole("combobox", { name: "标签", exact: true })
    .press("Enter");
  await visible(page.getByRole("button", { name: "移除标签 复用标签" }));
  await page.getByRole("button", { name: "添加节点", exact: true }).click();
  await page.getByLabel("节点标题").fill("基础实践");
  await page
    .getByRole("combobox", { name: "标签", exact: true })
    .fill("路线发布标签");
  await page.getByRole("button", { name: "发布路线", exact: true }).click();
  await visible(page.getByRole("button", { name: "分享路线", exact: true }));
  const published = await get("/roadmaps/" + roadmapId);
  assert.deepEqual(published.document.tags, ["复用标签", "路线发布标签"]);
  t = await get("/taxonomy");
  assert.equal(t.tags.filter((x) => x.name === "复用标签").length, 1);
  const tag = t.tags.find((x) => x.name === "复用标签");
  check(
    "roadmap reuses tags and publishes pending input; incomplete category does not lock autosave",
  );
  await page.goto(base + "/admin/taxonomy");
  await page.getByRole("tab", { name: "课程／技术方向", exact: true }).click();
  await row("UI 控制基础")
    .getByRole("button", { name: "编辑", exact: true })
    .click();
  await dialog().getByLabel("名称", { exact: true }).fill("UI 控制进阶");
  await dialog().getByRole("button", { name: "保存选项" }).click();
  await visible(row("UI 控制进阶"));
  await page.goto(
    base +
      `/resources?domain=${domain.id}&category=${encodeURIComponent("UI 控制基础")}`,
  );
  await visible(page.getByText("标签选择器验证资料", { exact: true }));
  assert.equal(
    (await get("/resources/" + resourceId)).resource.category,
    "UI 控制进阶",
  );
  assert.equal(
    (await get("/roadmaps/" + roadmapId)).document.category,
    "UI 控制进阶",
  );
  check(
    "rename updates resources and published roadmaps; old name URL remains valid",
  );
  await page.goto(base + "/admin/taxonomy");
  await page.getByRole("tab", { name: "标签", exact: true }).click();
  await row("复用标签")
    .getByRole("button", { name: "合并／删除", exact: true })
    .click();
  await visible(dialog().getByText("引用：1 份资料、1 条路线、0 个下属分类。"));
  await choose("合并到标签", "批量标签", dialog());
  await dialog().getByRole("button", { name: "迁移并删除" }).click();
  await dialog().waitFor({ state: "hidden" });
  assert.equal(
    (await get("/resources/" + resourceId)).resource.tags.filter(
      (x) => x === "批量标签",
    ).length,
    1,
  );
  await page.goto(base + `/roadmaps?tag=${tag.id}`);
  await visible(page.getByRole("heading", { name: "可复用标签学习路线" }));
  check(
    "tag merge shows reference counts, deduplicates and preserves old filter URLs",
  );
  await page.goto(base + "/admin/taxonomy");
  await page.getByRole("tab", { name: "课程／技术方向", exact: true }).click();
  await row("UI 控制进阶")
    .getByRole("button", { name: "删除", exact: true })
    .click();
  assert.equal(
    await dialog().getByRole("button", { name: "确认删除" }).isDisabled(),
    true,
  );
  await choose("迁移目标", "RM 学习 / 通用工具", dialog());
  await dialog().getByRole("button", { name: "迁移并删除" }).click();
  await dialog().waitFor({ state: "hidden" });
  assert.equal(
    (await get("/resources/" + resourceId)).resource.category,
    "通用工具",
  );
  assert.equal(
    (await get("/roadmaps/" + roadmapId)).document.category,
    "通用工具",
  );
  check(
    "used category deletion requires migration target and updates both content types",
  );
  await page.getByRole("tab", { name: "资料库", exact: true }).click();
  await row("UI 测试库")
    .getByRole("button", { name: "编辑", exact: true })
    .click();
  await dialog().getByLabel("名称", { exact: true }).fill("UI 过期修改");
  await context.request.post(base + "/api/taxonomy/tags", {
    data: { name: "其他窗口新增" },
  });
  await dialog().getByRole("button", { name: "保存选项" }).click();
  await visible(dialog().getByText("选项已被其他人更新，请刷新管理页面后重试"));
  assert.equal(
    await dialog().getByLabel("名称", { exact: true }).inputValue(),
    "UI 过期修改",
  );
  await dialog().getByRole("button", { name: "读取最新选项" }).click();
  await dialog().getByRole("button", { name: "保存选项" }).click();
  await visible(row("UI 过期修改"));
  check("concurrent taxonomy edit retains form and offers explicit retry");
  for (const width of [1440, 768, 360]) {
    await page.setViewportSize({ width, height: 1050 });
    await page.goto(base + "/admin/taxonomy");
    await inspect("manager", width);
    await page.goto(base + `/resources/${resourceId}/edit`);
    await visible(page.getByRole("button", { name: "移除标签 批量标签" }));
    await inspect("resource-tags", width);
    await page.goto(base + `/roadmaps/${roadmapId}/edit`);
    await visible(page.getByLabel("路线标题", { exact: true }));
    await inspect("roadmap-tags", width);
  }
  check(
    "manager and both tag forms: desktop, tablet, mobile and accessibility",
  );
  await page.setViewportSize({ width: 360, height: 1050 });
  await page.goto(base + "/resources/" + resourceId + "/edit");
  await page.route("**/api/taxonomy/tags", (r) => r.abort());
  const input = page.getByRole("combobox", { name: "标签", exact: true });
  await input.fill("失败重试标签");
  await input.press("Enter");
  await visible(page.locator('.tag-picker [role="alert"]'));
  assert.equal(await input.inputValue(), "失败重试标签");
  await page.unroute("**/api/taxonomy/tags");
  await input.press("Enter");
  await visible(page.getByRole("button", { name: "移除标签 失败重试标签" }));
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  await visible(
    page.getByRole("heading", { name: "标签选择器验证资料", exact: true }),
  );
  check("tag creation failure retains input and retry works on mobile");
  const invite = await (
    await context.request.post(base + "/api/invitations", { data: {} })
  ).json();
  const mc = await browser.newContext();
  await mc.request.post(base + "/api/auth/register", {
    data: {
      name: "测试成员",
      email: `taxonomy-${Date.now()}@example.test`,
      password: "Local-test-password-123",
      token: invite.token,
    },
  });
  const mp = await mc.newPage();
  await mp.goto(base + "/admin/taxonomy");
  await visible(mp.getByRole("heading", { name: "需要管理员权限" }));
  await mp.goto(base + "/resources/new");
  await mp
    .getByRole("combobox", { name: "标签", exact: true })
    .fill("成员新标签");
  await mp.getByRole("combobox", { name: "标签", exact: true }).press("Enter");
  await visible(mp.getByRole("dialog", {name:"申请新增选项"}));
  await mp.getByRole("button", {name:"提交申请",exact:true}).click();
  await visible(mp.getByText("申请已提交，尚未添加到当前内容。审核通过后可选择。"));
  assert.equal(await mp.getByRole("button", {name:"移除标签 成员新标签"}).count(),0);
  await mc.close();
  check("members request new tags and cannot bypass category management");
  assert.deepEqual(errors, []);
  writeFileSync(
    "artifacts/taxonomy/results.json",
    JSON.stringify({ checks, audits, errors }, null, 2),
  );
  console.log(
    `${checks.length} taxonomy browser groups; ${audits.length} responsive audits`,
  );
} catch (e) {
  await page.screenshot({
    path: "artifacts/taxonomy/failure.png",
    fullPage: true,
  });
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
  server?.kill();
}
