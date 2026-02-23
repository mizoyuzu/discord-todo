// === FILE: src/commands/add.js ===
const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const { parseDateWithLLM } = require('../llm');
const { buildConfirmationEmbed } = require('../utils/embeds');
const { pendingCreations } = require('../utils/state');

const command = new SlashCommandBuilder()
    .setName('add')
    .setDescription('タスクを追加します')
    .addStringOption(option =>
        option.setName('name')
            .setDescription('タスク名')
            .setRequired(true)
    )
    .addIntegerOption(option =>
        option.setName('priority')
            .setDescription('重要度')
            .setRequired(false)
            .addChoices(
                { name: '低', value: 0 },
                { name: '中', value: 1 },
                { name: '高', value: 2 },
                { name: '緊急', value: 3 },
            )
    )
    .addUserOption(option =>
        option.setName('assignee')
            .setDescription('担当者（ユーザー）')
            .setRequired(false)
    )
    .addRoleOption(option =>
        option.setName('role')
            .setDescription('割り当て先（ロール）')
            .setRequired(false)
    )
    .addStringOption(option =>
        option.setName('due')
            .setDescription('期限')
            .setRequired(false)
    );

async function execute(interaction) {
    const name = interaction.options.getString('name');
    const priority = interaction.options.getInteger('priority') ?? 0;
    const assignee = interaction.options.getUser('assignee');
    const role = interaction.options.getRole('role');
    const dueInput = interaction.options.getString('due');
    const guildId = interaction.guild.id;
    await interaction.deferReply();

    let dueDate = null;
    if (dueInput) {
        dueDate = await parseDateWithLLM(dueInput);
        if (!dueDate) {
            return interaction.editReply({
                content: `日時を解析できませんでした: "${dueInput}"`,
            });
        }
    }

    // Store pending creation
    const stateKey = `${interaction.user.id}_${guildId}`;
    const todoData = {
        name,
        priority,
        due_date: dueDate,
        assignee_id: role?.id ?? assignee?.id ?? null,
        assignee_type: role ? 'role' : 'user',
        category_id: null,
        category_name: null,
        category_emoji: null,
        recurrence: null,
        reminder_at: null,
        created_by: interaction.user.id,
        timestamp: Date.now(),
        channelId: interaction.channelId,
    };
    pendingCreations.set(stateKey, todoData);

    // Build confirmation embed
    const embed = buildConfirmationEmbed(todoData, interaction.user.id);

    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('confirm_create').setLabel('作成する').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('edit_create').setLabel('編集する').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('cancel_create').setLabel('キャンセル').setStyle(ButtonStyle.Secondary),
    );

    await interaction.editReply({ embeds: [embed], components: [buttons] });
}

module.exports = { data: command, execute };
