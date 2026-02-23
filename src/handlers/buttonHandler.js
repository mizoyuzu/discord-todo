// === FILE: src/handlers/buttonHandler.js ===
const {
    ModalBuilder, TextInputBuilder, TextInputStyle,
    ActionRowBuilder, StringSelectMenuBuilder, UserSelectMenuBuilder,
    ButtonBuilder, ButtonStyle, MessageFlags,
} = require('discord.js');
const { getGuildSettings, getTodos, completeTodo, reopenTodo, deleteTodo, addTodo, getTodoById } = require('../database');
const { formatDateDisplayJST, jstToUnix } = require('../utils/timezone');
const { sendTodoList, sendCompletedList } = require('../utils/pagination');
const { buildCreatedEmbed } = require('../utils/embeds');
const { pendingCreations } = require('../utils/state');

// State management for multi-step interactions (add flow from dashboard)
const userStates = new Map();

function cleanupExpiredStates() {
    const now = Date.now();
    for (const [key, state] of userStates) {
        if (now - state.timestamp > 10 * 60 * 1000) { // 10 min expiry
            userStates.delete(key);
        }
    }
}
setInterval(cleanupExpiredStates, 5 * 60 * 1000);

async function handleButton(interaction) {
    const { customId } = interaction;
    const guildId = interaction.guild.id;

    // quick_done_{id} handler
    if (customId.startsWith('quick_done_')) {
        return handleQuickDone(interaction, guildId);
    }

    switch (customId) {
        // === Create confirmation flow ===
        case 'confirm_create': return handleConfirmCreate(interaction, guildId);
        case 'edit_create': return handleEditCreate(interaction, guildId);
        case 'cancel_create': return handleCancelCreate(interaction);

        // === Dashboard buttons ===
        case 'todo_add': return handleAddButton(interaction, guildId);
        case 'todo_complete': return handleSelectForAction(interaction, guildId, 'complete');
        case 'todo_edit': return handleSelectForAction(interaction, guildId, 'edit');
        case 'todo_delete': return handleSelectForAction(interaction, guildId, 'delete');
        case 'todo_reopen': return handleSelectForAction(interaction, guildId, 'reopen', 1);
        case 'todo_prev': return handlePageNav(interaction, guildId, -1);
        case 'todo_next': return handlePageNav(interaction, guildId, 1);
        case 'comp_prev': return handleCompPageNav(interaction, guildId, -1);
        case 'comp_next': return handleCompPageNav(interaction, guildId, 1);
        case 'todo_completed': return showCompleted(interaction, guildId);
        case 'todo_back': return handleBack(interaction, guildId);
        default:
            if (customId.startsWith('confirm_delete_')) return handleConfirmDelete(interaction, guildId);
            if (customId.startsWith('cancel_delete_')) return handleCancelDelete(interaction);
    }
}

// === Quick done handler (from reminder/recap buttons) ===

async function handleQuickDone(interaction, guildId) {
    const todoId = parseInt(interaction.customId.replace('quick_done_', ''));
    const todo = getTodoById(todoId, guildId);
    if (!todo) {
        return interaction.reply({ content: 'タスクが見つかりません。', flags: [MessageFlags.Ephemeral] });
    }
    if (todo.completed) {
        return interaction.reply({ content: `#${todoId} は既に完了しています。`, flags: [MessageFlags.Ephemeral] });
    }

    completeTodo(todoId, guildId);

    // Handle recurrence
    if (todo.recurrence && todo.recurrence !== 'none') {
        const { calculateNextDue } = require('./selectHandler');
        if (calculateNextDue) {
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

    // Update the message to show completion
    await interaction.update({
        content: `#${todoId} **${todo.name}** を完了にしました。`,
        components: [],
    });
}

// === Create confirmation handlers ===

async function handleConfirmCreate(interaction, guildId) {
    const stateKey = `${interaction.user.id}_${guildId}`;
    const data = pendingCreations.get(stateKey);
    if (!data) {
        return interaction.update({ content: 'セッションが期限切れです。もう一度コマンドを実行してください。', embeds: [], components: [] });
    }

    // Create the todo
    const result = addTodo(guildId, {
        name: data.name,
        priority: data.priority ?? 0,
        due_date: data.due_date,
        assignee_id: data.assignee_id,
        assignee_type: data.assignee_type || 'user',
        category_id: data.category_id,
        recurrence: data.recurrence,
        created_by: data.created_by,
        reminder_at: data.reminder_at,
    });

    const newTodoId = result.lastInsertRowid;
    pendingCreations.delete(stateKey);

    // Build public announcement embed
    const todoForEmbed = {
        id: newTodoId,
        name: data.name,
        priority: data.priority ?? 0,
        due_date: data.due_date,
        assignee_id: data.assignee_id,
        assignee_type: data.assignee_type || 'user',
        category_name: data.category_name,
        category_emoji: data.category_emoji,
        recurrence: data.recurrence,
        reminder_at: data.reminder_at,
    };
    const embed = buildCreatedEmbed(todoForEmbed, data.created_by);

    // Add a complete button
    const doneButton = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`quick_done_${newTodoId}`)
            .setLabel('完了')
            .setStyle(ButtonStyle.Success)
    );

    // Update the original message to show the created embed (public)
    await interaction.update({ embeds: [embed], components: [doneButton] });

    // Also announce in the configured todo channel if different from current channel
    try {
        const settings = getGuildSettings(guildId);
        if (settings.todo_channel_id && settings.todo_channel_id !== interaction.channelId) {
            const todoChannel = await interaction.client.channels.fetch(settings.todo_channel_id).catch(() => null);
            if (todoChannel) {
                await todoChannel.send({ embeds: [embed], components: [doneButton] });
            }
        }
    } catch (e) {
        console.error('[ConfirmCreate] Failed to announce in todo channel:', e.message);
    }
}

async function handleEditCreate(interaction, guildId) {
    const stateKey = `${interaction.user.id}_${guildId}`;
    const data = pendingCreations.get(stateKey);
    if (!data) {
        return interaction.reply({ content: 'セッションが期限切れです。', flags: [MessageFlags.Ephemeral] });
    }

    const modal = new ModalBuilder()
        .setCustomId('modal_edit_create')
        .setTitle('タスクを編集');

    const nameInput = new TextInputBuilder()
        .setCustomId('create_name')
        .setLabel('タスク名')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setValue(data.name)
        .setMaxLength(100);

    const dueInput = new TextInputBuilder()
        .setCustomId('create_due')
        .setLabel('期限')
        .setStyle(TextInputStyle.Short)
        .setRequired(false);
    if (data.due_date) {
        dueInput.setValue(formatDateDisplayJST(data.due_date));
    }

    const priorityInput = new TextInputBuilder()
        .setCustomId('create_priority')
        .setLabel('重要度 (0=低, 1=中, 2=高, 3=緊急)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setValue(String(data.priority ?? 0))
        .setMaxLength(1);

    const assigneeInput = new TextInputBuilder()
        .setCustomId('create_assignee')
        .setLabel('割り当て先 (ID) ※ user:ID または role:ID')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setValue(data.assignee_id ? `${data.assignee_type || 'user'}:${data.assignee_id}` : '');

    const reminderInput = new TextInputBuilder()
        .setCustomId('create_reminder')
        .setLabel('リマインダー時刻')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setValue(data.reminder_at ? formatDateDisplayJST(data.reminder_at) : '');

    modal.addComponents(
        new ActionRowBuilder().addComponents(nameInput),
        new ActionRowBuilder().addComponents(dueInput),
        new ActionRowBuilder().addComponents(priorityInput),
        new ActionRowBuilder().addComponents(assigneeInput),
        new ActionRowBuilder().addComponents(reminderInput),
    );

    await interaction.showModal(modal);
}

async function handleCancelCreate(interaction) {
    const stateKey = `${interaction.user.id}_${interaction.guild.id}`;
    pendingCreations.delete(stateKey);
    await interaction.update({ content: 'キャンセルしました', embeds: [], components: [] });
}

// === Dashboard handlers ===

async function handleAddButton(interaction, guildId) {
    const settings = getGuildSettings(guildId);

    const modal = new ModalBuilder()
        .setCustomId('modal_add_todo')
        .setTitle('タスクを追加');

    const nameInput = new TextInputBuilder()
        .setCustomId('todo_name')
        .setLabel('タスク名')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100);

    const rows = [new ActionRowBuilder().addComponents(nameInput)];

    if (settings.enabled_fields.includes('due_date')) {
        const dueInput = new TextInputBuilder()
            .setCustomId('todo_due')
            .setLabel('期限')
            .setStyle(TextInputStyle.Short)
            .setRequired(false);
        rows.push(new ActionRowBuilder().addComponents(dueInput));
    }

    modal.addComponents(...rows);
    await interaction.showModal(modal);
}

async function handleSelectForAction(interaction, guildId, action, completed = 0) {
    const todos = getTodos(guildId, { completed, limit: 25 });
    if (todos.length === 0) {
        return interaction.reply({ content: 'タスクがありません。', flags: [MessageFlags.Ephemeral] });
    }

    const options = todos.map(t => ({
        label: `#${t.id} ${t.name}`.slice(0, 100),
        value: `${t.id}`,
        description: t.due_date ? `期限: ${formatDateDisplayJST(t.due_date)}` : undefined,
    }));

    const actionLabels = {
        complete: '完了にするタスクを選択',
        edit: '編集するタスクを選択',
        delete: '削除するタスクを選択',
        reopen: '再開するタスクを選択',
    };

    const select = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`action_${action}`)
            .setPlaceholder(actionLabels[action])
            .addOptions(options)
    );

    await interaction.reply({ components: [select], flags: [MessageFlags.Ephemeral] });
}

async function handlePageNav(interaction, guildId, direction) {
    const footer = interaction.message.embeds[0]?.footer?.text || '';
    const match = footer.match(/ページ (\d+)/);
    const currentPage = match ? parseInt(match[1]) : 1;
    await interaction.deferUpdate();
    await sendTodoList(interaction, guildId, currentPage + direction);
}

async function handleCompPageNav(interaction, guildId, direction) {
    const footer = interaction.message.embeds[0]?.footer?.text || '';
    const match = footer.match(/ページ (\d+)/);
    const currentPage = match ? parseInt(match[1]) : 1;
    await interaction.deferUpdate();
    await sendCompletedList(interaction, guildId, currentPage + direction);
}

async function showCompleted(interaction, guildId) {
    await interaction.deferUpdate();
    await sendCompletedList(interaction, guildId);
}

async function handleBack(interaction, guildId) {
    await interaction.deferUpdate();
    await sendTodoList(interaction, guildId);
}

async function handleConfirmDelete(interaction, guildId) {
    const todoId = parseInt(interaction.customId.replace('confirm_delete_', ''));
    deleteTodo(todoId, guildId);
    await interaction.deferUpdate();
    await sendTodoList(interaction, guildId);
}

async function handleCancelDelete(interaction) {
    await interaction.deferUpdate();
    await sendTodoList(interaction, interaction.guild.id);
}

module.exports = { handleButton, userStates };
