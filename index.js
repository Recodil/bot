const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, REST, Routes, StringSelectMenuBuilder, ActionRowBuilder, MessageFlags } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const { DateTime } = require('luxon');

// Инициализация клиента
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Подключение к БД
const db = new sqlite3.Database('events.db', (err) => {
    if (err) console.error('Ошибка подключения к БД:', err.message);
});

// Создание таблиц
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT,
            name TEXT,
            time TEXT,
            description TEXT,
            link TEXT,
            role_id TEXT
        )
    `);
    db.run(`
        CREATE TABLE IF NOT EXISTS settings (
            guild_id TEXT PRIMARY KEY,
            role_id TEXT,
            channel_id TEXT
        )
    `);
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            user_id TEXT PRIMARY KEY,
            timezone TEXT
        )
    `);
});

// Функция проверки событий
function checkEvents() {
    const now = DateTime.utc();
    const fifteenMinutesFromNow = now.plus({ minutes: 15 });

    db.all(
        `SELECT * FROM events WHERE datetime(time) BETWEEN datetime(?) AND datetime(?)`,
        [now.toISO(), fifteenMinutesFromNow.toISO()],
        async (err, rows) => {
            if (err || !rows) return;

            for (const event of rows) {
                const guild = await client.guilds.fetch(event.guild_id).catch(console.error);
                if (!guild) continue;

                db.get(
                    `SELECT channel_id, role_id FROM settings WHERE guild_id = ?`,
                    [guild.id],
                    async (err, settings) => {
                        if (!settings) return;

                        const channel = await guild.channels.fetch(settings.channel_id).catch(console.error);
                        const role = await guild.roles.fetch(settings.role_id).catch(console.error);
                        if (!channel || !role) return;

                        const eventTime = DateTime.fromISO(event.time).setZone('utc');
                        const localTime = eventTime.setZone('local').toFormat('yyyy-MM-dd HH:mm');

                        const embed = new EmbedBuilder()
                            .setTitle(`⚠️ Event Reminder: ${event.name}`)
                            .setDescription(`Event starts in 15 minutes! ${role}\n\n**Time:** ${localTime} (local time)`)
                            .setColor(0xFFD700)
                            .addFields(
                                { name: 'Description', value: event.description },
                                { name: 'Link', value: event.link ? `[Join here](${event.link})` : 'No link provided' }
                            )
                            .setTimestamp();

                        await channel.send({ embeds: [embed] });
                        db.run(`DELETE FROM events WHERE id = ?`, [event.id]);
                    }
                );
            }
        }
    );
}

// Планировщик задач
setInterval(checkEvents, 60000);

// Список слэш-команд
const commands = [
    new SlashCommandBuilder()
        .setName('setrole')
        .setDescription('Set the notification role')
        .addRoleOption(option => option.setName('role').setDescription('Role to mention').setRequired(true)),

    new SlashCommandBuilder()
        .setName('setchannel')
        .setDescription('Set the notification channel')
        .addChannelOption(option => option.setName('channel').setDescription('Channel to send reminders').setRequired(true)),

    new SlashCommandBuilder()
        .setName('createevent')
        .setDescription('Create a new event')
        .addStringOption(option => option.setName('name').setDescription('Event name').setRequired(true))
        .addStringOption(option => option.setName('time').setDescription('Event time (e.g. 15:30 or 2024-03-20 18:00)').setRequired(true))
        .addStringOption(option => option.setName('timezone').setDescription('Your timezone (e.g. Europe/London)').setRequired(true))
        .addStringOption(option => option.setName('description').setDescription('Description of event').setRequired(true))
        .addStringOption(option => option.setName('link').setDescription('Optional link for event')),

    new SlashCommandBuilder()
        .setName('events')
        .setDescription('View all upcoming events'),

    new SlashCommandBuilder()
        .setName('deleteevent')
        .setDescription('Delete an event by ID')
        .addIntegerOption(option => 
            option.setName('id')
                .setDescription('Event ID to delete')
                .setRequired(true)
        ),

 new SlashCommandBuilder()
        .setName('selecttimezone')
        .setDescription('Select your timezone from a dropdown menu'),
        new SlashCommandBuilder()
        .setName('say')
        .setDescription('Send a message as the bot')
        .addChannelOption(option => option.setName('channel').setDescription('Channel to send message').setRequired(true))
        .addStringOption(option => option.setName('message').setDescription('Message to send').setRequired(true)),
    new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Check the bot\'s latency and heartbeat')
];

// Регистрация слэш-команд
const rest = new REST({ version: '10' }).setToken('MTM5MDI3NTgyODk0Nzg4MjA0NQ.GzrN-H.yDlat9AWyKGECkVe9g7jqCtAzaY-n3iCtQg1lk');

(async () => {
    try {
        console.log('Started refreshing application (/) commands.');
        await rest.put(
            Routes.applicationCommands('1390275828947882045'),
            { body: commands }
        );
        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error('Error registering commands:', error);
    }
})();

// Обработка слэш-команд
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand()) return;

    const { commandName } = interaction;

    // /setrole
    if (commandName === 'setrole') {
        if (!interaction.member.permissions.has('Administrator')) {
            return interaction.reply({ content: '❌ You need administrator permissions.', ephemeral: true });
        }

        const role = interaction.options.getRole('role');
        db.run(
            `INSERT OR REPLACE INTO settings (guild_id, role_id) VALUES (?, ?)`,
            [interaction.guild.id, role.id],
            () => {
                interaction.reply({ content: `✅ Notification role set to: ${role.name}` });
            }
        );
    }

    // /setchannel
    if (commandName === 'setchannel') {
        if (!interaction.member.permissions.has('Administrator')) {
            return interaction.reply({ content: '❌ You need administrator permissions.', ephemeral: true });
        }

        const channel = interaction.options.getChannel('channel');
        db.run(
            `INSERT OR REPLACE INTO settings (guild_id, channel_id) VALUES (?, ?)`,
            [interaction.guild.id, channel.id],
            () => {
                interaction.reply({ content: `✅ Notification channel set to: ${channel.name}` });
            }
        );
    }

    // /createevent
    if (commandName === 'createevent') {
        const name = interaction.options.getString('name');
        const rawTimeInput = interaction.options.getString('time');
        const timezone = interaction.options.getString('timezone');
        const description = interaction.options.getString('description');
        const link = interaction.options.getString('link') || null;

        let eventTime;
        try {
            // Проверяем формат: только время (HH:mm)
            const timeOnlyRegex = /^(\d{1,2}):(\d{2})$/;
            const timeOnlyMatch = rawTimeInput.match(timeOnlyRegex);

            if (timeOnlyMatch) {
                const [_, hours, minutes] = timeOnlyMatch;
                const now = DateTime.local().setZone(timezone);
                const todayAtInputTime = now.set({ hour: parseInt(hours), minute: parseInt(minutes), second: 0, millisecond: 0 });

                // Если время уже прошло сегодня — ставим на завтра
                eventTime = todayAtInputTime > now ? todayAtInputTime : todayAtInputTime.plus({ days: 1 });
            } else {
                // Используем полный формат даты и времени
                eventTime = DateTime.fromFormat(rawTimeInput, 'yyyy-MM-dd HH:mm', { zone: timezone });
                if (!eventTime.isValid) throw new Error('Invalid date format');
            }

            db.get(
                `SELECT role_id FROM settings WHERE guild_id = ?`,
                [interaction.guild.id],
                (err, row) => {
                    if (!row) {
                        return interaction.reply({ content: '⚠️ First set notification role with /setrole', ephemeral: true });
                    }

                    db.run(
                        `INSERT INTO events (guild_id, name, time, description, link, role_id) VALUES (?, ?, ?, ?, ?, ?)`,
                        [
                            interaction.guild.id,
                            name,
                            eventTime.toUTC().toISO(),
                            description,
                            link,
                            row.role_id
                        ],
                        () => {
                            const formattedTime = eventTime.setZone(timezone).toFormat('yyyy-MM-dd HH:mm');
                            interaction.reply({ 
                                content: `✅ Event "${name}" created successfully for ${formattedTime} (${timezone})!` 
                            });
                        }
                    );
                }
            );
        } catch (err) {
            return interaction.reply({ 
                content: '❌ Invalid time format. Use:\n- `HH:mm` (e.g. 15:30) for today/tomorrow\n- `YYYY-MM-DD HH:mm` for full date', 
                ephemeral: true 
            });
        }
    }

    // /events
    if (commandName === 'events') {
        db.all(
            `SELECT * FROM events WHERE guild_id = ? ORDER BY time ASC`,
            [interaction.guild.id],
            async (err, rows) => {
                if (!rows || rows.length === 0) {
                    return interaction.reply({ content: '📅 No upcoming events.' });
                }

                const embed = new EmbedBuilder()
                    .setTitle('📅 Upcoming Events')
                    .setColor(0x00BFFF);

                for (const event of rows) {
                    const eventTime = DateTime.fromISO(event.time).setZone('utc');
                    const userTimezone = await new Promise(resolve => {
                        db.get(
                            `SELECT timezone FROM users WHERE user_id = ?`,
                            [interaction.user.id],
                            (_, row) => resolve(row?.timezone || 'UTC')
                        );
                    });

                    const localTime = eventTime.setZone(userTimezone).toFormat('yyyy-MM-dd HH:mm');

                    embed.addFields({
                        name: `ID: ${event.id} — ${event.name} (${localTime})`,
                        value: `${event.description}\n🔗 [${event.link ? 'Join here' : 'No link'}](${event.link || '#'})`,
                        inline: false
                    });
                }

                interaction.reply({ embeds: [embed] });
            }
        );
    }

    // /deleteevent
    if (commandName === 'deleteevent') {
        if (!interaction.member.permissions.has('Administrator')) {
            return interaction.reply({ 
                content: '❌ You need administrator permissions.', 
                ephemeral: true 
            });
        }

        const eventId = interaction.options.getInteger('id');

        db.get(
            `SELECT * FROM events WHERE id = ? AND guild_id = ?`,
            [eventId, interaction.guild.id],
            (err, row) => {
                if (!row) {
                    return interaction.reply({ 
                        content: '❌ Event not found or does not belong to this server.', 
                        ephemeral: true 
                    });
                }

                db.run(
                    `DELETE FROM events WHERE id = ? AND guild_id = ?`,
                    [eventId, interaction.guild.id],
                    () => {
                        interaction.reply({ 
                            content: `✅ Event ID:${eventId} deleted successfully.` 
                        });
                    }
                );
            }
        );
    }
 // /selecttimezone
    if (commandName === 'selecttimezone') {
    const embed = new EmbedBuilder()
        .setTitle('🌍 Select Your Timezone')
        .setDescription('Choose your timezone from the dropdown menu below')
        .setColor(0x00AE86)
        .setTimestamp();

    const timeZoneMenu = new StringSelectMenuBuilder()
        .setCustomId('timezone_selector')
        .setPlaceholder('Choose a timezone')
        .addOptions([
            {
                label: 'UTC',
                description: 'Coordinated Universal Time',
                value: 'UTC'
            },
            {
                label: 'London',
                description: 'Europe/London',
                value: 'Europe/London'
            },
            {
                label: 'New York',
                description: 'America/New_York',
                value: 'America/New_York'
            },
            {
                label: 'Tokyo',
                description: 'Asia/Tokyo',
                value: 'Asia/Tokyo'
            },
            {
                label: 'Sydney',
                description: 'Australia/Sydney',
                value: 'Australia/Sydney'
            }
        ]);

    const row = new ActionRowBuilder().addComponents(timeZoneMenu);

    await interaction.reply({
        embeds: [embed],
        components: [row],
        flags: [MessageFlags.Ephemeral] // Вместо ephemeral: true
    });
}
    // /say
    if (commandName === 'say') {
        if (!interaction.member.permissions.has('Administrator')) {
            return interaction.reply({ content: '❌ You need administrator permissions.', ephemeral: true });
        }
        const channel = interaction.options.getChannel('channel');
        const message = interaction.options.getString('message');
        channel.send(message);
        interaction.reply({ content: '✅ Message sent!', ephemeral: true });
    }

    // /ping
    if (commandName === 'ping') {
        const sent = await interaction.reply({ 
            content: 'Pinging...', 
            fetchReply: true 
        });
        
        const heartbeat = Math.round(client.ws.ping);
        const roundtrip = sent.createdTimestamp - interaction.createdTimestamp;
        
        await interaction.editReply({
            content: `🏓 **Pong!**\n` +
                    `┕ **Websocket Heartbeat:** ${heartbeat}ms\n` +
                    `┕ **Roundtrip Latency:** ${roundtrip}ms`
        });
    }
});

// Обработка Select Menu
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isStringSelectMenu()) return;
    
    if (interaction.customId === 'timezone_selector') {
        const selectedTimezone = interaction.values[0];
        
        try {
            DateTime.local().setZone(selectedTimezone);
            
            db.run(
                `INSERT OR REPLACE INTO users (user_id, timezone) VALUES (?, ?)`,
                [interaction.user.id, selectedTimezone],
                async () => {
                    await interaction.update({
                        content: `✅ Selected timezone: ${selectedTimezone}`,
                        embeds: [],
                        components: []
                    });
                }
            );
        } catch (error) {
            console.error('Invalid timezone:', error);
            await interaction.reply({
                content: '❌ Invalid timezone selected. Please try again.',
                ephemeral: true
            });
        }
    }
});

// Обработка автоответчиков
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    const content = message.content.toLowerCase();
    
    if (content.includes("what's group")) {
        message.reply("the group is https://www.roblox.com/communities/35289911/Guardian-tostia-travel ");
    }
    else if (/i( |')dont have access/.test(content)) {
        message.reply("Ping @Community Director or make a #ticket !");
    }
    else if (message.content.trim().length === 1 && !message.content.includes("<:")) {
        message.reply(`Hey, <@${message.author.id}>, stop doing that! I see all!`);
    }
});

// Запуск бота
client.once('ready', () => {
    console.log(`✅ Bot logged in as ${client.user.tag}`);
});
client.login('MTM5MDI3NTgyODk0Nzg4MjA0NQ.GzrN-H.yDlat9AWyKGECkVe9g7jqCtAzaY-n3iCtQg1lk');
