# Consistency Tracker

Simple local web app to track tasks with daily checkoffs and a GitHub-style yearly heatmap.

## Features
- One-password login (session-based)
- Add tasks with weekly targets (1-7 times per week)
- Edit task names and weekly targets
- Archive tasks instead of deleting, plus unarchive support
- Optional permanent delete from archived tasks
- Today's Tasks section with weekly progress bars per task
- Year heatmap where color gets darker as more active tasks are completed
- Month markers on the heatmap for easier navigation
- Click any day to see which active tasks were done vs not done
- Stats panel (completion rate, streaks, totals, weekly goals met)
- SQLite database file (`tracker.db`)

## Run locally
1. Install Node.js 20+.
2. Install dependencies:
   - `npm install`
3. Create env file:
   - `cp .env.example .env`
4. Edit `.env` and set your password + session secret.
5. Start the app:
   - `npm start`
6. Open `http://localhost:3000`

## Run with Docker
1. Create env file:
   - `cp .env.example .env`
2. Edit `.env` and set your password + session secret.
3. Build and start:
   - `docker compose up -d --build`
4. Open `http://localhost:3000`
5. Stop later with:
   - `docker compose down`

## Deploy on Ubuntu server (local hosting)
1. Clone this repo onto your server.
2. Install Docker Engine + Docker Compose plugin.
3. In the project folder run:
   - `cp .env.example .env`
   - edit `.env`
   - `docker compose up -d --build`
4. Open `http://your-server-ip:3000`

Data is stored in the Docker volume `tracker-data`, so it persists across container restarts and rebuilds.

## Notes
- Default fallback password is `changeme123` if `.env` is missing. Set your own password.
- For internet-facing use, put this behind Nginx + HTTPS.

