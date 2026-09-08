// One-time schema conversion: reads column/index definitions, never data rows.
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
const db = new DatabaseSync("data/resources.db", { readOnly: true });
const tables = [
  "users",
  "sessions",
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
let source =
  "import {sql} from 'drizzle-orm';\nimport {sqliteTable,text,integer,primaryKey,index,uniqueIndex,check} from 'drizzle-orm/sqlite-core';\n";
for (const table of tables) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all(),
    foreign = db.prepare(`PRAGMA foreign_key_list(${table})`).all(),
    primary = columns.filter((c) => c.pk).sort((a, b) => a.pk - b.pk);
  const fields = columns.map((c) => {
    let out = `${JSON.stringify(c.name)}: ${c.type === "INTEGER" ? "integer" : "text"}(${JSON.stringify(c.name)})`;
    if (primary.length === 1 && c.pk) out += ".primaryKey()";
    if (c.notnull) out += ".notNull()";
    if (c.dflt_value !== null)
      out += `.default(sql.raw(${JSON.stringify(c.dflt_value)}))`;
    const f = foreign.find((f) => f.from === c.name);
    if (f)
      out += `.references(()=>${f.table}[${JSON.stringify(f.to)}],{onDelete:${JSON.stringify(f.on_delete.toLowerCase())}})`;
    return out;
  });
  const indexes = [];
  if (primary.length > 1)
    indexes.push(
      `primaryKey({columns:[${primary.map((c) => `t[${JSON.stringify(c.name)}]`).join(",")}]})`,
    );
  for (const idx of db.prepare(`PRAGMA index_list(${table})`).all()) {
    if (idx.origin === "pk") continue;
    const cols = db
      .prepare(`PRAGMA index_info(${JSON.stringify(idx.name)})`)
      .all();
    const name = idx.name.startsWith("sqlite_autoindex")
      ? `uq_${table}_${cols.map((c) => c.name).join("_")}`
      : idx.name;
    let expression = `${idx.unique ? "uniqueIndex" : "index"}(${JSON.stringify(name)}).on(${cols.map((c) => `t[${JSON.stringify(c.name)}]`).join(",")})`;
    if (idx.partial) {
      const sql = db
        .prepare("SELECT sql FROM sqlite_master WHERE name=?")
        .get(idx.name).sql;
      expression += `.where(sql.raw(${JSON.stringify(sql.split(/ WHERE /i)[1])}))`;
    }
    indexes.push(expression);
  }
  if (table === "taxonomy_meta")
    indexes.push("check('taxonomy_singleton',sql.raw('id=1'))");
  source += `export const ${table}=sqliteTable(${JSON.stringify(table)},{${fields.join(",\n")}},t=>[${indexes.join(",\n")}]);\n`;
}
source +=
  "export const cloud_revision=sqliteTable('cloud_revision',{id:integer('id').primaryKey(),revision:integer('revision').notNull()},t=>[check('cloud_singleton',sql.raw('id=1'))]);\nexport const cloud_auth_limits=sqliteTable('cloud_auth_limits',{key:text('key').notNull(),window:integer('window').notNull(),count:integer('count').notNull()},t=>[primaryKey({columns:[t.key,t.window]})]);\n";
fs.mkdirSync("db", { recursive: true });
fs.writeFileSync("db/schema.ts", source);
db.close();
