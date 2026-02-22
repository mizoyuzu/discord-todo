const { SlashCommandBuilder } = require('discord.js');
const { sendTodoList } = require('../utils/pagination');

const command = new SlashCommandBuilder()
    .setName('todo')
    .setDescription('ToDoリストを表示します')
    .addStringOption(option =>
        option.setName('quick')
            .setDescription('クイック追加: タスク名を入力してすぐに追加')
            .setRequired(false)
    );

async function execute(interaction) {
    const quickAdd = interaction.options.getString('quick');

    if (quickAdd) {
        // Quick add mode - add task directly from any channel
        const { addTodo, getGuildSettings } = require('../database');
        const settings = getGuildSettings(interaction.guild.id);

        addTodo(interaction.guild.id, {
            name: quickAdd,
            priority: 0,
            created_by: interaction.user.id,
        });

        return interaction.reply({
            content: `✅ タスクを追加しました: **${quickAdd}**`,
            ephemeral: true,
        });
    }

    // Show todo list
    await sendTodoList(interaction, interaction.guild.id);
}

module.exports = { data: command, execute };
