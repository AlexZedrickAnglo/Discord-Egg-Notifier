// ──────────────────────────────────────────────────────────────
// utils/patternAnalyzer.js — Global Spawn Pattern & Sequence Analyzer
// ──────────────────────────────────────────────────────────────
// Analyzes global spawn history to detect:
// 1. Repeating sequence cycles (deterministic rotation playlists)
// 2. Shuffle-bag (deck) behavior (pool exhaustion without replacement)
// 3. Biome Markov transition chains P(Biome_{t+1} | Biome_t)
// 4. Timing cadence and clock alignment

const fs = require('fs');
const { dataPath } = require('./dataDir');

const HISTORY_PATH = dataPath('spawn-history.json');
const EGGS_PATH = dataPath('eggs.json');

/**
 * Load raw history from disk
 */
function loadHistory(customPath) {
  const p = customPath || HISTORY_PATH;
  try {
    if (fs.existsSync(p)) {
      const data = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (Array.isArray(data)) return data;
    }
  } catch (err) {
    console.error('[patternAnalyzer] Error loading history:', err.message);
  }
  return [];
}

/**
 * Load eggs DB
 */
function loadEggDb() {
  try {
    if (fs.existsSync(EGGS_PATH)) {
      return JSON.parse(fs.readFileSync(EGGS_PATH, 'utf8'));
    }
  } catch (err) {
    console.error('[patternAnalyzer] Error loading eggs.json:', err.message);
  }
  return { Secret: [], Eternal: [], Divine: [] };
}

/**
 * Clean egg name
 */
function cleanEggName(raw) {
  return String(raw || '').replace(/\s+Egg$/i, '').trim();
}

/**
 * 1. Sequence & Cycle Detection
 * Searches for repeating substrings of length k (k = 2..8) in the sequence of eggs.
 */
function detectCycles(history, minK = 2, maxK = 8) {
  const eggs = history.map((h) => cleanEggName(h.eggName)).filter(Boolean);
  if (eggs.length < minK * 2) {
    return { detected: false, confidence: 0, matches: [] };
  }

  const matches = [];

  for (let k = minK; k <= Math.min(maxK, Math.floor(eggs.length / 2)); k++) {
    const patterns = new Map();
    for (let i = 0; i <= eggs.length - k; i++) {
      const gram = eggs.slice(i, i + k).join(' -> ');
      if (!patterns.has(gram)) patterns.set(gram, []);
      patterns.get(gram).push(i);
    }

    for (const [gram, indices] of patterns.entries()) {
      if (indices.length >= 2) {
        const gaps = [];
        for (let j = 1; j < indices.length; j++) {
          gaps.push(indices[j] - indices[j - 1]);
        }
        const isUniformGap = gaps.every((g) => g === gaps[0]);
        matches.push({
          pattern: gram,
          length: k,
          occurrences: indices.length,
          indices,
          gaps,
          isPeriodic: isUniformGap && indices.length >= 2,
          period: isUniformGap ? gaps[0] : null,
        });
      }
    }
  }

  matches.sort((a, b) => (b.occurrences * b.length) - (a.occurrences * a.length));

  const bestMatch = matches.find((m) => m.isPeriodic && m.occurrences >= 3) || matches[0] || null;

  return {
    detected: !!bestMatch,
    bestMatch,
    totalPatternsFound: matches.length,
    matches: matches.slice(0, 10),
  };
}

/**
 * 2. Shuffle-Bag / Deck Analysis
 * Checks the recurrence distance for each egg.
 * In a true shuffle-bag of size N, the minimum distance between identical eggs is >= N/2.
 * In pure RNG with replacement, distance can be 1 (back-to-back repeats).
 */
function analyzeShuffleBag(history, eggDb) {
  const eggNames = history.map((h) => cleanEggName(h.eggName).toLowerCase()).filter(Boolean);
  if (eggNames.length < 4) {
    return { isShuffleBag: false, confidence: 0, minDistance: null, currentDeckStatus: {} };
  }

  const distances = {};
  const lastIndex = {};
  let minRepeatDistance = Infinity;
  let backToBackCount = 0;

  for (let i = 0; i < eggNames.length; i++) {
    const name = eggNames[i];
    if (lastIndex[name] !== undefined) {
      const dist = i - lastIndex[name];
      if (!distances[name]) distances[name] = [];
      distances[name].push(dist);
      if (dist < minRepeatDistance) minRepeatDistance = dist;
      if (dist === 1) backToBackCount++;
    }
    lastIndex[name] = i;
  }

  const hasRepeats = Object.keys(distances).length > 0;
  const isShuffleBag = hasRepeats && minRepeatDistance >= 6 && backToBackCount === 0;

  // Track the current cycle: which eggs have appeared since the most recent repeat
  const recentSeen = new Set();
  let currentCycleLength = 0;
  for (let i = eggNames.length - 1; i >= 0; i--) {
    const name = eggNames[i];
    if (recentSeen.has(name)) {
      break; // Cycle boundary reached
    }
    recentSeen.add(name);
    currentCycleLength++;
  }

  // Find remaining unseen eggs per rarity tier in the active cycle
  const currentDeckStatus = {};
  for (const [rarity, pets] of Object.entries(eggDb)) {
    const totalInTier = pets.length;
    const seenInTier = pets.filter((p) => recentSeen.has(p.name.toLowerCase()));
    const unseenInTier = pets.filter((p) => !recentSeen.has(p.name.toLowerCase()));

    currentDeckStatus[rarity] = {
      total: totalInTier,
      seenCount: seenInTier.length,
      unseenCount: unseenInTier.length,
      unseenEggs: unseenInTier.map((p) => p.name),
      exhaustionPercentage: totalInTier > 0 ? Math.round((seenInTier.length / totalInTier) * 100) : 0,
    };
  }

  return {
    isShuffleBag,
    hasRepeats,
    minRepeatDistance: hasRepeats ? minRepeatDistance : null,
    backToBackCount,
    currentCycleLength,
    recentSeenCount: recentSeen.size,
    currentDeckStatus,
  };
}

/**
 * 3. Biome Markov Transition Chain
 * Computes empirical transition matrix P(Biome_{t+1} | Biome_t).
 */
function analyzeBiomeTransitions(history) {
  const transitions = {};
  const biomeCounts = {};

  for (let i = 0; i < history.length; i++) {
    const b = history[i].biome || 'Unknown';
    biomeCounts[b] = (biomeCounts[b] || 0) + 1;
    if (i > 0) {
      const prev = history[i - 1].biome || 'Unknown';
      if (!transitions[prev]) transitions[prev] = {};
      transitions[prev][b] = (transitions[prev][b] || 0) + 1;
    }
  }

  const transitionMatrix = {};
  for (const [fromB, toMap] of Object.entries(transitions)) {
    const total = Object.values(toMap).reduce((a, b) => a + b, 0);
    transitionMatrix[fromB] = {};
    for (const [toB, count] of Object.entries(toMap)) {
      transitionMatrix[fromB][toB] = Math.round((count / total) * 100) / 100;
    }
  }

  return {
    biomeCounts,
    transitionMatrix,
  };
}

/**
 * 4. Timing Cadence & Clock Alignment
 * Measures exact spawn intervals and minute-of-hour clustering.
 */
function analyzeTimingCadence(history) {
  if (history.length < 2) {
    return { averageIntervalSeconds: 360, stdDevSeconds: 0, clockAlignment: {} };
  }

  const intervals = [];
  const minuteCounts = {};

  for (let i = 0; i < history.length; i++) {
    const date = new Date(history[i].timestamp);
    const min = date.getMinutes();
    const bucket = Math.floor(min / 5) * 5;
    minuteCounts[bucket] = (minuteCounts[bucket] || 0) + 1;

    if (i > 0) {
      const diff = Math.round((history[i].timestamp - history[i - 1].timestamp) / 1000);
      if (diff >= 60 && diff <= 1800) {
        intervals.push(diff);
      }
    }
  }

  let avg = 360;
  let stdDev = 0;
  if (intervals.length > 0) {
    avg = Math.round(intervals.reduce((a, b) => a + b, 0) / intervals.length);
    const variance = intervals.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / intervals.length;
    stdDev = Math.round(Math.sqrt(variance));
  }

  return {
    validIntervalsCount: intervals.length,
    averageIntervalSeconds: avg,
    stdDevSeconds: stdDev,
    minuteClustering: minuteCounts,
  };
}

/**
 * Comprehensive Analysis Runner
 */
function analyzeAll(customHistory = null) {
  const history = customHistory || loadHistory();
  const eggDb = loadEggDb();

  const cycles = detectCycles(history);
  const shuffle = analyzeShuffleBag(history, eggDb);
  const biomes = analyzeBiomeTransitions(history);
  const timing = analyzeTimingCadence(history);

  return {
    totalSpawns: history.length,
    cycles,
    shuffle,
    biomes,
    timing,
  };
}

module.exports = {
  detectCycles,
  analyzeShuffleBag,
  analyzeBiomeTransitions,
  analyzeTimingCadence,
  analyzeAll,
  cleanEggName,
};
