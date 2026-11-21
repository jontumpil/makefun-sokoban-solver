# Push-optimal Sokoban solver

[![Competition](https://make.fun/badge/sokoban-solver-01-run-20261121.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![Rank](https://make.fun/badge/sokoban-solver-01-run-20261121/jontumpil/makefun-sokoban-solver/rank.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121/leaderboard)
[![Reward](https://make.fun/badge/sokoban-solver-01-run-20261121/jontumpil/makefun-sokoban-solver/reward.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)

An entry for the make.fun competition **sokoban-solver-01**: one
program (`main.ts`, Node, standard library only) that answers every
instance of a drawn set with the player's moves, in as few pushes
as possible.

## How it works

The drawn levels are built as one hallway with up to four
independent rooms off it, and a box can never travel between rooms,
so a level's push optimum is the sum of its rooms' optima. The
solver cuts the level into its rooms — walling off the dead squares
of the player's hallway row and taking the connected parts of what
is left — and solves each room in turn with a breadth-first search
over pushes, the other rooms' boxes standing as walls.

A search state is the room's box squares plus the player's
reachable region, named by its lowest square. States expand in
order of pushes spent, so the first complete state found is
push-optimal for the room, and the rooms add up to the level's
optimum. Two deadlocks are pruned, neither of which can remove a
solvable state: a box on a dead square (one from which no push
brings a box to any goal, computed by pulling back from the goals)
and a frozen 2 x 2 block of walls and boxes with a box off its
goal. Budgets are counted in states, never in seconds, and every
iteration order is fixed, so two runs write the same bytes.

## Measured results

On the kit's practice set the solver scores **1,000,000 of
1,000,000**: all five levels solved in exactly the optimal push
counts (13, 16, 29, 47 and 60 pushes) in about 3 seconds of the
60-second wall. On three further sets drawn locally with the kit's
own generator from fresh seeds it also scores 1,000,000, every
level at its optimum, in 1.3 to 1.7 seconds a set. The house
baseline (plain-astar 1.0.0) scores 200,000 on the practice set: it
solves the first level and gives up on the other four.

## License

MIT
