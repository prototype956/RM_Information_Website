import React, { useEffect, useState, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  MarkerType,
  applyNodeChanges,
} from "@xyflow/react";
import "./canvas.css";
import {
  BaseNode,
  BaseNodeHeader,
  BaseNodeHeaderTitle,
  BaseNodeContent,
} from "../components/ui/base-node";
import { Status } from "./ui";
function LearningNode({ data, selected }) {
  return (
    <BaseNode
      tabIndex={-1}
      className={`learning-node ${selected ? "is-current" : ""}`}
    >
      <Handle type="target" position={Position.Top} />
      <BaseNodeHeader>
        <span className="road-node-number">{data.number}</span>
        <small>{data.stage}</small>
      </BaseNodeHeader>
      <BaseNodeContent>
        <BaseNodeHeaderTitle>{data.title}</BaseNodeHeaderTitle>
        <p>{data.goal || "点击查看学习目标与资料"}</p>
        <div className="road-node-bottom">
          <span>
            {data.required ? "必修" : "选修"} ·{" "}
            {data.resourceIds.length + data.links.length} 份资料
          </span>
          {data.editable ? (
            <span>编辑节点</span>
          ) : (
            <Status state={data.state} />
          )}
        </div>
      </BaseNodeContent>
      <Handle type="source" position={Position.Bottom} />
    </BaseNode>
  );
}
const nodeTypes = { learning: LearningNode };
const emptyValues = {};
export default function Canvas({
  doc,
  selected,
  select,
  values = emptyValues,
  editable = false,
  onMove,
  onConnect,
  onEdgeDelete,
}) {
  const mapped = useMemo(
    () =>
      doc.nodes.map((n, i) => ({
        id: n.id,
        type: "learning",
        position: n.position,
        selected: n.id === selected,
        ariaLabel: `学习节点：${n.title}`,
        data: {
          ...n,
          editable,
          number: String(i + 1).padStart(2, "0"),
          stage: doc.stages.find((s) => s.id === n.stageId)?.title,
          state: values[n.id],
        },
      })),
    [doc, selected, values, editable],
  );
  const [nodes, setNodes] = useState(mapped),
    [instance, setInstance] = useState(null);
  useEffect(() => setNodes(mapped), [mapped]);
  const changeNodes = (changes) => {
    setNodes((ns) => applyNodeChanges(changes, ns));
    const chosen = changes.find((c) => c.type === "select" && c.selected);
    if (chosen && chosen.id !== selected) select(chosen.id);
    for (const c of changes)
      if (editable && c.type === "position" && c.position && !c.dragging)
        onMove?.(c.id, c.position);
  };
  useEffect(() => {
    if (instance && selected) {
      const n = doc.nodes.find((n) => n.id === selected);
      if (n)
        instance.setCenter(n.position.x + 130, n.position.y + 85, {
          zoom: Math.min(instance.getZoom(), 1),
          duration: 0,
        });
    }
  }, [selected, instance]);
  return (
    <div className="road-canvas" aria-label="学习路线画布">
      <ReactFlow
        nodes={nodes}
        edges={doc.edges.map((e) => ({
          ...e,
          type: "smoothstep",
          markerEnd: { type: MarkerType.ArrowClosed },
          ariaLabel: `前置连线 ${doc.nodes.find((n) => n.id === e.source)?.title} 到 ${doc.nodes.find((n) => n.id === e.target)?.title}`,
        }))}
        nodeTypes={nodeTypes}
        onInit={setInstance}
        onNodesChange={changeNodes}
        onNodeClick={(_, node) => select(node.id)}
        onNodeDragStop={(_, node) => onMove?.(node.id, node.position)}
        onConnect={onConnect}
        onEdgesDelete={(edges) => onEdgeDelete?.(edges.map((e) => e.id))}
        nodesDraggable={editable}
        nodesConnectable={editable}
        edgesFocusable={editable}
        deleteKeyCode={null}
        onEdgeClick={
          editable ? (_, edge) => onEdgeDelete?.([edge.id]) : undefined
        }
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
        minZoom={0.15}
        maxZoom={1.5}
        colorMode="dark"
        ariaLabelConfig={{
          "controls.zoomIn.ariaLabel": "放大路线",
          "controls.zoomOut.ariaLabel": "缩小路线",
          "controls.fitView.ariaLabel": "适应画布",
          "node.a11yDescription.default":
            "按回车选择节点，可使用清单和表单编辑前置关系。",
        }}
      >
        <Background gap={24} size={1} color="#34343a" />
        <Controls showInteractive={false} />
      </ReactFlow>
      <span className="road-canvas-caption">
        {editable
          ? "拖动调整位置 · 拖动圆点连接 · 点击连线移除"
          : "前置关系为学习建议，可按自己的基础探索"}
      </span>
    </div>
  );
}
