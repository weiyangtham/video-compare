const STORAGE_PREFIX = "video-compare/v1";

const state = {
  timelineTime: 0,
  playing: false,
  duration: 0,
  loopStart: null,
  loopEnd: null,
  statusMessage: "",
  animationFrameId: null,
  startedAtMs: null,
  timelineStartedAt: 0,
  slots: {
    left: createSlotState("left"),
    right: createSlotState("right"),
  },
};

const elements = {
  statusBanner: document.getElementById("statusBanner"),
  playPauseButton: document.getElementById("playPauseButton"),
  stepBackButton: document.getElementById("stepBackButton"),
  stepForwardButton: document.getElementById("stepForwardButton"),
  setLoopStartButton: document.getElementById("setLoopStartButton"),
  setLoopEndButton: document.getElementById("setLoopEndButton"),
  clearLoopButton: document.getElementById("clearLoopButton"),
  timelineRange: document.getElementById("timelineRange"),
  timeReadout: document.getElementById("timeReadout"),
  loopReadout: document.getElementById("loopReadout"),
};

["left", "right"].forEach((slotKey) => {
  const prefix = slotKey;
  state.slots[slotKey].elements = {
    fileInput: document.getElementById(`${prefix}FileInput`),
    video: document.getElementById(`${prefix}Video`),
    dropZone: document.querySelector(`[data-drop-zone="${prefix}"]`),
    fileName: document.getElementById(`${prefix}FileName`),
    timeReadout: document.getElementById(`${prefix}TimeReadout`),
    offsetInput: document.getElementById(`${prefix}OffsetInput`),
    currentTimeOutput: document.getElementById(`${prefix}CurrentTime`),
    tagLabelInput: document.getElementById(`${prefix}TagLabel`),
    tagNotesInput: document.getElementById(`${prefix}TagNotes`),
    addTagButton: document.getElementById(`${prefix}AddTagButton`),
    clearTagsButton: document.getElementById(`${prefix}ClearTagsButton`),
    tagsContainer: document.getElementById(`${prefix}Tags`),
  };
});

init();

function createSlotState(slotKey) {
  return {
    slotKey,
    file: null,
    fileKey: null,
    objectUrl: null,
    duration: 0,
    offsetSeconds: 0,
    tags: [],
    elements: null,
  };
}

function init() {
  bindGlobalEvents();
  bindSlotEvents("left");
  bindSlotEvents("right");
  render();
}

function bindGlobalEvents() {
  elements.playPauseButton.addEventListener("click", togglePlayback);
  elements.stepBackButton.addEventListener("click", () => seekTo(state.timelineTime - 1));
  elements.stepForwardButton.addEventListener("click", () => seekTo(state.timelineTime + 1));
  elements.setLoopStartButton.addEventListener("click", () => {
    state.loopStart = state.timelineTime;
    if (state.loopEnd !== null && state.loopEnd < state.loopStart) {
      state.loopEnd = null;
    }
    persistTransportState();
    render();
  });
  elements.setLoopEndButton.addEventListener("click", () => {
    state.loopEnd = state.timelineTime;
    if (state.loopStart !== null && state.loopEnd < state.loopStart) {
      state.loopStart = state.loopEnd;
    }
    persistTransportState();
    render();
  });
  elements.clearLoopButton.addEventListener("click", () => {
    state.loopStart = null;
    state.loopEnd = null;
    persistTransportState();
    render();
  });
  elements.timelineRange.addEventListener("input", (event) => {
    const value = Number(event.target.value);
    pausePlayback();
    seekTo(value);
  });
}

function bindSlotEvents(slotKey) {
  const slot = state.slots[slotKey];
  const {
    fileInput,
    video,
    dropZone,
    offsetInput,
    addTagButton,
    clearTagsButton,
  } = slot.elements;

  fileInput.addEventListener("change", async (event) => {
    const [file] = event.target.files || [];
    if (!file) {
      return;
    }

    await loadFileIntoSlot(slotKey, file);
    event.target.value = "";
  });

  video.addEventListener("loadedmetadata", () => {
    slot.duration = Number.isFinite(video.duration) ? video.duration : 0;
    recalculateSharedDuration();
    loadTransportState();
    seekTo(state.timelineTime);
    render();
  });

  video.addEventListener("loadeddata", () => {
    state.statusMessage = `${capitalize(slotKey)} video ready: ${slot.file?.name ?? "local file loaded"}.`;
    render();
  });

  video.addEventListener("error", () => {
    handleVideoLoadError(slotKey);
  });

  video.addEventListener("ended", () => {
    if (!hasLoop()) {
      pausePlayback();
      seekTo(state.duration);
    }
  });

  ["dragenter", "dragover"].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
      if (!isFileDrag(event.dataTransfer)) {
        return;
      }
      event.preventDefault();
      dropZone.classList.add("drag-active");
    });
  });

  ["dragleave", "dragend"].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
      if (event.relatedTarget && dropZone.contains(event.relatedTarget)) {
        return;
      }
      dropZone.classList.remove("drag-active");
    });
  });

  dropZone.addEventListener("drop", async (event) => {
    event.preventDefault();
    dropZone.classList.remove("drag-active");

    const file = getFirstVideoFile(event.dataTransfer);
    if (!file) {
      state.statusMessage = `Drop a video file into the ${slotKey} slot.`;
      render();
      return;
    }

    await loadFileIntoSlot(slotKey, file);
  });

  offsetInput.addEventListener("change", (event) => {
    slot.offsetSeconds = normalizeNumber(event.target.value, 0);
    persistSlotState(slotKey);
    recalculateSharedDuration();
    seekTo(state.timelineTime);
    render();
  });

  addTagButton.addEventListener("click", () => addTag(slotKey));
  clearTagsButton.addEventListener("click", () => {
    slot.tags = [];
    persistSlotState(slotKey);
    renderTags(slotKey);
  });
}

async function loadFileIntoSlot(slotKey, file) {
  const slot = state.slots[slotKey];
  const { video } = slot.elements;

  pausePlayback();
  resetLoopIfOutOfBounds();

  clearSlotMedia(slot);
  recalculateSharedDuration();
  seekTo(0);

  slot.file = file;
  slot.fileKey = createFileKey(file);
  slot.objectUrl = URL.createObjectURL(file);
  slot.duration = 0;
  slot.tags = [];

  const savedState = readSlotState(slotKey, slot.fileKey);
  slot.offsetSeconds = savedState.offsetSeconds;
  slot.tags = savedState.tags;

  video.src = slot.objectUrl;
  video.load();
  slot.elements.fileName.textContent = file.name;
  slot.elements.offsetInput.value = String(slot.offsetSeconds);
  renderTags(slotKey);
  state.statusMessage = `Loading ${file.name} into the ${slotKey} slot...`;
  render();
}

function togglePlayback() {
  if (state.playing) {
    pausePlayback();
  } else {
    startPlayback();
  }
}

function startPlayback() {
  if (!state.duration) {
    return;
  }

  state.playing = true;
  state.startedAtMs = performance.now();
  state.timelineStartedAt = state.timelineTime;

  Object.values(state.slots).forEach((slot) => {
    if (slot.file) {
      syncVideoToTimeline(slot);
      void slot.elements.video.play().catch(() => {});
    }
  });

  state.animationFrameId = requestAnimationFrame(tickPlayback);
  render();
}

function pausePlayback() {
  state.playing = false;
  if (state.animationFrameId !== null) {
    cancelAnimationFrame(state.animationFrameId);
    state.animationFrameId = null;
  }

  Object.values(state.slots).forEach((slot) => {
    slot.elements.video.pause();
  });

  render();
}

function tickPlayback() {
  if (!state.playing) {
    return;
  }

  const elapsedSeconds = (performance.now() - state.startedAtMs) / 1000;
  let nextTime = state.timelineStartedAt + elapsedSeconds;

  if (hasLoop() && nextTime >= state.loopEnd) {
    nextTime = state.loopStart;
    state.startedAtMs = performance.now();
    state.timelineStartedAt = nextTime;
  } else if (nextTime >= state.duration) {
    nextTime = state.duration;
    pausePlayback();
  }

  state.timelineTime = nextTime;
  syncAllVideos();
  render();

  if (state.playing) {
    state.animationFrameId = requestAnimationFrame(tickPlayback);
  }
}

function seekTo(nextTime) {
  const clamped = clamp(nextTime, 0, state.duration || 0);
  state.timelineTime = clamped;

  if (state.playing) {
    state.startedAtMs = performance.now();
    state.timelineStartedAt = clamped;
  }

  syncAllVideos();
  render();
}

function syncAllVideos() {
  Object.values(state.slots).forEach(syncVideoToTimeline);
}

function syncVideoToTimeline(slot) {
  const { video } = slot.elements;
  if (!slot.file || !slot.duration) {
    return;
  }

  const targetTime = getSlotTargetTime(slot, state.timelineTime);
  const drift = Math.abs(video.currentTime - targetTime);
  const isActiveAtCurrentTimelineTime = isSlotActiveAtTimelineTime(slot, state.timelineTime);

  if (drift > 0.08 || !state.playing) {
    try {
      video.currentTime = targetTime;
    } catch (_) {
      return;
    }
  }

  if (!state.playing || !isActiveAtCurrentTimelineTime) {
    if (!video.paused) {
      video.pause();
    }
    return;
  }

  if (video.paused) {
    void video.play().catch(() => {});
  }
}

function addTag(slotKey) {
  const slot = state.slots[slotKey];
  if (!slot.fileKey) {
    return;
  }

  const label = slot.elements.tagLabelInput.value.trim();
  const notes = slot.elements.tagNotesInput.value.trim();

  if (!label) {
    state.statusMessage = `Add a label before saving a ${slotKey} tag.`;
    render();
    return;
  }

  const timestamp = clamp(state.timelineTime - slot.offsetSeconds, 0, slot.duration || 0);
  const tag = {
    id: crypto.randomUUID(),
    timestamp,
    label,
    notes,
    createdAt: new Date().toISOString(),
  };

  slot.tags = [...slot.tags, tag].sort((a, b) => a.timestamp - b.timestamp);
  slot.elements.tagLabelInput.value = "";
  slot.elements.tagNotesInput.value = "";
  persistSlotState(slotKey);
  renderTags(slotKey);
  render();
}

function render() {
  elements.timelineRange.max = String(state.duration || 0);
  elements.timelineRange.value = String(clamp(state.timelineTime, 0, state.duration || 0));
  elements.playPauseButton.textContent = state.playing ? "Pause" : "Play";
  elements.timeReadout.textContent = `${formatTime(state.timelineTime)} / ${formatTime(state.duration)}`;
  elements.loopReadout.textContent = hasLoop()
    ? `Loop: ${formatTime(state.loopStart)} to ${formatTime(state.loopEnd)}`
    : "Loop: Off";

  Object.values(state.slots).forEach((slot) => {
    const slotTime = clamp(state.timelineTime - slot.offsetSeconds, 0, slot.duration || 0);
    slot.elements.currentTimeOutput.textContent = formatTime(slotTime);
    slot.elements.timeReadout.textContent = formatTime(slotTime);
  });

  elements.statusBanner.textContent = buildStatusText();
}

function renderTags(slotKey) {
  const slot = state.slots[slotKey];
  const container = slot.elements.tagsContainer;

  if (!slot.tags.length) {
    container.className = "tag-list empty";
    container.textContent = "No tags yet.";
    return;
  }

  container.className = "tag-list";
  container.replaceChildren(
    ...slot.tags.map((tag) => {
      const item = document.createElement("article");
      item.className = "tag-item";

      const meta = document.createElement("div");
      meta.className = "tag-meta";

      const title = document.createElement("strong");
      title.textContent = `${tag.label} · ${formatTime(tag.timestamp)}`;

      const jump = document.createElement("button");
      jump.className = "tag-jump";
      jump.textContent = "Jump";
      jump.addEventListener("click", () => {
        pausePlayback();
        seekTo(tag.timestamp + slot.offsetSeconds);
      });

      const note = document.createElement("div");
      note.className = "tag-note";
      note.textContent = tag.notes || "No notes";

      const remove = document.createElement("button");
      remove.textContent = "Delete";
      remove.addEventListener("click", () => {
        slot.tags = slot.tags.filter((entry) => entry.id !== tag.id);
        persistSlotState(slotKey);
        renderTags(slotKey);
      });

      meta.append(title, jump, remove);
      item.append(meta, note);
      return item;
    })
  );
}

function recalculateSharedDuration() {
  const durations = Object.values(state.slots)
    .filter((slot) => slot.duration > 0)
    .map((slot) => slot.duration + Math.max(slot.offsetSeconds, 0));

  state.duration = durations.length ? Math.max(...durations) : 0;
  state.timelineTime = clamp(state.timelineTime, 0, state.duration);
  resetLoopIfOutOfBounds();
}

function persistTransportState() {
  localStorage.setItem(
    `${STORAGE_PREFIX}/transport`,
    JSON.stringify({
      loopStart: state.loopStart,
      loopEnd: state.loopEnd,
    })
  );
}

function loadTransportState() {
  const raw = localStorage.getItem(`${STORAGE_PREFIX}/transport`);
  if (!raw) {
    return;
  }

  try {
    const parsed = JSON.parse(raw);
    state.loopStart = parsed.loopStart ?? null;
    state.loopEnd = parsed.loopEnd ?? null;
  } catch (_) {
    state.loopStart = null;
    state.loopEnd = null;
  }
}

function persistSlotState(slotKey) {
  const slot = state.slots[slotKey];
  if (!slot.fileKey) {
    return;
  }

  localStorage.setItem(
    `${STORAGE_PREFIX}/${slotKey}/${slot.fileKey}`,
    JSON.stringify({
      offsetSeconds: slot.offsetSeconds,
      tags: slot.tags,
    })
  );
}

function readSlotState(slotKey, fileKey) {
  const raw = localStorage.getItem(`${STORAGE_PREFIX}/${slotKey}/${fileKey}`);
  if (!raw) {
    return { offsetSeconds: 0, tags: [] };
  }

  try {
    const parsed = JSON.parse(raw);
    return {
      offsetSeconds: normalizeNumber(parsed.offsetSeconds, 0),
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
    };
  } catch (_) {
    return { offsetSeconds: 0, tags: [] };
  }
}

function createFileKey(file) {
  return [file.name, file.size, file.lastModified].join("__");
}

function getFirstVideoFile(dataTransfer) {
  const files = Array.from(dataTransfer?.files || []);
  return files.find((file) => file.type.startsWith("video/")) ?? null;
}

function isFileDrag(dataTransfer) {
  const types = Array.from(dataTransfer?.types || []);
  return types.includes("Files");
}

function getSlotTargetTime(slot, timelineTime) {
  return clamp(timelineTime - slot.offsetSeconds, 0, slot.duration);
}

function isSlotActiveAtTimelineTime(slot, timelineTime) {
  return timelineTime >= slot.offsetSeconds && timelineTime <= slot.offsetSeconds + slot.duration;
}

function buildStatusText() {
  if (state.statusMessage) {
    return state.statusMessage;
  }

  const loadedCount = Object.values(state.slots).filter((slot) => slot.file).length;

  if (!loadedCount) {
    return "Load one or two videos to begin.";
  }

  if (hasLoop()) {
    return `Looping is ready from ${formatTime(state.loopStart)} to ${formatTime(state.loopEnd)}.`;
  }

  return `${loadedCount} video${loadedCount === 1 ? "" : "s"} loaded. Timeline duration ${formatTime(state.duration)}.`;
}

function clearSlotMedia(slot) {
  const { video, fileName, timeReadout, currentTimeOutput } = slot.elements;

  if (slot.objectUrl) {
    URL.revokeObjectURL(slot.objectUrl);
  }

  video.removeAttribute("src");
  video.load();

  slot.file = null;
  slot.fileKey = null;
  slot.objectUrl = null;
  slot.duration = 0;

  fileName.textContent = "No file selected";
  timeReadout.textContent = "00:00.00";
  currentTimeOutput.textContent = "00:00.00";
}

function handleVideoLoadError(slotKey) {
  const slot = state.slots[slotKey];
  const fileName = slot.file?.name ?? "selected file";

  clearSlotMedia(slot);
  renderTags(slotKey);
  recalculateSharedDuration();
  seekTo(0);
  state.statusMessage = `Could not load ${fileName} in the ${slotKey} slot. Try another local video file.`;
  render();
}

function resetLoopIfOutOfBounds() {
  if (state.loopStart !== null && state.loopStart > state.duration) {
    state.loopStart = null;
  }

  if (state.loopEnd !== null && state.loopEnd > state.duration) {
    state.loopEnd = null;
  }

  if (state.loopStart !== null && state.loopEnd !== null && state.loopEnd <= state.loopStart) {
    state.loopStart = null;
    state.loopEnd = null;
  }
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function hasLoop() {
  return state.loopStart !== null && state.loopEnd !== null && state.loopEnd > state.loopStart;
}

function formatTime(totalSeconds) {
  const safe = Number.isFinite(totalSeconds) ? Math.max(totalSeconds, 0) : 0;
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${seconds.toFixed(2).padStart(5, "0")}`;
}

function normalizeNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
