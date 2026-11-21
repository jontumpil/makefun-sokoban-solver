// Push-optimal Sokoban solver (make.fun sokoban-solver-01).
// A drawn level is a hallway with up to four rooms off it; a box
// never travels between rooms, so the level's push optimum is the
// sum of its rooms'. Each room is solved by breadth-first search
// over pushes (states: the room's boxes + the player's reachable
// region, named by its lowest square), which is push-optimal.
// Dead squares (pull-back from the goals) and frozen 2x2 blocks
// prune dead states. Deterministic: fixed orders, state budgets,
// no clock. Node standard library only.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const DIRS: [number, number, string, string][] = [
  [0, -1, 'u', 'U'], [0, 1, 'd', 'D'], [-1, 0, 'l', 'L'], [1, 0, 'r', 'R'],
];
const ROOM_STATES = 1_500_000;
const LEVEL_STATES = 2_500_000;

type Level = { w: number; wall: Uint8Array; goals: number[]; boxes: number[]; player: number };

function parseLevel(text: string): Level {
  const rows = text.split('\n').filter((r) => r.length > 0);
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const wall = new Uint8Array(w * h).fill(1);
  const goals: number[] = [];
  const boxes: number[] = [];
  let player = -1;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      const i = y * w + x;
      if (ch === '#') continue;
      wall[i] = 0;
      if (ch === '.' || ch === '*' || ch === '+') goals.push(i);
      if (ch === '$' || ch === '*') boxes.push(i);
      if (ch === '@' || ch === '+') player = i;
    }
  });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) wall[y * w + x] = 1;
  }
  boxes.sort((a, b) => a - b);
  goals.sort((a, b) => a - b);
  return { w, wall, goals, boxes, player };
}

// Squares a lone box can be pushed onto some goal from, pulled
// back from the goals over open floor.
function liveSquares(w: number, wall: Uint8Array, goals: number[]): Uint8Array {
  const live = new Uint8Array(wall.length);
  const q: number[] = [];
  for (const g of goals) { live[g] = 1; q.push(g); }
  for (let head = 0; head < q.length; head++) {
    const c = q[head];
    for (const [dx, dy] of DIRS) {
      const d = dy * w + dx;
      const from = c - d;
      const stand = c - 2 * d;
      if (from < 0 || from >= wall.length || stand < 0 || stand >= wall.length) continue;
      if (wall[from] || wall[stand] || live[from]) continue;
      live[from] = 1;
      q.push(from);
    }
  }
  return live;
}

// Flood the player's region from `start` (walls and boxes block):
// its lowest square, plus a parent step and letter per square.
function flood(w: number, wall: Uint8Array, boxSet: Set<number>, start: number) {
  const step = new Int32Array(wall.length).fill(-1);
  const letter: string[] = new Array(wall.length).fill('');
  const q: number[] = [start];
  step[start] = start;
  let rep = start;
  for (let head = 0; head < q.length; head++) {
    const c = q[head];
    if (c < rep) rep = c;
    for (let k = 0; k < 4; k++) {
      const [dx, dy, walk] = DIRS[k];
      const n = c + dy * w + dx;
      if (n < 0 || n >= wall.length || wall[n] || boxSet.has(n) || step[n] !== -1) continue;
      step[n] = c;
      letter[n] = walk;
      q.push(n);
    }
  }
  return { rep, step, letter };
}

function walkLetters(f: { step: Int32Array; letter: string[] }, start: number, target: number): string {
  const out: string[] = [];
  let c = target;
  while (c !== start) { out.push(f.letter[c]); c = f.step[c]; }
  return out.reverse().join('');
}

// A 2x2 of walls and boxes holding a box off its goal never moves.
function frozenBlock(w: number, wall: Uint8Array, boxSet: Set<number>, goalSet: Set<number>, dest: number): boolean {
  const dx = dest % w;
  const dy = Math.floor(dest / w);
  for (const ox of [-1, 0]) for (const oy of [-1, 0]) {
    let solid = true;
    let offGoal = false;
    let cells = 0;
    for (const cx of [0, 1]) for (const cy of [0, 1]) {
      const x = dx + ox + cx;
      const y = dy + oy + cy;
      if (x < 0 || y < 0 || x >= w) { solid = false; continue; }
      const i = y * w + x;
      cells++;
      if (!wall[i] && !boxSet.has(i)) solid = false;
      if (boxSet.has(i) && !goalSet.has(i)) offGoal = true;
    }
    if (solid && offGoal && cells === 4) return true;
  }
  return false;
}

type Node = { boxes: number[]; player: number; parent: number; segment: string };

// Breadth-first search over pushes; first solved state is optimal.
function searchPushes(
  w: number, wall: Uint8Array, goals: number[],
  startBoxes: number[], startPlayer: number, budget: number,
): { moves: string; player: number } | null {
  const goalSet = new Set(goals);
  const live = liveSquares(w, wall, goals);
  const solved = (bs: number[]): boolean => bs.every((b) => goalSet.has(b));
  if (startBoxes.some((b) => !live[b])) return null;
  if (solved(startBoxes)) return { moves: '', player: startPlayer };
  const keyOf = (bs: number[], rep: number): string => String.fromCharCode(rep, ...bs);
  const nodes: Node[] = [{ boxes: startBoxes, player: startPlayer, parent: -1, segment: '' }];
  const seen = new Set<string>([keyOf(startBoxes, flood(w, wall, new Set(startBoxes), startPlayer).rep)]);
  for (let head = 0; head < nodes.length; head++) {
    if (nodes.length > budget) return null;
    const node = nodes[head];
    const boxSet = new Set(node.boxes);
    const reach = flood(w, wall, boxSet, node.player);
    for (const b of node.boxes) {
      for (let k = 0; k < 4; k++) {
        const [dx, dy, , pushLetter] = DIRS[k];
        const d = dy * w + dx;
        const dest = b + d;
        const stand = b - d;
        if (dest < 0 || dest >= wall.length || stand < 0 || stand >= wall.length) continue;
        if (wall[dest] || boxSet.has(dest) || !live[dest]) continue;
        if (wall[stand] || boxSet.has(stand) || reach.step[stand] === -1) continue;
        const next = node.boxes.filter((x) => x !== b);
        next.push(dest);
        next.sort((a, b2) => a - b2);
        if (frozenBlock(w, wall, new Set(next), goalSet, dest)) continue;
        const segment = walkLetters(reach, node.player, stand) + pushLetter;
        if (solved(next)) {
          const parts: string[] = [segment];
          let cur = node;
          while (cur.parent !== -1) { parts.push(cur.segment); cur = nodes[cur.parent]; }
          return { moves: parts.reverse().join(''), player: b };
        }
        const key = keyOf(next, flood(w, wall, new Set(next), b).rep);
        if (seen.has(key)) continue;
        seen.add(key);
        nodes.push({ boxes: next, player: b, parent: head, segment });
      }
    }
  }
  return null;
}

// Rooms: wall off the hallway row's dead squares, take the
// connected parts of the rest. Null when the level is not rooms.
function roomsOf(level: Level): { boxes: number[]; goals: number[] }[] | null {
  const { w, wall, goals, boxes, player } = level;
  const live = liveSquares(w, wall, goals);
  const cut = wall.slice();
  const rowStart = Math.floor(player / w) * w;
  for (let x = 0; x < w; x++) if (!live[rowStart + x]) cut[rowStart + x] = 1;
  const part = new Int32Array(wall.length).fill(-1);
  const rooms: { boxes: number[]; goals: number[] }[] = [];
  for (let s = 0; s < wall.length; s++) {
    if (cut[s] || part[s] !== -1) continue;
    const q: number[] = [s];
    part[s] = rooms.length;
    for (let head = 0; head < q.length; head++) {
      const c = q[head];
      for (const [dx, dy] of DIRS) {
        const n = c + dy * w + dx;
        if (n < 0 || n >= wall.length || cut[n] || part[n] !== -1) continue;
        part[n] = rooms.length;
        q.push(n);
      }
    }
    rooms.push({ boxes: [], goals: [] });
  }
  for (const b of boxes) { if (part[b] < 0) return null; rooms[part[b]].boxes.push(b); }
  for (const g of goals) { if (part[g] < 0) return null; rooms[part[g]].goals.push(g); }
  if (rooms.some((r) => r.boxes.length !== r.goals.length)) return null;
  return rooms.filter((r) => r.boxes.length > 0);
}

function solve(text: string): string {
  const level = parseLevel(text);
  const whole = (): string => {
    const r = searchPushes(level.w, level.wall, level.goals, level.boxes, level.player, LEVEL_STATES);
    return r === null ? '' : r.moves;
  };
  const rooms = roomsOf(level);
  if (rooms === null) return whole();
  let player = level.player;
  let moves = '';
  const done: boolean[] = rooms.map(() => false);
  for (let r = 0; r < rooms.length; r++) {
    const wall = level.wall.slice();
    for (let q = 0; q < rooms.length; q++) {
      if (q === r) continue;
      for (const c of done[q] ? rooms[q].goals : rooms[q].boxes) wall[c] = 1;
    }
    const s = searchPushes(level.w, wall, rooms[r].goals, rooms[r].boxes, player, ROOM_STATES);
    if (s === null) return whole();
    moves += s.moves;
    player = s.player;
    done[r] = true;
  }
  return moves;
}

for (const id of readdirSync(I).sort()) {
  const moves = solve(readFileSync(join(I, id, 'level.txt'), 'utf8'));
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'solution.txt'), `${moves}\n`);
}
