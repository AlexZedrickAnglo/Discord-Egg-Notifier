// ──────────────────────────────────────────────────────────────
// utils/notifier.js — Discord embed builders for Steal An Egg
// ──────────────────────────────────────────────────────────────
const { EmbedBuilder } = require('discord.js');

const PLACE_ID = '107778070777162';

// ─── Rarity → Embed colour (as specified) ────────────────────
const RARITY_COLORS = {
  divine:  0xFFD700, // Gold
  eternal: 0x00FFFF, // Cyan
  secret:  0xFF0055, // Crimson
};

// ─── Rarity → Emoji prefix ──────────────────────────────────
const RARITY_EMOJI = {
  divine:  '👑',
  eternal: '💎',
  secret:  '🔮',
};

/**
 * Look up a colour for a rarity string (case-insensitive).
 */
function colorForRarity(rarity) {
  return RARITY_COLORS[rarity?.toLowerCase()] ?? 0x5865F2;
}

/**
 * Build a "Egg Spawn Alert" embed from a webhook payload.
 * Includes a Roblox deep-join link using the jobId.
 */
function buildEggSpawnEmbed({ eggName, rarity, biome, jobId, image, isBannerEgg, bannerName, requiredForPet, timestamp }) {
  const emoji   = RARITY_EMOJI[rarity?.toLowerCase()] ?? '🥚';
  const color   = (isBannerEgg || bannerName) ? 0x9B59B6 : colorForRarity(rarity);

  const titlePrefix = bannerName ? '⭐ BANNER EGG — ' : '';
  const spawnUnix = Math.floor((timestamp || Date.now()) / 1000);

  const embed = new EmbedBuilder()
    .setTitle(`${emoji}  ${titlePrefix}${(rarity ?? 'RARE').toUpperCase()} EGG SPAWNED — ${eggName}`)
    .setColor(color)
    .setDescription(
      `# 🕒 <t:${spawnUnix}:T>\n` +
      `### ⏳ Spawned <t:${spawnUnix}:R>\n\n` +
      `A **${rarity ?? 'rare'}** egg has appeared in **${biome ?? 'the world'}**!`
    )
    .addFields(
      { name: '🥚 Egg',        value: `**${eggName}**`,                    inline: true },
      { name: '✨ Rarity',     value: rarity ?? 'Unknown',                 inline: true },
      { name: '🌍 Biome',      value: biome  ?? 'Unknown',                 inline: true },
      { name: '⏳ Spawned',    value: `<t:${spawnUnix}:R>`,                inline: true },
      { name: '🕒 Exact Time', value: `<t:${spawnUnix}:T>`,                inline: true },
    )
    .setFooter({ text: 'Steal An Egg Notifier • Egg Spawn Alert' })
    .setTimestamp(new Date(spawnUnix * 1000));

  if (bannerName) {
    const bannerDesc = requiredForPet
      ? `🥩 **Sacrifice Match:** This egg hatches **${requiredForPet}**, which is required for the active **${bannerName}** banner sacrifice!`
      : `📜 **Banner Pool:** This egg is part of the active **${bannerName}** banner!`;
    embed.addFields({ name: '⭐ Active Rift Banner Match', value: bannerDesc, inline: false });
  }

  if (image) {
    embed.setThumbnail(image);
  }

  return embed;
}

/**
 * Build a "Game Updated" embed.
 */
function buildUpdateEmbed(gameData) {
  const updatedUnix = Math.floor(new Date(gameData.updated).getTime() / 1000);

  return new EmbedBuilder()
    .setTitle('🔄  Steal An Egg — Game Updated!')
    .setColor(0x57F287)
    .setDescription('A new game update has been published.')
    .addFields(
      { name: '🎮 Playing',  value: `${gameData.playing?.toLocaleString() ?? '—'}`, inline: true },
      { name: '👀 Visits',   value: `${gameData.visits?.toLocaleString() ?? '—'}`,  inline: true },
      { name: '🕐 Updated',  value: `<t:${updatedUnix}:R>`,                         inline: true },
    )
    .setFooter({ text: 'Steal An Egg Notifier' })
    .setTimestamp();
}

/**
 * Build a "/checkegg" lookup embed.
 */
function buildEggLookupEmbed({ name, rarity, biome }) {
  const emoji = RARITY_EMOJI[rarity?.toLowerCase()] ?? '🥚';
  const color = colorForRarity(rarity);

  return new EmbedBuilder()
    .setTitle(`${emoji}  ${name}`)
    .setColor(color)
    .addFields(
      { name: '✨ Rarity', value: rarity, inline: true },
      { name: '🌍 Biome',  value: biome,  inline: true },
    )
    .setFooter({ text: 'Steal An Egg Notifier • Egg Database' })
    .setTimestamp();
}

/**
 * Build a "/status" embed showing bot uptime and game stats.
 */
function buildStatusEmbed(gameData, botStartTime) {
  const uptimeSeconds = Math.floor((Date.now() - botStartTime) / 1000);
  const hours   = Math.floor(uptimeSeconds / 3600);
  const minutes = Math.floor((uptimeSeconds % 3600) / 60);
  const seconds = uptimeSeconds % 60;
  const uptimeStr = `${hours}h ${minutes}m ${seconds}s`;

  const updatedUnix = gameData
    ? Math.floor(new Date(gameData.updated).getTime() / 1000)
    : null;

  const embed = new EmbedBuilder()
    .setTitle('📊  Steal An Egg — Bot Status')
    .setColor(0x5865F2)
    .addFields(
      { name: '🤖 Uptime',        value: uptimeStr,   inline: true },
      { name: '🎯 Monitored Place', value: `\`${PLACE_ID}\``, inline: true },
    )
    .setFooter({ text: 'Steal An Egg Notifier' })
    .setTimestamp();

  if (gameData) {
    embed.addFields(
      { name: '🎮 Playing Now',  value: `${gameData.playing?.toLocaleString() ?? '—'}`,        inline: true },
      { name: '👀 Total Visits', value: `${gameData.visits?.toLocaleString() ?? '—'}`,         inline: true },
      { name: '❤️ Favourites',   value: `${gameData.favoritedCount?.toLocaleString() ?? '—'}`, inline: true },
    );
    if (updatedUnix) {
      embed.addFields(
        { name: '🕐 Last Updated', value: `<t:${updatedUnix}:R>`, inline: true },
      );
    }
  }

  return embed;
}

/**
 * Build a live status embed for dedicated status channel (1550494247784947772).
 * Shows active script users, when the bot was updated, uptime, and game stats.
 */
function buildLiveStatusEmbed({
  activeUsers = 0,
  botStartTime = Date.now(),
  botUpdatedUnix = null,
  commitHash = null,
  gameData = null,
  ping = null,
  currentBanner = null,
  prediction = null,
  recentSpawns = [],
} = {}) {
  const uptimeSeconds = Math.floor((Date.now() - botStartTime) / 1000);
  const days    = Math.floor(uptimeSeconds / 86400);
  const hours   = Math.floor((uptimeSeconds % 86400) / 3600);
  const minutes = Math.floor((uptimeSeconds % 3600) / 60);
  const seconds = uptimeSeconds % 60;
  const uptimeParts = [];
  if (days > 0) uptimeParts.push(`${days}d`);
  if (hours > 0 || days > 0) uptimeParts.push(`${hours}h`);
  uptimeParts.push(`${minutes}m ${seconds}s`);
  const uptimeStr = uptimeParts.join(' ');

  const gameUpdatedUnix = gameData?.updated
    ? Math.floor(new Date(gameData.updated).getTime() / 1000)
    : null;

  const userStatusText = activeUsers > 0
    ? `**\`${activeUsers}\` Active User${activeUsers === 1 ? '' : 's'}** 🟢\n*Scanning in-game now*`
    : `**\`0\` Users** ⚪\n*Standby / Waiting for scanners*`;

  const botUpdateText = botUpdatedUnix
    ? `<t:${botUpdatedUnix}:F>\n(<t:${botUpdatedUnix}:R>)${commitHash ? ` • \`${commitHash}\`` : ''}`
    : '*Unknown*';

  const embed = new EmbedBuilder()
    .setTitle('🟢  Steal An Egg — Live Bot & Scanner Status')
    .setColor(activeUsers > 0 ? 0x57F287 : 0x5865F2)
    .setDescription(
      'Real-time status overview for the Steal An Egg Discord Notifier and in-game scanner network.\n' +
      'Updates continuously in place.'
    )
    .addFields(
      {
        name: '👥 Active Script Users',
        value: userStatusText,
        inline: true,
      },
      {
        name: '🕐 Bot Last Updated',
        value: botUpdateText,
        inline: true,
      },
      {
        name: '🤖 Bot Uptime',
        value: `${uptimeStr}\n*(Since <t:${Math.floor(botStartTime / 1000)}:R>)*`,
        inline: true,
      },
      {
        name: '🎮 Roblox Game Status',
        value: gameData
          ? `Playing: **\`${gameData.playing?.toLocaleString() ?? '—'}\`**\nVisits: **\`${gameData.visits?.toLocaleString() ?? '—'}\`**`
          : '*Roblox data unavailable*',
        inline: true,
      },
      {
        name: '🎯 Monitored Place',
        value: `[\`${PLACE_ID}\`](https://www.roblox.com/games/${PLACE_ID})\nUpdated: ${gameUpdatedUnix ? `<t:${gameUpdatedUnix}:R>` : '—'}`,
        inline: true,
      },
      {
        name: '⚡ System & Banner',
        value: `Latency: **\`${ping != null ? `${ping}ms` : '—'}\`**\nBanner: **${currentBanner || 'Riftborn'}**`,
        inline: true,
      }
    );

  if (prediction) {
    const topEgg = (prediction.topEggs && prediction.topEggs.length > 0)
      ? prediction.topEggs[0]
      : (prediction.topPets && prediction.topPets.length > 0 ? prediction.topPets[0] : null);
    const topName = topEgg ? (topEgg.eggName || topEgg.name) : '—';
    const topOdds = topEgg?.probability != null ? `${topEgg.probability}%` : '—';
    const topBiome = topEgg?.biome ? ` (${topEgg.biome})` : '';
    const paceMin = prediction.averageIntervalSeconds
      ? `~${Math.round(prediction.averageIntervalSeconds / 60)}m`
      : '—';
    const nextEta = prediction.nextSpawnUnix
      ? `<t:${prediction.nextSpawnUnix}:R> (<t:${prediction.nextSpawnUnix}:t>)`
      : '—';

    embed.addFields({
      name: '🔮 AI Prediction Status',
      value:
        `Status: **🟢 Active (Forecasting)**\n` +
        `Model Memory: **\`${prediction.totalLogged ?? 0}\` spawns logged**\n` +
        `Estimated Spawn Time: ${nextEta} • Pace: \`${paceMin}\`\n` +
        `Top Forecast: 🥇 **${topName}**${topBiome} — **\`${topOdds}\`** odds`,
      inline: false,
    });
  }

  if (Array.isArray(recentSpawns) && recentSpawns.length > 0) {
    const logLines = recentSpawns.slice(-3).reverse().map((s) => {
      const icon = RARITY_EMOJI[(s.rarity || '').toLowerCase()] || '🥚';
      const timeTag = s.timestamp ? `<t:${Math.floor(s.timestamp / 1000)}:R>` : '';
      return `• ${icon} **${s.eggName}** (\`${s.rarity}\` in **${s.biome}**) — ${timeTag}`;
    }).join('\n');

    embed.addFields({
      name: '📜 Recent Egg Spawn Logs',
      value: logLines || '*No recent spawns recorded*',
      inline: false,
    });
  }

  embed
    .setFooter({ text: 'Steal An Egg Notifier • Auto-refreshes every 60s' })
    .setTimestamp();

  return embed;
}

/**
 * Build a scheduled-event countdown embed.
 */
function buildEventEmbed({ title, description, eventUnix, color }) {
  return new EmbedBuilder()
    .setTitle(title)
    .setColor(color ?? 0xFEE75C)
    .setDescription(description)
    .addFields(
      { name: '⏰ Event Time', value: `<t:${eventUnix}:F>\n(<t:${eventUnix}:R>)`, inline: false },
    )
    .setFooter({ text: 'Steal An Egg Notifier • Event Scheduler' })
    .setTimestamp();
}

/**
 * Build a Rift Boss fight alert embed.
 */
function buildRiftBossEmbed({ bossName, biome, health, timeLimit, image, timestamp }) {
  const name = bossName || 'Rift Boss';
  const spawnUnix = Math.floor((timestamp || Date.now()) / 1000);

  const embed = new EmbedBuilder()
    .setTitle('🌀  Rift Boss Fight Spawned!')
    .setColor(0x8A2BE2) // Deep Void Purple
    .setDescription(
      `# 🕒 <t:${spawnUnix}:T>\n` +
      `### ⏳ Spawned <t:${spawnUnix}:R>\n\n` +
      'A dimensional rift has opened! Assemble and defeat the boss.'
    )
    .addFields(
      { name: '👹 Boss',       value: `**${name}**`,        inline: true },
      { name: '🗺️ Biome',      value: `**${biome || 'Unknown'}**`, inline: true },
      { name: '⚔️ Event',      value: 'Rift Boss Fight',   inline: true },
      { name: '⏳ Spawned',    value: `<t:${spawnUnix}:R>`, inline: true },
      { name: '🕒 Exact Time', value: `<t:${spawnUnix}:T>`, inline: true },
    )
    .setFooter({ text: 'Steal An Egg Notifier • Rift Event' })
    .setTimestamp(new Date(spawnUnix * 1000));

  if (health) {
    embed.addFields({ name: '❤️ Health', value: `${health}`, inline: true });
  }

  if (timeLimit) {
    embed.addFields({ name: '⏳ Time Remaining', value: `${timeLimit}`, inline: true });
  }

  if (image) {
    embed.setImage(image);
  }

  return embed;
}

const BANNER_INFO = {
  'Riftborn': {
    egg: 'Riftborn Egg (45% chance)',
    biomes: 'Jungle, Snow, Volcano, Abyss Ocean',
    exclusive: 'Riftborn Pets',
  },
  'Riftbeasts': {
    egg: 'Riftbeasts Egg (35% chance)',
    biomes: 'Volcano, Abyss Ocean, Prehistoric, Cosmic',
    exclusive: 'Riftbeast Pets',
  },
  'Shattered Rift': {
    egg: 'Shattered Rift Egg (20% chance)',
    biomes: 'Prehistoric, Cosmic, Cherry Blossom, Titan Temple',
    exclusive: 'Shattered Colossus (0.5% Divine)',
  },
};

/**
 * Build a Rift Banner rotation embed.
 */
function buildBannerEmbed({ bannerName, requiredPets, details, timeRemaining, jobId }) {
  const name = bannerName || 'Riftborn';
  const info = BANNER_INFO[name];

  const embed = new EmbedBuilder()
    .setTitle(`📜  Active Rift Banner — ${name}`)
    .setColor(0x9B59B6) // Amethyst Purple
    .setDescription(
      `The Rift Machine banner is currently **${name}**!\n` +
      `*This message automatically edits in-place when the active banner rotates.*`
    )
    .addFields(
      { name: '🏷️ Active Banner',   value: `**${name}**`, inline: true },
      { name: '⏳ Rotation Cycle',  value: timeRemaining ? `⏳ ${timeRemaining}` : 'Rotates every 3 hours', inline: true },
    )
    .setFooter({ text: 'Steal An Egg Notifier • Live Rift Machine Banner' })
    .setTimestamp();

  if (info) {
    embed.addFields(
      { name: '🥚 Banner Egg Pool', value: info.egg, inline: true },
      { name: '🗺️ Active Biomes',    value: info.biomes, inline: true },
      { name: '👑 Exclusive Pet',   value: info.exclusive, inline: true },
    );
  }

  if (requiredPets && requiredPets.length > 0) {
    const petList = Array.isArray(requiredPets) ? requiredPets.join(', ') : requiredPets;
    embed.addFields({ name: '🥩 Required Sacrifice Pets', value: petList, inline: false });
  }

  if (details) {
    embed.addFields({ name: '🎁 Additional Details', value: details, inline: false });
  }

  return embed;
}

/**
 * Build a Scanner Execution / Connection embed.
 */
function buildScannerReadyEmbed({ jobId }) {
  return new EmbedBuilder()
    .setTitle('🚀  In-Game Scanner Connected!')
    .setColor(0x57F287) // Bright Green
    .setDescription(
      'An in-game scanner was **executed successfully** and is actively monitoring for egg spawns, rift bosses & banner rotations!'
    )
    .addFields(
      { name: '📡 Status',    value: '🟢 Active & Listening',             inline: true },
      { name: '🎮 Server ID', value: `\`${jobId ? (jobId.slice(0, 16) + '...') : 'Local'}\``, inline: true },
    )
    .setFooter({ text: 'Steal An Egg Notifier • Scanner Status' })
    .setTimestamp();
}

/**
 * Build a Scanner Disconnection / Offline embed.
 */
function buildScannerOfflineEmbed({ jobId }) {
  return new EmbedBuilder()
    .setTitle('🔌  In-Game Scanner Disconnected')
    .setColor(0xED4245) // Coral Red
    .setDescription(
      `The in-game scanner went **offline** (player left the game or disconnected).\n` +
      `Active event monitoring is currently paused until a scanner is re-executed.`
    )
    .addFields(
      { name: '📡 Status',    value: '🔴 Offline / Inactive',             inline: true },
      { name: '🎮 Server ID', value: `\`${jobId ? (jobId.slice(0, 16) + '...') : 'Local'}\``, inline: true },
    )
    .setFooter({ text: 'Steal An Egg Notifier • Scanner Status' })
    .setTimestamp();
}

/**
 * Build an AI Frequency-Based Egg Spawn Predictor embed.
 */
function buildPredictionEmbed(data) {
  const {
    lastSpawn,
    nextSpawnUnix,
    averageIntervalSeconds,
    rarityOdds,
    topBiomes,
    topEggs,
    topPets,
    top3CombinedProbability,
    repeatOdds,
  } = data;

  const predictedTime = `<t:${nextSpawnUnix}:t> (<t:${nextSpawnUnix}:R>)`;
  const top3Tag = top3CombinedProbability ? ` • **Top 3:** \`${top3CombinedProbability}%\`` : '';
  const repeatTag = (repeatOdds && repeatOdds.probability > 0)
    ? ` • **Repeat Chance:** \`${repeatOdds.probability}%\``
    : '';
  const description = `⏰ **Estimated Next Spawn Time:** ${predictedTime} • **Pace:** \`~${Math.round(averageIntervalSeconds / 60)}m\`${top3Tag}${repeatTag}`;

  const eggsToDisplay = (topEggs && topEggs.length > 0) ? topEggs : (topPets || []);
  const eggLines = eggsToDisplay.slice(0, 5).map((p, idx) => {
    const icon = RARITY_EMOJI[p.rarity.toLowerCase()] || '🥚';
    const displayName = p.eggName || (p.name.endsWith('Egg') ? p.name : `${p.name} Egg`);
    const medal = idx === 0 ? '🥇' : (idx === 1 ? '🥈' : (idx === 2 ? '🥉' : `**${idx + 1}.**`));
    const repeatBadge = p.isLastSpawn ? ' `[Repeat Contender]`' : '';
    const etaStr = p.etaUnix ? ` • ⏱️ <t:${p.etaUnix}:t> (<t:${p.etaUnix}:R>)` : '';
    return `${medal} ${icon} **${displayName}** (${p.biome})${repeatBadge} — **${p.probability}%**${etaStr}`;
  }).join('\n');

  const lastSpawnDesc = lastSpawn
    ? `**${lastSpawn.eggName}** (\`${lastSpawn.rarity}\` in **${lastSpawn.biome}**) • <t:${Math.floor(lastSpawn.timestamp / 1000)}:R>`
    : 'None recorded yet';

  const rarityLine = `👑 **Divine:** \`${rarityOdds.Divine}%\`  •  💎 **Eternal:** \`${rarityOdds.Eternal}%\`  •  🔮 **Secret:** \`${rarityOdds.Secret}%\``;
  const biomeLine = (topBiomes || []).slice(0, 4).map((b) => `• **${b.biome}:** \`${b.probability}%\``).join('  ');

  const embed = new EmbedBuilder()
    .setTitle('🔮  Global Egg Spawn Predictor')
    .setColor(0x9B59B6)
    .setDescription(description)
    .addFields(
      { name: '📜 Last Spawn', value: lastSpawnDesc, inline: false },
      { name: '🎯 Top Candidates', value: eggLines || 'No eggs available', inline: false },
      { name: '📊 Rarity Odds', value: rarityLine, inline: false },
      { name: '🗺️ Active Biomes', value: biomeLine || 'Unknown', inline: false },
    )
    .setFooter({ text: 'Steal An Egg Notifier • Global AI Predictor' })
    .setTimestamp();

  return embed;
}

/**
 * Build the "Pick a Role" selection embed for the role channel.
 */
function buildRolePickerEmbed({ secretRoleId, eternalRoleId, divineRoleId, riftbornRoleId, riftbeastRoleId, shatteredRiftRoleId, riftBossRoleId }) {
  return new EmbedBuilder()
    .setTitle('🎭  Notification Roles — Pick Your Roles')
    .setColor(0x5865F2)
    .setDescription(
      'Welcome to **Steal An Egg Notifier**!\n\n' +
      'Select which egg tiers, rift banners, and boss fights you want to receive alerts and pings for. You can pick any combination of roles:\n\n' +
      '**🥚 Egg Rarity Alerts:**\n' +
      `🔮 • <@&${secretRoleId}> — Alerts for **Secret** egg spawns\n` +
      `💎 • <@&${eternalRoleId}> — Alerts for **Eternal** egg spawns\n` +
      `👑 • <@&${divineRoleId}> — Alerts for **Divine** egg spawns\n\n` +
      '**📜 Rift Machine Banner Alerts:**\n' +
      `🌌 • <@&${riftbornRoleId}> — Alerts for **Riftborn** banner rotation\n` +
      `🐺 • <@&${riftbeastRoleId}> — Alerts for **Riftbeast** banner rotation\n` +
      `⚡ • <@&${shatteredRiftRoleId}> — Alerts for **Shattered Rift** banner rotation\n\n` +
      '**⚔️ Rift Event Alerts:**\n' +
      `🌀 • <@&${riftBossRoleId}> — Alerts for **Rift Boss** spawns\n\n` +
      '*React with the emojis below or click the buttons to toggle roles on/off!*'
    )
    .setFooter({ text: 'Steal An Egg Notifier • Role Selection' })
    .setTimestamp();
}

module.exports = {
  RARITY_COLORS,
  RARITY_EMOJI,
  colorForRarity,
  buildEggSpawnEmbed,
  buildUpdateEmbed,
  buildEggLookupEmbed,
  buildStatusEmbed,
  buildLiveStatusEmbed,
  buildEventEmbed,
  buildRiftBossEmbed,
  buildBannerEmbed,
  buildScannerReadyEmbed,
  buildScannerOfflineEmbed,
  buildPredictionEmbed,
  buildRolePickerEmbed,
};
