# 🧵 Thread Dungeon

A daily interactive community dungeon crawler built for social threads. Every 6 hours, a new text + emoji dungeon room is posted with 3 choices (**⚔️ Fight**, **🥷 Sneak**, **🤝 Bargain**). Players cast 1 vote per room (stored in Redis), and when the 6-hour timer closes, the majority choice is applied to the shared party state.

## ✨ Features
- **30 Hand-Written Dungeon Rooms** (`src/rooms.json`) with random events & **Boss Encounters** every 5th room.
- **Redis-Backed Voting & Leaderboards** (`src/redisStore.js`): Supports `REDIS_URL` via `ioredis`, with an automatic persistent JSON-backed Redis-compatible fallback (`data/redis-snapshot.json`) for zero-config local/hackathon demos.
- **6-Hour Automated Scheduler** (`src/gameEngine.js`): Resolves majority votes, updates shared Party HP, Gold, and Inventory, and advances to the next room.
- **🏆 Most Decisive Voters Leaderboard**: Tracks players whose votes matched the winning majority most often.
- **💀 Death & Season Hall of Fame**: When party HP hits `0`, the season is archived and players can launch Season `N + 1`.

## 🚀 Quick Start
```bash
npm install
npm start
```
Open `http://localhost:3000` in your browser.

### Optional: External Redis
```bash
REDIS_URL=redis://localhost:6379 npm start
```
