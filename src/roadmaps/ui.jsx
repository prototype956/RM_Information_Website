import React, { Component, useRef } from "react";
import {
  CheckCircle2,
  Circle,
  CircleDashed,
  ArrowUpRight,
  Route,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Progress } from "../components/ui/progress";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "../components/ui/alert-dialog";
import { AppLink } from "../components/shared";
import { states, progressSummary } from "../../shared/roadmap";
export function Status({ state = "idle" }) {
  const Icon =
    state === "completed"
      ? CheckCircle2
      : state === "learning"
        ? CircleDashed
        : Circle;
  return (
    <span className={`road-status ${state}`}>
      <Icon size={15} />
      {states[state]}
    </span>
  );
}
export function Summary({ doc, values, summary }) {
  const s = summary || progressSummary(doc, values);
  return (
    <div className="road-progress">
      {s.required > 0 ? (
        <>
          <div>
            <span>必修进度</span>
            <strong>
              {s.completed} / {s.required}
            </strong>
          </div>
          <Progress value={s.percent} aria-label={`必修完成 ${s.percent}%`} />
        </>
      ) : (
        <span>
          已完成 {s.totalCompleted} / {s.total} 个学习节点
        </span>
      )}
      {s.optional > 0 && (
        <small>
          选修完成 {s.optionalCompleted} / {s.optional}
        </small>
      )}
    </div>
  );
}
export function Confirm({ value, close }) {
  const trigger = useRef();
  return (
    <AlertDialog open={!!value} onOpenChange={(open) => !open && close()}>
      <AlertDialogContent
        onOpenAutoFocus={() => {
          trigger.current = document.activeElement;
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          requestAnimationFrame(
            () => trigger.current?.isConnected && trigger.current.focus(),
          );
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{value?.title}</AlertDialogTitle>
          <AlertDialogDescription>
            {value?.description || "此操作会修改路线内容，请确认后继续。"}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              const run = value?.run;
              close();
              run?.();
            }}
          >
            确认
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
export class CanvasBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="road-canvas-fallback" role="status">
        <Route size={28} />
        <p>路线图暂时无法加载，仍可通过阶段清单阅读和编辑。</p>
        <Button variant="outline" onClick={this.props.onFallback}>
          使用阶段清单
        </Button>
      </div>
    ) : (
      this.props.children
    );
  }
}
export function Checklist({
  doc,
  selected,
  select,
  values = {},
  editable = false,
}) {
  return (
    <div className="road-checklist">
      {doc.stages.map((stage, i) => (
        <details key={stage.id} open className="road-stage">
          <summary>
            <span className="road-index">{String(i + 1).padStart(2, "0")}</span>
            <strong>{stage.title}</strong>
            <span>
              {doc.nodes.filter((n) => n.stageId === stage.id).length} 项
            </span>
          </summary>
          <div>
            {doc.nodes
              .filter((n) => n.stageId === stage.id)
              .map((n) => (
                <Button
                  variant="ghost"
                  key={n.id}
                  className={`road-task-row ${selected === n.id ? "active" : ""}`}
                  onClick={() => select(n.id)}
                  aria-pressed={selected === n.id}
                >
                  <span>
                    <strong>{n.title}</strong>
                    <small>
                      {n.required ? "必修" : "选修"}
                      {n.goal ? ` · ${n.goal}` : ""}
                    </small>
                  </span>
                  {editable ? (
                    <ArrowUpRight size={17} />
                  ) : (
                    <Status state={values[n.id]} />
                  )}
                </Button>
              ))}
            {!doc.nodes.some((n) => n.stageId === stage.id) && (
              <p className="road-muted">这个阶段还没有学习节点。</p>
            )}
          </div>
        </details>
      ))}
    </div>
  );
}
export function NodeResources({ node, resources = {} }) {
  return (
    <div className="road-links">
      {node.resourceIds.map((id) =>
        resources[id] ? (
          <AppLink
            key={id}
            to={`/resources/${id}`}
            target="_blank"
            className="road-resource"
          >
            <span>
              <small>站内资料</small>
              {resources[id].title}
            </span>
            <ArrowUpRight size={17} />
          </AppLink>
        ) : (
          <div key={id} className="road-resource unavailable">
            资料不可用
          </div>
        ),
      )}
      {node.links.map((l, i) => (
        <a
          key={i}
          className="road-resource"
          href={l.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          <span>
            <small>外部链接</small>
            {l.title}
          </span>
          <ArrowUpRight size={17} />
        </a>
      ))}
      {!node.resourceIds.length && !node.links.length && (
        <p className="road-muted">暂未关联资料。</p>
      )}
    </div>
  );
}
export function NodeReading({
  doc,
  node,
  resources,
  select,
  progress,
  onState,
  busy = false,
  preview = false,
}) {
  if (!node)
    return (
      <div className="road-node-detail road-panel">
        <Route size={28} />
        <h2>从一个节点开始</h2>
        <p className="road-muted">选择学习节点，查看目标、资料和实践任务。</p>
      </div>
    );
  const predecessors = doc.edges
    .filter((e) => e.target === node.id)
    .map((e) => doc.nodes.find((n) => n.id === e.source));
  return (
    <aside className="road-node-detail road-panel" aria-label="节点详情">
      <div className="road-section-label">
        <Badge variant="outline">{node.required ? "必修" : "选修"}</Badge>
        <span>{doc.stages.find((s) => s.id === node.stageId)?.title}</span>
      </div>
      <h2>{node.title}</h2>
      {node.goal && <p className="road-goal">{node.goal}</p>}
      {!preview && (
        <div className="road-state-control">
          <span>我的学习状态</span>
          <div>
            {Object.entries(states).map(([state, label]) => (
              <Button
                key={state}
                variant={
                  progress.states[node.id] === state ? "secondary" : "outline"
                }
                aria-pressed={progress.states[node.id] === state}
                disabled={busy}
                onClick={() => onState(state)}
              >
                <Status state={state} />
              </Button>
            ))}
          </div>
        </div>
      )}
      {predecessors.length > 0 && (
        <section>
          <h3>建议先学</h3>
          <p className="road-muted">已有基础可以直接跳学。</p>
          {predecessors.map((n) => (
            <Button
              variant="link"
              className="road-predecessor"
              key={n.id}
              onClick={() => select(n.id)}
            >
              {n.title}
              <ArrowUpRight size={14} />
            </Button>
          ))}
        </section>
      )}
      {node.description && (
        <section>
          <h3>学习说明</h3>
          <p className="road-prose">{node.description}</p>
        </section>
      )}
      <section>
        <h3>学习资料</h3>
        <NodeResources node={node} resources={resources} />
      </section>
      {node.task && (
        <section className="road-practice">
          <h3>动手实践</h3>
          <p className="road-prose">{node.task}</p>
        </section>
      )}
    </aside>
  );
}
