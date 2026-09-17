// ──────────────────────────────────────────────────────────────
//  index.js — Steal An Egg Notifier  (discord.js v14)
//
//  Subsystems:
//    1. Roblox game-update polling      (every 60 s)
//    2. Scheduled Admin Abuse events    (weekly Saturday cron)
//    3. Express webhook receiver        (POST /api/notify-egg)
//    4. Slash commands                  (/checkegg, /status, /setchannel)
// ──────────────────────────────────────────────────────────────
require('dotenv').config();

const fs      = require('fs');
const path    = require('path');
const cron    = require('node-cron');
const express = require('express');

const {
  Client,
  Collection,
  GatewayIntentBits,
} = require('discord.js');

const { getGameDetails, findEgg } = require('./utils/roblox');
const {
  buildUpdateEmbed,
  buildEggSpawnEmbed,
  buildEventEmbed,
  buildRiftBossEmbed,
  buildBannerEmbed,
  buildScannerReadyEmbed,
} = require('./utils/notifier');
const predictor = require('./utils/predictor');

// ═════════════════════════════════════════════════════════════
//  1.  GLOBAL STATE
// ═════════════════════════════════════════════════════════════
const botStartTime    = Date.now();
let notifyChannelId   = process.env.NOTIFY_CHANNEL_ID;
let lastKnownUpdated  = null;
const EGG_ROLE_ID     = process.env.EGG_ROLE_ID;
let currentActiveBanner = null;
let lastBossAlertTime   = 0;
let lastBossAlertInfo   = null;
const BOSS_DEDUPE_MS    = 600_000; // 10 minutes lockout (Rift Boss event duration)
const recentEggAlerts   = new Map();
const EGG_DEDUPE_MS     = 15_000;  // 15 seconds lockout

let predictionChannelId     = process.env.PREDICTION_CHANNEL_ID || '1550126931100303480';
let livePredictionMessageId = null;
const PREDICTION_STATE_FILE = path.join(__dirname, 'data', 'prediction-state.json');

function loadPredictionState() {
  try {
    if (fs.existsSync(PREDICTION_STATE_FILE)) {
      const data = JSON.parse(fs.readFileSync(PREDICTION_STATE_FILE, 'utf8'));
      if (data && data.messageId) {
        livePredictionMessageId = data.messageId;
      }
    }
  } catch (err) {
    console.error('[prediction] Error loading state:', err.message);
  }
}

function savePredictionState(state) {
  try {
    fs.writeFileSync(PREDICTION_STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.error('[prediction] Error saving state:', err.message);
  }
}

loadPredictionState();

/**
 * Post or update the live prediction display in the dedicated channel (1550126931100303480).
 * Strictly edits / replaces the existing message to prevent any message flooding.
 */
async function updatePredictionChannel() {
  if (!predictionChannelId) return;

  try {
    const channel = await client.channels.fetch(predictionChannelId).catch(() => null);
    if (!channel) {
      console.warn(`[prediction] Channel ${predictionChannelId} not found or inaccessible.`);
      return;
    }

    const prediction = predictor.getPrediction(currentActiveBanner);
    const embed = buildPredictionEmbed(prediction);

    // Fetch messages in the channel to find any existing bot message
    const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
    const botMessages = recent ? Array.from(recent.values()).filter((m) => m.author.id === client.user.id) : [];

    if (botMessages.length > 0) {
      // Use the latest bot message as the primary display
      const targetMsg = botMessages[0];
      await targetMsg.edit({ embeds: [embed] });
      livePredictionMessageId = targetMsg.id;
      console.log(`[prediction] 🔄 Replaced/updated live prediction in channel <#${predictionChannelId}> (ID: ${targetMsg.id})`);

      // Clean up any extra/stale duplicate bot messages to prevent channel flooding
      if (botMessages.length > 1) {
        for (let i = 1; i < botMessages.length; i++) {
          botMessages[i].delete().catch(() => {});
        }
      }
    } else {
      // Channel is completely empty of bot messages: post the initial message
      const sent = await channel.send({ embeds: [embed] });
      livePredictionMessageId = sent.id;
      console.log(`[prediction] 🚀 Posted initial live prediction display in channel <#${predictionChannelId}>`);
    }

    savePredictionState({ messageId: livePredictionMessageId });
  } catch (err) {
    console.error('[prediction] Failed to update prediction channel:', err.message);
  }
}

/** Setter injected into the /setchannel command. */
function setNotifyChannel(id) {
  notifyChannelId = id;
  console.log(`[config] Notification channel set → ${id}`);
}

// ═════════════════════════════════════════════════════════════
//  2.  DISCORD CLIENT
// ═════════════════════════════════════════════════════════════
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
  ],
});

// ── Load slash commands ──────────────────────────────────────
client.commands = new Collection();
const cmdDir = path.join(__dirname, 'commands');

for (const file of fs.readdirSync(cmdDir).filter((f) => f.endsWith('.js'))) {
  const cmd = require(path.join(cmdDir, file));
  client.commands.set(cmd.data.name, cmd);
}

// ── Handle interactions ──────────────────────────────────────
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction, { setNotifyChannel, botStartTime });
  } catch (err) {
    console.error(`[cmd] /${interaction.commandName} error:`, err);
    const reply = { content: '❌ An error occurred running that command.', flags: 64 };
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(reply);
    } else {
      await interaction.reply(reply);
    }
  }
});

// ═════════════════════════════════════════════════════════════
//  3.  ROBLOX GAME-UPDATE POLLER  (every 60 s)
// ═════════════════════════════════════════════════════════════
async function pollGameUpdates() {
  try {
    const game = await getGameDetails();
    if (!game) return;

    const currentUpdated = game.updated;

    if (lastKnownUpdated === null) {
      lastKnownUpdated = currentUpdated;
      console.log(`[poller] Seeded last-updated → ${currentUpdated}`);
      return;
    }

    if (currentUpdated !== lastKnownUpdated) {
      lastKnownUpdated = currentUpdated;
      console.log(`[poller] Game update detected → ${currentUpdated}`);

      const channel = await client.channels.fetch(notifyChannelId).catch(() => null);
      if (channel) {
        const embed = buildUpdateEmbed(game);
        await channel.send({ embeds: [embed] });
      }
    }
  } catch (err) {
    console.error('[poller] Error:', err.message);
  }
}

// ═════════════════════════════════════════════════════════════
//  4.  SCHEDULED EVENTS  (node-cron)
// ═════════════════════════════════════════════════════════════

/**
 * Helper: send an event embed + optional role ping to the notify channel.
 */
async function sendEventAlert(embedOpts, ping = true) {
  const channel = await client.channels.fetch(notifyChannelId).catch(() => null);
  if (!channel) return;

  const embed    = buildEventEmbed(embedOpts);
  const rolePing = (ping && EGG_ROLE_ID) ? `<@&${EGG_ROLE_ID}>` : '';

  await channel.send({ content: rolePing, embeds: [embed] });
}

/**
 * Compute the Unix timestamp for the *next* occurrence of a given
 * day-of-week + hour (UTC).  dayOfWeek: 0 = Sunday … 6 = Saturday.
 */
function nextOccurrence(dayOfWeek, hour) {
  const now    = new Date();
  const target = new Date(now);
  target.setUTCHours(hour, 0, 0, 0);

  const diff = (dayOfWeek - now.getUTCDay() + 7) % 7;
  target.setUTCDate(target.getUTCDate() + (diff === 0 && now >= target ? 7 : diff));

  return Math.floor(target.getTime() / 1000);
}

// ── A) Admin Abuse — 1-hour warning  (Saturday 19:00 UTC) ───
cron.schedule('0 19 * * 6', () => {
  const eventUnix = nextOccurrence(6, 20);
  sendEventAlert({
    title:       '⚠️  Admin Abuse / Update — Starting in 1 Hour!',
    description: 'Get ready! The weekly Admin Abuse event begins soon.',
    eventUnix,
    color:       0xFEE75C,
  });
}, { timezone: 'UTC' });

// ── B) Admin Abuse — event start  (Saturday 20:00 UTC) ──────
cron.schedule('0 20 * * 6', () => {
  const eventUnix = Math.floor(Date.now() / 1000);
  sendEventAlert({
    title:       '🚀  Admin Abuse / Update — NOW LIVE!',
    description: 'The weekly Admin Abuse event has started!',
    eventUnix,
    color:       0x57F287,
  });
}, { timezone: 'UTC' });



// ═════════════════════════════════════════════════════════════
//  5.  EXPRESS WEBHOOK RECEIVER  (POST /api/notify-egg, /api/notify-boss)
// ═════════════════════════════════════════════════════════════
const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

/**
 * Helper: Send Rift Boss alert to Discord with role ping.
 */
async function sendRiftBossAlert({ bossName, biome, health, timeLimit, image }) {
  const boss        = bossName || 'Rift Boss';
  const targetBiome = (biome || 'Unknown').trim();

  // Filter: Never alert if biome is Unknown (drops secondary phase/entity announcements)
  if (!targetBiome || targetBiome.toLowerCase() === 'unknown') {
    console.log(`[webhook/boss] ⏳ Dropped boss alert with Unknown biome: "${boss}"`);
    return false;
  }

  const now = Date.now();
  if (now - lastBossAlertTime < BOSS_DEDUPE_MS) {
    console.log(`[webhook/boss] ⏳ Duplicate boss alert suppressed: "${boss}" in "${targetBiome}" (prior: "${lastBossAlertInfo?.boss}" in "${lastBossAlertInfo?.targetBiome}" ${Math.round((now - lastBossAlertTime) / 1000)}s ago)`);
    return false;
  }
  lastBossAlertTime = now;
  lastBossAlertInfo = { boss, targetBiome, timestamp: now };

  const channel = await client.channels.fetch(notifyChannelId).catch(() => null);
  if (!channel) throw new Error('Notification channel not available.');

  const embed    = buildRiftBossEmbed({ bossName: boss, biome: targetBiome, health, timeLimit, image });
  const rolePing = EGG_ROLE_ID ? `<@&${EGG_ROLE_ID}>` : '';
  const header   = `${rolePing} 🌀 ⚔️ **RIFT BOSS SPAWNED:** **${boss}** in **${targetBiome}**!`;

  await channel.send({ content: header, embeds: [embed] });
  return true;
}

// Rift Boss alert endpoints
app.post('/api/notify-boss', async (req, res) => {
  const { bossName, biome, health, timeLimit, image } = req.body ?? {};

  if (!biome && !bossName) {
    return res.status(400).json({ error: 'Missing required field: biome or bossName' });
  }

  try {
    await sendRiftBossAlert({ bossName, biome, health, timeLimit, image });
    return res.status(200).json({ ok: true, message: 'Rift boss alert sent.' });
  } catch (err) {
    console.error('[webhook/boss] Error:', err.message);
    return res.status(500).json({ error: err.message || 'Failed to send alert.' });
  }
});

app.post('/api/notify-rift', (req, res) => {
  req.url = '/api/notify-boss';
  app.handle(req, res);
});

// Scanner client connected/ready alert endpoint
app.post('/api/notify-ready', async (req, res) => {
  const { account, jobId } = req.body ?? {};

  try {
    const channel = await client.channels.fetch(notifyChannelId).catch(() => null);
    if (!channel) throw new Error('Notification channel not available.');

    const embed  = buildScannerReadyEmbed({ account, jobId });
    const header = `🚀 **SCANNER EXECUTED:** Account **${account || 'Roblox Client'}** is now online and scanning!`;

    await channel.send({ content: header, embeds: [embed] });

    // Live update predictions in dedicated channel (1550126931100303480)
    updatePredictionChannel().catch((err) => console.error('[prediction] Ready update error:', err.message));

    return res.status(200).json({ ok: true, message: 'Ready alert sent.' });
  } catch (err) {
    console.error('[webhook/ready] Error:', err.message);
    return res.status(500).json({ error: err.message || 'Failed to send alert.' });
  }
});

// Rift Machine Banner alert endpoint
app.post('/api/notify-banner', async (req, res) => {
  const { bannerName, requiredPets, details, timeRemaining, jobId } = req.body ?? {};

  if (!bannerName) {
    return res.status(400).json({ error: 'Missing required field: bannerName' });
  }

  currentActiveBanner = bannerName;

  try {
    const channel = await client.channels.fetch(notifyChannelId).catch(() => null);
    if (!channel) throw new Error('Notification channel not available.');

    const embed    = buildBannerEmbed({ bannerName, requiredPets, details, timeRemaining, jobId });
    const rolePing = EGG_ROLE_ID ? `<@&${EGG_ROLE_ID}>` : '';

    const header = `${rolePing} 📜 **ACTIVE RIFT BANNER:** **${bannerName}** is now active at the Rift Machine!`;

    await channel.send({ content: header, embeds: [embed] });

    // Live update predictions in dedicated channel if banner changes
    updatePredictionChannel().catch((err) => console.error('[prediction] Banner update error:', err.message));

    return res.status(200).json({ ok: true, message: 'Banner alert sent.' });
  } catch (err) {
    console.error('[webhook/banner] Error:', err.message);
    return res.status(500).json({ error: err.message || 'Failed to send alert.' });
  }
});

// Egg spawn alert endpoint
app.post('/api/notify-egg', async (req, res) => {
  const {
    eggName,
    bossName,
    rarity,
    biome,
    jobId,
    image,
    type,
    isBoss,
    health,
    timeLimit,
    isBannerEgg,
    bannerName,
    requiredForPet,
  } = req.body ?? {};

  // If payload is actually a boss/rift event, route appropriately
  if (isBoss || type === 'boss' || type === 'rift' || bossName) {
    try {
      await sendRiftBossAlert({
        bossName: bossName || eggName,
        biome,
        health,
        timeLimit,
        image,
      });
      return res.status(200).json({ ok: true, message: 'Rift boss alert sent.' });
    } catch (err) {
      console.error('[webhook/boss] Error:', err.message);
      return res.status(500).json({ error: err.message || 'Failed to send alert.' });
    }
  }

  if (!eggName) {
    return res.status(400).json({ error: 'Missing required field: eggName' });
  }

  // Auto-match against egg database for enrichment
  const dbMatch = findEgg(eggName);
  const finalRarity = rarity  || dbMatch?.rarity || 'Unknown';
  const finalBiome  = biome   || dbMatch?.biome  || 'Unknown';

  // Server-side egg deduplication (15s lockout)
  const dedupeKey = `${(eggName || '').toLowerCase().trim()}_${(finalBiome || '').toLowerCase().trim()}`;
  const now = Date.now();
  if (recentEggAlerts.has(dedupeKey) && (now - recentEggAlerts.get(dedupeKey) < EGG_DEDUPE_MS)) {
    console.log(`[webhook/egg] ⏳ Duplicate egg alert suppressed: "${eggName}" in "${finalBiome}"`);
    return res.status(200).json({ ok: true, suppressed: true, message: 'Duplicate egg alert suppressed.' });
  }
  recentEggAlerts.set(dedupeKey, now);

  // Feed into global AI predictor
  predictor.recordSpawn({
    eggName,
    rarity: finalRarity,
    biome: finalBiome,
    timestamp: now,
    isBannerEgg,
    bannerName: bannerName || currentActiveBanner,
  });

  // Live update prediction channel whenever an egg spawns
  updatePredictionChannel().catch((err) => console.error('[prediction] Spawn update error:', err.message));

  try {
    const channel = await client.channels.fetch(notifyChannelId).catch(() => null);
    if (!channel) {
      return res.status(503).json({ error: 'Notification channel not available.' });
    }

    const embed = buildEggSpawnEmbed({
      eggName,
      rarity: finalRarity,
      biome:  finalBiome,
      jobId,
      image,
      isBannerEgg,
      bannerName,
      requiredForPet,
    });

    // Always ping the alert role for Secret / Eternal / Divine / Banner eggs
    const rolePing = EGG_ROLE_ID ? `<@&${EGG_ROLE_ID}>` : '';
    const bannerBadge = bannerName
      ? (requiredForPet ? `⭐ **[SACRIFICE EGG: ${bannerName}]** ` : `⭐ **[BANNER EGG: ${bannerName}]** `)
      : '';
    const header   = `${rolePing} ${bannerBadge}🚨 **${finalRarity.toUpperCase()} EGG:** **${eggName}** in **${finalBiome}**!`;

    await channel.send({ content: header, embeds: [embed] });

    return res.status(200).json({ ok: true, message: 'Egg alert sent.' });
  } catch (err) {
    console.error('[webhook] Error:', err.message);
    return res.status(500).json({ error: 'Failed to send alert.' });
  }
});

// Legacy route (backwards-compatible with earlier version)
app.post('/api/egg-spawn', (req, res) => {
  req.url = '/api/notify-egg';
  app.handle(req, res);
});

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok', uptime: Date.now() - botStartTime }));

// ═════════════════════════════════════════════════════════════
//  6.  STARTUP
// ═════════════════════════════════════════════════════════════
client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`   Notification channel : ${notifyChannelId}`);
  console.log(`   Alert role           : ${EGG_ROLE_ID ?? '(none)'}`);
  console.log(`   Egg database         : ${require('./utils/roblox').eggLookup.size} eggs loaded`);

  // Start the Roblox update poller (every 60 seconds).
  setInterval(pollGameUpdates, 60_000);
  pollGameUpdates();

  // Start Express
  app.listen(PORT, () => {
    console.log(`   Webhook server       : http://localhost:${PORT}`);
    console.log('──────────────────────────────────────────────');

    // Initial live prediction display in dedicated channel
    updatePredictionChannel().catch((err) => console.error('[prediction] Startup update error:', err.message));
  });
});

client.login(process.env.DISCORD_TOKEN);
