export const emptyTaxonomy = {
  revision: 0,
  domains: [],
  categories: [],
  tags: [],
  aliases: [],
};
export const normalized = (name) => name.trim().normalize("NFKC").toLowerCase();
export function resolveOption(taxonomy, kind, value, parent = "") {
  const rows =
    taxonomy[
      kind === "category"
        ? "categories"
        : kind === "domain"
          ? "domains"
          : "tags"
    ];
  if (!value) return "";
  const direct = rows.find(
    (x) =>
      x.id === value ||
      ((!parent || x.parent_id === parent) &&
        normalized(x.name) === normalized(value)),
  );
  if (direct) return direct.id;
  const alias = taxonomy.aliases.find(
    (a) =>
      a.kind === kind &&
      (!parent || a.parent_id === parent) &&
      a.name === normalized(value),
  );
  return alias?.target_id || value;
}
export function defaultSelection(taxonomy) {
  const domain =
    taxonomy.domains.find(
      (d) =>
        d.id === "rm" && taxonomy.categories.some((c) => c.parent_id === d.id),
    ) ||
    taxonomy.domains.find((d) =>
      taxonomy.categories.some((c) => c.parent_id === d.id),
    );
  const category =
    taxonomy.categories.find(
      (c) => c.parent_id === domain?.id && c.name === "电控与嵌入式",
    ) || taxonomy.categories.find((c) => c.parent_id === domain?.id);
  return {
    domain: domain?.id || "",
    categoryId: category?.id || "",
    category: category?.name || "",
    tagIds: [],
    tags: [],
  };
}
export function resolveClassification(
  taxonomy,
  domainValue = "",
  categoryValue = "",
) {
  const category = resolveOption(
    taxonomy,
    "category",
    categoryValue,
    domainValue,
  );
  const selected = taxonomy.categories.find((c) => c.id === category);
  return {
    domain: domainValue
      ? selected?.parent_id || resolveOption(taxonomy, "domain", domainValue)
      : "",
    category,
  };
}
