// Adapted from monocode, Copyright (c) 2026 Nick, MIT. See LICENSE.monocode.
/**
 * 8×8 pixel mascots used in place of a project's color dot.
 * '#' paints the project color, '.' stays transparent so the surface shows
 * through — eyes and gaps are holes, like the arcade sprites they borrow from.
 *
 * Each mascot has two frames: `rest`, and `talk` swapped in on a loop while the
 * project has a turn in flight — mouths chew, legs shuffle, flames flicker.
 */
const GRID = 8;

type MascotRows = readonly string[];

export type ProjectMascot = {
  name: string;
  rest: MascotRows;
  talk: MascotRows;
  /** SVG path data over an 8×8 viewBox, one per frame. */
  restPath: string;
  talkPath: string;
};

const REST: Record<string, MascotRows> = {
  invader: [
    "..#..#..",
    ".######.",
    "##.##.##",
    "########",
    ".######.",
    ".#.##.#.",
    "#.#..#.#",
    "........",
  ],
  ghost: [
    "..####..",
    ".######.",
    "##.##.##",
    "########",
    "########",
    "########",
    "########",
    "#.##.##.",
  ],
  robot: [
    "...#....",
    ".######.",
    ".#.##.#.",
    ".######.",
    ".#....#.",
    ".######.",
    "..#..#..",
    "........",
  ],
  cat: [
    ".#....#.",
    ".##..##.",
    "########",
    "#.####.#",
    "########",
    "###..###",
    ".######.",
    "..#..#..",
  ],
  skull: [
    ".######.",
    "########",
    "##.##.##",
    "########",
    ".##..##.",
    ".######.",
    ".#.##.#.",
    "........",
  ],
  crab: [
    "#......#",
    ".#....#.",
    ".######.",
    "##.##.##",
    "########",
    "#.####.#",
    "#......#",
    "........",
  ],
  mushroom: [
    "..####..",
    ".######.",
    "########",
    "##.##.##",
    "########",
    "...##...",
    "...##...",
    "..####..",
  ],
  rocket: [
    "...##...",
    "..####..",
    "..#..#..",
    "..####..",
    ".######.",
    ".######.",
    "##....##",
    "..####..",
  ],
  dino: [
    "...#####",
    "...##.##",
    "...#####",
    ".#######",
    "########",
    "#####...",
    ".##.##..",
    "..#..#..",
  ],
  frog: [
    "........",
    "##....##",
    "#.####.#",
    "########",
    "########",
    ".######.",
    "##....##",
    "........",
  ],
};

const TALK: Record<string, MascotRows> = {
  invader: [
    "..#..#..",
    ".######.",
    "##.##.##",
    "########",
    ".######.",
    "#.####.#",
    ".#....#.",
    "#......#",
  ],
  ghost: [
    "..####..",
    ".######.",
    "#.##.###",
    "########",
    "########",
    "########",
    "########",
    ".##.##.#",
  ],
  robot: [
    "....#...",
    ".######.",
    ".#.##.#.",
    ".######.",
    ".##..##.",
    ".######.",
    ".#....#.",
    "........",
  ],
  cat: [
    ".#....#.",
    ".##..##.",
    "########",
    "#.####.#",
    "########",
    "########",
    ".######.",
    ".#....#.",
  ],
  skull: [
    ".######.",
    "########",
    "##.##.##",
    "########",
    ".##..##.",
    ".######.",
    ".#....#.",
    "..####..",
  ],
  crab: [
    "#......#",
    "##....##",
    ".######.",
    "##.##.##",
    "########",
    ".######.",
    "#.#..#.#",
    "........",
  ],
  mushroom: [
    "........",
    "..####..",
    ".######.",
    "########",
    "##.##.##",
    "...##...",
    "...##...",
    "..####..",
  ],
  rocket: [
    "...##...",
    "..####..",
    "..#..#..",
    "..####..",
    ".######.",
    ".######.",
    "##....##",
    "...##...",
  ],
  dino: [
    "...#####",
    "...##.##",
    "...#####",
    ".#######",
    "########",
    "#####...",
    "..##.##.",
    "..#...#.",
  ],
  frog: [
    "##....##",
    "#.####.#",
    "########",
    "########",
    ".######.",
    "##....##",
    "#......#",
    "........",
  ],
};

/** Merges each row's filled runs into one rect so the path stays short. */
export function mascotPath(rows: MascotRows): string {
  let path = "";
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (row[x] !== "#") {
        x += 1;
        continue;
      }
      let run = 1;
      while (row[x + run] === "#") run += 1;
      path += `M${x} ${y}h${run}v1h-${run}z`;
      x += run;
    }
  });
  return path;
}

export const PROJECT_MASCOTS: readonly ProjectMascot[] = Object.entries(REST).map(
  ([name, rest]) => ({
    name,
    rest,
    talk: TALK[name] ?? rest,
    restPath: mascotPath(rest),
    talkPath: mascotPath(TALK[name] ?? rest),
  }),
);

export const MASCOT_GRID = GRID;
