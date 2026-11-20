const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SNAPSHOT_FILE = path.join(DATA_DIR, 'redis-snapshot.json');

class InMemoryRedis {
  constructor() {
    this.kv = {};
    this.hashes = {};
    this.zsets = {};
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(SNAPSHOT_FILE)) {
        const raw = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));
        this.kv = raw.kv || {};
        this.hashes = raw.hashes || {};
        this.zsets = raw.zsets || {};
      }
    } catch (err) {
      console.error('Failed to load Redis snapshot:', err.message);
    }
  }

  save() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(
        SNAPSHOT_FILE,
        JSON.stringify({ kv: this.kv, hashes: this.hashes, zsets: this.zsets }, null, 2)
      );
    } catch (err) {
      console.error('Failed to save Redis snapshot:', err.message);
    }
  }

  async get(key) {
    return Object.prototype.hasOwnProperty.call(this.kv, key) ? this.kv[key] : null;
  }

  async set(key, value) {
    this.kv[key] = String(value);
    this.save();
    return 'OK';
  }

  async del(key) {
    delete this.kv[key];
    delete this.hashes[key];
    delete this.zsets[key];
    this.save();
    return 1;
  }

  async hget(key, field) {
    return this.hashes[key] && Object.prototype.hasOwnProperty.call(this.hashes[key], field)
      ? this.hashes[key][field]
      : null;
  }

  async hset(key, field, value) {
    if (!this.hashes[key]) this.hashes[key] = {};
    this.hashes[key][field] = String(value);
    this.save();
    return 1;
  }

  async hgetall(key) {
    return this.hashes[key] ? { ...this.hashes[key] } : {};
  }

  async zincrby(key, increment, member) {
    if (!this.zsets[key]) this.zsets[key] = {};
    const current = Number(this.zsets[key][member] || 0);
    const next = current + Number(increment);
    this.zsets[key][member] = next;
    this.save();
    return String(next);
  }

  async zrevrange(key, start, stop, withScores) {
    const zset = this.zsets[key] || {};
    const sorted = Object.entries(zset).sort((a, b) => b[1] - a[1]);
    const end = stop === -1 ? sorted.length : stop + 1;
    const sliced = sorted.slice(start, end);
    if (withScores === 'WITHSCORES') {
      const result = [];
      for (const [member, score] of sliced) {
        result.push(member, String(score));
      }
      return result;
    }
    return sliced.map(([member]) => member);
  }
}

function createRedisClient() {
  if (process.env.REDIS_URL) {
    try {
      const Redis = require('ioredis');
      const client = new Redis(process.env.REDIS_URL);
      console.log('Connected to external Redis via REDIS_URL');
      return client;
    } catch (err) {
      console.warn('ioredis not available or failed, falling back to InMemoryRedis:', err.message);
    }
  }
  console.log('Using persistent InMemoryRedis store (data/redis-snapshot.json)');
  return new InMemoryRedis();
}

module.exports = { createRedisClient };
