const STORAGE_PREFIX = "video-compare/v1";
const DEFAULT_SEEK_STEP_SECONDS = 0.1;
const MIN_SEEK_STEP_SECONDS = 0.01;
const MAX_SEEK_STEP_SECONDS = 5;

const state = {
  mode: "single",
  timelineTime: 0,
  playing: false,
  playbackRate: 1,
  seekStepSeconds: DEFAULT_SEEK_STEP_SECONDS,
  audioSlotKey: "left",
  activeSlotKey: "left",
  duration: 0,
  loopStart: null,
  loopEnd: null,
  statusMessage: "",
  animationFrameId: null,
  startedAtMs: null,
  timelineStartedAt: 0,
  loopResumeUntilMs: 0,
  activeScrubber: null,
  activePan: null,
  activeDraw: null,
  activePaletteDrag: null,
  openSettingsSlot: null,
  openSettingsPanel: "menu",
  shortcutDialogOpen: false,
  settingsTransitionDirection: "forward",
  slots: {
    left: createSlotState("left"),
    right: createSlotState("right"),
  },
};

const elements = {
  appShell: document.getElementById("appShell"),
  statusBanner: document.getElementById("statusBanner"),
  playbackRateSelect: document.getElementById("playbackRateSelect"),
  loopActionButtons: Array.from(document.querySelectorAll("[data-loop-action]")),
  modeToggleButton: document.getElementById("modeToggleButton"),
  shortcutHelpButton: document.getElementById("shortcutHelpButton"),
  shortcutHelpDialog: document.getElementById("shortcutHelpDialog"),
  shortcutHelpCloseButton: document.getElementById("shortcutHelpCloseButton"),
  leftPanelTitle: document.getElementById("leftPanelTitle"),
  rightPanelTitle: document.getElementById("rightPanelTitle"),
  shortcutActivePanel: document.getElementById("shortcutActivePanel"),
};

["left", "right"].forEach((slotKey) => {
  const prefix = slotKey;
  state.slots[slotKey].elements = {
    panel: document.querySelector(`[data-slot="${prefix}"]`),
    fileInput: document.getElementById(`${prefix}FileInput`),
    video: document.getElementById(`${prefix}Video`),
    videoStage: document.getElementById(`${prefix}VideoStage`),
    overlayCanvas: document.getElementById(`${prefix}OverlayCanvas`),
    dropZone: document.querySelector(`[data-drop-zone="${prefix}"]`),
    fileMeta: document.getElementById(`${prefix}FileMeta`),
    timeReadout: document.getElementById(`${prefix}TimeReadout`),
    timelineRange: document.getElementById(`${prefix}TimelineRange`),
    inlinePlayButton: document.getElementById(`${prefix}InlinePlayButton`),
    stepBackButton: document.getElementById(`${prefix}StepBackButton`),
    stepForwardButton: document.getElementById(`${prefix}StepForwardButton`),
    captureStillButton: document.getElementById(`${prefix}CaptureStillButton`),
    captureClipButton: document.getElementById(`${prefix}CaptureClipButton`),
    drawToggleButton: document.getElementById(`${prefix}DrawToggleButton`),
    audioButton: document.getElementById(`${prefix}AudioButton`),
    zoomInButton: document.getElementById(`${prefix}ZoomInButton`),
    zoomOutButton: document.getElementById(`${prefix}ZoomOutButton`),
    zoomResetButton: document.getElementById(`${prefix}ZoomResetButton`),
    zoomReadout: document.getElementById(`${prefix}ZoomReadout`),
    drawPalette: document.getElementById(`${prefix}DrawPalette`),
    settingsButton: document.getElementById(`${prefix}SettingsButton`),
    settingsMenu: document.getElementById(`${prefix}SettingsMenu`),
    settingsPanels: Array.from(document.querySelectorAll(`#${prefix}SettingsMenu [data-settings-panel]`)),
    settingsNavButtons: Array.from(document.querySelectorAll(`#${prefix}SettingsMenu [data-settings-panel-target]`)),
    settingsBackButtons: Array.from(document.querySelectorAll(`#${prefix}SettingsMenu .settings-back-button`)),
    seekStepButtons: Array.from(document.querySelectorAll(`#${prefix}SettingsMenu [data-seek-step]`)),
    settingsSummaryPlayback: document.querySelector(`#${prefix}SettingsMenu [data-settings-summary="playback"]`),
    settingsSummarySeek: document.querySelector(`#${prefix}SettingsMenu [data-settings-summary="seek"]`),
    settingsSeekInput: document.querySelector(`#${prefix}SettingsMenu .settings-seek-input`),
    playbackRateButtons: Array.from(
      document.querySelectorAll(`#${prefix}SettingsMenu [data-playback-rate]`)
    ),
    scrubberTrack: document.querySelector(`[data-slot="${prefix}"] .video-scrubber-track`),
    drawToolButtons: Array.from(document.querySelectorAll(`[id^="${prefix}Draw"][data-draw-tool]`)),
    drawDoneButton: document.getElementById(`${prefix}DrawDoneButton`),
    drawUndoButton: document.getElementById(`${prefix}DrawUndoButton`),
    drawClearButton: document.getElementById(`${prefix}DrawClearButton`),
    drawColorButtons: Array.from(document.querySelectorAll(`[id^="${prefix}Color"][data-draw-color]`)),
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
    drawTool: "pan",
    drawPaletteOpen: false,
    drawPalettePosition: null,
    drawColor: "#6dd3c7",
    annotations: [],
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
  syncAudio();
  render();
}

function bindGlobalEvents() {
  elements.playbackRateSelect.addEventListener("change", (event) => {
    setPlaybackRate(Number(event.target.value));
  });
  elements.loopActionButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.loopAction;
      if (action === "start") {
        setLoopPoint("start");
      } else if (action === "end") {
        setLoopPoint("end");
      } else if (action === "clear") {
        clearLoopPoints();
      }
    });
  });
  elements.modeToggleButton.addEventListener("click", toggleMode);
  elements.shortcutHelpButton.addEventListener("click", toggleShortcutDialog);
  elements.shortcutHelpCloseButton.addEventListener("click", closeShortcutDialog);
  document.addEventListener("click", handleDocumentClick);
  document.addEventListener("keydown", handleDocumentKeydown);
  document.addEventListener("pointermove", handleDocumentPointerMove);
  document.addEventListener("pointerup", handleDocumentPointerUp);
  document.addEventListener("pointercancel", handleDocumentPointerUp);
  window.addEventListener("resize", render);
}

function bindSlotEvents(slotKey) {
  const slot = state.slots[slotKey];
  const {
    panel,
    fileInput,
    video,
    dropZone,
    timelineRange,
    inlinePlayButton,
    stepBackButton,
    stepForwardButton,
    captureStillButton,
    captureClipButton,
    drawToggleButton,
    audioButton,
    zoomInButton,
    zoomOutButton,
    zoomResetButton,
    drawPalette,
    settingsButton,
    settingsMenu,
    settingsNavButtons,
    settingsBackButtons,
    seekStepButtons,
    settingsSeekInput,
    playbackRateButtons,
    overlayCanvas,
    drawToolButtons,
    drawDoneButton,
    drawUndoButton,
    drawClearButton,
    drawColorButtons,
  } = slot.elements;

  panel.addEventListener("pointerdown", () => {
    setActiveSlot(slotKey);
  });
  panel.addEventListener("focusin", () => {
    setActiveSlot(slotKey);
  });

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
    state.statusMessage = "";
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
  stepBackButton.addEventListener("click", () => seekBy(-state.seekStepSeconds));
  stepForwardButton.addEventListener("click", () => seekBy(state.seekStepSeconds));
  captureStillButton.addEventListener("click", () => {
    void captureStill(slotKey);
  });
  captureClipButton.addEventListener("click", () => {
    void captureClip(slotKey);
  });
  drawToggleButton.addEventListener("click", () => toggleDrawPalette(slotKey));
  drawPalette.addEventListener("pointerdown", (event) => startPaletteDrag(slotKey, event));
  audioButton.addEventListener("click", () => toggleSlotAudio(slotKey));

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
  settingsNavButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.settingsTransitionDirection = "forward";
      state.openSettingsPanel = button.dataset.settingsPanelTarget || "menu";
      render();
    });
  });
  settingsBackButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.settingsTransitionDirection = "back";
      state.openSettingsPanel = "menu";
      render();
    });
  });
  playbackRateButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setPlaybackRate(Number(button.dataset.playbackRate));
      closeSettingsMenu();
    });
  });
  seekStepButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setSeekStep(Number(button.dataset.seekStep));
      closeSettingsMenu();
    });
  });
  settingsSeekInput.addEventListener("input", (event) => {
    setSeekStep(Number(event.target.value), { persist: false, rerender: false });
    syncSettingsSeekInputs();
    updateSeekControls();
  });
  settingsSeekInput.addEventListener("change", (event) => {
    setSeekStep(Number(event.target.value));
    closeSettingsMenu();
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
    if (event.button !== 0 || !slot.file || slot.zoomScale <= 1 || slot.drawTool !== "pan") {
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

  drawToolButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setDrawTool(slotKey, button.dataset.drawTool || "pan");
    });
  });
  drawDoneButton.addEventListener("click", () => closeDrawPalette(slotKey));
  drawUndoButton.addEventListener("click", () => undoDrawing(slotKey));
  drawClearButton.addEventListener("click", () => clearDrawings(slotKey));
  drawColorButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setDrawColor(slotKey, button.dataset.drawColor || slot.drawColor);
    });
  });
  bindDrawingGesture(slotKey, overlayCanvas);
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
  slot.captureBusy = false;
  slot.annotations = [];
  slot.drawTool = "pan";
  slot.drawPaletteOpen = false;
  slot.drawColor = "#6dd3c7";
  ensureValidAudioSlot();
  syncAudio();

  const savedState = readSlotState(slotKey, slot.fileKey);
  slot.zoomScale = savedState.zoomScale;
  slot.panX = savedState.panX;
  slot.panY = savedState.panY;

  video.src = slot.objectUrl;
  video.load();
  slot.elements.fileMeta.textContent = file.name;
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
  state.loopResumeUntilMs = 0;

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
  syncAudio();
  render();
}

function pausePlayback() {
  state.playing = false;
  if (state.animationFrameId !== null) {
    cancelAnimationFrame(state.animationFrameId);
    state.animationFrameId = null;
  }
  state.loopResumeUntilMs = 0;

  Object.values(state.slots).forEach((slot) => {
    slot.elements.video.pause();
  });

  syncAudio();
  render();
}

function tickPlayback() {
  if (!state.playing) {
    return;
  }

  const now = performance.now();
  const audibleSlot = getAudibleSlot();
  const elapsedSeconds = (now - state.startedAtMs) / 1000;
  const shouldUseAudioClock =
    !hasLoop() &&
    audibleSlot &&
    !audibleSlot.elements.video.paused &&
    now >= state.loopResumeUntilMs;
  let nextTime = shouldUseAudioClock
    ? getSlotTimelineTime(audibleSlot)
    : state.timelineStartedAt + elapsedSeconds * state.playbackRate;

  if (hasLoop() && nextTime >= state.loopEnd) {
    nextTime = state.loopStart;
    state.startedAtMs = now;
    state.timelineStartedAt = nextTime;
    state.loopResumeUntilMs = now + 180;
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
  state.loopResumeUntilMs = 0;

  syncAllVideos();
  render();
}

function syncAllVideos() {
  getActiveSlots().forEach(syncVideoToTimeline);
  getInactiveSlots().forEach((slot) => {
    slot.elements.video.pause();
  });
  syncAudio();
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
  const isAudioMaster = isAudioMasterSlot(slot);
  const allowedDrift = isAudioMaster && state.playing ? 0.35 : 0.08;

  if (drift > allowedDrift || !state.playing) {
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
  const audibleSlotKey = getAudibleSlotKey();
  const activeSlotKey = getShortcutSlotKey();
  elements.appShell.classList.toggle("single-mode", isSingleMode);
  elements.appShell.classList.toggle("compare-mode", isCompareMode);
  elements.modeToggleButton.textContent = isCompareMode ? "Back to Solo" : "Enable Compare";
  elements.modeToggleButton.setAttribute("aria-pressed", String(isCompareMode));
  elements.modeToggleButton.classList.toggle("primary", isCompareMode);
  elements.modeToggleButton.classList.toggle("ghost", !isCompareMode);
  elements.shortcutHelpButton.setAttribute("aria-expanded", String(state.shortcutDialogOpen));
  elements.leftPanelTitle.textContent = isCompareMode ? "Primary Video" : "Video";
  elements.rightPanelTitle.textContent = "Compare Video";
  elements.shortcutActivePanel.textContent = isCompareMode ? capitalize(activeSlotKey) : "Primary";
  elements.shortcutHelpDialog.hidden = !state.shortcutDialogOpen;
  elements.playbackRateSelect.value = String(state.playbackRate);
  Object.values(state.slots).forEach((slot) => {
    const slotTime = clamp(state.timelineTime, 0, slot.duration || 0);
    const scrubberProgress = slot.duration ? (slotTime / slot.duration) * 100 : 0;
    const boundedPan = clampPan(slot, slot.panX, slot.panY);
    slot.panX = boundedPan.x;
    slot.panY = boundedPan.y;
    slot.elements.timeReadout.textContent = formatTime(slotTime);
    slot.elements.timelineRange.max = String(slot.duration || 0.01);
    slot.elements.timelineRange.style.setProperty("--range-progress", `${scrubberProgress}%`);
    applyLoopTrackVisual(slot);
    slot.elements.inlinePlayButton.textContent = state.playing ? "❚❚" : "▶";
    slot.elements.inlinePlayButton.setAttribute(
      "aria-label",
      `${state.playing ? "Pause" : "Play"} synced videos`
    );
    slot.elements.inlinePlayButton.disabled = !state.duration;
    slot.elements.stepBackButton.textContent = `-${formatSeekStepLabel(state.seekStepSeconds)}`;
    slot.elements.stepForwardButton.textContent = `+${formatSeekStepLabel(state.seekStepSeconds)}`;
    slot.elements.stepBackButton.setAttribute(
      "aria-label",
      `Step back ${formatSeekStepSpoken(state.seekStepSeconds)}`
    );
    slot.elements.stepForwardButton.setAttribute(
      "aria-label",
      `Step forward ${formatSeekStepSpoken(state.seekStepSeconds)}`
    );
    slot.elements.stepBackButton.disabled = !state.duration;
    slot.elements.stepForwardButton.disabled = !state.duration;
    slot.elements.captureStillButton.disabled = !slot.file || slot.captureBusy;
    slot.elements.captureClipButton.disabled = !slot.file || slot.captureBusy;
    slot.elements.captureClipButton.textContent = slot.captureBusy ? "Capturing..." : "Grab Clip";
    slot.elements.drawToggleButton.disabled = !slot.file;
    slot.elements.drawToggleButton.classList.toggle("is-active", slot.drawPaletteOpen);
    slot.elements.drawToggleButton.setAttribute("aria-pressed", String(slot.drawPaletteOpen));
    slot.elements.drawPalette.hidden = !slot.drawPaletteOpen;
    if (slot.drawPaletteOpen) {
      positionDrawPalette(slot);
    }
    slot.elements.drawPalette.classList.toggle("is-dragging", state.activePaletteDrag?.slotKey === slot.slotKey);
    slot.elements.audioButton.disabled = !slot.file || (slot.slotKey === "right" && state.mode === "single");
    slot.elements.audioButton.classList.toggle("is-active", audibleSlotKey === slot.slotKey);
    slot.elements.audioButton.textContent = audibleSlotKey === slot.slotKey ? "🔊" : "🔇";
    slot.elements.audioButton.setAttribute(
      "aria-label",
      audibleSlotKey === slot.slotKey ? `Disable sound for the ${slot.slotKey} video` : `Enable sound for the ${slot.slotKey} video`
    );
    slot.elements.audioButton.setAttribute("aria-pressed", String(audibleSlotKey === slot.slotKey));
    slot.elements.settingsButton.disabled = !state.duration;
    slot.elements.settingsButton.setAttribute("aria-expanded", String(state.openSettingsSlot === slot.slotKey));
    slot.elements.settingsMenu.hidden = state.openSettingsSlot !== slot.slotKey;
    slot.elements.settingsPanels.forEach((panel) => {
      const panelName = panel.dataset.settingsPanel;
      const isActive = panelName === state.openSettingsPanel;
      panel.hidden = false;
      panel.classList.toggle("is-active", isActive);
      panel.classList.toggle("is-before", isSettingsPanelBefore(panelName, state.openSettingsPanel));
      panel.classList.toggle("is-after", isSettingsPanelAfter(panelName, state.openSettingsPanel));
      panel.classList.toggle("is-transition-back", state.settingsTransitionDirection === "back");
    });
    slot.elements.settingsSummaryPlayback.textContent = `${formatPlaybackRateLabel(state.playbackRate)}x`;
    slot.elements.settingsSummarySeek.textContent = formatSeekStepLabel(state.seekStepSeconds);
    slot.elements.playbackRateButtons.forEach((button) => {
      const isActive = Number(button.dataset.playbackRate) === state.playbackRate;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });
    slot.elements.seekStepButtons.forEach((button) => {
      const isActive = Number(button.dataset.seekStep) === state.seekStepSeconds;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });
    slot.elements.settingsSeekInput.value = formatSeekStepValue(state.seekStepSeconds);
    updateSettingsMenuHeight(slot);
    slot.elements.zoomReadout.textContent = `${Math.round(slot.zoomScale * 100)}%`;
    slot.elements.videoStage.style.transform = `translate(${slot.panX}px, ${slot.panY}px) scale(${slot.zoomScale})`;
    slot.elements.panel.classList.toggle("is-active-panel", slot.slotKey === activeSlotKey);
    slot.elements.dropZone.classList.toggle("has-video", Boolean(slot.file));
    slot.elements.dropZone.classList.toggle("zoomed", slot.zoomScale > 1.001);
    slot.elements.dropZone.classList.toggle("is-panning", state.activePan?.slotKey === slot.slotKey);
    slot.elements.dropZone.classList.toggle("is-drawing", slot.file && slot.drawPaletteOpen);
    slot.elements.drawToolButtons.forEach((button) => {
      const isActive = button.dataset.drawTool === slot.drawTool;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
      button.disabled = !slot.file || !slot.drawPaletteOpen;
    });
    slot.elements.drawDoneButton.disabled = !slot.file || !slot.drawPaletteOpen;
    slot.elements.drawUndoButton.disabled = !slot.annotations.length || !slot.drawPaletteOpen;
    slot.elements.drawClearButton.disabled = !slot.annotations.length || !slot.drawPaletteOpen;
    slot.elements.drawColorButtons.forEach((button) => {
      const isActive = button.dataset.drawColor === slot.drawColor;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
      button.disabled = !slot.file || !slot.drawPaletteOpen;
    });
    renderOverlay(slot);
    if (state.activeScrubber !== slot.slotKey) {
      slot.elements.timelineRange.value = String(slotTime);
    }
  });

  const statusText = buildStatusText();
  elements.statusBanner.textContent = statusText;
  elements.statusBanner.hidden = !statusText;
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
      seekStepSeconds: state.seekStepSeconds,
      audioSlotKey: state.audioSlotKey,
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
    state.seekStepSeconds = normalizeSeekStep(parsed.seekStepSeconds);
    state.audioSlotKey = normalizeAudioSlotKey(parsed.audioSlotKey);
  } catch (_) {
    state.loopStart = null;
    state.loopEnd = null;
    state.playbackRate = 1;
    state.seekStepSeconds = DEFAULT_SEEK_STEP_SECONDS;
    state.audioSlotKey = "left";
  }
}

function toggleMode() {
  state.mode = state.mode === "single" ? "compare" : "single";
  if (state.mode === "single" || !state.slots[state.activeSlotKey]?.file) {
    state.activeSlotKey = "left";
  }
  closeSettingsMenu();
  closeDrawPalette("left", { silent: true });
  closeDrawPalette("right", { silent: true });
  recalculateSharedDuration();
  ensureValidAudioSlot();
  seekTo(state.timelineTime);
  persistModeState();
  persistTransportState();
  render();
}

function toggleSettingsMenu(slotKey) {
  state.openSettingsSlot = state.openSettingsSlot === slotKey ? null : slotKey;
  state.openSettingsPanel = "menu";
  state.settingsTransitionDirection = "forward";
  render();
}

function closeSettingsMenu() {
  if (state.openSettingsSlot === null) {
    return;
  }
  state.openSettingsSlot = null;
  state.openSettingsPanel = "menu";
  state.settingsTransitionDirection = "forward";
  render();
}

function toggleShortcutDialog() {
  state.shortcutDialogOpen = !state.shortcutDialogOpen;
  render();
}

function closeShortcutDialog() {
  if (!state.shortcutDialogOpen) {
    return;
  }
  state.shortcutDialogOpen = false;
  render();
}

function handleDocumentClick(event) {
  if (!event.target.closest(".video-settings")) {
    closeSettingsMenu();
  }

  if (event.target.closest("[data-shortcut-close]")) {
    closeShortcutDialog();
  }
}

function handleDocumentKeydown(event) {
  if (event.key === "Escape") {
    closeSettingsMenu();
    closeShortcutDialog();
    return;
  }

  if (shouldIgnoreShortcutKeydown(event)) {
    return;
  }

  if (event.code === "Space") {
    event.preventDefault();
    togglePlayback();
    return;
  }

  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    const direction = event.key === "ArrowLeft" ? -1 : 1;
    seekBy(state.seekStepSeconds * direction);
    return;
  }

  if (event.key === "[" || event.key === "{") {
    event.preventDefault();
    setLoopPoint("start");
    return;
  }

  if (event.key === "]" || event.key === "}") {
    event.preventDefault();
    setLoopPoint("end");
    return;
  }

  if (event.key.toLowerCase() === "c") {
    event.preventDefault();
    clearLoopPoints();
    return;
  }

  if (event.key.toLowerCase() === "m") {
    event.preventDefault();
    toggleKeyboardAudio();
    return;
  }

  if (event.key.toLowerCase() === "v") {
    event.preventDefault();
    toggleMode();
    return;
  }

  if (event.key === "+" || (event.key === "=" && event.shiftKey)) {
    event.preventDefault();
    adjustZoom(getShortcutSlotKey(), ZOOM_STEP);
    return;
  }

  if (event.key === "-" || event.key === "_") {
    event.preventDefault();
    adjustZoom(getShortcutSlotKey(), -ZOOM_STEP);
    return;
  }

  if (event.key === "0") {
    event.preventDefault();
    resetZoom(getShortcutSlotKey());
  }
}

function seekBy(deltaSeconds) {
  seekTo(state.timelineTime + deltaSeconds);
}

function setSeekStep(nextStep, { persist = true, rerender = true } = {}) {
  if (!Number.isFinite(nextStep)) {
    syncSettingsSeekInputs();
    return;
  }

  const normalized = normalizeSeekStep(nextStep);
  if (normalized === state.seekStepSeconds) {
    syncSettingsSeekInputs();
    return;
  }

  state.seekStepSeconds = normalized;
  if (persist) {
    persistTransportState();
  }
  if (rerender) {
    render();
    return;
  }

  syncSettingsSeekInputs();
  updateSeekControls();
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

function toggleSlotAudio(slotKey) {
  const slot = state.slots[slotKey];
  if (!slot.file || (slotKey === "right" && state.mode === "single")) {
    return;
  }

  state.audioSlotKey = state.audioSlotKey === slotKey ? null : slotKey;
  ensureValidAudioSlot();
  syncAudio();
  persistTransportState();
  render();
}

function toggleKeyboardAudio() {
  const activeSlotKey = getShortcutSlotKey();
  const activeSlot = state.slots[activeSlotKey];
  if (!activeSlot?.file) {
    return;
  }

  if (state.mode === "single") {
    toggleSlotAudio("left");
    return;
  }

  const otherSlotKey = activeSlotKey === "left" ? "right" : "left";
  const otherSlot = state.slots[otherSlotKey];

  if (state.audioSlotKey === activeSlotKey) {
    state.audioSlotKey = otherSlot.file ? otherSlotKey : null;
  } else {
    state.audioSlotKey = activeSlotKey;
  }

  ensureValidAudioSlot();
  syncAudio();
  persistTransportState();
  render();
}

function syncAudio() {
  const audibleSlotKey = getAudibleSlotKey();
  Object.values(state.slots).forEach((slot) => {
    const shouldBeAudible = slot.slotKey === audibleSlotKey;
    slot.elements.video.muted = !shouldBeAudible;
    slot.elements.video.volume = shouldBeAudible ? 1 : 0;
  });
}

function ensureValidAudioSlot() {
  const preferred = getAudibleSlotKey();
  if (preferred !== null || state.audioSlotKey === null) {
    return;
  }

  const fallback = getActiveSlots().find((slot) => slot.file)?.slotKey ?? null;
  state.audioSlotKey = fallback;
}

function getAudibleSlotKey() {
  if (state.audioSlotKey === null) {
    return null;
  }

  const slot = state.slots[state.audioSlotKey];
  if (!slot) {
    return null;
  }

  const isActive = state.mode === "compare" || state.audioSlotKey === "left";
  if (!isActive || !slot.file) {
    return null;
  }

  return state.audioSlotKey;
}

function getAudibleSlot() {
  const audibleSlotKey = getAudibleSlotKey();
  return audibleSlotKey ? state.slots[audibleSlotKey] : null;
}

function isAudioMasterSlot(slot) {
  return state.playing && getAudibleSlotKey() === slot.slotKey;
}

function getSlotTargetTime(slot, timelineTime) {
  return clamp(timelineTime, 0, slot.duration);
}

function getSlotTimelineTime(slot) {
  return clamp(slot.elements.video.currentTime, 0, slot.duration);
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
    return `Looping ${formatTime(state.loopStart)} to ${formatTime(state.loopEnd)}. The highlighted timeline region will replay.`;
  }

  if (state.loopStart !== null) {
    return `Loop start set at ${formatTime(state.loopStart)}. Set an end point to finish the loop.`;
  }

  if (state.loopEnd !== null) {
    return `Loop end set at ${formatTime(state.loopEnd)}. Set a start point to define the loop.`;
  }

  if (state.mode === "compare" && loadedCount === 1) {
    return "Primary video loaded. Add a compare video when you're ready.";
  }

  if (state.mode === "single") {
    return "";
  }

  return `${loadedCount} videos loaded. Timeline duration ${formatTime(state.duration)}.`;
}

function clearSlotMedia(slot) {
  const { video, fileMeta, timeReadout } = slot.elements;

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
  slot.drawTool = "pan";
  slot.drawPaletteOpen = false;
  slot.drawPalettePosition = null;
  slot.drawColor = "#6dd3c7";
  slot.annotations = [];
  slot.captureBusy = false;

  if (state.activeSlotKey === slot.slotKey) {
    state.activeSlotKey = slot.slotKey === "right" ? "left" : state.activeSlotKey;
  }

  fileMeta.textContent = "No file selected";
  timeReadout.textContent = "00:00.00";
  if (state.audioSlotKey === slot.slotKey) {
    state.audioSlotKey = getActiveSlots().find((candidate) => candidate.slotKey !== slot.slotKey && candidate.file)?.slotKey ?? null;
    syncAudio();
    persistTransportState();
  }
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

function normalizeSeekStep(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return DEFAULT_SEEK_STEP_SECONDS;
  }

  return clamp(roundTo(numericValue, 2), MIN_SEEK_STEP_SECONDS, MAX_SEEK_STEP_SECONDS);
}

function formatSeekStepValue(value) {
  return roundTo(value, 2).toFixed(2).replace(/\.?0+$/, "");
}

function formatSeekStepLabel(value) {
  return `${formatSeekStepValue(value)}s`;
}

function formatSeekStepSpoken(value) {
  return `${formatSeekStepValue(value)} seconds`;
}

function formatPlaybackRateLabel(value) {
  return Number.isInteger(value) ? String(value) : String(value).replace(/\.0$/, "");
}

function updateSettingsMenuHeight(slot) {
  if (slot.elements.settingsMenu.hidden) {
    slot.elements.settingsMenu.style.height = "";
    return;
  }

  const activePanel = slot.elements.settingsPanels.find(
    (panel) => panel.dataset.settingsPanel === state.openSettingsPanel
  );

  if (!activePanel) {
    slot.elements.settingsMenu.style.height = "";
    return;
  }

  slot.elements.settingsMenu.style.height = `${Math.ceil(activePanel.scrollHeight)}px`;
}

function getSettingsPanelOrder(panelName) {
  if (panelName === "menu") {
    return 0;
  }

  return 1;
}

function isSettingsPanelBefore(panelName, activePanelName) {
  return getSettingsPanelOrder(panelName) < getSettingsPanelOrder(activePanelName);
}

function isSettingsPanelAfter(panelName, activePanelName) {
  return getSettingsPanelOrder(panelName) > getSettingsPanelOrder(activePanelName);
}

function syncSettingsSeekInputs() {
  Object.values(state.slots).forEach((slot) => {
    slot.elements.settingsSeekInput.value = formatSeekStepValue(state.seekStepSeconds);
  });
}

function updateSeekControls() {
  Object.values(state.slots).forEach((slot) => {
    slot.elements.stepBackButton.textContent = `-${formatSeekStepLabel(state.seekStepSeconds)}`;
    slot.elements.stepForwardButton.textContent = `+${formatSeekStepLabel(state.seekStepSeconds)}`;
    slot.elements.stepBackButton.setAttribute(
      "aria-label",
      `Step back ${formatSeekStepSpoken(state.seekStepSeconds)}`
    );
    slot.elements.stepForwardButton.setAttribute(
      "aria-label",
      `Step forward ${formatSeekStepSpoken(state.seekStepSeconds)}`
    );
    slot.elements.settingsSummarySeek.textContent = formatSeekStepLabel(state.seekStepSeconds);
    slot.elements.seekStepButtons.forEach((button) => {
      const isActive = Number(button.dataset.seekStep) === state.seekStepSeconds;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });
  });
}

function roundTo(value, precision) {
  const multiplier = 10 ** precision;
  return Math.round(value * multiplier) / multiplier;
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
  drawAnnotationsToContext(context, slot.annotations, canvas.width, canvas.height);

  const blob = await canvasToBlob(canvas, "image/png");
  if (!blob) {
    state.statusMessage = "Still capture failed.";
    render();
    return;
  }

  const fileName = buildCaptureFilename(slot, "still", state.timelineTime, "png");
  downloadBlob(blob, fileName);
  state.statusMessage = `Saved ${slotKey} still: ${fileName}`;
  render();
}

async function captureClip(slotKey) {
  const slot = state.slots[slotKey];
  if (!slot.file || !slot.duration || slot.captureBusy) {
    return;
  }

  const clipRange = getClipRange(slot);
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
    const clipFormat = getSupportedClipFormat();
    if (!clipFormat) {
      throw new Error("unsupported-recorder");
    }

    const blob = await recordSlotClip(slot, clipRange, clipFormat);
    const fileName = buildCaptureFilename(slot, "clip", clipRange.start, clipFormat.extension);
    downloadBlob(blob, fileName);
    state.statusMessage = `Saved ${slotKey} clip: ${fileName}`;
  } catch (_) {
    state.statusMessage = `Short clip capture failed for the ${slotKey} video.`;
  } finally {
    slot.captureBusy = false;
    render();
  }
}

function getClipRange(slot) {
  if (hasLoop()) {
    const start = clamp(state.loopStart, 0, slot.duration);
    const end = clamp(state.loopEnd, 0, slot.duration);
    if (end > start) {
      return { start, end: Math.min(end, start + 4) };
    }
  }

  const start = clamp(state.timelineTime, 0, slot.duration);
  const end = Math.min(slot.duration, start + 3);
  return end > start ? { start, end } : null;
}

async function recordSlotClip(slot, clipRange, clipFormat) {
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
  const recorder = new MediaRecorder(stream, { mimeType: clipFormat.mimeType });
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
        resolve(new Blob(chunks, { type: clipFormat.mimeType }));
      },
      { once: true }
    );
  });

  captureVideo.currentTime = clipRange.start;
  await waitForEvent(captureVideo, "seeked");
  context.drawImage(captureVideo, 0, 0, canvas.width, canvas.height);
  drawAnnotationsToContext(context, slot.annotations, canvas.width, canvas.height);

  recorder.start();
  let rafId = null;

  await new Promise((resolve, reject) => {
    const draw = () => {
      context.drawImage(captureVideo, 0, 0, canvas.width, canvas.height);
      drawAnnotationsToContext(context, slot.annotations, canvas.width, canvas.height);

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

function getSupportedClipFormat() {
  const formats = [
    { mimeType: "video/mp4;codecs=hvc1", extension: "mp4" },
    { mimeType: "video/mp4;codecs=avc1.42E01E", extension: "mp4" },
    { mimeType: "video/mp4", extension: "mp4" },
    { mimeType: "video/webm;codecs=vp9", extension: "webm" },
    { mimeType: "video/webm;codecs=vp8", extension: "webm" },
    { mimeType: "video/webm", extension: "webm" },
  ];

  return formats.find((format) => MediaRecorder.isTypeSupported(format.mimeType)) ?? null;
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

function setLoopPoint(action) {
  if (!state.duration) {
    return;
  }

  if (action === "start") {
    state.loopStart = state.timelineTime;
    if (state.loopEnd !== null && state.loopEnd < state.loopStart) {
      state.loopEnd = null;
    }
  } else if (action === "end") {
    state.loopEnd = state.timelineTime;
    if (state.loopStart !== null && state.loopEnd < state.loopStart) {
      state.loopStart = state.loopEnd;
    }
  }

  persistTransportState();
  render();
}

function clearLoopPoints() {
  if (state.loopStart === null && state.loopEnd === null) {
    return;
  }

  state.loopStart = null;
  state.loopEnd = null;
  persistTransportState();
  render();
}

function setActiveSlot(slotKey) {
  if (!state.slots[slotKey]) {
    return;
  }

  state.activeSlotKey = state.mode === "single" ? "left" : slotKey;
  render();
}

function setDrawTool(slotKey, tool) {
  const slot = state.slots[slotKey];
  if (!slot.file) {
    return;
  }

  slot.drawPaletteOpen = true;
  slot.drawTool = tool === "line" ? "line" : "pen";
  if (state.activeDraw?.slotKey === slotKey) {
    state.activeDraw = null;
  }
  render();
}

function toggleDrawPalette(slotKey) {
  const slot = state.slots[slotKey];
  if (!slot.file) {
    return;
  }

  if (slot.drawPaletteOpen) {
    closeDrawPalette(slotKey);
    return;
  }

  slot.drawPaletteOpen = true;
  if (!slot.drawPalettePosition) {
    slot.drawPalettePosition = getDefaultDrawPalettePosition(slotKey);
  }
  if (slot.drawTool !== "pen" && slot.drawTool !== "line") {
    slot.drawTool = "pen";
  }
  render();
}

function closeDrawPalette(slotKey, { silent = false } = {}) {
  const slot = state.slots[slotKey];
  if (!slot) {
    return;
  }

  slot.drawPaletteOpen = false;
  slot.drawTool = "pan";
  if (state.activeDraw?.slotKey === slotKey) {
    state.activeDraw = null;
  }
  if (!silent) {
    render();
  }
}

function startPaletteDrag(slotKey, event) {
  const slot = state.slots[slotKey];
  if (!slot?.drawPaletteOpen) {
    return;
  }

  if (event.target instanceof HTMLElement && event.target.closest("button")) {
    return;
  }

  const rect = slot.elements.drawPalette.getBoundingClientRect();
  state.activePaletteDrag = {
    slotKey,
    pointerId: event.pointerId,
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top,
  };
  slot.elements.drawPalette.setPointerCapture(event.pointerId);
  event.preventDefault();
  render();
}

function handleDocumentPointerMove(event) {
  if (!state.activePaletteDrag || state.activePaletteDrag.pointerId !== event.pointerId) {
    return;
  }

  const slot = state.slots[state.activePaletteDrag.slotKey];
  if (!slot) {
    return;
  }

  slot.drawPalettePosition = clampDrawPalettePosition(
    event.clientX - state.activePaletteDrag.offsetX,
    event.clientY - state.activePaletteDrag.offsetY,
    slot.elements.drawPalette
  );
  render();
}

function handleDocumentPointerUp(event) {
  if (!state.activePaletteDrag || state.activePaletteDrag.pointerId !== event.pointerId) {
    return;
  }

  const slot = state.slots[state.activePaletteDrag.slotKey];
  if (slot?.elements.drawPalette.hasPointerCapture(event.pointerId)) {
    slot.elements.drawPalette.releasePointerCapture(event.pointerId);
  }
  state.activePaletteDrag = null;
  render();
}

function positionDrawPalette(slot) {
  if (!slot.drawPalettePosition) {
    slot.drawPalettePosition = getDefaultDrawPalettePosition(slot.slotKey);
  }

  const clamped = clampDrawPalettePosition(
    slot.drawPalettePosition.x,
    slot.drawPalettePosition.y,
    slot.elements.drawPalette
  );
  slot.drawPalettePosition = clamped;
  slot.elements.drawPalette.style.left = `${clamped.x}px`;
  slot.elements.drawPalette.style.top = `${clamped.y}px`;
}

function getDefaultDrawPalettePosition(slotKey) {
  const slot = state.slots[slotKey];
  const frameRect = slot.elements.dropZone.getBoundingClientRect();

  return clampDrawPalettePosition(
    frameRect.left + 14,
    frameRect.top + 14,
    slot.elements.drawPalette
  );
}

function clampDrawPalettePosition(x, y, paletteElement) {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const rect = paletteElement.getBoundingClientRect();
  const width = rect.width || 360;
  const height = rect.height || 56;
  const margin = 8;

  return {
    x: clamp(x, margin, Math.max(margin, viewportWidth - width - margin)),
    y: clamp(y, margin, Math.max(margin, viewportHeight - height - margin)),
  };
}

function setDrawColor(slotKey, color) {
  const slot = state.slots[slotKey];
  if (!slot.file) {
    return;
  }

  slot.drawColor = color || slot.drawColor;
  render();
}

function undoDrawing(slotKey) {
  const slot = state.slots[slotKey];
  if (!slot.annotations.length) {
    return;
  }

  slot.annotations.pop();
  render();
}

function clearDrawings(slotKey) {
  const slot = state.slots[slotKey];
  if (!slot.annotations.length) {
    return;
  }

  slot.annotations = [];
  if (state.activeDraw?.slotKey === slotKey) {
    state.activeDraw = null;
  }
  render();
}

function bindDrawingGesture(slotKey, canvas) {
  const releaseDrawing = (event) => {
    if (!state.activeDraw || state.activeDraw.slotKey !== slotKey || state.activeDraw.pointerId !== event.pointerId) {
      return;
    }

    finalizeDrawing(slotKey);
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  };

  canvas.addEventListener("pointerdown", (event) => {
    const slot = state.slots[slotKey];
    if (event.button !== 0 || !slot.file || !slot.drawPaletteOpen || slot.drawTool === "pan") {
      return;
    }

    const point = getNormalizedCanvasPoint(canvas, event);
    if (!point) {
      return;
    }

    event.preventDefault();
    setActiveSlot(slotKey);
    state.activeDraw = {
      slotKey,
      pointerId: event.pointerId,
      tool: slot.drawTool,
      color: slot.drawColor,
      points: [point],
    };
    canvas.setPointerCapture(event.pointerId);
    render();
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!state.activeDraw || state.activeDraw.slotKey !== slotKey || state.activeDraw.pointerId !== event.pointerId) {
      return;
    }

    const point = getNormalizedCanvasPoint(canvas, event);
    if (!point) {
      return;
    }

    if (state.activeDraw.tool === "pen") {
      state.activeDraw.points.push(point);
    } else {
      state.activeDraw.points[1] = point;
    }
    render();
  });

  canvas.addEventListener("pointerup", releaseDrawing);
  canvas.addEventListener("pointercancel", releaseDrawing);
}

function finalizeDrawing(slotKey) {
  const slot = state.slots[slotKey];
  if (!state.activeDraw || state.activeDraw.slotKey !== slotKey) {
    return;
  }

  const annotation = normalizeAnnotation(state.activeDraw);
  state.activeDraw = null;
  if (!annotation) {
    render();
    return;
  }

  slot.annotations.push(annotation);
  render();
}

function normalizeAnnotation(activeDraw) {
  const points = activeDraw.points.filter(Boolean);
  if (activeDraw.tool === "pen") {
    if (points.length < 2) {
      return null;
    }
    return {
      tool: "pen",
      color: activeDraw.color,
      points,
    };
  }

  if (points.length < 2) {
    return null;
  }

  const [start, end] = points;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.hypot(dx, dy) < 0.01) {
    return null;
  }

  return {
    tool: "line",
    color: activeDraw.color,
    points: [start, end],
  };
}

function renderOverlay(slot) {
  const canvas = slot.elements.overlayCanvas;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) {
    return;
  }

  const ratio = window.devicePixelRatio || 1;
  const targetWidth = Math.round(width * ratio);
  const targetHeight = Math.round(height * ratio);
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }

  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }

  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.scale(ratio, ratio);
  drawAnnotationsToContext(context, slot.annotations, width, height);
  if (state.activeDraw?.slotKey === slot.slotKey) {
    const preview = normalizeAnnotation(state.activeDraw);
    if (preview) {
      drawAnnotationsToContext(context, [preview], width, height);
    }
  }
}

function drawAnnotationsToContext(context, annotations, width, height) {
  annotations.forEach((annotation) => {
    if (!annotation?.points?.length) {
      return;
    }

    context.save();
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = annotation.color;
    context.lineWidth = Math.max(2, Math.min(width, height) * 0.0065);
    context.shadowColor = "rgba(7, 11, 17, 0.45)";
    context.shadowBlur = 8;
    context.beginPath();
    annotation.points.forEach((point, index) => {
      const x = point.x * width;
      const y = point.y * height;
      if (index === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    });
    context.stroke();

    if (annotation.tool === "line") {
      const endPoint = annotation.points[annotation.points.length - 1];
      context.fillStyle = annotation.color;
      context.beginPath();
      context.arc(endPoint.x * width, endPoint.y * height, context.lineWidth * 0.7, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  });
}

function getNormalizedCanvasPoint(canvas, event) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    return null;
  }

  return {
    x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
    y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
  };
}

function getShortcutSlotKey() {
  if (state.mode === "single") {
    return "left";
  }

  if (state.activeSlotKey === "right" && state.slots.right.file) {
    return "right";
  }

  return "left";
}

function shouldIgnoreShortcutKeydown(event) {
  if (!(event.target instanceof HTMLElement)) {
    return false;
  }

  if (event.target.isContentEditable) {
    return true;
  }

  if (["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)) {
    return true;
  }

  return Boolean(event.target.closest(".settings-menu"));
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function hasLoop() {
  return state.loopStart !== null && state.loopEnd !== null && state.loopEnd > state.loopStart;
}

function applyLoopTrackVisual(slot) {
  const track = slot.elements.scrubberTrack;
  if (!track) {
    return;
  }

  const hasDuration = slot.duration > 0;
  const startPercent = hasDuration && state.loopStart !== null
    ? clamp((state.loopStart / slot.duration) * 100, 0, 100)
    : 0;
  const endPercent = hasDuration && state.loopEnd !== null
    ? clamp((state.loopEnd / slot.duration) * 100, 0, 100)
    : 100;

  track.style.setProperty("--loop-start", `${startPercent}%`);
  track.style.setProperty("--loop-end", `${endPercent}%`);
  track.classList.toggle("has-loop-start", hasDuration && state.loopStart !== null);
  track.classList.toggle("has-loop-end", hasDuration && state.loopEnd !== null);
  track.classList.toggle("has-active-loop", hasDuration && hasLoop());
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

function normalizeAudioSlotKey(value) {
  if (value === null) {
    return null;
  }
  if (value === "left" || value === "right") {
    return value;
  }
  return "left";
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
