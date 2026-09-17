// ──────────────────────────────────────────────────────────────
// utils/predictor.js — Global Egg & Specific Pet AI Predictor
// ──────────────────────────────────────────────────────────────
// Analyzes global spawn history, biome rotation dry-streaks,
// and rarity pity to forecast next spawn ETA and specific pet likelihoods.

const fs = require('fs');
const path = require('path');

const HISTORY_PATH = path.join(__dirname, '..', 'data', 'spawn-history.json');
const EGGS_PATH = path.join(__dirname, '..', 'data', 'eggs.json');

const KNOWN_BIOMES = [
  'Jungle',
  'Snow',
  'Volcano',
  'Abyss Ocean',
  'Prehistoric',
  'Cosmic',
  'Cherry Blossom',
  'Titan Temple',
  'Angels & Demons',
];

// Banner biome affinity maps
const BANNER_BIOME_MAP = {
  Riftborn: ['Jungle', 'Snow', 'Volcano', 'Abyss Ocean'],
  Riftbeasts: ['Volcano', 'Abyss Ocean', 'Prehistoric', 'Cosmic'],
  'Shattered Rift': ['Prehistoric', 'Cosmic', 'Cherry Blossom', 'Titan Temple'],
};

/**
 * Load raw eggs database
 */
function loadEggDb() {
  try {
    if (fs.existsSync(EGGS_PATH)) {
      return JSON.parse(fs.readFileSync(EGGS_PATH, 'utf8'));
    }
  } catch (err) {
    console.error('[predictor] Failed to load eggs.json:', err.message);
  }
  return { Secret: [], Eternal: [], Divine: [] };
}

/**
 * Load spawn history array
 */
function loadHistory() {
  try {
    if (fs.existsSync(HISTORY_PATH)) {
      const data = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'));
      if (Array.isArray(data)) return data;
    }
  } catch (err) {
    console.error('[predictor] Failed to load spawn-history.json:', err.message);
  }
  return [];
}

/**
 * Save spawn history array (capped at 200 items)
 */
function saveHistory(history) {
  try {
    const trimmed = history.slice(-200);
    fs.writeFileSync(HISTORY_PATH, JSON.stringify(trimmed, null, 2), 'utf8');
  } catch (err) {
    console.error('[predictor] Failed to save spawn-history.json:', err.message);
  }
}

/**
 * Clean & normalize biome name
 */
function normalizeBiome(raw) {
  if (!raw) return 'Unknown';
  const clean = raw.replace(/[^\w\s&]/gi, '').trim();
  const lower = clean.toLowerCase();
  if (lower.includes('demon') || lower.includes('angel')) return 'Angels & Demons';
  if (lower.includes('cherry')) return 'Cherry Blossom';
  if (lower.includes('abyss')) return 'Abyss Ocean';
  if (lower.includes('titan')) return 'Titan Temple';
  if (lower.includes('cosmic')) return 'Cosmic';
  if (lower.includes('prehistoric')) return 'Prehistoric';
  if (lower.includes('volcano')) return 'Volcano';
  if (lower.includes('jungle')) return 'Jungle';
  if (lower.includes('snow')) return 'Snow';
  return clean;
}

/**
 * Record a newly spawned egg into global learning history
 */
function recordSpawn({ eggName, rarity, biome, timestamp = Date.now(), isBannerEgg, bannerName }) {
  const history = loadHistory();
  const cleanBiome = normalizeBiome(biome);

  // Deduplicate against the very latest recorded spawn if within 30s
  if (history.length > 0) {
    const latest = history[history.length - 1];
    if (
      latest.eggName.toLowerCase() === eggName.toLowerCase() &&
      latest.biome.toLowerCase() === cleanBiome.toLowerCase() &&
      timestamp - latest.timestamp < 30000
    ) {
      return; // Already recorded
    }
  }

  history.push({
    eggName,
    rarity: rarity || 'Secret',
    biome: cleanBiome,
    timestamp,
    isBannerEgg: !!isBannerEgg,
    bannerName: bannerName || null,
  });

  saveHistory(history);
  console.log(`[predictor] 🧠 Logged spawn: ${eggName} (${rarity}) in ${cleanBiome}. Total history: ${history.length}`);
}

/**
 * Render ASCII progress bar
 */
function renderProgressBar(percentage, totalBlocks = 6) {
  const filledCount = Math.min(totalBlocks, Math.max(0, Math.round((percentage / 100) * totalBlocks)));
  const emptyCount = totalBlocks - filledCount;
  return '▰'.repeat(filledCount) + '▱'.repeat(emptyCount);
}

/**
 * Compute real-time mathematical predictions based on history & active banner.
 * Uses empirical spawn frequency distribution, Bayesian rarity priors,
 * and recency cooldowns to forecast which egg will spawn next.
 */
function getPrediction(activeBanner = null) {
  const history = loadHistory();
  const eggDb = loadEggDb();
  const totalSpawns = history.length;

  // 1. Compute Average Spawn Interval and Next Spawn ETA
  let avgIntervalMs = 360000; // Default 6 minutes
  if (history.length >= 2) {
    const validIntervals = [];
    for (let i = 1; i < history.length; i++) {
      const diff = history[i].timestamp - history[i - 1].timestamp;
      // Filter out gaps larger than 30 minutes (server restarts / inactivity)
      if (diff > 60000 && diff < 1800000) {
        validIntervals.push(diff);
      }
    }
    if (validIntervals.length > 0) {
      avgIntervalMs = validIntervals.reduce((a, b) => a + b, 0) / validIntervals.length;
    }
  }

  const lastSpawn = history.length > 0 ? history[history.length - 1] : null;
  const lastSpawnTime = lastSpawn ? lastSpawn.timestamp : (Date.now() - avgIntervalMs);
  const nextSpawnTimestamp = lastSpawnTime + avgIntervalMs;
  const nextSpawnUnix = Math.floor(nextSpawnTimestamp / 1000);
  const secondsRemaining = Math.max(0, Math.round((nextSpawnTimestamp - Date.now()) / 1000));

  // 2. Count occurrences of each egg, rarity, and biome from history
  const eggCounts = {};
  const rarityCounts = { Secret: 0, Eternal: 0, Divine: 0 };
  const biomeCounts = {};

  history.forEach((h) => {
    const eggKey = (h.eggName || '').toLowerCase().trim();
    eggCounts[eggKey] = (eggCounts[eggKey] || 0) + 1;

    const r = h.rarity || 'Secret';
    if (rarityCounts[r] !== undefined) {
      rarityCounts[r]++;
    }

    const b = normalizeBiome(h.biome);
    biomeCounts[b] = (biomeCounts[b] || 0) + 1;
  });

  // 3. Bayesian Smoothed Rarity Distribution with Pity
  const alphaSecret = 3.0;
  const alphaEternal = 1.4;
  const alphaDivine = 0.6;
  const sumAlpha = alphaSecret + alphaEternal + alphaDivine;
  const totalObserved = totalSpawns + sumAlpha;

  let pSecret = (rarityCounts.Secret + alphaSecret) / totalObserved;
  let pEternal = (rarityCounts.Eternal + alphaEternal) / totalObserved;
  let pDivine = (rarityCounts.Divine + alphaDivine) / totalObserved;

  // Track rarity dry streaks
  let divineDryStreak = 0;
  let eternalDryStreak = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const r = (history[i].rarity || '').toLowerCase();
    if (r === 'divine') break;
    divineDryStreak++;
  }
  for (let i = history.length - 1; i >= 0; i--) {
    const r = (history[i].rarity || '').toLowerCase();
    if (r === 'eternal') break;
    eternalDryStreak++;
  }

  // Progressive pity scaling
  if (divineDryStreak >= 5) {
    pDivine *= (1 + (divineDryStreak - 4) * 0.18);
  }
  if (eternalDryStreak >= 3) {
    pEternal *= (1 + (eternalDryStreak - 2) * 0.12);
  }

  const sumR = pSecret + pEternal + pDivine;
  pSecret /= sumR;
  pEternal /= sumR;
  pDivine /= sumR;
  const rarityMap = { Secret: pSecret, Eternal: pEternal, Divine: pDivine };

  // 4. Track dry streaks for each individual egg/pet
  const petDryStreaks = {};
  for (const [rarity, pets] of Object.entries(eggDb)) {
    for (const pet of pets) {
      let streak = 0;
      for (let i = history.length - 1; i >= 0; i--) {
        const hName = (history[i].eggName || '').toLowerCase().trim();
        const pName = pet.name.toLowerCase().trim();
        if (hName === pName || hName.includes(pName) || pName.includes(hName)) {
          break;
        }
        streak++;
      }
      petDryStreaks[pet.name] = streak;
    }
  }

  // 5. Active Banner affinity biomes
  const bannerBiomes = (activeBanner && BANNER_BIOME_MAP[activeBanner]) ? BANNER_BIOME_MAP[activeBanner] : [];

  // 6. Calculate Frequency-Based Score for Every Egg
  let totalScore = 0;
  const rawEggScores = [];

  for (const [rarity, pets] of Object.entries(eggDb)) {
    const rProb = rarityMap[rarity] || 0.1;

    for (const pet of pets) {
      const petKey = pet.name.toLowerCase().trim();
      const count = eggCounts[petKey] || 0;
      const streak = petDryStreaks[pet.name] ?? 999;

      // Frequency factor: Eggs with higher observed spawn counts carry higher empirical weight
      const freqFactor = 1.0 + (count * 0.85);

      // Biome frequency factor: Biomes that spawn eggs frequently carry higher weight
      const bCount = biomeCounts[pet.biome] || 0;
      const biomeFactor = 1.0 + (bCount * 0.20);

      let score = rProb * freqFactor * biomeFactor;

      // Recency cooldown penalty & dry streak balancing:
      // The egg that spawned in the previous reset receives an immediate cooldown penalty,
      // dropping it out of the top slot so the top 10 dynamically rotates.
      if (streak === 0) {
        score *= 0.10; // Just spawned! Severe cooldown
      } else if (streak === 1) {
        score *= 0.50; // Spawned 1 reset ago
      } else if (streak === 2) {
        score *= 0.80; // Spawned 2 resets ago
      } else {
        score *= (1.0 + Math.min(streak - 2, 6) * 0.04); // Gradual return to strength
      }

      // Active banner affinity boost
      if (activeBanner && bannerBiomes.includes(pet.biome)) {
        score *= 1.25;
      }

      const eggName = pet.name.endsWith('Egg') ? pet.name : `${pet.name} Egg`;

      rawEggScores.push({
        name: pet.name,
        eggName,
        rarity,
        biome: pet.biome,
        spawnCount: count,
        dryStreak: streak,
        score,
      });
      totalScore += score;
    }
  }

  // Normalize egg scores to exact percentages summing to 100%
  const sortedEggs = rawEggScores
    .map((e) => {
      const pct = (e.score / totalScore) * 100;
      return {
        ...e,
        probability: Math.round(pct * 10) / 10,
        bar: renderProgressBar(pct, 6),
      };
    })
    .sort((a, b) => b.probability - a.probability);

  // Compute predicted ETA in xx:xx minutes based on rank and spawn pace
  const avgSec = Math.round(avgIntervalMs / 1000);
  const now = Date.now();

  const rankedEggs = sortedEggs.map((e, idx) => {
    const etaSecs = Math.max(10, Math.round(secondsRemaining + (idx * avgSec * 0.85)));
    const mins = Math.floor(etaSecs / 60);
    const secs = etaSecs % 60;
    const etaFormatted = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    const etaUnix = Math.floor((now + etaSecs * 1000) / 1000);

    return {
      ...e,
      etaSeconds: etaSecs,
      etaFormatted,
      etaUnix,
    };
  });

  // Biome ranking based on empirical frequency & activity
  const rankedBiomes = KNOWN_BIOMES
    .map((b) => {
      const count = biomeCounts[b] || 0;
      const pct = totalSpawns > 0 ? (count / totalSpawns) * 100 : 100 / KNOWN_BIOMES.length;
      return {
        biome: b,
        spawnCount: count,
        probability: Math.round(pct * 10) / 10,
      };
    })
    .sort((a, b) => b.probability - a.probability);

  return {
    totalLogged: history.length,
    lastSpawn,
    nextSpawnUnix,
    nextSpawnEtaSeconds: secondsRemaining,
    averageIntervalSeconds: Math.round(avgIntervalMs / 1000),
    rarityOdds: {
      Secret: Math.round(pSecret * 1000) / 10,
      Eternal: Math.round(pEternal * 1000) / 10,
      Divine: Math.round(pDivine * 1000) / 10,
    },
    pity: {
      divineDryStreak,
      eternalDryStreak,
    },
    topBiomes: rankedBiomes.slice(0, 4),
    topEggs: rankedEggs.slice(0, 10),
    topPets: rankedEggs.slice(0, 10), // Backwards compatibility alias
  };
}

module.exports = {
  recordSpawn,
  getPrediction,
  renderProgressBar,
  normalizeBiome,
};
