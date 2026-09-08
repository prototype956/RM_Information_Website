import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import AxeBuilder from "@axe-core/playwright";
let server,
  base = process.env.TEST_URL;
mkdirSync("artifacts/requests", { recursive: true });
if (!base) {
  mkdirSync("artifacts/qa-data", { recursive: true });
  const data = mkdtempSync(resolve("artifacts/qa-data/requests-"));
  server = spawn(process.execPath, ["server/index.js", "--production"], {
    env: { ...process.env, PORT: "0", DATA_DIR: data },
    stdio: ["ignore", "pipe", "inherit"],
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
}
assert.notEqual(new URL(base).port, "5173");
const browser = await chromium.launch({ channel: "chrome", headless: true }),
  admin = await browser.newContext({
    viewport: { width: 1440, height: 1050 },
    reducedMotion: "reduce",
  }),
  member = await browser.newContext({
    viewport: { width: 1440, height: 1050 },
    reducedMotion: "reduce",
  }),
  ap = await admin.newPage(),
  mp = await member.newPage(),
  checks = [],
  audits = [],
  errors = [];
for (const p of [ap, mp]) p.on("pageerror", (e) => errors.push(e.message));
const visible = (l) => l.waitFor({ state: "visible", timeout: 12000 }),
  check = (n) => {
    checks.push(n);
    console.log("PASS " + n);
  };
const get = async (c, url) => (await c.request.get(base + "/api" + url)).json();
const row = (p, name) =>
  p
    .locator(".request-row")
    .filter({
      has: p
        .locator("strong")
        .filter({ hasText: new RegExp("^" + name + "$") }),
    });
async function choose(p, label, name) {
  await p.getByRole("combobox", { name: label, exact: true }).click();
  await p.getByRole("option", { name, exact: true }).click();
}
async function inspect(p, name, width) {
  await p.evaluate(() => document.fonts.ready);
  await visible(p.locator("main h1"));
  const sizes = await p.evaluate(() => ({
    width: innerWidth,
    scroll: document.documentElement.scrollWidth,
    small: [...document.querySelectorAll('main button,[role="dialog"] button')]
      .filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width && r.height && (r.width < 43 || r.height < 43);
      })
      .map((e) => e.textContent),
  }));
  assert.equal(sizes.scroll, width);
  assert.deepEqual(sizes.small, []);
  const r = await new AxeBuilder({ page: p })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  assert.deepEqual(r.violations, [], JSON.stringify(r.violations));
  await p.screenshot({
    path: `artifacts/requests/${name}-${width}.png`,
    fullPage: true,
  });
  audits.push({ name, width });
}
try {
  const setup = (await get(admin, "/auth/status")).setupNeeded;
  await admin.request.post(base + "/api/auth/" + (setup ? "setup" : "login"), {
    data: {
      name: "审核管理员",
      email: "qa-admin@example.test",
      password: "Local-test-password-123",
      examples: false,
    },
  });
  const invitation = await (
    await admin.request.post(base + "/api/invitations", { data: {} })
  ).json();
  await member.request.post(base + "/api/auth/register", {
    data: {
      name: "申请成员",
      email: `requests-${Date.now()}@example.test`,
      password: "Local-test-password-123",
      token: invitation.token,
    },
  });
  await mp.goto(base + "/resources/new");
  await visible(mp.getByLabel("资料标题", { exact: false }));
  await mp
    .getByLabel("资料标题", { exact: false })
    .fill("申请过程中保留的资料草稿");
  await mp
    .getByRole("combobox", { name: "标签", exact: true })
    .fill("审核后可用标签");
  await mp.getByRole("combobox", { name: "标签", exact: true }).press("Enter");
  await visible(mp.getByRole("dialog", { name: "申请新增选项" }));
  await mp
    .getByRole("dialog")
    .getByLabel("申请说明")
    .fill("用于新队员入门学习");
  await mp
    .getByRole("dialog")
    .getByRole("button", { name: "提交申请", exact: true })
    .click();
  await visible(
    mp.getByText("申请已提交，尚未添加到当前内容。审核通过后可选择。"),
  );
  assert.equal(
    await mp.getByLabel("资料标题", { exact: false }).inputValue(),
    "申请过程中保留的资料草稿",
  );
  assert.equal(
    (await get(member, "/taxonomy")).tags.some(
      (t) => t.name === "审核后可用标签",
    ),
    false,
  );
  assert.equal(
    await mp.getByRole("button", { name: "移除标签 审核后可用标签" }).count(),
    0,
  );
  check(
    "inline tag request preserves resource draft and does not select pending tag",
  );
  await mp.getByRole("button", { name: "找不到分类？申请新增" }).click();
  await mp.getByRole("dialog").getByLabel("申请名称").fill("新队员控制课程");
  await mp.getByRole("button", { name: "提交申请", exact: true }).click();
  await visible(mp.getByText("申请已提交，审核通过后可选择。"));
  await mp.goto(base + "/requests");
  await visible(row(mp, "审核后可用标签"));
  await visible(row(mp, "新队员控制课程"));
  check("inline category request and member status page");
  await ap.goto(base + "/admin/taxonomy/requests");
  await visible(row(ap, "审核后可用标签"));
  await row(ap, "审核后可用标签")
    .getByRole("button", { name: "通过", exact: true })
    .click();
  await ap
    .getByRole("dialog")
    .getByLabel("审核说明")
    .fill("命名明确，批准使用");
  await ap.getByRole("button", { name: "确认通过", exact: true }).click();
  await row(ap, "审核后可用标签").waitFor({ state: "hidden" });
  await row(ap, "新队员控制课程")
    .getByRole("button", { name: "通过", exact: true })
    .click();
  await ap.getByRole("button", { name: "确认通过", exact: true }).click();
  await row(ap, "新队员控制课程").waitFor({ state: "hidden" });
  await mp.getByRole("button", { name: "刷新申请" }).click();
  await visible(row(mp, "审核后可用标签").getByText("已通过", { exact: true }));
  await visible(
    row(mp, "审核后可用标签").getByText("审核说明：命名明确，批准使用"),
  );
  await mp.goto(base + "/resources/new");
  await choose(mp, "课程 / 技术方向", "新队员控制课程");
  await mp
    .getByRole("combobox", { name: "标签", exact: true })
    .fill("审核后可用标签");
  await mp.getByRole("combobox", { name: "标签", exact: true }).press("Enter");
  await visible(mp.getByRole("button", { name: "移除标签 审核后可用标签" }));
  check(
    "admin approval creates selectable options and member sees reviewer feedback",
  );
  await mp.goto(base + "/requests");
  await mp.getByRole("button", { name: "申请新增选项", exact: true }).click();
  await choose(mp, "申请类型", "标签");
  await mp.getByRole("dialog").getByLabel("申请名称").fill("名称不清楚");
  await mp.getByRole("button", { name: "提交申请", exact: true }).click();
  await visible(row(mp, "名称不清楚"));
  await ap.getByRole("button", { name: "刷新申请" }).click();
  await row(ap, "名称不清楚")
    .getByRole("button", { name: "驳回", exact: true })
    .click();
  await ap.getByRole("button", { name: "确认驳回", exact: true }).click();
  assert.equal(
    await ap
      .getByRole("dialog")
      .getByLabel("审核说明")
      .evaluate((e) => e.validity.valueMissing),
    true,
  );
  await ap
    .getByRole("dialog")
    .getByLabel("审核说明")
    .fill("请具体说明技术方向");
  await ap.getByRole("button", { name: "确认驳回", exact: true }).click();
  await ap.getByRole("dialog").waitFor({ state: "hidden" });
  await mp.getByRole("button", { name: "刷新申请" }).click();
  await visible(
    row(mp, "名称不清楚").getByText("审核说明：请具体说明技术方向"),
  );
  assert.equal(
    (await get(member, "/taxonomy")).tags.some((t) => t.name === "名称不清楚"),
    false,
  );
  check("rejection requires reason and never creates an option");
  await mp.getByRole("button", { name: "申请新增选项", exact: true }).click();
  await mp.getByRole("dialog").getByLabel("申请名称").fill("可撤回课程");
  await mp.getByRole("button", { name: "提交申请", exact: true }).click();
  await row(mp, "可撤回课程").getByRole("button", { name: "撤回申请" }).click();
  await mp.keyboard.press("Escape");
  await mp.getByRole("dialog").waitFor({ state: "hidden" });
  await mp.waitForFunction(
    () => document.activeElement?.textContent === "撤回申请",
  );
  await row(mp, "可撤回课程").getByRole("button", { name: "撤回申请" }).click();
  await mp.getByRole("button", { name: "确认撤回", exact: true }).click();
  await visible(row(mp, "可撤回课程").getByText("已撤回", { exact: true }));
  check("member withdrawal, Escape and focus restoration");
  await mp.getByRole("button", { name: "申请新增选项", exact: true }).click();
  await mp.getByRole("dialog").getByLabel("申请名称").fill("失败后重试课程");
  await mp.route("**/api/taxonomy/requests", (r) =>
    r.request().method() === "POST" ? r.abort() : r.continue(),
  );
  await mp.getByRole("button", { name: "提交申请", exact: true }).click();
  await visible(mp.getByRole("dialog").getByRole("alert"));
  assert.equal(
    await mp.getByRole("dialog").getByLabel("申请名称").inputValue(),
    "失败后重试课程",
  );
  await mp.unroute("**/api/taxonomy/requests");
  await mp.getByRole("button", { name: "提交申请", exact: true }).click();
  await visible(row(mp, "失败后重试课程"));
  check("failed submission retains fields and retry succeeds");
  for (const width of [1440, 768, 360]) {
    await ap.setViewportSize({ width, height: 1050 });
    await mp.setViewportSize({ width, height: 1050 });
    await ap.goto(base + "/admin/taxonomy/requests");
    await visible(row(ap, "失败后重试课程"));
    await inspect(ap, "review", width);
    await mp.goto(base + "/requests");
    await visible(row(mp, "失败后重试课程"));
    await inspect(mp, "mine", width);
    await mp.getByRole("button", { name: "申请新增选项", exact: true }).click();
    await mp.getByRole("dialog").getByLabel("申请名称").fill("响应式申请表单");
    await inspect(mp, "request-dialog", width);
    await mp.keyboard.press("Escape");
  }
  check(
    "request list, review queue and dialog at three widths with accessibility audit",
  );
  await mp.goto(base + "/admin/taxonomy/requests");
  await visible(mp.getByRole("heading", { name: "需要管理员权限" }));
  assert.deepEqual(errors, []);
  writeFileSync(
    "artifacts/requests/results.json",
    JSON.stringify({ checks, audits, errors }, null, 2),
  );
  console.log(
    `${checks.length} request browser groups; ${audits.length} responsive audits`,
  );
} catch (e) {
  await mp.screenshot({
    path: "artifacts/requests/member-failure.png",
    fullPage: true,
  });
  await ap.screenshot({
    path: "artifacts/requests/admin-failure.png",
    fullPage: true,
  });
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
  server?.kill();
}
