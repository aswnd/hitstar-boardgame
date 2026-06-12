import dagre from 'dagre';
import type { BoardData, TileColor, Category } from './types';

// Shortest path from start to end must be exactly this many hops.
const SHORTEST_PATH = 4;

interface RawNode {
  id: string;
  label: string;
  color: TileColor;
  category: Category;
  special?: boolean;
}

interface RawBoard {
  startNodeId: string;
  endNodeId: string;
  nodes: RawNode[];
  edges: [string, string][];
}

function buildBoard(raw: RawBoard): BoardData {
  const NODE_SIZE = 84; // matches 2 * tile radius on the client
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 100, ranksep: 60, marginx: 70, marginy: 70 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of raw.nodes) {
    g.setNode(node.id, { width: NODE_SIZE, height: NODE_SIZE });
  }
  for (const [src, dst] of raw.edges) {
    g.setEdge(src, dst);
  }

  dagre.layout(g);

  const tiles: BoardData['tiles'] = {};

  for (const node of raw.nodes) {
    const { x, y } = g.node(node.id) as { x: number; y: number };
    const nextTiles = raw.edges.filter(([s]) => s === node.id).map(([, d]) => d);
    tiles[node.id] = {
      id: node.id,
      label: node.label,
      color: node.color,
      category: node.category,
      nextTiles,
      x: Math.round(x),
      y: Math.round(y),
      ...(node.special ? { special: true } : {}),
    };
  }

  return { tiles, startTileId: raw.startNodeId, endTileId: raw.endNodeId };
}

function bfs(adj: Record<string, string[]>, start: string): Record<string, number> {
  const dist: Record<string, number> = { [start]: 0 };
  const queue = [start];
  let i = 0;
  while (i < queue.length) {
    const node = queue[i++];
    for (const nb of adj[node] ?? []) {
      if (dist[nb] === undefined) { dist[nb] = dist[node] + 1; queue.push(nb); }
    }
  }
  return dist;
}

const CATEGORIES: Category[] = ['title', 'artist', 'year_exact', 'year_range', 'decade'];

function tryGenerate(): BoardData | null {
  const ri = (lo: number, hi: number) => Math.floor(Math.random() * (hi - lo + 1)) + lo;
  const pick = <T>(arr: T[]): T => arr[ri(0, arr.length - 1)];

  // Nodes are numbered in topological order so any edge i→j has i < j,
  // guaranteeing the graph is a DAG without extra checks.
  const N = ri(10, 20);
  const ids = Array.from({ length: N }, (_, i) => `t${i + 1}`);
  const allIds = ['start', ...ids, 'end'];

  const outDeg: Record<string, number> = Object.fromEntries(allIds.map(id => [id, 0]));
  const edgeSet = new Set<string>();

  // Add edge only if source hasn't hit max out-degree of 2.
  const tryAdd = (s: string, d: string) => {
    if (edgeSet.has(`${s}>${d}`) || outDeg[s] >= 2) return false;
    edgeSet.add(`${s}>${d}`);
    outDeg[s]++;
    return true;
  };

  // Random forward edges among intermediate nodes (only i→j where i<j)
  for (let i = 0; i < N - 1; i++) {
    for (let j = i + 1; j < N; j++) {
      if (outDeg[ids[i]] >= 3) break;
      if (Math.random() < 0.35) tryAdd(ids[i], ids[j]);
    }
  }

  // Random edges from intermediate nodes directly to end
  for (let i = 0; i < N; i++) {
    if (Math.random() < 0.25) tryAdd(ids[i], 'end');
  }

  // Random edges from start into the first half of the node list
  const startPool = ids.slice(0, Math.max(1, Math.ceil(N / 2))).sort(() => Math.random() - 0.5);
  for (const id of startPool) {
    if (outDeg['start'] >= 3) break;
    if (Math.random() < 0.7) tryAdd('start', id);
  }
  if (outDeg['start'] === 0) tryAdd('start', ids[0]);

  // Guarantee every intermediate node has at least one outgoing edge
  for (let i = 0; i < N; i++) {
    if (outDeg[ids[i]] > 0) continue;
    const candidates = [...ids.slice(i + 1), 'end'].sort(() => Math.random() - 0.5);
    for (const c of candidates) if (tryAdd(ids[i], c)) break;
  }

  const edges = [...edgeSet].map(e => e.split('>') as [string, string]);

  const fwd: Record<string, string[]> = Object.fromEntries(allIds.map(id => [id, []]));
  const rev: Record<string, string[]> = Object.fromEntries(allIds.map(id => [id, []]));
  for (const [s, d] of edges) { fwd[s].push(d); rev[d].push(s); }

  // Reject if any intermediate node is unreachable from start or cannot reach end
  const fromStart = bfs(fwd, 'start');
  const fromEnd   = bfs(rev, 'end');
  for (const id of ids) {
    if (fromStart[id] === undefined || fromEnd[id] === undefined) return null;
  }
  if (fromStart['end'] === undefined) return null;

  if (fromStart['end'] !== SHORTEST_PATH) return null;

  const nodes: RawNode[] = [
    { id: 'start', label: 'START', color: 'red', category: 'title' },
    ...ids.map((id, i) => ({
      id,
      label: String(i + 1),
      color: 'red' as TileColor, // overridden by CAT_COLOR in game.ts
      category: pick(CATEGORIES),
      ...(Math.random() < 0.2 ? { special: true } : {}),
    })),
    { id: 'end', label: 'END', color: 'red', category: 'title' },
  ];

  return buildBoard({ startNodeId: 'start', endNodeId: 'end', nodes, edges });
}

export function generateBoard(): BoardData {
  for (;;) {
    const board = tryGenerate();
    if (board) return board;
  }
}

export const defaultBoard: BoardData = generateBoard();
