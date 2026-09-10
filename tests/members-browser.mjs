import { passwordHash } from "../cloud/auth.js";
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
const data = mkdtempSync(path.join(tmpdir(), "rm-members-"));
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
  const fixtureDb = new DatabaseSync(path.join(data, "resources.db"));
  const storedPassword = passwordHash(password);
  for (let i = 1; i <= 24; i++)
    fixtureDb
      .prepare(
        "INSERT INTO users(id,name,email,password,role) VALUES(?,?,?,?,?)",
      )
      .run(
        "member-" + i,
        "队员" + String(i).padStart(2, "0"),
        "member" + i + "@example.test",
        storedPassword,
        "member",
      );
  const seedInvite = (id, used, expires) =>
    fixtureDb
      .prepare(
        "INSERT INTO invitations(id,token_hash,created_by,expires,used) VALUES(?,?,?,?,?)",
      )
      .run(
        id,
        createHash("sha256").update(id).digest("hex"),
        "qa",
        expires,
        used,
      );
  for (const [label, viewport] of [
    ["desktop", { width: 1440, height: 1000 }],
    ["mobile", { width: 390, height: 844 }],
  ]) {
    const page = await admin.newPage();
    await page.setViewportSize(viewport);
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (msg) => {
      if (
        ["error", "warning"].includes(msg.type()) &&
        !msg.text().includes("Failed to load resource")
      )
        errors.push(msg.text());
    });
    const prefix = label + "-";
    seedInvite(prefix + "used", 1, Date.now() + 86400000);
    seedInvite(prefix + "expired", 0, Date.now() - 1000);
    seedInvite(prefix + "revoked", 0, 0);
    seedInvite(prefix + "missing", 1, Date.now() + 86400000);
    seedInvite(prefix + "valid", 0, Date.now() + 86400000);
    await page.goto(base + "/admin");
    assert.equal(await page.title(), "RM · 资料中心");
    await page.route("**/api/members", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "测试成员加载失败" }),
      }),
    );
    await page.getByRole("tab", { name: "成员列表", exact: true }).click();
    await visible(page.getByText("测试成员加载失败", { exact: true }));
    await page.unroute("**/api/members");
    await page.getByRole("button", { name: "重新加载成员" }).click();
    const table = page.getByRole("table", { name: "队伍成员" });
    await visible(table);
    await visible(
      page.getByText("共 25 位成员 · 当前匹配 25 位", { exact: true }),
    );
    assert.equal(await table.locator("tbody tr").count(), 20);
    const first = await table.locator("tbody tr").allTextContents();
    await page.getByRole("button", { name: "下一页", exact: true }).click();
    const second = await table.locator("tbody tr").allTextContents();
    assert.equal(second.length, 5);
    assert.equal(new Set([...first, ...second]).size, 25);
    await page
      .getByLabel("搜索成员", { exact: true })
      .fill("MEMBER24@EXAMPLE.TEST");
    assert.equal(await table.locator("tbody tr").count(), 1);
    await visible(page.getByText("第 1 / 1 页", { exact: true }));
    await page.getByLabel("搜索成员", { exact: true }).fill("不存在的队员");
    await visible(page.getByRole("heading", { name: "没有找到匹配的成员" }));
    await page.getByLabel("搜索成员", { exact: true }).fill("");
    await page.getByRole("combobox", { name: "角色", exact: true }).click();
    await page.getByRole("option", { name: "管理员", exact: true }).click();
    assert.equal(await table.locator("tbody tr").count(), 1);
    await visible(table.getByText("当前账号", { exact: true }));
    await visible(page.getByText("第 1 / 1 页", { exact: true }));
    await page.getByRole("combobox", { name: "角色", exact: true }).click();
    await page.getByRole("option", { name: "普通成员", exact: true }).click();
    await visible(
      page.getByText("共 25 位成员 · 当前匹配 24 位", { exact: true }),
    );
    await page.getByRole("button", { name: "下一页", exact: true }).click();
    await page.getByRole("combobox", { name: "角色", exact: true }).click();
    await page.getByRole("option", { name: "全部角色", exact: true }).click();
    await visible(page.getByText("第 1 / 2 页", { exact: true }));
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      "member list page overflow",
    );
    assert.equal(await page.locator("vite-error-overlay").count(), 0);
    await page.evaluate(() => {
      document.activeElement?.blur();
      window.scrollTo(0, 0);
    });
    await page.screenshot({
      path: path.join(output, "members-" + label + ".png"),
      fullPage: true,
    });
    await page.getByRole("tab", { name: "成员邀请", exact: true }).click();
    const row = (id) =>
      page.locator('[data-invitation-id="' + prefix + id + '"]');
    await visible(row("used"));
    assert.equal(
      await row("valid")
        .getByRole("button", { name: "删除记录", exact: true })
        .count(),
      0,
    );
    await visible(
      row("valid").getByRole("button", { name: "撤销", exact: true }),
    );
    await row("revoked")
      .getByRole("button", { name: "删除记录", exact: true })
      .click();
    const dialog = page.getByRole("alertdialog");
    await visible(dialog);
    await dialog.getByRole("button", { name: "保留记录" }).click();
    await visible(row("revoked"));
    assert.ok(
      fixtureDb
        .prepare("SELECT id FROM invitations WHERE id=?")
        .get(prefix + "revoked"),
    );
    for (const state of ["used", "expired", "revoked"]) {
      await row(state)
        .getByRole("button", { name: "删除记录", exact: true })
        .click();
      await visible(dialog);
      if (state === "used") {
        let release;
        const gate = new Promise((resolve) => (release = resolve));
        await page.route(
          "**/api/invitations/" + prefix + state + "/record",
          async (route) => {
            await gate;
            await route.fulfill({
              status: 500,
              contentType: "application/json",
              body: JSON.stringify({ error: "测试删除失败，请重试" }),
            });
          },
        );
        await dialog
          .getByRole("button", { name: "确认删除", exact: true })
          .click();
        await visible(
          dialog.getByRole("button", { name: "正在删除…", exact: true }),
        );
        assert.equal(
          await dialog
            .getByRole("button", { name: "正在删除…", exact: true })
            .isDisabled(),
          true,
        );
        assert.equal(
          await dialog.getByRole("button", { name: "保留记录" }).isDisabled(),
          true,
        );
        release();
        await visible(
          dialog.getByText("测试删除失败，请重试", { exact: true }),
        );
        assert.ok(
          fixtureDb
            .prepare("SELECT id FROM invitations WHERE id=?")
            .get(prefix + state),
        );
        await page.unroute("**/api/invitations/" + prefix + state + "/record");
        await page.screenshot({
          path: path.join(output, "invitation-delete-" + label + ".png"),
          fullPage: false,
        });
      }
      await dialog
        .getByRole("button", { name: "确认删除", exact: true })
        .click();
      await dialog.waitFor({ state: "hidden" });
      assert.equal(await row(state).count(), 0);
      assert.equal(
        fixtureDb
          .prepare("SELECT id FROM invitations WHERE id=?")
          .get(prefix + state),
        undefined,
      );
    }
    await row("missing")
      .getByRole("button", { name: "删除记录", exact: true })
      .click();
    assert.equal(
      (
        await admin.request.delete(
          base + "/api/invitations/" + prefix + "missing/record",
        )
      ).status(),
      200,
    );
    await dialog.getByRole("button", { name: "确认删除", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(await row("missing").count(), 0);
    await row("valid")
      .getByRole("button", { name: "撤销", exact: true })
      .click();
    await visible(
      row("valid").getByRole("button", { name: "删除记录", exact: true }),
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      "invite page overflow",
    );
    console.log(
      "PASS " +
        label +
        ": all 25 members, search, role filters, pagination reset, load retry, confirm/cancel, duplicate prevention, delete retry, missing record, revoke",
    );
    await page.close();
  }
  const member = await browser.newContext();
  await member.request.post(base + "/api/auth/login", {
    data: { email: "member1@example.test", password },
  });
  const memberPage = await member.newPage();
  await memberPage.goto(base + "/admin");
  await visible(memberPage.getByRole("heading", { name: "需要管理员权限" }));
  assert.equal((await member.request.get(base + "/api/members")).status(), 403);
  fixtureDb.close();
  assert.deepEqual(errors, []);
  console.log(
    "PASS permissions, page identity, no framework overlay or application console errors",
  );
  console.log("QA URL: " + base + "; screenshots: " + output);
} finally {
  await browser?.close();
  server.kill();
}
