// === FILE: src/commands/todo.js ===
const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { sendTodoList } = require('../utils/pagination');
const { addTodo, getGuildSettings } = require('../database');
const { parseDateWithLLM } = require('../llm');
const { buildConfirmationEmbed } = require('../utils/embeds');
const { pendingCreations } = require('../utils/state');

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
        // Quick add mode - show confirmation
        await interaction.deferReply(); // Public

        const guildId = interaction.guild.id;
        const stateKey = `${interaction.user.id}_${guildId}`;

        const todoData = {
            name: quickAdd,
            priority: 0,
            due_date: null,
            assignee_id: null,
            category_id: null,
            category_name: null,
            category_emoji: null,
            recurrence: null,
            created_by: interaction.user.id,
            timestamp: Date.now(),
            channelId: interaction.channelId,
        };
        pendingCreations.set(stateKey, todoData);

        const embed = buildConfirmationEmbed(todoData, interaction.user.id);
        const buttons = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('confirm_create').setLabel('作成する').setEmoji('✅').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('edit_create').setLabel('編集する').setEmoji('✏️').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('cancel_create').setLabel('キャンセル').setEmoji('❌').setStyle(ButtonStyle.Secondary),
        );

        return interaction.editReply({ embeds: [embed], components: [buttons] });
    }

    // Show todo list - not ephemeral
    await sendTodoList(interaction, interaction.guild.id);
}

module.exports = { data: command, execute };
