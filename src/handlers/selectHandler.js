const {
    ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
    StringSelectMenuBuilder, UserSelectMenuBuilder,
    ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType, MessageFlags,
} = require('discord.js');
const {
    getGuildSettings, updateGuildSettings, completeTodo, reopenTodo,
    deleteTodo, addTodo, getTodoById, updateTodo, getCategories, deleteCategory,
} = require('../database');
const { formatDateDisplayJST } = require('../utils/timezone');
const { sendTodoList, sendCompletedList } = require('../utils/pagination');
const { buildSettingsEmbed } = require('../utils/embeds');
const { buildSettingsComponents } = require('../commands/settings');
const { userStates } = require('./buttonHandler');
const { PRIORITY_LABELS } = require('../utils/embeds');

async function handleSelect(interaction) {
    const { customId } = interaction;

    // Settings field toggles
    if (customId === 'settings_fields') return handleSettingsFields(interaction);
    if (customId === 'settings_delete_category') return handleDeleteCategory(interaction);

    // Todo filters
    if (customId === 'todo_filter_category') return handleFilterCategory(interaction);

    // Action selects (complete, edit, delete, reopen)
    if (customId === 'action_complete') return handleActionComplete(interaction);
    if (customId === 'action_edit') return handleActionEdit(interaction);
    if (customId === 'action_delete') return handleActionDelete(interaction);
    if (customId === 'action_reopen') return handleActionReopen(interaction);

    // select_done from reminder/recap messages
    if (customId === 'select_done') return handleSelectDone(interaction);

    // Add flow selects
    if (customId === 'add_priority') return handleAddPriority(interaction);
    if (customId === 'add_category') return handleAddCategory(interaction);
    if (customId === 'add_recurrence') return handleAddRecurrence(interaction);
    if (customId === 'add_assignee') return handleAddAssignee(interaction);
    if (customId === 'add_role') return handleAddRole(interaction);

    // Channel selects
    if (customId === 'select_reminder_ch') return handleSetReminderChannel(interaction);
    if (customId === 'select_todo_ch') return handleSetTodoChannel(interaction);
}

// ── Settings ──

async function handleSettingsFields(interaction) {
    const guildId = interaction.guild.id;
    const selected = interaction.values;
    // Always include 'name'
    const fields = ['name', ...selected];
    updateGuildSettings(guildId, { enabled_fields: fields });

    const settings = getGuildSettings(guildId);
    const categories = getCategories(guildId);
    const embed = buildSettingsEmbed(settings, categories);
    const components = buildSettingsComponents(settings, categories);

    await interaction.update({ embeds: [embed], components });
}

async function handleDeleteCategory(interaction) {
    const guildId = interaction.guild.id;
    const catId = parseInt(interaction.values[0].replace('delcat_', ''));
    deleteCategory(guildId, catId);

    const settings = getGuildSettings(guildId);
    const categories = getCategories(guildId);
    const embed = buildSettingsEmbed(settings, categories);
    const components = buildSettingsComponents(settings, categories);

    await interaction.update({ content: 'カテゴリを削除しました', embeds: [embed], components });
}

// ── Filter ──

async function handleFilterCategory(interaction) {
    const guildId = interaction.guild.id;
    const value = interaction.values[0];
    await interaction.deferUpdate();

    if (value === 'all') {
        return sendTodoList(interaction, guildId);
    }

    const categoryId = parseInt(value.replace('cat_', ''));
    return sendTodoList(interaction, guildId, 1, { categoryId });
}

// ── Actions ──

async function handleActionComplete(interaction) {
    const guildId = interaction.guild.id;
    const todoId = parseInt(interaction.values[0]);
    const todo = getTodoById(todoId, guildId);

    completeTodo(todoId, guildId);

    // Handle recurrence
    if (todo && todo.recurrence && todo.recurrence !== 'none') {
        const nextDue = calculateNextDue(todo.due_date, todo.recurrence);
        addTodo(guildId, {
            name: todo.name,
            priority: todo.priority,
            due_date: nextDue,
            assignee_id: todo.assignee_id,
            assignee_type: todo.assignee_type || 'user',
            category_id: todo.category_id,
            recurrence: todo.recurrence,
            created_by: todo.created_by,
        });
    }

    await interaction.deferUpdate();
    await sendTodoList(interaction, guildId);
}

async function handleActionEdit(interaction) {
    const guildId = interaction.guild.id;
    const todoId = parseInt(interaction.values[0]);
    const todo = getTodoById(todoId, guildId);
    if (!todo) {
        return interaction.reply({ content: 'タスクが見つかりません。', flags: [MessageFlags.Ephemeral] });
    }

    const settings = getGuildSettings(guildId);
    const modal = new ModalBuilder()
        .setCustomId(`modal_edit_${todoId}`)
        .setTitle(`タスク #${todoId} を編集`);

    const nameInput = new TextInputBuilder()
        .setCustomId('edit_name')
        .setLabel('タスク名')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setValue(todo.name)
        .setMaxLength(100);
    modal.addComponents(new ActionRowBuilder().addComponents(nameInput));

    if (settings.enabled_fields.includes('due_date')) {
        const dueInput = new TextInputBuilder()
            .setCustomId('edit_due')
            .setLabel('期限')
            .setStyle(TextInputStyle.Short)
            .setRequired(false);
        if (todo.due_date) {
            dueInput.setValue(formatDateDisplayJST(todo.due_date));
        }
        modal.addComponents(new ActionRowBuilder().addComponents(dueInput));
    }

    await interaction.showModal(modal);
}

async function handleActionDelete(interaction) {
    const guildId = interaction.guild.id;
    const todoId = parseInt(interaction.values[0]);
    const todo = getTodoById(todoId, guildId);
    if (!todo) {
        return interaction.reply({ content: 'タスクが見つかりません。', flags: [MessageFlags.Ephemeral] });
    }

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`confirm_delete_${todoId}`).setLabel('削除する').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`cancel_delete_${todoId}`).setLabel('キャンセル').setStyle(ButtonStyle.Secondary),
    );

    await interaction.reply({
        content: `**${todo.name}** (#${todoId}) を削除しますか？`,
        components: [row],
        flags: [MessageFlags.Ephemeral],
    });
}

async function handleActionReopen(interaction) {
    const guildId = interaction.guild.id;
    const todoId = parseInt(interaction.values[0]);
    reopenTodo(todoId, guildId);

    await interaction.deferUpdate();
    await sendCompletedList(interaction, guildId);
}

// ── Select done (from reminder/recap messages) ──

async function handleSelectDone(interaction) {
    const guildId = interaction.guild.id;
    const selectedIds = interaction.values.map(v => parseInt(v));
    const completed = [];

    for (const todoId of selectedIds) {
        const todo = getTodoById(todoId, guildId);
        if (todo && !todo.completed) {
            completeTodo(todoId, guildId);
            completed.push(`#${todoId} ${todo.name}`);

            // Handle recurrence
            if (todo.recurrence && todo.recurrence !== 'none') {
                const nextDue = calculateNextDue(todo.due_date, todo.recurrence);
                addTodo(guildId, {
                    name: todo.name,
                    priority: todo.priority,
                    due_date: nextDue,
                    assignee_id: todo.assignee_id,
                    assignee_type: todo.assignee_type || 'user',
                    category_id: todo.category_id,
                    recurrence: todo.recurrence,
                    created_by: todo.created_by,
                });
            }
        }
    }

    if (completed.length > 0) {
        await interaction.update({
            content: `完了にしました:\n${completed.join('\n')}`,
            components: [],
        });
    } else {
        await interaction.update({
            content: '対象のタスクは既に完了しています。',
            components: [],
        });
    }
}

// ── Add flow ──

async function handleAddPriority(interaction) {
    const stateKey = `${interaction.user.id}_${interaction.guild.id}`;
    const state = userStates.get(stateKey);
    if (state) {
        state.priority = parseInt(interaction.values[0]);
        userStates.set(stateKey, state);
    }
    await interaction.deferUpdate();
}

async function handleAddCategory(interaction) {
    const stateKey = `${interaction.user.id}_${interaction.guild.id}`;
    const state = userStates.get(stateKey);
    if (state) {
        state.category_id = parseInt(interaction.values[0]);
        userStates.set(stateKey, state);
    }
    await interaction.deferUpdate();
}

async function handleAddRecurrence(interaction) {
    const stateKey = `${interaction.user.id}_${interaction.guild.id}`;
    const state = userStates.get(stateKey);
    if (state) {
        state.recurrence = interaction.values[0] === 'none' ? null : interaction.values[0];
        userStates.set(stateKey, state);
    }
    await interaction.deferUpdate();
}

async function handleAddAssignee(interaction) {
    const stateKey = `${interaction.user.id}_${interaction.guild.id}`;
    const state = userStates.get(stateKey);
    if (state) {
        state.assignee_id = interaction.values[0];
        state.assignee_type = 'user';
        userStates.set(stateKey, state);
    }
    await interaction.deferUpdate();
}

async function handleAddRole(interaction) {
    const stateKey = `${interaction.user.id}_${interaction.guild.id}`;
    const state = userStates.get(stateKey);
    if (state) {
        state.assignee_id = interaction.values[0];
        state.assignee_type = 'role';
        userStates.set(stateKey, state);
    }
    await interaction.deferUpdate();
}

// ── Channel selects ──

async function handleSetReminderChannel(interaction) {
    const guildId = interaction.guild.id;
    const channelId = interaction.values[0];
    updateGuildSettings(guildId, { reminder_channel_id: channelId });

    const settings = getGuildSettings(guildId);
    const categories = getCategories(guildId);
    const embed = buildSettingsEmbed(settings, categories);
    const components = buildSettingsComponents(settings, categories);

    await interaction.update({ content: `リマインダーチャンネルを <#${channelId}> に設定しました`, embeds: [embed], components });
}

async function handleSetTodoChannel(interaction) {
    const guildId = interaction.guild.id;
    const channelId = interaction.values[0];
    updateGuildSettings(guildId, { todo_channel_id: channelId });

    const settings = getGuildSettings(guildId);
    const categories = getCategories(guildId);
    const embed = buildSettingsEmbed(settings, categories);
    const components = buildSettingsComponents(settings, categories);

    await interaction.update({ content: `ToDoチャンネルを <#${channelId}> に設定しました`, embeds: [embed], components });
}

// ── Utility ──

function calculateNextDue(currentDue, recurrence) {
    if (!currentDue) return null;
    const { jstToUnix, formatDateJST } = require('../utils/timezone');
    // Parse as JST, add interval, format back as JST string
    const ts = jstToUnix(currentDue);
    if (!ts) return null;
    const date = new Date(ts * 1000);
    // Use UTC methods to avoid local timezone interference,
    // but since we converted JST→UTC correctly, we need to work in JST.
    // Easiest: parse parts from the string directly
    const parts = currentDue.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
    if (!parts) return null;
    let [, y, m, d, h, mi, s] = parts.map(Number);
    switch (recurrence) {
        case 'daily': d += 1; break;
        case 'weekly': d += 7; break;
        case 'monthly': m += 1; break;
        default: return null;
    }
    // Use Date to normalize overflow (e.g. day 32 → next month)
    const normalized = new Date(y, m - 1, d, h, mi, s);
    const pad = (n) => String(n).padStart(2, '0');
    return `${normalized.getFullYear()}-${pad(normalized.getMonth() + 1)}-${pad(normalized.getDate())}T${pad(normalized.getHours())}:${pad(normalized.getMinutes())}:${pad(normalized.getSeconds())}`;
}

module.exports = { handleSelect, calculateNextDue };
