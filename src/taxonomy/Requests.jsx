import React, { useState, useEffect, useRef } from "react";
import { useApp } from "../context";
import { api, send } from "../api";
import { Button } from "../components/ui/button";
import { Textarea } from "../components/ui/textarea";
import { Badge } from "../components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../components/ui/dialog";
import {
  Choice,
  Field,
  Loading,
  ErrorBox,
  Empty,
  AppLink,
} from "../components/shared";
import RequestDialog, { requestKinds } from "./RequestDialog";
import "./taxonomy.css";
const statuses = {
  pending: "待审核",
  approved: "已通过",
  rejected: "已驳回",
  withdrawn: "已撤回",
};
export default function Requests({ review = false }) {
  const { user, notify, refreshTaxonomy } = useApp();
  const [status, setStatus] = useState(review ? "pending" : ""),
    [page, setPage] = useState(1),
    [data, setData] = useState(null),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0),
    [create, setCreate] = useState(false),
    [modal, setModal] = useState(null),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false),
    [reviewError, setReviewError] = useState("");
  const trigger = useRef();
  const reload = () => setRevision((n) => n + 1);
  useEffect(() => {
    if (review && user.role !== "admin") return;
    let live = true;
    setError("");
    api(
      `/taxonomy/requests?scope=${review ? "review" : "mine"}&status=${status}&page=${page}`,
    )
      .then((r) => live && setData(r))
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [status, page, revision, review, user.role]);
  useEffect(() => {
    addEventListener("focus", reload);
    return () => removeEventListener("focus", reload);
  }, []);
  if (review && user.role !== "admin")
    return (
      <Empty title="需要管理员权限" description="只有管理员可以审核选项申请。">
        <AppLink to="/requests" variant="outline">
          查看我的申请
        </AppLink>
      </Empty>
    );
  const open = (r, decision) => {
    trigger.current = document.activeElement;
    setNote("");
    setReviewError("");
    setModal({ request: r, decision });
  };
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setReviewError("");
    try {
      await send(
        `/taxonomy/requests/${modal.request.id}/${modal.decision === "withdrawn" ? "withdraw" : "review"}`,
        { version: modal.request.version, decision: modal.decision, note },
      );
      setModal(null);
      await refreshTaxonomy();
      reload();
      notify(
        modal.decision === "approved"
          ? "审核通过，选项已可使用"
          : modal.decision === "rejected"
            ? "已驳回，申请人可查看原因"
            : "申请已撤回",
      );
    } catch (e) {
      setReviewError(e.message);
      reload();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="taxonomy-page">
      <div className="page-heading">
        <div>
          <h1>{review ? "选项申请审核" : "我的选项申请"}</h1>
          <p>
            {review
              ? "审核成员提出的分类与标签，保持队伍知识目录清晰。"
              : "申请新的资料库、课程／技术方向或标签，查看管理员的审核结果。"}
          </p>
        </div>
        {!review && (
          <Button onClick={() => setCreate(true)}>申请新增选项</Button>
        )}
      </div>
      <div className="taxonomy-toolbar">
        <Choice
          aria-label="申请状态"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">全部状态</option>
          {Object.entries(statuses).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </Choice>
        <Button variant="outline" onClick={reload}>
          刷新申请
        </Button>
        {review && data && (
          <span role="status">{data.pendingCount} 条待审核</span>
        )}
        <AppLink to={review ? "/admin/taxonomy" : "/resources/new"}>
          {review ? "分类与标签管理" : "返回上传资料"}
        </AppLink>
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
      {!data && !error ? (
        <Loading />
      ) : (
        data && (
          <>
            <div className="taxonomy-list">
              {data.requests.map((r) => (
                <article className="taxonomy-row request-row" key={r.id}>
                  <div>
                    <div className="request-title">
                      <strong>{r.name}</strong>
                      <Badge
                        variant={
                          r.status === "rejected" ? "destructive" : "secondary"
                        }
                      >
                        {statuses[r.status]}
                      </Badge>
                    </div>
                    <small>
                      {requestKinds[r.kind]}
                      {r.parentName ? ` · ${r.parentName}` : ""} ·{" "}
                      {review ? `${r.applicant} · ` : ""}
                      {new Date(r.created_at).toLocaleString("zh-CN")}
                    </small>
                    {r.reason && <p>申请说明：{r.reason}</p>}
                    {r.review_note && <p>审核说明：{r.review_note}</p>}
                    {r.reviewer && (
                      <small>
                        审核人：{r.reviewer} ·{" "}
                        {new Date(r.reviewed_at).toLocaleString("zh-CN")}
                      </small>
                    )}
                    {r.status === "approved" && (
                      <p>
                        {r.optionAvailable
                          ? "选项已可使用，请回到资料或路线表单选择。"
                          : "审核通过的选项后来已被调整或删除，请查看当前选项列表。"}
                      </p>
                    )}
                  </div>
                  {r.status === "pending" && (
                    <div className="taxonomy-actions">
                      {review ? (
                        <>
                          <Button
                            variant="outline"
                            onClick={() => open(r, "rejected")}
                          >
                            驳回
                          </Button>
                          <Button onClick={() => open(r, "approved")}>
                            通过
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="outline"
                          onClick={() => open(r, "withdrawn")}
                        >
                          撤回申请
                        </Button>
                      )}
                    </div>
                  )}
                </article>
              ))}
              {!data.requests.length && (
                <div className="taxonomy-empty">
                  {review
                    ? "当前没有待处理的匹配申请。"
                    : "暂无匹配的申请，可从这里提交新的选项。"}
                </div>
              )}
            </div>
            {data.total > 20 && (
              <nav className="request-pagination" aria-label="申请分页">
                <Button
                  variant="outline"
                  disabled={page === 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  上一页
                </Button>
                <span>
                  {page} / {Math.ceil(data.total / 20)}
                </span>
                <Button
                  variant="outline"
                  disabled={page * 20 >= data.total}
                  onClick={() => setPage((p) => p + 1)}
                >
                  下一页
                </Button>
              </nav>
            )}
          </>
        )
      )}
      {create && (
        <RequestDialog
          onClose={() => setCreate(false)}
          onSuccess={(r) => {
            reload();
            notify(
              r.reused ? "这项申请正在审核中" : "申请已提交，等待管理员审核",
            );
          }}
        />
      )}
      <Dialog
        open={!!modal}
        onOpenChange={(v) => !v && !busy && setModal(null)}
      >
        <DialogContent
          className="taxonomy-dialog"
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
              {modal?.decision === "approved"
                ? "通过申请"
                : modal?.decision === "rejected"
                  ? "驳回申请"
                  : "撤回申请"}
            </DialogTitle>
            <DialogDescription>
              {modal?.request.name} ·{" "}
              {modal?.decision === "approved"
                ? "通过后加入共享选项；若已有同名选项则复用，不重复创建。"
                : modal?.decision === "rejected"
                  ? "请说明原因，申请人可以据此重新提交。"
                  : "撤回后管理员不能继续审核，需要时可以重新申请。"}
            </DialogDescription>
          </DialogHeader>
          {modal && (
            <form onSubmit={submit}>
              {modal.decision !== "withdrawn" && (
                <Field>
                  审核说明
                  <Textarea
                    required={modal.decision === "rejected"}
                    maxLength={500}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={
                      modal.decision === "rejected"
                        ? "填写驳回原因（必填）"
                        : "审核备注（选填）"
                    }
                  />
                </Field>
              )}
              <ErrorBox>{reviewError}</ErrorBox>
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
                  disabled={busy}
                  variant={
                    modal.decision === "approved" ? "default" : "destructive"
                  }
                >
                  {busy
                    ? "正在处理…"
                    : modal.decision === "approved"
                      ? "确认通过"
                      : modal.decision === "rejected"
                        ? "确认驳回"
                        : "确认撤回"}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
