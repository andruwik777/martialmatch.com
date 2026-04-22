/**
 * Regenerates 628-wss-timeline.json under data/628-x-superpuchar-polski-bjj-nogi-gi/. Run: node build-628-timeline.cjs
 */
"use strict";

var fs = require("fs");
var path = require("path");

var C1 = {
  academy: "Rio Grappling Club",
  academyId: 298,
  branch: "O\u0142awa",
  firstName: "Mateusz",
  id: 275911,
  lastName: "Paw\u0142owski",
  nationality: "PL",
  publicId: "a5fad126-f7be-49c7-8d35-c47125535cdc",
  status: { deleted: false, disqualified: false, value: 4, verified: true },
};
var C2 = {
  academy: "Animmals",
  academyId: 765,
  branch: "Zawiercie",
  firstName: "Mateusz",
  id: 283328,
  lastName: "Tyrkiel",
  nationality: "PL",
  publicId: "bde2cd9a-e299-4b11-95ae-3fe08eab1f4f",
  status: { deleted: false, disqualified: false, value: 4, verified: true },
};

function baseFrame(ch, fightId, t) {
  return {
    type: "submissionFighting2",
    channel: ch,
    fightId: fightId,
    category: t.category,
    roundName: t.roundName,
    bracketLevel: t.bracketLevel,
    switchedCompetitors: false,
    timerMode: "regularTime",
    competitor1: t.c1,
    competitor2: t.c2,
  };
}

// Mat 2529, fight 698056 — mid ongoing, tick, pause, resume
var a2529 = [];
var t = {
  category: "Gi; senior; niebieski; -73,50 kg",
  roundName: "final",
  bracketLevel: 3,
  c1: C1,
  c2: C2,
};
var ch2529 = "scoreboard:mat:2529";
var segs = [
  { internalTime: 118, b: 2, r: 0, bP: 0, rP: 0, st: "ongoing", tc: "timer-started" },
  { internalTime: 112, b: 2, r: 0, bP: 0, rP: 0, st: "ongoing", tc: "timer-started" },
  { internalTime: 105, b: 2, r: 1, bP: 0, rP: 0, st: "ongoing", tc: "timer-started" },
  { internalTime: 100, b: 3, r: 1, bP: 0, rP: 0, st: "ongoing", tc: "timer-started" },
  { internalTime: 95, b: 3, r: 1, bP: 0, rP: 1, st: "ongoing", tc: "timer-started" },
  { internalTime: 90, b: 3, r: 1, bP: 0, rP: 1, st: "ongoing", tc: "timer-paused" },
  { internalTime: 90, b: 3, r: 1, bP: 0, rP: 1, st: "ongoing", tc: "timer-paused" },
  { internalTime: 90, b: 3, r: 1, bP: 0, rP: 1, st: "ongoing", tc: "timer-paused" },
  { internalTime: 85, b: 3, r: 1, bP: 0, rP: 1, st: "ongoing", tc: "timer-started" },
  { internalTime: 80, b: 4, r: 1, bP: 0, rP: 1, st: "ongoing", tc: "timer-started" },
  { internalTime: 75, b: 4, r: 1, bP: 0, rP: 1, st: "ongoing", tc: "timer-started" },
  { internalTime: 118, b: 2, r: 0, bP: 0, rP: 0, st: "ongoing", tc: "timer-started" },
];
for (var i = 0; i < segs.length; i++) {
  var s = segs[i];
  var f = baseFrame(ch2529, 698056, t);
  f.internalTime = s.internalTime;
  f.blueMajorPoints = s.b;
  f.redMajorPoints = s.r;
  f.bluePenaltyPoints = s.bP;
  f.redPenaltyPoints = s.rP;
  f.fightStatus = s.st;
  f.timerClass = s.tc;
  a2529.push(f);
}

// Mat 2530, 698077 — awaiting then ongoing, pause, resume
var t2 = {
  category: "Gi; senior; purpurowy; -85,50 kg",
  roundName: "final",
  bracketLevel: 1,
  c1: {
    academy: "Academia Gorila",
    academyId: 9,
    branch: "Bielsko-Bia\u0142a",
    firstName: "Nikodem",
    id: 273836,
    lastName: "Papla",
    nationality: "PL",
    publicId: "83d200ee-ffa6-4ce7-abec-5e6720955f7b",
    status: { deleted: false, disqualified: false, value: 4, verified: true },
  },
  c2: {
    academy: "BJJ Ikizama Club",
    academyId: 632,
    branch: "Boruszowice",
    firstName: "Mateusz",
    id: 277996,
    lastName: "Schutz",
    nationality: "PL",
    publicId: "7832d2e7-f6f3-4a21-9252-3319db643974",
    status: { deleted: false, disqualified: false, value: 4, verified: true },
  },
};
var ch2530 = "scoreboard:mat:2530";
var segs2 = [
  { internalTime: 360, b: 0, r: 0, st: "awaiting", tc: "timer-before-start" },
  { internalTime: 358, b: 0, r: 0, st: "awaiting", tc: "timer-before-start" },
  { internalTime: 355, b: 0, r: 0, st: "awaiting", tc: "timer-before-start" },
  { internalTime: 500, b: 0, r: 0, st: "ongoing", tc: "timer-started" },
  { internalTime: 495, b: 0, r: 0, st: "ongoing", tc: "timer-started" },
  { internalTime: 490, b: 1, r: 0, st: "ongoing", tc: "timer-paused" },
  { internalTime: 490, b: 1, r: 0, st: "ongoing", tc: "timer-paused" },
  { internalTime: 485, b: 1, r: 0, st: "ongoing", tc: "timer-started" },
  { internalTime: 360, b: 0, r: 0, st: "awaiting", tc: "timer-before-start" },
];
var a2530 = [];
for (i = 0; i < segs2.length; i++) {
  s = segs2[i];
  f = baseFrame(ch2530, 698077, t2);
  f.internalTime = s.internalTime;
  f.blueMajorPoints = s.b;
  f.redMajorPoints = s.r;
  f.bluePenaltyPoints = 0;
  f.redPenaltyPoints = 0;
  f.fightStatus = s.st;
  f.timerClass = s.tc;
  a2530.push(f);
}

// Mat 2531, 698070 — "scheduled-like" then awaiting then ongoing
var t3 = {
  category: "Nogi; open; srebrny; 120,30 kg - unlimited",
  roundName: "final",
  bracketLevel: 1,
  c1: t2.c1,
  c2: t2.c2,
};
var ch2531 = "scoreboard:mat:2531";
var segs3 = [
  { internalTime: 480, b: 0, r: 0, st: "awaiting", tc: "timer-before-start" },
  { internalTime: 475, b: 0, r: 0, st: "awaiting", tc: "timer-before-start" },
  { internalTime: 420, b: 0, r: 0, st: "awaiting", tc: "timer-before-start" },
  { internalTime: 300, b: 0, r: 0, st: "ongoing", tc: "timer-started" },
  { internalTime: 295, b: 0, r: 0, st: "ongoing", tc: "timer-started" },
  { internalTime: 480, b: 0, r: 0, st: "awaiting", tc: "timer-before-start" },
];
var a2531 = [];
for (i = 0; i < segs3.length; i++) {
  s = segs3[i];
  f = baseFrame(ch2531, 698070, t3);
  f.internalTime = s.internalTime;
  f.blueMajorPoints = s.b;
  f.redMajorPoints = s.r;
  f.bluePenaltyPoints = 0;
  f.redPenaltyPoints = 0;
  f.fightStatus = s.st;
  f.timerClass = s.tc;
  a2531.push(f);
}

var out = {
  "scoreboard:mat:2529": a2529,
  "scoreboard:mat:2530": a2530,
  "scoreboard:mat:2531": a2531,
};

var outPath = path.join(
  __dirname,
  "..",
  "628-x-superpuchar-polski-bjj-nogi-gi",
  "628-wss-timeline.json"
);
fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");
console.log("Wrote " + outPath);
