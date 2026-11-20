const rooms = require('./rooms.json');

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

const RANDOM_EVENTS = [
  { id: 'torch', label: '🔥 Torchlight Flickers', hpMod: 0, goldMod: 0, note: 'Shadows dance on the stone walls.' },
  { id: 'bats', label: '🦇 Bats Scatter!', hpMod: -2, goldMod: 0, note: 'A flurry of bats nips at the party (-2 HP).' },
  { id: 'rune', label: '✨ Ancient Rune Glows', hpMod: 5, goldMod: 0, note: 'Warm magic mends minor scrapes (+5 HP).' },
  { id: 'coin', label: '🪙 Stray Coin Glints', hpMod: 0, goldMod: 5, note: 'Someone dropped 5 gold near the door (+5g).' },
  { id: 'draft', label: '💨 Chill Draft', hpMod: 0, goldMod: 0, note: 'A cold breeze carries distant echoes.' },
  { id: 'slime', label: '🟢 Sticky Floor', hpMod: -1, goldMod: 2, note: 'Acidic goo singes boots (-1 HP, +2g).' }
];

class GameEngine {
  constructor(redis) {
    this.redis = redis;
    this.schedulerTimer = null;
  }

  async init() {
    const existing = await this.redis.get('party:state');
    if (!existing) {
      await this.startNewSeason(1);
    }
    this.startScheduler();
  }

  startScheduler() {
    if (this.schedulerTimer) clearInterval(this.schedulerTimer);
    // Check every 15 seconds if the 6-hour voting window has elapsed
    this.schedulerTimer = setInterval(async () => {
      try {
        const room = await this.getCurrentRoom();
        const party = await this.getPartyState();
        if (party.status === 'active' && room && Date.now() >= room.votingEndsAt) {
          console.log(`[Scheduler] 6-hour window closed for Season ${party.season} Room ${party.roomNumber}. Resolving...`);
          await this.resolveCurrentRoom();
        }
      } catch (err) {
        console.error('[Scheduler] Error:', err);
      }
    }, 15000);
  }

  async getPartyState() {
    const raw = await this.redis.get('party:state');
    return raw ? JSON.parse(raw) : null;
  }

  async savePartyState(state) {
    await this.redis.set('party:state', JSON.stringify(state));
  }

  async getCurrentRoom() {
    const raw = await this.redis.get('room:current');
    return raw ? JSON.parse(raw) : null;
  }

  async saveCurrentRoom(room) {
    await this.redis.set('room:current', JSON.stringify(room));
  }

  pickRandomRoom(excludeId = null) {
    const pool = rooms.filter((r) => r.id !== excludeId);
    return pool[Math.floor(Math.random() * pool.length)];
  }

  pickRandomEvent() {
    return RANDOM_EVENTS[Math.floor(Math.random() * RANDOM_EVENTS.length)];
  }

  async createNextRoom(season, roomNumber, prevRoomId = null) {
    const template = this.pickRandomRoom(prevRoomId);
    const event = this.pickRandomEvent();
    const isBoss = roomNumber % 5 === 0;
    const now = Date.now();
    const room = {
      season,
      roomNumber,
      roomId: template.id,
      title: isBoss ? `💀 BOSS: ${template.title}` : template.title,
      isBoss,
      emojiScene: template.emojiScene,
      description: isBoss
        ? `[BOSS ENCOUNTER] ${template.description} Stakes are doubled!`
        : template.description,
      randomEvent: event,
      choices: template.choices,
      createdAt: now,
      votingEndsAt: now + SIX_HOURS_MS
    };
    await this.saveCurrentRoom(room);
    return room;
  }

  async startNewSeason(seasonNumber) {
    const party = {
      season: seasonNumber,
      roomNumber: 1,
      hp: 100,
      maxHp: 100,
      gold: 10,
      items: ['🗡️ Rusty Dagger'],
      status: 'active',
      history: []
    };
    await this.savePartyState(party);
    await this.createNextRoom(seasonNumber, 1, null);
    return party;
  }

  async restartSeason() {
    const party = await this.getPartyState();
    const nextSeason = party ? party.season + 1 : 1;
    return this.startNewSeason(nextSeason);
  }

  getVoteKey(season, roomNumber) {
    return `votes:s${season}:r${roomNumber}`;
  }

  async getVotes(season, roomNumber) {
    const key = this.getVoteKey(season, roomNumber);
    const all = await this.redis.hgetall(key);
    const counts = { fight: 0, sneak: 0, bargain: 0 };
    const voters = [];

    for (const [userId, rawVal] of Object.entries(all)) {
      try {
        const parsed = JSON.parse(rawVal);
        if (counts[parsed.choice] !== undefined) {
          counts[parsed.choice]++;
        }
        voters.push({ userId, username: parsed.username, choice: parsed.choice });
      } catch {
        // ignore malformed
      }
    }

    const total = counts.fight + counts.sneak + counts.bargain;
    return { counts, total, voters };
  }

  async castVote(userId, username, choice) {
    if (!['fight', 'sneak', 'bargain'].includes(choice)) {
      throw new Error('Invalid choice. Must be fight, sneak, or bargain.');
    }
    const party = await this.getPartyState();
    if (!party || party.status !== 'active') {
      throw new Error('Party is currently dead. Start a new season to continue!');
    }

    const key = this.getVoteKey(party.season, party.roomNumber);
    const existing = await this.redis.hget(key, userId);
    if (existing) {
      const parsed = JSON.parse(existing);
      return { alreadyVoted: true, choice: parsed.choice };
    }

    await this.redis.hset(
      key,
      userId,
      JSON.stringify({ username: username || userId, choice, votedAt: Date.now() })
    );

    return { alreadyVoted: false, choice };
  }

  async resolveCurrentRoom() {
    const party = await this.getPartyState();
    const room = await this.getCurrentRoom();
    if (!party || !room || party.status !== 'active') {
      return { resolved: false, reason: 'No active room' };
    }

    const { counts, total, voters } = await this.getVotes(party.season, party.roomNumber);

    // Determine majority choice (tie-breaker: fight > sneak > bargain or random among tied)
    let winningChoice = 'fight';
    let maxVotes = -1;
    const order = ['fight', 'sneak', 'bargain'];
    for (const c of order) {
      if (counts[c] > maxVotes) {
        maxVotes = counts[c];
        winningChoice = c;
      }
    }

    // Update "Most Decisive Voters" leaderboard in Redis
    for (const v of voters) {
      await this.redis.zincrby('leaderboard:total', 1, v.username);
      if (v.choice === winningChoice) {
        await this.redis.zincrby('leaderboard:decisive', 1, v.username);
      }
    }

    const chosenOutcome = room.choices[winningChoice];
    const mult = room.isBoss ? 2 : 1;
    const hpDelta = chosenOutcome.hpDelta * mult + (room.randomEvent ? room.randomEvent.hpMod : 0);
    const goldDelta = chosenOutcome.goldDelta * mult + (room.randomEvent ? room.randomEvent.goldMod : 0);

    party.hp = Math.max(0, Math.min(party.maxHp, party.hp + hpDelta));
    party.gold = Math.max(0, party.gold + goldDelta);
    if (chosenOutcome.itemGain && !party.items.includes(chosenOutcome.itemGain)) {
      party.items.push(chosenOutcome.itemGain);
    }

    const logEntry = {
      roomNumber: party.roomNumber,
      title: room.title,
      winningChoice,
      totalVotes: total,
      counts,
      outcomeText: chosenOutcome.outcomeText,
      hpDelta,
      goldDelta,
      itemGain: chosenOutcome.itemGain || null,
      resolvedAt: Date.now()
    };

    party.history.unshift(logEntry);
    if (party.history.length > 20) party.history = party.history.slice(0, 20);

    if (party.hp <= 0) {
      party.status = 'dead';
      await this.savePartyState(party);
      await this.archiveSeason(party);
      return { resolved: true, party, logEntry, died: true };
    }

    party.roomNumber += 1;
    await this.savePartyState(party);
    const nextRoom = await this.createNextRoom(party.season, party.roomNumber, room.roomId);

    return { resolved: true, party, logEntry, nextRoom, died: false };
  }

  async archiveSeason(party) {
    const raw = await this.redis.get('seasons:archive');
    const archive = raw ? JSON.parse(raw) : [];
    archive.unshift({
      season: party.season,
      roomsCleared: party.roomNumber,
      gold: party.gold,
      itemsCount: party.items.length,
      endedAt: Date.now()
    });
    await this.redis.set('seasons:archive', JSON.stringify(archive.slice(0, 10)));
  }

  async getSeasonArchive() {
    const raw = await this.redis.get('seasons:archive');
    return raw ? JSON.parse(raw) : [];
  }

  async getLeaderboard(limit = 10) {
    const raw = await this.redis.zrevrange('leaderboard:decisive', 0, limit - 1, 'WITHSCORES');
    const list = [];
    for (let i = 0; i < raw.length; i += 2) {
      const username = raw[i];
      const decisiveVotes = Number(raw[i + 1]);
      list.push({ rank: list.length + 1, username, decisiveVotes });
    }
    return list;
  }
}

module.exports = { GameEngine, SIX_HOURS_MS };
