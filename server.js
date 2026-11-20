const express = require('express');
const path = require('path');
const { createRedisClient } = require('./src/redisStore');
const { GameEngine } = require('./src/gameEngine');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const redis = createRedisClient();
const engine = new GameEngine(redis);

app.get('/api/state', async (req, res) => {
  try {
    const userId = req.query.userId || 'anon';
    const party = await engine.getPartyState();
    const room = await engine.getCurrentRoom();
    const votes = party ? await engine.getVotes(party.season, party.roomNumber) : { counts: { fight: 0, sneak: 0, bargain: 0 }, total: 0, voters: [] };
    const userVote = votes.voters.find((v) => v.userId === userId)?.choice || null;
    const leaderboard = await engine.getLeaderboard(10);
    const seasonsArchive = await engine.getSeasonArchive();

    res.json({
      party,
      room,
      votes: {
        counts: votes.counts,
        total: votes.total,
        userVote,
        recentVoters: votes.voters.slice(-8).reverse()
      },
      leaderboard,
      seasonsArchive,
      serverTime: Date.now()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/vote', async (req, res) => {
  try {
    const { userId, username, choice } = req.body;
    if (!userId || !choice) {
      return res.status(400).json({ error: 'userId and choice are required' });
    }
    const result = await engine.castVote(userId, username || userId, choice);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/scheduler/resolve', async (req, res) => {
  try {
    const result = await engine.resolveCurrentRoom();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/season/restart', async (req, res) => {
  try {
    const party = await engine.restartSeason();
    res.json({ ok: true, party });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/seed-votes', async (req, res) => {
  try {
    const bots = [
      { id: 'bot_aria', name: '@aria_blade' },
      { id: 'bot_knox', name: '@knox_rogue' },
      { id: 'bot_mira', name: '@mira_mage' },
      { id: 'bot_zev', name: '@zev_bard' },
      { id: 'bot_orin', name: '@orin_tank' },
      { id: 'bot_lyra', name: '@lyra_hex' },
      { id: 'bot_vex', name: '@vex_shadow' },
      { id: 'bot_nyx', name: '@nyx_owl' },
      { id: 'bot_sol', name: '@sol_paladin' },
      { id: 'bot_fen', name: '@fen_ranger' },
      { id: 'bot_kael', name: '@kael_monk' },
      { id: 'bot_tala', name: '@tala_alchemist' }
    ];
    const choices = ['fight', 'sneak', 'bargain'];
    let cast = 0;
    for (const bot of bots) {
      const choice = choices[Math.floor(Math.random() * choices.length)];
      const r = await engine.castVote(bot.id, bot.name, choice);
      if (!r.alreadyVoted) cast++;
    }
    res.json({ ok: true, cast });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

engine.init().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Thread Dungeon running on http://0.0.0.0:${PORT}`);
  });
});
