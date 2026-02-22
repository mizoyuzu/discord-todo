const cron = require('node-cron');
const { getAllGuildsWithReminders, getTodosDueToday, getOverdueTodos } = require('./database');
const { buildReminderEmbed } = require('./utils/embeds');

function startReminder(client) {
    // Run at 08:00 JST (= 23:00 UTC previous day)
    cron.schedule('0 23 * * *', async () => {
        console.log('[Reminder] Running daily reminder check...');
        try {
            const guilds = getAllGuildsWithReminders();

            for (const guild of guilds) {
                try {
                    const tz = guild.timezone || 'Asia/Tokyo';
                    const now = new Date();
                    const todayStr = now.toLocaleDateString('sv-SE', { timeZone: tz }); // YYYY-MM-DD format

                    const todayTodos = getTodosDueToday(guild.guild_id, todayStr);
                    const overdueTodos = getOverdueTodos(guild.guild_id, todayStr);

                    if (todayTodos.length === 0 && overdueTodos.length === 0) continue;

                    const channel = await client.channels.fetch(guild.reminder_channel_id).catch(() => null);
                    if (!channel) continue;

                    const embed = buildReminderEmbed(todayTodos, overdueTodos, client);
                    await channel.send({ embeds: [embed] });
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

    console.log('[Reminder] Scheduled daily reminder at 08:00 JST');
}

module.exports = { startReminder };
