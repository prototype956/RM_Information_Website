import test from "node:test";
import assert from "node:assert/strict";
import { classifyArea, riskForText, isIssueReady, classifyPaths, canActorImplement, canAutoMerge, slugify } from "../scripts/ai/policy.mjs";

test("empty issue enters needs-info", () => {
  assert.equal(isIssueReady({ title: "修复按钮", body: "" }), false);
});

test("roadmap centering issue asks for interaction details", () => {
  const title = "修复 roadmap 左键强制将节点移到中心的问题";
  const area = classifyArea(title, "");
  assert.equal(area, "roadmap");
  assert.equal(isIssueReady({ title, body: "" }), false);
});

test("roadmap arrange issue is not ready without repro", () => {
  const title = "修复 roadmap 一键整理的抽风的bug";
  assert.equal(classifyArea(title, ""), "roadmap");
  assert.equal(isIssueReady({ title, body: "节点会乱跳，请修复" }), false);
});

test("release issue is a high risk product decision", () => {
  const title = "网站版本更新太频繁了";
  assert.equal(classifyArea(title, ""), "release");
  assert.equal(riskForText(title, "", "release"), "high");
  assert.equal(isIssueReady({ title, body: "希望稳定生产版本，预览环境单独更新。验收：生产不自动更新。" }), false);
});

test("L0 CSS change can be eligible for auto merge", () => {
  assert.equal(classifyPaths(["src/styles/app.css"]).level, "L0");
  assert.equal(canAutoMerge({
    paths: ["src/styles/app.css"],
    labels: ["risk:low", "ai:reviewed"],
    checks: ["success"],
    issueReady: true,
    headRepoMatches: true
  }), true);
});

test("L1 roadmap change never auto merges", () => {
  assert.equal(classifyPaths(["src/roadmaps/graph.js"]).level, "L1");
  assert.equal(canAutoMerge({
    paths: ["src/roadmaps/graph.js"],
    labels: ["risk:medium", "ai:reviewed"],
    checks: ["success"],
    issueReady: true,
    headRepoMatches: true
  }), false);
});

test("protected paths reject auto merge", () => {
  assert.equal(classifyPaths(["server/index.js"]).protected, true);
  assert.equal(classifyPaths([".github/workflows/x.yml"]).autoMerge, false);
});

test("only trusted actor can implement", () => {
  assert.equal(canActorImplement({ association: "MEMBER", login: "maintainer" }, "someone"), true);
  assert.equal(canActorImplement({ association: "NONE", login: "reporter" }, "reporter"), true);
  assert.equal(canActorImplement({ association: "NONE", login: "stranger" }, "reporter"), false);
});

test("issue branch slug is stable", () => {
  assert.equal(slugify("Fix Button / Focus"), "fix-button-focus");
});
