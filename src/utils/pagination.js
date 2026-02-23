const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { getTodos, getTodoCount, getCategories } = require('../database');
const { buildTodoListEmbed } = require('./embeds');

const ITEMS_PER_PAGE = 8;

function buildTodoListComponents(todos, page, totalPages, guildId, enabledFields) {
    const rows = [];

    // Main action buttons
    const buttonRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('todo_add').setLabel('追加').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('todo_complete').setLabel('完了').setStyle(ButtonStyle.Primary).setDisabled(todos.length === 0),
        new ButtonBuilder().setCustomId('todo_edit').setLabel('編集').setStyle(ButtonStyle.Secondary).setDisabled(todos.length === 0),
        new ButtonBuilder().setCustomId('todo_delete').setLabel('削除').setStyle(ButtonStyle.Danger).setDisabled(todos.length === 0),
    );
    rows.push(buttonRow);

    // Pagination + completed view
    const navRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('todo_prev').setLabel('前').setStyle(ButtonStyle.Secondary).setDisabled(page <= 1),
        new ButtonBuilder().setCustomId('todo_page_info').setLabel(`${page}/${totalPages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId('todo_next').setLabel('次').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages),
        new ButtonBuilder().setCustomId('todo_completed').setLabel('完了済み').setStyle(ButtonStyle.Secondary),
    );
    rows.push(navRow);

    return rows;
}

function buildFilterComponents(guildId, enabledFields) {
    const rows = [];
    const categories = getCategories(guildId);

    // Filter select menu (only if relevant fields are enabled)
    if (enabledFields.includes('category') && categories.length > 0) {
        const catOptions = [
            { label: 'すべて', value: 'all' },
            ...categories.map(c => ({ label: c.name, value: `cat_${c.id}` })),
        ];
        const catSelect = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('todo_filter_category')
                .setPlaceholder('カテゴリで絞り込み')
                .addOptions(catOptions.slice(0, 25))
        );
        rows.push(catSelect);
    }

    return rows;
}

async function sendTodoList(interaction, guildId, page = 1, filters = {}, ephemeral = false) {
    const totalCount = getTodoCount(guildId, 0);
    const totalPages = Math.max(1, Math.ceil(totalCount / ITEMS_PER_PAGE));
    page = Math.max(1, Math.min(page, totalPages));

    const todos = getTodos(guildId, {
        completed: 0,
        limit: ITEMS_PER_PAGE,
        offset: (page - 1) * ITEMS_PER_PAGE,
        categoryId: filters.categoryId,
        assigneeId: filters.assigneeId,
        priority: filters.priority,
    });

    const guildName = interaction.guild?.name || 'サーバー';
    const embed = buildTodoListEmbed(todos, guildName, page, totalPages, totalCount, filters);

    const { getGuildSettings } = require('../database');
    const settings = getGuildSettings(guildId);
    const components = [
        ...buildTodoListComponents(todos, page, totalPages, guildId, settings.enabled_fields),
        ...buildFilterComponents(guildId, settings.enabled_fields),
    ];

    // Limit to 5 action rows
    const finalComponents = components.slice(0, 5);

    const payload = { embeds: [embed], components: finalComponents, ephemeral };

    if (interaction.replied || interaction.deferred) {
        return interaction.editReply(payload);
    } else {
        return interaction.reply(payload);
    }
}

async function sendCompletedList(interaction, guildId, page = 1) {
    const totalCount = getTodoCount(guildId, 1);
    const totalPages = Math.max(1, Math.ceil(totalCount / ITEMS_PER_PAGE));
    page = Math.max(1, Math.min(page, totalPages));

    const todos = getTodos(guildId, {
        completed: 1,
        limit: ITEMS_PER_PAGE,
        offset: (page - 1) * ITEMS_PER_PAGE,
    });

    const embed = buildTodoListEmbed(todos, interaction.guild?.name || 'サーバー', page, totalPages, totalCount);
    embed.setTitle('完了済みタスク');
    embed.setColor(0x95a5a6);

    const rows = [];
    const buttonRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('todo_reopen').setLabel('再開').setStyle(ButtonStyle.Primary).setDisabled(todos.length === 0),
        new ButtonBuilder().setCustomId('todo_back').setLabel('戻る').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('comp_prev').setLabel('前').setStyle(ButtonStyle.Secondary).setDisabled(page <= 1),
        new ButtonBuilder().setCustomId('comp_page_info').setLabel(`${page}/${totalPages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId('comp_next').setLabel('次').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages),
    );
    rows.push(buttonRow);

    const payload = { embeds: [embed], components: rows };
    if (interaction.replied || interaction.deferred) {
        return interaction.editReply(payload);
    } else {
        return interaction.reply(payload);
    }
}

module.exports = { sendTodoList, sendCompletedList, ITEMS_PER_PAGE };
