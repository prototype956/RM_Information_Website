import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { chromium } from "playwright-core";

// Browser plugin not available: use the project's existing Playwright/Chrome stack.
// Isolated database and screenshots live outside the source checkout.
const data = mkdtempSync(path.join(tmpdir(), "rm-registration-"));
const output = process.env.QA_OUTPUT || data;
mkdirSync(output, { recursive: true });
const server = spawn(process.execPath, ["server/index.js", "--production"], {
  env: {
    ...process.env,
    NODE_ENV: "production",
    HOST: "127.0.0.1",
    PORT: "0",
    DATA_DIR: data,
  },
  stdio: ["ignore", "pipe", "inherit"],
});
let browser;
const errors = [];
const password = "Registration-test-12345";
const visible = (locator) =>
  locator.waitFor({ state: "visible", timeout: 12000 });
try {
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error("QA server startup timed out")),
      15000,
    );
    server.stdout.on("data", (chunk) => {
      const match = chunk.toString().match(/http:[/][/]127[.]0[.]0[.]1:[0-9]+/);
      if (match) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    });
    server.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    server.once("exit", (code) => {
      clearTimeout(timer);
      reject(Error("QA server exited: " + code));
    });
  });
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const admin = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const setup = await admin.request.post(base + "/api/auth/setup", {
    data: {
      name: "测试管理员",
      email: "admin@example.test",
      password,
      examples: false,
    },
  });
  assert.equal(setup.status(), 201);
  await admin.addInitScript(() => localStorage.setItem("rm-motion", "off"));
  const adminPage = await admin.newPage();
  adminPage.on("pageerror", (e) => errors.push(e.message));
  await adminPage.goto(base + "/admin");
  await adminPage
    .getByRole("button", { name: "创建邀请码", exact: true })
    .click();
  await visible(adminPage.getByLabel("新邀请码", { exact: true }));
  const code = await adminPage
    .getByLabel("新邀请码", { exact: true })
    .inputValue();
  const join = await adminPage.getByLabel("新邀请链接").inputValue();
  assert.match(code, /^[0-9A-HJKMNP-TV-Z]{12}$/);
  assert.equal(join, base + "/join/" + code);
  await adminPage
    .getByRole("button", { name: "复制邀请码", exact: true })
    .click();
  assert.equal(
    await adminPage.evaluate(() => navigator.clipboard.readText()),
    code,
  );
  await adminPage
    .getByRole("button", { name: "复制链接", exact: true })
    .click();
  assert.equal(
    await adminPage.evaluate(() => navigator.clipboard.readText()),
    join,
  );
  await adminPage.screenshot({
    path: path.join(output, "invitations-desktop.png"),
    fullPage: true,
  });
  const create = async () =>
    (
      await (
        await admin.request.post(base + "/api/invitations", { data: {} })
      ).json()
    ).token;
  for (const [label, viewport] of [
    ["desktop", { width: 1440, height: 1000 }],
    ["mobile", { width: 390, height: 844 }],
  ]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (msg) => {
      if (
        ["error", "warning"].includes(msg.type()) &&
        !msg.text().includes("Failed to load resource")
      )
        errors.push(msg.text());
    });
    await page.goto(base + "/login");
    assert.equal(await page.title(), "RM · 资料中心");
    await visible(page.getByRole("heading", { name: "欢迎回来，队友。" }));
    await page.getByLabel("邮箱", { exact: true }).fill("missing@example.test");
    await page.getByLabel("密码", { exact: true }).fill(password);
    await page
      .getByRole("button", { name: "进入资料中心", exact: true })
      .click();
    await visible(page.getByText("邮箱或密码不正确", { exact: true }));
    await page.getByRole("link", { name: "注册账号", exact: true }).click();
    await page.waitForURL(base + "/register");
    assert.equal(
      await page.getByLabel("密码", { exact: true }).inputValue(),
      "",
    );
    assert.equal(await page.locator("#auth-error").count(), 0);
    await page.getByLabel("你的姓名").fill("注册测试队员");
    await page
      .getByLabel("邮箱", { exact: true })
      .fill(label + "@example.test");
    await page.getByLabel("密码", { exact: true }).fill(password);
    await page.getByRole("link", { name: "已有账号？去登录" }).click();
    await page.waitForURL(base + "/login");
    assert.equal(
      await page.getByLabel("密码", { exact: true }).inputValue(),
      "",
    );
    assert.equal(
      await page.getByLabel("邮箱", { exact: true }).inputValue(),
      label + "@example.test",
    );
    await page.getByRole("link", { name: "注册账号", exact: true }).click();
    await page.waitForURL(base + "/register");
    await page.getByLabel("密码", { exact: true }).fill(password);
    const submit = page.getByRole("button", {
      name: "注册并进入资料中心",
      exact: true,
    });
    await submit.click();
    assert.equal(
      await page
        .getByLabel("邀请码", { exact: true })
        .evaluate((e) => e.validity.valueMissing),
      true,
    );
    await page.getByLabel("邀请码", { exact: true }).fill("INVALID-CODE");
    await submit.click();
    await visible(page.getByText("邀请已失效或已被使用", { exact: true }));
    const invitation = label === "desktop" ? code : await create();
    await page
      .getByLabel("邀请码", { exact: true })
      .fill("  " + invitation.toLowerCase() + "  ");
    await page.getByLabel("邮箱", { exact: true }).fill("admin@example.test");
    await submit.click();
    await visible(page.getByText("该邮箱已注册，请登录", { exact: true }));
    await visible(page.getByRole("link", { name: "已有账号？去登录" }));
    await page
      .getByLabel("邮箱", { exact: true })
      .fill(label + "@example.test");
    await page.getByLabel("邀请码", { exact: true }).fill(invitation);
    await page.evaluate(() => document.activeElement?.blur());
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    assert.equal(await page.locator("vite-error-overlay").count(), 0);
    await page.screenshot({
      path: path.join(output, "register-" + label + ".png"),
      fullPage: true,
    });
    await submit.click();
    await page.waitForURL(base + "/");
    await visible(page.getByRole("button", { name: "账号菜单" }));
    await page.getByRole("button", { name: "账号菜单" }).click();
    await page.getByRole("menuitem", { name: "退出登录" }).click();
    await visible(page.getByRole("heading", { name: "欢迎回来，队友。" }));
    await page
      .getByLabel("邮箱", { exact: true })
      .fill(label + "@example.test");
    await page.getByLabel("密码", { exact: true }).fill(password);
    await page
      .getByRole("button", { name: "进入资料中心", exact: true })
      .click();
    await visible(page.getByRole("button", { name: "账号菜单" }));
    await page.goto(base + "/join/" + invitation);
    await visible(
      page.getByText("邀请已失效或已被使用，请联系管理员重新邀请", {
        exact: true,
      }),
    );
    assert.equal(
      await page.getByLabel("邀请码", { exact: true }).inputValue(),
      invitation,
    );
    await page.getByLabel("邀请码", { exact: true }).fill(await create());
    await page.getByLabel("你的姓名").fill("纠正邀请后加入");
    await page
      .getByLabel("邮箱", { exact: true })
      .fill("corrected-" + label + "@example.test");
    await page.getByLabel("密码", { exact: true }).fill(password);
    await submit.click();
    await page.waitForURL(base + "/");
    console.log(
      "PASS " +
        label +
        ": login/register, required code, invalid/duplicate recovery, auto-login, logout/login, used-link correction, layout",
    );
    await context.close();
  }
  const legacy = "abcdef0123456789".repeat(3);
  const fixtureDb = new DatabaseSync(path.join(data, "resources.db"));
  fixtureDb
    .prepare(
      "INSERT INTO invitations(id,token_hash,created_by,expires) VALUES(?,?,?,?)",
    )
    .run(
      "legacy-browser",
      createHash("sha256").update(legacy).digest("hex"),
      "qa",
      Date.now() + 86400000,
    );
  fixtureDb.close();
  const guest = await browser.newContext();
  const page = await guest.newPage();
  await page.goto(base + "/join/" + legacy);
  assert.equal(
    await page.getByLabel("邀请码", { exact: true }).inputValue(),
    legacy,
  );
  await page.getByLabel("你的姓名").fill("旧邀请队员");
  await page
    .getByLabel("邮箱", { exact: true })
    .fill("legacy-browser@example.test");
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "注册并进入资料中心" }).click();
  await page.waitForURL(base + "/");
  await page.goto(base + "/join/" + (await create()));
  await page.getByLabel("你的姓名").fill("新链接队员");
  await page
    .getByLabel("邮箱", { exact: true })
    .fill("short-link@example.test");
  await page.getByLabel("密码", { exact: true }).fill(password);
  assert.match(
    await page.getByLabel("邀请码", { exact: true }).inputValue(),
    /^[0-9A-HJKMNP-TV-Z]{12}$/,
  );
  await page.getByRole("button", { name: "注册并进入资料中心" }).click();
  await page.waitForURL(base + "/");
  assert.deepEqual(errors, []);
  console.log(
    "PASS legacy invite link, clipboard actions, page identity, no overflow/overlay/runtime errors",
  );
  console.log("QA URL: " + base + "; screenshots: " + output);
} finally {
  await browser?.close();
  server.kill();
}
