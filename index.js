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

// Global process crash safety handlers to ensure high availability
process.on('unhandledRejection', (reason, promise) => {
  console.error('[process] ⚠️ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[process] 💥 Uncaught Exception:', err);
});

const fs      = require('fs');
const path    = require('path');
const cron    = require('node-cron');
const express = require('express');

const {
  Client,
  Collection,
  GatewayIntentBits,
  Partials,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const { getGameDetails, findEgg } = require('./utils/roblox');
const {
  buildUpdateEmbed,
  buildEggSpawnEmbed,
  buildEventEmbed,
  buildRiftBossEmbed,
  buildBannerEmbed,
  buildScannerReadyEmbed,
  buildScannerOfflineEmbed,
  buildPredictionEmbed,
  buildRolePickerEmbed,
  buildLiveStatusEmbed,
} = require('./utils/notifier');
const predictor = require('./utils/predictor');
const { dataPath } = require('./utils/dataDir');

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
let riftBossChannelId       = process.env.RIFT_BOSS_CHANNEL_ID || '1550467255710785727';
let livePredictionMessageId = null;
const PREDICTION_STATE_FILE = dataPath('prediction-state.json');

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

let isUpdatingPrediction = false;
let pendingPredictionUpdate = false;

/**
 * Post or update the live prediction display in the dedicated channel (1550126931100303480).
 * Strictly edits / replaces the existing message to prevent any message flooding.
 */
async function updatePredictionChannel() {
  if (!predictionChannelId) return;

  if (isUpdatingPrediction) {
    pendingPredictionUpdate = true;
    return;
  }
  isUpdatingPrediction = true;

  try {
    const channel = await getChannel(predictionChannelId);
    if (!channel) {
      console.warn(`[prediction] Channel ${predictionChannelId} not found or inaccessible.`);
      return;
    }

    const prediction = predictor.getPrediction(currentActiveBanner);
    const embed = buildPredictionEmbed(prediction);

    let targetMsg = null;
    if (livePredictionMessageId) {
      targetMsg = await channel.messages.fetch(livePredictionMessageId).catch(() => null);
    }

    if (!targetMsg) {
      const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
      const botMessages = recent ? Array.from(recent.values()).filter((m) => m.author.id === client.user.id) : [];
      if (botMessages.length > 0) {
        targetMsg = botMessages[0];
      }
    }

    if (targetMsg) {
      await targetMsg.edit({ embeds: [embed] });
      livePredictionMessageId = targetMsg.id;
      console.log(`[prediction] 🔄 Edited live prediction in-place in channel <#${predictionChannelId}> (ID: ${targetMsg.id})`);
    } else {
      const sent = await channel.send({ embeds: [embed] });
      livePredictionMessageId = sent.id;
      console.log(`[prediction] 🚀 Posted initial live prediction display in channel <#${predictionChannelId}> (ID: ${sent.id})`);
    }

    savePredictionState({ messageId: livePredictionMessageId });
  } catch (err) {
    console.error('[prediction] Failed to update prediction channel:', err.message);
  } finally {
    isUpdatingPrediction = false;
    if (pendingPredictionUpdate) {
      pendingPredictionUpdate = false;
      setImmediate(updatePredictionChannel);
    }
  }
}

// ── Rift Banner Dedicated Channel (1550149335088496755) ──────
let riftBannerChannelId     = process.env.RIFT_BANNER_CHANNEL_ID || '1550149335088496755';
let liveBannerMessageId     = null;
const BANNER_STATE_FILE     = dataPath('banner-state.json');

function loadBannerState() {
  try {
    if (fs.existsSync(BANNER_STATE_FILE)) {
      const data = JSON.parse(fs.readFileSync(BANNER_STATE_FILE, 'utf8'));
      if (data && data.messageId) {
        liveBannerMessageId = data.messageId;
      }
      if (data && data.bannerName) {
        currentActiveBanner = data.bannerName;
      }
    }
  } catch (err) {
    console.error('[banner] Error loading state:', err.message);
  }
}

function saveBannerState(state) {
  try {
    fs.writeFileSync(BANNER_STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.error('[banner] Error saving state:', err.message);
  }
}

loadBannerState();

let isUpdatingBanner = false;
let pendingBannerUpdate = false;

/**
 * Post or update the live Rift Banner display in dedicated channel (1550149335088496755).
 * Strictly edits the existing message in-place on all updates to prevent channel flooding.
 */
async function updateBannerChannel({ bannerName, requiredPets, details, timeRemaining, jobId } = {}) {
  if (!riftBannerChannelId) return;

  if (isUpdatingBanner) {
    pendingBannerUpdate = true;
    return;
  }
  isUpdatingBanner = true;

  const targetBanner = bannerName || currentActiveBanner || 'Riftborn';
  const isNewBanner = Boolean(
    bannerName &&
    currentActiveBanner &&
    currentActiveBanner.toLowerCase().trim() !== bannerName.toLowerCase().trim()
  );
  currentActiveBanner = targetBanner;

  const bannerRoleId = getRoleForBanner(targetBanner);
  const rolePing = bannerRoleId ? `<@&${bannerRoleId}>` : '';

  try {
    const channel = await getChannel(riftBannerChannelId);
    if (!channel) {
      console.warn(`[banner] Channel ${riftBannerChannelId} not found or inaccessible.`);
      return;
    }

    const embed = buildBannerEmbed({
      bannerName: targetBanner,
      requiredPets,
      details,
      timeRemaining,
      jobId,
    });

    let targetMsg = null;
    if (liveBannerMessageId) {
      targetMsg = await channel.messages.fetch(liveBannerMessageId).catch(() => null);
    }

    if (!targetMsg) {
      const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
      const botMessages = recent ? Array.from(recent.values()).filter((m) => m.author.id === client.user.id) : [];
      if (botMessages.length > 0) {
        targetMsg = botMessages[0];
      }
    }

    const header = rolePing
      ? `${rolePing} 📜 **ACTIVE RIFT BANNER: ${targetBanner}**`
      : `📜 **ACTIVE RIFT BANNER: ${targetBanner}**`;

    // Strictly edit in-place whenever a message already exists
    if (targetMsg) {
      await targetMsg.edit({ content: header || undefined, embeds: [embed] });
      liveBannerMessageId = targetMsg.id;
      console.log(`[banner] 🔄 Edited Rift Banner in-place in channel <#${riftBannerChannelId}> (ID: ${targetMsg.id})`);
    } else {
      const sent = await channel.send({ content: header || undefined, embeds: [embed] });
      liveBannerMessageId = sent.id;
      console.log(`[banner] 🚀 Posted initial Rift Banner in channel <#${riftBannerChannelId}> (ID: ${sent.id})`);
    }

    // Also announce in main notification channel if a new banner dropped
    if (isNewBanner && notifyChannelId && notifyChannelId !== riftBannerChannelId) {
      const mainChan = await getChannel(notifyChannelId);
      if (mainChan) {
        const announceHeader = rolePing
          ? `${rolePing} 📜 **NEW RIFT BANNER DROPPED: ${targetBanner}!**`
          : `📜 **NEW RIFT BANNER DROPPED: ${targetBanner}!**`;
        await mainChan.send({ content: announceHeader, embeds: [embed] }).catch(() => {});
      }
    }

    saveBannerState({ messageId: liveBannerMessageId, bannerName: targetBanner });
  } catch (err) {
    console.error('[banner] Failed to update banner channel:', err.message);
  } finally {
    isUpdatingBanner = false;
    if (pendingBannerUpdate) {
      pendingBannerUpdate = false;
      setImmediate(updateBannerChannel);
    }
  }
}

// ── Dedicated Bot & Scanner Status Channel (1550494247784947772) ──────
let statusChannelId       = process.env.STATUS_CHANNEL_ID || '1550494247784947772';
let liveStatusMessageId   = null;
const STATUS_STATE_FILE   = dataPath('bot-status-state.json');

function loadStatusState() {
  try {
    if (fs.existsSync(STATUS_STATE_FILE)) {
      const data = JSON.parse(fs.readFileSync(STATUS_STATE_FILE, 'utf8'));
      if (data && data.messageId) {
        liveStatusMessageId = data.messageId;
      }
    }
  } catch (err) {
    console.error('[status] Error loading state:', err.message);
  }
}

function saveStatusState(state) {
  try {
    fs.writeFileSync(STATUS_STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.error('[status] Error saving state:', err.message);
  }
}

loadStatusState();

// Active scanner client tracking
const activeScanners = new Map();
const SCANNER_TIMEOUT_MS = 90_000; // 90 seconds timeout (heartbeats arrive every 30s)

function pruneActiveScanners() {
  const now = Date.now();
  for (const [clientId, info] of activeScanners.entries()) {
    if (now - info.lastSeen > SCANNER_TIMEOUT_MS) {
      activeScanners.delete(clientId);
    }
  }
  return activeScanners.size;
}

function registerScannerClient(clientId, { jobId, version } = {}) {
  if (!clientId) return activeScanners.size;
  activeScanners.set(clientId, {
    lastSeen: Date.now(),
    jobId: jobId || null,
    version: version || '3.5',
  });
  return pruneActiveScanners();
}

function unregisterScannerClient(clientId) {
  if (!clientId) return activeScanners.size;
  activeScanners.delete(clientId);
  return pruneActiveScanners();
}

let cachedBotUpdateInfo = null;
function getBotUpdateInfo() {
  if (cachedBotUpdateInfo) return cachedBotUpdateInfo;

  let commitUnix = null;
  let commitHash = null;
  let commitMsg = null;

  try {
    const { execFileSync } = require('child_process');
    const out = execFileSync('git', ['log', '-1', '--format=%ct|%h|%s'], {
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (out) {
      const parts = out.split('|');
      commitUnix = parseInt(parts[0], 10);
      commitHash = parts[1] || null;
      commitMsg = parts[2] || null;
    }
  } catch (_) {}

  if (!commitUnix || isNaN(commitUnix)) {
    try {
      const stat = fs.statSync(__filename);
      commitUnix = Math.floor(stat.mtimeMs / 1000);
    } catch (_) {
      commitUnix = Math.floor(Date.now() / 1000);
    }
  }

  cachedBotUpdateInfo = { commitUnix, commitHash, commitMsg };
  return cachedBotUpdateInfo;
}

let isUpdatingStatus = false;
let pendingStatusUpdate = false;

/**
 * Post or update the live Bot & Scanner Status in dedicated channel (1550494247784947772).
 * Strictly edits / replaces the existing message to avoid channel flooding.
 */
async function updateStatusChannel() {
  if (!statusChannelId) return;

  if (isUpdatingStatus) {
    pendingStatusUpdate = true;
    return;
  }
  isUpdatingStatus = true;

  try {
    const channel = await getChannel(statusChannelId);
    if (!channel) {
      console.warn(`[status] Channel ${statusChannelId} not found or inaccessible.`);
      return;
    }

    const activeUsers = pruneActiveScanners();
    const { commitUnix, commitHash } = getBotUpdateInfo();

    let gameData = null;
    try {
      gameData = await getGameDetails();
    } catch (_) {}

    const ping = client?.ws?.ping >= 0 ? client.ws.ping : null;

    let prediction = null;
    let recentSpawns = [];
    try {
      prediction = predictor.getPrediction(currentActiveBanner);
      recentSpawns = predictor.loadHistory().slice(-3);
    } catch (_) {}

    const embed = buildLiveStatusEmbed({
      activeUsers,
      botStartTime,
      botUpdatedUnix: commitUnix,
      commitHash,
      gameData,
      ping,
      currentBanner: currentActiveBanner,
      prediction,
      recentSpawns,
    });

    let targetMsg = null;
    if (liveStatusMessageId) {
      targetMsg = await channel.messages.fetch(liveStatusMessageId).catch(() => null);
    }

    // Sweep recent messages in the channel to locate existing message and purge any accidental duplicates
    const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
    const botMessages = recent ? Array.from(recent.values()).filter((m) => m.author.id === client.user.id) : [];

    if (!targetMsg && botMessages.length > 0) {
      targetMsg = botMessages[0];
    }

    // If more than 1 bot message exists in the dedicated channel, purge duplicates immediately
    if (botMessages.length > 1) {
      for (const msg of botMessages) {
        if (targetMsg && msg.id !== targetMsg.id) {
          msg.delete().catch(() => {});
        }
      }
    }

    if (targetMsg) {
      await targetMsg.edit({ embeds: [embed] });
      liveStatusMessageId = targetMsg.id;
      console.log(`[status] 🔄 Edited live status message in-place in channel <#${statusChannelId}> (ID: ${targetMsg.id}) - Active users: ${activeUsers}`);
    } else {
      const sent = await channel.send({ embeds: [embed] });
      liveStatusMessageId = sent.id;
      console.log(`[status] 🚀 Posted initial live status display in channel <#${statusChannelId}> (ID: ${sent.id})`);
    }

    saveStatusState({ messageId: liveStatusMessageId });
  } catch (err) {
    console.error('[status] Failed to update status channel:', err.message);
  } finally {
    isUpdatingStatus = false;
    if (pendingStatusUpdate) {
      pendingStatusUpdate = false;
      setImmediate(updateStatusChannel);
    }
  }
}

/** Setter injected into the /setchannel command. */
function setNotifyChannel(id) {
  notifyChannelId = id;
  console.log(`[config] Notification channel set → ${id}`);
}

// ── Role Picker & Auto-Role Configuration ─────────────────────
const ROLE_CHANNEL_ID       = process.env.ROLE_CHANNEL_ID       || '1550142026941599744';
const SECRET_ROLE_ID        = process.env.SECRET_ROLE_ID        || '1550146335045324960';
const ETERNAL_ROLE_ID       = process.env.ETERNAL_ROLE_ID       || '1550146424027615272';
const DIVINE_ROLE_ID        = process.env.DIVINE_ROLE_ID        || '1550146470752030760';
const AUTOROLE_ID           = process.env.AUTOROLE_ID           || '1550146592676380794';

const RIFTBORN_ROLE_ID       = process.env.RIFTBORN_ROLE_ID       || '1550479648549245018';
const RIFTBEAST_ROLE_ID      = process.env.RIFTBEAST_ROLE_ID      || '1550479705675665478';
const SHATTERED_RIFT_ROLE_ID = process.env.SHATTERED_RIFT_ROLE_ID || '1550479734134276217';
const RIFT_BOSS_ROLE_ID      = process.env.RIFT_BOSS_ROLE_ID      || '1550485553156333618';

function getRoleForBanner(bannerName) {
  if (!bannerName) return null;
  const lower = bannerName.toLowerCase().trim();
  if (lower.includes('shattered')) return SHATTERED_RIFT_ROLE_ID;
  if (lower.includes('beast')) return RIFTBEAST_ROLE_ID;
  if (lower.includes('born')) return RIFTBORN_ROLE_ID;
  return null;
}

const BUTTON_ROLE_MAP = {
  role_secret:         SECRET_ROLE_ID,
  role_eternal:        ETERNAL_ROLE_ID,
  role_divine:         DIVINE_ROLE_ID,
  role_riftborn:       RIFTBORN_ROLE_ID,
  role_riftbeast:      RIFTBEAST_ROLE_ID,
  role_shattered_rift: SHATTERED_RIFT_ROLE_ID,
  role_rift_boss:      RIFT_BOSS_ROLE_ID,
};

const EMOJI_ROLE_MAP = {
  '🔮': SECRET_ROLE_ID,
  '💎': ETERNAL_ROLE_ID,
  '👑': DIVINE_ROLE_ID,
  '🌌': RIFTBORN_ROLE_ID,
  '🐺': RIFTBEAST_ROLE_ID,
  '⚡': SHATTERED_RIFT_ROLE_ID,
  '🌀': RIFT_BOSS_ROLE_ID,
};

let liveRolePickerMessageId = null;
const ROLE_PICKER_STATE_FILE = dataPath('role-picker-state.json');

function loadRolePickerState() {
  try {
    if (fs.existsSync(ROLE_PICKER_STATE_FILE)) {
      const data = JSON.parse(fs.readFileSync(ROLE_PICKER_STATE_FILE, 'utf8'));
      if (data && data.messageId) {
        liveRolePickerMessageId = data.messageId;
      }
    }
  } catch (err) {
    console.error('[roles] Error loading state:', err.message);
  }
}

function saveRolePickerState(state) {
  try {
    fs.writeFileSync(ROLE_PICKER_STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.error('[roles] Error saving state:', err.message);
  }
}

loadRolePickerState();

/**
 * Initialize or refresh the "Pick a Role" selection message in channel 1550142026941599744.
 * Includes interactive buttons and emoji reactions for all 7 roles.
 */
async function initRolePickerChannel() {
  if (!ROLE_CHANNEL_ID) return;

  try {
    const channel = await getChannel(ROLE_CHANNEL_ID);
    if (!channel) {
      console.warn(`[roles] Channel ${ROLE_CHANNEL_ID} not found or inaccessible.`);
      return;
    }

    const embed = buildRolePickerEmbed({
      secretRoleId:        SECRET_ROLE_ID,
      eternalRoleId:       ETERNAL_ROLE_ID,
      divineRoleId:        DIVINE_ROLE_ID,
      riftbornRoleId:      RIFTBORN_ROLE_ID,
      riftbeastRoleId:     RIFTBEAST_ROLE_ID,
      shatteredRiftRoleId: SHATTERED_RIFT_ROLE_ID,
      riftBossRoleId:      RIFT_BOSS_ROLE_ID,
    });

    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('role_secret')
        .setLabel('Secret')
        .setEmoji('🔮')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('role_eternal')
        .setLabel('Eternal')
        .setEmoji('💎')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('role_divine')
        .setLabel('Divine')
        .setEmoji('👑')
        .setStyle(ButtonStyle.Secondary),
    );

    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('role_riftborn')
        .setLabel('Riftborn')
        .setEmoji('🌌')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('role_riftbeast')
        .setLabel('Riftbeast')
        .setEmoji('🐺')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('role_shattered_rift')
        .setLabel('Shattered Rift')
        .setEmoji('⚡')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('role_rift_boss')
        .setLabel('Rift Boss')
        .setEmoji('🌀')
        .setStyle(ButtonStyle.Danger),
    );

    let targetMsg = null;
    if (liveRolePickerMessageId) {
      targetMsg = await channel.messages.fetch(liveRolePickerMessageId).catch(() => null);
    }

    if (!targetMsg) {
      const recent = await channel.messages.fetch({ limit: 20 }).catch(() => null);
      const botMessages = recent ? Array.from(recent.values()).filter((m) => m.author.id === client.user.id) : [];
      if (botMessages.length > 0) {
        targetMsg = botMessages[0];
      }
    }

    if (targetMsg) {
      await targetMsg.edit({ embeds: [embed], components: [row1, row2] });
      liveRolePickerMessageId = targetMsg.id;
      console.log(`[roles] 🔄 Updated role picker message in <#${ROLE_CHANNEL_ID}> (${targetMsg.id})`);
    } else {
      const sent = await channel.send({ embeds: [embed], components: [row1, row2] });
      targetMsg = sent;
      liveRolePickerMessageId = sent.id;
      console.log(`[roles] 🚀 Posted new role picker message in <#${ROLE_CHANNEL_ID}> (${sent.id})`);
    }

    saveRolePickerState({ messageId: liveRolePickerMessageId });

    // Ensure default reactions are present for all 7 roles (only add if missing)
    const requiredEmojis = ['🔮', '💎', '👑', '🌌', '🐺', '⚡', '🌀'];
    for (const emoji of requiredEmojis) {
      try {
        if (!targetMsg.reactions?.cache?.has(emoji)) {
          await targetMsg.react(emoji);
        }
      } catch (reactErr) {
        console.warn(`[roles] ⚠️ Could not pre-add reaction ${emoji} (check channel permissions): ${reactErr.message}`);
      }
    }
  } catch (err) {
    console.error('[roles] ⚠️ Error initializing role picker channel:', err.message);
    if (err.code === 50013 || err.message?.includes('Missing Permissions')) {
      console.warn(`[roles] 💡 Bot needs "Send Messages", "Embed Links", and "Add Reactions" permissions in channel #${ROLE_CHANNEL_ID}`);
    }
  }
}

// ═════════════════════════════════════════════════════════════
//  2.  DISCORD CLIENT
// ═════════════════════════════════════════════════════════════
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction,
  ],
});

/**
 * Helper: Resolve a Discord channel from cache first, then REST fetch.
 * Drastically reduces REST API requests and avoids Discord rate limits.
 */
async function getChannel(channelId) {
  if (!channelId) return null;
  return client.channels.cache.get(channelId) || await client.channels.fetch(channelId).catch(() => null);
}

// ── Load slash commands ──────────────────────────────────────
client.commands = new Collection();
const cmdDir = path.join(__dirname, 'commands');

for (const file of fs.readdirSync(cmdDir).filter((f) => f.endsWith('.js'))) {
  const cmd = require(path.join(cmdDir, file));
  client.commands.set(cmd.data.name, cmd);
}

// ── Handle interactions (Slash commands & Role buttons) ──────
client.on('interactionCreate', async (interaction) => {
  // ── Handle Role Picker Button Clicks ────────────────────────
  if (interaction.isButton()) {
    const roleId = BUTTON_ROLE_MAP[interaction.customId];
    if (!roleId) return;

    // Immediately acknowledge to Discord to prevent "didn't respond in time"
    await interaction.deferReply({ ephemeral: true }).catch(() => {});

    try {
      let member = interaction.member;
      if (!member || typeof member.roles?.add !== 'function') {
        member = await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);
      }

      if (!member) {
        return interaction.editReply({ content: '❌ Could not resolve member details.' });
      }

      const hasRole = member.roles.cache ? member.roles.cache.has(roleId) : false;

      if (hasRole) {
        await member.roles.remove(roleId);
        console.log(`[roles] 🗑️ Removed role ${roleId} from ${interaction.user.tag} via button`);
        return interaction.editReply({
          content: `🗑️ Removed the <@&${roleId}> role!`,
        });
      } else {
        await member.roles.add(roleId);
        console.log(`[roles] ✅ Added role ${roleId} to ${interaction.user.tag} via button`);
        return interaction.editReply({
          content: `✅ Added the <@&${roleId}> role!`,
        });
      }
    } catch (err) {
      console.error(`[roles] ❌ Error modifying role ${roleId} for ${interaction.user.tag}:`, err.message);
      return interaction.editReply({
        content: `❌ Could not modify role: **${err.message}**\n*(Server admin: verify bot has "Manage Roles" permission and its role is positioned above this role).*`,
      });
    }
  }

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

// ── Reaction Roles: Add ───────────────────────────────────────
client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;

  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch (err) {
      console.error('[roles] Failed to fetch partial reaction:', err.message);
      return;
    }
  }

  if (reaction.message.channelId !== ROLE_CHANNEL_ID) return;
  if (liveRolePickerMessageId && reaction.message.id !== liveRolePickerMessageId) return;

  const emojiName = reaction.emoji.name;
  const roleId = EMOJI_ROLE_MAP[emojiName];
  if (!roleId) return;

  try {
    const guild = reaction.message.guild;
    if (!guild) return;

    const member = guild.members.cache.get(user.id) || await guild.members.fetch(user.id).catch(() => null);
    if (!member) return;

    if (!member.roles.cache.has(roleId)) {
      await member.roles.add(roleId);
      console.log(`[roles] ✅ Added role <@&${roleId}> to ${user.tag} (reacted ${emojiName})`);
    }
  } catch (err) {
    console.error(`[roles] ❌ Error adding role ${roleId} to ${user.tag}:`, err.message);
  }
});

// ── Reaction Roles: Remove ────────────────────────────────────
client.on('messageReactionRemove', async (reaction, user) => {
  if (user.bot) return;

  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch (err) {
      console.error('[roles] Failed to fetch partial reaction:', err.message);
      return;
    }
  }

  if (reaction.message.channelId !== ROLE_CHANNEL_ID) return;
  if (liveRolePickerMessageId && reaction.message.id !== liveRolePickerMessageId) return;

  const emojiName = reaction.emoji.name;
  const roleId = EMOJI_ROLE_MAP[emojiName];
  if (!roleId) return;

  try {
    const guild = reaction.message.guild;
    if (!guild) return;

    const member = guild.members.cache.get(user.id) || await guild.members.fetch(user.id).catch(() => null);
    if (!member) return;

    if (member.roles.cache.has(roleId)) {
      await member.roles.remove(roleId);
      console.log(`[roles] 🗑️ Removed role <@&${roleId}> from ${user.tag} (unreacted ${emojiName})`);
    }
  } catch (err) {
    console.error(`[roles] ❌ Error removing role ${roleId} from ${user.tag}:`, err.message);
  }
});

// ── Auto-role for New Members ─────────────────────────────────
client.on('guildMemberAdd', async (member) => {
  if (!AUTOROLE_ID) return;

  try {
    console.log(`[autorole] 👤 New member joined: ${member.user.tag} (${member.id})`);
    const role = member.guild.roles.cache.get(AUTOROLE_ID) || await member.guild.roles.fetch(AUTOROLE_ID).catch(() => null);
    if (!role) {
      console.warn(`[autorole] ⚠️ Auto-role ${AUTOROLE_ID} not found in guild.`);
      return;
    }

    await member.roles.add(role);
    console.log(`[autorole] ✅ Assigned "${role.name}" (${role.id}) to new member ${member.user.tag}`);
  } catch (err) {
    console.error(`[autorole] ❌ Failed to auto-assign role to ${member.user.tag}:`, err.message);
    if (err.code === 50013 || err.message?.includes('Missing Permissions')) {
      console.warn('[autorole] 👉 Ensure the bot has "Manage Roles" permission and its role is above the auto-role!');
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

      const channel = await getChannel(notifyChannelId);
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
  const channel = await getChannel(notifyChannelId);
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

  const targetChannelId = riftBossChannelId || notifyChannelId;
  let channel = await getChannel(targetChannelId);
  if (!channel && targetChannelId !== notifyChannelId) {
    console.warn(`[webhook/boss] Channel ${targetChannelId} not accessible, falling back to notification channel ${notifyChannelId}`);
    channel = await getChannel(notifyChannelId);
  }
  if (!channel) throw new Error(`Rift Boss notification channel (${targetChannelId}) not available.`);

  const embed    = buildRiftBossEmbed({ bossName: boss, biome: targetBiome, health, timeLimit, image, timestamp: now });
  const rolePing = RIFT_BOSS_ROLE_ID ? `<@&${RIFT_BOSS_ROLE_ID}>` : (EGG_ROLE_ID ? `<@&${EGG_ROLE_ID}>` : '');
  const header   = `${rolePing} 🌀 ⚔️ **RIFT BOSS SPAWNED:** **${boss}** in **${targetBiome}**! • Spawned <t:${Math.floor(now / 1000)}:R>`;

  await channel.send({ content: header, embeds: [embed] });
  console.log(`[webhook/boss] 🌀 Sent Rift Boss alert to channel <#${channel.id}>`);
  return true;
}

// Rift Boss alert endpoints
app.post('/api/notify-boss', async (req, res) => {
  const { bossName, biome, health, timeLimit, image, jobId, clientId } = req.body ?? {};

  if (clientId) {
    registerScannerClient(clientId, { jobId });
  }

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

// Scanner client heartbeat endpoint (called every 30s by active in-game scanners)
app.post('/api/scanner-heartbeat', (req, res) => {
  const { clientId, jobId, version } = req.body ?? {};
  if (!clientId) {
    return res.status(400).json({ error: 'Missing required field: clientId' });
  }

  const prevCount = activeScanners.size;
  const newCount = registerScannerClient(clientId, { jobId, version });

  if (newCount !== prevCount) {
    updateStatusChannel().catch((err) => console.error('[status] Heartbeat update error:', err.message));
  }

  return res.status(200).json({ ok: true, activeUsers: newCount });
});

// Scanner client connected/ready alert endpoint
app.post('/api/notify-ready', async (req, res) => {
  const { jobId, clientId, version } = req.body ?? {};

  if (clientId) {
    registerScannerClient(clientId, { jobId, version });
  }

  try {
    const channel = await getChannel(notifyChannelId);
    if (!channel) throw new Error('Notification channel not available.');

    const embed  = buildScannerReadyEmbed({ jobId });
    const header = '🚀 **SCANNER EXECUTED:** In-game scanner is now online and scanning!';

    await channel.send({ content: header, embeds: [embed] });

    // Live update predictions and bot status in dedicated channels
    updatePredictionChannel().catch((err) => console.error('[prediction] Ready update error:', err.message));
    updateStatusChannel().catch((err) => console.error('[status] Ready update error:', err.message));

    return res.status(200).json({ ok: true, message: 'Ready alert sent.' });
  } catch (err) {
    console.error('[webhook/ready] Error:', err.message);
    return res.status(500).json({ error: err.message || 'Failed to send alert.' });
  }
});

// Scanner client disconnected/offline alert endpoint
app.post('/api/notify-offline', async (req, res) => {
  const { jobId, clientId } = req.body ?? {};

  if (clientId) {
    unregisterScannerClient(clientId);
  }

  try {
    const channel = await getChannel(notifyChannelId);
    if (!channel) throw new Error('Notification channel not available.');

    const embed  = buildScannerOfflineEmbed({ jobId });
    const header = '⚠️ **SCANNER OFFLINE:** In-game scanner has disconnected or player left the game.';

    await channel.send({ content: header, embeds: [embed] });

    // Live update bot status immediately on scanner disconnect
    updateStatusChannel().catch((err) => console.error('[status] Offline update error:', err.message));

    return res.status(200).json({ ok: true, message: 'Offline alert sent.' });
  } catch (err) {
    console.error('[webhook/offline] Error:', err.message);
    return res.status(500).json({ error: err.message || 'Failed to send alert.' });
  }
});

// Rift Machine Banner alert endpoint — updates in-place in dedicated channel (1550149335088496755)
app.post('/api/notify-banner', async (req, res) => {
  const { bannerName, requiredPets, details, timeRemaining, jobId, clientId } = req.body ?? {};

  if (clientId) {
    registerScannerClient(clientId, { jobId });
  }

  if (!bannerName) {
    return res.status(400).json({ error: 'Missing required field: bannerName' });
  }

  currentActiveBanner = bannerName;

  try {
    // Strictly edits in place in channel 1550149335088496755 (zero channel flooding)
    await updateBannerChannel({ bannerName, requiredPets, details, timeRemaining, jobId });

    // Live update predictions in dedicated channel if banner changes
    updatePredictionChannel().catch((err) => console.error('[prediction] Banner update error:', err.message));

    return res.status(200).json({ ok: true, message: 'Banner updated in dedicated channel.' });
  } catch (err) {
    console.error('[webhook/banner] Error:', err.message);
    return res.status(500).json({ error: err.message || 'Failed to update banner.' });
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
    clientId,
    image,
    type,
    isBoss,
    health,
    timeLimit,
    isBannerEgg,
    bannerName,
    requiredForPet,
  } = req.body ?? {};

  if (clientId) {
    registerScannerClient(clientId, { jobId });
  }

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

  const rawEggName = String(eggName).trim();
  const lowerName = rawEggName.toLowerCase();
  const lowerRarity = String(rarity || '').toLowerCase().trim();

  // Guard against system, scanner, or banner events hitting this endpoint
  const isSystemAlert =
    lowerRarity === 'system' ||
    lowerName.includes('scanner') ||
    lowerName.startsWith('banner:') ||
    lowerName === 'ready' ||
    lowerName === 'offline';

  if (isSystemAlert) {
    console.log(`[webhook/egg] ℹ️ System/scanner alert acknowledged on /api/notify-egg: "${rawEggName}"`);
    return res.status(200).json({ ok: true, message: 'System event acknowledged.' });
  }

  // Auto-match against egg database for canonical enrichment
  const dbMatch = findEgg(rawEggName);
  const canonicalName = dbMatch?.name || rawEggName.replace(/\s+egg$/i, '').trim();
  const finalRarity = rarity  || dbMatch?.rarity || 'Unknown';
  const finalBiome  = biome   || dbMatch?.biome  || 'Unknown';

  // Server-side egg deduplication (15s lockout) using canonical egg name
  const dedupeKey = `${canonicalName.toLowerCase()}_${(finalBiome || '').toLowerCase().trim()}`;
  const now = Date.now();

  // Clean stale dedupe entries to prevent memory accumulation over time
  if (recentEggAlerts.size > 50) {
    for (const [k, t] of recentEggAlerts.entries()) {
      if (now - t > EGG_DEDUPE_MS * 4) {
        recentEggAlerts.delete(k);
      }
    }
  }

  if (recentEggAlerts.has(dedupeKey) && (now - recentEggAlerts.get(dedupeKey) < EGG_DEDUPE_MS)) {
    console.log(`[webhook/egg] ⏳ Duplicate egg alert suppressed: "${canonicalName}" in "${finalBiome}"`);
    return res.status(200).json({ ok: true, suppressed: true, message: 'Duplicate egg alert suppressed.' });
  }
  recentEggAlerts.set(dedupeKey, now);

  // Feed canonical egg into global AI predictor
  predictor.recordSpawn({
    eggName: canonicalName,
    rarity: finalRarity,
    biome: finalBiome,
    timestamp: now,
    isBannerEgg,
    bannerName: bannerName || currentActiveBanner,
  });

  // Live update prediction channel whenever an egg spawns
  updatePredictionChannel().catch((err) => console.error('[prediction] Spawn update error:', err.message));

  try {
    const channel = await getChannel(notifyChannelId);
    if (!channel) {
      return res.status(503).json({ error: 'Notification channel not available.' });
    }

    const displayEggName = canonicalName.endsWith('Egg') ? canonicalName : `${canonicalName} Egg`;

    const embed = buildEggSpawnEmbed({
      eggName: displayEggName,
      rarity: finalRarity,
      biome:  finalBiome,
      jobId,
      image,
      isBannerEgg,
      bannerName,
      requiredForPet,
      timestamp: now,
    });

    // Mention the specific egg rarity role instead of generic role
    let targetRoleId = null;
    const lowerFinalRarity = (finalRarity || '').toLowerCase();
    if (lowerFinalRarity === 'divine') {
      targetRoleId = DIVINE_ROLE_ID;
    } else if (lowerFinalRarity === 'eternal') {
      targetRoleId = ETERNAL_ROLE_ID;
    } else if (lowerFinalRarity === 'secret') {
      targetRoleId = SECRET_ROLE_ID;
    } else {
      targetRoleId = EGG_ROLE_ID;
    }

    const rolePing = targetRoleId ? `<@&${targetRoleId}>` : (EGG_ROLE_ID ? `<@&${EGG_ROLE_ID}>` : '');
    const bannerBadge = bannerName
      ? (requiredForPet ? `⭐ **[SACRIFICE EGG: ${bannerName}]** ` : `⭐ **[BANNER EGG: ${bannerName}]** `)
      : '';
    const header   = `${rolePing} ${bannerBadge}🚨 **${String(finalRarity).toUpperCase()} EGG:** **${displayEggName}** in **${finalBiome}**! • Spawned <t:${Math.floor(now / 1000)}:R>`;

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
  console.log(`   Prediction channel   : ${predictionChannelId}`);
  console.log(`   Rift banner channel  : ${riftBannerChannelId}`);
  console.log(`   Status channel       : ${statusChannelId}`);
  console.log(`   Role picker channel  : ${ROLE_CHANNEL_ID}`);
  console.log(`   Alert role           : ${EGG_ROLE_ID ?? '(none)'}`);
  console.log(`   Rift boss role       : ${RIFT_BOSS_ROLE_ID}`);
  console.log(`   Auto-role (members)  : ${AUTOROLE_ID}`);
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

    // Periodic live prediction countdown tick (every 60s) to keep time and top 10 fresh
    setInterval(() => {
      updatePredictionChannel().catch(() => {});
    }, 60_000);

    // Initial Rift Banner display in dedicated channel (1550149335088496755)
    updateBannerChannel().catch((err) => console.error('[banner] Startup update error:', err.message));

    // Initial live status display in dedicated channel (1550494247784947772)
    updateStatusChannel().catch((err) => console.error('[status] Startup update error:', err.message));

    // Periodic live status update tick (every 60s) to keep uptime, active users, and game stats fresh
    setInterval(() => {
      updateStatusChannel().catch(() => {});
    }, 60_000);

    // Initial role picker setup / verification in role channel
    initRolePickerChannel().catch((err) => console.error('[roles] Startup update error:', err.message));
  });
});

client.login(process.env.DISCORD_TOKEN);
