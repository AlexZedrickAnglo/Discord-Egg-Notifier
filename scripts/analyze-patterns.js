// ──────────────────────────────────────────────────────────────
// scripts/analyze-patterns.js — Global Spawn Pattern Diagnostic Tool
// ──────────────────────────────────────────────────────────────
// Run: node scripts/analyze-patterns.js
// Inspects spawn-history.json to evaluate if the game follows
// a deterministic cycle, a shuffle bag, or weighted PRNG.

const { analyzeAll } = require('../utils/patternAnalyzer');

console.log('🔍 ========================================================');
console.log('   STEAL AN EGG: GLOBAL SPAWN PATTERN & SEQUENCE DIAGNOSTIC');
console.log('========================================================\n');

const results = analyzeAll();

console.log(`📊 Total Global Spawns Logged: ${results.totalSpawns}`);
console.log(`⏱️  Average Spawn Interval: ${results.timing.averageIntervalSeconds}s (~${Math.round(results.timing.averageIntervalSeconds / 60)} min) ± ${results.timing.stdDevSeconds}s\n`);

// 1. Cycle Detection
console.log('🔁 1. REPEATING CYCLE / PLAYLIST DETECTION:');
if (results.cycles.detected && results.cycles.bestMatch) {
  const m = results.cycles.bestMatch;
  console.log(`   ✅ REPEATING CYCLE DETECTED! (${m.occurrences} occurrences)`);
  console.log(`   Pattern: [ ${m.pattern} ]`);
  if (m.isPeriodic) {
    console.log(`   Period: Repeats every ${m.period} spawns`);
  }
} else {
  console.log('   ℹ️  No strict repeating cycle detected yet (need more consecutive spawns or spawns are non-deterministic).');
}

// 2. Shuffle Bag Analysis
console.log('\n🃏 2. SHUFFLE-BAG (POOL EXHAUSTION) ANALYSIS:');
if (results.shuffle.hasRepeats) {
  console.log(`   Minimum Distance Between Identical Egg: ${results.shuffle.minRepeatDistance} spawns`);
  console.log(`   Back-to-Back Repeats Count: ${results.shuffle.backToBackCount}`);
  if (results.shuffle.isShuffleBag) {
    console.log('   🎯 LIKELY SHUFFLE-BAG! Eggs do not repeat until other pool members have appeared.');
  } else if (results.shuffle.backToBackCount > 0) {
    console.log('   🎲 INDEPENDENT RNG: Back-to-back repeats occurred, meaning the pool is with replacement.');
  }
} else {
  console.log('   ℹ️  All recorded spawns so far are unique (or history is still small).');
}

console.log('\n📦 Active Cycle Status (Unseen Eggs in Current Run):');
for (const [rarity, status] of Object.entries(results.shuffle.currentDeckStatus)) {
  console.log(`   [${rarity}] Seen: ${status.seenCount}/${status.total} (${status.exhaustionPercentage}% exhausted)`);
  if (status.unseenEggs.length > 0 && status.unseenEggs.length <= 8) {
    console.log(`      Remaining Candidates: ${status.unseenEggs.join(', ')}`);
  }
}

// 3. Biome Transitions
console.log('\n🗺️  3. TOP BIOME TRANSITIONS:');
let transitionCount = 0;
for (const [fromB, toMap] of Object.entries(results.biomes.transitionMatrix)) {
  const topNext = Object.entries(toMap).sort((a, b) => b[1] - a[1])[0];
  if (topNext && topNext[1] > 0.3) {
    console.log(`   ${fromB} ➔ ${topNext[0]} (${Math.round(topNext[1] * 100)}% observed)`);
    transitionCount++;
  }
}
if (transitionCount === 0) {
  console.log('   ℹ️  Biome transitions appear distributed across multiple biomes.');
}

console.log('\n========================================================\n');
