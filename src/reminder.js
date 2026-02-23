const cron = require('node-cron');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const {
    getAllGuildsWithReminders, getTodosDueToday, getOverdueTodos,
    getPendingReminders, markReminderSent,
} = require('./database');
const { buildRecapEmbed, buildReminderNotificationEmbed } = require('./utils/embeds');
const { todayJST, nowJST, formatMention } = require('./utils/timezone');

/**
 * Build action components for a list of tasks.
 * - 1 task: single "完了" button
 * - multiple tasks: StringSelectMenu to pick which to complete + confirm button
 */
function buildTaskActionComponents(todos) {
    const rows = [];
    if (todos.length === 1) {
        rows.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`quick_done_${todos[0].id}`)
                .setLabel('完了')
                .setStyle(ButtonStyle.Success)
        ));
    } else if (todos.length > 1) {
        const options = todos.slice(0, 25).map(t => ({
            label: `#${t.id} ${t.name}`.slice(0, 100),
            value: `${t.id}`,
        }));
        rows.push(new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('select_done')
                .setPlaceholder('完了にするタスクを選択')
                .setMinValues(1)
                .setMaxValues(options.length)
                .addOptions(options)
        ));
    }
    return rows;
}

function startReminder(client) {
    // Daily recap at 08:00 JST (= 23:00 UTC previous day)
    cron.schedule('0 23 * * *', async () => {
        console.log('[Reminder] Running daily recap...');
        try {
            const guilds = getAllGuildsWithReminders();

            for (const guild of guilds) {
                try {
                    const todayStr = todayJST();

                    const todayTodos = getTodosDueToday(guild.guild_id, todayStr);
                    const overdueTodos = getOverdueTodos(guild.guild_id, todayStr);

                    if (todayTodos.length === 0 && overdueTodos.length === 0) continue;

                    const channel = await client.channels.fetch(guild.reminder_channel_id).catch(() => null);
                    if (!channel) continue;

                    const embed = buildRecapEmbed(todayTodos, overdueTodos);
                    const allTodos = [...overdueTodos, ...todayTodos];
                    const components = buildTaskActionComponents(allTodos);

                    // Build mention string for assignees
                    const mentions = [...new Set(allTodos.filter(t => t.assignee_id).map(t => formatMention(t.assignee_id, t.assignee_type)))];
                    const content = mentions.length > 0 ? mentions.join(' ') : undefined;

                    await channel.send({ content, embeds: [embed], components });
                } catch (err) {
                    console.error(`[Reminder] Error for guild ${guild.guild_id}:`, err.message);
                }
            }
        } catch (err) {
            console.error('[Reminder] Global error:', err.message);
        }
    }, {
        timezone: 'Asia/Tokyo',
    });

    console.log('[Reminder] Scheduled daily recap at 08:00 JST');

    // Per-minute check for individual reminder_at notifications
    cron.schedule('* * * * *', async () => {
        try {
            const guilds = getAllGuildsWithReminders();

            for (const guild of guilds) {
                try {
                    const nowStr = nowJST();

                    const pending = getPendingReminders(guild.guild_id, nowStr);
                    if (pending.length === 0) continue;

                    const channel = await client.channels.fetch(guild.reminder_channel_id).catch(() => null);
                    if (!channel) continue;

                    for (const todo of pending) {
                        try {
                            const embed = buildReminderNotificationEmbed(todo);
                            const components = buildTaskActionComponents([todo]);
                            const content = todo.assignee_id ? formatMention(todo.assignee_id, todo.assignee_type) : undefined;

                            await channel.send({ content, embeds: [embed], components });
                            markReminderSent(todo.id, guild.guild_id);
                        } catch (err) {
                            console.error(`[Reminder] Failed to send reminder for todo ${todo.id}:`, err.message);
                        }
                    }
                } catch (err) {
                    console.error(`[Reminder] Per-minute error for guild ${guild.guild_id}:`, err.message);
                }
            }
        } catch (err) {
            console.error('[Reminder] Per-minute global error:', err.message);
        }
    }, {
        timezone: 'Asia/Tokyo',
    });

    console.log('[Reminder] Scheduled per-minute reminder check');
}

module.exports = { startReminder, buildTaskActionComponents };
