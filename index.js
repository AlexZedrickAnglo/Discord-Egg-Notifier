// ──────────────────────────────────────────────────────────────
//  index.js — Steal An Egg Notifier  (discord.js v14)
//
//  Ties together:
//    1. Roblox game-update polling      (every 60 s)
//    2. Scheduled Admin Abuse events    (weekly Saturday cron)
//    3. Map egg-cycle reset alerts      (every 5 min)
//    4. Express webhook receiver        (POST /api/egg-spawn)
//    5. Slash commands                  (/status, /setchannel)
// ──────────────────────────────────────────────────────────────
require('dotenv').config();

const fs   = require('fs');
const path = require('path');
const cron = require('node-cron');
const express = require('express');

const {
  Client,
  Collection,
  GatewayIntentBits,
} = require('discord.js');

const { getGameDetails }    = require('./utils/roblox');
const {
  buildUpdateEmbed,
  buildEggSpawnEmbed,
  buildEventEmbed,
} = require('./utils/notifier');

// ═════════════════════════════════════════════════════════════
//  1.  GLOBAL STATE
// ═════════════════════════════════════════════════════════════
let notifyChannelId   = process.env.NOTIFY_CHANNEL_ID;
let lastKnownUpdated  = null;                // tracks Roblox 'updated' timestamp
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
    // Pass shared helpers as a second argument so commands stay decoupled.
    await command.execute(interaction, { setNotifyChannel });
  } catch (err) {
    console.error(`[cmd] /${interaction.commandName} error:`, err);
    const reply = { content: '❌ An error occurred running that command.', ephemeral: true };
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

    // First run — seed the timestamp, don't alert.
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
 * Helper: send an event embed + role ping to the notify channel.
 */
async function sendEventAlert(embedOpts) {
  const channel = await client.channels.fetch(notifyChannelId).catch(() => null);
  if (!channel) return;

  const embed = buildEventEmbed(embedOpts);
  const ping  = EGG_ROLE_ID ? `<@&${EGG_ROLE_ID}>` : '';

  await channel.send({ content: ping, embeds: [embed] });
}

/**
 * Compute the Unix timestamp for the *next* occurrence of a given
 * day-of-week + hour (UTC).  dayOfWeek: 0 = Sunday … 6 = Saturday.
 */
function nextOccurrence(dayOfWeek, hour) {
  const now = new Date();
  const target = new Date(now);
  target.setUTCHours(hour, 0, 0, 0);

  const diff = (dayOfWeek - now.getUTCDay() + 7) % 7;
  target.setUTCDate(target.getUTCDate() + (diff === 0 && now >= target ? 7 : diff));

  return Math.floor(target.getTime() / 1000);
}

// ── A) Admin Abuse / Update — 1-hour warning (Saturday 19:00 UTC) ──
cron.schedule('0 19 * * 6', () => {
  const eventUnix = nextOccurrence(6, 20); // event itself is at 20:00 UTC
  sendEventAlert({
    title:       '⚠️  Admin Abuse / Update — Starting in 1 Hour!',
    description: 'Get ready! The weekly Admin Abuse event begins soon.',
    eventUnix,
    color:       0xFEE75C,
  });
}, { timezone: 'UTC' });

// ── B) Admin Abuse / Update — event start (Saturday 20:00 UTC) ─────
cron.schedule('0 20 * * 6', () => {
  const eventUnix = Math.floor(Date.now() / 1000);
  sendEventAlert({
    title:       '🚀  Admin Abuse / Update — NOW LIVE!',
    description: 'The weekly Admin Abuse event has started!',
    eventUnix,
    color:       0x57F287,
  });
}, { timezone: 'UTC' });

// ── C) Map egg-cycle reset reminder (every 5 minutes) ──────────────
cron.schedule('*/5 * * * *', async () => {
  const channel = await client.channels.fetch(notifyChannelId).catch(() => null);
  if (!channel) return;

  const nextResetUnix = Math.floor(Date.now() / 1000) + 300; // 5 min from now

  const embed = buildEventEmbed({
    title:       '🔁  Egg Cycle Reset',
    description: 'Map egg cycle has reset — new spawns available!',
    eventUnix:   nextResetUnix,
    color:       0x5865F2,
  });

  await channel.send({ embeds: [embed] });
});

// ═════════════════════════════════════════════════════════════
//  5.  EXPRESS WEBHOOK RECEIVER  (POST /api/egg-spawn)
// ═════════════════════════════════════════════════════════════
const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Only ping the alert role for top-tier rarities
const PING_RARITIES = ['secret', 'eternal', 'divine'];

app.post('/api/egg-spawn', async (req, res) => {
  const { eggName, rarity, biome, serverId } = req.body ?? {};

  if (!eggName) {
    return res.status(400).json({ error: 'Missing required field: eggName' });
  }

  try {
    const channel = await client.channels.fetch(notifyChannelId).catch(() => null);
    if (!channel) {
      return res.status(503).json({ error: 'Notification channel not available.' });
    }

    const embed = buildEggSpawnEmbed({ eggName, rarity, biome, serverId });

    // Only ping role if the egg is Secret, Eternal, or Divine
    const cleanRarity = (rarity || '').toLowerCase().trim();
    const shouldPing = EGG_ROLE_ID && PING_RARITIES.includes(cleanRarity);

    const messagePayload = { embeds: [embed] };
    if (shouldPing) {
      messagePayload.content = `<@&${EGG_ROLE_ID}> 🚨 **${rarity.toUpperCase()} EGG SPAWNED:** **${eggName}**!`;
    }

    await channel.send(messagePayload);

    return res.status(200).json({ ok: true, message: 'Egg spawn alert sent.' });
  } catch (err) {
    console.error('[webhook] Error:', err.message);
    return res.status(500).json({ error: 'Failed to send alert.' });
  }
});

// Simple health check
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// ═════════════════════════════════════════════════════════════
//  6.  STARTUP
// ═════════════════════════════════════════════════════════════
client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`   Notification channel : ${notifyChannelId}`);
  console.log(`   Alert role           : ${EGG_ROLE_ID ?? '(none)'}`);

  // Start the Roblox update poller (every 60 seconds).
  setInterval(pollGameUpdates, 60_000);
  pollGameUpdates(); // initial seed

  // Start Express
  app.listen(PORT, () => {
    console.log(`   Webhook server       : http://localhost:${PORT}`);
    console.log('──────────────────────────────────────────────');
  });
});

client.login(process.env.DISCORD_TOKEN);
