// ==== GLOBAL CONFIG ====
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

const TILE_SIZE = 20;

function lerp(t, a, b) {
  return a + t * (b - a);
}

function getLerpFactor(deltaTime, speed = 0.01) {
  return 1 - Math.exp(-speed * deltaTime);
}

// ==== PERLIN NOISE CLASS ====
class ImprovedNoise {
  #p;

  constructor() {
    this.#p = Array.from({ length: 256 }, () =>
      Math.floor(Math.random() * 256)
    );
    this.#p = [...this.#p, ...this.#p];
  }

  fade(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  grad(hash, x, y) {
    const h = hash & 3;
    const u = h < 2 ? x : y;
    const v = h < 2 ? y : x;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  }

  noise(x, y) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    x -= Math.floor(x);
    y -= Math.floor(y);
    const u = this.fade(x);
    const v = this.fade(y);

    const A = this.#p[X] + Y;
    const B = this.#p[X + 1] + Y;

    return lerp(
      v,
      lerp(u, this.grad(this.#p[A], x, y), this.grad(this.#p[B], x - 1, y)),
      lerp(
        u,
        this.grad(this.#p[A + 1], x, y - 1),
        this.grad(this.#p[B + 1], x - 1, y - 1)
      )
    );
  }
}

// ==== FBM FUNCTION ====
function fbm(x, y, noise, octaves = 8, lacunarity = 2.1, gain = 0.45) {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxValue = 0;

  for (let i = 0; i < octaves; i++) {
    value += noise.noise(x * frequency, y * frequency) * amplitude;
    maxValue += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }

  return value / maxValue;
}

// ==== CHUNK CLASS ====
class Chunk {
  #chunkX;
  #chunkY;
  tileSize;
  size;
  tiles;

  constructor(chunkX, chunkY, tileSize, size, noise) {
    this.#chunkX = chunkX;
    this.#chunkY = chunkY;
    this.tileSize = tileSize;
    this.size = size;
    this.tiles = this.generateTiles(noise);
  }

  generateTiles(noise) {
    const tiles = [];
    for (let y = 0; y < this.size; y++) {
      tiles[y] = [];
      for (let x = 0; x < this.size; x++) {
        const worldX = this.#chunkX * this.size + x;
        const worldY = this.#chunkY * this.size + y;
        const value = fbm(worldX * 0.03, worldY * 0.03, noise, 8, 2.1, 0.45);
        tiles[y][x] = value;
      }
    }
    return tiles;
  }

  draw(ctx, camera, getColor) {
    const worldX = this.#chunkX * this.size;
    const worldY = this.#chunkY * this.size;

    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const screenX =
          (worldX + x - camera.x) * this.tileSize + canvas.width / 2;
        const screenY =
          (worldY + y - camera.y) * this.tileSize + canvas.height / 2;

        ctx.fillStyle = getColor(this.tiles[y][x]);
        ctx.fillRect(screenX, screenY, this.tileSize, this.tileSize);
      }
    }
  }
}

// ==== TERRAIN CLASS ====
class Terrain {
  #tileSize;
  #chunkSize;
  #noise;
  #chunks;

  constructor(tileSize, chunkSize, noise) {
    this.#tileSize = tileSize;
    this.#chunkSize = chunkSize;
    this.#noise = noise;
    this.#chunks = new Map(); // Key: `${chunkX},${chunkY}`
  }

  getChunk(chunkX, chunkY) {
    const key = `${chunkX},${chunkY}`;
    if (!this.#chunks.has(key)) {
      const chunk = new Chunk(chunkX, chunkY, this.#tileSize, 16, this.#noise);
      this.#chunks.set(key, chunk);
    }
    return this.#chunks.get(key);
  }

  getColor(value) {
    const norm = (value + 1) / 2;
    if (norm < 0.43) return "#3366cc"; // Water
    else if (norm < 0.45) return "#e2ca76"; // Sand
    else if (norm < 0.48) return "#996633"; // Grass
    else if (norm < 0.65) return "#669933"; // Dirt
    else if (norm < 0.75) return "#cccccc"; // Rock
    else return "#ffffff"; // Snow
  }

  getValue(x, y) {
    const chunkX = Math.floor(x / this.#chunkSize);
    const chunkY = Math.floor(y / this.#chunkSize);
    const localX =
      ((Math.floor(x) % this.#chunkSize) + this.#chunkSize) % this.#chunkSize;
    const localY =
      ((Math.floor(y) % this.#chunkSize) + this.#chunkSize) % this.#chunkSize;
    const chunk = this.getChunk(chunkX, chunkY);
    return chunk.tiles[localY][localX] ?? -1;
  }

  isPositionWalkable(x, y) {
    const value = this.getValue(x, y);
    const norm = (value + 1) / 2;
    return norm >= 0.43; // Only walk on sand or higher
  }

  draw(ctx, camera) {
    const viewRadius = 3;
    const camChunkX = Math.floor(camera.x / this.#chunkSize);
    const camChunkY = Math.floor(camera.y / this.#chunkSize);

    for (let dy = -viewRadius; dy <= viewRadius; dy++) {
      for (let dx = -viewRadius; dx <= viewRadius; dx++) {
        const chunkX = camChunkX + dx;
        const chunkY = camChunkY + dy;
        const chunk = this.getChunk(chunkX, chunkY);
        chunk.draw(ctx, camera, this.getColor.bind(this));
      }
    }
  }
}

// ==== ENTITY ABSTRACT BASE CLASS ====
class Entity {
  constructor() {
    if (new.target === Entity) {
      throw new TypeError("Cannot instantiate abstract class 'Entity'");
    }

    this._tileSize = TILE_SIZE;
    this.moveDir = { x: 0, y: 0 };
    this.speed = 50;
  }

  update(deltaTime) {
    throw new TypeError("update() must be implemented by subclasses");
  }

  draw(ctx, cameraX, cameraY) {
    throw new TypeError("draw() must be implemented by subclasses");
  }
}

// ==== PLAYER CLASS ====
class Player extends Entity {
  #x;
  #y;
  #atk;

  constructor(x, y) {
    super();
    this.#x = x;
    this.#y = y;
    this.speed = 50;
    this.#atk = 20;
  }

  get x() {
    return this.#x;
  }
  get y() {
    return this.#y;
  }

  update(deltaTime, terrain) {
    const moveStep = (this.speed * deltaTime) / 1000;
    const newX = this.#x + (this.moveDir.x * moveStep) / TILE_SIZE;
    const newY = this.#y + (this.moveDir.y * moveStep) / TILE_SIZE;

    if (terrain.isPositionWalkable(newX, newY)) {
      this.#x = newX;
      this.#y = newY;
    }
  }

  draw(ctx, cameraX, cameraY) {
    const screenX = (this.#x - cameraX) * TILE_SIZE + canvas.width / 2;
    const screenY = (this.#y - cameraY) * TILE_SIZE + canvas.height / 2;

    ctx.fillStyle = "red";
    ctx.fillRect(
      screenX - TILE_SIZE / 2,
      screenY - TILE_SIZE / 2,
      TILE_SIZE,
      TILE_SIZE
    );
  }
}

class Bullet extends Entity {}

// ==== MONSTER CLASS ====
class Monster extends Entity {
  #x;
  #y;

  constructor(x, y) {
    super();
    this.#x = x;
    this.#y = y;
    this.speed = 20;
  }

  get x() {
    return this.#x;
  }
  get y() {
    return this.#y;
  }

  update(deltaTime, terrain) {
    const moveStep = (this.speed * deltaTime) / 1000;
    const newX = this.#x + (this.moveDir.x * moveStep) / TILE_SIZE;
    const newY = this.#y + (this.moveDir.y * moveStep) / TILE_SIZE;
    const dx = this.targetX - this.#x;
    const dy = this.targetY - this.#y;
    const length = Math.hypot(dx, dy);
    if (length > 0.1) {
      this.moveDir.x = dx / length;
      this.moveDir.y = dy / length;
    }

    if (terrain.isPositionWalkable(newX, newY)) {
      this.#x = newX;
      this.#y = newY;
    }
  }
  draw(ctx, cameraX, cameraY) {
    const screenX = (this.#x - cameraX) * TILE_SIZE + canvas.width / 2;
    const screenY = (this.#y - cameraY) * TILE_SIZE + canvas.height / 2;

    ctx.fillStyle = "green";
    ctx.fillRect(
      screenX - TILE_SIZE / 2,
      screenY - TILE_SIZE / 2,
      TILE_SIZE,
      TILE_SIZE
    );
  }
}

// ==== CAMERA CLASS ====
class Camera {
  #x;
  #y;
  smoothSpeed;

  constructor() {
    this.#x = 0;
    this.#y = 0;
    this.smoothSpeed = 0.01;
  }

  get x() {
    return this.#x;
  }
  get y() {
    return this.#y;
  }

  follow(targetX, targetY, deltaTime) {
    const t = getLerpFactor(deltaTime, this.smoothSpeed);
    this.#x = lerp(t, this.#x, targetX);
    this.#y = lerp(t, this.#y, targetY);
  }
}

// ==== GAME CLASS ====
class Game {
  constructor() {
    this.noise = new ImprovedNoise();
    this.terrain = new Terrain(TILE_SIZE, 16, this.noise);
    this.player = new Player(0, 0);
    this.monster = new Monster(10, 10);
    this.camera = new Camera();
    this.bindKeys();
    this.lastTime = performance.now();
    requestAnimationFrame(this.loop.bind(this));
  }

  bindKeys() {
    document.addEventListener("keydown", (e) => {
      if (e.key === "w") this.player.moveDir.y = -1;
      if (e.key === "s") this.player.moveDir.y = 1;
      if (e.key === "a") this.player.moveDir.x = -1;
      if (e.key === "d") this.player.moveDir.x = 1;
    });

    document.addEventListener("keyup", (e) => {
      if (e.key === "w" && this.player.moveDir.y === -1)
        this.player.moveDir.y = 0;
      if (e.key === "s" && this.player.moveDir.y === 1)
        this.player.moveDir.y = 0;
      if (e.key === "a" && this.player.moveDir.x === -1)
        this.player.moveDir.x = 0;
      if (e.key === "d" && this.player.moveDir.x === 1)
        this.player.moveDir.x = 0;
    });
  }

  loop(now) {
    const deltaTime = now - this.lastTime;
    this.lastTime = now;
    this.player.update(deltaTime, this.terrain);
    this.monster.targetX = this.player.x;
    this.monster.targetY = this.player.y;
    this.monster.update(deltaTime, this.terrain);
    this.camera.follow(this.player.x, this.player.y, deltaTime);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    this.terrain.draw(ctx, this.camera);
    this.player.draw(ctx, this.camera.x, this.camera.y);
    this.monster.draw(ctx, this.camera.x, this.camera.y);

    requestAnimationFrame(this.loop.bind(this));
  }
}

new Game();
