// ============================================================
// Steal An Egg - Real-Time Discord Channel Relay (Instant Forwarder)
// ============================================================
// Listens to a public Discord egg-notifier channel using a user account
// and instantly forwards egg & boss alerts to your Railway bot (< 50ms).

require('dotenv').config();
const axios = require('axios');
const { Client } = require('discord.js-selfbot-v13');
const eggDb = require('../data/eggs.json');

// ── CONFIGURATION ───────────────────────────────────────────
// Set these in your .env or replace directly below:
const USER_TOKEN = process.env.RELAY_USER_TOKEN;
const SOURCE_CHANNEL_ID = process.env.SOURCE_CHANNEL_ID;
const BOT_WEBHOOK_URL = process.env.BOT_WEBHOOK_URL || 'https://discord-egg-notifier-production.up.railway.app';

if (!USER_TOKEN || !SOURCE_CHANNEL_ID) {
  console.error('\n❌ ERROR: Missing RELAY_USER_TOKEN or SOURCE_CHANNEL_ID');
  console.error('Add them to your .env file:');
  console.error('RELAY_USER_TOKEN=your_discord_account_token_here');
  console.error('SOURCE_CHANNEL_ID=channel_id_to_watch_here\n');
  process.exit(1);
}

// Build list of all known eggs for fuzzy/keyword matching with pre-compiled regexes
const allEggs = [];
for (const [rarity, eggs] of Object.entries(eggDb)) {
  for (const egg of eggs) {
    allEggs.push({
      ...egg,
      rarity,
      regex: new RegExp(`\\b${egg.name.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i'),
    });
  }
}

// Cache to prevent duplicate forwards within 30 seconds
const recentForwards = new Map();

function isDuplicate(key) {
  const now = Date.now();
  if (recentForwards.size > 50) {
    for (const [k, t] of recentForwards.entries()) {
      if (now - t > 60000) recentForwards.delete(k);
    }
  }
  if (recentForwards.has(key) && (now - recentForwards.get(key) < 30000)) {
    return true;
  }
  recentForwards.set(key, now);
  return false;
}

// Extract full text from message content and embeds
function getFullMessageText(message) {
  let text = message.content || '';

  if (message.embeds && message.embeds.length > 0) {
    for (const embed of message.embeds) {
      if (embed.title)       text += ' ' + embed.title;
      if (embed.description) text += ' ' + embed.description;
      if (embed.fields) {
        for (const f of embed.fields) {
          text += ` ${f.name} ${f.value}`;
        }
      }
      if (embed.footer?.text) text += ' ' + embed.footer.text;
    }
  }

  return text.trim();
}

// ── PARSE & FORWARD ─────────────────────────────────────────
async function processMessage(message) {
  if (message.channelId !== SOURCE_CHANNEL_ID) return;

  const fullText = getFullMessageText(message);
  if (!fullText || fullText.length < 3) return;

  const lowerText = fullText.toLowerCase();

  // 1. Check for Rift Boss
  if (lowerText.includes('rift') && (lowerText.includes('boss') || lowerText.includes('spawn'))) {
    // Try to find biome
    let matchedBiome = 'Unknown';
    for (const egg of allEggs) {
      if (lowerText.includes(egg.biome.toLowerCase())) {
        matchedBiome = egg.biome;
        break;
      }
    }

    const dedupeKey = `boss_${matchedBiome}`;
    if (isDuplicate(dedupeKey)) return;

    console.log(`[Relay] 🌀 Rift Boss detected in ${matchedBiome}! Forwarding...`);
    try {
      await axios.post(`${BOT_WEBHOOK_URL}/api/notify-boss`, {
        bossName: 'Rift Boss',
        biome: matchedBiome,
      }, { timeout: 8000 });
      console.log(`[Relay] ✅ Rift Boss alert forwarded successfully!`);
    } catch (err) {
      console.error(`[Relay] ❌ Forward failed:`, err.response?.data || err.message);
    }
    return;
  }

  // 2. Check for Known Eggs in text
  for (const egg of allEggs) {
    if (egg.regex.test(fullText)) {
      const dedupeKey = `egg_${egg.name}_${egg.biome}`;
      if (isDuplicate(dedupeKey)) return;

      console.log(`[Relay] 🥚 Detected: ${egg.name} (${egg.rarity} - ${egg.biome})! Forwarding...`);

      try {
        const start = Date.now();
        await axios.post(`${BOT_WEBHOOK_URL}/api/notify-egg`, {
          eggName: egg.name,
          rarity: egg.rarity,
          biome: egg.biome,
        }, { timeout: 8000 });
        console.log(`[Relay] ✅ Forwarded in ${Date.now() - start}ms to your Discord server!`);
      } catch (err) {
        console.error(`[Relay] ❌ Forward failed:`, err.response?.data || err.message);
      }
      return;
    }
  }
}

// ── CLIENT SETUP ────────────────────────────────────────────
const client = new Client({ checkUpdate: false });

client.on('ready', () => {
  console.log('───────────────────────────────────────────────────────');
  console.log(`🚀 [Relay] Connected as user: ${client.user.tag}`);
  console.log(`👀 [Relay] Watching channel ID : ${SOURCE_CHANNEL_ID}`);
  console.log(`🎯 [Relay] Forwarding to URL  : ${BOT_WEBHOOK_URL}`);
  console.log(`⚡ [Relay] Zero-delay mode active (< 50ms forward).`);
  console.log('───────────────────────────────────────────────────────');
});

client.on('messageCreate', processMessage);

// In case the bot edits embeds into an existing message:
client.on('messageUpdate', (_oldMsg, newMsg) => {
  if (newMsg) processMessage(newMsg);
});

client.login(USER_TOKEN).catch((err) => {
  console.error('[Relay] Login failed:', err.message);
  process.exit(1);
});
