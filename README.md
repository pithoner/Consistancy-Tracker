# Consistency Tracker

A small habit/task tracker you can run locally.

You add tasks, check off what you did today, and get a year view at the bottom with a GitHub-style heatmap. It uses SQLite, so there is no separate database to set up.

![Consistency Tracker screenshot](docs/screenshot_dark.jpeg)

## What it does

- Password login
- Daily task checklist
- Weekly targets per task
- Year heatmap
- Day details
- Stats
- Archive, unarchive, and delete tasks
- Darkmode/lightmode

## Local run

Requirements:
- Node.js 20+

Commands:

```bash
npm install
cp .env.example .env
npm start
```

Then open [http://localhost:3000](http://localhost:3000).

Set these in `.env`:
- `APP_PASSWORD`
- `SESSION_SECRET`

## Docker run

This is the easiest way to run it on a server.

```bash
cp .env.example .env
docker compose up -d --build
```

Then open [http://localhost:3000](http://localhost:3000).

Stop it with:

```bash
docker compose down
```

The SQLite database is stored in the Docker volume `tracker-data`, so your data stays there when the container restarts or gets rebuilt.

## Ubuntu server

Clone the repo, go into the folder, then:

```bash
cp .env.example .env
docker compose up -d --build
```

Open:

```bash
http://your-server-ip:3000
```

## Notes

- If `.env` is missing, the app falls back to `changeme123`. Change that.
