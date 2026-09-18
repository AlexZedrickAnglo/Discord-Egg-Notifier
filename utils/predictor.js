// ──────────────────────────────────────────────────────────────
// utils/predictor.js — Global Egg & Specific Pet AI Predictor
// ──────────────────────────────────────────────────────────────
// Analyzes global spawn history, biome rotation dry-streaks,
// and rarity pity to forecast next spawn ETA and specific pet likelihoods.

const fs = require('fs');
const path = require('path');
const { dataPath } = require('./dataDir');

const HISTORY_PATH = dataPath('spawn-history.json');
const EGGS_PATH = dataPath('eggs.json');

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

const MAX_HISTORY_SPAWNS = parseInt(process.env.MAX_HISTORY_SPAWNS, 10) || 10000;
let cachedHistory = null;

let cachedEggDb = null;

/**
 * Load raw eggs database with dynamic auto-discovery for newly added weekly update eggs
 */
function loadEggDb() {
  if (cachedEggDb) return cachedEggDb;
  let db = { Secret: [], Eternal: [], Divine: [] };
  try {
    if (fs.existsSync(EGGS_PATH)) {
      db = JSON.parse(fs.readFileSync(EGGS_PATH, 'utf8'));
    }
  } catch (err) {
    console.error('[predictor] Failed to load eggs.json:', err.message);
  }

  // Auto-discover any new eggs introduced in game updates that appeared in real spawns
  const history = loadHistory();
  const knownNames = new Set();
  for (const pets of Object.values(db)) {
    for (const p of pets) knownNames.add(p.name.toLowerCase().trim());
  }

  const SYSTEM_NAMES = new Set(['scanner connected', 'scanner disconnected', 'ready', 'offline', 'system']);
  for (const h of history) {
    const rawName = (h.eggName || '').replace(/\s+Egg$/i, '').trim();
    const lowerName = rawName.toLowerCase();
    const lowerRarity = (h.rarity || '').toLowerCase();
    if (
      !rawName ||
      knownNames.has(lowerName) ||
      SYSTEM_NAMES.has(lowerName) ||
      lowerName.includes('scanner') ||
      lowerName.startsWith('banner:') ||
      lowerRarity === 'system' ||
      lowerRarity === 'rift'
    ) {
      continue;
    }
    knownNames.add(lowerName);
    const r = normalizeRarity(h.rarity);
    if (!db[r]) db[r] = [];
    db[r].push({ name: rawName, biome: h.biome || 'Unknown' });
  }

  cachedEggDb = db;
  return db;
}

/**
 * Load spawn history array (cached in memory for sub-millisecond execution)
 */
function loadHistory() {
  if (cachedHistory) return cachedHistory;
  try {
    if (fs.existsSync(HISTORY_PATH)) {
      const data = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'));
      if (Array.isArray(data)) {
        cachedHistory = data;
        return cachedHistory;
      }
    }
  } catch (err) {
    console.error('[predictor] Failed to load spawn-history.json:', err.message);
  }
  cachedHistory = [];
  return cachedHistory;
}

let isWritingHistory = false;
let pendingHistoryData = null;

/**
 * Save spawn history array (capped at MAX_HISTORY_SPAWNS with atomic non-blocking async disk persistence)
 */
function saveHistory(history) {
  cachedHistory = history.slice(-MAX_HISTORY_SPAWNS);
  pendingHistoryData = cachedHistory;

  if (isWritingHistory) return;

  const flush = () => {
    if (!pendingHistoryData) {
      isWritingHistory = false;
      return;
    }
    isWritingHistory = true;
    const dataToWrite = pendingHistoryData;
    pendingHistoryData = null;

    const tmpPath = `${HISTORY_PATH}.tmp`;
    const jsonStr = JSON.stringify(dataToWrite, null, 2);

    fs.writeFile(tmpPath, jsonStr, 'utf8', (err) => {
      if (err) {
        // Direct write fallback
        fs.writeFile(HISTORY_PATH, jsonStr, 'utf8', (fallbackErr) => {
          if (fallbackErr) {
            console.error('[predictor] ❌ Failed to write spawn-history.json:', fallbackErr.message);
          }
          if (pendingHistoryData) setImmediate(flush);
          else isWritingHistory = false;
        });
        return;
      }

      fs.rename(tmpPath, HISTORY_PATH, (renameErr) => {
        if (renameErr) {
          // Direct write fallback if atomic rename fails (e.g. Windows file lock)
          fs.writeFile(HISTORY_PATH, jsonStr, 'utf8', (fallbackErr) => {
            if (fallbackErr) {
              console.error('[predictor] ❌ Failed direct write fallback for spawn-history.json:', fallbackErr.message);
            }
            if (pendingHistoryData) setImmediate(flush);
            else isWritingHistory = false;
          });
          return;
        }

        if (pendingHistoryData) {
          setImmediate(flush);
        } else {
          isWritingHistory = false;
        }
      });
    });
  };

  flush();
}

/**
 * Clean & normalize rarity to capitalized standard: 'Secret' | 'Eternal' | 'Divine'
 */
function normalizeRarity(raw) {
  if (!raw) return 'Secret';
  const lower = String(raw).toLowerCase().trim();
  if (lower === 'divine') return 'Divine';
  if (lower === 'eternal') return 'Eternal';
  if (lower === 'secret') return 'Secret';
  return lower.charAt(0).toUpperCase() + lower.slice(1);
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
  if (!eggName) return;

  const rawName = String(eggName).replace(/\s+Egg$/i, '').trim();
  const lowerName = rawName.toLowerCase();
  const lowerRarity = String(rarity || '').toLowerCase().trim();

  // Guard against system, scanner, or banner events
  if (
    lowerRarity === 'system' ||
    lowerRarity === 'rift' ||
    lowerName.includes('scanner') ||
    lowerName.startsWith('banner:') ||
    lowerName === 'ready' ||
    lowerName === 'offline'
  ) {
    return;
  }

  cachedEggDb = null; // Invalidate to ensure any new update eggs are discovered
  cachedPredictionKey = null;
  cachedPredictionBase = null;

  const history = loadHistory();
  const cleanBiome = normalizeBiome(biome);
  const cleanRarity = normalizeRarity(rarity);

  // Deduplicate against recent recorded spawns within 45 seconds
  if (history.length > 0) {
    const recentSpawns = history.slice(-5);
    const isDup = recentSpawns.some((h) => {
      const hName = (h.eggName || '').replace(/\s+Egg$/i, '').trim().toLowerCase();
      const hBiome = normalizeBiome(h.biome).toLowerCase();
      return (
        hName === lowerName &&
        (hBiome === cleanBiome.toLowerCase() || cleanBiome === 'Unknown' || hBiome === 'Unknown') &&
        Math.abs(timestamp - h.timestamp) < 45000
      );
    });
    if (isDup) {
      console.log(`[predictor] ⏳ Duplicate spawn suppressed in predictor: "${rawName}" in "${cleanBiome}"`);
      return;
    }
  }

  history.push({
    eggName: rawName,
    rarity: cleanRarity,
    biome: cleanBiome,
    timestamp,
    isBannerEgg: !!isBannerEgg,
    bannerName: bannerName || null,
  });

  saveHistory(history);
  console.log(`[predictor] 🧠 Logged spawn: ${rawName} (${cleanRarity}) in ${cleanBiome}. Total history: ${history.length}`);
}

let cachedPredictionKey = null;
let cachedPredictionBase = null;

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
 * Results are memoized so routine 60s countdown ticks only recalculate lightweight timestamps.
 */
function getPrediction(activeBanner = null) {
  const history = loadHistory();
  const lastSpawn = history.length > 0 ? history[history.length - 1] : null;
  const currentKey = `${history.length}_${lastSpawn ? lastSpawn.timestamp : 0}_${lastSpawn ? lastSpawn.eggName : ''}_${activeBanner || ''}`;

  if (cachedPredictionKey === currentKey && cachedPredictionBase) {
    const now = Date.now();
    let nextTs = cachedPredictionBase.nextSpawnTimestamp;
    const avgSec = cachedPredictionBase.avgSec || 360;
    const avgMs = avgSec * 1000;

    // Roll forward target timestamp if elapsed while awaiting next spawn
    if (nextTs <= now) {
      const elapsed = now - nextTs;
      const cycles = Math.floor(elapsed / avgMs) + 1;
      nextTs = nextTs + cycles * avgMs;
      cachedPredictionBase.nextSpawnTimestamp = nextTs;
    }

    const secondsRemaining = Math.max(15, Math.round((nextTs - now) / 1000));
    const nextSpawnUnix = Math.floor(nextTs / 1000);
    const marginMs = (cachedPredictionBase.result?.marginSeconds || 45) * 1000;
    const windowStartUnix = Math.floor((nextTs - marginMs) / 1000);
    const windowEndUnix = Math.floor((nextTs + marginMs) / 1000);

    const rankedEggs = cachedPredictionBase.sortedEggs.map((e, idx) => {
      const etaSecs = Math.round(secondsRemaining + (idx * avgSec));
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

    return {
      ...cachedPredictionBase.result,
      nextSpawnUnix,
      windowStartUnix,
      windowEndUnix,
      nextSpawnEtaSeconds: secondsRemaining,
      topEggs: rankedEggs.slice(0, 10),
      topPets: rankedEggs.slice(0, 10),
    };
  }

  const eggDb = loadEggDb();
  const totalSpawns = history.length;

  // 1. Compute Robust Spawn Interval, Standard Deviation & 90% Confidence Window
  let medianIntervalMs = 360000; // Default 6 minutes
  let stdDevMs = 45000;          // Default ±45s variance
  const validIntervals = [];

  if (history.length >= 2) {
    for (let i = 1; i < history.length; i++) {
      const diff = history[i].timestamp - history[i - 1].timestamp;
      // Filter out gaps larger than 25 minutes (server restarts / inactivity) or < 60s (duplicates)
      if (diff >= 60000 && diff <= 1500000) {
        validIntervals.push(diff);
      }
    }
  }

  if (validIntervals.length >= 3) {
    validIntervals.sort((a, b) => a - b);
    const q1 = validIntervals[Math.floor(validIntervals.length * 0.25)];
    const q3 = validIntervals[Math.floor(validIntervals.length * 0.75)];
    const iqr = q3 - q1;
    const lowerBound = Math.max(60000, q1 - 1.5 * iqr);
    const upperBound = q3 + 1.5 * iqr;

    const filtered = validIntervals.filter((v) => v >= lowerBound && v <= upperBound);
    const setForStats = filtered.length >= 3 ? filtered : validIntervals;

    const mid = Math.floor(setForStats.length / 2);
    medianIntervalMs = setForStats.length % 2 !== 0
      ? setForStats[mid]
      : (setForStats[mid - 1] + setForStats[mid]) / 2;

    const mean = setForStats.reduce((a, b) => a + b, 0) / setForStats.length;
    const variance = setForStats.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / setForStats.length;
    stdDevMs = Math.sqrt(variance);
  }

  const now = Date.now();
  const lastSpawnTime = lastSpawn ? lastSpawn.timestamp : (now - medianIntervalMs);
  let nextSpawnTimestamp = lastSpawnTime + medianIntervalMs;

  if (nextSpawnTimestamp <= now) {
    const elapsedSinceLast = now - lastSpawnTime;
    if (elapsedSinceLast > 1500000) { // Gap > 25 mins (game server empty / inactive)
      // Server is active now, egg spawn window is expected within half the standard interval
      nextSpawnTimestamp = now + Math.round(medianIntervalMs * 0.5);
    } else {
      // Active ongoing game session, project forward through spawn cycles
      const cyclesPassed = Math.floor(elapsedSinceLast / medianIntervalMs);
      nextSpawnTimestamp = lastSpawnTime + (cyclesPassed + 1) * medianIntervalMs;
    }
  }

  // Ensure nextSpawnTimestamp is at least 15s in the future so countdown is always forward-pointing
  if (nextSpawnTimestamp <= now) {
    nextSpawnTimestamp = now + 60000;
  }

  const nextSpawnUnix = Math.floor(nextSpawnTimestamp / 1000);
  const secondsRemaining = Math.max(15, Math.round((nextSpawnTimestamp - now) / 1000));

  // 90% Confidence Interval (Z ≈ 1.645)
  const zScore = 1.645;
  const marginMs = Math.max(20000, Math.round(zScore * stdDevMs));
  const windowStartUnix = Math.floor((nextSpawnTimestamp - marginMs) / 1000);
  const windowEndUnix = Math.floor((nextSpawnTimestamp + marginMs) / 1000);
  const marginSeconds = Math.round(marginMs / 1000);

  // Dynamic confidence score based on sample size & standard deviation tightness
  const sampleConfidence = Math.min(30, validIntervals.length * 1.5);
  const varianceFactor = Math.max(0, 65 - (stdDevMs / 1000) * 0.5);
  const timingConfidencePct = Math.min(96, Math.max(78, Math.round(sampleConfidence + varianceFactor)));

  // 2. Build 1st-Order Markov Biome Transition Matrix P(Biome_{t+1} | Biome_t)
  const transitionCounts = {};
  for (let i = 1; i < history.length; i++) {
    const fromB = normalizeBiome(history[i - 1].biome);
    const toB = normalizeBiome(history[i].biome);
    if (fromB !== 'Unknown' && toB !== 'Unknown') {
      if (!transitionCounts[fromB]) transitionCounts[fromB] = {};
      transitionCounts[fromB][toB] = (transitionCounts[fromB][toB] || 0) + 1;
    }
  }

  const lastBiome = lastSpawn ? normalizeBiome(lastSpawn.biome) : null;
  const markovBiomeProb = {};
  if (lastBiome && transitionCounts[lastBiome]) {
    const totalTransitions = Object.values(transitionCounts[lastBiome]).reduce((a, b) => a + b, 0);
    for (const b of KNOWN_BIOMES) {
      const count = transitionCounts[lastBiome][b] || 0;
      // Laplace smoothing (+0.5)
      markovBiomeProb[b] = (count + 0.5) / (totalTransitions + 0.5 * KNOWN_BIOMES.length);
    }
  } else {
    for (const b of KNOWN_BIOMES) {
      markovBiomeProb[b] = 1.0 / KNOWN_BIOMES.length;
    }
  }

  // 2. Count occurrences of each egg, rarity, and biome from history
  const eggCounts = {};
  const rarityCounts = { Secret: 0, Eternal: 0, Divine: 0 };
  const biomeCounts = {};

  history.forEach((h) => {
    const rawName = (h.eggName || '').replace(/\s+Egg$/i, '').trim();
    const eggKey = rawName.toLowerCase();
    if (!eggKey || eggKey.includes('scanner') || eggKey.startsWith('banner:')) return;

    eggCounts[eggKey] = (eggCounts[eggKey] || 0) + 1;

    const r = normalizeRarity(h.rarity);
    if (rarityCounts[r] !== undefined) {
      rarityCounts[r]++;
    } else {
      rarityCounts.Secret++;
    }

    const b = normalizeBiome(h.biome);
    if (b !== 'Unknown') {
      biomeCounts[b] = (biomeCounts[b] || 0) + 1;
    }
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

  // 4. Pre-index dry streaks for each individual egg/pet via single reverse pass
  const petDryStreaks = {};
  const historyLen = history.length;
  let totalPetsCount = 0;
  for (const pets of Object.values(eggDb)) {
    totalPetsCount += pets.length;
    for (const pet of pets) {
      petDryStreaks[pet.name] = historyLen;
    }
  }

  const foundPets = new Set();
  for (let i = historyLen - 1; i >= 0; i--) {
    const rawH = (history[i].eggName || '').replace(/\s+Egg$/i, '').trim().toLowerCase();
    const streak = (historyLen - 1) - i;
    for (const pets of Object.values(eggDb)) {
      for (const pet of pets) {
        if (!foundPets.has(pet.name)) {
          const pName = pet.name.toLowerCase().trim();
          if (rawH === pName || rawH.includes(pName) || pName.includes(rawH)) {
            petDryStreaks[pet.name] = streak;
            foundPets.add(pet.name);
          }
        }
      }
    }
    if (foundPets.size >= totalPetsCount) break;
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

      // Biome frequency factor blended with Markov transition probability
      const bCount = biomeCounts[pet.biome] || 0;
      const bEmpirical = totalSpawns > 0 ? (bCount / totalSpawns) : (1 / KNOWN_BIOMES.length);
      const bMarkov = markovBiomeProb[pet.biome] || (1 / KNOWN_BIOMES.length);
      // 60% Markov transition weight + 40% historical biome frequency
      const biomeFactor = 0.5 + (bMarkov * 1.5) + (bEmpirical * 0.8);

      let score = rProb * freqFactor * biomeFactor;

      // Recency cooldown penalty & dry streak balancing:
      // The egg that spawned in the previous reset receives an immediate cooldown penalty,
      // dropping it out of the top slot so the top 10 dynamically rotates.
      if (streak === 0) {
        score *= 0.05; // Just spawned! 95% elimination cooldown
      } else if (streak === 1) {
        score *= 0.40; // Spawned 1 reset ago
      } else if (streak === 2) {
        score *= 0.75; // Spawned 2 resets ago
      } else {
        score *= (1.0 + Math.min(streak - 2, 8) * 0.05); // Gradual return to strength
      }

      // Active banner affinity boost
      if (activeBanner && bannerBiomes.includes(pet.biome)) {
        score *= 1.35;
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
  const avgSec = Math.round(medianIntervalMs / 1000);

  const rankedEggs = sortedEggs.map((e, idx) => {
    const etaSecs = Math.round(secondsRemaining + (idx * avgSec));
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

  // Biome ranking based on empirical frequency, activity & Markov transition forecast
  const rankedBiomes = KNOWN_BIOMES
    .map((b) => {
      const count = biomeCounts[b] || 0;
      const pct = totalSpawns > 0 ? (count / totalSpawns) * 100 : 100 / KNOWN_BIOMES.length;
      const mProb = Math.round((markovBiomeProb[b] || 0) * 1000) / 10;
      return {
        biome: b,
        spawnCount: count,
        probability: Math.round(pct * 10) / 10,
        markovProb: mProb,
      };
    })
    .sort((a, b) => b.probability - a.probability);

  const top3CombinedProbability = Math.round(
    sortedEggs.slice(0, 3).reduce((acc, e) => acc + e.probability, 0) * 10
  ) / 10;

  const top5CombinedProbability = Math.round(
    sortedEggs.slice(0, 5).reduce((acc, e) => acc + e.probability, 0) * 10
  ) / 10;

  const finalResult = {
    totalLogged: history.length,
    lastSpawn,
    nextSpawnUnix,
    windowStartUnix,
    windowEndUnix,
    marginSeconds,
    timingConfidencePct,
    nextSpawnEtaSeconds: secondsRemaining,
    averageIntervalSeconds: avgSec,
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
    top3CombinedProbability,
    top5CombinedProbability,
  };

  cachedPredictionKey = currentKey;
  cachedPredictionBase = {
    nextSpawnTimestamp,
    avgSec,
    sortedEggs,
    result: finalResult,
  };

  return finalResult;
}

module.exports = {
  recordSpawn,
  getPrediction,
  loadHistory,
  renderProgressBar,
  normalizeBiome,
  normalizeRarity,
};
