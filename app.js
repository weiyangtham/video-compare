const STORAGE_PREFIX = "video-compare/v1";

const state = {
  mode: "compare",
  timelineTime: 0,
  playing: false,
  playbackRate: 1,
  duration: 0,
  loopStart: null,
  loopEnd: null,
  statusMessage: "",
  animationFrameId: null,
  startedAtMs: null,
  timelineStartedAt: 0,
  activeScrubber: null,
  activePan: null,
  slots: {
    left: createSlotState("left"),
    right: createSlotState("right"),
  },
};

const elements = {
  appShell: document.getElementById("appShell"),
  statusBanner: document.getElementById("statusBanner"),
  playPauseButton: document.getElementById("playPauseButton"),
  stepBackButton: document.getElementById("stepBackButton"),
  stepForwardButton: document.getElementById("stepForwardButton"),
  playbackRateSelect: document.getElementById("playbackRateSelect"),
  setLoopStartButton: document.getElementById("setLoopStartButton"),
  setLoopEndButton: document.getElementById("setLoopEndButton"),
  clearLoopButton: document.getElementById("clearLoopButton"),
  modeToggleButton: document.getElementById("modeToggleButton"),
  timelineRange: document.getElementById("timelineRange"),
  timeReadout: document.getElementById("timeReadout"),
  loopReadout: document.getElementById("loopReadout"),
  leftPanelTitle: document.getElementById("leftPanelTitle"),
};

["left", "right"].forEach((slotKey) => {
  const prefix = slotKey;
  state.slots[slotKey].elements = {
    fileInput: document.getElementById(`${prefix}FileInput`),
    video: document.getElementById(`${prefix}Video`),
    videoStage: document.getElementById(`${prefix}VideoStage`),
    dropZone: document.querySelector(`[data-drop-zone="${prefix}"]`),
    fileName: document.getElementById(`${prefix}FileName`),
    timeReadout: document.getElementById(`${prefix}TimeReadout`),
    offsetInput: document.getElementById(`${prefix}OffsetInput`),
    currentTimeOutput: document.getElementById(`${prefix}CurrentTime`),
    timelineRange: document.getElementById(`${prefix}TimelineRange`),
    captureStillButton: document.getElementById(`${prefix}CaptureStillButton`),
    captureClipButton: document.getElementById(`${prefix}CaptureClipButton`),
    captureSummary: document.getElementById(`${prefix}CaptureSummary`),
    tagLabelInput: document.getElementById(`${prefix}TagLabel`),
    tagNotesInput: document.getElementById(`${prefix}TagNotes`),
    addTagButton: document.getElementById(`${prefix}AddTagButton`),
    clearTagsButton: document.getElementById(`${prefix}ClearTagsButton`),
    tagsContainer: document.getElementById(`${prefix}Tags`),
    zoomInButton: document.getElementById(`${prefix}ZoomInButton`),
    zoomOutButton: document.getElementById(`${prefix}ZoomOutButton`),
    zoomResetButton: document.getElementById(`${prefix}ZoomResetButton`),
    zoomReadout: document.getElementById(`${prefix}ZoomReadout`),
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
    zoomScale: 1,
    panX: 0,
    panY: 0,
    lastCaptureLabel: "",
    captureBusy: false,
    elements: null,
  };
}

function init() {
  loadModeState();
  loadTransportState();
  bindGlobalEvents();
  bindSlotEvents("left");
  bindSlotEvents("right");
  render();
}

function bindGlobalEvents() {
  elements.playPauseButton.addEventListener("click", togglePlayback);
  elements.stepBackButton.addEventListener("click", () => seekTo(state.timelineTime - 1));
  elements.stepForwardButton.addEventListener("click", () => seekTo(state.timelineTime + 1));
  elements.playbackRateSelect.addEventListener("change", (event) => {
    setPlaybackRate(Number(event.target.value));
  });
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
  elements.modeToggleButton.addEventListener("click", toggleMode);
  elements.timelineRange.addEventListener("input", (event) => {
    const value = Number(event.target.value);
    pausePlayback();
    seekTo(value);
  });
  bindScrubberGesture(elements.timelineRange, "shared");
}

function bindSlotEvents(slotKey) {
  const slot = state.slots[slotKey];
  const {
    fileInput,
    video,
    dropZone,
    offsetInput,
    timelineRange,
    captureStillButton,
    captureClipButton,
    addTagButton,
    clearTagsButton,
    zoomInButton,
    zoomOutButton,
    zoomResetButton,
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

  timelineRange.addEventListener("input", (event) => {
    pausePlayback();
    seekSlotToTime(slotKey, Number(event.target.value));
  });
  bindScrubberGesture(timelineRange, slotKey);

  captureStillButton.addEventListener("click", () => {
    void captureStill(slotKey);
  });
  captureClipButton.addEventListener("click", () => {
    void captureClip(slotKey);
  });

  zoomInButton.addEventListener("click", () => adjustZoom(slotKey, ZOOM_STEP));
  zoomOutButton.addEventListener("click", () => adjustZoom(slotKey, -ZOOM_STEP));
  zoomResetButton.addEventListener("click", () => resetZoom(slotKey));

  dropZone.addEventListener(
    "wheel",
    (event) => {
      if (!slot.file) {
        return;
      }
      event.preventDefault();
      const direction = event.deltaY < 0 ? 1 : -1;
      adjustZoom(slotKey, ZOOM_STEP * direction, {
        clientX: event.clientX,
        clientY: event.clientY,
      });
    },
    { passive: false }
  );

  dropZone.addEventListener("dblclick", () => {
    if (slot.file) {
      resetZoom(slotKey);
    }
  });

  dropZone.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !slot.file || slot.zoomScale <= 1) {
      return;
    }

    if (event.target.closest(".zoom-controls")) {
      return;
    }

    state.activePan = {
      slotKey,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originPanX: slot.panX,
      originPanY: slot.panY,
    };
    dropZone.setPointerCapture(event.pointerId);
    render();
  });

  dropZone.addEventListener("pointermove", (event) => {
    if (!state.activePan || state.activePan.slotKey !== slotKey || state.activePan.pointerId !== event.pointerId) {
      return;
    }

    const nextPanX = state.activePan.originPanX + (event.clientX - state.activePan.startX);
    const nextPanY = state.activePan.originPanY + (event.clientY - state.activePan.startY);
    setPan(slotKey, nextPanX, nextPanY);
  });

  const releasePan = (event) => {
    if (!state.activePan || state.activePan.slotKey !== slotKey || state.activePan.pointerId !== event.pointerId) {
      return;
    }

    if (dropZone.hasPointerCapture(event.pointerId)) {
      dropZone.releasePointerCapture(event.pointerId);
    }
    state.activePan = null;
    persistSlotState(slotKey);
    render();
  };

  dropZone.addEventListener("pointerup", releasePan);
  dropZone.addEventListener("pointercancel", releasePan);

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
  slot.lastCaptureLabel = "";
  slot.captureBusy = false;

  const savedState = readSlotState(slotKey, slot.fileKey);
  slot.offsetSeconds = savedState.offsetSeconds;
  slot.tags = savedState.tags;
  slot.zoomScale = savedState.zoomScale;
  slot.panX = savedState.panX;
  slot.panY = savedState.panY;

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
  let nextTime = state.timelineStartedAt + elapsedSeconds * state.playbackRate;

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

  video.playbackRate = state.playbackRate;

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
  const isSingleMode = state.mode === "single";
  elements.appShell.classList.toggle("single-mode", isSingleMode);
  elements.modeToggleButton.textContent = isSingleMode ? "Compare Mode" : "Single Video Mode";
  elements.leftPanelTitle.textContent = isSingleMode ? "Video" : "Left Video";
  elements.timelineRange.max = String(state.duration || 0);
  if (state.activeScrubber !== "shared") {
    elements.timelineRange.value = String(clamp(state.timelineTime, 0, state.duration || 0));
  }
  elements.playPauseButton.textContent = state.playing ? "Pause" : "Play";
  elements.playbackRateSelect.value = String(state.playbackRate);
  elements.timeReadout.textContent = `${formatTime(state.timelineTime)} / ${formatTime(state.duration)}`;
  elements.loopReadout.textContent = hasLoop()
    ? `Loop: ${formatTime(state.loopStart)} to ${formatTime(state.loopEnd)}`
    : "Loop: Off";

  Object.values(state.slots).forEach((slot) => {
    const slotTime = clamp(state.timelineTime - slot.offsetSeconds, 0, slot.duration || 0);
    const boundedPan = clampPan(slot, slot.panX, slot.panY);
    slot.panX = boundedPan.x;
    slot.panY = boundedPan.y;
    slot.elements.currentTimeOutput.textContent = formatTime(slotTime);
    slot.elements.timeReadout.textContent = formatTime(slotTime);
    slot.elements.timelineRange.max = String(slot.duration || 0.01);
    slot.elements.zoomReadout.textContent = `${Math.round(slot.zoomScale * 100)}%`;
    slot.elements.captureStillButton.disabled = !slot.file || slot.captureBusy;
    slot.elements.captureClipButton.disabled = !slot.file || slot.captureBusy;
    slot.elements.captureClipButton.textContent = slot.captureBusy ? "Capturing..." : "Grab Short Clip";
    slot.elements.captureSummary.textContent = slot.lastCaptureLabel || "No captures yet.";
    slot.elements.videoStage.style.transform = `translate(${slot.panX}px, ${slot.panY}px) scale(${slot.zoomScale})`;
    slot.elements.dropZone.classList.toggle("has-video", Boolean(slot.file));
    slot.elements.dropZone.classList.toggle("zoomed", slot.zoomScale > 1.001);
    slot.elements.dropZone.classList.toggle("is-panning", state.activePan?.slotKey === slot.slotKey);
    if (state.activeScrubber !== slot.slotKey) {
      slot.elements.timelineRange.value = String(slotTime);
    }
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
      playbackRate: state.playbackRate,
    })
  );
}

function persistModeState() {
  localStorage.setItem(`${STORAGE_PREFIX}/mode`, state.mode);
}

function loadModeState() {
  const savedMode = localStorage.getItem(`${STORAGE_PREFIX}/mode`);
  state.mode = savedMode === "single" ? "single" : "compare";
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
    state.playbackRate = normalizePlaybackRate(parsed.playbackRate);
  } catch (_) {
    state.loopStart = null;
    state.loopEnd = null;
    state.playbackRate = 1;
  }
}

function toggleMode() {
  state.mode = state.mode === "single" ? "compare" : "single";
  persistModeState();
  render();
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
      zoomScale: slot.zoomScale,
      panX: slot.panX,
      panY: slot.panY,
    })
  );
}

function readSlotState(slotKey, fileKey) {
  const raw = localStorage.getItem(`${STORAGE_PREFIX}/${slotKey}/${fileKey}`);
  if (!raw) {
    return defaultSlotPersistence();
  }

  try {
    const parsed = JSON.parse(raw);
    return {
      offsetSeconds: normalizeNumber(parsed.offsetSeconds, 0),
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      zoomScale: normalizeZoomScale(parsed.zoomScale),
      panX: normalizeNumber(parsed.panX, 0),
      panY: normalizeNumber(parsed.panY, 0),
    };
  } catch (_) {
    return defaultSlotPersistence();
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

function seekSlotToTime(slotKey, slotTime) {
  const slot = state.slots[slotKey];
  if (!slot.duration) {
    return;
  }

  const nextTimelineTime = clamp(slotTime, 0, slot.duration) + slot.offsetSeconds;
  seekTo(nextTimelineTime);
}

function bindScrubberGesture(element, scrubberKey) {
  const releaseScrubber = () => {
    if (state.activeScrubber === scrubberKey) {
      state.activeScrubber = null;
      render();
    }
  };

  ["pointerdown", "mousedown", "touchstart"].forEach((eventName) => {
    element.addEventListener(eventName, () => {
      state.activeScrubber = scrubberKey;
    });
  });

  ["pointerup", "mouseup", "touchend", "touchcancel", "change", "blur"].forEach((eventName) => {
    element.addEventListener(eventName, releaseScrubber);
  });
}

function setPlaybackRate(nextRate) {
  const normalized = normalizePlaybackRate(nextRate);
  if (normalized === state.playbackRate) {
    return;
  }

  state.playbackRate = normalized;
  if (state.playing) {
    state.startedAtMs = performance.now();
    state.timelineStartedAt = state.timelineTime;
  }

  syncAllVideos();
  persistTransportState();
  render();
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
  slot.zoomScale = 1;
  slot.panX = 0;
  slot.panY = 0;
  slot.lastCaptureLabel = "";
  slot.captureBusy = false;

  fileName.textContent = "No file selected";
  timeReadout.textContent = "00:00.00";
  currentTimeOutput.textContent = "00:00.00";
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;

function adjustZoom(slotKey, delta, anchor = null) {
  const slot = state.slots[slotKey];
  const nextScale = normalizeZoomScale(slot.zoomScale + delta);
  setZoom(slotKey, nextScale, anchor);
}

function resetZoom(slotKey) {
  if (state.activePan?.slotKey === slotKey) {
    state.activePan = null;
  }
  setZoom(slotKey, 1);
}

function setZoom(slotKey, scale, anchor = null) {
  const slot = state.slots[slotKey];
  const nextScale = normalizeZoomScale(scale);
  const previousScale = slot.zoomScale;
  const frameRect = slot.elements.dropZone.getBoundingClientRect();

  if (anchor && previousScale !== nextScale) {
    const centerX = frameRect.width / 2;
    const centerY = frameRect.height / 2;
    const anchorX = anchor.clientX - frameRect.left;
    const anchorY = anchor.clientY - frameRect.top;
    const contentX = (anchorX - centerX - slot.panX) / previousScale;
    const contentY = (anchorY - centerY - slot.panY) / previousScale;

    slot.panX = anchorX - centerX - contentX * nextScale;
    slot.panY = anchorY - centerY - contentY * nextScale;
  }

  slot.zoomScale = nextScale;
  if (nextScale === 1) {
    slot.panX = 0;
    slot.panY = 0;
  } else {
    const boundedPan = clampPan(slot, slot.panX, slot.panY);
    slot.panX = boundedPan.x;
    slot.panY = boundedPan.y;
  }

  persistSlotState(slotKey);
  render();
}

function setPan(slotKey, panX, panY) {
  const slot = state.slots[slotKey];
  const boundedPan = clampPan(slot, panX, panY);
  slot.panX = boundedPan.x;
  slot.panY = boundedPan.y;
  render();
}

function clampPan(slot, panX, panY) {
  const frameRect = slot.elements.dropZone.getBoundingClientRect();
  const maxPanX = Math.max(0, (frameRect.width * (slot.zoomScale - 1)) / 2);
  const maxPanY = Math.max(0, (frameRect.height * (slot.zoomScale - 1)) / 2);

  return {
    x: clamp(panX, -maxPanX, maxPanX),
    y: clamp(panY, -maxPanY, maxPanY),
  };
}

function defaultSlotPersistence() {
  return {
    offsetSeconds: 0,
    tags: [],
    zoomScale: 1,
    panX: 0,
    panY: 0,
  };
}

async function captureStill(slotKey) {
  const slot = state.slots[slotKey];
  const { video } = slot.elements;
  if (!slot.file || !slot.duration || video.readyState < 2) {
    state.statusMessage = `Load a ${slotKey} video before grabbing a still.`;
    render();
    return;
  }

  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth || 1280;
  canvas.height = video.videoHeight || 720;
  const context = canvas.getContext("2d");

  if (!context) {
    state.statusMessage = "This browser could not create a capture canvas.";
    render();
    return;
  }

  context.drawImage(video, 0, 0, canvas.width, canvas.height);

  const blob = await canvasToBlob(canvas, "image/png");
  if (!blob) {
    state.statusMessage = "Still capture failed.";
    render();
    return;
  }

  const slotTime = getSlotTargetTime(slot, state.timelineTime);
  const fileName = buildCaptureFilename(slot, "still", slotTime, "png");
  downloadBlob(blob, fileName);

  slot.lastCaptureLabel = `Still saved at ${formatTime(slotTime)}.`;
  state.statusMessage = `Saved ${slotKey} still: ${fileName}`;
  render();
}

async function captureClip(slotKey) {
  const slot = state.slots[slotKey];
  if (!slot.file || !slot.duration || slot.captureBusy) {
    return;
  }

  const clipRange = getClipRangeForSlot(slot);
  if (!clipRange) {
    state.statusMessage = `Could not determine a clip range for the ${slotKey} video.`;
    render();
    return;
  }

  if (typeof MediaRecorder === "undefined") {
    state.statusMessage = "Short clip capture is not supported in this browser.";
    render();
    return;
  }

  slot.captureBusy = true;
  state.statusMessage = `Capturing ${slotKey} clip from ${formatTime(clipRange.start)} to ${formatTime(clipRange.end)}...`;
  render();

  try {
    const blob = await recordSlotClip(slot, clipRange);
    const fileName = buildCaptureFilename(slot, "clip", clipRange.start, "webm");
    downloadBlob(blob, fileName);
    slot.lastCaptureLabel = `Clip saved: ${formatTime(clipRange.start)} to ${formatTime(clipRange.end)}.`;
    state.statusMessage = `Saved ${slotKey} clip: ${fileName}`;
  } catch (_) {
    state.statusMessage = `Short clip capture failed for the ${slotKey} video.`;
  } finally {
    slot.captureBusy = false;
    render();
  }
}

function getClipRangeForSlot(slot) {
  const maxLoopDuration = 4;

  if (hasLoop()) {
    const start = clamp(state.loopStart - slot.offsetSeconds, 0, slot.duration);
    const unclampedEnd = clamp(state.loopEnd - slot.offsetSeconds, 0, slot.duration);
    const end = Math.min(unclampedEnd, start + maxLoopDuration);
    if (end > start) {
      return { start, end };
    }
  }

  const start = clamp(getSlotTargetTime(slot, state.timelineTime), 0, slot.duration);
  const end = Math.min(slot.duration, start + 3);
  return end > start ? { start, end } : null;
}

async function recordSlotClip(slot, clipRange) {
  const mimeType = getSupportedClipMimeType();
  if (!mimeType) {
    throw new Error("unsupported-recorder");
  }

  const captureVideo = document.createElement("video");
  captureVideo.muted = true;
  captureVideo.playsInline = true;
  captureVideo.preload = "auto";
  captureVideo.src = slot.objectUrl;

  await waitForEvent(captureVideo, "loadedmetadata");

  const canvas = document.createElement("canvas");
  canvas.width = captureVideo.videoWidth || 1280;
  canvas.height = captureVideo.videoHeight || 720;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("missing-canvas-context");
  }

  const stream = canvas.captureStream(30);
  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks = [];

  recorder.addEventListener("dataavailable", (event) => {
    if (event.data?.size) {
      chunks.push(event.data);
    }
  });

  const stopped = new Promise((resolve) => {
    recorder.addEventListener(
      "stop",
      () => {
        resolve(new Blob(chunks, { type: mimeType }));
      },
      { once: true }
    );
  });

  captureVideo.currentTime = clipRange.start;
  await waitForEvent(captureVideo, "seeked");
  context.drawImage(captureVideo, 0, 0, canvas.width, canvas.height);

  recorder.start();
  let rafId = null;

  await new Promise((resolve, reject) => {
    const draw = () => {
      context.drawImage(captureVideo, 0, 0, canvas.width, canvas.height);

      if (captureVideo.currentTime >= clipRange.end || captureVideo.ended) {
        resolve();
        return;
      }

      rafId = requestAnimationFrame(draw);
    };

    captureVideo.addEventListener("error", () => reject(new Error("capture-video-error")), { once: true });
    rafId = requestAnimationFrame(draw);
    void captureVideo.play().catch(reject);
  });

  if (rafId !== null) {
    cancelAnimationFrame(rafId);
  }

  captureVideo.pause();
  recorder.stop();
  const blob = await stopped;
  stream.getTracks().forEach((track) => track.stop());
  captureVideo.removeAttribute("src");
  captureVideo.load();
  return blob;
}

function getSupportedClipMimeType() {
  const mimeTypes = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  return mimeTypes.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ?? "";
}

function canvasToBlob(canvas, mimeType) {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, mimeType);
  });
}

function waitForEvent(target, eventName) {
  return new Promise((resolve, reject) => {
    const onSuccess = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(`${eventName}-failed`));
    };
    const cleanup = () => {
      target.removeEventListener(eventName, onSuccess);
      target.removeEventListener("error", onError);
    };

    target.addEventListener(eventName, onSuccess, { once: true });
    target.addEventListener("error", onError, { once: true });
  });
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();

  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

function buildCaptureFilename(slot, kind, timeSeconds, extension) {
  const baseName = (slot.file?.name || `${slot.slotKey}-video`).replace(/\.[^./]+$/, "");
  const safeBaseName = baseName.replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "") || slot.slotKey;
  const timestamp = formatTime(timeSeconds).replace(/[:.]/g, "-");
  return `${safeBaseName}-${kind}-${timestamp}.${extension}`;
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

function normalizePlaybackRate(value) {
  const allowedRates = [0.25, 0.5, 0.75, 1];
  const parsed = Number(value);
  return allowedRates.includes(parsed) ? parsed : 1;
}

function normalizeZoomScale(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 1;
  }
  return clamp(parsed, MIN_ZOOM, MAX_ZOOM);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
