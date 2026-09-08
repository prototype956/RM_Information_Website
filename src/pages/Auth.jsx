import React, { useState, useEffect } from "react";
import {
  ArrowRight,
  LoaderCircle,
  CircuitBoard,
  ShieldCheck,
} from "lucide-react";
import { api, send } from "../api";
import { useApp } from "../context";
import Robot from "../Robot";
import {
  AppLink,
  Loading,
  ErrorBox,
  Mark,
  Field,
  HeroTitle,
} from "../components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";

export default function Auth({ setup, onAuth }) {
  const { route, motion } = useApp();
  const token = route.startsWith("/join/")
    ? route.split("/")[2].split("?")[0]
    : "";
  const [invite, setInvite] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    examples: true,
  });
  useEffect(() => {
    if (token)
      api(`/auth/invitation/${token}`)
        .then(setInvite)
        .catch((e) => {
          setError(e.message);
          setInvite(false);
        });
  }, [token]);
  const registering = setup || !!token;
  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const r = await send(
        setup ? "/auth/setup" : token ? "/auth/register" : "/auth/login",
        { ...form, token },
      );
      onAuth(r.user);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="auth-page">
      <div className="auth-brand">
        <Mark />
        <span>
          RM <b>TEAM KNOWLEDGE BASE</b>
        </span>
      </div>
      <div className="auth-layout">
        <section className="auth-story">
          <div className="eyebrow">
            <span className="live-dot" /> BUILT BY THE TEAM. FOR THE TEAM.
          </div>
          <HeroTitle
            lines={["每一次分享，", "都是向前一步。"]}
            motion={motion}
          />
          <p>
            从期末复习到赛场实战，
            <br />
            让知识在队伍中流动，让热爱走得更远。
          </p>
          <Robot motion={motion} large />
          <div className="auth-bottom">
            <ShieldCheck size={17} />
            <span>队伍内部共享 · 经验持续积累</span>
          </div>
        </section>
        <Card className="auth-card">
          <span className="form-emblem">
            <CircuitBoard size={26} />
          </span>
          <h2>
            {setup
              ? "建立你的队伍空间"
              : token
                ? "欢迎加入队伍"
                : "欢迎回来，队友。"}
          </h2>
          <p>
            {setup
              ? "首次使用，请创建管理员账号。"
              : token
                ? "完成注册，和队友一起积累知识。"
                : "登录后，继续你的学习与探索。"}
          </p>
          <ErrorBox id="auth-error">{error}</ErrorBox>
          {token && invite === null ? (
            <Loading text="正在检查邀请…" />
          ) : token && invite === false ? (
            <div className="invalid-invite">
              <p>请联系队伍管理员获取新的邀请链接。</p>
              <AppLink to="/" variant="outline">
                返回登录
              </AppLink>
            </div>
          ) : (
            <form onSubmit={submit}>
              {registering && (
                <Field>
                  你的姓名
                  <Input
                    aria-invalid={!!error}
                    aria-describedby={error ? "auth-error" : undefined}
                    required
                    maxLength={40}
                    autoComplete="name"
                    placeholder="队友怎么称呼你"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </Field>
              )}
              <Field>
                邮箱
                <Input
                  aria-invalid={!!error}
                  aria-describedby={error ? "auth-error" : undefined}
                  type="email"
                  required
                  autoComplete="username"
                  placeholder="输入你的队伍账号邮箱"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </Field>
              <Field>
                密码
                <Input
                  aria-invalid={!!error}
                  aria-describedby={error ? "auth-error" : undefined}
                  type="password"
                  required
                  minLength={registering ? 10 : 1}
                  maxLength={128}
                  autoComplete={
                    registering ? "new-password" : "current-password"
                  }
                  placeholder={registering ? "设置至少 10 位密码" : "输入密码"}
                  value={form.password}
                  onChange={(e) =>
                    setForm({ ...form, password: e.target.value })
                  }
                />
              </Field>
              {setup && (
                <div className="checkbox-label">
                  <Checkbox
                    id="examples"
                    checked={form.examples}
                    onCheckedChange={(examples) =>
                      setForm({ ...form, examples })
                    }
                  />
                  <Label htmlFor="examples">添加带有明确标记的示例资料</Label>
                </div>
              )}
              <Button className=" full" disabled={busy}>
                {busy ? <LoaderCircle className="spin" size={17} /> : null}
                {setup
                  ? "创建管理员并进入"
                  : token
                    ? "注册并进入资料中心"
                    : "进入资料中心"}
                <ArrowRight size={17} />
              </Button>
            </form>
          )}
          <div className="auth-note">
            <ShieldCheck size={16} />
            <span>
              {registering
                ? "账号仅用于当前队伍知识空间"
                : "尚未加入？请向管理员获取邀请链接。"}
            </span>
          </div>
        </Card>
      </div>
      <footer className="auth-footer">
        共享知识，一起进阶。<span>RM / KNOWLEDGE IS OUR NEXT ADVANTAGE</span>
      </footer>
    </div>
  );
}
