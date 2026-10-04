const PROTECTED_PATHS = [
  ".github/",
  "AGENTS.md",
  "package.json",
  "package-lock.json",
  "db/",
  "drizzle/",
  "server/",
  "cloud/",
  "wrangler.jsonc"
];

const LEVELS = {
  L0: ["src/**/*.css", "src/components/ui/**"],
  L1: ["src/pages/**", "src/roadmaps/**", "src/components/**"],
  L2: ["server/**", "cloud/**", "db/**", "drizzle/**"],
  L3: [".github/**", "package.json", "package-lock.json", "wrangler.jsonc", "AGENTS.md"]
};

function normalise(value) {
  return String(value || "").replaceAll("\\\\", "/").replace(/^\\.\\//, "");
}

export function slugify(value) {
  const slug = normalise(value).toLowerCase().replace(/[^a-z0-9\\u4e00-\\u9fff]+/g, "-").replace(/^-+|-+$/g, "");
  return slug.slice(0, 48) || "issue";
}

export function matchesGlob(file, pattern) {
  const path = normalise(file);
  if (pattern.endsWith("/**")) return path === pattern.slice(0, -3) || path.startsWith(pattern.slice(0, -2));
  if (pattern === "src/**/*.css") return path.startsWith("src/") && path.endsWith(".css");
  if (pattern === "src/components/ui/**") return path.startsWith("src/components/ui/");
  if (pattern === "src/pages/**") return path.startsWith("src/pages/");
  if (pattern === "src/roadmaps/**") return path.startsWith("src/roadmaps/");
  if (pattern === "src/components/**") return path.startsWith("src/components/");
  return path === pattern;
}

export function isProtectedPath(file) {
  const path = normalise(file);
  return PROTECTED_PATHS.some((pattern) => pattern.endsWith("/") ? path === pattern.slice(0, -1) || path.startsWith(pattern) : path === pattern);
}

export function classifyPaths(paths) {
  const files = (paths || []).map(normalise);
  if (files.some(isProtectedPath)) return { level: "L3", autoMerge: false, protected: true, files };
  for (const level of ["L2", "L1", "L0"]) {
    if (files.some((file) => LEVELS[level].some((pattern) => matchesGlob(file, pattern)))) {
      const outside = files.filter((file) => !LEVELS[level].some((pattern) => matchesGlob(file, pattern)));
      return { level, autoMerge: level === "L0" && outside.length === 0, protected: false, outside, files };
    }
  }
  return { level: "L3", autoMerge: false, protected: true, outside: files, files };
}

export function classifyArea(title, body) {
  const text = (String(title || "") + "\\n" + String(body || "")).toLowerCase();
  if (/release|发布|版本|deploy|部署|production|生产/.test(text)) return "release";
  if (/server|api|接口|登录|认证|权限|upload|上传|database|数据库|d1|r2/.test(text)) return "backend";
  if (/roadmap|路线|节点|整理|拖拽|学习资料/.test(text)) return "roadmap";
  if (/data|数据|taxonomy|分类/.test(text)) return "data";
  return "ui";
}

export function riskForText(title, body, area = classifyArea(title, body)) {
  const text = (String(title || "") + "\\n" + String(body || "")).toLowerCase();
  if (area === "release" || /auth|认证|permission|权限|database|数据库|migration|迁移|production|生产|secret|密钥/.test(text)) return "high";
  if (area === "backend" || area === "data" || /breaking|兼容|依赖|dependency|package/.test(text)) return "high";
  if (area === "roadmap" || /interaction|交互|动画|keyboard|键盘|mobile|移动端/.test(text)) return "medium";
  if (/css|style|样式|button|按钮|copy|文案|color|颜色|spacing|间距/.test(text)) return "low";
  return "medium";
}

export function isIssueReady(issue) {
  const title = String(issue?.title || "").trim();
  const body = String(issue?.body || "").trim();
  if (!title || body.length < 40) return false;
  const area = issue.area || classifyArea(title, body);
  if (area === "release") return false;
  if (area === "roadmap" || area === "backend" || area === "data") {
    if (!/acceptance|验收|expected|预期|目标行为|完成条件/i.test(body)) return false;
  }
  if (/bug|错误|修复|broken|问题/i.test(title + " " + body) && !/steps|复现|repro|actual|实际|expected|预期/i.test(body)) return false;
  return true;
}

export function canActorImplement(actor, issueAuthor) {
  const association = String(actor?.association || actor?.author_association || "").toUpperCase();
  const login = String(actor?.login || actor?.user?.login || "");
  const author = String(issueAuthor?.login || issueAuthor || "");
  return ["OWNER", "MEMBER", "COLLABORATOR"].includes(association) || (login && author && login === author);
}

export function canAutoMerge({ paths = [], labels = [], checks = [], aiFindings = [], unresolvedThreads = 0, issueReady = false, headRepoMatches = false, additions = 0, changedFiles = paths.length } = {}) {
  const result = classifyPaths(paths);
  const names = labels.map((label) => typeof label === "string" ? label : label.name);
  const checksPass = checks.every((check) => ["success", "neutral", "skipped"].includes(check));
  const cleanAi = aiFindings.every((finding) => !/\\bP[01]\\b|BLOCKING/i.test(String(finding)));
  return result.level === "L0" && result.autoMerge && !result.protected &&
    names.includes("risk:low") && names.includes("ai:reviewed") &&
    checksPass && cleanAi && unresolvedThreads === 0 && issueReady &&
    headRepoMatches && additions <= 500 && changedFiles <= 12;
}

export { LEVELS, PROTECTED_PATHS };
