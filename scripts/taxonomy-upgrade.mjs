import { DatabaseSync, backup } from "node:sqlite";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const dir = path.resolve("artifacts/taxonomy-upgrade");
mkdirSync(dir, { recursive: true });
const mode = process.argv[2];
assert.ok(["before", "after"].includes(mode));
const db = new DatabaseSync(path.resolve("data/resources.db"), {
  readOnly: true,
});
const digest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const info = (rows) => ({ count: rows.length, sha256: digest(rows) });
const result = {};
for (const table of [
  "users",
  "sessions",
  "invitations",
  "attachments",
  "favorites",
  "roadmap_progress",
])
  result[table] = info(
    db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
  );
result.resources = info(
  db
    .prepare(
      "SELECT id,title,domain,category,tags,kind,url,description,owner_id,created_at,updated_at,sample,hidden FROM resources ORDER BY id",
    )
    .all(),
);
const original = (raw) => {
  if (!raw) return null;
  const d = JSON.parse(raw);
  const { categoryId, tagIds, domainName, tags, ...content } = d;
  return content;
};
result.roadmaps = info(
  db
    .prepare(
      "SELECT id,owner_id,draft,published,hidden,created_at,updated_at,published_at FROM roadmaps ORDER BY id",
    )
    .all()
    .map((r) => ({
      ...r,
      draft: original(r.draft),
      published: original(r.published),
    })),
);
result.files = info(
  readdirSync("data/files")
    .sort()
    .map((name) => ({
      name,
      hash: createHash("sha256")
        .update(readFileSync(path.join("data/files", name)))
        .digest("hex"),
    })),
);
if (mode === "before") {
  const target = path.join(dir, "resources-before-taxonomy.db");
  assert.equal(existsSync(target), false, "Backup exists; do not overwrite");
  await backup(db, target);
  writeFileSync(path.join(dir, "before.json"), JSON.stringify(result, null, 2));
} else {
  assert.deepEqual(
    result,
    JSON.parse(readFileSync(path.join(dir, "before.json"), "utf8")),
    "Original content changed during migration",
  );
  const integrity = db.prepare("PRAGMA integrity_check").get();
  assert.equal(integrity.integrity_check, "ok");
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  writeFileSync(
    path.join(dir, "after.json"),
    JSON.stringify({ ...result, integrity: "ok", preserved: true }, null, 2),
  );
}
db.close();
console.log(
  JSON.stringify({
    mode,
    counts: Object.fromEntries(
      Object.entries(result).map(([k, v]) => [k, v.count]),
    ),
    ...(mode === "after" ? { preserved: true } : {}),
  }),
);
