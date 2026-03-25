const habitForm = document.getElementById('habit-form');
const habitNameInput = document.getElementById('habit-name');
const weeklyTargetInput = document.getElementById('weekly-target');
const reloadBtn = document.getElementById('reload-btn');
const todayListEl = document.getElementById('today-list');
const archivedListEl = document.getElementById('archived-list');
const statsEl = document.getElementById('stats');
const monthMarkersEl = document.getElementById('month-markers');
const heatmapEl = document.getElementById('year-heatmap');
const heatmapInnerEl = document.getElementById('heatmap-inner');
const dayTitleEl = document.getElementById('day-title');
const daySummaryEl = document.getElementById('day-summary');
const dayDetailsEl = document.getElementById('day-details');
const todayTemplate = document.getElementById('today-item-template');
const archivedTemplate = document.getElementById('archived-item-template');

let state = null;

function weekdayFromDay(day) {
  const [y, m, d] = day.split('-').map(Number);
  const jsDay = new Date(y, m - 1, d).getDay();
  return (jsDay + 6) % 7;
}

function parseDay(day) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function dayOfYearInfo(day) {
  const date = parseDay(day);
  const year = date.getFullYear();
  const start = new Date(year, 0, 1);
  const oneDay = 1000 * 60 * 60 * 24;
  const index = Math.floor((date - start) / oneDay) + 1;
  return { index };
}

function prettyDay(day) {
  return parseDay(day).toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

function monthShort(day) {
  const [y, m] = day.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'short' });
}

function monthParity(day) {
  const m = Number(day.slice(5, 7));
  return m % 2;
}

function parseWeeklyTargetInput(raw) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 7) return null;
  return n;
}

function buildWeeks(heatmapDays) {
  if (!heatmapDays.length) return { weeks: [], monthMarkers: [] };

  const firstDow = weekdayFromDay(heatmapDays[0].day);
  const padded = Array(firstDow).fill(null).concat(heatmapDays);
  while (padded.length % 7 !== 0) {
    padded.push(null);
  }

  const weeks = [];
  for (let i = 0; i < padded.length; i += 7) {
    weeks.push(padded.slice(i, i + 7));
  }

  const monthMarkers = [];
  for (let i = 0; i < heatmapDays.length; i += 1) {
    const day = heatmapDays[i].day;
    if (day.endsWith('-01')) {
      const weekIndex = Math.floor((firstDow + i) / 7);
      monthMarkers.push({ weekIndex, label: monthShort(day) });
    }
  }

  return { weeks, monthMarkers };
}

async function fetchDashboard(day = '') {
  const query = day ? `?day=${encodeURIComponent(day)}` : '';
  const res = await fetch(`/api/dashboard${query}`);
  if (!res.ok) {
    window.location.href = '/login';
    return null;
  }
  return res.json();
}

async function addHabit(name, weeklyTarget) {
  const res = await fetch('/api/habits', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, weeklyTarget })
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    alert(data.error || 'Failed to add task.');
    return;
  }

  habitNameInput.value = '';
  weeklyTargetInput.value = '4';
  await load();
}

async function editTask(id, currentName, currentTarget) {
  const nextNameRaw = window.prompt('Edit task name:', currentName);
  if (!nextNameRaw) return;
  const name = nextNameRaw.trim();
  if (!name) {
    alert('Task name is required.');
    return;
  }

  const nextTargetRaw = window.prompt('Weekly target (1-7):', String(currentTarget));
  if (!nextTargetRaw) return;
  const weeklyTarget = parseWeeklyTargetInput(nextTargetRaw.trim());
  if (!weeklyTarget) {
    alert('Weekly target must be an integer between 1 and 7.');
    return;
  }

  if (name === currentName && weeklyTarget === currentTarget) return;

  const res = await fetch(`/api/habits/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, weeklyTarget })
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    alert(data.error || 'Failed to update task.');
    return;
  }

  await load(state ? state.selectedDay : '');
}

async function setWeeklyGoal(id, currentTarget) {
  const next = window.prompt('Set weekly target (1-7):', String(currentTarget));
  if (!next) return;
  const weeklyTarget = parseWeeklyTargetInput(next.trim());
  if (!weeklyTarget) {
    alert('Weekly target must be an integer between 1 and 7.');
    return;
  }

  const res = await fetch(`/api/habits/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ weeklyTarget })
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    alert(data.error || 'Failed to update weekly target.');
    return;
  }

  await load(state ? state.selectedDay : '');
}

async function archiveHabit(id, name) {
  if (!window.confirm(`Archive "${name}"?`)) return;

  const res = await fetch(`/api/habits/${id}/archive`, { method: 'POST' });
  if (!res.ok) {
    alert('Failed to archive task.');
    return;
  }

  await load(state ? state.selectedDay : '');
}

async function unarchiveHabit(id) {
  const res = await fetch(`/api/habits/${id}/unarchive`, { method: 'POST' });
  if (!res.ok) {
    alert('Failed to unarchive task.');
    return;
  }

  await load(state ? state.selectedDay : '');
}

async function deleteHabit(id, name) {
  if (!window.confirm(`Permanently delete "${name}"? This cannot be undone.`)) return;

  const res = await fetch(`/api/habits/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    alert('Failed to delete task.');
    return;
  }

  await load(state ? state.selectedDay : '');
}

async function toggleTodayTask(habitId) {
  const res = await fetch('/api/today/toggle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ habitId })
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    alert(data.error || 'Failed to update task.');
    return;
  }

  await load(state ? state.selectedDay : '');
}

function renderTodayTasks(data) {
  todayListEl.innerHTML = '';

  if (!data.habits.length) {
    const empty = document.createElement('p');
    empty.className = 'help-text';
    empty.textContent = 'No active tasks yet. Add your first one above.';
    todayListEl.appendChild(empty);
    return;
  }

  for (const task of data.todayTasks) {
    const node = todayTemplate.content.firstElementChild.cloneNode(true);
    const checkbox = node.querySelector('.today-checkbox');
    const nameEl = node.querySelector('.today-name');
    const weeklyText = node.querySelector('.weekly-text');
    const weeklyFill = node.querySelector('.weekly-progress-fill');
    const goalBtn = node.querySelector('.goal-habit');
    const editBtn = node.querySelector('.edit-habit');
    const archiveBtn = node.querySelector('.archive-habit');

    checkbox.checked = task.done;
    nameEl.textContent = task.name;
    if (task.done) nameEl.classList.add('done');

    weeklyText.textContent = `${task.weeklyCompleted}/${task.weeklyTarget} this week`;
    weeklyFill.style.width = `${task.weeklyProgress}%`;
    if (task.weeklyMet) weeklyFill.classList.add('met');

    checkbox.addEventListener('change', () => toggleTodayTask(task.habitId));
    goalBtn.addEventListener('click', () => setWeeklyGoal(task.habitId, task.weeklyTarget));
    editBtn.addEventListener('click', () => editTask(task.habitId, task.name, task.weeklyTarget));
    archiveBtn.addEventListener('click', () => archiveHabit(task.habitId, task.name));

    todayListEl.appendChild(node);
  }
}

function renderArchivedTasks(data) {
  archivedListEl.innerHTML = '';

  if (!data.archivedHabits.length) {
    const empty = document.createElement('p');
    empty.className = 'help-text';
    empty.textContent = 'No archived tasks.';
    archivedListEl.appendChild(empty);
    return;
  }

  for (const habit of data.archivedHabits) {
    const node = archivedTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector('.archived-name').textContent = `${habit.name} (${habit.weekly_target}x/week)`;

    const editBtn = node.querySelector('.edit-habit');
    const unarchiveBtn = node.querySelector('.unarchive-habit');
    const deleteBtn = node.querySelector('.delete-habit');

    editBtn.addEventListener('click', () => editTask(habit.id, habit.name, habit.weekly_target));
    unarchiveBtn.addEventListener('click', () => unarchiveHabit(habit.id));
    deleteBtn.addEventListener('click', () => deleteHabit(habit.id, habit.name));

    archivedListEl.appendChild(node);
  }
}

function renderStats(data) {
  statsEl.innerHTML = '';

  const items = [
    { label: 'Active Tasks', value: data.stats.totalHabits },
    { label: 'Archived Tasks', value: data.stats.archivedHabits },
    { label: 'Weekly Goals Met', value: `${data.stats.weeklyGoalsMet}/${data.stats.totalHabits}` },
    { label: 'Completed (All Time)', value: data.stats.completedAllTime },
    { label: 'Completion Rate', value: `${data.stats.completionRate}%` },
    { label: 'Current Streak (Days)', value: data.stats.currentStreak },
    { label: 'Best Streak (Days)', value: data.stats.bestStreak }
  ];

  for (const item of items) {
    const box = document.createElement('div');
    box.className = 'stat-box';
    box.innerHTML = `<span class="stat-label">${item.label}</span><span class="stat-value">${item.value}</span>`;
    statsEl.appendChild(box);
  }
}

function getHeatmapSizing() {
  const styles = getComputedStyle(document.documentElement);
  const cellSize = parseInt(styles.getPropertyValue('--heat-cell-size'), 10) || 14;
  const gap = parseInt(styles.getPropertyValue('--heat-gap'), 10) || 4;
  return { cellSize, gap };
}

function renderHeatmap(data) {
  heatmapEl.innerHTML = '';
  monthMarkersEl.innerHTML = '';

  const { weeks, monthMarkers } = buildWeeks(data.heatmap);
  const { cellSize, gap } = getHeatmapSizing();
  const colStep = cellSize + gap;
  const heatmapWidth = weeks.length ? (weeks.length * colStep) - gap : 0;

  heatmapEl.style.gridTemplateColumns = `repeat(${weeks.length}, ${cellSize}px)`;
  heatmapEl.style.width = `${heatmapWidth}px`;
  monthMarkersEl.style.width = `${heatmapWidth}px`;
  heatmapInnerEl.style.minWidth = `${heatmapWidth + 44}px`;

  for (const week of weeks) {
    for (const day of week) {
      if (!day) {
        const empty = document.createElement('div');
        empty.className = 'heat-empty';
        heatmapEl.appendChild(empty);
        continue;
      }

      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = `heat-cell level-${day.level} month-band-${monthParity(day.day)}`;
      if (day.day === data.selectedDay) cell.classList.add('selected');
      if (day.isToday) cell.classList.add('today');

      cell.title = `${day.day}: ${day.completed}/${day.total} completed`;
      cell.addEventListener('click', () => load(day.day));
      heatmapEl.appendChild(cell);
    }
  }

  for (const marker of monthMarkers) {
    const label = document.createElement('span');
    label.className = 'month-label';
    label.style.left = `${marker.weekIndex * colStep}px`;
    label.textContent = marker.label;
    monthMarkersEl.appendChild(label);
  }
}

function renderSelectedDay(data) {
  const summary = data.selectedSummary;
  const doy = dayOfYearInfo(summary.day);
  dayTitleEl.textContent = `Day Details - ${prettyDay(summary.day)} (Day #${doy.index})`;
  daySummaryEl.textContent = `${summary.completed} of ${summary.total} active tasks completed`;

  dayDetailsEl.innerHTML = '';
  if (!summary.tasks.length) {
    const empty = document.createElement('p');
    empty.className = 'help-text';
    empty.textContent = 'No active tasks to show for this day.';
    dayDetailsEl.appendChild(empty);
    return;
  }

  for (const task of summary.tasks) {
    const item = document.createElement('div');
    item.className = 'day-item';
    item.innerHTML = `<span>${task.name} (${task.weeklyTarget}x/week)</span><span class="badge ${task.done ? 'done' : 'not-done'}">${task.done ? 'Done' : 'Not done'}</span>`;
    dayDetailsEl.appendChild(item);
  }
}

function render(data) {
  state = data;
  renderTodayTasks(data);
  renderArchivedTasks(data);
  renderStats(data);
  renderHeatmap(data);
  renderSelectedDay(data);
}

async function load(day = '') {
  const data = await fetchDashboard(day);
  if (!data) return;
  render(data);
}

habitForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = habitNameInput.value.trim();
  const weeklyTarget = parseWeeklyTargetInput(weeklyTargetInput.value.trim());
  if (!name) return;
  if (!weeklyTarget) {
    alert('Weekly target must be an integer between 1 and 7.');
    return;
  }
  await addHabit(name, weeklyTarget);
});

reloadBtn.addEventListener('click', () => load(state ? state.selectedDay : ''));
load();
