// sokoban-solver-01 entry: a push-optimal Sokoban solver.
//
// The levels this competition draws are built as one hallway with up
// to four independent rooms off it: a box can never travel between
// rooms, so a level's push optimum is the sum of its rooms' optima.
// This program therefore cuts the level into its rooms and solves
// each room with a breadth-first search over pushes, which is
// push-optimal by construction: states are expanded in order of
// pushes spent, so the first complete state found costs the fewest
// pushes possible. Walking between pushes is free in the scoring,
// so the search only ever counts pushes.
//
// A search state is the room's box squares plus the player's
// reachable region, named by its lowest square: two player squares
// in one region are interchangeable, because the player can walk
// between them without pushing. The player flood for a state is
// computed once and also yields the walking letters to every push
// stand square, so a finished search replays as one move string.
//
// Squares a box can never leave are pruned: a dead square, from
// which no push (ignoring the other boxes) brings a box to any of
// the room's goals, computed by pulling back from the goals, and a
// frozen 2 x 2 block of walls and boxes with a box off its goal.
// Neither prune can remove a solvable state, so the optimum stands.
//
// Everything is deterministic: fixed direction order, fixed room
// order, no clock, no randomness, and budgets counted in states,
// never in seconds. Node's standard library only.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** [dx, dy, walking letter, pushing letter], in a fixed order. */
const DIRS: [number, number, string, string][] = [
  [0, -1, 'u', 'U'],
  [0, 1, 'd', 'D'],
  [-1, 0, 'l', 'L'],
  [1, 0, 'r', 'R'],
];

/** The most states one room search keeps before it gives up. */
const ROOM_STATES = 1_500_000;
/** The most states the whole-level fallback keeps. */
const LEVEL_STATES = 2_500_000;

interface Level {
  w: number;
  h: number;
  wall: Uint8Array;
  goals: number[];
  boxes: number[];
  player: number;
}

/** Parse XSB level text; squares outside the rows and on the frame are walls. */
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
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) wall[y * w + x] = 1;
    }
  }
  boxes.sort((a, b) => a - b);
  goals.sort((a, b) => a - b);
  return { w, h, wall, goals, boxes, player };
}

/**
 * The squares from which a box alone can be pushed onto some goal:
 * pull back from every goal over open floor — a box on square p can
 * be pushed along d onto a live square when the square behind it,
 * where the player must stand, is open floor too.
 */
function liveSquares(w: number, wall: Uint8Array, goals: number[]): Uint8Array {
  const live = new Uint8Array(wall.length);
  const queue: number[] = [];
  for (const g of goals) {
    live[g] = 1;
    queue.push(g);
  }
  for (let head = 0; head < queue.length; head++) {
    const c = queue[head];
    for (const [dx, dy] of DIRS) {
      const d = dy * w + dx;
      const from = c - d;
      const stand = c - 2 * d;
      if (from < 0 || from >= wall.length || stand < 0 || stand >= wall.length) continue;
      if (wall[from] || wall[stand] || live[from]) continue;
      live[from] = 1;
      queue.push(from);
    }
  }
  return live;
}

/**
 * Flood the player's reachable region from `start` over squares that
 * are neither wall nor box. Returns the region's lowest square (its
 * name), a parent step for every reached square, and the walking
 * letters from `start` to any reached square.
 */
function flood(
  w: number,
  wall: Uint8Array,
  boxSet: Set<number>,
  start: number,
): { rep: number; step: Int32Array; letter: string[] } {
  const step = new Int32Array(wall.length).fill(-1);
  const letter: string[] = new Array(wall.length).fill('');
  const queue: number[] = [start];
  step[start] = start;
  let rep = start;
  for (let head = 0; head < queue.length; head++) {
    const c = queue[head];
    if (c < rep) rep = c;
    for (let k = 0; k < 4; k++) {
      const [dx, dy, walk] = DIRS[k];
      const n = c + dy * w + dx;
      if (n < 0 || n >= wall.length || wall[n] || boxSet.has(n) || step[n] !== -1) continue;
      step[n] = c;
      letter[n] = walk;
      queue.push(n);
    }
  }
  return { rep, step, letter };
}

/** The walking letters from the flood's start to `target`. */
function walkLetters(f: { step: Int32Array; letter: string[] }, start: number, target: number): string {
  const out: string[] = [];
  let c = target;
  while (c !== start) {
    out.push(f.letter[c]);
    c = f.step[c];
  }
  return out.reverse().join('');
}

/**
 * A frozen 2 x 2 block: four squares of walls and boxes with a box
 * among them off its goal can never move again, so any state
 * holding one is dead. Only the blocks around the pushed box's new
 * square can have changed, so only those are checked.
 */
function frozenBlock(
  w: number,
  wall: Uint8Array,
  boxSet: Set<number>,
  goalSet: Set<number>,
  dest: number,
): boolean {
  const dx = dest % w;
  const dy = Math.floor(dest / w);
  for (const ox of [-1, 0]) {
    for (const oy of [-1, 0]) {
      const cells: number[] = [];
      let solid = true;
      let offGoal = false;
      for (const cx of [0, 1]) {
        for (const cy of [0, 1]) {
          const x = dx + ox + cx;
          const y = dy + oy + cy;
          if (x < 0 || y < 0 || x >= w) {
            solid = false;
            continue;
          }
          const i = y * w + x;
          cells.push(i);
          if (!wall[i] && !boxSet.has(i)) solid = false;
          if (boxSet.has(i) && !goalSet.has(i)) offGoal = true;
        }
      }
      if (solid && offGoal && cells.length === 4) return true;
    }
  }
  return false;
}

interface SearchNode {
  boxes: number[];
  player: number;
  parent: number;
  segment: string;
}

/**
 * Breadth-first search over pushes for one set of boxes on a board
 * whose walls already include every other room's boxes. Returns the
 * move letters and the player's final square, or null when the
 * state budget runs out first.
 */
function searchPushes(
  w: number,
  wall: Uint8Array,
  goals: number[],
  startBoxes: number[],
  startPlayer: number,
  budget: number,
): { moves: string; player: number; pushes: number } | null {
  const goalSet = new Set(goals);
  const live = liveSquares(w, wall, goals);
  const solved = (bs: number[]): boolean => bs.every((b) => goalSet.has(b));
  if (startBoxes.some((b) => !live[b])) return null;
  if (solved(startBoxes)) return { moves: '', player: startPlayer, pushes: 0 };

  const startSet = new Set(startBoxes);
  const startFlood = flood(w, wall, startSet, startPlayer);
  const keyOf = (bs: number[], rep: number): string => String.fromCharCode(rep, ...bs);
  const nodes: SearchNode[] = [{ boxes: startBoxes, player: startPlayer, parent: -1, segment: '' }];
  const seen = new Set<string>([keyOf(startBoxes, startFlood.rep)]);

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
        if (wall[dest] || boxSet.has(dest)) continue;
        if (!live[dest]) continue;
        if (wall[stand] || boxSet.has(stand) || reach.step[stand] === -1) continue;
        const next = node.boxes.filter((x) => x !== b);
        next.push(dest);
        next.sort((a, b2) => a - b2);
        if (frozenBlock(w, wall, new Set(next), goalSet, dest)) continue;
        const segment = walkLetters(reach, node.player, stand) + pushLetter;
        if (solved(next)) {
          const parts: string[] = [segment];
          let cur = node;
          while (cur.parent !== -1) {
            parts.push(cur.segment);
            cur = nodes[cur.parent];
          }
          const moves = parts.reverse().join('');
          let pushes = 0;
          for (const ch of moves) if (ch >= 'A' && ch <= 'Z') pushes++;
          return { moves, player: b, pushes };
        }
        const nextFlood = flood(w, wall, new Set(next), b);
        const key = keyOf(next, nextFlood.rep);
        if (seen.has(key)) continue;
        seen.add(key);
        nodes.push({ boxes: next, player: b, parent: head, segment });
      }
    }
  }
  return null;
}

/**
 * The level's rooms: wall off the dead squares of the player's row
 * (the hallway — a box there reaches no goal) and take the connected
 * parts of what is left. Null when the level is no set of rooms:
 * a goal outside every part, a part whose boxes and goals differ
 * in number, or a box starting in the hallway.
 */
function roomsOf(level: Level): { squares: number[]; boxes: number[]; goals: number[] }[] | null {
  const { w, wall, goals, boxes, player } = level;
  const live = liveSquares(w, wall, goals);
  const cut = wall.slice();
  const rowStart = Math.floor(player / w) * w;
  for (let x = 0; x < w; x++) {
    const i = rowStart + x;
    if (!live[i]) cut[i] = 1;
  }
  const part = new Int32Array(wall.length).fill(-1);
  const rooms: { squares: number[]; boxes: number[]; goals: number[] }[] = [];
  for (let s = 0; s < wall.length; s++) {
    if (cut[s] || part[s] !== -1) continue;
    const squares: number[] = [];
    const queue: number[] = [s];
    part[s] = rooms.length;
    for (let head = 0; head < queue.length; head++) {
      const c = queue[head];
      squares.push(c);
      for (const [dx, dy] of DIRS) {
        const n = c + dy * w + dx;
        if (n < 0 || n >= wall.length || cut[n] || part[n] !== -1) continue;
        part[n] = rooms.length;
        queue.push(n);
      }
    }
    rooms.push({ squares, boxes: [], goals: [] });
  }
  for (const b of boxes) {
    if (part[b] < 0) return null;
    rooms[part[b]].boxes.push(b);
  }
  for (const g of goals) {
    if (part[g] < 0) return null;
    rooms[part[g]].goals.push(g);
  }
  if (rooms.some((r) => r.boxes.length !== r.goals.length)) return null;
  return rooms.filter((r) => r.boxes.length > 0);
}

/** Solve one level: room by room when it is a set of rooms, else whole. */
function solve(text: string): string {
  const level = parseLevel(text);
  const rooms = roomsOf(level);
  if (rooms === null) {
    const whole = searchPushes(level.w, level.wall, level.goals, level.boxes, level.player, LEVEL_STATES);
    return whole === null ? '' : whole.moves;
  }
  let player = level.player;
  let moves = '';
  const done: boolean[] = rooms.map(() => false);
  for (let r = 0; r < rooms.length; r++) {
    const wall = level.wall.slice();
    for (let q = 0; q < rooms.length; q++) {
      if (q === r) continue;
      const cells = done[q] ? rooms[q].goals : rooms[q].boxes;
      for (const c of cells) wall[c] = 1;
    }
    const solvedRoom = searchPushes(level.w, wall, rooms[r].goals, rooms[r].boxes, player, ROOM_STATES);
    if (solvedRoom === null) {
      const whole = searchPushes(level.w, level.wall, level.goals, level.boxes, level.player, LEVEL_STATES);
      return whole === null ? '' : whole.moves;
    }
    moves += solvedRoom.moves;
    player = solvedRoom.player;
    done[r] = true;
  }
  return moves;
}

for (const id of readdirSync(I).sort()) {
  const moves = solve(readFileSync(join(I, id, 'level.txt'), 'utf8'));
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'solution.txt'), `${moves}\n`);
}
