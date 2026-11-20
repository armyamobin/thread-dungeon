const CHOICE_META = {
  fight: { icon: '⚔️', name: 'Fight' },
  sneak: { icon: '🥷', name: 'Sneak' },
  bargain: { icon: '🤝', name: 'Bargain' }
};

let currentState = null;
let votingEndsAt = null;

function getUserIdentity() {
  let stored = localStorage.getItem('td_username');
  if (!stored) {
    stored = '@adventurer_' + Math.floor(100 + Math.random() * 900);
    localStorage.setItem('td_username', stored);
  }
  return stored;
}

const usernameInput = document.getElementById('usernameInput');
usernameInput.value = getUserIdentity();
usernameInput.addEventListener('change', () => {
  const val = usernameInput.value.trim() || '@adventurer';
  localStorage.setItem('td_username', val);
  fetchState();
});

async function fetchState() {
  const userId = encodeURIComponent(usernameInput.value.trim() || '@adventurer');
  const res = await fetch(`/api/state?userId=${userId}`);
  const data = await res.json();
  currentState = data;
  render(data);
}

function render(data) {
  const { party, room, votes, leaderboard } = data;
  if (!party || !room) return;

  // Party HUD
  document.getElementById('statSeason').textContent = party.season;
  document.getElementById('statRoom').textContent = `#${party.roomNumber}`;
  document.getElementById('statHpText').textContent = `${party.hp} / ${party.maxHp}`;
  const hpPct = Math.max(0, Math.min(100, (party.hp / party.maxHp) * 100));
  const hpBar = document.getElementById('statHpBar');
  hpBar.style.width = `${hpPct}%`;
  hpBar.style.background =
    hpPct > 55 ? 'var(--hp-high)' : hpPct > 25 ? 'var(--hp-mid)' : 'var(--hp-low)';

  document.getElementById('statGold').textContent = `🪙 ${party.gold}`;

  const itemsEl = document.getElementById('statItems');
  itemsEl.innerHTML = party.items
    .map((item) => `<span class="item-pill">${item}</span>`)
    .join('');

  // Death Banner
  const deathBanner = document.getElementById('deathBanner');
  if (party.status === 'dead') {
    deathBanner.classList.remove('hidden');
    document.getElementById('deathSummary').textContent =
      `Season ${party.season} ended in Room #${party.roomNumber} with ${party.gold} gold.`;
  } else {
    deathBanner.classList.add('hidden');
  }

  // Room Post
  document.getElementById('postBadge').textContent = `Season ${party.season} · Room #${party.roomNumber}`;
  document.getElementById('eventBadge').textContent = room.randomEvent ? room.randomEvent.label : '';
  document.getElementById('roomTitle').textContent = room.title;
  document.getElementById('emojiScene').textContent = room.emojiScene;
  document.getElementById('roomDesc').textContent = room.description;
  document.getElementById('eventNote').textContent = room.randomEvent ? room.randomEvent.note : '';
  votingEndsAt = room.votingEndsAt;

  // Choices + Live Vote Bar
  const total = votes.total || 0;
  document.getElementById('totalVotes').textContent = `${total} ${total === 1 ? 'vote' : 'votes'}`;

  const choicesList = document.getElementById('choicesList');
  choicesList.innerHTML = '';

  ['fight', 'sneak', 'bargain'].forEach((key) => {
    const choiceObj = room.choices[key];
    const count = votes.counts[key] || 0;
    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
    const isVoted = votes.userVote === key;
    const meta = CHOICE_META[key];

    const btn = document.createElement('button');
    btn.className = `choice-btn ${isVoted ? 'voted' : ''}`;
    btn.disabled = party.status !== 'active' || Boolean(votes.userVote);

    btn.innerHTML = `
      <div class="choice-fill" style="width: ${pct}%"></div>
      <div class="choice-content">
        <div class="choice-main">
          <span class="choice-title">${meta.icon} ${meta.name} ${isVoted ? '· ✓ Your Vote' : ''}</span>
          <span class="choice-sub">${choiceObj.label}</span>
        </div>
        <div class="choice-stats">${pct}% (${count})</div>
      </div>
    `;

    btn.addEventListener('click', () => castVote(key));
    choicesList.appendChild(btn);
  });

  // Recent Voters Feed
  const recentEl = document.getElementById('recentVotes');
  if (votes.recentVoters && votes.recentVoters.length > 0) {
    recentEl.innerHTML = votes.recentVoters
      .map((v) => {
        const meta = CHOICE_META[v.choice] || { icon: '🎲', name: v.choice };
        return `<span class="vote-chip">${v.username} → ${meta.icon} ${meta.name}</span>`;
      })
      .join('');
  } else {
    recentEl.innerHTML = '';
  }

  // Leaderboard
  const lbEl = document.getElementById('leaderboardList');
  if (!leaderboard || leaderboard.length === 0) {
    lbEl.innerHTML = '<li class="empty-state">No resolved rooms yet.</li>';
  } else {
    lbEl.innerHTML = leaderboard
      .map(
        (entry) => `
      <li class="lb-item">
        <span><span class="lb-rank">#${entry.rank}</span>${entry.username}</span>
        <span class="lb-score">${entry.decisiveVotes} decisive</span>
      </li>`
      )
      .join('');
  }

  // History
  const histEl = document.getElementById('historyList');
  if (!party.history || party.history.length === 0) {
    histEl.innerHTML = '<p class="empty-state">No rooms resolved yet this season.</p>';
  } else {
    histEl.innerHTML = party.history
      .map((h) => {
        const meta = CHOICE_META[h.winningChoice] || { icon: '🎲', name: h.winningChoice };
        const hpStr = h.hpDelta >= 0 ? `+${h.hpDelta} HP` : `${h.hpDelta} HP`;
        const goldStr = h.goldDelta >= 0 ? `+${h.goldDelta}g` : `${h.goldDelta}g`;
        return `
          <div class="history-item">
            <div class="history-top">
              <span>Room #${h.roomNumber}: ${h.title}</span>
              <span>${meta.icon} ${meta.name}</span>
            </div>
            <div class="history-outcome">${h.outcomeText}</div>
            <div class="history-deltas">${hpStr} · ${goldStr}${h.itemGain ? ` · ${h.itemGain}` : ''}</div>
          </div>
        `;
      })
      .join('');
  }

  // Hall of Fame
  const hofEl = document.getElementById('hallOfFameList');
  if (!data.seasonsArchive || data.seasonsArchive.length === 0) {
    hofEl.innerHTML = '<p class="empty-state">No completed seasons yet.</p>';
  } else {
    hofEl.innerHTML = data.seasonsArchive
      .map(
        (s) => `
        <div class="history-item">
          <div class="history-top">
            <span>Season ${s.season}</span>
            <span>🪙 ${s.gold}g</span>
          </div>
          <div class="history-deltas">Reached Room #${s.roomsCleared} · ${s.itemsCount} items</div>
        </div>`
      )
      .join('');
  }
}

async function castVote(choice) {
  const user = usernameInput.value.trim() || '@adventurer';
  await fetch('/api/vote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: user, username: user, choice })
  });
  await fetchState();
}

document.getElementById('seedVotesBtn').addEventListener('click', async () => {
  await fetch('/api/seed-votes', { method: 'POST' });
  await fetchState();
});

document.getElementById('resolveNowBtn').addEventListener('click', async () => {
  await fetch('/api/scheduler/resolve', { method: 'POST' });
  await fetchState();
});

document.getElementById('restartSeasonBtn').addEventListener('click', async () => {
  await fetch('/api/season/restart', { method: 'POST' });
  await fetchState();
});

// Countdown timer
setInterval(() => {
  if (!votingEndsAt) return;
  const diff = Math.max(0, votingEndsAt - Date.now());
  const hrs = String(Math.floor(diff / 3600000)).padStart(2, '0');
  const mins = String(Math.floor((diff % 3600000) / 60000)).padStart(2, '0');
  const secs = String(Math.floor((diff % 60000) / 1000)).padStart(2, '0');
  document.getElementById('countdownTimer').textContent = `⏳ ${hrs}:${mins}:${secs}`;
}, 1000);

// Poll live state every 5 seconds
fetchState();
setInterval(fetchState, 5000);
