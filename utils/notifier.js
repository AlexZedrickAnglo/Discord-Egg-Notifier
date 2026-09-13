// ──────────────────────────────────────────────────────────────
// utils/notifier.js — Centralized Discord notification helpers
// ──────────────────────────────────────────────────────────────
const { EmbedBuilder } = require('discord.js');

// ─── Rarity → Embed colour mapping ───────────────────────────
const RARITY_COLORS = {
  common:    0x90A4AE, // slate
  uncommon:  0x66BB6A, // green
  rare:      0x42A5F5, // blue
  epic:      0xAB47BC, // purple
  legendary: 0xFFA726, // orange
  mythic:    0xEF5350, // red
  divine:    0xFFD740, // gold
  eternal:   0x00E5FF, // cyan
  secret:    0xE040FB, // magenta
};

/**
 * Look up a colour for a rarity string (case-insensitive).
 */
function colorForRarity(rarity) {
  return RARITY_COLORS[rarity?.toLowerCase()] ?? 0x5865F2; // default: blurple
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
 * Build a "Rare Egg Spawn" embed from a webhook payload.
 */
function buildEggSpawnEmbed({ eggName, rarity, biome, serverId }) {
  const rarityFormatted = rarity ? rarity.toUpperCase() : 'RARE';
  return new EmbedBuilder()
    .setTitle(`🥚  ${rarityFormatted} Egg Spawned — ${eggName}`)
    .setColor(colorForRarity(rarity))
    .setDescription(`A **${rarity ?? 'rare'}** egg (**${eggName}**) has spawned!`)
    .addFields(
      { name: '🥚 Egg Name',  value: `**${eggName}**`, inline: true },
      { name: '✨ Rarity',    value: rarity   ?? 'Unknown', inline: true },
      { name: '🌍 Biome',     value: biome    ?? 'Unknown', inline: true },
      { name: '🖥️ Server ID', value: serverId ? `\`${serverId}\`` : 'Unknown', inline: true },
    )
    .setFooter({ text: 'Steal An Egg Notifier • Egg Spawn Alert' })
    .setTimestamp();
}

/**
 * Build a "Status" embed for the /status command.
 */
function buildStatusEmbed(gameData) {
  const updatedUnix = Math.floor(new Date(gameData.updated).getTime() / 1000);
  const createdUnix = Math.floor(new Date(gameData.created).getTime() / 1000);

  return new EmbedBuilder()
    .setTitle(`🥚  ${gameData.name ?? 'Steal An Egg'} — Live Status`)
    .setColor(0x5865F2)
    .setDescription(gameData.description?.slice(0, 200) ?? '')
    .addFields(
      { name: '🎮 Playing Now', value: `${gameData.playing?.toLocaleString() ?? '—'}`,    inline: true },
      { name: '👀 Total Visits', value: `${gameData.visits?.toLocaleString() ?? '—'}`,    inline: true },
      { name: '❤️ Favourites',   value: `${gameData.favoritedCount?.toLocaleString() ?? '—'}`, inline: true },
      { name: '🕐 Last Updated', value: `<t:${updatedUnix}:R>`,                           inline: true },
      { name: '📅 Created',      value: `<t:${createdUnix}:D>`,                           inline: true },
    )
    .setFooter({ text: 'Steal An Egg Notifier' })
    .setTimestamp();
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

module.exports = {
  RARITY_COLORS,
  colorForRarity,
  buildUpdateEmbed,
  buildEggSpawnEmbed,
  buildStatusEmbed,
  buildEventEmbed,
};
