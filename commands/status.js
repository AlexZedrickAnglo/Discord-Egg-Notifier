// ──────────────────────────────────────────────────────────────
// commands/status.js — /status slash command
// ──────────────────────────────────────────────────────────────
const { SlashCommandBuilder } = require('discord.js');
const { getGameDetails }      = require('../utils/roblox');
const { buildStatusEmbed }    = require('../utils/notifier');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('Shows live Steal An Egg player count, visits, and last update time.'),

  async execute(interaction) {
    await interaction.deferReply();

    try {
      const game = await getGameDetails();
      if (!game) {
        return interaction.editReply({ content: '❌ Could not fetch game data from Roblox.' });
      }
      const embed = buildStatusEmbed(game);
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('[/status] Error:', err.message);
      await interaction.editReply({ content: '❌ Roblox API request failed. Try again later.' });
    }
  },
};
