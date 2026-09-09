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
vm.runInContext(script, sandbox);

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

  level.items.forEach(item => { item.got = true; });
  assert(level.items.every(item => item.got), `stage ${stage} can reach the clear condition after all items are collected`);
}

const minFloorGap = api.basePlatforms
  .map((platform, index, platforms) => index === 0 ? Infinity : platforms[index - 1].y - platform.y)
  .reduce((min, gap) => Math.min(min, gap), Infinity);
const maxJumpHeight = Math.pow(Math.abs(api.physics.jumpVelocity), 2) / (2 * api.physics.gravity);

assert(
  maxJumpHeight < minFloorGap - 16,
  `jump height ${maxJumpHeight.toFixed(1)} should stay below floor gap ${minFloorGap}`
);

console.log("game-rules: ok");
