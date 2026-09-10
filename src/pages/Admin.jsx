import React, { useState, useEffect } from "react";
import {
  ChevronRight,
  Plus,
  Users,
  Copy,
  ShieldCheck,
  EyeOff,
  Eye,
} from "lucide-react";
import { api, send, fullDate } from "../api";
import { useApp } from "../context";

import {
  AppLink,
  ErrorBox,
  Empty,
  FileBadge,
  Field,
} from "../components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { Badge } from "@/components/ui/badge";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export default function Admin() {
  const { user, resources, refresh, notify } = useApp();
  const [invitations, setInvitations] = useState([]),
    [inviteCode, setInviteCode] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [tab, setTab] = useState("invitations");
  const load = () =>
    api("/invitations")
      .then((r) => setInvitations(r.invitations))
      .catch((e) => setError(e.message));
  useEffect(() => {
    if (user.role === "admin") load();
  }, []);
  if (user.role !== "admin")
    return (
      <Empty
        title="需要管理员权限"
        description="成员邀请和资料管理由队伍管理员负责。"
      >
        <AppLink variant="outline" to="/">
          返回资料中心
        </AppLink>
      </Empty>
    );
  const create = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await send("/invitations", {});
      setInviteCode(r.token);
      load();
      notify("邀请已创建，7 天内有效，仅可使用一次");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="page-breadcrumb">
        <span>队伍管理</span>
        <ChevronRight size={12} />
        <span>成员与资料管理</span>
      </div>
      <div className="page-heading">
        <div>
          <h1>一起维护，持续积累。</h1>
          <p>邀请新的队友加入，整理队伍的共同知识。</p>
        </div>
        <Badge variant="secondary">
          <ShieldCheck size={16} />
          管理员
        </Badge>
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="admin-tabs">
          <TabsTrigger value="invitations">成员邀请</TabsTrigger>
          <TabsTrigger value="resources">资料管理</TabsTrigger>
        </TabsList>
        <ErrorBox>{error}</ErrorBox>
        <TabsContent value="invitations" className="admin-panel">
          <h2>把知识空间交到队友手中</h2>
          <p>每个邀请仅供一位成员注册使用，7 天后自动失效。</p>
          <Button disabled={busy} onClick={create}>
            <Plus size={16} />
            {busy ? "正在创建…" : "创建邀请码"}
          </Button>
          {inviteCode && (
            <div className="invitation-result">
              <Field>
                新邀请码
                <Input
                  readOnly
                  value={inviteCode}
                  onFocus={(e) => e.target.select()}
                />
              </Field>
              <Button
                variant="outline"
                onClick={() =>
                  navigator.clipboard
                    .writeText(inviteCode)
                    .then(() => notify("邀请码已复制"))
                    .catch(() => notify("请手动选择并复制邀请码"))
                }
              >
                <Copy size={16} />
                复制邀请码
              </Button>
              <Field>
                新邀请链接
                <Input
                  readOnly
                  value={`${location.origin}/join/${inviteCode}`}
                  onFocus={(e) => e.target.select()}
                />
              </Field>
              <Button
                variant="outline"

                onClick={() =>
                  navigator.clipboard
                    .writeText(`${location.origin}/join/${inviteCode}`)
                    .then(() => notify("邀请链接已复制"))
                    .catch(() => notify("请手动选择并复制链接"))
                }
              >
                <Copy size={16} />
                复制链接
              </Button>
              <small>
                邀请码和链接只在本次创建时完整显示，请复制后分享给队友。
              </small>
            </div>
          )}
          <div className="invite-list">
            <h3>邀请记录</h3>
            {!invitations.length ? (
              <p>还没有创建邀请。</p>
            ) : (
              invitations.map((i, n) => (
                <div key={i.id}>
                  <Users size={18} />
                  <span>
                    成员邀请
                    <small>
                      {i.expires === 0
                        ? "已撤销"
                        : `到期时间：${fullDate(i.expires)}`}
                    </small>
                  </span>
                  <span
                    className={`status-tag ${!i.used && i.expires > Date.now() ? "valid" : ""}`}
                  >
                    {i.used
                      ? "已使用"
                      : i.expires < Date.now()
                        ? "已失效"
                        : "待加入"}
                  </span>
                  {!i.used && i.expires > Date.now() && (
                    <Button
                      variant="ghost"
                      className="text-button"
                      onClick={async () => {
                        try {
                          await api(`/invitations/${i.id}`, {
                            method: "DELETE",
                          });
                          load();
                          notify("邀请已撤销");
                        } catch (e) {
                          setError(e.message);
                        }
                      }}
                    >
                      撤销
                    </Button>
                  )}
                </div>
              ))
            )}
          </div>
        </TabsContent>
        <TabsContent value="resources" className="admin-panel">
          <h2>资料管理</h2>
          <p>下架后，资料仅对贡献者及管理员可见；需要时可以重新上架。</p>
          <div className="admin-resources">
            {resources.length ? (
              resources.map((r) => (
                <div key={r.id}>
                  <FileBadge resource={r} />
                  <AppLink to={`/resources/${r.id}`}>
                    <strong>{r.title}</strong>
                    <small>
                      {r.author} · {r.category}
                      {r.sample ? " · 示例资料" : ""}
                    </small>
                  </AppLink>
                  <Button
                    variant="outline"
                    className=" small"
                    onClick={async () => {
                      try {
                        await send(
                          `/resources/${r.id}`,
                          { hidden: !r.hidden },
                          "PATCH",
                        );
                        refresh();
                        notify(r.hidden ? "已重新上架" : "已下架");
                      } catch (e) {
                        notify(e.message);
                      }
                    }}
                  >
                    {r.hidden ? <Eye size={14} /> : <EyeOff size={14} />}{" "}
                    {r.hidden ? "上架" : "下架"}
                  </Button>
                </div>
              ))
            ) : (
              <Empty
                title="暂无资料"
                description="上传第一份资料后，可以在这里整理。"
              />
            )}
          </div>
        </TabsContent>
      </Tabs>
    </>
  );
}
