import { Minus, Plus, Scan } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";
import type { CursorPin, MapEdge, MapNode, PresencePin } from "../types/signalRoom";
import { Avatar } from "./Primitives";

interface RoomMapProps {
  nodes: MapNode[];
  edges: MapEdge[];
  presence: PresencePin[];
  cursors: CursorPin[];
  focusedNodeId: string;
  researchingNodeIds?: ReadonlySet<string>;
  insetLeft?: number;
  insetRight?: number;
  onFocusNode: (nodeId: string) => void;
  onClearFocus?: () => void;
  onCursorMove?: (x: number, y: number) => void;
  onMoveNode?: (nodeId: string, x: number, y: number) => Promise<boolean>;
}

interface PositionedNode {
  node: MapNode;
  x: number;
  y: number;
}

interface MapLayout {
  nodes: PositionedNode[];
}

interface DragState {
  moved: boolean;
  scrollLeft: number;
  scrollTop: number;
  startX: number;
  startY: number;
}

interface NodeDragState {
  currentX: number;
  currentY: number;
  moved: boolean;
  nodeId: string;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
}

type DraftNodePositions = Record<string, { x: number; y: number }>;

const STAGE_W = 3600;
const STAGE_H = 2400;
const CX = STAGE_W / 2;
const CY = STAGE_H / 2;
const MIN_ZOOM = 0.38;
const MAX_ZOOM = 2.4;

export function RoomMap({
  nodes,
  edges,
  presence,
  cursors,
  focusedNodeId,
  researchingNodeIds,
  insetLeft = 0,
  insetRight = 0,
  onFocusNode,
  onClearFocus,
  onCursorMove,
  onMoveNode,
}: RoomMapProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const nodeDragRef = useRef<NodeDragState | null>(null);
  const suppressNodeClickRef = useRef<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [draftNodePositions, setDraftNodePositions] = useState<DraftNodePositions>({});
  const mapLayout = layoutMapNodes(nodes, edges, draftNodePositions);
  const layout = mapLayout.nodes;
  const hasSelection = layout.some((positioned) => positioned.node.id === focusedNodeId);
  const positionById = new Map(layout.map((positioned) => [positioned.node.id, positioned]));
  const drawnEdges = edges
    .map((edge) => {
      const from = positionById.get(edge.fromId);
      const to = positionById.get(edge.toId);
      if (!from || !to) return null;
      return { edge, from, to };
    })
    .filter((value): value is { edge: MapEdge; from: PositionedNode; to: PositionedNode } => value !== null);

  const fit = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const rect = viewport.getBoundingClientRect();
    const availableWidth = Math.max(rect.width - insetLeft - insetRight, 220);
    const nextZoom = Math.min(1, Math.max(MIN_ZOOM, availableWidth / 1380, (rect.height - 80) / 1000));
    setZoom(nextZoom);
    requestAnimationFrame(() => {
      viewport.scrollLeft = Math.max(0, CX * nextZoom - availableWidth / 2 - 20);
      viewport.scrollTop = Math.max(0, CY * nextZoom - rect.height / 2 - 30);
    });
  }, [insetLeft, insetRight]);

  useLayoutEffect(() => {
    fit();
    const resizeObserver = new ResizeObserver(fit);
    if (viewportRef.current) resizeObserver.observe(viewportRef.current);
    return () => resizeObserver.disconnect();
  }, [fit, nodes.length]);

  useEffect(() => {
    setDraftNodePositions((current) => {
      let next: DraftNodePositions | undefined;
      for (const [nodeId, position] of Object.entries(current)) {
        const node = nodes.find((candidate) => candidate.id === nodeId);
        if (!node || (samePosition(node.x, position.x) && samePosition(node.y, position.y))) {
          next = { ...(next ?? current) };
          delete next[nodeId];
        }
      }
      return next ?? current;
    });
  }, [nodes]);

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (target.closest(".node-card, .zoom-ctrl")) return;

    dragRef.current = {
      moved: false,
      scrollLeft: event.currentTarget.scrollLeft,
      scrollTop: event.currentTarget.scrollTop,
      startX: event.clientX,
      startY: event.clientY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.classList.add("grabbing");
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (onCursorMove) {
      const rect = event.currentTarget.getBoundingClientRect();
      const stageX = (event.currentTarget.scrollLeft + event.clientX - rect.left) / zoom;
      const stageY = (event.currentTarget.scrollTop + event.clientY - rect.top) / zoom;
      onCursorMove(stageX, stageY);
    }

    const drag = dragRef.current;
    if (!drag) return;

    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    event.currentTarget.scrollLeft = drag.scrollLeft - dx;
    event.currentTarget.scrollTop = drag.scrollTop - dy;
  }

  function endPan(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    dragRef.current = null;
    event.currentTarget.classList.remove("grabbing");
    if (drag && !drag.moved) {
      onClearFocus?.();
    }
  }

  function handleNodePointerDown(node: MapNode, x: number, y: number, event: PointerEvent<HTMLButtonElement>) {
    if (!onMoveNode) return;
    nodeDragRef.current = {
      currentX: x,
      currentY: y,
      moved: false,
      nodeId: node.id,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: x,
      startY: y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.stopPropagation();
  }

  function handleNodePointerMove(event: PointerEvent<HTMLButtonElement>) {
    const drag = nodeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const dx = (event.clientX - drag.startClientX) / zoom;
    const dy = (event.clientY - drag.startClientY) / zoom;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    if (!drag.moved) return;

    drag.currentX = clamp(drag.startX + dx, 150, STAGE_W - 150);
    drag.currentY = clamp(drag.startY + dy, 120, STAGE_H - 120);
    setDraftNodePositions((current) => ({
      ...current,
      [drag.nodeId]: { x: drag.currentX, y: drag.currentY },
    }));
    event.preventDefault();
    event.stopPropagation();
  }

  function handleNodePointerEnd(event: PointerEvent<HTMLButtonElement>) {
    const drag = nodeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    nodeDragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    event.stopPropagation();

    if (!drag.moved) return;

    suppressNodeClickRef.current = drag.nodeId;
    event.preventDefault();
    void onMoveNode?.(drag.nodeId, Math.round(drag.currentX), Math.round(drag.currentY)).then((ok) => {
      if (ok) return;
      setDraftNodePositions((current) => {
        const next = { ...current };
        delete next[drag.nodeId];
        return next;
      });
    });
  }

  function handleNodeClick(nodeId: string) {
    if (suppressNodeClickRef.current === nodeId) {
      suppressNodeClickRef.current = null;
      return;
    }
    onFocusNode(nodeId);
  }

  function zoomBy(factor: number) {
    const viewport = viewportRef.current;
    if (!viewport) {
      setZoom((current) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current * factor)));
      return;
    }
    const rect = viewport.getBoundingClientRect();
    zoomAtPoint(viewport, rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
  }

  function zoomAtPoint(viewport: HTMLDivElement, clientX: number, clientY: number, factor: number) {
    const rect = viewport.getBoundingClientRect();
    setZoom((current) => {
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current * factor));
      const focusX = (viewport.scrollLeft + clientX - rect.left) / current;
      const focusY = (viewport.scrollTop + clientY - rect.top) / current;
      requestAnimationFrame(() => {
        viewport.scrollLeft = Math.max(0, focusX * next - (clientX - rect.left));
        viewport.scrollTop = Math.max(0, focusY * next - (clientY - rect.top));
      });
      return next;
    });
  }

  // Ctrl/meta/alt + wheel = zoom. Attach a NON-passive native listener so
  // preventDefault works without React's passive-listener console warning.
  const zoomAtPointRef = useRef(zoomAtPoint);
  zoomAtPointRef.current = zoomAtPoint;
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey && !event.altKey) return;
      event.preventDefault();
      zoomAtPointRef.current(viewport, event.clientX, event.clientY, Math.exp(-event.deltaY * 0.0014));
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <div className="map-frame">
      <div
        className="map-viewport infinite"
        ref={viewportRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endPan}
        onPointerLeave={endPan}
      >
        <div
          className="map-scroll-space"
          style={{
            width: STAGE_W * zoom,
            height: STAGE_H * zoom,
          }}
        >
          <div className="map-layer" style={{ transform: `scale(${zoom})`, width: STAGE_W, height: STAGE_H }}>
            <svg className="map-rings" width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}>
              {[136, 270, 420, 560].map((radius) => (
                <circle cx={CX} cy={CY} key={radius} r={radius} />
              ))}
            </svg>

            <svg className="map-edges" width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}>
              {drawnEdges.map(({ edge, from, to }) => {
                const active = focusedNodeId === edge.fromId || focusedNodeId === edge.toId;
                const dim = hasSelection && !active;
                const midX = (from.x + to.x) / 2;
                const midY = (from.y + to.y) / 2;
                return (
                  <g key={edge.id} className={["edge-group", active ? "active" : "", dim ? "dim" : ""].filter(Boolean).join(" ")}>
                    <path className="lit" d={nodeEdgePath(from, to)} />
                    {edge.label ? (
                      <text className="edge-label" x={midX} y={midY} textAnchor="middle">
                        {edge.label}
                      </text>
                    ) : null}
                  </g>
                );
              })}
            </svg>

            {layout.map(({ node, x, y }) => (
              <MapNodeButton
                dimmed={hasSelection && focusedNodeId !== node.id}
                focused={focusedNodeId === node.id}
                researching={researchingNodeIds?.has(node.id) ?? false}
                key={node.id}
                node={node}
                x={x}
                y={y}
                draggable={Boolean(onMoveNode)}
                onClickNode={handleNodeClick}
                onPointerDownNode={handleNodePointerDown}
                onPointerMoveNode={handleNodePointerMove}
                onPointerEndNode={handleNodePointerEnd}
              />
            ))}

            {nodes.length === 0 ? (
              <div className="empty-map-state">
                <h3>Waiting for first signal</h3>
                <p>Start the mic and the room will build the map live from transcript and Realtime tools.</p>
              </div>
            ) : null}

            {cursors.map((cursor) => (
              <div className="live-cursor" key={cursor.id} style={{ left: cursor.x, top: cursor.y }}>
                <svg width="20" height="22" viewBox="0 0 20 22" fill="none" aria-hidden="true">
                  <path
                    d="M2 2 L2 17 L6.5 13 L9.5 19.5 L12 18.3 L9 12 L15 12 Z"
                    fill={cursor.color}
                    stroke="#fff"
                    strokeWidth="1.4"
                    strokeLinejoin="round"
                  />
                </svg>
                <span className="live-cursor-label" style={{ backgroundColor: cursor.color }}>
                  {cursor.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="zoom-ctrl" style={{ right: insetRight + 16 }}>
        <button className="zbtn" type="button" onClick={() => zoomBy(1.25)} title="Zoom in">
          <Plus size={16} strokeWidth={2.1} />
        </button>
        <span className="zlvl mono">{Math.round(zoom * 100)}%</span>
        <button className="zbtn" type="button" onClick={() => zoomBy(0.8)} title="Zoom out">
          <Minus size={16} strokeWidth={2.1} />
        </button>
        <button className="zbtn fit" type="button" onClick={fit} title="Recenter">
          <Scan size={15} strokeWidth={2.1} />
        </button>
      </div>
    </div>
  );
}

function MapNodeButton({
  dimmed,
  draggable,
  focused,
  researching,
  node,
  x,
  y,
  onClickNode,
  onPointerDownNode,
  onPointerMoveNode,
  onPointerEndNode,
}: {
  dimmed: boolean;
  draggable: boolean;
  focused: boolean;
  researching: boolean;
  node: MapNode;
  x: number;
  y: number;
  onClickNode: (nodeId: string) => void;
  onPointerDownNode: (node: MapNode, x: number, y: number, event: PointerEvent<HTMLButtonElement>) => void;
  onPointerMoveNode: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerEndNode: (event: PointerEvent<HTMLButtonElement>) => void;
}) {
  const agent = node.agent;
  const noAgent = agent?.kind === "none";
  const working = researching || agent?.state === "working";
  const ready = agent?.state === "ready" && Boolean(agent.insight) && !noAgent;
  const status = working
    ? { label: "Thinking", tone: "checking" as const }
    : noAgent
      ? { label: "No agent", tone: "listening" as const }
      : ready
        ? { label: "Insight ready", tone: "ready" as const }
        : statusForNode(node);
  const body = ready && agent ? agent.insight : node.summary;

  return (
    <button
      className={[
        "node-card",
        "positioned",
        draggable ? "draggable" : "",
        node.isRoot ? "root" : "",
        focused ? "selected" : "",
        dimmed ? "dim" : "",
        working ? "researching" : "",
        noAgent ? "no-agent" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={mapNodeStyle(x, y)}
      type="button"
      onClick={() => onClickNode(node.id)}
      onPointerDown={(event) => onPointerDownNode(node, x, y, event)}
      onPointerMove={onPointerMoveNode}
      onPointerUp={onPointerEndNode}
      onPointerCancel={onPointerEndNode}
    >
      {node.hasAlert ? <span className="alert-pin" aria-hidden="true" /> : null}
      {working ? <span className="research-ring" aria-hidden="true" /> : null}
      <div className="node-top">
        <Avatar initial={node.ownerInitial} kind={node.ownerKind} />
        <span className="node-type">{node.isRoot ? "root question" : node.focus.type}</span>
        <span className={`node-status ${status.tone}`}>{status.label}</span>
      </div>
      <h3>{node.title}</h3>
      <p className="sum">{body}</p>
      <div className="node-foot">
        <span className="owner-tag">{ready && agent ? `Agent · ${agent.confidence}` : node.source}</span>
        <span className={`impact ${node.impactTone}`}>{node.impact}</span>
      </div>
    </button>
  );
}

function layoutMapNodes(nodes: MapNode[], edges: MapEdge[], draftNodePositions: DraftNodePositions): MapLayout {
  if (nodes.length === 0) return { nodes: [] };

  const root = nodes.find((node) => node.isRoot) ?? nodes[0];
  const automaticNodes = layoutAutomaticNodes(nodes, edges, root);

  return {
    nodes: automaticNodes.map((positioned) => {
      const draft = draftNodePositions[positioned.node.id];
      if (draft) return { ...positioned, x: draft.x, y: draft.y };
      if (hasExplicitPosition(positioned.node)) {
        return { ...positioned, x: positioned.node.x, y: positioned.node.y };
      }
      return positioned;
    }),
  };
}

function layoutAutomaticNodes(nodes: MapNode[], edges: MapEdge[], root: MapNode): PositionedNode[] {
  const branches = nodes.filter((node) => node.id !== root.id).sort(compareBranches);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const childIdsByParent = new Map<string, string[]>();

  for (const edge of edges) {
    if (!nodeById.has(edge.fromId) || !nodeById.has(edge.toId) || edge.fromId === edge.toId) continue;
    childIdsByParent.set(edge.fromId, [...(childIdsByParent.get(edge.fromId) ?? []), edge.toId]);
  }

  const used = new Set<string>([root.id]);
  const clusters: NodeCluster[] = [];
  const rootChildren = (childIdsByParent.get(root.id) ?? [])
    .map((id) => nodeById.get(id))
    .filter((node): node is MapNode => Boolean(node))
    .sort(compareBranches);

  for (const parent of rootChildren) {
    const childNodes = (childIdsByParent.get(parent.id) ?? [])
      .map((id) => nodeById.get(id))
      .filter((node): node is MapNode => node !== undefined && node.id !== root.id)
      .sort(compareBranches);

    if (childNodes.length === 0) continue;
    used.add(parent.id);
    childNodes.forEach((node) => used.add(node.id));
    clusters.push({
      key: clusterKey(parent),
      parentId: parent.id,
      nodes: [parent, ...childNodes],
    });
  }

  const remaining = branches.filter((node) => !used.has(node.id));
  clusters.push(...clusterBranches(remaining));
  clusters.sort(compareClusters);

  return [
    { node: root, x: CX, y: CY },
    ...clusters.flatMap((cluster, clusterIndex) =>
      cluster.nodes.map((node, nodeIndex) => ({
        node,
        ...slotForCluster(cluster, clusterIndex, nodeIndex),
      }))
    ),
  ];
}

function compareBranches(left: MapNode, right: MapNode): number {
  return clusterRank(left) - clusterRank(right) || branchRank(left) - branchRank(right) || textKey(left).localeCompare(textKey(right));
}

function branchRank(node: MapNode): number {
  const type = node.focus.type.toLowerCase();
  if (node.hasAlert || node.impact === "review") return 0;
  if (/\bbranch\b|\bcategory\b|\btheme\b/.test(type)) return 1;
  if (/\bfactor\b|\bresearch\b/.test(type)) return 2;
  if (/\bclaim\b|\btopic shift\b/.test(type)) return 3;
  if (/\bquestion\b|request|data/.test(type)) return 4;
  return 5;
}

function textKey(node: MapNode): string {
  return `${node.focus.type} ${node.title}`.toLowerCase();
}

interface NodeCluster {
  key: string;
  nodes: MapNode[];
  parentId?: string;
}

function clusterBranches(nodes: MapNode[]): NodeCluster[] {
  const byCluster = new Map<string, MapNode[]>();
  for (const node of nodes) {
    const key = clusterKey(node);
    byCluster.set(key, [...(byCluster.get(key) ?? []), node]);
  }

  return [...byCluster.entries()]
    .map(([key, clusterNodes]) => ({
      key,
      nodes: clusterNodes.sort(compareBranches),
    }))
    .sort((left, right) => clusterRank(left.nodes[0]) - clusterRank(right.nodes[0]) || left.key.localeCompare(right.key));
}

function compareClusters(left: NodeCluster, right: NodeCluster): number {
  return (
    clusterRank(left.nodes[0]) - clusterRank(right.nodes[0]) ||
    (left.parentId ? 0 : 1) - (right.parentId ? 0 : 1) ||
    left.key.localeCompare(right.key)
  );
}

function clusterRank(node: MapNode): number {
  const key = clusterKey(node);
  if (key === "urgent") return 0;
  if (key === "center-correction") return 1;
  if (key === "environment") return 2;
  if (key === "genetics") return 3;
  if (key === "effort") return 4;
  if (key === "claims") return 5;
  if (key === "actors") return 6;
  if (key === "local-politics") return 7;
  if (key === "data-questions") return 8;
  if (key === "factors") return 9;
  return 10;
}

function clusterKey(node: MapNode): string {
  const text = `${node.focus.type} ${node.title} ${node.summary}`.toLowerCase();
  if (node.hasAlert || node.impact === "review") return "urgent";
  if (/\btopic shift\b|\bcorrection\b|\bcorrects?\b/.test(text)) return "center-correction";
  if (/\b(environments?|school|high school|stuyvesant|classmates?|friends?|peers?|teachers?|upbringing|education)\b/.test(text)) return "environment";
  if (/\b(genetic|genes?|inherited|parents?|siblings?|family|cousins?|aunts?|relatives?)\b/.test(text)) return "genetics";
  if (/\b(hard work|effort|practice|discipline|studying|study habits?|work ethic|motivation)\b/.test(text)) return "effort";
  if (/\bquestion\b|\bhow much\b|\bdata\b|\btransported\b|\blook up\b|\bresearch\b/.test(text)) return "data-questions";
  if (/\bdomestic\b|\bregime\b|\binternal\b|\bpolitics\b|\bayatollah\b/.test(text)) return "local-politics";
  if (/\bpakistan\b|\bindia\b|\brussia\b|\bputin\b|\bchina\b|\bisrael\b|\bukraine\b|\bmediati|\bdiplomacy\b|\bactions?\b|\brole\b/.test(text)) return "actors";
  if (/\bclaim\b|\bclosed\b|\bclosure\b|\battributed\b|\bbecause\b|\bdue to\b/.test(text)) return "claims";
  if (/\bfactor\b/.test(text)) return "factors";
  return "other";
}

interface ClusterAnchor {
  direction: "left" | "right" | "top" | "bottom";
  x: number;
  y: number;
}

function slotForCluster(cluster: NodeCluster, clusterIndex: number, nodeIndex: number): { x: number; y: number } {
  const anchor = anchorForCluster(cluster.key, clusterIndex);
  if (cluster.parentId) {
    if (nodeIndex === 0) return { x: anchor.x, y: anchor.y };
    return childSlot(anchor, nodeIndex - 1, cluster.nodes.length - 1);
  }

  return flatSlot(anchor, nodeIndex, cluster.nodes.length);
}

function anchorForCluster(key: string, clusterIndex: number): ClusterAnchor {
  const keyed: Record<string, ClusterAnchor> = {
    urgent: { x: CX - 520, y: CY - 420, direction: "left" },
    "center-correction": { x: CX, y: CY - 500, direction: "top" },
    environment: { x: CX - 400, y: CY - 250, direction: "left" },
    genetics: { x: CX - 400, y: CY + 245, direction: "left" },
    effort: { x: CX + 560, y: CY + 300, direction: "right" },
    claims: { x: CX + 560, y: CY - 250, direction: "right" },
    actors: { x: CX + 560, y: CY + 20, direction: "right" },
    "local-politics": { x: CX + 260, y: CY - 520, direction: "top" },
    "data-questions": { x: CX + 560, y: CY - 520, direction: "right" },
    factors: { x: CX - 400, y: CY + 40, direction: "left" },
  };
  if (keyed[key]) return keyed[key];

  const anchors: ClusterAnchor[] = [
    { x: CX - 820, y: CY - 40, direction: "left" },
    { x: CX + 820, y: CY - 40, direction: "right" },
    { x: CX - 280, y: CY + 560, direction: "bottom" },
    { x: CX + 280, y: CY + 560, direction: "bottom" },
  ];
  const anchor = anchors[clusterIndex % anchors.length];
  if (clusterIndex < anchors.length) return anchor;
  const extra = clusterIndex - anchors.length;
  const ring = Math.floor(extra / anchors.length) + 1;
  return { ...anchor, x: anchor.x + ring * 170, y: anchor.y + ring * 130 };
}

function childSlot(anchor: ClusterAnchor, childIndex: number, childCount: number): { x: number; y: number } {
  const spacing = 190;
  if (anchor.direction === "left" || anchor.direction === "right") {
    const sign = anchor.direction === "left" ? -1 : 1;
    const columns = childCount >= 4 ? 2 : 1;
    const rows = Math.ceil(childCount / columns);
    const col = childIndex % columns;
    const row = Math.floor(childIndex / columns);
    return {
      x: anchor.x + sign * 180 - sign * col * 306,
      y: anchor.y + (row - (rows - 1) / 2) * spacing,
    };
  }

  const sign = anchor.direction === "top" ? -1 : 1;
  const columns = Math.min(3, childCount);
  const rows = Math.ceil(childCount / columns);
  const col = childIndex % columns;
  const row = Math.floor(childIndex / columns);
  return {
    x: anchor.x + (col - (columns - 1) / 2) * 306,
    y: anchor.y + sign * (260 + row * spacing),
  };
}

function flatSlot(anchor: ClusterAnchor, nodeIndex: number, totalInCluster: number): { x: number; y: number } {
  const columns = totalInCluster >= 4 ? 2 : 1;
  const rows = Math.ceil(totalInCluster / columns);
  const col = nodeIndex % columns;
  const row = Math.floor(nodeIndex / columns);
  const xSpacing = 306;
  const ySpacing = 190;
  return {
    x: anchor.x + (col - (columns - 1) / 2) * xSpacing,
    y: anchor.y + (row - (rows - 1) / 2) * ySpacing,
  };
}

function hasExplicitPosition(node: MapNode): node is MapNode & { x: number; y: number } {
  if (typeof node.x !== "number" || typeof node.y !== "number") return false;
  return !samePosition(node.x, 500) || !samePosition(node.y, 280);
}

function samePosition(left: unknown, right: number): boolean {
  return typeof left === "number" && Number.isFinite(left) && Math.abs(left - right) < 0.5;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function nodeEdgePath(root: PositionedNode, target: PositionedNode): string {
  const towardRight = target.x > root.x;
  const rootX = root.x + (towardRight ? 146 : -146);
  const targetX = target.x + (towardRight ? -106 : 106);
  const control = Math.max(180, Math.abs(targetX - rootX) * 0.42);
  const c1 = rootX + (towardRight ? control : -control);
  const c2 = targetX + (towardRight ? -control : control);
  return `M${rootX} ${root.y} C ${c1} ${root.y}, ${c2} ${target.y}, ${targetX} ${target.y}`;
}

function statusForNode(node: MapNode): { label: string; tone: "listening" | "checking" | "ready" } {
  if (node.hasAlert || node.impact === "review") return { label: "Finding ready", tone: "ready" };
  if (/research|agent|router/i.test(node.source) && !node.isRoot) return { label: "Checking", tone: "checking" };
  return { label: "Listening", tone: "listening" };
}

function mapNodeStyle(x: number, y: number): CSSProperties {
  return {
    left: `${x}px`,
    top: `${y}px`,
  };
}
