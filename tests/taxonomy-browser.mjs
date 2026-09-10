import AxeBuilder from "@axe-core/playwright";
import { blankRoadmap } from "../shared/roadmap.js";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

// Browser plugin not available: use the project's existing Playwright/Chrome stack.
// Isolated database and screenshots live outside the source checkout.
const data = mkdtempSync(path.join(tmpdir(), "rm-taxonomy-ui-"));
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

  const get = async (p) => (await admin.request.get(base + "/api" + p)).json();
  const add = async (kind, name, parentId = "") => {
    const r = await admin.request.post(base + "/api/taxonomy/options", {
      data: {
        kind,
        name,
        parentId,
        revision: (await get("/taxonomy")).revision,
      },
    });
    assert.equal(r.status(), 201);
    return (await r.json()).option;
  };
  for (let i = 0; i < 23; i++)
    await add("tag", "标签" + String(i).padStart(2, "0"));
  for (const [label, viewport] of [
    ["desktop", { width: 1440, height: 1000 }],
    ["mobile", { width: 390, height: 844 }],
  ]) {
    const page = await admin.newPage();
    await page.setViewportSize(viewport);
    page.on("pageerror", (e) => errors.push(e.message));
    const d1 = await add("domain", label + "资料库甲"),
      d2 = await add("domain", label + "资料库乙");
    const c = await add("category", label + "分类一", d1.id);
    await add("category", label + "分类二", d1.id);
    for(let i=0;i<21;i++) {
      const r=await admin.request.post(base+'/api/resources',{multipart:{title:label+'资料'+i,domain:d1.id,categoryId:c.id,tagIds:'[]',kind:'link',url:'https://example.org',description:'验证内容分页'}});
      assert.equal(r.status(),201);const resource=await r.json();
      if(i===0)await admin.request.patch(base+'/api/resources/'+resource.id,{data:{hidden:true}});
    }
    const doc=blankRoadmap({domain:d1.id,categoryId:c.id,tagIds:[]});doc.title=label+'草稿路线';
    assert.equal((await admin.request.post(base+'/api/roadmaps',{data:{document:doc}})).status(),201);
    const row = (id) => page.locator('[data-option-id="' + id + '"]');
    const dialog = () => page.getByRole("dialog");
    const choose = async (name, value) => {
      await dialog().getByRole("combobox", { name, exact: true }).click();
      await page.getByRole("option", { name: value, exact: true }).click();
    };
    const shot = async (name) => {
      const audit=await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21aa"]).analyze();assert.deepEqual(audit.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[]);
      await page.evaluate(() => {
        document.activeElement?.blur();
        window.scrollTo(0, 0);
      });
      await page.screenshot({
        path: path.join(output, label + "-" + name + ".png"),
        fullPage: true,
      });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
    };
    await page.goto(base + "/admin/taxonomy");
    await visible(row(d1.id));
    await row(d1.id)
      .getByRole("button", { name: "上移 " + d1.name, exact: true })
      .click();
    await visible(page.getByText("顺序已更新", { exact: true }));
    let domains = (await get("/taxonomy")).domains;
    assert.equal(
      domains.findIndex((d) => d.id === d1.id) + 2,
      domains.findIndex((d) => d.id === d2.id),
    );
    await page.getByRole("button", { name: "新建资料库", exact: true }).click();
    await dialog()
      .getByLabel("名称", { exact: true })
      .fill(label + "取消新建");
    await dialog().getByRole("button", { name: "取消", exact: true }).click();
    assert.ok(
      !(await get("/taxonomy")).domains.some(
        (d) => d.name === label + "取消新建",
      ),
    );
    await page
      .getByRole("textbox", { name: "搜索目录" })
      .fill(label + "分类一");
    await visible(
      row(c.id).or(
        page.getByRole("button", {
          name: d1.name + " / " + c.name,
          exact: true,
        }),
      ),
    );
    assert.equal(
      await page
        .getByRole("button", { name: "上移 " + c.name, exact: true })
        .isDisabled(),
      true,
    );
    await page
      .getByRole("button", { name: d1.name + " / " + c.name, exact: true })
      .click();
    await visible(page.getByRole("heading", { name: c.name, exact: true }));
    await visible(page.locator('.tm-content .taxonomy-row').first());assert.equal(await page.locator('.tm-content .taxonomy-row').count(),20);
    await page.locator('.tm-content').getByRole('button',{name:'下一页',exact:true}).click();await visible(page.locator('.tm-content').getByText('2 / 2 · 共 21 条',{exact:true}));await page.waitForFunction(()=>document.querySelectorAll('.tm-content .taxonomy-row').length===1);
    await page.locator('.tm-content').getByRole('button',{name:'学习路线',exact:true}).click();await visible(page.locator('.tm-content').getByText('草稿',{exact:true}));await shot('content');
    await page
      .locator(".tm-breadcrumb")
      .getByRole("button", { name: d1.name, exact: true })
      .click();
    await page.getByRole("button", { name: "新增分类", exact: true }).click();
    await dialog()
      .getByLabel("名称", { exact: true })
      .fill(label + "新增分类");
    await dialog().getByRole("button", { name: "保存", exact: true }).click();
    await dialog().waitFor({ state: "hidden" });
    await visible(
      page.getByRole("heading", { name: label + "新增分类", exact: true }),
    );
    const added = (await get("/taxonomy")).categories.find(
      (o) => o.name === label + "新增分类",
    );
    await page
      .locator(".tm-selected")
      .getByRole("button", { name: "移动分类", exact: true })
      .click();
    await choose("目标资料库", d2.name);
    await dialog()
      .getByRole("button", { name: "确认移动", exact: true })
      .click();
    await dialog().waitFor({ state: "hidden" });
    assert.equal(
      (await get("/taxonomy")).categories.find((o) => o.id === added.id)
        .parent_id,
      d2.id,
    );
    await page
      .locator(".tm-selected")
      .getByRole("button", { name: "重命名", exact: true })
      .click();
    await dialog()
      .getByLabel("名称", { exact: true })
      .fill(label + "重命名");
    await add("tag", label + "并发标签");
    await dialog().getByRole("button", { name: "保存", exact: true }).click();
    await visible(
      dialog()
        .getByText(/更新|刷新/)
        .first(),
    );
    await dialog()
      .getByRole("button", { name: "刷新选项与影响范围", exact: true })
      .click();
    assert.equal(
      await dialog().getByLabel("名称", { exact: true }).inputValue(),
      label + "重命名",
    );
    await dialog().getByRole("button", { name: "保存", exact: true }).click();
    await dialog().waitFor({ state: "hidden" });
    await page
      .locator(".tm-breadcrumb")
      .getByRole("button", { name: d2.name, exact: true })
      .click();
    await page
      .locator(".tm-selected")
      .getByRole("button", { name: "删除", exact: true })
      .click();
    await visible(dialog().getByRole("button", { name: "改为合并" }));
    assert.equal(
      await dialog()
        .getByRole("button", { name: "确认删除", exact: true })
        .isDisabled(),
      true,
    );
    await shot("nonempty-delete");
    await dialog().getByRole("button", { name: "取消", exact: true }).click();
    await page
      .locator(".tm-breadcrumb")
      .getByRole("button", { name: "全部资料库", exact: true })
      .click();
    await shot("directory");
    await row(d2.id).getByRole("button", { name: "合并", exact: true }).click();
    await choose("合并到", d1.name);
    await visible(dialog().getByText(/移动为/));
    await shot("merge");
    await dialog()
      .getByRole("button", { name: "确认合并", exact: true })
      .click();
    await dialog().waitFor({ state: "hidden" });
    assert.ok(!(await get("/taxonomy")).domains.some((o) => o.id === d2.id));
    await page.getByRole("tab", { name: "标签管理", exact: true }).click();
    await visible(page.getByRole("button", { name: "下一页", exact: true }));
    assert.equal(await page.locator(".tm-option").count(), 20);
    await page.getByRole("button", { name: "下一页", exact: true }).click();
    assert.ok((await page.locator(".tm-option").count()) > 0);
    await page.getByRole("textbox", { name: "搜索标签" }).fill("标签00");
    assert.equal(await page.locator(".tm-option").count(), 1);
    const tag = (await get("/taxonomy")).tags.find((o) => o.name === "标签00");
    await row(tag.id)
      .getByRole("button", { name: "0 份资料", exact: true })
      .click();
    await visible(
      page.getByRole("heading", { name: "标签00 · 关联内容", exact: true }),
    );
    await page.route("**/api/taxonomy/options/" + tag.id, (route) =>
      route.request().method() === "DELETE"
        ? route.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({ error: "测试删除失败，请重试" }),
          })
        : route.continue(),
    );
    await row(tag.id)
      .getByRole("button", { name: "删除", exact: true })
      .click();
    await dialog()
      .getByRole("button", { name: "确认删除", exact: true })
      .click();
    await visible(dialog().getByText("测试删除失败，请重试", { exact: true }));
    await shot("delete-error");
    await page.unroute("**/api/taxonomy/options/" + tag.id);
    let release;
    const held = new Promise((r) => {
      release = r;
    });
    let count = 0;
    await page.route("**/api/taxonomy/options/" + tag.id, async (route) => {
      if (route.request().method() === "DELETE") {
        count++;
        await held;
      }
      await route.continue();
    });
    await dialog()
      .getByRole("button", { name: "确认删除", exact: true })
      .click();
    assert.equal(
      await dialog()
        .getByRole("button", { name: "正在处理…", exact: true })
        .isDisabled(),
      true,
    );
    assert.equal(
      await dialog()
        .getByRole("button", { name: "取消", exact: true })
        .isDisabled(),
      true,
    );
    release();
    await dialog().waitFor({ state: "hidden" });
    assert.equal(count, 1);
    await page.unroute("**/api/taxonomy/options/" + tag.id);
    await add("tag", "标签00");
    await page.getByRole("button", { name: "刷新", exact: true }).click();
    await page.getByRole("textbox", { name: "搜索标签" }).fill("");
    await shot("tags");
    await page
      .getByRole("combobox", { name: "标签使用情况", exact: true })
      .click();
    await page.getByRole("option", { name: "未使用", exact: true }).click();
    await page.getByRole("combobox", { name: "标签排序", exact: true }).click();
    await page
      .getByRole("option", { name: "按使用量排序", exact: true })
      .click();
    await page.route("**/api/taxonomy/usage", (r) =>
      r.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "测试统计读取失败" }),
      }),
    );
    await page.getByRole("button", { name: "刷新", exact: true }).click();
    await visible(page.getByText("测试统计读取失败", { exact: true }));
    await page.unroute("**/api/taxonomy/usage");
    await page.getByRole("button", { name: "刷新", exact: true }).click();
    await page
      .getByText("测试统计读取失败", { exact: true })
      .waitFor({ state: "hidden" });
    assert.equal(await page.locator("vite-error-overlay").count(), 0);
    await page.close();
    console.log(
      "PASS " +
        label +
        " directory, operations, tags, conflict, recovery, responsive",
    );
  }
  assert.deepEqual(errors, []);
  console.log("Screenshots: " + output);
} finally {
  await browser?.close();
  server.kill();
}
