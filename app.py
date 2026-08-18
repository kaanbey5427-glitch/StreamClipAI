
from __future__ import annotations

import json
import re
import subprocess
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from yt_dlp import YoutubeDL

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
JOBS_DIR = BASE_DIR / "jobs"
JOBS_DIR.mkdir(exist_ok=True)

app = FastAPI(title="StreamClip AI", version="0.1.0")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

JOBS: dict[str, dict[str, Any]] = {}
LOCK = threading.Lock()

REACTION_WORDS = {
    "what", "bro", "crazy", "insane", "wait", "no", "way", "yo", "damn",
    "wow", "nah", "stop", "please", "why", "how", "omg", "god", "wild",
    "funny", "dead", "laugh", "haha", "hahaha", "bruh", "seriously"
}


class AnalyzeRequest(BaseModel):
    url: str
    max_clips: int = Field(default=5, ge=1, le=10)
    model_size: str = "small"


def set_job(job_id: str, **kwargs):
    with LOCK:
        JOBS.setdefault(job_id, {}).update(kwargs)


def get_job(job_id: str) -> dict[str, Any]:
    with LOCK:
        return dict(JOBS.get(job_id, {}))


def check_youtube_url(url: str):
    if not re.match(r"^https?://", url):
        raise ValueError("Paste a full YouTube URL.")
    host = re.sub(r"^https?://", "", url).split("/")[0].lower()
    if "youtube.com" not in host and "youtu.be" not in host:
        raise ValueError("This MVP currently accepts YouTube links only.")


def run(cmd: list[str]):
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr[-3500:] or proc.stdout[-3500:] or "Command failed")
    return proc


def download_video(url: str, job_dir: Path) -> Path:
    out = str(job_dir / "source.%(ext)s")
    opts = {
        "format": "bv*[height<=720]+ba/b[height<=720]/best",
        "merge_output_format": "mp4",
        "outtmpl": out,
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "restrictfilenames": True,
    }
    with YoutubeDL(opts) as ydl:
        ydl.download([url])

    videos = [
        p for p in job_dir.glob("source.*")
        if p.suffix.lower() in {".mp4", ".mkv", ".webm", ".mov"}
    ]
    if not videos:
        raise RuntimeError("No playable video file was downloaded.")
    return max(videos, key=lambda p: p.stat().st_size)


def transcribe(video_path: Path, model_size: str):
    from faster_whisper import WhisperModel

    model = WhisperModel(model_size, device="cpu", compute_type="int8")
    segments, _ = model.transcribe(
        str(video_path),
        beam_size=5,
        vad_filter=True,
        word_timestamps=True,
    )

    result = []
    for seg in segments:
        words = []
        for w in seg.words or []:
            if w.start is None or w.end is None:
                continue
            words.append(
                {
                    "start": float(w.start),
                    "end": float(w.end),
                    "word": (w.word or "").strip(),
                }
            )
        result.append(
            {
                "start": float(seg.start),
                "end": float(seg.end),
                "text": (seg.text or "").strip(),
                "words": words,
            }
        )
    return result


def excitement_score(text: str, duration: float) -> float:
    lower = text.lower()
    tokens = re.findall(r"[a-zA-Z0-9']+", lower)
    if not tokens:
        return 0.0

    reactions = sum(1 for t in tokens if t in REACTION_WORDS)
    punctuation = text.count("!") + text.count("?")
    caps = sum(1 for t in re.findall(r"\b[A-Z]{2,}\b", text))
    laughter = len(re.findall(r"\b(ha){2,}\b|hahaha|lol|lmao", lower))
    speed = len(tokens) / max(duration, 1.0)

    return (
        reactions * 2.8
        + punctuation * 1.7
        + caps * 1.2
        + laughter * 4.0
        + min(speed, 5.0) * 1.4
    )


def find_highlights(segments: list[dict], max_clips: int):
    if not segments:
        return []

    windows = []
    video_end = segments[-1]["end"]

    for i, seg in enumerate(segments):
        start = max(0.0, seg["start"] - 8.0)
        end = min(start + 40.0, video_end)

        text_parts = []
        j = i
        while j < len(segments) and segments[j]["start"] < end:
            text_parts.append(segments[j]["text"])
            j += 1

        text = " ".join(text_parts).strip()
        windows.append(
            {
                "start": start,
                "end": end,
                "raw_score": excitement_score(text, end - start),
                "text": text,
            }
        )

    windows.sort(key=lambda x: x["raw_score"], reverse=True)

    selected = []
    for item in windows:
        overlap = False
        for chosen in selected:
            inter = max(
                0.0,
                min(item["end"], chosen["end"]) - max(item["start"], chosen["start"]),
            )
            union = max(item["end"], chosen["end"]) - min(item["start"], chosen["start"])
            if union and inter / union > 0.35:
                overlap = True
                break

        if not overlap:
            selected.append(item)

        if len(selected) >= max_clips:
            break

    best = max([x["raw_score"] for x in selected] + [1.0])

    for idx, item in enumerate(selected, 1):
        normalized = int(72 + 27 * (item["raw_score"] / best))
        snippet = re.sub(r"\s+", " ", item["text"]).strip()
        item.update(
            {
                "id": idx,
                "score": max(1, min(99, normalized)),
                "title": snippet[:72] + ("…" if len(snippet) > 72 else ""),
            }
        )
        item.pop("raw_score", None)

    return selected


def srt_time(seconds: float) -> str:
    ms = int(round(seconds * 1000))
    h, rem = divmod(ms, 3_600_000)
    m, rem = divmod(rem, 60_000)
    s, ms = divmod(rem, 1000)
    return f"{h:02}:{m:02}:{s:02},{ms:03}"


def build_srt(segments, start: float, end: float, out_path: Path):
    words = []

    for seg in segments:
        for word in seg.get("words", []):
            if start <= word["start"] <= end:
                words.append(word)

    chunks = []
    current = []

    for word in words:
        current.append(word)
        if len(current) >= 5 or re.search(r"[.!?]$", word["word"]):
            chunks.append(current)
            current = []

    if current:
        chunks.append(current)

    lines = []
    for i, chunk in enumerate(chunks, 1):
        begin = max(0.0, chunk[0]["start"] - start)
        finish = max(begin + 0.3, min(end - start, chunk[-1]["end"] - start))
        text = " ".join(x["word"] for x in chunk).strip().upper()

        lines.extend(
            [
                str(i),
                f"{srt_time(begin)} --> {srt_time(finish)}",
                text,
                "",
            ]
        )

    out_path.write_text("\n".join(lines), encoding="utf-8")


def render_clip(source: Path, segments, clip: dict, out_path: Path, work_dir: Path):
    start = float(clip["start"])
    end = float(clip["end"])
    duration = end - start

    srt = work_dir / f"clip_{clip['id']}.srt"
    build_srt(segments, start, end, srt)

    srt_filter_path = str(srt).replace("\\", "/").replace(":", r"\:")

    filter_complex = (
        "[0:v]split=2[bg][fg];"
        "[bg]scale=1080:1920:force_original_aspect_ratio=increase,"
        "crop=1080:1920,boxblur=24:1[bg2];"
        "[fg]scale=1080:-2:force_original_aspect_ratio=decrease[fg2];"
        "[bg2][fg2]overlay=(W-w)/2:(H-h)/2,"
        f"subtitles='{srt_filter_path}':force_style="
        "'FontName=Arial,FontSize=22,Bold=1,PrimaryColour=&H00FFFFFF,"
        "OutlineColour=&H00000000,BorderStyle=1,Outline=3,Shadow=1,"
        "Alignment=2,MarginV=165'"
    )

    run(
        [
            "ffmpeg",
            "-y",
            "-ss",
            f"{start:.3f}",
            "-i",
            str(source),
            "-t",
            f"{duration:.3f}",
            "-filter_complex",
            filter_complex,
            "-map",
            "0:a?",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "22",
            "-c:a",
            "aac",
            "-b:a",
            "160k",
            "-movflags",
            "+faststart",
            str(out_path),
        ]
    )


def process_job(job_id: str, request: AnalyzeRequest):
    job_dir = JOBS_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    try:
        set_job(
            job_id,
            status="downloading",
            progress=8,
            message="Downloading the public YouTube video…",
        )
        source = download_video(request.url, job_dir)

        set_job(
            job_id,
            status="transcribing",
            progress=28,
            message="Transcribing with Whisper…",
        )
        segments = transcribe(source, request.model_size)
        (job_dir / "transcript.json").write_text(
            json.dumps(segments, ensure_ascii=False),
            encoding="utf-8",
        )

        set_job(
            job_id,
            status="scoring",
            progress=55,
            message="Finding the best moments…",
        )
        clips = find_highlights(segments, request.max_clips)
        if not clips:
            raise RuntimeError("No usable spoken highlights were found.")

        set_job(
            job_id,
            status="rendering",
            progress=64,
            message="Rendering vertical Shorts…",
            clips=clips,
        )

        rendered = []
        for i, clip in enumerate(clips, 1):
            out_path = job_dir / f"streamclip_{i}.mp4"
            render_clip(source, segments, clip, out_path, job_dir)

            item = dict(clip)
            item["download_url"] = f"/api/jobs/{job_id}/clips/{i}"
            rendered.append(item)

            set_job(
                job_id,
                progress=64 + int(32 * i / len(clips)),
                message=f"Rendered clip {i} of {len(clips)}…",
                clips=rendered + clips[i:],
            )

        set_job(
            job_id,
            status="done",
            progress=100,
            message="Your Shorts are ready.",
            clips=rendered,
        )

    except Exception as exc:
        set_job(
            job_id,
            status="error",
            progress=100,
            message=str(exc),
        )


@app.get("/")
def home():
    return FileResponse(STATIC_DIR / "index.html")


@app.post("/api/analyze")
def analyze(request: AnalyzeRequest):
    try:
        check_youtube_url(request.url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    job_id = uuid.uuid4().hex[:12]

    set_job(
        job_id,
        status="queued",
        progress=1,
        message="Starting…",
        clips=[],
        created_at=time.time(),
    )

    thread = threading.Thread(
        target=process_job,
        args=(job_id, request),
        daemon=True,
    )
    thread.start()

    return {"job_id": job_id}


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str):
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@app.get("/api/jobs/{job_id}/clips/{clip_id}")
def get_clip(job_id: str, clip_id: int):
    path = JOBS_DIR / job_id / f"streamclip_{clip_id}.mp4"

    if not path.exists():
        raise HTTPException(status_code=404, detail="Clip not ready")

    return FileResponse(
        path,
        media_type="video/mp4",
        filename=path.name,
    )
