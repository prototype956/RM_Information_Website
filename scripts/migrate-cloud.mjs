// Read credentials from stdin. They are never persisted with the export or source.
import { DatabaseSync } from "node:sqlite";
import {
  readFileSync,
  existsSync,
  createReadStream,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { resolve, basename, join } from "node:path";
import { createHash } from "node:crypto";
let input = "";
for await (const chunk of process.stdin) input += chunk;
const { url, token, sitesToken } = JSON.parse(input),
  origin = new URL(url).origin;
const headers = {
  authorization: "Bearer " + token,
  "OAI-Sites-Authorization": "Bearer " + sitesToken,
};
const db = new DatabaseSync("data/resources.db", { readOnly: true });
const tables = [
  "users",
  "invitations",
  "resources",
  "attachments",
  "favorites",
  "recent",
  "roadmaps",
  "roadmap_progress",
  "taxonomy_options",
  "taxonomy_meta",
  "taxonomy_aliases",
  "taxonomy_requests",
];
db.exec("BEGIN");
const data = Object.fromEntries(
  tables.map((table) => [table, db.prepare(`SELECT * FROM ${table}`).all()]),
);
db.exec("COMMIT");
db.close();
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const report = {
  createdAt: new Date().toISOString(),
  counts: Object.fromEntries(tables.map((t) => [t, data[t].length])),
  files: [],
};
for (const file of data.attachments) {
  if (basename(file.storage_key) !== file.storage_key)
    throw Error("Invalid stored file path");
  const path = resolve("data/files", file.storage_key);
  if (!existsSync(path)) throw Error("Missing original attachment");
  const bytes = readFileSync(path);
  report.files.push({ id: file.id, size: bytes.length, sha256: sha(bytes) });
  const r = await fetch(
    origin + "/_migration/file/" + encodeURIComponent(file.storage_key),
    {
      method: "PUT",
      headers: { ...headers, "content-length": String(bytes.length) },
      body: bytes,
      redirect: "error",
    },
  );
  if (!r.ok)
    throw Error(
      `File import failed ${r.status}: ${(await r.text()).slice(0, 300)}`,
    );
}
const result = await fetch(origin + "/_migration/import", {
  method: "POST",
  headers: { ...headers, "content-type": "application/json" },
  body: JSON.stringify(data),
  redirect: "error",
});
if (!result.ok)
  throw Error(
    `Import failed ${result.status}: ${(await result.text()).slice(0, 300)}`,
  );
report.result = await result.json();
mkdirSync("artifacts/cloud", { recursive: true });
writeFileSync(
  "artifacts/cloud/migration-report.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report));
