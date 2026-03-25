require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const Database = require('better-sqlite3');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const APP_PASSWORD = process.env.APP_PASSWORD || 'changeme123';
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';
const DEFAULT_WEEKLY_TARGET = 4;
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : __dirname;

require('fs').mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'tracker.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS habits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (date('now'))
);

CREATE TABLE IF NOT EXISTS checkins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  habit_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  UNIQUE(habit_id, day),
  FOREIGN KEY (habit_id) REFERENCES habits(id) ON DELETE CASCADE
);
`);

const habitColumns = db.prepare('PRAGMA table_info(habits)').all();
if (!habitColumns.some((column) => column.name === 'archived')) {
  db.exec('ALTER TABLE habits ADD COLUMN archived INTEGER NOT NULL DEFAULT 0');
}
if (!habitColumns.some((column) => column.name === 'weekly_target')) {
  db.exec(`ALTER TABLE habits ADD COLUMN weekly_target INTEGER NOT NULL DEFAULT ${DEFAULT_WEEKLY_TARGET}`);
}

const listActiveHabitsStmt = db.prepare('SELECT id, name, created_at, weekly_target FROM habits WHERE archived = 0 ORDER BY created_at ASC, id ASC');
const listArchivedHabitsStmt = db.prepare('SELECT id, name, created_at, weekly_target FROM habits WHERE archived = 1 ORDER BY created_at ASC, id ASC');
const listHabitsByStateStmt = db.prepare('SELECT id, name, created_at, archived, weekly_target FROM habits WHERE archived = ? ORDER BY created_at ASC, id ASC');
const addHabitStmt = db.prepare('INSERT INTO habits (name, weekly_target) VALUES (?, ?)');
const deleteHabitStmt = db.prepare('DELETE FROM habits WHERE id = ?');
const updateHabitNameStmt = db.prepare('UPDATE habits SET name = ? WHERE id = ?');
const updateHabitTargetStmt = db.prepare('UPDATE habits SET weekly_target = ? WHERE id = ?');
const updateHabitNameTargetStmt = db.prepare('UPDATE habits SET name = ?, weekly_target = ? WHERE id = ?');
const archiveHabitStmt = db.prepare('UPDATE habits SET archived = 1 WHERE id = ?');
const unarchiveHabitStmt = db.prepare('UPDATE habits SET archived = 0 WHERE id = ?');
const getActiveHabitByIdStmt = db.prepare('SELECT id, name FROM habits WHERE id = ? AND archived = 0');
const getOneCheckinStmt = db.prepare('SELECT id, done FROM checkins WHERE habit_id = ? AND day = ?');
const insertCheckinStmt = db.prepare('INSERT INTO checkins (habit_id, day, done) VALUES (?, ?, ?)');
const updateCheckinStmt = db.prepare('UPDATE checkins SET done = ? WHERE id = ?');
const getCheckinsForRangeActiveStmt = db.prepare(`
  SELECT c.habit_id, c.day, c.done
  FROM checkins c
  JOIN habits h ON h.id = c.habit_id
  WHERE c.day BETWEEN ? AND ? AND c.done = 1 AND h.archived = 0
`);
const getCompletedByDayActiveStmt = db.prepare(`
  SELECT c.day, COUNT(*) AS completed
  FROM checkins c
  JOIN habits h ON h.id = c.habit_id
  WHERE c.day BETWEEN ? AND ? AND c.done = 1 AND h.archived = 0
  GROUP BY c.day
`);
const getCompletedByHabitInRangeStmt = db.prepare(`
  SELECT c.habit_id, COUNT(*) AS completed
  FROM checkins c
  JOIN habits h ON h.id = c.habit_id
  WHERE c.day BETWEEN ? AND ? AND c.done = 1 AND h.archived = 0
  GROUP BY c.habit_id
`);
const getCompletedAllTimeActiveStmt = db.prepare(`
  SELECT COUNT(*) AS total
  FROM checkins c
  JOIN habits h ON h.id = c.habit_id
  WHERE c.done = 1 AND h.archived = 0
`);

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      maxAge: 1000 * 60 * 60 * 24 * 14
    }
  })
);

function isValidDay(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseWeeklyTarget(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 7) {
    return null;
  }
  return n;
}

function formatLocalDay(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseDay(day) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function startOfWeekMonday(date) {
  const out = new Date(date);
  const mondayOffset = (out.getDay() + 6) % 7;
  out.setDate(out.getDate() - mondayOffset);
  return out;
}

function endOfWeekMonday(date) {
  const start = startOfWeekMonday(date);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return end;
}

function daysInYear(year) {
  const start = new Date(year, 0, 1);
  const end = new Date(year, 11, 31);
  const out = [];
  const current = new Date(start);
  while (current <= end) {
    out.push(formatLocalDay(current));
    current.setDate(current.getDate() + 1);
  }
  return out;
}

function startOfYear(year) {
  return `${year}-01-01`;
}

function endOfYear(year) {
  return `${year}-12-31`;
}

function calcHeatLevel(completed, total) {
  if (!total || completed <= 0) return 0;
  const ratio = completed / total;
  if (ratio < 0.34) return 1;
  if (ratio < 0.67) return 2;
  if (ratio < 1) return 3;
  return 4;
}

function buildDayTasks(day, habits, doneMap) {
  return habits.map((habit) => ({
    habitId: habit.id,
    name: habit.name,
    weeklyTarget: habit.weekly_target,
    done: Boolean(doneMap.get(`${habit.id}|${day}`))
  }));
}

function summarizeForDay(day, habits, doneMap) {
  const tasks = buildDayTasks(day, habits, doneMap);
  const completed = tasks.reduce((sum, task) => sum + (task.done ? 1 : 0), 0);
  return {
    day,
    total: habits.length,
    completed,
    tasks
  };
}

function buildDashboard(year, selectedDay) {
  const now = new Date();
  const today = formatLocalDay(now);
  const habits = listActiveHabitsStmt.all();
  const archivedHabits = listArchivedHabitsStmt.all();
  const habitsById = new Map(habits.map((habit) => [habit.id, habit]));

  const weekStart = formatLocalDay(startOfWeekMonday(now));
  const weekEnd = formatLocalDay(endOfWeekMonday(now));

  const yearStart = startOfYear(year);
  const yearEnd = endOfYear(year);
  const dayList = daysInYear(year);

  const completedRows = getCheckinsForRangeActiveStmt.all(yearStart, yearEnd);
  const doneMap = new Map();
  for (const row of completedRows) {
    doneMap.set(`${row.habit_id}|${row.day}`, 1);
  }

  const weeklyCompletedRows = getCompletedByHabitInRangeStmt.all(weekStart, weekEnd);
  const weeklyByHabit = new Map();
  for (const row of weeklyCompletedRows) {
    weeklyByHabit.set(row.habit_id, Number(row.completed));
  }

  const completedByDayRows = getCompletedByDayActiveStmt.all(yearStart, yearEnd);
  const completedByDay = new Map();
  for (const row of completedByDayRows) {
    completedByDay.set(row.day, Number(row.completed));
  }

  const heatmap = dayList.map((day) => {
    const completed = completedByDay.get(day) || 0;
    return {
      day,
      completed,
      total: habits.length,
      level: calcHeatLevel(completed, habits.length),
      isToday: day === today
    };
  });

  const selected = isValidDay(selectedDay) ? selectedDay : today;
  const selectedSummary = summarizeForDay(selected, habits, doneMap);
  const todaySummary = summarizeForDay(today, habits, doneMap);

  const todayTasks = todaySummary.tasks.map((task) => {
    const completed = weeklyByHabit.get(task.habitId) || 0;
    const target = task.weeklyTarget;
    const progress = Math.min(100, Math.round((completed / target) * 100));
    return {
      ...task,
      weeklyCompleted: completed,
      weeklyProgress: progress,
      weeklyMet: completed >= target
    };
  });

  const allTimeCompleted = Number(getCompletedAllTimeActiveStmt.get().total || 0);
  const upto = parseDay(today);

  let currentStreak = 0;
  for (let i = heatmap.length - 1; i >= 0; i -= 1) {
    const day = parseDay(heatmap[i].day);
    if (day > upto) continue;
    if (heatmap[i].completed > 0) {
      currentStreak += 1;
    } else {
      break;
    }
  }

  let bestStreak = 0;
  let running = 0;
  for (const day of heatmap) {
    if (parseDay(day.day) > upto) break;
    if (day.completed > 0) {
      running += 1;
      bestStreak = Math.max(bestStreak, running);
    } else {
      running = 0;
    }
  }

  const firstHabitDay = habits.length
    ? habits.reduce((min, habit) => (habit.created_at < min ? habit.created_at : min), habits[0].created_at)
    : today;
  const startDate = parseDay(firstHabitDay);
  const daySpan = habits.length ? Math.max(1, Math.floor((upto - startDate) / (1000 * 60 * 60 * 24)) + 1) : 0;
  const possibleCompletions = habits.length * daySpan;
  const completionRate = possibleCompletions ? Math.round((allTimeCompleted / possibleCompletions) * 1000) / 10 : 0;

  const weeklyGoalsMet = habits.reduce((sum, habit) => {
    const completed = weeklyByHabit.get(habit.id) || 0;
    return sum + (completed >= habit.weekly_target ? 1 : 0);
  }, 0);

  return {
    year,
    today,
    selectedDay: selected,
    weekStart,
    weekEnd,
    habits,
    archivedHabits,
    todayTasks,
    selectedSummary,
    heatmap,
    stats: {
      totalHabits: habits.length,
      archivedHabits: archivedHabits.length,
      completedAllTime: allTimeCompleted,
      possibleCompletions,
      completionRate,
      currentStreak,
      bestStreak,
      weeklyGoalsMet
    }
  };
}

function authRequired(req, res, next) {
  if (req.session && req.session.authenticated) {
    return next();
  }
  return res.status(401).json({ error: 'Unauthorized' });
}

app.get('/', (req, res) => {
  if (req.session && req.session.authenticated) {
    return res.sendFile(path.join(__dirname, 'public', 'app.html'));
  }
  return res.redirect('/login');
});

app.get('/login', (req, res) => {
  if (req.session && req.session.authenticated) {
    return res.redirect('/');
  }
  return res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', (req, res) => {
  const password = String(req.body.password || '');
  if (password === APP_PASSWORD) {
    req.session.authenticated = true;
    return res.redirect('/');
  }
  return res.status(401).sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

app.use('/static', express.static(path.join(__dirname, 'public')));

app.get('/api/habits', authRequired, (req, res) => {
  const archived = String(req.query.archived || '0') === '1' ? 1 : 0;
  return res.json({ habits: listHabitsByStateStmt.all(archived) });
});

app.post('/api/habits', authRequired, (req, res) => {
  const name = String(req.body.name || '').trim();
  const weeklyTarget = parseWeeklyTarget(req.body.weeklyTarget ?? DEFAULT_WEEKLY_TARGET);
  if (!name) {
    return res.status(400).json({ error: 'Task name is required.' });
  }
  if (!weeklyTarget) {
    return res.status(400).json({ error: 'Weekly target must be an integer between 1 and 7.' });
  }

  try {
    const result = addHabitStmt.run(name, weeklyTarget);
    return res.status(201).json({ id: result.lastInsertRowid, name, weeklyTarget });
  } catch (error) {
    return res.status(409).json({ error: 'Task already exists.' });
  }
});

app.patch('/api/habits/:id', authRequired, (req, res) => {
  const id = Number(req.params.id);
  const hasName = Object.prototype.hasOwnProperty.call(req.body, 'name');
  const hasWeeklyTarget = Object.prototype.hasOwnProperty.call(req.body, 'weeklyTarget');
  const name = hasName ? String(req.body.name || '').trim() : undefined;
  const weeklyTarget = hasWeeklyTarget ? parseWeeklyTarget(req.body.weeklyTarget) : undefined;

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid task id.' });
  }
  if (!hasName && !hasWeeklyTarget) {
    return res.status(400).json({ error: 'Provide name and/or weeklyTarget.' });
  }
  if (hasName && !name) {
    return res.status(400).json({ error: 'Task name is required.' });
  }
  if (hasWeeklyTarget && !weeklyTarget) {
    return res.status(400).json({ error: 'Weekly target must be an integer between 1 and 7.' });
  }

  try {
    let updated;
    if (hasName && hasWeeklyTarget) {
      updated = updateHabitNameTargetStmt.run(name, weeklyTarget, id);
    } else if (hasName) {
      updated = updateHabitNameStmt.run(name, id);
    } else {
      updated = updateHabitTargetStmt.run(weeklyTarget, id);
    }

    if (!updated.changes) {
      return res.status(404).json({ error: 'Task not found.' });
    }

    return res.json({ ok: true, id, name, weeklyTarget });
  } catch (error) {
    return res.status(409).json({ error: 'Task name already exists.' });
  }
});

app.post('/api/habits/:id/archive', authRequired, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid task id.' });
  }

  const archived = archiveHabitStmt.run(id);
  if (!archived.changes) {
    return res.status(404).json({ error: 'Task not found.' });
  }

  return res.json({ ok: true });
});

app.post('/api/habits/:id/unarchive', authRequired, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid task id.' });
  }

  const unarchived = unarchiveHabitStmt.run(id);
  if (!unarchived.changes) {
    return res.status(404).json({ error: 'Task not found.' });
  }

  return res.json({ ok: true });
});

app.delete('/api/habits/:id', authRequired, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid task id.' });
  }

  const deleted = deleteHabitStmt.run(id);
  if (!deleted.changes) {
    return res.status(404).json({ error: 'Task not found.' });
  }

  return res.json({ ok: true });
});

app.get('/api/dashboard', authRequired, (req, res) => {
  const now = new Date();
  const defaultYear = now.getFullYear();
  const year = Math.min(Math.max(Number(req.query.year || defaultYear), 1970), 2100);
  const selectedDay = String(req.query.day || '');

  return res.json(buildDashboard(year, selectedDay));
});

app.post('/api/today/toggle', authRequired, (req, res) => {
  const habitId = Number(req.body.habitId);
  const today = formatLocalDay(new Date());

  if (!Number.isInteger(habitId) || habitId <= 0) {
    return res.status(400).json({ error: 'Invalid task id.' });
  }

  const habit = getActiveHabitByIdStmt.get(habitId);
  if (!habit) {
    return res.status(404).json({ error: 'Active task not found.' });
  }

  const existing = getOneCheckinStmt.get(habitId, today);
  if (!existing) {
    insertCheckinStmt.run(habitId, today, 1);
    return res.json({ habitId, day: today, done: 1 });
  }

  const next = existing.done ? 0 : 1;
  updateCheckinStmt.run(next, existing.id);
  return res.json({ habitId, day: today, done: next });
});

app.listen(PORT, () => {
  console.log(`Consistency tracker running on http://localhost:${PORT}`);
});

