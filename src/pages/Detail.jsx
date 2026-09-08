import React, { useState, useEffect, lazy, Suspense } from "react";
import {
  ArrowUpRight,
  ArrowLeft,
  ChevronRight,
  Bookmark,
  FileText,
  Link2,
  Download,
  Copy,
  ExternalLink,
  Trash2,
  Pencil,
  EyeOff,
  Eye,
} from "lucide-react";
import { api, send, fullDate, size } from "../api";
import { useApp } from "../context";

import {
  AppLink,
  IconButton,
  Loading,
  Empty,
  FileBadge,
} from "../components/shared";
import { Button } from "@/components/ui/button";

import { Badge } from "@/components/ui/badge";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
const Preview = lazy(() => import("../Preview"));
export default function Detail({ id }) {
  const { user, resources, refresh, notify, go, route, favorite, taxonomy } =
    useApp();
  const [item, setItem] = useState(null),
    [error, setError] = useState(""),
    [deleting, setDeleting] = useState(false),
    [busy, setBusy] = useState(false),
    [linkHelp, setLinkHelp] = useState(false);
  useEffect(() => {
    setItem(null);
    setError("");
    api(`/resources/${id}`)
      .then((r) => {
        setItem(r.resource);
        refresh();
      })
      .catch((e) => setError(e.message));
  }, [id, taxonomy.revision]);
  const data = item
    ? {
        ...item,
        favorite: resources.find((r) => r.id === id)?.favorite ?? item.favorite,
      }
    : null;
  if (error)
    return (
      <Empty title="无法打开这份资料" description={error}>
        <AppLink variant="outline" to="/resources">
          返回资料库
        </AppLink>
      </Empty>
    );
  if (!data) return <Loading />;
  const canEdit = user.role === "admin" || data.owner_id === user.id;
  const from = new URLSearchParams(route.split("?")[1]).get("from");
  const back =
    from &&
    (from === "/" || /^\/(resources|favorites|uploads)(\?|$)/.test(from))
      ? from
      : "/resources";
  const remove = async () => {
    setBusy(true);
    try {
      await api(`/resources/${id}`, { method: "DELETE" });
      await refresh();
      notify("资料已删除");
      go(back);
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  };
  const hide = async () => {
    try {
      await send(`/resources/${id}`, { hidden: !data.hidden }, "PATCH");
      setItem({ ...item, hidden: !data.hidden });
      refresh();
      notify(data.hidden ? "资料已重新上架" : "资料已下架");
    } catch (e) {
      notify(e.message);
    }
  };
  return (
    <>
      <div className="page-breadcrumb">
        <AppLink to={back}>
          <ArrowLeft size={13} />
          返回资料列表
        </AppLink>
        <ChevronRight size={12} />
        <span>{data.category}</span>
      </div>
      <div className="detail-heading">
        <div className="detail-title">
          <FileBadge resource={data} />
          <div>
            <div className="detail-tags">
              <Badge variant="secondary">{data.category}</Badge>
              {!!data.sample && <Badge variant="secondary">示例资料</Badge>}
              {!!data.hidden && <Badge variant="secondary">已下架</Badge>}
            </div>
            <h1>{data.title}</h1>
            <p>
              {data.author} 分享 · 更新于 {fullDate(data.updated_at)}
            </p>
          </div>
        </div>
        <div className="detail-actions">
          <Button
            variant="outline"
            className={`button ${data.favorite ? "saved" : ""}`}
            onClick={() => favorite(data)}
          >
            <Bookmark
              size={16}
              fill={data.favorite ? "currentColor" : "none"}
            />
            {data.favorite ? "已收藏" : "收藏资料"}
          </Button>
          <IconButton
            label="复制资料链接"
            onClick={() =>
              navigator.clipboard
                .writeText(`${location.origin}/resources/${id}`)
                .then(() => notify("资料链接已复制，仅队伍成员可访问"))
                .catch(() => notify("复制失败，请复制地址栏链接"))
            }
          >
            <Copy size={17} />
          </IconButton>
        </div>
      </div>
      <div className="detail-layout">
        <section className="preview-section">
          <div className="preview-toolbar">
            <span>
              {data.kind === "link" ? (
                <Link2 size={16} />
              ) : (
                <FileText size={16} />
              )}{" "}
              {data.kind === "link" ? "外部资源" : "资料预览"}
            </span>
            <span>仅队伍成员可见</span>
          </div>
          {data.kind === "link" ? (
            <div className="link-preview">
              <div className="link-orbit">
                <ExternalLink size={32} />
              </div>
              <span className="eyebrow">CONNECTED KNOWLEDGE</span>
              <h2>{new URL(data.url).hostname}</h2>
              <p>
                这份资料由外部网站提供。
                <br />
                点击下方按钮，在新标签页中继续阅读。
              </p>
              <Button asChild>
                <a href={data.url} target="_blank" rel="noopener noreferrer">
                  访问原始资料
                  <ArrowUpRight size={17} />
                </a>
              </Button>
              <Button
                variant="ghost"
                className="text-button link-help"
                onClick={() => setLinkHelp(!linkHelp)}
              >
                链接无法访问？
              </Button>
              {linkHelp && (
                <p className="link-help-note" role="status">
                  外部链接可能迁移、需要登录或暂时不可用。请联系贡献者{" "}
                  {data.author} 更新地址；本站无法实时验证外站状态。
                </p>
              )}
            </div>
          ) : (
            <Suspense fallback={<Loading text="正在加载预览器…" />}>
              <Preview attachments={data.attachments} />
            </Suspense>
          )}
        </section>
        <aside className="detail-info">
          <h2>关于这份资料</h2>
          <p className="description">
            {data.description || "贡献者暂未填写简介。"}
          </p>
          <dl>
            <div>
              <dt>所属资料库</dt>
              <dd>
                {data.domainName ||
                  taxonomy.domains.find((d) => d.id === data.domain)?.name}
              </dd>
            </div>
            <div>
              <dt>课程 / 方向</dt>
              <dd>{data.category}</dd>
            </div>
            <div>
              <dt>贡献者</dt>
              <dd>{data.author}</dd>
            </div>
            <div>
              <dt>创建日期</dt>
              <dd>{fullDate(data.created_at)}</dd>
            </div>
          </dl>
          <div className="tags">
            {data.tags.map((t) => (
              <AppLink key={t} to={`/resources?tag=${encodeURIComponent(t)}`}>
                {t}
              </AppLink>
            ))}
          </div>
          {data.attachments.length > 0 && (
            <div className="attachment-list">
              <h3>
                附件 <span>{data.attachments.length}</span>
              </h3>
              {data.attachments.map((a) => (
                <a
                  key={a.id}
                  href={`/api/files/${a.id}`}
                  className="attachment"
                  download
                >
                  <FileText size={17} />
                  <span>
                    {a.name}
                    <small>{size(a.size)}</small>
                  </span>
                  <Download size={17} />
                </a>
              ))}
            </div>
          )}
          {canEdit && (
            <div className="manage-actions">
              <AppLink
                variant="outline"

                to={`/resources/${id}/edit`}
              >
                <Pencil size={15} />
                编辑资料
              </AppLink>
              {user.role === "admin" && (
                <Button variant="outline" onClick={hide}>
                  {data.hidden ? <Eye size={15} /> : <EyeOff size={15} />}{" "}
                  {data.hidden ? "重新上架" : "下架资料"}
                </Button>
              )}
              <Button
                variant="ghost"
                className="text-button danger"
                data-delete-trigger
                onClick={() => setDeleting(true)}
              >
                <Trash2 size={14} />
                删除资料
              </Button>
            </div>
          )}
        </aside>
      </div>
      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            document.querySelector("[data-delete-trigger]")?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>删除这份资料？</AlertDialogTitle>
            <AlertDialogDescription>
              “{data.title}”及其附件将被永久删除。其他队员将无法再访问。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>保留资料</AlertDialogCancel>
            <Button variant="destructive" disabled={busy} onClick={remove}>
              {busy ? "正在删除…" : "确认删除"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
