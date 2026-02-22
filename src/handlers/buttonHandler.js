const {
    ModalBuilder, TextInputBuilder, TextInputStyle,
    ActionRowBuilder, StringSelectMenuBuilder, UserSelectMenuBuilder,
    ButtonBuilder, ButtonStyle,
} = require('discord.js');
const { getGuildSettings, getTodos, completeTodo, reopenTodo, deleteTodo, addTodo, getTodoById } = require('../database');
const { sendTodoList, sendCompletedList } = require('../utils/pagination');

// State management for multi-step interactions
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

    switch (customId) {
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

async function handleAddButton(interaction, guildId) {
    const settings = getGuildSettings(guildId);

    const modal = new ModalBuilder()
        .setCustomId('modal_add_todo')
        .setTitle('📝 タスクを追加');

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
            .setLabel('期限（自然言語OK: "明日", "来週月曜"）')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setPlaceholder('例: 明日の15時, 3日後, 来週金曜');
        rows.push(new ActionRowBuilder().addComponents(dueInput));
    }

    modal.addComponents(...rows);
    await interaction.showModal(modal);
}

async function handleSelectForAction(interaction, guildId, action, completed = 0) {
    const todos = getTodos(guildId, { completed, limit: 25 });
    if (todos.length === 0) {
        return interaction.reply({ content: 'タスクがありません。', ephemeral: true });
    }

    const options = todos.map(t => ({
        label: `#${t.id} ${t.name}`.slice(0, 100),
        value: `${t.id}`,
        description: t.due_date ? `期限: ${new Date(t.due_date).toLocaleDateString('ja-JP')}` : undefined,
    }));

    const actionLabels = {
        complete: '✅ 完了にするタスクを選択',
        edit: '📝 編集するタスクを選択',
        delete: '🗑️ 削除するタスクを選択',
        reopen: '🔄 再開するタスクを選択',
    };

    const select = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`action_${action}`)
            .setPlaceholder(actionLabels[action])
            .addOptions(options)
    );

    await interaction.reply({ components: [select], ephemeral: true });
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
