
const analyzeBtn = document.getElementById("analyzeBtn");
const youtubeUrl = document.getElementById("youtubeUrl");
const clipCount = document.getElementById("clipCount");
const modelSize = document.getElementById("modelSize");

const progressSection = document.getElementById("progressSection");
const resultsSection = document.getElementById("resultsSection");
const statusTitle = document.getElementById("statusTitle");
const progressPercent = document.getElementById("progressPercent");
const progressBar = document.getElementById("progressBar");
const clipsGrid = document.getElementById("clipsGrid");

const steps = {
  download: document.getElementById("stepDownload"),
  transcript: document.getElementById("stepTranscript"),
  highlights: document.getElementById("stepHighlights"),
  render: document.getElementById("stepRender"),
};

function setActiveStep(status) {
  Object.values(steps).forEach((el) => el.classList.remove("active"));

  if (["queued", "downloading"].includes(status)) {
    steps.download.classList.add("active");
  } else if (status === "transcribing") {
    steps.transcript.classList.add("active");
  } else if (status === "scoring") {
    steps.highlights.classList.add("active");
  } else if (["rendering", "done"].includes(status)) {
    steps.render.classList.add("active");
  }
}

function durationLabel(start, end) {
  const seconds = Math.max(0, Math.round(end - start));
  return `${seconds}s`;
}

function renderClips(clips = []) {
  clipsGrid.innerHTML = "";

  clips.forEach((clip) => {
    const card = document.createElement("article");
    card.className = "clip-card";

    const readyAction = clip.download_url
      ? `<a href="${clip.download_url}">Download MP4</a>`
      : `<span class="waiting">Rendering…</span>`;

    card.innerHTML = `
      <div class="score-row">
        <div class="score">🔥 ${clip.score}/99</div>
        <div class="duration">${durationLabel(clip.start, clip.end)}</div>
      </div>
      <h3>${escapeHtml(clip.title || "Highlight")}</h3>
      ${readyAction}
    `;

    clipsGrid.appendChild(card);
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function startAnalysis() {
  const url = youtubeUrl.value.trim();

  if (!url) {
    alert("Paste a YouTube link first.");
    return;
  }

  analyzeBtn.disabled = true;
  analyzeBtn.innerHTML = "Starting…";

  progressSection.classList.remove("hidden");
  resultsSection.classList.add("hidden");
  statusTitle.classList.remove("error");
  statusTitle.textContent = "Starting…";
  progressBar.style.width = "1%";
  progressPercent.textContent = "1%";

  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        max_clips: Number(clipCount.value),
        model_size: modelSize.value,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.detail || "Could not start the job.");
    }

    pollJob(data.job_id);
  } catch (error) {
    showError(error.message);
  }
}

async function pollJob(jobId) {
  try {
    const response = await fetch(`/api/jobs/${jobId}`);
    const job = await response.json();

    if (!response.ok) {
      throw new Error(job.detail || "Could not read job status.");
    }

    statusTitle.textContent = job.message || job.status;
    progressPercent.textContent = `${job.progress || 0}%`;
    progressBar.style.width = `${job.progress || 0}%`;

    setActiveStep(job.status);

    if (Array.isArray(job.clips) && job.clips.length) {
      resultsSection.classList.remove("hidden");
      renderClips(job.clips);
    }

    if (job.status === "done") {
      analyzeBtn.disabled = false;
      analyzeBtn.innerHTML = "<span>✦</span> Find highlights";
      return;
    }

    if (job.status === "error") {
      throw new Error(job.message || "Processing failed.");
    }

    setTimeout(() => pollJob(jobId), 1800);
  } catch (error) {
    showError(error.message);
  }
}

function showError(message) {
  statusTitle.textContent = message;
  statusTitle.classList.add("error");
  progressBar.style.width = "100%";
  progressPercent.textContent = "!";
  analyzeBtn.disabled = false;
  analyzeBtn.innerHTML = "<span>✦</span> Find highlights";
}

analyzeBtn.addEventListener("click", startAnalysis);

youtubeUrl.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    startAnalysis();
  }
});
