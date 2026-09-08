import React, { useEffect, useState, lazy, Suspense } from "react";
import { ArrowLeft, Share2, Play, Pencil, Copy, Map, List } from "lucide-react";
import { useApp } from "../context";
import { api, send } from "../api";
import { AppLink, Loading, ErrorBox } from "../components/shared";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Summary, Checklist, NodeReading, CanvasBoundary } from "./ui";
import "./roadmaps.css";
const Canvas = lazy(() => import("./Canvas"));
export default function RoadmapReader({ id }) {
  const { route, go, notify, taxonomy } = useApp();
  const [data, setData] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [retry, setRetry] = useState(0),
    [view, setView] = useState(
      matchMedia("(max-width: 900px)").matches ? "list" : "map",
    ),
    [share, setShare] = useState(false);
  const selected = new URLSearchParams(route.split("?")[1]).get("node");
  useEffect(() => {
    let live = true;
    setError("");
    setData(null);
    api(`/roadmaps/${id}`)
      .then((r) => live && setData(r))
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [id, retry, taxonomy.revision]);
  const select = (node) => {
    go(`/roadmaps/${id}?node=${encodeURIComponent(node)}`, true, {
      preserveScroll: true,
    });
    if (matchMedia("(max-width: 1050px)").matches)
      requestAnimationFrame(() =>
        document
          .querySelector(".road-node-detail")
          ?.scrollIntoView({ block: "start" }),
      );
  };
  const update = async (body) => {
    setBusy(true);
    try {
      const r = await send(`/roadmaps/${id}/progress`, body, "PUT");
      setData((d) => ({
        ...d,
        roadmap: { ...d.roadmap, progress: r.progress },
      }));
      notify(Object.keys(body).length ? "学习状态已保存" : "已加入我的学习");
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
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
  if (error)
    return (
      <div className="road-page">
        <ErrorBox>{error}</ErrorBox>
        <Button variant="outline" onClick={() => setRetry((n) => n + 1)}>
          重新加载
        </Button>
        <AppLink variant="ghost" to="/roadmaps">
          返回学习路线
        </AppLink>
      </div>
    );
  if (!data) return <Loading text="正在加载学习路线…" />;
  const { document: doc, roadmap: r, resources } = data,
    node = doc.nodes.find((n) => n.id === selected) || doc.nodes[0];
  return (
    <div className="road-page">
      <AppLink className="road-back" to="/roadmaps">
        <ArrowLeft size={16} />
        学习路线
      </AppLink>
      <header className="road-page-heading">
        <div>
          <div className="road-section-label">
            <Badge variant="outline">{doc.category}</Badge>
            {doc.tags?.map((t) => (
              <Badge key={t} variant="secondary">
                {t}
              </Badge>
            ))}
            <span>
              {r.author} · {doc.nodes.length} 个学习节点
            </span>
          </div>
          <h1>{doc.title}</h1>
          <p>{doc.description}</p>
        </div>
        <div className="road-actions">
          <Button variant="outline" onClick={() => setShare(true)}>
            <Share2 size={16} />
            分享路线
          </Button>
          {r.canEdit && (
            <AppLink variant="outline" to={`/roadmaps/${id}/edit`}>
              <Pencil size={16} />
              编辑路线
            </AppLink>
          )}
          <Button variant="ghost" onClick={copy} disabled={busy}>
            <Copy size={16} />
            复制
          </Button>
        </div>
      </header>
      <div className="road-reader-bar">
        <Summary summary={r.progress} />
        <div className="road-actions">
          {!r.progress.started && (
            <Button disabled={busy} onClick={() => update({})}>
              <Play size={16} />
              开始学习
            </Button>
          )}
          <ToggleGroup
            type="single"
            value={view}
            onValueChange={(v) => v && setView(v)}
            aria-label="路线视图"
          >
            <ToggleGroupItem value="map" aria-label="画布视图">
              <Map size={17} />
              <span>路线图</span>
            </ToggleGroupItem>
            <ToggleGroupItem value="list" aria-label="清单视图">
              <List size={17} />
              <span>阶段清单</span>
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>
      {selected && !doc.nodes.some((n) => n.id === selected) && (
        <p role="status" className="road-muted">
          链接中的节点已移除，已显示当前路线。
        </p>
      )}
      <div className="road-reader-layout">
        <div>
          {view === "map" ? (
            <CanvasBoundary onFallback={() => setView("list")}>
              <Suspense
                fallback={<Loading text="正在加载路线画布，可切换阶段清单…" />}
              >
                <Canvas
                  doc={doc}
                  selected={node?.id}
                  select={select}
                  values={r.progress.states}
                />
              </Suspense>
            </CanvasBoundary>
          ) : (
            <Checklist
              doc={doc}
              selected={node?.id}
              select={select}
              values={r.progress.states}
            />
          )}
        </div>
        <NodeReading
          doc={doc}
          node={node}
          resources={resources}
          select={select}
          progress={r.progress}
          busy={busy}
          onState={(state) => update({ nodeId: node.id, state })}
        />
      </div>
      <Dialog open={share} onOpenChange={setShare}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>分享给队友</DialogTitle>
            <DialogDescription>
              仅队伍成员登录后可以访问。链接会定位到当前学习节点。
            </DialogDescription>
          </DialogHeader>
          <Input
            aria-label="队内路线链接"
            readOnly
            value={`${location.origin}/roadmaps/${id}${node ? "?node=" + node.id : ""}`}
            onFocus={(e) => e.target.select()}
          />
          <Button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(
                  `${location.origin}/roadmaps/${id}${node ? "?node=" + node.id : ""}`,
                );
                notify("队内链接已复制");
              } catch {
                notify("请选中上方链接手动复制");
              }
            }}
          >
            复制链接
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
