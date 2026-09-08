export const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
export const parse = (value) =>
  typeof value === "string" ? JSON.parse(value) : value;
export const fold = (value) => value.trim().normalize("NFKC").toLowerCase();

// A request reads from the primary. Mutations commit together and reject stale
// reads, including races between taxonomy changes and content publication.
export async function database(binding) {
  const db = binding.withSession
    ? binding.withSession("first-primary")
    : binding;
  const stmt = (sql, args = []) => db.prepare(sql).bind(...args);
  const all = async (sql, ...args) => (await stmt(sql, args).all()).results;
  const get = (sql, ...args) => stmt(sql, args).first();
  const revision = (await get("SELECT revision FROM cloud_revision WHERE id=1"))
    ?.revision;
  const pending = [];
  return {
    all,
    get,
    revision,
    run: (sql, ...args) => pending.push(stmt(sql, args)),
    async commit() {
      if (!pending.length) return;
      if (revision === undefined) fail(503, "网站资料正在迁移，请稍后再试");
      try {
        await db.batch([
          stmt(
            "UPDATE cloud_revision SET revision=CASE WHEN revision=? THEN revision+1 ELSE NULL END WHERE id=1",
            [revision],
          ),
          ...pending,
        ]);
      } catch (error) {
        if (String(error).includes("cloud_revision.revision"))
          fail(409, "内容刚刚发生变化，请重试；当前编辑内容已保留");
        throw error;
      }
      pending.length = 0;
    },
  };
}
