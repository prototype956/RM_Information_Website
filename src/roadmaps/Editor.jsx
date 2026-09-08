import React, { useState, useEffect, useRef, lazy, Suspense } from "react";
import {
  ArrowLeft,
  Plus,
  Save,
  Undo2,
  Redo2,
  WandSparkles,
  Eye,
  Send,
  Copy,
  Trash2,
  ArrowUp,
  ArrowDown,
  X,
  Map,
  List,
} from "lucide-react";
import { useApp } from "../context";
import { api, send } from "../api";
import ClassificationFields from "../taxonomy/Fields";
import { TagPicker } from "../taxonomy/TagPicker";
import { uid, graphError } from "../../shared/roadmap";
import {
  AppLink,
  Field,
  Choice,
  Loading,
  ErrorBox,
} from "../components/shared";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Checkbox } from "../components/ui/checkbox";
import { Label } from "../components/ui/label";
import { Badge } from "../components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group";
import { Confirm, Checklist, NodeReading, CanvasBoundary } from "./ui";
import "./roadmaps.css";
const Canvas = lazy(() => import("./Canvas"));
export default function RoadmapEditor({ id }) {
  const {
    user,
    go,
    notify,
    resources: library,
    resourceError,
    refresh,
  } = useApp();
  const [doc, setDoc] = useState(null),
    [meta, setMeta] = useState(null),
    [resolved, setResolved] = useState({}),
    [loadError, setLoadError] = useState(""),
    [error, setError] = useState(""),
    [selected, setSelected] = useState(""),
    [stage, setStage] = useState(""),
    [status, setStatus] = useState("已保存"),
    [busy, setBusy] = useState(false),
    [saving, setSaving] = useState(false),
    [preview, setPreview] = useState(false),
    [view, setView] = useState(
      matchMedia("(max-width: 1050px)").matches ? "list" : "map",
    ),
    [confirm, setConfirm] = useState(null),
    [revision, setRevision] = useState(0),
    [historyTick, setHistoryTick] = useState(0);
  const [search, setSearch] = useState(""),
    [linkTitle, setLinkTitle] = useState(""),
    [linkUrl, setLinkUrl] = useState(""),
    [linkError, setLinkError] = useState("");
  const tagPicker = useRef(null);
  const current = useRef(null),
    saved = useRef(""),
    version = useRef(0),
    pending = useRef(null),
    conflict = useRef(false),
    history = useRef({ past: [], future: [] }),
    alive = useRef(true);
  const setDocument = (d) => {
    current.current = d;
    setDoc(d);
  };
  const dirty = () =>
    !!current.current && JSON.stringify(current.current) !== saved.current;
  const load = async () => {
    setLoadError("");
    try {
      const r = await api(`/roadmaps/${id}/draft`);
      if (!alive.current) return;
      setDocument(r.document);
      setMeta(r.roadmap);
      setResolved(r.resources);
      version.current = r.roadmap.version;
      saved.current = JSON.stringify(r.document);
      conflict.current = false;
      setError("");
      setStatus("已保存");
      history.current = { past: [], future: [] };
      setSelected(r.document.nodes[0]?.id || "");
      setStage(r.document.stages[0]?.id || "");
      setHistoryTick((x) => x + 1);
    } catch (e) {
      if (alive.current) setLoadError(e.message);
    }
  };
  useEffect(() => {
    alive.current = true;
    load();
    return () => {
      alive.current = false;
    };
  }, [id]);
  function mutate(transform) {
    if (busy) return;
    const previous = current.current,
      next = transform(structuredClone(previous));
    if (!next || JSON.stringify(previous) === JSON.stringify(next)) return;
    history.current.past.push(previous);
    if (history.current.past.length > 50) history.current.past.shift();
    history.current.future = [];
    setDocument(next);
    setStatus("有未保存修改");
    setHistoryTick((x) => x + 1);
  }
  async function save() {
    if (!current.current?.domain || !current.current?.categoryId)
      throw Error("请选择资料库和路线分类后保存");
    if (pending.current) {
      await pending.current;
    }
    if (conflict.current) throw Error("请先处理版本冲突，再保存或发布");
    if (!dirty()) return version.current;
    const snapshot = JSON.stringify(current.current);
    setSaving(true);
    setStatus("正在保存…");
    const task = send(
      `/roadmaps/${id}/draft`,
      { version: version.current, document: JSON.parse(snapshot) },
      "PUT",
    )
      .then((r) => {
        version.current = r.version;
        saved.current = snapshot;
        if (alive.current) {
          setStatus(
            JSON.stringify(current.current) === snapshot
              ? "已保存"
              : "有未保存修改",
          );
          setError("");
          setRevision((x) => x + 1);
        }
        return r.version;
      })
      .catch((e) => {
        if (e.status === 409) conflict.current = true;
        if (alive.current) {
          setStatus(e.status === 409 ? "版本冲突" : "保存失败");
          setError(e.message);
        }
        throw e;
      })
      .finally(() => {
        pending.current = null;
        if (alive.current) setSaving(false);
      });
    pending.current = task;
    return task;
  }
  useEffect(() => {
    if (!doc) return;
    if (!dirty()) {
      if (!conflict.current) setStatus("已保存");
      return;
    }
    if (conflict.current || busy) return;
    if (!doc.domain || !doc.categoryId) {
      setStatus("请选择路线分类");
      return;
    }
    const timer = setTimeout(() => {
      save().catch(() => {});
    }, 1000);
    return () => clearTimeout(timer);
  }, [doc, revision, busy]);
  useEffect(() => {
    const leave = (e) => {
      if (
        dirty() &&
        !window.confirm(
          "路线还有未保存的修改，离开会丢失这些修改。确定离开吗？",
        )
      )
        e.preventDefault();
    };
    const unload = (e) => {
      if (dirty()) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    addEventListener("app-before-navigate", leave);
    addEventListener("beforeunload", unload);
    return () => {
      removeEventListener("app-before-navigate", leave);
      removeEventListener("beforeunload", unload);
    };
  }, []);
  const select = (id) => {
    setSelected(id);
    const n = current.current.nodes.find((n) => n.id === id);
    if (n) setStage(n.stageId);
    setLinkError("");
    setLinkTitle("");
    setLinkUrl("");
  };
  const historyMove = (direction) => {
    if (busy) return;
    const h = history.current,
      from = direction === "undo" ? h.past : h.future,
      to = direction === "undo" ? h.future : h.past;
    if (!from.length) return;
    to.push(current.current);
    setDocument(from.pop());
    setStatus("有未保存修改");
    setHistoryTick((x) => x + 1);
  };
  const patchNode = (fields) =>
    mutate((d) => {
      d.nodes = d.nodes.map((n) =>
        n.id === selected ? { ...n, ...fields } : n,
      );
      return d;
    });
  const connect = ({ source, target }) => {
    const edge = { id: uid(), source, target },
      problem = graphError(current.current.nodes, [
        ...current.current.edges,
        edge,
      ]);
    if (problem) {
      notify(problem);
      return;
    }
    mutate((d) => {
      d.edges.push(edge);
      return d;
    });
  };
  const removeEdges = (ids) =>
    setConfirm({
      title: "移除前置关系？",
      description: "节点和学习资料会保留。",
      run: () =>
        mutate((d) => ({
          ...d,
          edges: d.edges.filter((e) => !ids.includes(e.id)),
        })),
    });
  const addNode = () => {
    if (doc.nodes.length >= 200) {
      notify("每条路线最多 200 个节点");
      return;
    }
    const id = uid(),
      stageId = doc.stages.some((s) => s.id === stage)
        ? stage
        : doc.stages[0].id;
    mutate((d) => {
      d.nodes.push({
        id,
        title: "新的学习节点",
        stageId,
        required: true,
        goal: "",
        description: "",
        task: "",
        resourceIds: [],
        links: [],
        position: {
          x: 80 + (d.nodes.length % 2) * 300,
          y: 60 + Math.floor(d.nodes.length / 2) * 240,
        },
      });
      return d;
    });
    setSelected(id);
  };
  const layout = async () => {
    setBusy(true);
    try {
      const { default: dagre } = await import("@dagrejs/dagre");
      const g = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
      g.setGraph({
        rankdir: "TB",
        nodesep: 60,
        ranksep: 90,
        marginx: 40,
        marginy: 40,
      });
      for (const s of current.current.stages)
        for (const n of current.current.nodes.filter((n) => n.stageId === s.id))
          g.setNode(n.id, { width: 260, height: 180 });
      current.current.edges.forEach((e) => g.setEdge(e.source, e.target));
      dagre.layout(g);
      const previous = current.current,
        next = {
          ...previous,
          nodes: previous.nodes.map((n) => ({
            ...n,
            position: { x: g.node(n.id).x - 130, y: g.node(n.id).y - 90 },
          })),
        };
      history.current.past.push(previous);
      history.current.future = [];
      setDocument(next);
      setStatus("有未保存修改");
      setHistoryTick((x) => x + 1);
      notify("节点已整理，可以撤销恢复原位置");
    } catch {
      notify("自动布局暂时不可用，仍可手动调整节点");
    } finally {
      setBusy(false);
    }
  };
  const action = async (kind, body = {}, method = "POST") => {
    try {
      if (method !== "DELETE") await tagPicker.current?.commit();
      setBusy(true);
      if (method === "DELETE") {
        if (pending.current) await pending.current.catch(() => {});
      } else await save();
      const r = await send(
        `/roadmaps/${id}${kind ? "/" + kind : ""}`,
        { ...body, version: version.current },
        method,
      );
      version.current = r.version || version.current;
      if (kind === "publish") {
        notify("路线已发布到队内");
        go(`/roadmaps/${id}`);
      } else if (method === "DELETE") {
        saved.current = JSON.stringify(current.current);
        notify("路线已删除");
        go("/roadmaps?scope=mine");
      } else {
        setMeta((m) => ({
          ...m,
          ...(kind === "withdraw"
            ? { published: false }
            : { hidden: body.hidden }),
        }));
        notify(
          kind === "withdraw"
            ? "已撤回发布，学习记录已保留"
            : body.hidden
              ? "路线已下架"
              : "路线已恢复",
        );
      }
    } catch (e) {
      if (e.status === 409) conflict.current = true;
      setError(e.message);
      notify(e.message);
    } finally {
      setBusy(false);
    }
  };
  if (loadError)
    return (
      <div className="road-page">
        <ErrorBox>{loadError}</ErrorBox>
        <Button variant="outline" onClick={load}>
          重新加载
        </Button>
        <AppLink variant="ghost" to="/roadmaps">
          返回学习路线
        </AppLink>
      </div>
    );
  if (!doc) return <Loading text="正在加载路线草稿…" />;
  const node = doc.nodes.find((n) => n.id === selected),
    nodeResources = {
      ...resolved,
      ...Object.fromEntries(library.map((r) => [r.id, r])),
    };
  const reorder = (i, delta) =>
    mutate((d) => {
      const j = i + delta;
      if (j >= 0 && j < d.stages.length)
        [d.stages[i], d.stages[j]] = [d.stages[j], d.stages[i]];
      return d;
    });
  return (
    <div className="road-page road-editor">
      <div className="road-editor-heading">
        <div>
          <AppLink className="road-back" to="/roadmaps?scope=mine">
            <ArrowLeft size={16} />
            我创建的路线
          </AppLink>
          <h1>{preview ? "预览路线" : "编排学习路线"}</h1>
          <p>把目标、资料和实践，连接成队友的下一步。</p>
        </div>
        <div className="road-actions">
          <span
            role="status"
            className={`road-save-status ${error ? "has-error" : ""}`}
          >
            {status}
          </span>
          <Button
            variant="outline"
            disabled={busy || saving}
            onClick={async () => {
              try {
                await tagPicker.current?.commit();
                await save();
              } catch (e) {
                setError(e.message);
              }
            }}
          >
            <Save size={16} />
            {error ? "重试保存" : "保存草稿"}
          </Button>
          <Button
            variant="outline"
            aria-pressed={preview}
            onClick={() => setPreview(!preview)}
          >
            <Eye size={16} />
            {preview ? "返回编辑" : "预览"}
          </Button>
          <Button
            disabled={busy || saving || meta.hidden}
            onClick={() => action("publish")}
          >
            <Send size={16} />
            {meta.published ? "发布更新" : "发布路线"}
          </Button>
        </div>
      </div>
      {meta.hidden && (
        <p className="road-notice">路线已由管理员下架，恢复前无法发布。</p>
      )}
      {error && (
        <div className="road-error-area">
          <ErrorBox id="road-save-error">{error}</ErrorBox>
          {conflict.current && (
            <Button
              variant="outline"
              onClick={() =>
                setConfirm({
                  title: "重新加载服务器版本？",
                  description:
                    "当前未保存的修改将被替换。你可以先查看并记录需要保留的内容。",
                  run: load,
                })
              }
            >
              重新加载版本
            </Button>
          )}
        </div>
      )}
      <div className="road-editor-toolbar">
        <div className="road-actions">
          <Button
            variant="outline"
            disabled={preview || busy || doc.nodes.length >= 200}
            onClick={addNode}
          >
            <Plus size={16} />
            添加节点
          </Button>
          <Button
            variant="ghost"
            aria-label="撤销修改"
            disabled={preview || busy || !history.current.past.length}
            onClick={() => historyMove("undo")}
          >
            <Undo2 size={17} />
          </Button>
          <Button
            variant="ghost"
            aria-label="重做修改"
            disabled={preview || busy || !history.current.future.length}
            onClick={() => historyMove("redo")}
          >
            <Redo2 size={17} />
          </Button>
          <Button
            variant="ghost"
            disabled={preview || busy || !doc.nodes.length}
            onClick={layout}
          >
            <WandSparkles size={16} />
            一键整理
          </Button>
        </div>
        <ToggleGroup
          type="single"
          value={view}
          onValueChange={(v) => v && setView(v)}
          aria-label="编辑视图"
        >
          <ToggleGroupItem value="map" aria-label="画布视图">
            <Map size={17} />
            画布
          </ToggleGroupItem>
          <ToggleGroupItem value="list" aria-label="清单视图">
            <List size={17} />
            清单
          </ToggleGroupItem>
        </ToggleGroup>
        <span className="road-muted">{doc.nodes.length} / 200 节点</span>
      </div>
      <div className={`road-editor-layout ${preview ? "is-preview" : ""}`}>
        {!preview && (
          <aside className="road-panel road-editor-outline">
            <fieldset disabled={busy}>
              <h2>路线设置</h2>
              <Field>
                路线标题
                <Input
                  value={doc.title}
                  maxLength={120}
                  onChange={(e) =>
                    mutate((d) => ({ ...d, title: e.target.value }))
                  }
                  aria-describedby={error ? "road-save-error" : undefined}
                />
              </Field>
              <Field>
                路线简介
                <Textarea
                  rows={3}
                  maxLength={5000}
                  value={doc.description}
                  onChange={(e) =>
                    mutate((d) => ({ ...d, description: e.target.value }))
                  }
                />
              </Field>
              <ClassificationFields
                value={doc}
                onChange={(fields) => mutate((d) => ({ ...d, ...fields }))}
                domainLabel="资料领域"
                categoryLabel="路线分类"
              />
              <TagPicker
                ref={tagPicker}
                value={doc.tagIds || []}
                onChange={(tagIds) => mutate((d) => ({ ...d, tagIds }))}
              />
              <div className="road-section-heading">
                <h2>学习阶段</h2>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="添加阶段"
                  disabled={doc.stages.length >= 50}
                  onClick={() => {
                    const id = uid();
                    mutate((d) => ({
                      ...d,
                      stages: [...d.stages, { id, title: "新的学习阶段" }],
                    }));
                    setStage(id);
                  }}
                >
                  <Plus size={17} />
                </Button>
              </div>
              {doc.stages.map((s, i) => (
                <div
                  className={`road-outline-stage ${stage === s.id ? "active" : ""}`}
                  key={s.id}
                >
                  <Input
                    aria-label={`阶段 ${i + 1} 名称`}
                    value={s.title}
                    maxLength={80}
                    onFocus={() => setStage(s.id)}
                    onChange={(e) =>
                      mutate((d) => ({
                        ...d,
                        stages: d.stages.map((x) =>
                          x.id === s.id ? { ...x, title: e.target.value } : x,
                        ),
                      }))
                    }
                  />
                  <div className="road-stage-tools">
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`上移 ${s.title}`}
                      disabled={!i}
                      onClick={() => reorder(i, -1)}
                    >
                      <ArrowUp size={15} />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`下移 ${s.title}`}
                      disabled={i === doc.stages.length - 1}
                      onClick={() => reorder(i, 1)}
                    >
                      <ArrowDown size={15} />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`删除阶段 ${s.title}`}
                      disabled={
                        doc.stages.length === 1 ||
                        doc.nodes.some((n) => n.stageId === s.id)
                      }
                      onClick={() =>
                        setConfirm({
                          title: "删除空阶段？",
                          run: () =>
                            mutate((d) => ({
                              ...d,
                              stages: d.stages.filter((x) => x.id !== s.id),
                            })),
                        })
                      }
                    >
                      <Trash2 size={15} />
                    </Button>
                    <span>
                      {doc.nodes.filter((n) => n.stageId === s.id).length} 项
                    </span>
                  </div>
                  {doc.nodes
                    .filter((n) => n.stageId === s.id)
                    .map((n) => (
                      <Button
                        key={n.id}
                        variant="ghost"
                        className={`road-outline-node ${selected === n.id ? "active" : ""}`}
                        onClick={() => select(n.id)}
                      >
                        {n.title}
                      </Button>
                    ))}
                </div>
              ))}
              <p className="road-muted">
                已有节点的阶段需先移动节点，才能删除。
              </p>
              <div className="road-management">
                {meta.published && (
                  <Button
                    variant="outline"
                    onClick={() =>
                      setConfirm({
                        title: "撤回已发布路线？",
                        description: "队友将暂时无法访问，个人学习记录会保留。",
                        run: () => action("withdraw"),
                      })
                    }
                  >
                    撤回发布
                  </Button>
                )}
                {user.role === "admin" && (
                  <Button
                    variant="outline"
                    onClick={() =>
                      setConfirm({
                        title: meta.hidden ? "恢复路线？" : "下架路线？",
                        description:
                          "下架后作者仍可编辑草稿，但无法自行重新公开。",
                        run: () =>
                          action(
                            "visibility",
                            { hidden: !meta.hidden },
                            "PATCH",
                          ),
                      })
                    }
                  >
                    {meta.hidden ? "恢复路线" : "管理员下架"}
                  </Button>
                )}
                <Button
                  variant="destructive"
                  onClick={() =>
                    setConfirm({
                      title: "永久删除这条路线？",
                      description:
                        "路线、草稿和所有成员在这条路线上的学习记录都会被删除。此操作无法撤销。",
                      run: () => action("", {}, "DELETE"),
                    })
                  }
                >
                  删除路线
                </Button>
              </div>
            </fieldset>
          </aside>
        )}
        <section className="road-editor-center" aria-label="路线编排区域">
          {!doc.nodes.length ? (
            <div className="road-canvas-empty">
              <div className="road-empty-symbol">
                <Plus size={28} />
              </div>
              <h2>每条路线，都从第一步开始</h2>
              <p>添加一个学习节点，再为它关联资料和实践任务。</p>
              <Button disabled={preview || busy} onClick={addNode}>
                添加第一个节点
              </Button>
            </div>
          ) : view === "map" ? (
            <CanvasBoundary onFallback={() => setView("list")}>
              <Suspense
                fallback={<Loading text="正在加载画布，可切换清单继续编辑…" />}
              >
                <Canvas
                  doc={doc}
                  selected={node?.id}
                  select={select}
                  editable={!preview && !busy}
                  onMove={(id, position) =>
                    mutate((d) => ({
                      ...d,
                      nodes: d.nodes.map((n) =>
                        n.id === id ? { ...n, position } : n,
                      ),
                    }))
                  }
                  onConnect={connect}
                  onEdgeDelete={removeEdges}
                />
              </Suspense>
            </CanvasBoundary>
          ) : (
            <Checklist
              doc={doc}
              selected={node?.id}
              select={select}
              editable={!preview}
            />
          )}
        </section>
        {preview ? (
          <NodeReading
            doc={doc}
            node={node}
            resources={nodeResources}
            select={select}
            preview
          />
        ) : (
          <aside
            className="road-panel road-node-form"
            aria-label="节点编辑表单"
          >
            <fieldset disabled={busy}>
              {!node ? (
                <>
                  <h2>节点内容</h2>
                  <p className="road-muted">
                    添加或选择节点，填写这一步的学习内容。
                  </p>
                </>
              ) : (
                <>
                  <div className="road-section-heading">
                    <h2>节点内容</h2>
                    <div>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="复制当前节点"
                        disabled={doc.nodes.length >= 200}
                        onClick={() => {
                          const id = uid();
                          mutate((d) => ({
                            ...d,
                            nodes: [
                              ...d.nodes,
                              {
                                ...structuredClone(node),
                                id,
                                title: `${node.title.slice(0, 110)}（副本）`,
                                position: {
                                  x: node.position.x + 40,
                                  y: node.position.y + 220,
                                },
                              },
                            ],
                          }));
                          setSelected(id);
                        }}
                      >
                        <Copy size={16} />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="删除当前节点"
                        onClick={() =>
                          setConfirm({
                            title: "删除这个学习节点？",
                            description:
                              "关联的前置连线也会移除，原始资料文件会保留。发布更新后，该节点不再计入进度。",
                            run: () => {
                              mutate((d) => ({
                                ...d,
                                nodes: d.nodes.filter((n) => n.id !== node.id),
                                edges: d.edges.filter(
                                  (e) =>
                                    e.source !== node.id &&
                                    e.target !== node.id,
                                ),
                              }));
                              setSelected("");
                            },
                          })
                        }
                      >
                        <Trash2 size={16} />
                      </Button>
                    </div>
                  </div>
                  <Field>
                    节点标题
                    <Input
                      value={node.title}
                      maxLength={120}
                      onChange={(e) => patchNode({ title: e.target.value })}
                      aria-describedby={error ? "road-save-error" : undefined}
                    />
                  </Field>
                  <Field>
                    所属阶段
                    <Choice
                      value={node.stageId}
                      onChange={(e) => {
                        patchNode({ stageId: e.target.value });
                        setStage(e.target.value);
                      }}
                    >
                      {doc.stages.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.title}
                        </option>
                      ))}
                    </Choice>
                  </Field>
                  <div className="road-checkbox">
                    <Checkbox
                      id="node-required"
                      checked={node.required}
                      onCheckedChange={(v) => patchNode({ required: !!v })}
                    />
                    <Label htmlFor="node-required">
                      必修节点，计入路线总进度
                    </Label>
                  </div>
                  <Field>
                    学习目标
                    <Textarea
                      rows={2}
                      maxLength={2000}
                      value={node.goal}
                      placeholder="学完这一步，应该掌握什么？"
                      onChange={(e) => patchNode({ goal: e.target.value })}
                    />
                  </Field>
                  <Field>
                    学习说明
                    <Textarea
                      rows={4}
                      maxLength={5000}
                      value={node.description}
                      onChange={(e) =>
                        patchNode({ description: e.target.value })
                      }
                    />
                  </Field>
                  <Field>
                    实践任务
                    <Textarea
                      rows={3}
                      maxLength={3000}
                      value={node.task}
                      placeholder="安排一个可以动手完成的小任务。"
                      onChange={(e) => patchNode({ task: e.target.value })}
                    />
                  </Field>
                  <section>
                    <h3>建议先学</h3>
                    <p className="road-muted">只提示学习顺序，不限制跳学。</p>
                    <Choice
                      aria-label="添加前置节点"
                      value=""
                      onChange={(e) =>
                        e.target.value &&
                        connect({ source: e.target.value, target: node.id })
                      }
                    >
                      <option value="">选择前置节点…</option>
                      {doc.nodes
                        .filter(
                          (n) =>
                            n.id !== node.id &&
                            !doc.edges.some(
                              (e) => e.source === n.id && e.target === node.id,
                            ),
                        )
                        .map((n) => (
                          <option key={n.id} value={n.id}>
                            {n.title}
                          </option>
                        ))}
                    </Choice>
                    {doc.edges
                      .filter((e) => e.target === node.id)
                      .map((e) => (
                        <div className="road-ref-row" key={e.id}>
                          <span>
                            {doc.nodes.find((n) => n.id === e.source)?.title}
                          </span>
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={`移除前置 ${doc.nodes.find((n) => n.id === e.source)?.title}`}
                            onClick={() => removeEdges([e.id])}
                          >
                            <X size={15} />
                          </Button>
                        </div>
                      ))}
                  </section>
                  <section>
                    <h3>站内资料</h3>
                    <Input
                      aria-label="搜索关联资料"
                      placeholder="搜索资料标题…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                    {resourceError ? (
                      <>
                        <ErrorBox>{resourceError}</ErrorBox>
                        <Button variant="outline" onClick={refresh}>
                          重试加载资料
                        </Button>
                      </>
                    ) : (
                      search && (
                        <div className="road-resource-results">
                          {library
                            .filter(
                              (r) =>
                                !r.hidden &&
                                !node.resourceIds.includes(r.id) &&
                                r.title
                                  .toLowerCase()
                                  .includes(search.toLowerCase()),
                            )
                            .slice(0, 8)
                            .map((r) => (
                              <Button
                                key={r.id}
                                variant="ghost"
                                disabled={node.resourceIds.length >= 30}
                                onClick={() => {
                                  patchNode({
                                    resourceIds: [...node.resourceIds, r.id],
                                  });
                                  setSearch("");
                                }}
                              >
                                <Plus size={14} />
                                {r.title}
                              </Button>
                            ))}
                          {!library.some(
                            (r) =>
                              !r.hidden &&
                              !node.resourceIds.includes(r.id) &&
                              r.title
                                .toLowerCase()
                                .includes(search.toLowerCase()),
                          ) && (
                            <p className="road-muted">没有找到可添加的资料。</p>
                          )}
                        </div>
                      )
                    )}
                    {node.resourceIds.map((id) => (
                      <div className="road-ref-row" key={id}>
                        {nodeResources[id] ? (
                          <AppLink to={`/resources/${id}`} target="_blank">
                            {nodeResources[id].title}
                          </AppLink>
                        ) : (
                          <span>资料不可用</span>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`移除资料 ${nodeResources[id]?.title || "不可用资料"}`}
                          onClick={() =>
                            patchNode({
                              resourceIds: node.resourceIds.filter(
                                (x) => x !== id,
                              ),
                            })
                          }
                        >
                          <X size={15} />
                        </Button>
                      </div>
                    ))}
                  </section>
                  <section>
                    <h3>外部链接</h3>
                    {node.links.map((l, i) => (
                      <div className="road-ref-row" key={i}>
                        <a
                          href={l.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {l.title}
                        </a>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`移除外链 ${l.title}`}
                          onClick={() =>
                            patchNode({
                              links: node.links.filter((_, j) => i !== j),
                            })
                          }
                        >
                          <X size={15} />
                        </Button>
                      </div>
                    ))}
                    <Field>
                      外链名称
                      <Input
                        value={linkTitle}
                        maxLength={120}
                        onChange={(e) => setLinkTitle(e.target.value)}
                      />
                    </Field>
                    <Field>
                      外链网址
                      <Input
                        value={linkUrl}
                        maxLength={2000}
                        placeholder="https://"
                        aria-invalid={!!linkError}
                        aria-describedby={
                          linkError ? "road-link-error" : undefined
                        }
                        onChange={(e) => setLinkUrl(e.target.value)}
                      />
                    </Field>
                    <ErrorBox id="road-link-error">{linkError}</ErrorBox>
                    <Button
                      variant="outline"
                      disabled={node.links.length >= 30}
                      onClick={() => {
                        try {
                          const u = new URL(linkUrl);
                          if (
                            !linkTitle.trim() ||
                            !["http:", "https:"].includes(u.protocol) ||
                            u.username ||
                            u.password
                          )
                            throw Error();
                          patchNode({
                            links: [
                              ...node.links,
                              { title: linkTitle.trim(), url: u.href },
                            ],
                          });
                          setLinkTitle("");
                          setLinkUrl("");
                          setLinkError("");
                        } catch {
                          setLinkError(
                            "请填写链接名称和有效的 HTTP 或 HTTPS 网址",
                          );
                        }
                      }}
                    >
                      添加外链
                    </Button>
                  </section>
                </>
              )}
            </fieldset>
          </aside>
        )}
      </div>
      <Confirm value={confirm} close={() => setConfirm(null)} />
    </div>
  );
}
