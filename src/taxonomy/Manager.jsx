import React, { useState, useRef } from "react";
import { Plus, Pencil, Trash2, Settings2 } from "lucide-react";
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
const labels = { domain: "资料库", category: "课程／技术方向", tag: "标签" };
export default function Manager() {
  const { user, taxonomy, taxonomyError, refreshTaxonomy, refresh, notify } =
    useApp();
  const [kind, setKind] = useState("domain"),
    [search, setSearch] = useState(""),
    [parent, setParent] = useState(""),
    [modal, setModal] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const trigger = useRef();
  if (user.role !== "admin")
    return (
      <Empty
        title="需要管理员权限"
        description="只有管理员可以改名、合并和删除分类或标签。"
      >
        <AppLink variant="outline" to="/">
          返回资料中心
        </AppLink>
      </Empty>
    );
  const options =
    taxonomy[
      kind === "domain"
        ? "domains"
        : kind === "category"
          ? "categories"
          : "tags"
    ];
  const shown = options.filter(
    (o) =>
      o.name.toLowerCase().includes(search.toLowerCase()) &&
      (!parent || kind !== "category" || o.parent_id === parent),
  );
  const openEdit = (option) => {
    trigger.current = document.activeElement;
    setError("");
    setModal({
      mode: option ? "edit" : "add",
      kind,
      option,
      name: option?.name || "",
      parentId: option?.parent_id || parent || taxonomy.domains[0]?.id || "",
      position: option?.position || 0,
      revision: taxonomy.revision,
    });
  };
  const openDelete = async (option) => {
    trigger.current = document.activeElement;
    setBusy(true);
    setError("");
    try {
      const r = await api(`/taxonomy/options/${option.id}/impact`);
      setModal({
        mode: "delete",
        kind,
        option,
        targetId: "",
        impact: r.impact,
        revision: r.revision,
      });
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  };
  const update = (values) => setModal((m) => ({ ...m, ...values }));
  const reload = async () => {
    const t = await refreshTaxonomy();
    if (!t) return;
    if (modal) {
      if (modal.mode === "delete") {
        try {
          const r = await api(`/taxonomy/options/${modal.option.id}/impact`);
          update({ impact: r.impact, revision: r.revision });
        } catch (e) {
          setError(e.message);
          return;
        }
      } else update({ revision: t.revision });
    }
    setError("");
    await refresh();
  };
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (modal.mode === "delete")
        await send(
          `/taxonomy/options/${modal.option.id}`,
          { revision: modal.revision, targetId: modal.targetId || undefined },
          "DELETE",
        );
      else if (modal.mode === "edit")
        await send(
          `/taxonomy/options/${modal.option.id}`,
          {
            revision: modal.revision,
            name: modal.name,
            parentId: modal.parentId,
            position: Number(modal.position),
          },
          "PATCH",
        );
      else
        await send("/taxonomy/options", {
          revision: modal.revision,
          kind: modal.kind,
          name: modal.name,
          parentId: modal.parentId,
        });
      await refreshTaxonomy();
      await refresh();
      setModal(null);
      notify(
        modal.mode === "delete"
          ? "选项及其引用已处理"
          : "选项已保存，全站已同步",
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const needsTarget =
    modal?.mode === "delete" &&
    modal.kind !== "tag" &&
    Object.values(modal.impact).some(Boolean);
  return (
    <div className="taxonomy-page">
      <div className="page-heading">
        <div>
          <h1>分类与标签管理</h1>
          <p>统一维护资料与学习路线的分类，让每一份知识都有清晰归属。</p>
        </div>
        <AppLink variant="outline" to="/admin/taxonomy/requests">
          审核成员申请
        </AppLink>
      </div>
      {taxonomyError && <ErrorBox>{taxonomyError}</ErrorBox>}
      <Tabs
        value={kind}
        onValueChange={(v) => {
          setKind(v);
          setSearch("");
          setParent("");
        }}
      >
        <TabsList aria-label="选项类型">
          <TabsTrigger value="domain">资料库</TabsTrigger>
          <TabsTrigger value="category">课程／技术方向</TabsTrigger>
          <TabsTrigger value="tag">标签</TabsTrigger>
        </TabsList>
        <TabsContent value={kind}>
          <div className="taxonomy-toolbar">
            <Input
              aria-label="搜索管理选项"
              placeholder={`搜索${labels[kind]}…`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {kind === "category" && (
              <Choice
                aria-label="管理资料库筛选"
                value={parent}
                onChange={(e) => setParent(e.target.value)}
              >
                <option value="">全部资料库</option>
                {taxonomy.domains.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Choice>
            )}
            <Button
              onClick={() => openEdit()}
              disabled={
                busy || (kind === "category" && !taxonomy.domains.length)
              }
            >
              <Plus size={17} />
              新增{labels[kind]}
            </Button>
            <Button variant="outline" onClick={reload} disabled={busy}>
              刷新
            </Button>
          </div>
          <div className="taxonomy-list">
            {shown.map((option) => (
              <div className="taxonomy-row" key={option.id}>
                <div>
                  <strong>{option.name}</strong>
                  <small>
                    {kind === "category"
                      ? taxonomy.domains.find((d) => d.id === option.parent_id)
                          ?.name
                      : kind === "domain"
                        ? `${taxonomy.categories.filter((c) => c.parent_id === option.id).length} 个课程／方向`
                        : "资料与学习路线共用"}{" "}
                    · 排序 {option.position}
                  </small>
                </div>
                <div className="taxonomy-actions">
                  <Button variant="outline" onClick={() => openEdit(option)}>
                    <Pencil size={15} />
                    编辑
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => openDelete(option)}
                  >
                    <Trash2 size={15} />
                    {kind === "tag" ? "合并／删除" : "删除"}
                  </Button>
                </div>
              </div>
            ))}
            {!shown.length && (
              <div className="taxonomy-empty">
                没有匹配的选项，可在这里新增。
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
      <Dialog
        open={!!modal}
        onOpenChange={(v) => !v && !busy && setModal(null)}
      >
        <DialogContent
          className="taxonomy-dialog"
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            requestAnimationFrame(() => {
              if (trigger.current?.isConnected) trigger.current.focus();
              else document.getElementById("main")?.focus();
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {modal?.mode === "delete"
                ? "删除或迁移"
                : modal?.mode === "edit"
                  ? "编辑"
                  : "新增"}
              {labels[modal?.kind]}
            </DialogTitle>
            <DialogDescription>
              {modal?.mode === "delete"
                ? "处理选项及其引用，资料文件、路线内容和学习进度会保留。"
                : "修改后会同步到导航、分类筛选、资料和学习路线。排序数字越小越靠前。"}
            </DialogDescription>
          </DialogHeader>
          {modal && (
            <form onSubmit={submit}>
              {modal.mode === "delete" ? (
                <>
                  <div className="taxonomy-impact">
                    <strong>{modal.option.name}</strong>
                    <p>
                      引用：{modal.impact.resources} 份资料、
                      {modal.impact.roadmaps} 条路线、{modal.impact.categories}{" "}
                      个下属分类。
                    </p>
                    {modal.kind === "domain" ? (
                      <p>
                        迁入目标库后保留下属课程；同名课程合并，已有引用一起迁移。
                      </p>
                    ) : modal.kind === "tag" ? (
                      <p>
                        选择目标标签将合并引用；不选择则从资料和路线中移除此标签。
                      </p>
                    ) : (
                      <p>已使用的分类需要选择新的课程／方向承接引用。</p>
                    )}
                  </div>
                  <Field>
                    {modal.kind === "tag" ? "合并到标签" : "迁移目标"}
                    <Choice
                      value={modal.targetId}
                      onChange={(e) => update({ targetId: e.target.value })}
                    >
                      <option value="">
                        {modal.kind === "tag"
                          ? "不合并，移除标签引用"
                          : "请选择迁移目标"}
                      </option>
                      {taxonomy[
                        modal.kind === "domain"
                          ? "domains"
                          : modal.kind === "category"
                            ? "categories"
                            : "tags"
                      ]
                        .filter((x) => x.id !== modal.option.id)
                        .map((x) => (
                          <option key={x.id} value={x.id}>
                            {modal.kind === "category"
                              ? `${taxonomy.domains.find((d) => d.id === x.parent_id)?.name} / `
                              : ""}
                            {x.name}
                          </option>
                        ))}
                    </Choice>
                  </Field>
                </>
              ) : (
                <>
                  <Field>
                    名称
                    <Input
                      required
                      maxLength={modal.kind === "tag" ? 30 : 60}
                      value={modal.name}
                      onChange={(e) => update({ name: e.target.value })}
                    />
                  </Field>
                  {modal.kind === "category" && (
                    <Field>
                      所属资料库
                      <Choice
                        value={modal.parentId}
                        onChange={(e) => update({ parentId: e.target.value })}
                      >
                        {taxonomy.domains.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </Choice>
                    </Field>
                  )}
                  {modal.mode === "edit" && (
                    <Field>
                      排序
                      <Input
                        type="number"
                        min="0"
                        max="100000"
                        required
                        value={modal.position}
                        onChange={(e) => update({ position: e.target.value })}
                      />
                    </Field>
                  )}
                </>
              )}
              <ErrorBox>{error}</ErrorBox>
              {error && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={reload}
                  disabled={busy}
                >
                  读取最新选项
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
                  disabled={busy || (needsTarget && !modal.targetId)}
                >
                  {busy
                    ? "正在处理…"
                    : modal.mode === "delete"
                      ? modal.targetId
                        ? "迁移并删除"
                        : "确认删除"
                      : "保存选项"}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
