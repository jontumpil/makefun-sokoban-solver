// Push-optimal Sokoban solver (make.fun sokoban-solver-01): a level is a hallway plus up to four rooms; a box never
// travels between rooms, so each room is solved on its own by breadth-first search over pushes and the optima add up.
// Dead squares and frozen 2x2 blocks prune. Fixed orders, state budgets, no clock: the run is deterministic.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const D = [[0, -1, 'u', 'U'], [0, 1, 'd', 'D'], [-1, 0, 'l', 'L'], [1, 0, 'r', 'R']];
function parse(text) {
  const rows = text.split('\n').filter((r) => r.length > 0);
  const h = rows.length, w = Math.max(...rows.map((r) => r.length));
  const wall = new Uint8Array(w * h).fill(1), goals = [], boxes = [];
  let player = -1;
  rows.forEach((row, y) => { for (let x = 0; x < row.length; x++) {
    const ch = row[x], i = y * w + x;
    if (ch === '#') continue;
    wall[i] = 0;
    if (ch === '.' || ch === '*' || ch === '+') goals.push(i);
    if (ch === '$' || ch === '*') boxes.push(i);
    if (ch === '@' || ch === '+') player = i;
  } });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x === 0 || y === 0 || x === w - 1 || y === h - 1) wall[y * w + x] = 1;
  boxes.sort((a, b) => a - b); goals.sort((a, b) => a - b);
  return { w, wall, goals, boxes, player };
}
// Squares a lone box can reach a goal from, pulled back from the goals over open floor.
function liveSq(w, wall, goals) {
  const live = new Uint8Array(wall.length), q = [];
  for (const g of goals) { live[g] = 1; q.push(g); }
  for (let hd = 0; hd < q.length; hd++) { const c = q[hd];
    for (const [dx, dy] of D) { const d = dy * w + dx, from = c - d, stand = c - 2 * d;
      if (from < 0 || from >= wall.length || stand < 0 || stand >= wall.length) continue;
      if (wall[from] || wall[stand] || live[from]) continue;
      live[from] = 1; q.push(from); } }
  return live;
}
// The player's reachable region: its lowest square, plus a parent step and letter for every reached square.
function flood(w, wall, boxSet, start) {
  const step = new Int32Array(wall.length).fill(-1), letter = new Array(wall.length).fill(''), q = [start];
  step[start] = start;
  let rep = start;
  for (let hd = 0; hd < q.length; hd++) { const c = q[hd];
    if (c < rep) rep = c;
    for (let k = 0; k < 4; k++) { const [dx, dy, walk] = D[k], n = c + dy * w + dx;
      if (n < 0 || n >= wall.length || wall[n] || boxSet.has(n) || step[n] !== -1) continue;
      step[n] = c; letter[n] = walk; q.push(n); } }
  return { rep, step, letter };
}
// A 2x2 block of walls and boxes holding a box off its goal can never move again.
function frozen(w, wall, boxSet, goalSet, dest) {
  const dx = dest % w, dy = Math.floor(dest / w);
  for (const ox of [-1, 0]) for (const oy of [-1, 0]) { let solid = true, off = false, cells = 0;
    for (const cx of [0, 1]) for (const cy of [0, 1]) { const x = dx + ox + cx, y = dy + oy + cy;
      if (x < 0 || y < 0 || x >= w) { solid = false; continue; }
      const i = y * w + x;
      cells++;
      if (!wall[i] && !boxSet.has(i)) solid = false;
      if (boxSet.has(i) && !goalSet.has(i)) off = true; }
    if (solid && off && cells === 4) return true; }
  return false;
}
// Breadth-first search over pushes: states expand in push order, so the first solved state is push-optimal.
function search(w, wall, goals, startBoxes, startPlayer, budget) {
  const goalSet = new Set(goals), live = liveSq(w, wall, goals);
  const solved = (bs) => bs.every((b) => goalSet.has(b));
  if (startBoxes.some((b) => !live[b])) return null;
  if (solved(startBoxes)) return { moves: '', player: startPlayer };
  const keyOf = (bs, rep) => String.fromCharCode(rep, ...bs);
  const nodes = [{ boxes: startBoxes, player: startPlayer, parent: -1, segment: '' }];
  const seen = new Set([keyOf(startBoxes, flood(w, wall, new Set(startBoxes), startPlayer).rep)]);
  for (let hd = 0; hd < nodes.length; hd++) {
    if (nodes.length > budget) return null;
    const node = nodes[hd], boxSet = new Set(node.boxes), reach = flood(w, wall, boxSet, node.player);
    for (const b of node.boxes) for (let k = 0; k < 4; k++) {
      const [dx, dy, , pl] = D[k], d = dy * w + dx, dest = b + d, stand = b - d;
      if (dest < 0 || dest >= wall.length || stand < 0 || stand >= wall.length) continue;
      if (wall[dest] || boxSet.has(dest) || !live[dest]) continue;
      if (wall[stand] || boxSet.has(stand) || reach.step[stand] === -1) continue;
      const next = node.boxes.filter((x) => x !== b);
      next.push(dest); next.sort((a, b2) => a - b2);
      if (frozen(w, wall, new Set(next), goalSet, dest)) continue;
      const out = [];
      let c = stand;
      while (c !== node.player) { out.push(reach.letter[c]); c = reach.step[c]; }
      const seg = out.reverse().join('') + pl;
      if (solved(next)) { const parts = [seg];
        let cur = node;
        while (cur.parent !== -1) { parts.push(cur.segment); cur = nodes[cur.parent]; }
        return { moves: parts.reverse().join(''), player: b }; }
      const key = keyOf(next, flood(w, wall, new Set(next), b).rep);
      if (seen.has(key)) continue;
      seen.add(key);
      nodes.push({ boxes: next, player: b, parent: hd, segment: seg }); } }
  return null;
}
// The rooms: wall off the dead squares of the player's hallway row and take the connected parts of what is left.
function roomsOf(level) {
  const { w, wall, goals, boxes, player } = level;
  const live = liveSq(w, wall, goals), cut = wall.slice(), rs = Math.floor(player / w) * w;
  for (let x = 0; x < w; x++) if (!live[rs + x]) cut[rs + x] = 1;
  const part = new Int32Array(wall.length).fill(-1), rooms = [];
  for (let s = 0; s < wall.length; s++) { if (cut[s] || part[s] !== -1) continue;
    const q = [s];
    part[s] = rooms.length;
    for (let hd = 0; hd < q.length; hd++) { const c = q[hd];
      for (const [dx, dy] of D) { const n = c + dy * w + dx;
        if (n < 0 || n >= wall.length || cut[n] || part[n] !== -1) continue;
        part[n] = rooms.length; q.push(n); } }
    rooms.push({ boxes: [], goals: [] }); }
  for (const b of boxes) { if (part[b] < 0) return null; rooms[part[b]].boxes.push(b); }
  for (const g of goals) { if (part[g] < 0) return null; rooms[part[g]].goals.push(g); }
  if (rooms.some((r) => r.boxes.length !== r.goals.length)) return null;
  return rooms.filter((r) => r.boxes.length > 0);
}
function solve(text) {
  const level = parse(text);
  const whole = () => { const r = search(level.w, level.wall, level.goals, level.boxes, level.player, 2_500_000); return r === null ? '' : r.moves; };
  const rooms = roomsOf(level);
  if (rooms === null) return whole();
  let player = level.player, moves = '';
  const done = rooms.map(() => false);
  for (let r = 0; r < rooms.length; r++) { const wall = level.wall.slice();
    for (let q = 0; q < rooms.length; q++) { if (q === r) continue;
      for (const c of done[q] ? rooms[q].goals : rooms[q].boxes) wall[c] = 1; }
    const s = search(level.w, wall, rooms[r].goals, rooms[r].boxes, player, 1_500_000);
    if (s === null) return whole();
    moves += s.moves; player = s.player; done[r] = true; }
  return moves;
}
for (const id of readdirSync(I).sort()) {
  const moves = solve(readFileSync(join(I, id, 'level.txt'), 'utf8'));
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'solution.txt'), `${moves}\n`);
}
