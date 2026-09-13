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
function buildEggSpawnEmbed({ eggName, rarity, biome, jobId, image }) {
  const emoji   = RARITY_EMOJI[rarity?.toLowerCase()] ?? '🥚';
  const color   = colorForRarity(rarity);
  const joinUrl = jobId
    ? `https://www.roblox.com/games/start?placeId=${PLACE_ID}&gameInstanceId=${jobId}`
    : null;

  const embed = new EmbedBuilder()
    .setTitle(`${emoji}  ${(rarity ?? 'RARE').toUpperCase()} EGG SPAWNED — ${eggName}`)
    .setColor(color)
    .setDescription(
      `A **${rarity ?? 'rare'}** egg has appeared!\n` +
      (joinUrl ? `\n🔗 **[Join Server](${joinUrl})**` : ''),
    )
    .addFields(
      { name: '🥚 Egg',       value: `**${eggName}**`,                    inline: true },
      { name: '✨ Rarity',    value: rarity ?? 'Unknown',                 inline: true },
      { name: '🌍 Biome',     value: biome  ?? 'Unknown',                 inline: true },
    )
    .setFooter({ text: 'Steal An Egg Notifier • Egg Spawn Alert' })
    .setTimestamp();




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
function buildRiftBossEmbed({ bossName, biome, health, timeLimit, image }) {
  const name = bossName || 'Rift Boss';
  const embed = new EmbedBuilder()
    .setTitle('🌀  Rift Boss Fight Spawned!')
    .setColor(0x8A2BE2) // Deep Void Purple
    .setDescription('A dimensional rift has opened! Assemble and defeat the boss.')
    .addFields(
      { name: '👹 Boss',  value: `**${name}**`, inline: true },
      { name: '🗺️ Biome', value: `**${biome || 'Unknown'}**`, inline: true },
      { name: '⚔️ Event', value: 'Rift Boss Fight', inline: true },
    )
    .setFooter({ text: 'Steal An Egg Notifier • Rift Event' })
    .setTimestamp();

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
};
