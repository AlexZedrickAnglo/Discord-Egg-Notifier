// ──────────────────────────────────────────────────────────────
// commands/status.js — /status slash command
// ──────────────────────────────────────────────────────────────
const { SlashCommandBuilder } = require('discord.js');
const { getGameDetails }      = require('../utils/roblox');
const { buildStatusEmbed }    = require('../utils/notifier');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('Shows bot uptime, monitored Place ID, and current Steal An Egg game stats.'),

  async execute(interaction, { botStartTime }) {
    await interaction.deferReply();

    try {
      const game = await getGameDetails();
      const embed = buildStatusEmbed(game, botStartTime);
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('[/status] Error:', err.message);
      await interaction.editReply({
        content: '❌ Could not fetch game data from Roblox. Try again later.',
      });
    }
  },
};
