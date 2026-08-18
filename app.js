
const analyzeBtn = document.getElementById("analyzeBtn");
const uploadBtn = document.getElementById("uploadBtn");
const youtubeUrl = document.getElementById("youtubeUrl");
const videoFile = document.getElementById("videoFile");
const selectedFile = document.getElementById("selectedFile");
const dropZone = document.getElementById("dropZone");

const clipCount = document.getElementById("clipCount");
const modelSize = document.getElementById("modelSize");

const uploadTab = document.getElementById("uploadTab");
const youtubeTab = document.getElementById("youtubeTab");
const uploadPanel = document.getElementById("uploadPanel");
const youtubePanel = document.getElementById("youtubePanel");

const progressSection = document.getElementById("progressSection");
const resultsSection = document.getElementById("resultsSection");
const statusTitle = document.getElementById("statusTitle");
const progressPercent = document.getElementById("progressPercent");
const progressBar = document.getElementById("progressBar");
const clipsGrid = document.getElementById("clipsGrid");

const steps = {
  upload: document.getElementById("stepUpload"),
  download: document.getElementById("stepDownload"),
  transcript: document.getElementById("stepTranscript"),
  highlights: document.getElementById("stepHighlights"),
  render: document.getElementById("stepRender"),
};

function switchSource(source) {
  const upload = source === "upload";

  uploadTab.classList.toggle("active", upload);
  youtubeTab.classList.toggle("active", !upload);

  uploadPanel.classList.toggle("hidden", !upload);
  youtubePanel.classList.toggle("hidden", upload);
}

uploadTab.addEventListener("click", () => switchSource("upload"));
youtubeTab.addEventListener("click", () => switchSource("youtube"));

function setActiveStep(status, sourceType) {
  Object.values(steps).forEach((el) => el.classList.remove("active"));

  if (["uploading", "queued"].includes(status) && sourceType === "upload") {
    steps.upload.classList.add("active");
  } else if (["queued", "downloading"].includes(status) && sourceType === "youtube") {
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

function resetProgress() {
  progressSection.classList.remove("hidden");
  resultsSection.classList.add("hidden");

  statusTitle.classList.remove("error");
  statusTitle.textContent = "Starting…";

  progressBar.style.width = "1%";
  progressPercent.textContent = "1%";
}

async function startYoutubeAnalysis() {
  const url = youtubeUrl.value.trim();

  if (!url) {
    alert("Paste a YouTube link first.");
    return;
  }

  resetProgress();

  analyzeBtn.disabled = true;
  analyzeBtn.innerHTML = "Starting…";

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

async function startUploadAnalysis() {
  const file = videoFile.files[0];

  if (!file) {
    alert("Choose a video first.");
    return;
  }

  resetProgress();

  uploadBtn.disabled = true;
  uploadBtn.innerHTML = "Uploading…";

  const form = new FormData();
  form.append("file", file);
  form.append("max_clips", clipCount.value);
  form.append("model_size", modelSize.value);

  try {
    const response = await fetch("/api/upload", {
      method: "POST",
      body: form,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.detail || "Upload failed.");
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

    setActiveStep(job.status, job.source_type);

    if (Array.isArray(job.clips) && job.clips.length) {
      resultsSection.classList.remove("hidden");
      renderClips(job.clips);
    }

    if (job.status === "done") {
      analyzeBtn.disabled = false;
      analyzeBtn.innerHTML = "<span>✦</span> Find highlights";

      uploadBtn.disabled = false;
      uploadBtn.innerHTML = "<span>✦</span> Upload & find highlights";
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

  uploadBtn.disabled = false;
  uploadBtn.innerHTML = "<span>✦</span> Upload & find highlights";
}

videoFile.addEventListener("change", () => {
  const file = videoFile.files[0];

  if (!file) {
    selectedFile.textContent = "MP4 • MOV • MKV • WEBM";
    return;
  }

  const mb = (file.size / 1024 / 1024).toFixed(1);
  selectedFile.textContent = `${file.name} • ${mb} MB`;
});

["dragenter", "dragover"].forEach((name) => {
  dropZone.addEventListener(name, (event) => {
    event.preventDefault();
    dropZone.classList.add("dragging");
  });
});

["dragleave", "drop"].forEach((name) => {
  dropZone.addEventListener(name, (event) => {
    event.preventDefault();
    dropZone.classList.remove("dragging");
  });
});

dropZone.addEventListener("drop", (event) => {
  const files = event.dataTransfer.files;

  if (!files.length) return;

  const dt = new DataTransfer();
  dt.items.add(files[0]);
  videoFile.files = dt.files;
  videoFile.dispatchEvent(new Event("change"));
});

analyzeBtn.addEventListener("click", startYoutubeAnalysis);
uploadBtn.addEventListener("click", startUploadAnalysis);

youtubeUrl.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    startYoutubeAnalysis();
  }
});
