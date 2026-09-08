export const states = {
  idle: "未开始",
  learning: "学习中",
  completed: "已完成",
};
export const uid = () => crypto.randomUUID();
export const blankRoadmap = (classification = {}) => ({
  title: "未命名学习路线",
  description: "",
  ...classification,
  stages: [{ id: uid(), title: "入门基础" }],
  nodes: [],
  edges: [],
});
export function graphError(nodes, edges) {
  const ids = new Set(nodes.map((n) => n.id)),
    seen = new Set(),
    next = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target))
      return "连线引用了不存在的节点";
    if (e.source === e.target) return "节点不能连接自己";
    const key = `${e.source}:${e.target}`;
    if (seen.has(key)) return "不能重复连接相同节点";
    seen.add(key);
    next.get(e.source).push(e.target);
  }
  const visited = new Set(),
    active = new Set();
  function visit(id) {
    if (active.has(id)) return true;
    if (visited.has(id)) return false;
    active.add(id);
    if (next.get(id).some(visit)) return true;
    active.delete(id);
    visited.add(id);
    return false;
  }
  return nodes.some((n) => visit(n.id))
    ? "前置关系不能形成循环，请调整连线"
    : "";
}
export function progressSummary(doc, values = {}) {
  const required = doc.nodes.filter((n) => n.required),
    optional = doc.nodes.filter((n) => !n.required);
  const done = (nodes) =>
    nodes.filter((n) => values[n.id] === "completed").length;
  return {
    required: required.length,
    completed: done(required),
    optional: optional.length,
    optionalCompleted: done(optional),
    totalCompleted: done(doc.nodes),
    total: doc.nodes.length,
    percent: required.length
      ? Math.round((done(required) / required.length) * 100)
      : null,
  };
}
