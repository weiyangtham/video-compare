const STORAGE_PREFIX = "video-compare/v1";
const state = {
  mode: "single",
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
  openSettingsSlot: null,
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
  loopReadout: document.getElementById("loopReadout"),
  leftPanelTitle: document.getElementById("leftPanelTitle"),
  rightPanelTitle: document.getElementById("rightPanelTitle"),
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
    timelineRange: document.getElementById(`${prefix}TimelineRange`),
    inlinePlayButton: document.getElementById(`${prefix}InlinePlayButton`),
    zoomInButton: document.getElementById(`${prefix}ZoomInButton`),
    zoomOutButton: document.getElementById(`${prefix}ZoomOutButton`),
    zoomResetButton: document.getElementById(`${prefix}ZoomResetButton`),
    zoomReadout: document.getElementById(`${prefix}ZoomReadout`),
    settingsButton: document.getElementById(`${prefix}SettingsButton`),
    settingsMenu: document.getElementById(`${prefix}SettingsMenu`),
    playbackRateButtons: Array.from(
      document.querySelectorAll(`#${prefix}SettingsMenu [data-playback-rate]`)
    ),
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
    zoomScale: 1,
    panX: 0,
    panY: 0,
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
  elements.playPauseButton?.addEventListener("click", togglePlayback);
  elements.stepBackButton?.addEventListener("click", () => seekTo(state.timelineTime - 1));
  elements.stepForwardButton?.addEventListener("click", () => seekTo(state.timelineTime + 1));
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
  document.addEventListener("click", handleDocumentClick);
  document.addEventListener("keydown", handleDocumentKeydown);
}

function bindSlotEvents(slotKey) {
  const slot = state.slots[slotKey];
  const {
    fileInput,
    video,
    dropZone,
    timelineRange,
    inlinePlayButton,
    zoomInButton,
    zoomOutButton,
    zoomResetButton,
    settingsButton,
    settingsMenu,
    playbackRateButtons,
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

  timelineRange.addEventListener("input", (event) => {
    pausePlayback();
    seekSlotToTime(slotKey, Number(event.target.value));
  });
  bindScrubberGesture(timelineRange, slotKey);
  inlinePlayButton.addEventListener("click", togglePlayback);

  zoomInButton.addEventListener("click", () => adjustZoom(slotKey, ZOOM_STEP));
  zoomOutButton.addEventListener("click", () => adjustZoom(slotKey, -ZOOM_STEP));
  zoomResetButton.addEventListener("click", () => resetZoom(slotKey));
  settingsButton.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleSettingsMenu(slotKey);
  });
  settingsMenu.addEventListener("click", (event) => {
    event.stopPropagation();
  });
  playbackRateButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setPlaybackRate(Number(button.dataset.playbackRate));
      closeSettingsMenu();
    });
  });

  dropZone.addEventListener(
    "wheel",
    (event) => {
      if (!slot.file || !event.altKey) {
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

    if (event.target.closest(".video-toolbar")) {
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

  const savedState = readSlotState(slotKey, slot.fileKey);
  slot.zoomScale = savedState.zoomScale;
  slot.panX = savedState.panX;
  slot.panY = savedState.panY;

  video.src = slot.objectUrl;
  video.load();
  slot.elements.fileName.textContent = file.name;
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

  getActiveSlots().forEach((slot) => {
    if (slot.file) {
      syncVideoToTimeline(slot);
      void slot.elements.video.play().catch(() => {});
    }
  });

  getInactiveSlots().forEach((slot) => {
    slot.elements.video.pause();
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
  getActiveSlots().forEach(syncVideoToTimeline);
  getInactiveSlots().forEach((slot) => {
    slot.elements.video.pause();
  });
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

function render() {
  const isSingleMode = state.mode === "single";
  const isCompareMode = state.mode === "compare";
  elements.appShell.classList.toggle("single-mode", isSingleMode);
  elements.appShell.classList.toggle("compare-mode", isCompareMode);
  elements.modeToggleButton.textContent = isCompareMode ? "Back to Solo" : "Enable Compare";
  elements.modeToggleButton.setAttribute("aria-pressed", String(isCompareMode));
  elements.modeToggleButton.classList.toggle("primary", isCompareMode);
  elements.modeToggleButton.classList.toggle("ghost", !isCompareMode);
  elements.leftPanelTitle.textContent = isCompareMode ? "Primary Video" : "Video";
  elements.rightPanelTitle.textContent = "Compare Video";
  if (elements.playPauseButton) {
    elements.playPauseButton.textContent = state.playing ? "Pause" : "Play";
  }
  elements.playbackRateSelect.value = String(state.playbackRate);
  elements.loopReadout.textContent = hasLoop()
    ? `Loop: ${formatTime(state.loopStart)} to ${formatTime(state.loopEnd)}`
    : "Loop: Off";

  Object.values(state.slots).forEach((slot) => {
    const slotTime = clamp(state.timelineTime, 0, slot.duration || 0);
    const scrubberProgress = slot.duration ? (slotTime / slot.duration) * 100 : 0;
    const boundedPan = clampPan(slot, slot.panX, slot.panY);
    slot.panX = boundedPan.x;
    slot.panY = boundedPan.y;
    slot.elements.timeReadout.textContent = formatTime(slotTime);
    slot.elements.timelineRange.max = String(slot.duration || 0.01);
    slot.elements.timelineRange.style.setProperty("--range-progress", `${scrubberProgress}%`);
    slot.elements.inlinePlayButton.textContent = state.playing ? "❚❚" : "▶";
    slot.elements.inlinePlayButton.setAttribute(
      "aria-label",
      `${state.playing ? "Pause" : "Play"} synced videos`
    );
    slot.elements.inlinePlayButton.disabled = !state.duration;
    slot.elements.settingsButton.disabled = !state.duration;
    slot.elements.settingsButton.setAttribute("aria-expanded", String(state.openSettingsSlot === slot.slotKey));
    slot.elements.settingsMenu.hidden = state.openSettingsSlot !== slot.slotKey;
    slot.elements.playbackRateButtons.forEach((button) => {
      const isActive = Number(button.dataset.playbackRate) === state.playbackRate;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });
    slot.elements.zoomReadout.textContent = `${Math.round(slot.zoomScale * 100)}%`;
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
function recalculateSharedDuration() {
  const durations = getActiveSlots()
    .filter((slot) => slot.duration > 0)
    .map((slot) => slot.duration);

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
  state.mode = savedMode === "compare" ? "compare" : "single";
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
  closeSettingsMenu();
  recalculateSharedDuration();
  seekTo(state.timelineTime);
  persistModeState();
  render();
}

function toggleSettingsMenu(slotKey) {
  state.openSettingsSlot = state.openSettingsSlot === slotKey ? null : slotKey;
  render();
}

function closeSettingsMenu() {
  if (state.openSettingsSlot === null) {
    return;
  }
  state.openSettingsSlot = null;
  render();
}

function handleDocumentClick(event) {
  if (!event.target.closest(".video-settings")) {
    closeSettingsMenu();
  }
}

function handleDocumentKeydown(event) {
  if (event.key === "Escape") {
    closeSettingsMenu();
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

  const nextTimelineTime = clamp(slotTime, 0, slot.duration);
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
  return clamp(timelineTime, 0, slot.duration);
}

function isSlotActiveAtTimelineTime(slot, timelineTime) {
  return timelineTime <= slot.duration;
}

function buildStatusText() {
  if (state.statusMessage) {
    return state.statusMessage;
  }

  const loadedCount = getActiveSlots().filter((slot) => slot.file).length;

  if (!loadedCount) {
    return state.mode === "compare" ? "Load one or two videos to begin." : "Load a video to begin.";
  }

  if (hasLoop()) {
    return `Looping is ready from ${formatTime(state.loopStart)} to ${formatTime(state.loopEnd)}.`;
  }

  if (state.mode === "compare" && loadedCount === 1) {
    return "Primary video loaded. Add a compare video when you're ready.";
  }

  return `${loadedCount} video${loadedCount === 1 ? "" : "s"} loaded. Timeline duration ${formatTime(state.duration)}.`;
}

function clearSlotMedia(slot) {
  const { video, fileName, timeReadout } = slot.elements;

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

  fileName.textContent = "No file selected";
  timeReadout.textContent = "00:00.00";
}

function getActiveSlots() {
  return state.mode === "compare" ? [state.slots.left, state.slots.right] : [state.slots.left];
}

function getInactiveSlots() {
  return state.mode === "compare" ? [] : [state.slots.right];
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
    zoomScale: 1,
    panX: 0,
    panY: 0,
  };
}

function handleVideoLoadError(slotKey) {
  const slot = state.slots[slotKey];
  const fileName = slot.file?.name ?? "selected file";

  clearSlotMedia(slot);
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
