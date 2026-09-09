const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const script = html.match(/<script>([\s\S]*)<\/script>/)[1];

function makeCtx() {
  const noop = () => {};
  return {
    fillStyle: "",
    font: "",
    textAlign: "",
    textBaseline: "",
    fillRect: noop,
    fillText: noop,
    beginPath: noop,
    moveTo: noop,
    lineTo: noop,
    fill: noop,
    save: noop,
    restore: noop,
    translate: noop
  };
}

const canvas = {
  width: 800,
  height: 600,
  focus() {},
  getContext() {
    return makeCtx();
  }
};

const sandbox = {
  document: {
    getElementById(id) {
      assert.strictEqual(id, "game");
      return canvas;
    }
  },
  window: {
    addEventListener() {},
    AudioContext: function AudioContext() {},
    webkitAudioContext: function AudioContext() {}
  },
  localStorage: {
    getItem() { return "0"; },
    setItem() {}
  },
  requestAnimationFrame() {},
  Math,
  Number,
  String,
  console
};

sandbox.window.window = sandbox.window;
sandbox.window.document = sandbox.document;
sandbox.window.localStorage = sandbox.localStorage;
sandbox.window.requestAnimationFrame = sandbox.requestAnimationFrame;

vm.createContext(sandbox);
vm.runInContext(script.replace('      canvas.focus();',
  '      window.sim = { game, keys, update, updatePlayer, resetStage }; canvas.focus();'), sandbox);

const api = sandbox.window.__turtlePomTest;
assert(api, "test api should be exposed");

function platformForItem(item) {
  return api.basePlatforms.find(platform => Math.abs(item.y - (platform.y - 22)) < 0.1);
}

function isOnSolidPlatform(item, platform) {
  return api.solidSegments(platform).some(seg =>
    item.x - item.r >= seg.x &&
    item.x + item.r <= seg.x + seg.w
  );
}

function isOnSpike(item, platform) {
  return platform.spikes.some(spike =>
    item.x + item.r > spike.x &&
    item.x - item.r < spike.x + spike.w
  );
}

function reachablePlatforms() {
  const byY = new Map(api.basePlatforms.map((platform, index) => [platform.y, index]));
  const graph = api.basePlatforms.map(() => new Set());
  for (const ladder of api.ladders) {
    const a = byY.get(ladder.y);
    const b = byY.get(ladder.y + ladder.h);
    if (a !== undefined && b !== undefined) {
      graph[a].add(b);
      graph[b].add(a);
    }
  }
  const seen = new Set([0]);
  const queue = [0];
  while (queue.length) {
    const current = queue.shift();
    for (const next of graph[current]) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

for (let stage = 1; stage <= 5; stage++) {
  const level = api.makeLevel(stage);
  assert(level.items.length > 0, `stage ${stage} should have collectible items`);

  const reachable = reachablePlatforms();
  for (const item of level.items) {
    const platform = platformForItem(item);
    assert(platform, `stage ${stage} item must belong to a platform`);
    assert(isOnSolidPlatform(item, platform), `stage ${stage} item at ${item.x},${item.y} must sit on solid floor`);
    assert(!isOnSpike(item, platform), `stage ${stage} item at ${item.x},${item.y} must not overlap spikes`);
    assert(reachable.has(api.basePlatforms.indexOf(platform)), `stage ${stage} item platform must be reachable by ladders`);
  }

}

for (const ladder of api.ladders) {
  for (const floor of api.basePlatforms.filter(p => p.y >= ladder.y && p.y <= ladder.y + ladder.h)) {
    assert(api.solidSegments(floor).some(s => ladder.x - 12 >= s.x && ladder.x + 46 <= s.x + s.w),
      `ladder ${ladder.x} needs a solid landing on floor ${floor.y}`);
    assert(!floor.spikes.some(s => s.x < ladder.x + 54 && s.x + s.w > ladder.x - 20),
      `ladder ${ladder.x} blocked by spikes on floor ${floor.y}`);
  }
}

// Drive the unchanged game update, including enemies, collisions, timer and collection.
const { game, keys, update, resetStage } = sandbox.window.sim;
let seed = 1234;
let recording = [];
sandbox.Math = Object.create(Math);
sandbox.Math.random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
function tick(input = []) {
  keys.clear();
  input.forEach(k => keys.add(k));
  update(1 / 60);
}
function travel(x, floorY, item) {
  const itemIndex = item ? game.level.items.indexOf(item) : -1;
  const initial = JSON.stringify(game);
  let beam = [{ state: initial, cost: 0, seed, inputs: [] }];
  for (let step = 0; step < 160; step++) {
    const next = [];
    const visited = new Set();
    for (const node of beam) {
      for (const input of [['ArrowLeft'], ['ArrowRight'], ['ArrowLeft','Space'], ['ArrowRight','Space'], []]) {
        Object.assign(game, JSON.parse(node.state));
        seed = node.seed;
        const inputs = node.inputs.slice();
        for (let f = 0; f < 8; f++) {
          tick(input);
          inputs.push(input);
          if (game.lives !== 3 || game.player.y + game.player.h > floorY + 22) break;
          if (game.state === 'clear' || (itemIndex >= 0 ? game.level.items[itemIndex].got :
              Math.abs(game.player.x - x) < 4 && Math.abs(game.player.y + game.player.h - floorY) < 3 && game.player.grounded)) {
            recording.push(...inputs);
            return true;
          }
        }
        if (game.lives !== 3 || game.player.y + game.player.h > floorY + 22) continue;
        const p = game.player;
        const key = [Math.round(p.x/4),Math.round(p.y/4),Math.round(p.vy/25),Math.round(game.timer*10)].join(',');
        if (visited.has(key)) continue;
        visited.add(key);
        next.push({ state: JSON.stringify(game), seed, inputs, cost: Math.abs(p.x-x) + Math.abs(p.y+p.h-floorY)*.3 });
      }
    }
    next.sort((a,b) => a.cost-b.cost);
    beam = next.slice(0, 24);
    if (!beam.length) break;
  }
  Object.assign(game, JSON.parse(initial));
  return false;
}
function climb(x, targetY) {
  for (let frame = 0; frame < 300; frame++) {
    if (game.lives !== 3 || game.state !== 'playing') return false;
    const feet = game.player.y + game.player.h;
    const input = Math.abs(feet - targetY) < 2 ? [] : [feet > targetY ? 'ArrowUp' : 'ArrowDown'];
    recording.push(input);
    tick(input);
    if (!input.length) return true;
  }
  return false;
}
const exits = [420, 550, 190, 190, 508];
{
  const stage = 1;
  let success = false;
  for (let attempt = 0; attempt < 120 && !success; attempt++) {
    seed = 1234 + attempt;
    recording = [];
    resetStage(true);
    game.stage = stage;
    resetStage();
    game.state = 'playing';
    game.respawnTime = 0;
    let ok = true;
    for (let fi = 0; fi < 6 && ok && game.state === 'playing'; fi++) {
      const floor = api.basePlatforms[fi];
      const targets = game.level.items.filter(i => i.y === floor.y - 22).sort((a,b) => a.x - b.x);
      for (const item of targets) {
        const current = game.level.items.find(i => i.x === item.x && i.y === item.y);
        if (!current.got && !travel(item.x - 15, floor.y, current)) { ok = false; break; }
      }
      if (ok && fi < 5 && game.state === 'playing') {
        ok = travel(exits[fi] + 4, floor.y) && climb(exits[fi], api.basePlatforms[fi+1].y);
      }
    }
    success = game.state === 'clear' && game.lives === 3;
    if (success) {
      seed = 1234 + attempt;
      resetStage(true);
      game.state = 'playing';
      game.respawnTime = 0;
      for (const input of recording) tick(input);
      assert.strictEqual(game.state, 'clear', 'recorded inputs must replay to a real clear');
      assert.strictEqual(game.lives, 3);
      console.log(`stage ${stage}: replay clear, lives=${game.lives}, time=${game.timer.toFixed(1)}, seed=${1234 + attempt}, frames=${recording.length}`);
      update(1.81);
      assert.strictEqual(game.stage, 2);
      assert.strictEqual(game.state, 'playing');
      assert.strictEqual(game.level.enemies.length, 5);
      assert.strictEqual(game.lives, 3);
    }
  }
  assert(success, `stage ${stage}: actual-input simulation must collect every item without death`);
}

for (const ladder of api.ladders) {
  resetStage(true);
  game.state = 'playing';
  Object.assign(game.player, { x: ladder.x + 4, y: ladder.y + ladder.h - 34, grounded: true });
  keys.clear();
  keys.add('ArrowUp');
  for (let f = 0; f < 150; f++) sandbox.window.sim.updatePlayer(1/60);
  assert.strictEqual(game.player.y + game.player.h, ladder.y, `ladder ${ladder.x}: top exit`);
  assert.strictEqual(game.lives, 3, `ladder ${ladder.x}: climb must not hit spikes`);
  keys.clear();
  keys.add('ArrowDown');
  for (let f = 0; f < 150; f++) sandbox.window.sim.updatePlayer(1/60);
  assert.strictEqual(game.player.y + game.player.h, ladder.y + ladder.h, `ladder ${ladder.x}: bottom exit`);
  assert.strictEqual(game.lives, 3, `ladder ${ladder.x}: descent must not hit spikes`);
  assert(game.player.grounded && !game.player.onLadder);
}
console.log('all 5 ladders: up/down landing without damage');

const minFloorGap = api.basePlatforms
  .map((platform, index, platforms) => index === 0 ? Infinity : platforms[index - 1].y - platform.y)
  .reduce((min, gap) => Math.min(min, gap), Infinity);
const maxJumpHeight = Math.pow(Math.abs(api.physics.jumpVelocity), 2) / (2 * api.physics.gravity);

assert(
  maxJumpHeight < minFloorGap - 16,
  `jump height ${maxJumpHeight.toFixed(1)} should stay below floor gap ${minFloorGap}`
);

console.log("game-rules: ok");
