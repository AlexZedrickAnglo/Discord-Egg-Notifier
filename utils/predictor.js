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
 * Compute real-time mathematical predictions based on history & active banner
 */
function getPrediction(activeBanner = null) {
  const history = loadHistory();
  const eggDb = loadEggDb();

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

  // 2. Dry-streak Analysis
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

  // Biome dry streaks
  const biomeDryStreaks = {};
  for (const b of KNOWN_BIOMES) {
    biomeDryStreaks[b] = 0;
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].biome.toLowerCase() === b.toLowerCase()) break;
      biomeDryStreaks[b]++;
    }
  }

  // 3. Rarity Probability Calculation (Base + Pity scaling)
  let weightSecret = 60.0;
  let weightEternal = 28.0;
  let weightDivine = 12.0;

  // Divine pity scaling
  if (divineDryStreak >= 5) {
    weightDivine += (divineDryStreak - 4) * 3.5;
  } else if (divineDryStreak === 0) {
    weightDivine *= 0.55; // Just spawned, lower immediate odds
  }

  // Eternal pity scaling
  if (eternalDryStreak >= 3) {
    weightEternal += (eternalDryStreak - 2) * 2.5;
  } else if (eternalDryStreak === 0) {
    weightEternal *= 0.7;
  }

  const totalRarityWeight = weightSecret + weightEternal + weightDivine;
  const pSecret = (weightSecret / totalRarityWeight);
  const pEternal = (weightEternal / totalRarityWeight);
  const pDivine = (weightDivine / totalRarityWeight);

  // 4. Biome Probability Calculation (Recency dry-streaks + Active banner affinity)
  const bannerBiomes = (activeBanner && BANNER_BIOME_MAP[activeBanner]) ? BANNER_BIOME_MAP[activeBanner] : [];
  const biomeWeights = {};
  let totalBiomeWeight = 0;

  for (const b of KNOWN_BIOMES) {
    const streak = biomeDryStreaks[b] ?? 0;
    let w = 1.0;
    if (streak === 0) {
      w = 0.35; // Just spawned in this biome
    } else if (streak === 1) {
      w = 0.70;
    } else if (streak === 2) {
      w = 1.05;
    } else {
      w = 1.05 + Math.min(streak - 2, 8) * 0.28; // Dry streak boost
    }

    if (bannerBiomes.includes(b)) {
      w *= 1.30; // Banner pool bonus
    }

    biomeWeights[b] = w;
    totalBiomeWeight += w;
  }

  const biomeProbabilities = {};
  for (const b of KNOWN_BIOMES) {
    biomeProbabilities[b] = biomeWeights[b] / totalBiomeWeight;
  }

  // 5. Specific Pet Likelihood Calculation
  // Pool all pets from database
  const allPets = [];
  const rarityMap = { Secret: pSecret, Eternal: pEternal, Divine: pDivine };

  // Count pets per (Biome, Rarity) bucket to split odds fairly
  const bucketCounts = {};
  for (const [rarity, pets] of Object.entries(eggDb)) {
    for (const pet of pets) {
      const key = `${pet.biome}_${rarity}`;
      bucketCounts[key] = (bucketCounts[key] || 0) + 1;
    }
  }

  let totalRawPetScore = 0;
  const rawPetScores = [];

  for (const [rarity, pets] of Object.entries(eggDb)) {
    const rProb = rarityMap[rarity] || 0.1;
    for (const pet of pets) {
      const bProb = biomeProbabilities[pet.biome] || (1 / KNOWN_BIOMES.length);
      const countInBucket = bucketCounts[`${pet.biome}_${rarity}`] || 1;

      // Base pet probability score
      let score = (bProb * rProb) / countInBucket;

      // If active banner requires this pet for sacrifice
      if (activeBanner && bannerBiomes.includes(pet.biome)) {
        score *= 1.15;
      }

      rawPetScores.push({
        name: pet.name,
        rarity,
        biome: pet.biome,
        rawScore: score,
      });
      totalRawPetScore += score;
    }
  }

  // Normalize pet scores to exact percentages summing to 100%
  const rankedPets = rawPetScores
    .map((p) => {
      const pct = (p.rawScore / totalRawPetScore) * 100;
      return {
        name: p.name,
        rarity: p.rarity,
        biome: p.biome,
        probability: Math.round(pct * 10) / 10,
        bar: renderProgressBar(pct, 6),
      };
    })
    .sort((a, b) => b.probability - a.probability);

  // Top biomes ranking
  const rankedBiomes = Object.entries(biomeProbabilities)
    .map(([biome, prob]) => ({
      biome,
      probability: Math.round(prob * 1000) / 10,
      dryStreak: biomeDryStreaks[biome] ?? 0,
    }))
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
    topPets: rankedPets.slice(0, 10),
  };
}

module.exports = {
  recordSpawn,
  getPrediction,
  renderProgressBar,
  normalizeBiome,
};
