// === FILE: src/commands/add.js ===
const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getGuildSettings, getCategories } = require('../database');
const { parseDateWithLLM } = require('../llm');
const { buildConfirmationEmbed } = require('../utils/embeds');
const { pendingCreations } = require('../utils/state');

const command = new SlashCommandBuilder()
    .setName('add')
    .setDescription('どこからでもタスクをすばやく追加します')
    .addStringOption(option =>
        option.setName('name')
            .setDescription('タスクの名前')
            .setRequired(true)
    )
    .addIntegerOption(option =>
        option.setName('priority')
            .setDescription('重要度')
            .setRequired(false)
            .addChoices(
                { name: '🟢 低', value: 0 },
                { name: '🟡 中', value: 1 },
                { name: '🟠 高', value: 2 },
                { name: '🔴 緊急', value: 3 },
            )
    )
    .addUserOption(option =>
        option.setName('assignee')
            .setDescription('担当者')
            .setRequired(false)
    )
    .addStringOption(option =>
        option.setName('due')
            .setDescription('期限（自然言語OK: "明日", "来週月曜", "3日後"）')
            .setRequired(false)
    );

async function execute(interaction) {
    const name = interaction.options.getString('name');
    const priority = interaction.options.getInteger('priority') ?? 0;
    const assignee = interaction.options.getUser('assignee');
    const dueInput = interaction.options.getString('due');
    const guildId = interaction.guild.id;
    const settings = getGuildSettings(guildId);
    const timezone = settings.timezone || 'Asia/Tokyo';

    await interaction.deferReply(); // Public reply

    let dueDate = null;
    if (dueInput) {
        dueDate = await parseDateWithLLM(dueInput, timezone);
        if (!dueDate) {
            return interaction.editReply({
                content: `⚠️ 日時を解析できませんでした: "${dueInput}"\nYYYY-MM-DD形式で再入力するか、別の表現をお試しください。`,
            });
        }
    }

    // Store pending creation
    const stateKey = `${interaction.user.id}_${guildId}`;
    const todoData = {
        name,
        priority,
        due_date: dueDate,
        assignee_id: assignee?.id ?? null,
        category_id: null,
        category_name: null,
        category_emoji: null,
        recurrence: null,
        created_by: interaction.user.id,
        timestamp: Date.now(),
        channelId: interaction.channelId,
    };
    pendingCreations.set(stateKey, todoData);

    // Build confirmation embed
    const embed = buildConfirmationEmbed(todoData, interaction.user.id);

    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('confirm_create').setLabel('作成する').setEmoji('✅').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('edit_create').setLabel('編集する').setEmoji('✏️').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('cancel_create').setLabel('キャンセル').setEmoji('❌').setStyle(ButtonStyle.Secondary),
    );

    await interaction.editReply({ embeds: [embed], components: [buttons] });
}

module.exports = { data: command, execute };
