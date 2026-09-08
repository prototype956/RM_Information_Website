import React, { useEffect, useState } from "react";
import {
  Plus,
  ArrowUpRight,
  Route,
  Search,
  Copy,
  SlidersHorizontal,
} from "lucide-react";
import { useApp } from "../context";
import { api, send } from "../api";
import {
  defaultSelection,
  resolveOption,
  resolveClassification,
} from "../taxonomy/helpers";
import { blankRoadmap } from "../../shared/roadmap";
import {
  AppLink,
  Choice,
  ErrorBox,
  Loading,
  Empty,
} from "../components/shared";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { Card } from "../components/ui/card";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "../components/ui/tabs";
import { Summary } from "./ui";
import "./roadmaps.css";
export default function RoadmapList() {
  const { route, go, user, notify, taxonomy } = useApp(),
    params = new URLSearchParams(route.split("?")[1]);
  const { domain, category } = resolveClassification(
    taxonomy,
    params.get("domain") || "",
    params.get("category") || "",
  );
  const scope = params.get("scope") || "all",
    tag = resolveOption(taxonomy, "tag", params.get("tag") || ""),
    page = Number(params.get("page")) || 1;
  const [q, setQ] = useState(params.get("q") || ""),
    [data, setData] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [retry, setRetry] = useState(0);
  const change = (values) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries({
      ...values,
      page: values.page || "",
    })) {
      v ? p.set(k, v) : p.delete(k);
    }
    go(`/roadmaps${p.size ? "?" + p : ""}`, true);
  };
  useEffect(() => {
    setQ(params.get("q") || "");
  }, [route]);
  useEffect(() => {
    let live = true;
    setError("");
    setData(null);
    const query = new URLSearchParams(params);
    for (const [k, v] of Object.entries({ domain, category, tag }))
      if (v) query.set(k, v);
    api(`/roadmaps?${query}`)
      .then((r) => live && setData(r))
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [route, retry, taxonomy.revision]);
  const create = async () => {
    setBusy(true);
    try {
      const selection = defaultSelection(taxonomy);
      if (!selection.categoryId)
        throw new Error("请先由管理员创建资料库和课程／方向");
      const r = await send("/roadmaps", { document: blankRoadmap(selection) });
      go(`/roadmaps/${r.id}/edit`);
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  };
  const copy = async (id) => {
    setBusy(true);
    try {
      const r = await send(`/roadmaps/${id}/copy`, {});
      go(`/roadmaps/${r.id}/edit`);
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Tabs
      className="road-page"
      value={scope}
      onValueChange={(scope) => change({ scope })}
    >
      <div className="road-list-hero">
        <div>
          <p className="road-eyebrow">
            <Route size={16} />
            队伍学习路线
          </p>
          <h1>
            让经验连成路线，
            <br />
            <span>让成长有迹可循。</span>
          </h1>
          <p>从第一份资料到第一次实战，把每一步传递给下一位队友。</p>
        </div>
        <div className="road-hero-diagram" aria-hidden="true">
          <span>基础</span>
          <i />
          <span>实践</span>
          <i />
          <span>进阶</span>
        </div>
      </div>
      <div className="road-list-bar">
        <TabsList aria-label="路线范围">
          <TabsTrigger value="all">全部路线</TabsTrigger>
          <TabsTrigger value="learning">我的学习</TabsTrigger>
          <TabsTrigger value="mine">我创建的</TabsTrigger>
          {user.role === "admin" && (
            <TabsTrigger value="manage">路线管理</TabsTrigger>
          )}
        </TabsList>
        <Button onClick={create} disabled={busy}>
          <Plus size={17} />
          创建路线
        </Button>
      </div>
      <TabsContent value={scope}>
        <form
          className="road-filters"
          onSubmit={(e) => {
            e.preventDefault();
            change({ q });
          }}
        >
          <div className="road-search">
            <Search size={18} />
            <Input
              data-search
              aria-label="搜索路线"
              placeholder="搜索路线标题…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <Choice
            aria-label="路线资料库"
            value={domain}
            onChange={(e) => change({ domain: e.target.value, category: "" })}
          >
            <option value="">全部资料库</option>
            {taxonomy.domains.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Choice>
          <Choice
            aria-label="路线分类"
            value={category}
            onChange={(e) => change({ category: e.target.value })}
          >
            <option value="">全部分类</option>
            {taxonomy.categories
              .filter((c) => !domain || c.parent_id === domain)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </Choice>
          <Choice
            aria-label="路线标签"
            value={tag}
            onChange={(e) => change({ tag: e.target.value })}
          >
            <option value="">全部标签</option>
            {taxonomy.tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Choice>
          <Button type="submit" variant="secondary">
            搜索
          </Button>
          {(params.get("q") || category || domain || tag) && (
            <Button
              type="button"
              variant="ghost"
              onClick={() =>
                change({ q: "", category: "", domain: "", tag: "" })
              }
            >
              清空筛选
            </Button>
          )}
        </form>
        {error ? (
          <>
            <ErrorBox>{error}</ErrorBox>
            <Button variant="outline" onClick={() => setRetry((n) => n + 1)}>
              重新加载
            </Button>
          </>
        ) : !data ? (
          <Loading text="正在加载学习路线…" />
        ) : !data.roadmaps.length ? (
          <Empty
            title="这里还没有学习路线"
            description={
              params.get("q") || category || domain || tag
                ? "试试其他关键词，或清空筛选。"
                : scope === "learning"
                  ? "打开一条路线，点击开始学习。"
                  : "把你的学习经验编成一条路线，分享给队友。"
            }
          >
            <Button variant="outline" onClick={create} disabled={busy}>
              创建第一条路线
            </Button>
          </Empty>
        ) : (
          <>
            <div className="road-result-count">{data.total} 条路线</div>
            <div className="road-grid">
              {data.roadmaps.map((r, i) => (
                <Card key={r.id} className="road-card">
                  <div className="road-card-meta">
                    <span className="road-index">
                      {String((page - 1) * 12 + i + 1).padStart(2, "0")}
                    </span>
                    <Badge variant="outline">{r.category}</Badge>
                    {r.hidden ? (
                      <Badge variant="destructive">已下架</Badge>
                    ) : (
                      !r.published && <Badge variant="secondary">草稿</Badge>
                    )}
                  </div>
                  <AppLink
                    className="road-card-title"
                    to={
                      r.published && !r.hidden
                        ? `/roadmaps/${r.id}`
                        : `/roadmaps/${r.id}/edit`
                    }
                  >
                    <h2>{r.title}</h2>
                    <ArrowUpRight size={20} />
                  </AppLink>
                  <p>
                    {r.description ||
                      "为队友整理清晰的学习目标、资料和实践任务。"}
                  </p>
                  <div className="tags">
                    {r.tags?.map((t) => (
                      <Badge key={t} variant="secondary">
                        {t}
                      </Badge>
                    ))}
                  </div>
                  <div className="road-card-info">
                    <span>{r.nodeCount} 个节点</span>
                    <span>
                      {r.author} ·{" "}
                      {new Date(r.updatedAt).toLocaleDateString("zh-CN")}
                    </span>
                  </div>
                  {r.progress.started && <Summary summary={r.progress} />}
                  <div className="road-card-actions">
                    {r.canEdit && (
                      <AppLink variant="outline" to={`/roadmaps/${r.id}/edit`}>
                        <SlidersHorizontal size={15} />
                        管理路线
                      </AppLink>
                    )}
                    {r.published && !r.hidden && (
                      <Button
                        variant="ghost"
                        disabled={busy}
                        onClick={() => copy(r.id)}
                      >
                        <Copy size={15} />
                        复制路线
                      </Button>
                    )}
                  </div>
                </Card>
              ))}
            </div>
            {data.total > 12 && (
              <nav className="road-pagination" aria-label="路线分页">
                <Button
                  variant="outline"
                  disabled={page <= 1}
                  onClick={() => change({ page: page - 1 })}
                >
                  上一页
                </Button>
                <span>
                  {page} / {Math.ceil(data.total / 12)}
                </span>
                <Button
                  variant="outline"
                  disabled={page * 12 >= data.total}
                  onClick={() => change({ page: page + 1 })}
                >
                  下一页
                </Button>
              </nav>
            )}
          </>
        )}
      </TabsContent>
    </Tabs>
  );
}
