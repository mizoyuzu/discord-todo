const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, MessageFlags } = require('discord.js');
const { getTodos, getTodoById, completeTodo, addTodo } = require('../database');
const { formatDateDisplayJST } = require('../utils/timezone');

const command = new SlashCommandBuilder()
    .setName('done')
    .setDescription('タスクを完了にします')
    .addIntegerOption(option =>
        option.setName('id')
            .setDescription('タスクID')
            .setRequired(false)
    );

async function execute(interaction) {
    const guildId = interaction.guild.id;
    const todoId = interaction.options.getInteger('id');

    if (todoId) {
        // Direct completion by ID
        const todo = getTodoById(todoId, guildId);
        if (!todo) {
            return interaction.reply({ content: `#${todoId} は見つかりません。`, flags: [MessageFlags.Ephemeral] });
        }
        if (todo.completed) {
            return interaction.reply({ content: `#${todoId} は既に完了しています。`, flags: [MessageFlags.Ephemeral] });
        }

        completeTodo(todoId, guildId);

        // Handle recurrence
        if (todo.recurrence && todo.recurrence !== 'none') {
            const { calculateNextDue } = require('../handlers/selectHandler');
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

        return interaction.reply({ content: `#${todoId} **${todo.name}** を完了にしました。` });
    }

    // Show select menu of open todos
    const todos = getTodos(guildId, { completed: 0, limit: 25 });
    if (todos.length === 0) {
        return interaction.reply({ content: '未完了のタスクはありません。', flags: [MessageFlags.Ephemeral] });
    }

    const options = todos.map(t => ({
        label: `#${t.id} ${t.name}`.slice(0, 100),
        value: `${t.id}`,
        description: t.due_date ? `期限: ${formatDateDisplayJST(t.due_date)}` : undefined,
    }));

    const select = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('action_complete')
            .setPlaceholder('完了にするタスクを選択')
            .addOptions(options)
    );

    await interaction.reply({ components: [select], flags: [MessageFlags.Ephemeral] });
}

module.exports = { data: command, execute };
