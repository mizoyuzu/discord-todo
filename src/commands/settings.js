const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { getGuildSettings, updateGuildSettings, getCategories, addCategory, deleteCategory } = require('../database');
const { buildSettingsEmbed } = require('../utils/embeds');
const { ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const command = new SlashCommandBuilder()
    .setName('settings')
    .setDescription('ToDoボットのサーバー設定を管理します')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

async function execute(interaction) {
    const settings = getGuildSettings(interaction.guild.id);
    const categories = getCategories(interaction.guild.id);
    const embed = buildSettingsEmbed(settings, categories);

    const components = buildSettingsComponents(settings, categories);
    await interaction.reply({ embeds: [embed], components, flags: [MessageFlags.Ephemeral] });
}

function buildSettingsComponents(settings, categories) {
    const rows = [];

    // Field toggle select menu
    const allFields = [
        { label: '重要度', value: 'priority' },
        { label: '期限', value: 'due_date' },
        { label: '担当者', value: 'assignee' },
        { label: 'カテゴリ', value: 'category' },
        { label: '繰り返し', value: 'recurrence' },
    ];

    const fieldSelect = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('settings_fields')
            .setPlaceholder('有効にするフィールドを選択')
            .setMinValues(0)
            .setMaxValues(allFields.length)
            .addOptions(allFields.map(f => ({
                ...f,
                default: settings.enabled_fields.includes(f.value),
            })))
    );
    rows.push(fieldSelect);

    // Channel settings buttons
    const channelRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('settings_reminder_ch').setLabel('リマインダーch設定').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('settings_todo_ch').setLabel('ToDoチャンネル設定').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('settings_add_category').setLabel('カテゴリ追加').setStyle(ButtonStyle.Success),
    );
    rows.push(channelRow);

    // Category delete if categories exist
    if (categories.length > 0) {
        const catOptions = categories.map(c => ({
            label: c.name,
            value: `delcat_${c.id}`,
        }));
        const catDelete = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('settings_delete_category')
                .setPlaceholder('カテゴリを削除')
                .addOptions(catOptions.slice(0, 25))
        );
        rows.push(catDelete);
    }

    return rows;
}

module.exports = { data: command, execute, buildSettingsComponents };
