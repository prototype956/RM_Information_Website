import ClassificationFields from "../taxonomy/Fields";
import { TagPicker } from "../taxonomy/TagPicker";
import { defaultSelection } from "../taxonomy/helpers";
import React, { useState, useEffect, useRef } from "react";
import {
  ArrowUpRight,
  ChevronRight,
  X,
  Upload,
  FileText,
  Link2,
  Check,
  LoaderCircle,
  BookOpen,
  ShieldCheck,
} from "lucide-react";
import { api, send, uploadResource, size } from "../api";
import { useApp } from "../context";

import {
  AppLink,
  IconButton,
  Loading,
  ErrorBox,
  Empty,
  Field,
  Choice,
} from "../components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import { Progress } from "@/components/ui/progress";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export default function ResourceForm({ id }) {
  const { user, refresh, go, notify, taxonomy, refreshTaxonomy } = useApp();
  const tagPicker = useRef();
  const [form, setForm] = useState({
    title: "",
    domain: "",
    category: "",
    categoryId: "",
    tagIds: [],
    tags: "",
    description: "",
    kind: "file",
    url: "",
  });
  const [files, setFiles] = useState([]),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [error, setError] = useState(""),
    [initial, setInitial] = useState(!!id),
    [forbidden, setForbidden] = useState(false),
    [drag, setDrag] = useState(false);
  const input = useRef();
  useEffect(() => {
    if (!id && !form.domain && taxonomy.domains.length)
      setForm((f) => ({ ...f, ...defaultSelection(taxonomy) }));
  }, [taxonomy.revision]);
  useEffect(() => {
    if (id)
      api(`/resources/${id}`)
        .then(({ resource: r }) => {
          if (user.role !== "admin" && r.owner_id !== user.id) {
            setForbidden(true);
            return;
          }
          setForm(r);
        })
        .catch((e) => {
          setError(e.message);
          refreshTaxonomy();
          setForbidden(true);
        })
        .finally(() => setInitial(false));
  }, [id]);
  const set = (key, value) =>
    setForm((f) => ({
      ...f,
      [key]: value,
    }));
  const choose = (selected) => {
    const next = [...files, ...Array.from(selected)];
    if (next.length > 5) {
      setError("每份资料最多包含 5 个文件");
      return;
    }
    if (next.some((f) => f.size > 50 * 1048576)) {
      setError("单个文件不能超过 50 MB");
      return;
    }
    setFiles(next);
    setError("");
  };
  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (form.kind === "file" && !id && !files.length) {
      setError("请至少选择一个文件");
      return;
    }
    if (form.kind === "link") {
      try {
        const u = new URL(form.url);
        if (
          !["http:", "https:"].includes(u.protocol) ||
          u.username ||
          u.password
        )
          throw 0;
      } catch {
        setError("请填写以 http:// 或 https:// 开头的有效链接");
        return;
      }
    }
    setBusy(true);
    try {
      const payload = {
        title: form.title,
        domain: form.domain,
        category: form.category,
        kind: form.kind,
        url: form.url,
        description: form.description,
        categoryId: form.categoryId,
        tagIds: JSON.stringify(await tagPicker.current.commit()),
        tags: "[]",
      };
      let result;
      if (id) {
        result = await send(`/resources/${id}`, payload, "PATCH");
      } else {
        const body = new FormData();
        for (const key of [
          "title",
          "domain",
          "category",
          "categoryId",
          "tagIds",
          "tags",
          "description",
          "kind",
          "url",
        ])
          body.append(key, payload[key]);
        if (form.kind === "file")
          files.forEach((file) => body.append("files", file));
        result = await uploadResource(body, setProgress);
      }
      await refresh();
      notify(id ? "资料已更新" : "资料已发布，队友现在可以查看");
      go(`/resources/${id || result.id}`);
    } catch (e) {
      setError(e.message);
      refreshTaxonomy();
    } finally {
      setBusy(false);
    }
  };
  if (initial) return <Loading />;
  if (forbidden)
    return (
      <Empty
        title="无法编辑资料"
        description={error || "只有贡献者和管理员可以编辑这份资料。"}
      >
        <AppLink to="/resources" variant="outline">
          返回资料库
        </AppLink>
      </Empty>
    );
  return (
    <>
      <div className="page-breadcrumb">
        <AppLink to="/resources">资料中心</AppLink>
        <ChevronRight size={12} />
        <span>{id ? "编辑资料" : "分享资料"}</span>
      </div>
      <div className="page-heading">
        <div>
          <h1>{id ? "让知识持续更新。" : "你的经验，队伍的下一步。"}</h1>
          <p>
            {id
              ? "补充准确的信息，让队友更容易找到和使用。"
              : "分享一份笔记、一个链接，把探索的成果留给队友。"}
          </p>
        </div>
      </div>
      <div className="upload-layout">
        <form
          aria-describedby={error ? "resource-error" : undefined}
          className="resource-form"
          onSubmit={submit}
        >
          <fieldset disabled={busy}>
            <div className="form-section-title">
              <span>1</span>
              <h2>{id ? "资料形式" : "选择分享内容"}</h2>
            </div>
            <Tabs value={form.kind} onValueChange={(v) => set("kind", v)}>
              <TabsList className={id ? "hidden" : "kind-tabs"}>
                <TabsTrigger disabled={!!id} value="file">
                  <Upload size={18} />
                  上传文件
                </TabsTrigger>
                <TabsTrigger disabled={!!id} value="link">
                  <Link2 size={18} />
                  分享链接
                </TabsTrigger>
              </TabsList>
              <TabsContent value="link">
                <Field>
                  资料链接
                  <Input
                    aria-invalid={!!error}
                    aria-describedby={error ? "resource-error" : undefined}
                    required
                    type="url"
                    maxLength={2048}
                    placeholder="https://"
                    value={form.url}
                    onChange={(e) => set("url", e.target.value)}
                  />
                  <small>
                    支持文档网站、代码仓库、视频及其他 HTTP / HTTPS 链接。
                  </small>
                </Field>
              </TabsContent>
              <TabsContent value="file">
                {!id ? (
                  <>
                    <Input
                      ref={input}
                      type="file"
                      multiple
                      className="hidden-file"
                      tabIndex={-1}
                      aria-label="选择上传文件"
                      onChange={(e) => {
                        choose(e.target.files);
                        e.target.value = "";
                      }}
                    />
                    <Button
                      variant="outline"
                      type="button"
                      className={`dropzone ${drag ? "dragging" : ""}`}
                      onClick={() => input.current.click()}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDrag(true);
                      }}
                      onDragLeave={() => setDrag(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDrag(false);
                        choose(e.dataTransfer.files);
                      }}
                    >
                      <div>
                        <Upload size={27} />
                      </div>
                      <strong>点击选择，或将文件拖到这里</strong>
                      <span>
                        PDF、图片、课件、压缩包等 · 每个文件最大 50 MB
                      </span>
                      <small>每份资料最多 5 个附件</small>
                    </Button>
                    {files.length > 0 && (
                      <div className="selected-files">
                        {files.map((file, i) => (
                          <div key={i}>
                            <FileText size={17} />
                            <span>
                              {file.name}
                              <small>{size(file.size)}</small>
                            </span>
                            <IconButton
                              label={`移除 ${file.name}`}
                              onClick={() =>
                                setFiles(files.filter((_, n) => n !== i))
                              }
                            >
                              <X size={15} />
                            </IconButton>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="info-strip">
                    <FileText size={17} />
                    现有附件保留。需要更换文件时，请发布新资料并说明版本。
                  </div>
                )}
              </TabsContent>
            </Tabs>
            <div className="form-section-title">
              <span>2</span>
              <h2>让资料更容易被找到</h2>
            </div>
            <Field>
              资料标题 <em>必填</em>
              <Input
                required
                maxLength={120}
                placeholder="例如：STM32 定时器与 PWM 学习笔记"
                value={form.title}
                onChange={(e) => set("title", e.target.value)}
              />
            </Field>
            <ClassificationFields
              value={form}
              onChange={(fields) => setForm((f) => ({ ...f, ...fields }))}
            />
            <TagPicker
              ref={tagPicker}
              value={form.tagIds}
              onChange={(tagIds) => setForm((f) => ({ ...f, tagIds }))}
            />
            <Field>
              资料简介
              <Textarea
                rows={5}
                maxLength={5000}
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
                placeholder="介绍包含哪些内容、适合谁阅读，以及需要注意的版本信息。"
              />
            </Field>
          </fieldset>
          <ErrorBox id="resource-error">{error}</ErrorBox>
          {busy && !id && (
            <div className="upload-progress">
              <Progress value={progress} aria-label="文件上传进度" />
              <span role="status">
                {progress === 100 ? "正在保存资料…" : `正在上传 ${progress}%`}
              </span>
            </div>
          )}
          <div className="form-footer">
            <span>
              <ShieldCheck size={14} />
              发布后仅队伍成员可见
            </span>
            <Button disabled={busy}>
              {busy ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <ArrowUpRight size={16} />
              )}{" "}
              {busy
                ? "正在保存…"
                : error
                  ? "重试发布"
                  : id
                    ? "保存修改"
                    : "发布资料"}
            </Button>
          </div>
        </form>
        <aside className="upload-tips">
          <div className="tips-icon">
            <BookOpen size={26} />
          </div>
          <h2>
            好的分享，
            <br />
            从清晰开始。
          </h2>
          <p>让下一位打开资料的队友，少走一点弯路。</p>
          <div>
            <Check size={15} />
            <p>
              <strong>一个准确的标题</strong>把课程、技术主题或版本写清楚。
            </p>
          </div>
          <div>
            <Check size={15} />
            <p>
              <strong>选对分类和标签</strong>帮助队友在需要的时候找到它。
            </p>
          </div>
          <div>
            <Check size={15} />
            <p>
              <strong>说明适用范围</strong>补充前置知识、来源和更新时间。
            </p>
          </div>
          <span className="tips-footer">KNOWLEDGE GROWS WHEN SHARED.</span>
        </aside>
      </div>
    </>
  );
}
