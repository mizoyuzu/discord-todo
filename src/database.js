const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'todo.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initTables();
  }
  return db;
}

function initTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id TEXT PRIMARY KEY,
      enabled_fields TEXT DEFAULT '["name","priority"]',
      reminder_channel_id TEXT,
      todo_channel_id TEXT,
      timezone TEXT DEFAULT 'Asia/Tokyo'
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      name TEXT NOT NULL,
      emoji TEXT DEFAULT '📁',
      UNIQUE(guild_id, name)
    );

    CREATE TABLE IF NOT EXISTS todos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      name TEXT NOT NULL,
      priority INTEGER DEFAULT 0,
      due_date TEXT,
      assignee_id TEXT,
      category_id INTEGER,
      recurrence TEXT,
      completed INTEGER DEFAULT 0,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_todos_guild ON todos(guild_id);
    CREATE INDEX IF NOT EXISTS idx_todos_guild_completed ON todos(guild_id, completed);
    CREATE INDEX IF NOT EXISTS idx_todos_due_date ON todos(due_date);
    CREATE INDEX IF NOT EXISTS idx_categories_guild ON categories(guild_id);
  `);
}

// ── Guild Settings ──

function getGuildSettings(guildId) {
  const db = getDb();
  let row = db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guildId);
  if (!row) {
    db.prepare('INSERT INTO guild_settings (guild_id) VALUES (?)').run(guildId);
    row = db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guildId);
  }
  row.enabled_fields = JSON.parse(row.enabled_fields);
  return row;
}

function updateGuildSettings(guildId, updates) {
  const db = getDb();
  getGuildSettings(guildId); // ensure exists
  const fields = [];
  const values = [];
  for (const [key, value] of Object.entries(updates)) {
    fields.push(`${key} = ?`);
    values.push(key === 'enabled_fields' ? JSON.stringify(value) : value);
  }
  values.push(guildId);
  db.prepare(`UPDATE guild_settings SET ${fields.join(', ')} WHERE guild_id = ?`).run(...values);
}

// ── Categories ──

function getCategories(guildId) {
  return getDb().prepare('SELECT * FROM categories WHERE guild_id = ? ORDER BY name').all(guildId);
}

function addCategory(guildId, name, emoji = '📁') {
  try {
    return getDb().prepare('INSERT INTO categories (guild_id, name, emoji) VALUES (?, ?, ?)').run(guildId, name, emoji);
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') return null;
    throw e;
  }
}

function deleteCategory(guildId, categoryId) {
  return getDb().prepare('DELETE FROM categories WHERE id = ? AND guild_id = ?').run(categoryId, guildId);
}

// ── Todos ──

function addTodo(guildId, data) {
  const db = getDb();
  const now = new Date().toISOString();
  return db.prepare(`
    INSERT INTO todos (guild_id, name, priority, due_date, assignee_id, category_id, recurrence, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    guildId,
    data.name,
    data.priority ?? 0,
    data.due_date ?? null,
    data.assignee_id ?? null,
    data.category_id ?? null,
    data.recurrence ?? null,
    data.created_by,
    now
  );
}

function getTodos(guildId, { completed = 0, limit = 25, offset = 0, categoryId, assigneeId, priority } = {}) {
  const db = getDb();
  let query = 'SELECT t.*, c.name AS category_name, c.emoji AS category_emoji FROM todos t LEFT JOIN categories c ON t.category_id = c.id WHERE t.guild_id = ? AND t.completed = ?';
  const params = [guildId, completed];

  if (categoryId !== undefined && categoryId !== null) {
    query += ' AND t.category_id = ?';
    params.push(categoryId);
  }
  if (assigneeId !== undefined && assigneeId !== null) {
    query += ' AND t.assignee_id = ?';
    params.push(assigneeId);
  }
  if (priority !== undefined && priority !== null) {
    query += ' AND t.priority = ?';
    params.push(priority);
  }

  query += ' ORDER BY t.priority DESC, t.due_date ASC NULLS LAST, t.created_at ASC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  return db.prepare(query).all(...params);
}

function getTodoCount(guildId, completed = 0) {
  return getDb().prepare('SELECT COUNT(*) as count FROM todos WHERE guild_id = ? AND completed = ?').get(guildId, completed).count;
}

function getTodoById(todoId, guildId) {
  return getDb().prepare('SELECT t.*, c.name AS category_name, c.emoji AS category_emoji FROM todos t LEFT JOIN categories c ON t.category_id = c.id WHERE t.id = ? AND t.guild_id = ?').get(todoId, guildId);
}

function updateTodo(todoId, guildId, updates) {
  const db = getDb();
  const fields = [];
  const values = [];
  for (const [key, value] of Object.entries(updates)) {
    fields.push(`${key} = ?`);
    values.push(value);
  }
  values.push(todoId, guildId);
  return db.prepare(`UPDATE todos SET ${fields.join(', ')} WHERE id = ? AND guild_id = ?`).run(...values);
}

function completeTodo(todoId, guildId) {
  const now = new Date().toISOString();
  return getDb().prepare('UPDATE todos SET completed = 1, completed_at = ? WHERE id = ? AND guild_id = ?').run(now, todoId, guildId);
}

function reopenTodo(todoId, guildId) {
  return getDb().prepare('UPDATE todos SET completed = 0, completed_at = NULL WHERE id = ? AND guild_id = ?').run(todoId, guildId);
}

function deleteTodo(todoId, guildId) {
  return getDb().prepare('DELETE FROM todos WHERE id = ? AND guild_id = ?').run(todoId, guildId);
}

function getTodosDueToday(guildId, dateStr) {
  return getDb().prepare(`
    SELECT t.*, c.name AS category_name, c.emoji AS category_emoji
    FROM todos t LEFT JOIN categories c ON t.category_id = c.id
    WHERE t.guild_id = ? AND t.completed = 0 AND date(t.due_date) = date(?)
    ORDER BY t.priority DESC
  `).all(guildId, dateStr);
}

function getOverdueTodos(guildId, dateStr) {
  return getDb().prepare(`
    SELECT t.*, c.name AS category_name, c.emoji AS category_emoji
    FROM todos t LEFT JOIN categories c ON t.category_id = c.id
    WHERE t.guild_id = ? AND t.completed = 0 AND date(t.due_date) < date(?)
    ORDER BY t.due_date ASC
  `).all(guildId, dateStr);
}

function getAllGuildsWithReminders() {
  return getDb().prepare('SELECT * FROM guild_settings WHERE reminder_channel_id IS NOT NULL').all();
}

module.exports = {
  getDb,
  getGuildSettings,
  updateGuildSettings,
  getCategories,
  addCategory,
  deleteCategory,
  addTodo,
  getTodos,
  getTodoCount,
  getTodoById,
  updateTodo,
  completeTodo,
  reopenTodo,
  deleteTodo,
  getTodosDueToday,
  getOverdueTodos,
  getAllGuildsWithReminders,
};
