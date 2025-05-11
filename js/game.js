// ==== GLOBAL CONFIG ====
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

const TILE_SIZE = 20;
const MAP_SIZE = 50;

function lerp(t, a, b) {
  return a + t * (b - a);
}

function getLerpFactor(deltaTime, speed = 0.01) {
  return 1 - Math.exp(-speed * deltaTime);
}

// ==== PERLIN NOISE CLASS ====
class ImprovedNoise {
  constructor() {
    this.p = Array.from({ length: 256 }, () => Math.floor(Math.random() * 256));
    this.p = [...this.p, ...this.p];
  }

  fade(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  lerp(t, a, b) {
    return a + t * (b - a);
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

    const A = this.p[X] + Y;
    const B = this.p[X + 1] + Y;

    return this.lerp(
      v,
      this.lerp(u, this.grad(this.p[A], x, y), this.grad(this.p[B], x - 1, y)),
      this.lerp(
        u,
        this.grad(this.p[A + 1], x, y - 1),
        this.grad(this.p[B + 1], x - 1, y - 1)
      )
    );
  }
}
function fbm(x, y, noise, octaves = 10, lacunarity = 2, gain = 0.5) {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxValue = 0; // Used to normalize result

  for (let i = 0; i < octaves; i++) {
    value += noise.noise(x * frequency, y * frequency) * amplitude;
    maxValue += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }

  return value / maxValue; // Normalize to [-1, 1]
}

class Chunk {
  constructor(chunkX, chunkY, tileSize, size, noise) {
    this.chunkX = chunkX;
    this.chunkY = chunkY;
    this.tileSize = tileSize;
    this.size = size;
    this.tiles = this.generateTiles(noise);
  }

  generateTiles(noise) {
    const tiles = [];
    for (let y = 0; y < this.size; y++) {
      tiles[y] = [];
      for (let x = 0; x < this.size; x++) {
        const worldX = this.chunkX * this.size + x;
        const worldY = this.chunkY * this.size + y;

        const value = fbm(worldX * 0.03, worldY * 0.03, noise, 8, 2.1, 0.45); // ← FBM here
        tiles[y][x] = value;
      }
    }
    return tiles;
  }

  draw(ctx, camera, getColor) {
    const worldX = this.chunkX * this.size;
    const worldY = this.chunkY * this.size;

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

class Terrain {
  constructor(tileSize, chunkSize, noise) {
    this.tileSize = tileSize;
    this.chunkSize = chunkSize;
    this.noise = noise;
    this.chunks = new Map(); // Key: `${chunkX},${chunkY}`
  }

  getChunk(chunkX, chunkY) {
    const key = `${chunkX},${chunkY}`;
    if (!this.chunks.has(key)) {
      const chunk = new Chunk(
        chunkX,
        chunkY,
        this.tileSize,
        this.chunkSize,
        this.noise
      );
      this.chunks.set(key, chunk);
    }
    return this.chunks.get(key);
  }

  getColor(value) {
    const norm = (value + 1) / 2;

    if (norm < 0.43) return "#3366cc"; // Water
    else if (norm < 0.45) return "#e2ca76"; // Sand
    else if (norm < 0.48) return "#996633"; // Grass
    else if (norm < 0.65) return "#669933"; // Dirt
    else if (norm < 0.95) return "#cccccc"; // Rock
    else return "#ffffff"; // Snow
  }

  draw(ctx, camera) {
    const viewRadius = 3; // How many chunks around the camera to draw
    const camChunkX = Math.floor(camera.x / this.chunkSize);
    const camChunkY = Math.floor(camera.y / this.chunkSize);

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

// ==== PLAYER CLASS ====
class Player {
  constructor(x, y, tileSize) {
    this.x = x;
    this.y = y;
    this.tileSize = tileSize;
    this.speed = 50; // pixels per second
    this.moveDir = { x: 0, y: 0 };
  }

  update(deltaTime) {
    const moveStep = (this.speed * deltaTime) / 1000;
    this.x += (this.moveDir.x * moveStep) / this.tileSize;
    this.y += (this.moveDir.y * moveStep) / this.tileSize;
  }

  draw(ctx, cameraX, cameraY) {
    const screenX = (this.x - cameraX) * TILE_SIZE + canvas.width / 2;
    const screenY = (this.y - cameraY) * TILE_SIZE + canvas.height / 2;

    ctx.fillStyle = "red";
    ctx.fillRect(
      screenX - TILE_SIZE / 2,
      screenY - TILE_SIZE / 2,
      TILE_SIZE,
      TILE_SIZE
    );
  }
}
class Camera {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.smoothSpeed = 0.01; // Smaller = slower, smoother
  }

  follow(targetX, targetY, deltaTime) {
    const t = getLerpFactor(deltaTime, this.smoothSpeed);

    this.x = lerp(t, this.x, targetX);
    this.y = lerp(t, this.y, targetY);
  }
}
// ==== GAME CLASS ====
class Game {
  constructor() {
    this.noise = new ImprovedNoise();
    this.terrain = new Terrain(TILE_SIZE, 16, this.noise);
    this.player = new Player(0, 0, TILE_SIZE, Infinity);
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
      if (["w", "s"].includes(e.key)) this.player.moveDir.y = 0;
      if (["a", "d"].includes(e.key)) this.player.moveDir.x = 0;
    });
  }

  loop(now) {
    const deltaTime = now - this.lastTime;
    this.lastTime = now;

    this.player.update(deltaTime);
    this.camera.follow(this.player.x, this.player.y, deltaTime); // ← updated line

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    this.terrain.draw(ctx, this.camera);
    this.player.draw(ctx, this.camera.x, this.camera.y);

    requestAnimationFrame(this.loop.bind(this));
  }
}

// ==== START GAME ====
new Game();
