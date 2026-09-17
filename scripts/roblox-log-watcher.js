// ============================================================
// Steal An Egg - Real-Time Roblox Log Watcher (F9 Console Bridge)
// ============================================================
// Automatically detects egg & boss spawns when you run the Lua scanner
// in the Roblox Developer Console (F9). Tails Roblox's local log file
// and immediately forwards alerts to your Railway bot (< 50ms).

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const BOT_URL = process.env.BOT_WEBHOOK_URL || 'https://discord-egg-notifier-production.up.railway.app';
const LOGS_DIR = path.join(process.env.LOCALAPPDATA || '', 'Roblox', 'logs');

if (!fs.existsSync(LOGS_DIR)) {
  console.error(`\n❌ ERROR: Roblox logs directory not found at: ${LOGS_DIR}\n`);
  process.exit(1);
}

console.log('───────────────────────────────────────────────────────');
console.log('🎮 [Watcher] Steal An Egg - Roblox Console Log Watcher');
console.log(`📁 [Watcher] Watching folder: ${LOGS_DIR}`);
console.log(`🎯 [Watcher] Forwarding to  : ${BOT_URL}`);
console.log('───────────────────────────────────────────────────────');

// Deduplication cache (15s)
const recentAlerts = new Map();

function isDuplicate(key) {
  const now = Date.now();
  if (recentAlerts.has(key) && (now - recentAlerts.get(key) < 15000)) {
    return true;
  }
  recentAlerts.set(key, now);
  return false;
}

// Find the most recently modified Roblox Player log file
function getLatestLogFile() {
  try {
    const files = fs.readdirSync(LOGS_DIR)
      .filter((f) => f.includes('_Player_') && f.endsWith('.log'))
      .map((f) => {
        const fullPath = path.join(LOGS_DIR, f);
        return { path: fullPath, mtime: fs.statSync(fullPath).mtimeMs, name: f };
      })
      .sort((a, b) => b.mtime - a.mtime);

    return files[0] || null;
  } catch (err) {
    console.error('[Watcher] Error listing log files:', err.message);
    return null;
  }
}

const KNOWN_RARITIES = new Set([
  'Common', 'Uncommon', 'Rare', 'Epic',
  'Legendary', 'Mythic', 'Cosmic',
  'Secret', 'Eternal', 'Divine', 'Ultra',
]);

async function forwardEggAlert(rarity, eggName, biome) {
  const cleanEgg = eggName.trim();
  const cleanBiome = biome.trim();
  const dedupeKey = `egg_${cleanEgg}_${cleanBiome}`;

  if (isDuplicate(dedupeKey)) return;

  console.log(`[Watcher] 🥚 Detected: ${cleanEgg} (${rarity}) in ${cleanBiome}! Forwarding...`);
  try {
    const start = Date.now();
    await axios.post(`${BOT_URL}/api/notify-egg`, {
      eggName: cleanEgg,
      rarity: rarity.trim(),
      biome: cleanBiome,
    });
    console.log(`[Watcher] ✅ Alert forwarded to Discord in ${Date.now() - start}ms!`);
  } catch (err) {
    console.error(`[Watcher] ❌ Forward failed:`, err.response?.data || err.message);
  }
}

let lastBossForwardTime = 0;

async function forwardBossAlert(bossName, biome) {
  const now = Date.now();
  if (now - lastBossForwardTime < 120000) {
    console.log(`[Watcher] ⏳ Boss alert suppressed (cooldown active: ${Math.round((now - lastBossForwardTime) / 1000)}s ago)`);
    return;
  }
  lastBossForwardTime = now;

  const cleanBoss = (bossName || 'Rift Boss').trim();
  const cleanBiome = (biome || 'Unknown').trim();
  const dedupeKey = `boss_${cleanBoss}_${cleanBiome}`;

  if (isDuplicate(dedupeKey)) return;

  console.log(`[Watcher] 🌀 Detected: ${cleanBoss} in ${cleanBiome}! Forwarding...`);
  try {
    const start = Date.now();
    await axios.post(`${BOT_URL}/api/notify-boss`, {
      bossName: cleanBoss,
      biome: cleanBiome,
    });
    console.log(`[Watcher] ✅ Boss alert forwarded to Discord in ${Date.now() - start}ms!`);
  } catch (err) {
    console.error(`[Watcher] ❌ Forward failed:`, err.response?.data || err.message);
  }
}

async function forwardBannerAlert(bannerName) {
  const cleanBanner = bannerName.trim();
  const dedupeKey = `banner_${cleanBanner}`;

  if (isDuplicate(dedupeKey)) return;

  console.log(`[Watcher] 📜 Detected Banner: ${cleanBanner}! Forwarding...`);
  try {
    const start = Date.now();
    await axios.post(`${BOT_URL}/api/notify-banner`, {
      bannerName: cleanBanner,
    });
    console.log(`[Watcher] ✅ Banner alert forwarded to Discord in ${Date.now() - start}ms!`);
  } catch (err) {
    console.error(`[Watcher] ❌ Forward failed:`, err.response?.data || err.message);
  }
}

async function forwardReadyAlert(account) {
  const cleanAccount = (account || 'Roblox Client').trim();
  const dedupeKey = `ready_${cleanAccount}`;

  if (isDuplicate(dedupeKey)) return;

  console.log(`[Watcher] 🚀 Scanner ready for account: ${cleanAccount}! Forwarding...`);
  try {
    const start = Date.now();
    await axios.post(`${BOT_URL}/api/notify-ready`, {
      account: cleanAccount,
    });
    console.log(`[Watcher] ✅ Ready alert forwarded to Discord in ${Date.now() - start}ms!`);
  } catch (err) {
    console.error(`[Watcher] ❌ Forward failed:`, err.response?.data || err.message);
  }
}

function processLine(line) {
  if (!line || line.length < 10) return;

  // Pattern 1: From our Dev Console script [EGG_ALERT] EGG:rarity:eggName:biome
  const eggMatch = line.match(/\[EGG_ALERT\]\s+EGG:([^:]+):([^:]+):([^\r\n]+)/i);
  if (eggMatch) {
    forwardEggAlert(eggMatch[1], eggMatch[2], eggMatch[3]);
    return;
  }

  // Pattern 2: From our Dev Console script [EGG_ALERT] BOSS:bossName:biome
  const bossMatch = line.match(/\[EGG_ALERT\]\s+BOSS:([^:]+):([^\r\n]+)/i);
  if (bossMatch) {
    forwardBossAlert(bossMatch[1], bossMatch[2]);
    return;
  }

  // Pattern 3: From our Dev Console script [EGG_ALERT] BANNER:bannerName
  const bannerMatch = line.match(/\[EGG_ALERT\]\s+BANNER:([^\r\n]+)/i);
  if (bannerMatch) {
    forwardBannerAlert(bannerMatch[1]);
    return;
  }

  // Pattern 4: From our Dev Console script [EGG_ALERT] READY:account
  const readyMatch = line.match(/\[EGG_ALERT\]\s+READY:([^\r\n]+)/i);
  if (readyMatch) {
    forwardReadyAlert(readyMatch[1]);
    return;
  }

  // Pattern 5: Fallback raw announcement matching
  const rawEggMatch = line.match(/A[n]?\s+([a-zA-Z]+)\s+(.+?)\s+Egg\s+spawned\s+in\s+([^\r\n!.]+)/i);
  if (rawEggMatch && !line.includes('[Watcher]')) {
    let rarity = rawEggMatch[1].trim();
    let eggName = rawEggMatch[2].trim();
    const biome = rawEggMatch[3].trim();
    const capitalizedRarity = rarity.charAt(0).toUpperCase() + rarity.slice(1).toLowerCase();
    if (!KNOWN_RARITIES.has(capitalizedRarity)) {
      eggName = `${rarity} ${eggName}`;
      rarity = eggName.toLowerCase().includes('rift') ? 'Rift' : 'Special';
    }
    forwardEggAlert(rarity, eggName, biome);
    return;
  }

  const rawLower = line.toLowerCase();
  if ((rawLower.includes('rift boss') || rawLower.includes('abyss overlord') || (rawLower.includes('boss') && rawLower.includes('rift'))) && rawLower.includes('spawn') && !line.includes('[Watcher]')) {
    const biomeMatch = line.match(/in\s+([a-zA-Z\s]+)/i);
    forwardBossAlert('Rift Boss', biomeMatch ? biomeMatch[1] : 'Unknown');
  }
}

// Tail active log file
let currentFile = null;
let currentFileSize = 0;
let lineBuffer = '';

function tailFile() {
  const latest = getLatestLogFile();
  if (!latest) {
    setTimeout(tailFile, 2000);
    return;
  }

  // If player launched a new Roblox session, switch files
  if (!currentFile || currentFile.path !== latest.path) {
    currentFile = latest;
    // Start at end of existing file to only catch new spawns
    try {
      currentFileSize = fs.statSync(latest.path).size;
      console.log(`[Watcher] 📄 Attached to active log: ${latest.name}`);
    } catch {
      currentFileSize = 0;
    }
  }

  try {
    const stats = fs.statSync(currentFile.path);
    if (stats.size > currentFileSize) {
      const bytesToRead = stats.size - currentFileSize;
      const buffer = Buffer.alloc(bytesToRead);
      const fd = fs.openSync(currentFile.path, 'r');
      fs.readSync(fd, buffer, 0, bytesToRead, currentFileSize);
      fs.closeSync(fd);

      currentFileSize = stats.size;
      lineBuffer += buffer.toString('utf8');

      const lines = lineBuffer.split(/\r?\n/);
      lineBuffer = lines.pop() || ''; // Keep unfinished line

      for (const line of lines) {
        processLine(line);
      }
    } else if (stats.size < currentFileSize) {
      // File was truncated/recreated
      currentFileSize = stats.size;
    }
  } catch (err) {
    // File could be temporarily locked or rotating
  }

  setTimeout(tailFile, 250);
}

tailFile();
