import React, { useState, useRef } from "react";
import { useApp } from "../context";
import { send } from "../api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../components/ui/dialog";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Field, Choice, ErrorBox } from "../components/shared";
export const requestKinds = {
  domain: "资料库",
  category: "课程／技术方向",
  tag: "标签",
};
export default function RequestDialog({ initial = {}, onClose, onSuccess }) {
  const { taxonomy, refreshTaxonomy } = useApp(),
    previous = useRef(document.activeElement);
  const [kind, setKind] = useState(initial.kind || "category"),
    [name, setName] = useState(initial.name || ""),
    [parentId, setParent] = useState(
      initial.parentId || taxonomy.domains[0]?.id || "",
    ),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const submit = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setBusy(true);
    setError("");
    try {
      const r = await send("/taxonomy/requests", {
        kind,
        name,
        parentId,
        reason,
      });
      onSuccess?.(r);
      onClose();
    } catch (e) {
      setError(e.message);
      await refreshTaxonomy();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent
        className="taxonomy-dialog"
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          requestAnimationFrame(() =>
            previous.current?.isConnected
              ? previous.current.focus()
              : document.getElementById("main")?.focus(),
          );
        }}
      >
        <DialogHeader>
          <DialogTitle>申请新增选项</DialogTitle>
          <DialogDescription>
            通过管理员审核后，选项会加入队伍共享列表。申请不会自动关联到当前资料或路线。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <Field>
            申请类型
            <Choice value={kind} onChange={(e) => setKind(e.target.value)}>
              {Object.entries(requestKinds).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Choice>
          </Field>
          <Field>
            申请名称
            <Input
              required
              maxLength={kind === "tag" ? 30 : 60}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          {kind === "category" && (
            <Field>
              所属资料库
              <Choice
                value={parentId}
                onChange={(e) => setParent(e.target.value)}
              >
                <option value="">请选择资料库</option>
                {taxonomy.domains.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Choice>
            </Field>
          )}
          <Field>
            申请说明
            <Textarea
              maxLength={500}
              rows={3}
              placeholder="说明适用内容，帮助管理员判断（选填）"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <ErrorBox>{error}</ErrorBox>
          <div className="taxonomy-actions">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onClose}
            >
              取消
            </Button>
            <Button
              type="submit"
              disabled={busy || (kind === "category" && !parentId)}
            >
              {busy ? "正在提交…" : "提交申请"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
