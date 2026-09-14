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
} = require('./utils/notifier');

// ═════════════════════════════════════════════════════════════
//  1.  GLOBAL STATE
// ═════════════════════════════════════════════════════════════
const botStartTime    = Date.now();
let notifyChannelId   = process.env.NOTIFY_CHANNEL_ID;
let lastKnownUpdated  = null;
const EGG_ROLE_ID     = process.env.EGG_ROLE_ID;

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
  const channel = await client.channels.fetch(notifyChannelId).catch(() => null);
  if (!channel) throw new Error('Notification channel not available.');

  const boss        = bossName || 'Rift Boss';
  const targetBiome = biome || 'Unknown';

  const embed    = buildRiftBossEmbed({ bossName: boss, biome: targetBiome, health, timeLimit, image });
  const rolePing = EGG_ROLE_ID ? `<@&${EGG_ROLE_ID}>` : '';
  const header   = `${rolePing} 🌀 ⚔️ **RIFT BOSS SPAWNED:** **${boss}** in **${targetBiome}**!`;

  await channel.send({ content: header, embeds: [embed] });
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

// Rift Machine Banner alert endpoint
app.post('/api/notify-banner', async (req, res) => {
  const { bannerName, requiredPets, details, timeRemaining, jobId } = req.body ?? {};

  if (!bannerName) {
    return res.status(400).json({ error: 'Missing required field: bannerName' });
  }

  try {
    const channel = await client.channels.fetch(notifyChannelId).catch(() => null);
    if (!channel) throw new Error('Notification channel not available.');

    const embed    = buildBannerEmbed({ bannerName, requiredPets, details, timeRemaining, jobId });
    const rolePing = EGG_ROLE_ID ? `<@&${EGG_ROLE_ID}>` : '';

    let petSummary = '';
    if (Array.isArray(requiredPets) && requiredPets.length > 0) {
      const summaryList = requiredPets.map(p => {
        const name = typeof p === 'string' ? p : p.name;
        const biome = (typeof p === 'object' && p.biome) ? ` (${p.biome})` : '';
        return `**${name}**${biome}`;
      }).join(' • ');
      petSummary = `\n🥩 **Required Pets:** ${summaryList}`;
    }

    const header = `${rolePing} 📜 **ACTIVE RIFT BANNER:** **${bannerName}** is now active at the Rift Machine!${petSummary}`;

    await channel.send({ content: header, embeds: [embed] });
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
    });

    // Always ping the alert role for Secret / Eternal / Divine
    const rolePing = EGG_ROLE_ID ? `<@&${EGG_ROLE_ID}>` : '';
    const header   = `${rolePing} 🚨 **${finalRarity.toUpperCase()} EGG:** **${eggName}** in **${finalBiome}**!`;

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
  });
});

client.login(process.env.DISCORD_TOKEN);
