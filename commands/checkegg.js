// ──────────────────────────────────────────────────────────────
// commands/checkegg.js — /checkegg [name] slash command
// ──────────────────────────────────────────────────────────────
const { SlashCommandBuilder } = require('discord.js');
const { findEgg }             = require('../utils/roblox');
const { buildEggLookupEmbed } = require('../utils/notifier');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('checkegg')
    .setDescription('Look up an egg or pet by name to see its biome, rarity, and details.')
    .addStringOption((opt) =>
      opt
        .setName('name')
        .setDescription('The egg or pet name to search for.')
        .setRequired(true),
    ),

  async execute(interaction) {
    const query = interaction.options.getString('name');
    const result = findEgg(query);

    if (!result) {
      return interaction.reply({
        content: `❌ No egg or pet found matching **"${query}"**. Try a different name.`,
        flags: 64, // ephemeral
      });
    }

    const embed = buildEggLookupEmbed(result);
    await interaction.reply({ embeds: [embed] });
  },
};
