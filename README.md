
# StreamClip AI — Website MVP

A web app that turns long public YouTube videos into vertical captioned Shorts.

## What it does

- Paste a YouTube URL
- Downloads the public video
- Transcribes speech with Faster-Whisper
- Scores likely high-energy moments
- Selects the top 3–10 clips
- Creates 1080×1920 MP4 Shorts
- Adds bold captions
- Lets you download finished clips in the browser

## Important

Only use videos you own or have permission to download, edit, and repost.

## Easiest way to run it

### Docker

1. Install Docker Desktop.
2. Open a terminal in this folder.
3. Run:

```bash
docker build -t streamclip-ai .
docker run --rm -p 8000:8000 -v streamclip_jobs:/app/jobs streamclip-ai
```

4. Open:

```text
http://localhost:8000
```

## Run without Docker

You need:

- Python 3.11
- FFmpeg available in PATH

Then:

```bash
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8000
```

Open `http://localhost:8000`.

## Deploying as a website

The project is container-ready, so you can deploy it to a hosting provider that supports Docker containers and enough CPU/RAM for Whisper + FFmpeg.

For a public app with many users, the next version should move video processing into a background worker/queue instead of storing jobs only in server memory.

## Project structure

```text
streamclip_ai_web/
├── app.py
├── Dockerfile
├── requirements.txt
├── README.md
├── jobs/
└── static/
    ├── index.html
    ├── styles.css
    └── app.js
```
