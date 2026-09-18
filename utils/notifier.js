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
  const joinUrl = jobId
    ? `https://www.roblox.com/games/start?placeId=${PLACE_ID}&gameInstanceId=${jobId}`
    : null;

  const titlePrefix = bannerName ? '⭐ BANNER EGG — ' : '';
  const spawnUnix = Math.floor((timestamp || Date.now()) / 1000);
  const joinSection = joinUrl ? `\n\n🔗 **[Join Server](${joinUrl})**` : '';

  const embed = new EmbedBuilder()
    .setTitle(`${emoji}  ${titlePrefix}${(rarity ?? 'RARE').toUpperCase()} EGG SPAWNED — ${eggName}`)
    .setColor(color)
    .setDescription(
      `# 🕒 <t:${spawnUnix}:T>\n` +
      `### ⏳ Spawned <t:${spawnUnix}:R>\n\n` +
      `A **${rarity ?? 'rare'}** egg has appeared in **${biome ?? 'the world'}**!` +
      joinSection
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
  const joinUrl = jobId
    ? `https://www.roblox.com/games/start?placeId=${PLACE_ID}&gameInstanceId=${jobId}`
    : null;

  const info = BANNER_INFO[name];

  const embed = new EmbedBuilder()
    .setTitle(`📜  Active Rift Banner — ${name}`)
    .setColor(0x9B59B6) // Amethyst Purple
    .setDescription(
      `The Rift Machine banner is currently **${name}**!\n` +
      `*This message automatically edits in-place when the active banner rotates.*\n` +
      (joinUrl ? `\n🔗 **[Join Server](${joinUrl})**` : '')
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
  const joinUrl = jobId
    ? `https://www.roblox.com/games/start?placeId=${PLACE_ID}&gameInstanceId=${jobId}`
    : null;

  return new EmbedBuilder()
    .setTitle('🚀  In-Game Scanner Connected!')
    .setColor(0x57F287) // Bright Green
    .setDescription(
      `An in-game scanner was **executed successfully** and is actively monitoring for egg spawns, rift bosses & banner rotations!\n` +
      (joinUrl ? `\n🔗 **[Join Server](${joinUrl})**` : '')
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
    totalLogged,
    lastSpawn,
    nextSpawnUnix,
    windowStartUnix,
    windowEndUnix,
    marginSeconds,
    timingConfidencePct,
    nextSpawnEtaSeconds,
    averageIntervalSeconds,
    rarityOdds,
    pity,
    topBiomes,
    topEggs,
    topPets,
    top3CombinedProbability,
    top5CombinedProbability,
  } = data;

  const predictedClockTime = `<t:${nextSpawnUnix}:t> (<t:${nextSpawnUnix}:R>)`;
  const windowTime = (windowStartUnix && windowEndUnix)
    ? `**<t:${windowStartUnix}:t> – <t:${windowEndUnix}:t>**\n*(±${marginSeconds}s • **${timingConfidencePct || 90}% Confidence**)*`
    : predictedClockTime;

  const eggsToDisplay = (topEggs && topEggs.length > 0) ? topEggs : (topPets || []);

  const eggLines = eggsToDisplay.slice(0, 10).map((p, idx) => {
    const icon = RARITY_EMOJI[p.rarity.toLowerCase()] || '🥚';
    const etaText = p.etaFormatted
      ? `• ⏱️ in **${p.etaFormatted}** (<t:${p.etaUnix}:R>)`
      : '';
    const displayName = p.eggName || (p.name.endsWith('Egg') ? p.name : `${p.name} Egg`);
    const medal = idx === 0 ? '🥇' : (idx === 1 ? '🥈' : (idx === 2 ? '🥉' : `**${idx + 1}.**`));
    return `${medal} ${icon} **${displayName}** (${p.biome}) — **${p.probability}%** ${etaText}`;
  }).join('\n');

  const rarityLine = `👑 **Divine:** \`${rarityOdds.Divine}%\` | 💎 **Eternal:** \`${rarityOdds.Eternal}%\` | 🔮 **Secret:** \`${rarityOdds.Secret}%\``;
  const biomeLine = topBiomes.map((b) => {
    const countText = b.spawnCount !== undefined ? ` (${b.spawnCount}x)` : '';
    const markovTag = b.markovProb !== undefined ? ` • Next Markov: \`${b.markovProb}%\`` : '';
    return `• **${b.biome}:** \`${b.probability}%\`${countText}${markovTag}`;
  }).join('\n');

  const lastSpawnDesc = lastSpawn
    ? `**${lastSpawn.eggName}** (\`${lastSpawn.rarity}\` in **${lastSpawn.biome}**) • <t:${Math.floor(lastSpawn.timestamp / 1000)}:R>`
    : 'None recorded yet';

  const top3Banner = top3CombinedProbability
    ? `🎯 **Top 3 Combined Probability:** \`${top3CombinedProbability}%\` | **Top 5:** \`${top5CombinedProbability}%\`\n`
    : '';

  const embed = new EmbedBuilder()
    .setTitle('🔮  Global Egg Spawn Predictor')
    .setColor(0x9B59B6)
    .setDescription(
      `AI-powered global spawn forecaster trained on **${totalLogged} logged spawns**.\n` +
      `Estimates which egg will spawn next using Markov transitions, 90% confidence windows & Bayesian pity cycles.\n\n` +
      top3Banner
    )
    .addFields(
      { name: '⏰ 90% Confidence Window', value: windowTime, inline: true },
      { name: '⏱️ Expected Time', value: predictedClockTime, inline: true },
      { name: '⚡ Spawn Pace', value: `\`~${Math.round(averageIntervalSeconds / 60)}m\` (\`${averageIntervalSeconds}s\`)`, inline: true },
      { name: '📜 Last Global Spawn', value: lastSpawnDesc, inline: false },
      { name: `🎯 Top Candidates (Top 3 = ${top3CombinedProbability || 0}% Combined)`, value: eggLines || 'No eggs available', inline: false },
      { name: '📊 Rarity Likelihood (Empirical Bayesian)', value: `${rarityLine}\n*Pity Dry-Streaks:* Divine: \`${pity.divineDryStreak}\` spawns | Eternal: \`${pity.eternalDryStreak}\` spawns`, inline: false },
      { name: '🗺️ Biome Activity & Markov Forecast', value: biomeLine || 'Unknown', inline: false },
    )
    .setFooter({ text: 'Steal An Egg Notifier • Global AI Predictor' })
    .setTimestamp();

  return embed;
}

/**
 * Build the "Pick a Role" selection embed for the role channel.
 */
function buildRolePickerEmbed({ secretRoleId, eternalRoleId, divineRoleId }) {
  return new EmbedBuilder()
    .setTitle('🎭  Notification Roles — Pick Your Roles')
    .setColor(0x5865F2)
    .setDescription(
      'Welcome to **Steal An Egg Notifier**!\n\n' +
      'Select which egg tiers you want to receive alerts and pings for. You can pick any combination of roles:\n\n' +
      `🔮 • <@&${secretRoleId}> — Alerts for **Secret** egg spawns\n` +
      `💎 • <@&${eternalRoleId}> — Alerts for **Eternal** egg spawns\n` +
      `👑 • <@&${divineRoleId}> — Alerts for **Divine** egg spawns\n\n` +
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
  buildEventEmbed,
  buildRiftBossEmbed,
  buildBannerEmbed,
  buildScannerReadyEmbed,
  buildScannerOfflineEmbed,
  buildPredictionEmbed,
  buildRolePickerEmbed,
};
