import React, { useState, useEffect, useMemo } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  ArrowLeft,
  ChevronRight,
  Plus,
  X,
  Grid2X2,
  List,
  SlidersHorizontal,
  GraduationCap,
  Cpu,
  Settings2,
  FileText,
  Clock3,
  CircuitBoard,
  BookOpen,
  Eye,
  Command,
} from "lucide-react";
import { resolveOption, resolveClassification } from "../taxonomy/helpers";
import { useApp } from "../context";
import Robot from "../Robot";
import {
  AppLink,
  IconButton,
  Empty,
  SearchField,
  ResourceTable,
  Modal,
  Choice,
  HeroTitle,
} from "../components/shared";
import { Button } from "@/components/ui/button";

import { Card } from "@/components/ui/card";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import {
  Pagination,
  PaginationContent,
  PaginationItem,
} from "@/components/ui/pagination";

export default function Library({ home = false, mode }) {
  const { route, go, resources, recent, motion, user, taxonomy } = useApp();
  const useUserId = user.id;
  const params = new URLSearchParams(route.split("?")[1]);
  const [search, setSearch] = useState(params.get("q") || "");
  const [grid, setGrid] = useState(localStorage.getItem("rm-view") === "grid"),
    [filterOpen, setFilterOpen] = useState(false);
  const { domain, category } = resolveClassification(
    taxonomy,
    params.get("domain") || "",
    params.get("category") || "",
  );
  const kind = params.get("kind") || "",
    tag = resolveOption(taxonomy, "tag", params.get("tag") || ""),
    sort = params.get("sort") || "",
    q = params.get("q") || "";
  const page = Math.max(1, parseInt(params.get("page") || "1") || 1);
  useEffect(() => setSearch(q), [q]);
  const update = (key, value) => {
    const next = new URLSearchParams(route.split("?")[1]);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page");
    if (key === "domain") next.delete("category");
    go(
      `${mode ? "/" + mode : "/resources"}${next.size ? "?" + next.toString() : ""}`,
    );
  };
  const searched = q.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      resources
        .filter((r) => !r.hidden || mode === "uploads")
        .filter(
          (r) =>
            (mode !== "favorites" || r.favorite) &&
            (mode !== "uploads" || r.owner_id === useUserId),
        )
        .filter(
          (r) =>
            (!domain || r.domain === domain) &&
            (!category || r.categoryId === category) &&
            (!kind || r.kind === kind) &&
            (!tag || r.tagIds?.includes(tag)),
        )
        .map((r) => {
          const haystack =
            `${r.title} ${r.description} ${r.category} ${r.tags.join(" ")}`.toLowerCase();
          return {
            ...r,
            score: searched
              .split(/\s+/)
              .filter(Boolean)
              .reduce(
                (score, term) =>
                  score +
                  (r.title.toLowerCase().includes(term)
                    ? 4
                    : haystack.includes(term)
                      ? 1
                      : 0),
                0,
              ),
            match:
              !searched ||
              searched.split(/\s+/).every((term) => haystack.includes(term)),
          };
        })
        .filter((r) => r.match)
        .sort((a, b) =>
          sort === "title"
            ? a.title.localeCompare(b.title, "zh")
            : sort === "oldest"
              ? a.updated_at - b.updated_at
              : searched && !sort
                ? b.score - a.score || b.updated_at - a.updated_at
                : b.updated_at - a.updated_at,
        ),
    [resources, mode, domain, category, kind, tag, searched, sort, useUserId],
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / 10)),
    safePage = Math.min(page, pageCount);
  const items = home
    ? filtered.slice(0, 5)
    : filtered.slice((safePage - 1) * 10, safePage * 10);
  const title =
    mode === "favorites"
      ? "我的收藏"
      : mode === "uploads"
        ? "我的上传"
        : taxonomy.domains.find((d) => d.id === domain)?.name || "全部资料";
  const allTags = taxonomy.tags;
  const filters = (
    <div className="filter-controls">
      <Choice
        aria-label="筛选资料领域"
        value={domain}
        onChange={(e) => update("domain", e.target.value)}
      >
        <option value="">全部领域</option>
        {taxonomy.domains.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </Choice>
      <Choice
        aria-label="筛选课程或技术方向"
        value={category}
        onChange={(e) => update("category", e.target.value)}
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
        aria-label="筛选资料形式"
        value={kind}
        onChange={(e) => update("kind", e.target.value)}
      >
        <option value="">全部形式</option>
        <option value="file">文件资料</option>
        <option value="link">外部链接</option>
      </Choice>
      <Choice
        aria-label="筛选标签"
        value={tag}
        onChange={(e) => update("tag", e.target.value)}
      >
        <option value="">全部标签</option>
        {allTags.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </Choice>
      {(domain || category || kind || tag || q) && (
        <Button
          variant="ghost"
          className="text-button"
          onClick={() => go(mode ? "/" + mode : "/resources")}
        >
          清空筛选
          <X size={13} />
        </Button>
      )}
    </div>
  );
  return (
    <>
      {home ? (
        <>
          <div className="page-breadcrumb">
            <span>知识空间</span>
            <ChevronRight size={12} />
            <span>资料概览</span>
          </div>
          <section className="hero">
            <div className="hero-copy">
              <div className="eyebrow">
                <span className="small-line" /> KNOWLEDGE BUILDS WHAT'S NEXT
              </div>
              <HeroTitle
                lines={["让知识，成为", "下一场的底气。"]}
                motion={motion}
              />
              <p>从课堂到赛场，把每一次探索变成队伍的共同积累。</p>
              <SearchField
                large
                value={search}
                onChange={setSearch}
                onSubmit={() => update("q", search)}
              />
              <div className="quick-search">
                <span>常用搜索</span>
                {taxonomy.categories
                  .slice(0, 3)
                  .map((c) => c.name)
                  .map((term) => (
                    <Button
                      variant="outline"
                      key={term}
                      onClick={() => update("q", term)}
                    >
                      {term}
                      <ArrowUpRight size={11} />
                    </Button>
                  ))}
              </div>
            </div>
            <Robot motion={motion} />
          </section>
          <section className="entry-grid" aria-label="选择资料领域">
            {taxonomy.domains.map((d) => (
              <Card key={d.id} className="entry-card">
                <AppLink to={"/resources?domain=" + d.id}>
                  <div>
                    <div className="entry-kicker">
                      <BookOpen size={20} />
                      <span>KNOWLEDGE LIBRARY</span>
                    </div>
                    <h2>
                      {d.name}
                      <span>从分类开始，找到下一步</span>
                    </h2>
                    <p>
                      {taxonomy.categories
                        .filter((c) => c.parent_id === d.id)
                        .slice(0, 4)
                        .map((c) => c.name)
                        .join(" / ") || "等待第一份知识分享"}
                    </p>
                  </div>
                  <div className="entry-art book-art">
                    <BookOpen size={80} strokeWidth={0.6} />
                  </div>
                  <span className="entry-arrow">
                    <ArrowUpRight size={21} />
                  </span>
                </AppLink>
              </Card>
            ))}
          </section>
        </>
      ) : (
        <>
          <div className="page-breadcrumb">
            <AppLink to="/">知识空间</AppLink>
            <ChevronRight size={12} />
            <span>{title}</span>
          </div>
          <div className="page-heading">
            <div>
              <h1>
                {title}
                <span className="heading-count">{filtered.length}</span>
              </h1>
              <p>
                {mode === "favorites"
                  ? "把值得反复阅读的知识，留在手边。"
                  : mode === "uploads"
                    ? "你留下的每一份经验，都让队伍更进一步。"
                    : domain === "academic"
                      ? "从一门课程开始，找到适合你的复习资料。"
                      : domain === "rm"
                        ? "沿着技术方向，积累走向赛场的每一步。"
                        : "队伍的共同积累，你的下一步从这里开始。"}
              </p>
            </div>
            <AppLink to="/resources/new" variant="default">
              <Plus size={16} />
              上传资料
            </AppLink>
          </div>
          <div className="library-search">
            <SearchField
              value={search}
              onChange={(v) => {
                setSearch(v);
              }}
              onSubmit={() => update("q", search)}
            />
            <Button
              variant="outline"

              onClick={() => update("q", search)}
            >
              搜索
            </Button>
            <Button
              variant="outline"
              className=" mobile-filter"
              onClick={() => setFilterOpen(true)}
            >
              <SlidersHorizontal size={17} />
              筛选
            </Button>
          </div>
          <div className="desktop-filters">{filters}</div>
          {filterOpen && (
            <Modal title="筛选资料" onClose={() => setFilterOpen(false)}>
              {filters}
              <Button className=" full" onClick={() => setFilterOpen(false)}>
                查看结果
              </Button>
            </Modal>
          )}
        </>
      )}
      <div className={home ? "home-lower" : ""}>
        <section className="list-section">
          <div className="section-title">
            <h2>
              {home ? "最近更新" : q ? `“${q}” 的搜索结果` : "资料列表"}
              {home && <span className="section-sub">让新知识及时抵达</span>}
            </h2>
            <div className="list-actions">
              {home ? (
                <AppLink to="/resources" className="text-button">
                  查看全部
                  <ArrowRight size={14} />
                </AppLink>
              ) : (
                <Choice
                  aria-label="排序方式"
                  className="sort-select"
                  value={sort}
                  onChange={(e) => update("sort", e.target.value)}
                >
                  <option value="">{q ? "相关度优先" : "最近更新"}</option>
                  <option value="oldest">最早更新</option>
                  <option value="title">标题排序</option>
                  {q && <option value="newest">最近更新</option>}
                </Choice>
              )}
              <ToggleGroup
                type="single"
                value={grid ? "grid" : "list"}
                onValueChange={(v) => {
                  if (v) {
                    setGrid(v === "grid");
                    localStorage.setItem("rm-view", v);
                  }
                }}
                className="view-toggle"
                aria-label="资料显示方式"
              >
                <ToggleGroupItem value="list" aria-label="列表视图">
                  <List size={16} />
                </ToggleGroupItem>
                <ToggleGroupItem value="grid" aria-label="卡片视图">
                  <Grid2X2 size={16} />
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
          </div>
          {items.length ? (
            <ResourceTable rows={items} grid={grid} />
          ) : (
            <Empty
              title={
                mode === "favorites"
                  ? "还没有收藏资料"
                  : mode === "uploads"
                    ? "分享你的第一份资料"
                    : q || domain || category || tag || kind
                      ? "暂时没有找到匹配的资料"
                      : "资料库正在等待第一份分享"
              }
              description={
                mode === "favorites"
                  ? "点击资料旁的书签，将常用知识留在手边。"
                  : "试试其他关键词，或把你整理的资料分享给队友。"
              }
            >
              <AppLink
                to={mode === "favorites" ? "/resources" : "/resources/new"}
                variant="outline"
              >
                {mode === "favorites" ? "浏览资料" : "上传资料"}
                <ArrowRight size={15} />
              </AppLink>
            </Empty>
          )}
          {!home && filtered.length > 0 && (
            <Pagination className="pagination" aria-label="资料分页">
              <span>
                共 {filtered.length} 份资料 · 第 {safePage} / {pageCount} 页
              </span>
              <PaginationContent>
                <PaginationItem>
                  <IconButton
                    label="上一页"
                    disabled={safePage === 1}
                    onClick={() => {
                      params.set("page", String(safePage - 1));
                      go(`${mode ? "/" + mode : "/resources"}?${params}`);
                    }}
                  >
                    <ArrowLeft size={16} />
                  </IconButton>
                </PaginationItem>
                <PaginationItem aria-current="page">
                  <span>{safePage}</span>
                </PaginationItem>
                <PaginationItem>
                  <IconButton
                    label="下一页"
                    disabled={safePage === pageCount}
                    onClick={() => {
                      params.set("page", String(safePage + 1));
                      go(`${mode ? "/" + mode : "/resources"}?${params}`);
                    }}
                  >
                    <ArrowRight size={16} />
                  </IconButton>
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          )}
        </section>
        {home && (
          <aside className="home-aside">
            <div className="section-title">
              <h2>技术方向</h2>
              <CircuitBoard size={16} />
            </div>
            <div className="direction-list">
              {taxonomy.categories
                .filter(
                  (c) =>
                    !taxonomy.domains.some((d) => d.id === "rm") ||
                    c.parent_id === "rm",
                )
                .slice(0, 4)
                .map((c, i) => (
                  <AppLink
                    key={c.id}
                    to={`/resources?domain=${c.parent_id}&category=${c.id}`}
                  >
                    <span className="direction-icon">
                      {
                        [
                          <Settings2 size={17} />,
                          <Cpu size={17} />,
                          <Eye size={17} />,
                          <Command size={17} />,
                        ][i]
                      }
                    </span>
                    <span>
                      {c.name}
                      <small>
                        {
                          taxonomy.domains.find((d) => d.id === c.parent_id)
                            ?.name
                        }
                      </small>
                    </span>
                    <ChevronRight size={14} />
                  </AppLink>
                ))}
            </div>
            <div className="recent-block">
              <h3>
                <Clock3 size={15} />
                最近浏览
              </h3>
              {recent.filter((id) =>
                resources.some((r) => r.id === id && !r.hidden),
              ).length ? (
                recent.slice(0, 3).map((id) => {
                  const r = resources.find((r) => r.id === id && !r.hidden);
                  return (
                    r && (
                      <AppLink to={`/resources/${id}`} key={id}>
                        <span>{r.title}</span>
                        <ArrowUpRight size={13} />
                      </AppLink>
                    )
                  );
                })
              ) : (
                <p>打开一份资料，下次从这里继续。</p>
              )}
            </div>
          </aside>
        )}
      </div>
      {home && resources.some((r) => r.sample) && (
        <p className="example-note">
          <FileText size={13} />
          带“示例资料”标记的内容用于演示，可由管理员替换为队内资料。
        </p>
      )}
    </>
  );
}
