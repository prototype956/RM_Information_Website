import React, { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  Tag,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { useApp } from "../context";
import { api, send } from "../api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "../components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../components/ui/dialog";
import { Field, Choice, ErrorBox, Empty, AppLink } from "../components/shared";
import "./taxonomy.css";
const labels = { domain: "资料库", category: "分类", tag: "标签" };
const actions = {
  add: "新增",
  rename: "重命名",
  move: "移动",
  merge: "合并",
  delete: "删除",
};
const fold = (s) => s.trim().normalize("NFKC").toLowerCase();
function Pages({ page, total, onChange }) {
  const pages = Math.max(1, Math.ceil(total / 20));
  return (
    <div className="request-pagination">
      <Button
        variant="outline"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        上一页
      </Button>
      <span>
        {page} / {pages} · 共 {total} 条
      </span>
      <Button
        variant="outline"
        disabled={page >= pages}
        onClick={() => onChange(page + 1)}
      >
        下一页
      </Button>
    </div>
  );
}
function ContentList({ option, type, setType, version }) {
  const [page, setPage] = useState(1),
    [data, setData] = useState(null),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    setPage(1);
  }, [option.id, type]);
  useEffect(() => {
    let live = true;
    setData(null);
    setError("");
    api(
      "/taxonomy/options/" +
        option.id +
        "/content?type=" +
        type +
        "&page=" +
        page,
    )
      .then((r) => {
        if (live) setData(r);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [option.id, type, page, version, retry]);
  return (
    <section className="tm-content">
      <h3>{option.name} · 关联内容</h3>
      <div className="taxonomy-actions">
        <Button
          variant={type === "resources" ? "default" : "outline"}
          onClick={() => setType("resources")}
        >
          资料
        </Button>
        <Button
          variant={type === "roadmaps" ? "default" : "outline"}
          onClick={() => setType("roadmaps")}
        >
          学习路线
        </Button>
      </div>
      <ErrorBox>{error}</ErrorBox>
      {error && (
        <Button variant="outline" onClick={() => setRetry((n) => n + 1)}>
          重试加载内容
        </Button>
      )}
      {!error && !data && <p role="status">正在读取关联内容…</p>}
      {data && (
        <>
          <div className="taxonomy-list">
            {data.items.map((r) => (
              <div className="taxonomy-row" key={r.id}>
                <AppLink
                  to={
                    type === "resources"
                      ? "/resources/" + r.id
                      : "/roadmaps/" + r.id + (r.published ? "" : "/edit")
                  }
                >
                  {r.title}
                </AppLink>
                <small>
                  {type === "resources"
                    ? r.hidden
                      ? "隐藏资料"
                      : "可见资料"
                    : [r.draft && "草稿", r.published && "已发布"]
                        .filter(Boolean)
                        .join(" · ")}
                </small>
              </div>
            ))}
          </div>
          {!data.total && <p className="taxonomy-empty">暂无关联内容</p>}
          <Pages page={page} total={data.total} onChange={setPage} />
        </>
      )}
    </section>
  );
}
export default function Manager() {
  const { user, taxonomy, taxonomyError, refreshTaxonomy, refresh, notify } =
    useApp();
  const [workspace, setWorkspace] = useState("directory"),
    [selected, setSelected] = useState(""),
    [expanded, setExpanded] = useState({}),
    [search, setSearch] = useState(""),
    [usage, setUsage] = useState(null),
    [pending, setPending] = useState(null),
    [loadError, setLoadError] = useState(""),
    [version, setVersion] = useState(0),
    [unused, setUnused] = useState("all"),
    [sort, setSort] = useState("name"),
    [page, setPage] = useState(1),
    [content, setContent] = useState(null),
    [contentType, setContentType] = useState("resources"),
    [modal, setModal] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState(null),
    [previewError, setPreviewError] = useState(""),
    [previewLoading, setPreviewLoading] = useState(false),
    [previewRetry, setPreviewRetry] = useState(0),
    [locateTag, setLocateTag] = useState(""),
    [conflict, setConflict] = useState(false);
  const trigger = useRef(null),
    lock = useRef(false);
  const options = [
    ...taxonomy.domains,
    ...taxonomy.categories,
    ...taxonomy.tags,
  ];
  const chosen = options.find((o) => o.id === selected),
    parent =
      chosen?.kind === "category"
        ? taxonomy.domains.find((d) => d.id === chosen.parent_id)
        : null;
  const path = (o) =>
    o.kind === "category"
      ? taxonomy.domains.find((d) => d.id === o.parent_id)?.name +
        " / " +
        o.name
      : o.name;
  useEffect(() => {
    if (user.role !== "admin") return;
    let live = true;
    setLoadError("");
    setUsage(null);
    Promise.all([
      api("/taxonomy/usage"),
      api("/taxonomy/requests?scope=review&status=pending&page=1"),
    ])
      .then(([u, r]) => {
        if (live) {
          setUsage(u.usage);
          setPending(r.pendingCount);
        }
      })
      .catch((e) => {
        if (live) setLoadError(e.message);
      });
    return () => {
      live = false;
    };
  }, [user.role, taxonomy.revision, version]);
  useEffect(() => {
    setPage(1);
  }, [search, unused, sort]);
  useEffect(() => {
    if (!modal?.option || !["move", "merge", "delete"].includes(modal.mode)) {
      setPreview(null);
      return;
    }
    let live = true;
    setPreview(null);
    setPreviewError("");
    setPreviewLoading(true);
    api(
      "/taxonomy/options/" +
        modal.option.id +
        "/impact" +
        (modal.mode === "merge" && modal.targetId
          ? "?targetId=" + encodeURIComponent(modal.targetId)
          : ""),
    )
      .then((r) => {
        if (live) setPreview(r);
      })
      .catch((e) => {
        if (live) setPreviewError(e.message);
      })
      .finally(() => {
        if (live) setPreviewLoading(false);
      });
    return () => {
      live = false;
    };
  }, [modal?.option?.id, modal?.mode, modal?.targetId, previewRetry]);
  useEffect(() => {
    if (!locateTag) return;
    const tags = taxonomy.tags
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
    setPage(
      Math.max(
        1,
        Math.floor(tags.findIndex((o) => o.id === locateTag) / 20) + 1,
      ),
    );
    setLocateTag("");
  }, [locateTag, taxonomy.tags]);
  const select = (o) => {
    setSelected(o?.id || "");
    setContent(null);
    setSearch("");
    if (o)
      setExpanded((e) => ({
        ...e,
        [o.kind === "domain" ? o.id : o.parent_id]: true,
      }));
  };
  const showContent = (o, type) => {
    setContent(o);
    setContentType(type);
  };
  const reload = async () => {
    const t = await refreshTaxonomy();
    if (!t) throw Error("刷新失败，请重试");
    setVersion((n) => n + 1);
    return t;
  };
  const open = (mode, option, kind = option?.kind, parentId = "") => {
    trigger.current = document.activeElement;
    setError("");
    setConflict(false);
    setPreview(null);
    setPreviewError("");
    setModal({
      mode,
      option,
      kind,
      parentId,
      name: option?.name || "",
      targetId: "",
      targetSearch: "",
      revision: taxonomy.revision,
    });
  };
  const update = (values) => setModal((m) => ({ ...m, ...values }));
  const refreshModal = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      const t = await reload();
      const all = [...t.domains, ...t.categories, ...t.tags];
      if (modal.option && !all.some((o) => o.id === modal.option.id)) {
        setModal(null);
        setSelected("");
        notify("此选项已被删除，列表已刷新");
        return;
      }
      update({
        revision: t.revision,
        targetId: all.some((o) => o.id === modal.targetId)
          ? modal.targetId
          : "",
        option: modal.option
          ? all.find((o) => o.id === modal.option.id)
          : undefined,
      });
      setPreviewRetry((n) => n + 1);
      setConflict(false);
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const submit = async (e) => {
    e.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const m = modal;
      let result;
      const revision = preview?.revision ?? m.revision;
      if (m.mode === "add")
        result = await send("/taxonomy/options", {
          kind: m.kind,
          name: m.name,
          parentId: m.parentId,
          revision: m.revision,
        });
      else if (m.mode === "rename")
        await send(
          "/taxonomy/options/" + m.option.id,
          { name: m.name, revision: m.revision },
          "PATCH",
        );
      else if (m.mode === "move")
        await send(
          "/taxonomy/options/" + m.option.id,
          { parentId: m.targetId, revision },
          "PATCH",
        );
      else
        await send(
          "/taxonomy/options/" + m.option.id,
          { targetId: m.mode === "merge" ? m.targetId : undefined, revision },
          "DELETE",
        );
      const t = await reload();
      await refresh();
      setModal(null);
      setSearch("");
      setUnused("all");
      const all = [...t.domains, ...t.categories, ...t.tags],
        id =
          result?.option?.id ||
          (m.mode === "merge"
            ? m.targetId
            : m.mode === "delete"
              ? m.option.parent_id
              : m.option.id),
        target = all.find((o) => o.id === id);
      select(target);
      if (m.kind === "tag") {
        setSort("name");
        setLocateTag(id || "");
        if (target) showContent(target, "resources");
      }
      notify(actions[m.mode] + "成功");
    } catch (e) {
      setError(e.message);
      setConflict(e.status === 409 && /更新|刷新|变化/.test(e.message));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const reorder = async (o, direction) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      const siblings = options.filter(
          (x) => x.kind === o.kind && x.parent_id === o.parent_id,
        ),
        ids = siblings.map((x) => x.id),
        i = ids.indexOf(o.id);
      [ids[i], ids[i + direction]] = [ids[i + direction], ids[i]];
      await send("/taxonomy/reorder", {
        kind: o.kind,
        parentId: o.parent_id,
        orderedIds: ids,
        revision: taxonomy.revision,
      });
      await reload();
      notify("顺序已更新");
    } catch (e) {
      setLoadError(e.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  if (user.role !== "admin")
    return (
      <Empty
        title="需要管理员权限"
        description="只有管理员可以管理分类与标签。"
      />
    );
  const counts = (o) => usage?.[o.id];
  const counters = (o) => (
    <div className="tm-counts">
      <Button
        variant="ghost"
        disabled={!usage}
        onClick={() => showContent(o, "resources")}
      >
        {counts(o)?.resources ?? "…"} 份资料
      </Button>
      <Button
        variant="ghost"
        disabled={!usage}
        onClick={() => showContent(o, "roadmaps")}
      >
        {counts(o)?.roadmaps ?? "…"} 条路线
      </Button>
      {o.kind === "domain" && (
        <span>{counts(o)?.categories ?? "…"} 个分类</span>
      )}
    </div>
  );
  const operations = (o) => {
    const siblings = options.filter(
        (x) => x.kind === o.kind && x.parent_id === o.parent_id,
      ),
      i = siblings.findIndex((x) => x.id === o.id);
    return (
      <div className="taxonomy-actions tm-operations">
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => open("rename", o)}
        >
          重命名
        </Button>
        {o.kind === "category" && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => open("move", o)}
          >
            移动分类
          </Button>
        )}
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => open("merge", o)}
        >
          合并
        </Button>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => open("delete", o)}
        >
          删除
        </Button>
        {o.kind !== "tag" && (
          <>
            <Button
              variant="ghost"
              aria-label={"上移 " + o.name}
              disabled={busy || !!fold(search) || i === 0}
              onClick={() => reorder(o, -1)}
            >
              <ArrowUp size={16} />
              上移
            </Button>
            <Button
              variant="ghost"
              aria-label={"下移 " + o.name}
              disabled={busy || !!fold(search) || i === siblings.length - 1}
              onClick={() => reorder(o, 1)}
            >
              <ArrowDown size={16} />
              下移
            </Button>
          </>
        )}
      </div>
    );
  };
  const row = (o) => (
    <div
      className="tm-option"
      key={o.id}
      data-option-id={o.id}
      data-selected={selected === o.id}
    >
      <div className="tm-option-heading">
        <Button
          variant="ghost"
          className="tm-name"
          onClick={() =>
            o.kind === "tag" ? showContent(o, "resources") : select(o)
          }
        >
          {o.kind === "tag" ? <Tag size={17} /> : <Folder size={17} />}
          <strong>{o.name}</strong>
        </Button>
        {counters(o)}
      </div>
      {operations(o)}
    </div>
  );
  const results = options.filter(
    (o) =>
      o.kind !== "tag" &&
      (fold(o.name).includes(fold(search)) ||
        (o.kind === "category" && fold(path(o)).includes(fold(search)))),
  );
  const tags = taxonomy.tags
    .filter(
      (o) =>
        fold(o.name).includes(fold(search)) &&
        (unused !== "unused" ||
          (usage && !(counts(o)?.resources + counts(o)?.roadmaps))),
    )
    .sort((a, b) =>
      sort === "usage"
        ? (counts(b)?.resources || 0) +
            (counts(b)?.roadmaps || 0) -
            ((counts(a)?.resources || 0) + (counts(a)?.roadmaps || 0)) ||
          a.name.localeCompare(b.name, "zh-CN")
        : a.name.localeCompare(b.name, "zh-CN"),
    );
  const blocked =
    modal?.mode === "delete" &&
    modal.kind !== "tag" &&
    preview &&
    Object.values(preview.impact).some(Boolean);
  const targets = modal
    ? options.filter((o) =>
        modal.mode === "move"
          ? o.kind === "domain" && o.id !== modal.option.parent_id
          : o.kind === modal.kind && o.id !== modal.option?.id,
      )
    : [];
  return (
    <div className="taxonomy-page tm-page">
      <div className="page-heading">
        <div>
          <h1>分类与标签管理</h1>
          <p>整理目录，统一标签，让资料更容易找到。</p>
        </div>
        <AppLink variant="outline" to="/admin/taxonomy/requests">
          审核成员申请{pending !== null ? " · " + pending + " 待处理" : ""}
        </AppLink>
      </div>
      <ErrorBox>{taxonomyError || loadError}</ErrorBox>
      <Tabs
        value={workspace}
        onValueChange={(v) => {
          setWorkspace(v);
          setSearch("");
          setContent(null);
          setPage(1);
        }}
      >
        <TabsList aria-label="管理工作区">
          <TabsTrigger value="directory">目录管理</TabsTrigger>
          <TabsTrigger value="tags">标签管理</TabsTrigger>
        </TabsList>
        <div className="taxonomy-toolbar">
          <Input
            aria-label={workspace === "directory" ? "搜索目录" : "搜索标签"}
            placeholder={
              workspace === "directory" ? "搜索资料库或分类…" : "搜索标签…"
            }
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <Button variant="ghost" onClick={() => setSearch("")}>
              清除搜索
            </Button>
          )}
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => reload().catch((e) => setLoadError(e.message))}
          >
            刷新
          </Button>
          <Button
            disabled={busy}
            onClick={() =>
              open("add", null, workspace === "directory" ? "domain" : "tag")
            }
          >
            {workspace === "directory" ? "新建资料库" : "新增标签"}
          </Button>
        </div>
        <TabsContent value="directory">
          {search && (
            <p className="tm-note">搜索期间无法调整顺序，请清除搜索后排序。</p>
          )}
          <div className="tm-layout">
            <aside className="tm-tree" aria-label="目录树">
              {taxonomy.domains.map((d) => (
                <div key={d.id}>
                  <div className="tm-tree-line">
                    <Button
                      variant="ghost"
                      aria-label={(expanded[d.id] ? "收起 " : "展开 ") + d.name}
                      aria-expanded={!!expanded[d.id]}
                      onClick={() =>
                        setExpanded((x) => ({ ...x, [d.id]: !x[d.id] }))
                      }
                    >
                      {expanded[d.id] ? (
                        <ChevronDown size={16} />
                      ) : (
                        <ChevronRight size={16} />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      aria-current={selected === d.id ? "page" : undefined}
                      onClick={() => select(d)}
                    >
                      {d.name}
                    </Button>
                  </div>
                  {expanded[d.id] && (
                    <div className="tm-tree-children">
                      {taxonomy.categories
                        .filter((c) => c.parent_id === d.id)
                        .map((c) => (
                          <Button
                            variant="ghost"
                            key={c.id}
                            aria-current={
                              selected === c.id ? "page" : undefined
                            }
                            onClick={() => select(c)}
                          >
                            {c.name}
                          </Button>
                        ))}
                    </div>
                  )}
                </div>
              ))}
            </aside>
            <section className="tm-detail">
              <nav className="tm-breadcrumb" aria-label="目录位置">
                <Button variant="ghost" onClick={() => select(null)}>
                  全部资料库
                </Button>
                {parent && (
                  <>
                    <span>/</span>
                    <Button variant="ghost" onClick={() => select(parent)}>
                      {parent.name}
                    </Button>
                  </>
                )}
                {chosen && chosen.kind !== "tag" && (
                  <>
                    <span>/</span>
                    <span>{chosen.name}</span>
                  </>
                )}
              </nav>
              {search ? (
                <div className="taxonomy-list">
                  {results.map((o) => (
                    <div className="tm-option" key={o.id}>
                      <Button
                        className="tm-name"
                        variant="ghost"
                        onClick={() => select(o)}
                      >
                        {path(o)}
                        <ChevronRight size={16} />
                      </Button>
                      {counters(o)}
                      {operations(o)}
                    </div>
                  ))}
                  {!results.length && (
                    <p className="taxonomy-empty">没有匹配的目录</p>
                  )}
                </div>
              ) : (
                <>
                  {chosen && chosen.kind !== "tag" ? (
                    <>
                      <div className="tm-selected">
                        <h2>{chosen.name}</h2>
                        {counters(chosen)}
                        {operations(chosen)}
                      </div>
                      {chosen.kind === "domain" && (
                        <>
                          <div className="tm-section-heading">
                            <h3>下属分类</h3>
                            <Button
                              disabled={busy}
                              onClick={() =>
                                open("add", null, "category", chosen.id)
                              }
                            >
                              新增分类
                            </Button>
                          </div>
                          <p className="tm-note">
                            分类可以是课程、技术方向等。
                          </p>
                          <div className="taxonomy-list">
                            {taxonomy.categories
                              .filter((c) => c.parent_id === chosen.id)
                              .map(row)}
                          </div>
                          {!taxonomy.categories.some(
                            (c) => c.parent_id === chosen.id,
                          ) && (
                            <p className="taxonomy-empty">
                              还没有分类，点击「新增分类」开始整理。
                            </p>
                          )}
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      <h2>全部资料库</h2>
                      <div className="taxonomy-list">
                        {taxonomy.domains.map(row)}
                      </div>
                      {!taxonomy.domains.length && (
                        <p className="taxonomy-empty">
                          还没有资料库，请先新建资料库。
                        </p>
                      )}
                    </>
                  )}
                </>
              )}
              {(content || chosen?.kind === "category") && (
                <ContentList
                  key={(content || chosen).id + contentType}
                  option={content || chosen}
                  type={contentType}
                  setType={setContentType}
                  version={version}
                />
              )}
            </section>
          </div>
        </TabsContent>
        <TabsContent value="tags">
          <div className="taxonomy-toolbar">
            <Choice
              aria-label="标签使用情况"
              value={unused}
              onChange={(e) => setUnused(e.target.value)}
            >
              <option value="all">全部标签</option>
              <option value="unused">未使用</option>
            </Choice>
            <Choice
              aria-label="标签排序"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="name">按名称排序</option>
              <option value="usage">按使用量排序</option>
            </Choice>
            <p className="tm-note">标签在资料与学习路线中共享。</p>
          </div>
          <div className="taxonomy-list">
            {tags.slice((page - 1) * 20, page * 20).map(row)}
          </div>
          {!tags.length && <p className="taxonomy-empty">暂无匹配标签</p>}
          <Pages page={page} total={tags.length} onChange={setPage} />
          {content && (
            <ContentList
              key={content.id + contentType}
              option={content}
              type={contentType}
              setType={setContentType}
              version={version}
            />
          )}
        </TabsContent>
      </Tabs>
      <Dialog
        open={!!modal}
        onOpenChange={(v) => {
          if (!v && !busy) setModal(null);
        }}
      >
        <DialogContent
          className="taxonomy-dialog tm-dialog"
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            requestAnimationFrame(() =>
              trigger.current?.isConnected
                ? trigger.current.focus()
                : document.getElementById("main")?.focus(),
            );
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {actions[modal?.mode]}
              {labels[modal?.kind]}
            </DialogTitle>
            <DialogDescription>
              {modal?.mode === "delete"
                ? "只处理分类或标签，资料文件、路线内容和学习进度会保留。"
                : "修改后同步到资料与学习路线。请核对名称和目标。"}
            </DialogDescription>
          </DialogHeader>
          {modal && (
            <form onSubmit={submit}>
              {["add", "rename"].includes(modal.mode) ? (
                <>
                  <Field>
                    名称
                    <Input
                      required
                      maxLength={modal.kind === "tag" ? 30 : 60}
                      value={modal.name}
                      disabled={busy}
                      onChange={(e) => update({ name: e.target.value })}
                    />
                  </Field>
                  {modal.kind === "category" && modal.mode === "add" && (
                    <p className="tm-note">
                      所属资料库：
                      {
                        taxonomy.domains.find((d) => d.id === modal.parentId)
                          ?.name
                      }
                      。例如课程、技术方向。
                    </p>
                  )}
                </>
              ) : (
                <>
                  <strong>{path(modal.option)}</strong>
                  {previewLoading && <p role="status">正在读取影响范围…</p>}
                  <ErrorBox>{previewError}</ErrorBox>
                  {previewError && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setPreviewRetry((n) => n + 1)}
                    >
                      重试读取影响
                    </Button>
                  )}
                  {preview && (
                    <div className="taxonomy-impact">
                      涉及 {preview.impact.resources} 份资料、
                      {preview.impact.roadmaps} 条路线、
                      {preview.impact.categories} 个下属分类。
                    </div>
                  )}
                </>
              )}
              {["merge", "move"].includes(modal.mode) && (
                <>
                  <Field>
                    搜索目标
                    <Input
                      value={modal.targetSearch}
                      disabled={busy}
                      onChange={(e) => update({ targetSearch: e.target.value })}
                    />
                  </Field>
                  <Field>
                    {modal.mode === "move" ? "目标资料库" : "合并到"}
                    <Choice
                      value={modal.targetId}
                      disabled={busy}
                      onChange={(e) => update({ targetId: e.target.value })}
                    >
                      <option value="">请选择目标</option>
                      {targets
                        .filter(
                          (o) =>
                            o.id === modal.targetId ||
                            fold(path(o)).includes(fold(modal.targetSearch)),
                        )
                        .map((o) => (
                          <option key={o.id} value={o.id}>
                            {path(o)}
                          </option>
                        ))}
                    </Choice>
                  </Field>
                  {!targets.length && (
                    <p>
                      暂无可用目标，请先创建
                      {modal.mode === "move" ? "资料库" : labels[modal.kind]}。
                    </p>
                  )}
                  {modal.mode === "move" && (
                    <p className="tm-note">
                      分类及关联内容一起移动到目标资料库末尾；同名分类需先重命名或使用合并。
                    </p>
                  )}
                  {modal.mode === "merge" && preview?.target && (
                    <div className="taxonomy-impact">
                      <p>
                        将「{modal.option.name}」合并到「{preview.target.name}
                        」，随后移除原选项。
                      </p>
                      {preview.children.map((c) => (
                        <p key={c.id}>
                          {c.name} →{" "}
                          {c.action === "merge" ? "合并到" : "移动为"}{" "}
                          {c.targetName}
                        </p>
                      ))}
                    </div>
                  )}
                </>
              )}
              {blocked && (
                <div className="taxonomy-impact">
                  该目录仍有内容或下属分类，请先移动内容，或合并到其他目录。
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setPreview(null);
                      update({ mode: "merge" });
                    }}
                  >
                    改为合并
                  </Button>
                </div>
              )}
              {modal.mode === "delete" && modal.kind === "tag" && (
                <p>
                  此标签将从关联资料和学习路线中移除，不会删除资料或学习路线。
                </p>
              )}
              <ErrorBox>{error}</ErrorBox>
              {error && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={refreshModal}
                >
                  刷新选项与影响范围
                </Button>
              )}
              <div className="taxonomy-actions">
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setModal(null)}
                >
                  取消
                </Button>
                <Button
                  type="submit"
                  variant={modal.mode === "delete" ? "destructive" : "default"}
                  disabled={
                    busy ||
                    conflict ||
                    blocked ||
                    (["merge", "move", "delete"].includes(modal.mode) &&
                      (!preview || previewLoading || !!previewError)) ||
                    (["merge", "move"].includes(modal.mode) && !modal.targetId)
                  }
                >
                  {busy
                    ? "正在处理…"
                    : modal.mode === "merge"
                      ? "确认合并"
                      : modal.mode === "move"
                        ? "确认移动"
                        : modal.mode === "delete"
                          ? "确认删除"
                          : "保存"}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
