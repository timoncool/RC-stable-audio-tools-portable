/**
 * Custom Timeline Editor — Canvas + Web Audio API
 * Multi-segment per track, drag, resize, duplicate, export
 */
(function() {
'use strict';

var TRACK_HEIGHT = 86;
var HEADER_WIDTH = 170;
var RULER_HEIGHT = 30;
var PIXELS_PER_SEC = 100; // default zoom
var MAX_VOLUME = 2.0; // max segment volume (200% = +6dB boost)
// Colors — dark theme matching Gradio app (#141414 bg, #667eea accent)
var ACCENT = '#667eea';
var ACCENT_LIGHT = '#8b9cf7';
var ACCENT_DARK = '#4a5acc';
var ACCENT_PURPLE = '#764ba2';
var SEGMENT_COLOR = '#3d4e78';        // medium blue-gray, visible on dark bg
var SEGMENT_ACTIVE_COLOR = '#4e63a0'; // brighter when selected
var SEGMENT_BORDER_COLOR = '#5a6fd6';
var WAVE_COLOR = '#8ea0e0';           // lighter waveform for contrast
var BG_COLOR = '#141414';             // matches #wp-container
var TRACK_BG = '#1e1e2a';             // slightly lighter, more visible
var TRACK_BG_ALT = '#202030';
var TRACK_LINE = '#333348';
var HEADER_BG = '#222230';            // visible header, not black
var HEADER_BORDER = '#3a3a50';
var TEXT_COLOR = '#c0c0d0';
var TEXT_DIM = '#888';
var CURSOR_COLOR = '#ff6b6b';
var VOL_LINE_COLOR = '#e8a44a';       // warm orange for volume line
var VOL_LINE_ACTIVE = '#ffc45c';      // brighter when selected
var FADE_COLOR = '#e8a44a';
var HANDLE_COLOR = '#fff';
var HANDLE_WIDTH = 6;
var RESIZE_ZONE = 10; // px from edge for resize cursor
var FADE_HANDLE_SIZE = 8; // size of fade triangle handles

function TimelineEditor(container) {
    this.container = container;
    this.tracks = []; // [{name, segments: [{buffer, start, duration, waveform, name}], muted, solo}]
    this.ctx = null;
    this.canvas = null;
    this.pixelsPerSec = PIXELS_PER_SEC;
    this.scrollX = 0;
    this.scrollY = 0;
    this.playhead = 0; // seconds
    this.isPlaying = false;
    this.isLooping = false;
    this.audioCtx = null;
    this.sources = [];
    this.gainNodes = []; // per-track GainNodes for live volume
    this.startTime = 0;
    this.startPlayhead = 0;
    this.animFrame = null;
    this.selectedSegment = null; // {trackIdx, segIdx}
    this.clipboard = null; // copied segment data
    this.dragMode = null; // 'move', 'resize-left', 'resize-right', 'alt-copy'
    this.dragStartX = 0;
    this.dragOrigStart = 0;
    this.totalDuration = 30; // visible duration
    this.contentDuration = 10; // actual content end (no padding)
    this._onResize = this._onResize.bind(this);
    this._animatePlayhead = this._animatePlayhead.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);

    this._init();
}

TimelineEditor.prototype._init = function() {
    this.container.innerHTML = '';
    this.container.style.position = 'relative';
    this.container.style.background = BG_COLOR;
    this.container.style.borderRadius = '8px';
    this.container.style.overflow = 'hidden';
    this.container.style.userSelect = 'none';

    // Canvas
    this.canvas = document.createElement('canvas');
    this.canvas.style.display = 'block';
    this.canvas.style.width = '100%';
    this.container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');

    // Scroll container
    this.container.addEventListener('wheel', this._onWheel.bind(this), {passive: false});
    this.canvas.addEventListener('mousedown', this._onMouseDown.bind(this));
    this.canvas.addEventListener('mousemove', this._onMouseMove.bind(this));
    this.canvas.addEventListener('mouseup', this._onMouseUp.bind(this));
    this.canvas.addEventListener('mouseleave', this._onMouseUp.bind(this));
    this.canvas.addEventListener('dblclick', this._onDblClick.bind(this));
    this.canvas.tabIndex = 0;
    this.canvas.style.outline = 'none';
    this.canvas.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('resize', this._onResize);

    this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    this._resize();
    this._render();
};

TimelineEditor.prototype.destroy = function() {
    window.removeEventListener('resize', this._onResize);
    this.canvas.removeEventListener('keydown', this._onKeyDown);
    if (this.animFrame) cancelAnimationFrame(this.animFrame);
    this.stop();
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
        this.audioCtx.close();
    }
};

TimelineEditor.prototype._onResize = function() {
    this._resize();
    this._render();
};

TimelineEditor.prototype._resize = function() {
    var rect = this.container.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    var w = rect.width;
    var h = Math.max(300, RULER_HEIGHT + this.tracks.length * TRACK_HEIGHT + 40);
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.height = h + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.canvasWidth = w;
    this.canvasHeight = h;
};

TimelineEditor.prototype._computeWaveform = function(buffer, numPoints) {
    var data = buffer.getChannelData(0);
    var step = Math.max(1, Math.floor(data.length / numPoints));
    var wave = new Float32Array(numPoints);
    for (var i = 0; i < numPoints; i++) {
        var start = i * step;
        var end = Math.min(start + step, data.length);
        var max = 0;
        for (var j = start; j < end; j++) {
            var v = Math.abs(data[j]);
            if (v > max) max = v;
        }
        wave[i] = max;
    }
    return wave;
};

TimelineEditor.prototype.addTrack = function(name) {
    this.tracks.push({name: name, segments: [], muted: false, solo: false});
    this._resize();
    this._render();
    return this.tracks.length - 1;
};

TimelineEditor.prototype.addSegment = function(trackIdx, buffer, name, startTime) {
    if (trackIdx < 0 || trackIdx >= this.tracks.length) return;
    var seg = {
        buffer: buffer,
        start: startTime || 0,
        duration: buffer.duration,
        trimStart: 0, // trim from beginning (seconds)
        trimEnd: 0, // trim from end (seconds)
        volume: 1.0, // per-segment volume (0..1)
        fadeIn: 0, // fade-in duration (seconds)
        fadeOut: 0, // fade-out duration (seconds)
        name: name || 'Clip',
        waveform: this._computeWaveform(buffer, 500),
    };
    this.tracks[trackIdx].segments.push(seg);
    this._updateTotalDuration();
    this._render();
};

TimelineEditor.prototype.duplicateSegment = function(trackIdx, segIdx) {
    var track = this.tracks[trackIdx];
    if (!track || !track.segments[segIdx]) return;
    var orig = track.segments[segIdx];
    var effectiveDur = orig.duration - orig.trimStart - orig.trimEnd;
    var newSeg = {
        buffer: orig.buffer,
        start: orig.start + effectiveDur,
        duration: orig.duration,
        trimStart: orig.trimStart,
        trimEnd: orig.trimEnd,
        volume: orig.volume !== undefined ? orig.volume : 1.0,
        fadeIn: orig.fadeIn || 0,
        fadeOut: orig.fadeOut || 0,
        name: orig.name + ' [D]',
        waveform: orig.waveform,
    };
    track.segments.push(newSeg);
    this._updateTotalDuration();
    if (this.isPlaying) this._scheduleLiveSegment(trackIdx, newSeg);
    this._render();
};

TimelineEditor.prototype.removeSegment = function(trackIdx, segIdx) {
    var track = this.tracks[trackIdx];
    if (!track) return;
    track.segments.splice(segIdx, 1);
    this._updateTotalDuration();
    this._render();
};

TimelineEditor.prototype.removeTrack = function(trackIdx) {
    this.tracks.splice(trackIdx, 1);
    this._resize();
    this._render();
};

TimelineEditor.prototype._updateTotalDuration = function() {
    var maxEnd = 0;
    for (var t = 0; t < this.tracks.length; t++) {
        var segs = this.tracks[t].segments;
        for (var s = 0; s < segs.length; s++) {
            var end = segs[s].start + segs[s].duration - segs[s].trimStart - segs[s].trimEnd;
            if (end > maxEnd) maxEnd = end;
        }
    }
    this.contentDuration = maxEnd || 10;
    this.totalDuration = this.contentDuration + 5;
};

TimelineEditor.prototype._timeToX = function(t) {
    return HEADER_WIDTH + t * this.pixelsPerSec - this.scrollX;
};

TimelineEditor.prototype._xToTime = function(x) {
    return (x - HEADER_WIDTH + this.scrollX) / this.pixelsPerSec;
};

TimelineEditor.prototype._render = function() {
    var ctx = this.ctx;
    var w = this.canvasWidth;
    var h = this.canvasHeight;

    ctx.clearRect(0, 0, w, h);

    // Background
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, w, h);

    // Ruler
    this._drawRuler(ctx, w);

    // Tracks
    for (var t = 0; t < this.tracks.length; t++) {
        var y = RULER_HEIGHT + t * TRACK_HEIGHT;
        this._drawTrack(ctx, t, y, w);
    }

    // Playhead
    var phX = this._timeToX(this.playhead);
    if (phX >= HEADER_WIDTH && phX <= w) {
        ctx.strokeStyle = CURSOR_COLOR;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(phX, 0);
        ctx.lineTo(phX, h);
        ctx.stroke();
        // Playhead triangle (larger for easier grabbing)
        ctx.fillStyle = CURSOR_COLOR;
        ctx.beginPath();
        ctx.moveTo(phX - 8, 0);
        ctx.lineTo(phX + 8, 0);
        ctx.lineTo(phX, 14);
        ctx.closePath();
        ctx.fill();
    }

    // Header background overlay (covers segments behind header)
    ctx.fillStyle = HEADER_BG;
    ctx.fillRect(0, RULER_HEIGHT, HEADER_WIDTH, h - RULER_HEIGHT);

    // Track headers
    for (var t = 0; t < this.tracks.length; t++) {
        var y = RULER_HEIGHT + t * TRACK_HEIGHT;
        this._drawTrackHeader(ctx, t, y);
    }
};

TimelineEditor.prototype._drawRuler = function(ctx, w) {
    ctx.fillStyle = '#1a1a28';
    ctx.fillRect(0, 0, w, RULER_HEIGHT);
    ctx.strokeStyle = '#3a3a50';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, RULER_HEIGHT);
    ctx.lineTo(w, RULER_HEIGHT);
    ctx.stroke();

    ctx.fillStyle = TEXT_COLOR;
    ctx.font = '11px Inter, Arial, sans-serif';
    ctx.textAlign = 'center';

    var startT = Math.max(0, this._xToTime(HEADER_WIDTH));
    var endT = this._xToTime(w);
    // Determine tick interval based on zoom
    var interval = 1;
    if (this.pixelsPerSec < 30) interval = 5;
    if (this.pixelsPerSec < 10) interval = 10;
    if (this.pixelsPerSec > 200) interval = 0.5;

    var t0 = Math.floor(startT / interval) * interval;
    for (var t = t0; t <= endT; t += interval) {
        var x = this._timeToX(t);
        if (x < HEADER_WIDTH) continue;
        ctx.strokeStyle = '#4a4a5a';
        ctx.beginPath();
        ctx.moveTo(x, RULER_HEIGHT - 10);
        ctx.lineTo(x, RULER_HEIGHT);
        ctx.stroke();
        // Time label
        var mins = Math.floor(t / 60);
        var secsNum = t % 60;
        var secs = secsNum.toFixed(interval < 1 ? 1 : 0);
        if (mins > 0) {
            ctx.fillText(mins + ':' + (secsNum < 10 ? '0' : '') + secs, x, RULER_HEIGHT - 13);
        } else {
            ctx.fillText(secs + 's', x, RULER_HEIGHT - 13);
        }
    }
};

TimelineEditor.prototype._drawTrack = function(ctx, trackIdx, y, w) {
    var track = this.tracks[trackIdx];

    // Track background
    ctx.fillStyle = trackIdx % 2 === 0 ? TRACK_BG : TRACK_BG_ALT;
    ctx.fillRect(HEADER_WIDTH, y, w - HEADER_WIDTH, TRACK_HEIGHT);

    // Track line
    ctx.strokeStyle = TRACK_LINE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(HEADER_WIDTH, y + TRACK_HEIGHT);
    ctx.lineTo(w, y + TRACK_HEIGHT);
    ctx.stroke();

    // Segments
    var segs = track.segments;
    for (var s = 0; s < segs.length; s++) {
        this._drawSegment(ctx, trackIdx, s, y);
    }
};

TimelineEditor.prototype._drawSegment = function(ctx, trackIdx, segIdx, trackY) {
    var seg = this.tracks[trackIdx].segments[segIdx];
    var effectiveDur = seg.duration - seg.trimStart - seg.trimEnd;
    var x = this._timeToX(seg.start);
    var segW = effectiveDur * this.pixelsPerSec;
    var y = trackY + 4;
    var h = TRACK_HEIGHT - 8;
    var isSelected = this.selectedSegment &&
        this.selectedSegment.trackIdx === trackIdx &&
        this.selectedSegment.segIdx === segIdx;

    // Segment rect
    ctx.fillStyle = isSelected ? SEGMENT_ACTIVE_COLOR : SEGMENT_COLOR;
    ctx.globalAlpha = this.tracks[trackIdx].muted ? 0.3 : 0.8;
    // Rounded rect
    var r = 4;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + segW - r, y);
    ctx.quadraticCurveTo(x + segW, y, x + segW, y + r);
    ctx.lineTo(x + segW, y + h - r);
    ctx.quadraticCurveTo(x + segW, y + h, x + segW - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fill();

    // Segment border
    ctx.strokeStyle = isSelected ? '#fff' : SEGMENT_BORDER_COLOR;
    ctx.lineWidth = 1;
    ctx.globalAlpha = isSelected ? 0.6 : 0.4;
    ctx.stroke();
    ctx.globalAlpha = this.tracks[trackIdx].muted ? 0.3 : 0.8;

    // Waveform
    if (seg.waveform && segW > 2) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, segW, h);
        ctx.clip();

        var wave = seg.waveform;
        var trimStartFrac = seg.trimStart / seg.duration;
        var trimEndFrac = seg.trimEnd / seg.duration;
        var waveStart = Math.floor(trimStartFrac * wave.length);
        var waveEnd = Math.floor((1 - trimEndFrac) * wave.length);
        var waveLen = waveEnd - waveStart;
        var step = Math.max(1, Math.floor(waveLen / segW));

        ctx.strokeStyle = WAVE_COLOR;
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        var mid = y + h / 2;
        for (var i = 0; i < segW; i++) {
            var wIdx = waveStart + Math.floor(i / segW * waveLen);
            if (wIdx >= wave.length) wIdx = wave.length - 1;
            var amp = wave[wIdx] * (h / 2 - 4);
            ctx.moveTo(x + i, mid - amp);
            ctx.lineTo(x + i, mid + amp);
        }
        ctx.stroke();
        ctx.restore();
    }

    ctx.globalAlpha = 1;

    // Per-segment volume line (horizontal, draggable up/down)
    // Volume maps: 0 = bottom, MAX_VOLUME = top, 1.0 (100%) = middle
    var segVol = seg.volume !== undefined ? seg.volume : 1.0;
    var volFrac = segVol / MAX_VOLUME; // 0..1 mapped to full height
    var volLineY = y + h - (h * volFrac);
    var fadeInPx = (seg.fadeIn || 0) * this.pixelsPerSec;
    var fadeOutPx = (seg.fadeOut || 0) * this.pixelsPerSec;
    fadeInPx = Math.min(fadeInPx, segW * 0.45);
    fadeOutPx = Math.min(fadeOutPx, segW * 0.45);

    // Draw volume envelope (fade curves + level line)
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, segW, h);
    ctx.clip();

    var lineColor = isSelected ? VOL_LINE_ACTIVE : VOL_LINE_COLOR;
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();

    // Start: fade-in from bottom-left to volume level
    if (fadeInPx > 0) {
        ctx.moveTo(x, y + h);
        ctx.bezierCurveTo(
            x + fadeInPx * 0.4, y + h,
            x + fadeInPx * 0.6, volLineY,
            x + fadeInPx, volLineY
        );
    } else {
        ctx.moveTo(x, volLineY);
    }

    // Middle: flat volume line
    var midEnd = x + segW - fadeOutPx;
    ctx.lineTo(midEnd, volLineY);

    // End: fade-out from volume level to bottom-right
    if (fadeOutPx > 0) {
        ctx.bezierCurveTo(
            midEnd + fadeOutPx * 0.4, volLineY,
            midEnd + fadeOutPx * 0.6, y + h,
            x + segW, y + h
        );
    }

    ctx.stroke();

    // Fill fade areas with darkening overlay
    if (fadeInPx > 0) {
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + fadeInPx, y);
        ctx.lineTo(x + fadeInPx, volLineY);
        ctx.bezierCurveTo(
            x + fadeInPx * 0.6, volLineY,
            x + fadeInPx * 0.4, y + h,
            x, y + h
        );
        ctx.closePath();
        ctx.fill();
    }
    if (fadeOutPx > 0) {
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath();
        ctx.moveTo(x + segW, y);
        ctx.lineTo(midEnd, y);
        ctx.lineTo(midEnd, volLineY);
        ctx.bezierCurveTo(
            midEnd + fadeOutPx * 0.4, volLineY,
            midEnd + fadeOutPx * 0.6, y + h,
            x + segW, y + h
        );
        ctx.closePath();
        ctx.fill();
    }

    // Fade-in handle triangle (visible at left edge)
    var fiHandleX = x + fadeInPx;
    ctx.fillStyle = lineColor;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.moveTo(fiHandleX, volLineY);
    ctx.lineTo(fiHandleX - FADE_HANDLE_SIZE, volLineY - FADE_HANDLE_SIZE);
    ctx.lineTo(fiHandleX + FADE_HANDLE_SIZE, volLineY - FADE_HANDLE_SIZE);
    ctx.closePath();
    ctx.fill();

    // Fade-out handle triangle (visible at right edge)
    var foHandleX = midEnd;
    ctx.beginPath();
    ctx.moveTo(foHandleX, volLineY);
    ctx.lineTo(foHandleX - FADE_HANDLE_SIZE, volLineY - FADE_HANDLE_SIZE);
    ctx.lineTo(foHandleX + FADE_HANDLE_SIZE, volLineY - FADE_HANDLE_SIZE);
    ctx.closePath();
    ctx.fill();

    // 100% reference line (dashed, subtle)
    var refY = y + h - (h * (1.0 / MAX_VOLUME));
    if (segVol > 1.05 || segVol < 0.95) {
        ctx.strokeStyle = '#555';
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.4;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(x, refY);
        ctx.lineTo(x + segW, refY);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    ctx.restore();
    ctx.globalAlpha = 1;

    // Volume percentage label on the line
    if (segW > 50) {
        ctx.fillStyle = lineColor;
        ctx.font = '9px Inter, Arial, sans-serif';
        ctx.textAlign = 'right';
        ctx.globalAlpha = 0.85;
        var volLabel = Math.round(segVol * 100) + '%';
        if (segVol > 1.0) volLabel = '+' + Math.round((segVol - 1) * 100) + '%';
        ctx.fillText(volLabel, x + segW - 4, volLineY - 4);
        ctx.globalAlpha = 1;
    }

    // Segment name
    if (segW > 40) {
        ctx.fillStyle = '#fff';
        ctx.font = '10px Inter, Arial, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(seg.name, x + 6, y + 14, segW - 12);
    }

    // Selection outline + resize handles
    if (isSelected) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.5;
        this._roundRect(ctx, x, y, segW, h, 4);
        ctx.stroke();
        ctx.globalAlpha = 1;

        // Left handle — 3 lines
        ctx.strokeStyle = HANDLE_COLOR;
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.7;
        var hx = x + 3;
        var hMid = y + h / 2;
        for (var li = -4; li <= 4; li += 4) {
            ctx.beginPath();
            ctx.moveTo(hx, hMid + li - 6);
            ctx.lineTo(hx, hMid + li + 6);
            ctx.stroke();
        }
        // Right handle
        hx = x + segW - 3;
        for (var li = -4; li <= 4; li += 4) {
            ctx.beginPath();
            ctx.moveTo(hx, hMid + li - 6);
            ctx.lineTo(hx, hMid + li + 6);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
    }
};

TimelineEditor.prototype._drawTrackHeader = function(ctx, trackIdx, y) {
    var track = this.tracks[trackIdx];
    if (!track.volume && track.volume !== 0) track.volume = 0.8;

    // Header background with subtle gradient
    ctx.fillStyle = HEADER_BG;
    ctx.fillRect(0, y, HEADER_WIDTH, TRACK_HEIGHT);

    // Right border
    ctx.strokeStyle = HEADER_BORDER;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(HEADER_WIDTH - 0.5, y);
    ctx.lineTo(HEADER_WIDTH - 0.5, y + TRACK_HEIGHT);
    ctx.stroke();

    // Bottom border
    ctx.beginPath();
    ctx.moveTo(0, y + TRACK_HEIGHT - 0.5);
    ctx.lineTo(HEADER_WIDTH, y + TRACK_HEIGHT - 0.5);
    ctx.stroke();

    // Track name (truncated)
    ctx.fillStyle = '#d0d0d0';
    ctx.font = '11px Inter, Arial, sans-serif';
    ctx.textAlign = 'left';
    var maxNameW = HEADER_WIDTH - 16;
    var displayName = track.name;
    if (ctx.measureText(displayName).width > maxNameW) {
        while (displayName.length > 3 && ctx.measureText(displayName + '...').width > maxNameW) {
            displayName = displayName.slice(0, -1);
        }
        displayName += '...';
    }
    ctx.fillText(displayName, 10, y + 16);

    // Buttons row: M  S  D  X
    var btnY = y + 24;
    var btnW = 26, btnH = 22, gap = 5;
    var bx = 10;

    // M (Mute)
    this._drawButton(ctx, bx, btnY, btnW, btnH, 'M',
        track.muted ? '#c0353f' : '#2a2a35',
        track.muted ? '#e04050' : '#4a4a55',
        track.muted ? '#fff' : '#999');

    // S (Solo)
    bx += btnW + gap;
    this._drawButton(ctx, bx, btnY, btnW, btnH, 'S',
        track.solo ? ACCENT_DARK : '#2a2a35',
        track.solo ? ACCENT : '#4a4a55',
        track.solo ? '#fff' : '#999');

    // D (Duplicate)
    bx += btnW + gap;
    var hasSel = this.selectedSegment && this.selectedSegment.trackIdx === trackIdx;
    this._drawButton(ctx, bx, btnY, btnW, btnH, 'D',
        '#2a2a35', hasSel ? ACCENT : '#4a4a55', hasSel ? '#ccc' : '#777');

    // X (Delete)
    bx += btnW + gap;
    this._drawButton(ctx, bx, btnY, btnW, btnH, '\u2715',
        '#2a2a35', '#4a4a55', '#777');

    // Volume slider (horizontal, in header)
    var slX = 10;
    var slY = y + 56;
    var slW = HEADER_WIDTH - 20;
    var slH = 6;
    var knobR = 7;
    var vol = track.volume;

    // Label
    ctx.fillStyle = TEXT_DIM;
    ctx.font = '9px Inter, Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('VOL', slX, slY - 2);
    ctx.textAlign = 'right';
    ctx.fillText(Math.round(vol * 100) + '%', slX + slW, slY - 2);

    // Track (background)
    ctx.fillStyle = '#333340';
    this._roundRect(ctx, slX, slY, slW, slH, 3);
    ctx.fill();

    // Track (filled)
    if (vol > 0) {
        ctx.fillStyle = ACCENT;
        this._roundRect(ctx, slX, slY, slW * vol, slH, 3);
        ctx.fill();
    }

    // Knob
    var knobX = slX + slW * vol;
    ctx.fillStyle = '#e0e0e0';
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 3;
    ctx.beginPath();
    ctx.arc(knobX, slY + slH / 2, knobR, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 1;
    ctx.stroke();
};

TimelineEditor.prototype._drawButton = function(ctx, x, y, w, h, label, bg, border, textColor) {
    ctx.fillStyle = bg;
    this._roundRect(ctx, x, y, w, h, 4);
    ctx.fill();
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = textColor;
    ctx.font = label === '\u2715' ? '13px Inter, Arial, sans-serif' : 'bold 11px Inter, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + w / 2, y + h / 2 + 1);
    ctx.textBaseline = 'alphabetic';
};

TimelineEditor.prototype._roundRect = function(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
};

// ---- Mouse Handlers ----

TimelineEditor.prototype._getTrackAt = function(y) {
    var idx = Math.floor((y - RULER_HEIGHT) / TRACK_HEIGHT);
    if (idx < 0 || idx >= this.tracks.length) return -1;
    return idx;
};

TimelineEditor.prototype._getSegmentAt = function(trackIdx, x) {
    if (trackIdx < 0) return -1;
    var segs = this.tracks[trackIdx].segments;
    var time = this._xToTime(x);
    for (var s = segs.length - 1; s >= 0; s--) {
        var seg = segs[s];
        var dur = seg.duration - seg.trimStart - seg.trimEnd;
        if (time >= seg.start && time <= seg.start + dur) return s;
    }
    return -1;
};

TimelineEditor.prototype._getHeaderButtonAt = function(trackIdx, x, y) {
    var ty = RULER_HEIGHT + trackIdx * TRACK_HEIGHT;
    var btnY = ty + 24;
    var btnW = 26, btnH = 22, gap = 5;
    if (y >= btnY && y <= btnY + btnH) {
        var bx = 10;
        if (x >= bx && x <= bx + btnW) return 'mute';
        bx += btnW + gap;
        if (x >= bx && x <= bx + btnW) return 'solo';
        bx += btnW + gap;
        if (x >= bx && x <= bx + btnW) return 'duplicate';
        bx += btnW + gap;
        if (x >= bx && x <= bx + btnW) return 'delete';
    }
    // Volume slider area (horizontal)
    var slY = ty + 56;
    var slH = 6;
    var knobR = 7;
    if (y >= slY - knobR && y <= slY + slH + knobR && x >= 10 && x <= HEADER_WIDTH - 10) {
        return 'volume';
    }
    return null;
};

TimelineEditor.prototype._onMouseDown = function(e) {
    var rect = this.canvas.getBoundingClientRect();
    var mx = e.clientX - rect.left;
    var my = e.clientY - rect.top;

    // Focus canvas for keyboard events
    this.canvas.focus();

    // Click on ruler — set playhead + start drag
    if (my < RULER_HEIGHT) {
        this.playhead = Math.max(0, this._xToTime(mx));
        this.dragMode = 'playhead';
        this._render();
        return;
    }

    // Click near playhead line (within 8px) on any track — start drag
    var phX = this._timeToX(this.playhead);
    if (Math.abs(mx - phX) < 8 && mx >= HEADER_WIDTH) {
        this.dragMode = 'playhead';
        this._render();
        return;
    }

    var trackIdx = this._getTrackAt(my);

    // Header area
    if (mx < HEADER_WIDTH && trackIdx >= 0) {
        var btn = this._getHeaderButtonAt(trackIdx, mx, my);
        if (btn === 'mute') {
            this.tracks[trackIdx].muted = !this.tracks[trackIdx].muted;
        } else if (btn === 'solo') {
            this.tracks[trackIdx].solo = !this.tracks[trackIdx].solo;
        } else if (btn === 'delete') {
            this.selectedSegment = null;
            this.removeTrack(trackIdx);
            return;
        } else if (btn === 'duplicate') {
            if (this.selectedSegment && this.selectedSegment.trackIdx === trackIdx) {
                this.duplicateSegment(trackIdx, this.selectedSegment.segIdx);
            }
        } else if (btn === 'volume') {
            this.dragMode = 'volume';
            this._volumeTrackIdx = trackIdx;
            var slX = 10, slW = HEADER_WIDTH - 20;
            var vol = Math.max(0, Math.min(1, (mx - slX) / slW));
            this.tracks[trackIdx].volume = vol;
        }
        this._render();
        return;
    }

    // Timeline area — find segment
    if (trackIdx >= 0 && mx >= HEADER_WIDTH) {
        var segIdx = this._getSegmentAt(trackIdx, mx);
        if (segIdx >= 0) {
            this.selectedSegment = {trackIdx: trackIdx, segIdx: segIdx};
            var seg = this.tracks[trackIdx].segments[segIdx];
            var segX = this._timeToX(seg.start);
            var effectiveDur = seg.duration - seg.trimStart - seg.trimEnd;
            var segEndX = segX + effectiveDur * this.pixelsPerSec;
            var segY = RULER_HEIGHT + trackIdx * TRACK_HEIGHT + 4;
            var segH = TRACK_HEIGHT - 8;

            // Check volume line hit
            var segVol = seg.volume !== undefined ? seg.volume : 1.0;
            var volFrac = segVol / MAX_VOLUME;
            var volLineY = segY + segH - (segH * volFrac);
            var fadeInPx = Math.min((seg.fadeIn || 0) * this.pixelsPerSec, (segEndX - segX) * 0.45);
            var fadeOutPx = Math.min((seg.fadeOut || 0) * this.pixelsPerSec, (segEndX - segX) * 0.45);

            // Check fade-in handle (triangle near left end of volume line)
            var fiHandleX = segX + fadeInPx;
            if (Math.abs(mx - fiHandleX) < FADE_HANDLE_SIZE + 4 && Math.abs(my - volLineY) < FADE_HANDLE_SIZE + 4) {
                this.dragMode = 'fade-in';
                this.dragStartX = mx;
                this.dragOrigFadeIn = seg.fadeIn || 0;
            }
            // Check fade-out handle (triangle near right end of volume line)
            else if (Math.abs(mx - (segEndX - fadeOutPx)) < FADE_HANDLE_SIZE + 4 && Math.abs(my - volLineY) < FADE_HANDLE_SIZE + 4) {
                this.dragMode = 'fade-out';
                this.dragStartX = mx;
                this.dragOrigFadeOut = seg.fadeOut || 0;
            }
            // Check volume line (within 8px vertically, between fade handles)
            else if (Math.abs(my - volLineY) < 8 &&
                     mx > segX + fadeInPx + FADE_HANDLE_SIZE && mx < segEndX - fadeOutPx - FADE_HANDLE_SIZE) {
                this.dragMode = 'seg-volume';
                this.dragStartY = my;
                this.dragOrigSegVol = segVol;
            }
            // Check resize handles
            else if (mx - segX < RESIZE_ZONE) {
                this.dragMode = 'resize-left';
            } else if (segEndX - mx < RESIZE_ZONE) {
                this.dragMode = 'resize-right';
            } else if (e.altKey) {
                // Alt+drag — copy segment and move the copy
                var origSeg = seg;
                var newSeg = {
                    buffer: origSeg.buffer,
                    start: origSeg.start,
                    duration: origSeg.duration,
                    trimStart: origSeg.trimStart,
                    trimEnd: origSeg.trimEnd,
                    volume: origSeg.volume,
                    fadeIn: origSeg.fadeIn || 0,
                    fadeOut: origSeg.fadeOut || 0,
                    name: origSeg.name + ' [C]',
                    waveform: origSeg.waveform
                };
                this.tracks[trackIdx].segments.push(newSeg);
                var newIdx = this.tracks[trackIdx].segments.length - 1;
                this.selectedSegment = {trackIdx: trackIdx, segIdx: newIdx};
                if (this.isPlaying) this._scheduleLiveSegment(trackIdx, newSeg);
                this.dragMode = 'move';
            } else {
                this.dragMode = 'move';
            }
            this.dragStartX = mx;
            // Re-read seg in case selectedSegment changed (Alt+drag creates copy)
            var activeSeg = this.tracks[this.selectedSegment.trackIdx].segments[this.selectedSegment.segIdx];
            this.dragOrigStart = activeSeg.start;
            this.dragOrigTrimStart = activeSeg.trimStart;
            this.dragOrigTrimEnd = activeSeg.trimEnd;
        } else {
            this.selectedSegment = null;
            // Click on empty timeline — set playhead
            this.playhead = Math.max(0, this._xToTime(mx));
        }
        this._render();
    }
};

TimelineEditor.prototype._onMouseMove = function(e) {
    var rect = this.canvas.getBoundingClientRect();
    var mx = e.clientX - rect.left;
    var my = e.clientY - rect.top;

    // Playhead drag
    if (this.dragMode === 'playhead') {
        this.playhead = Math.max(0, this._xToTime(mx));
        this._render();
        return;
    }

    // Volume slider drag (horizontal, header)
    if (this.dragMode === 'volume' && this._volumeTrackIdx !== undefined) {
        var slX = 10, slW = HEADER_WIDTH - 20;
        var vol = Math.max(0, Math.min(1, (mx - slX) / slW));
        this.tracks[this._volumeTrackIdx].volume = vol;
        // Update live gain node if playing
        var dragTrack = this.tracks[this._volumeTrackIdx];
        for (var gi = 0; gi < this.gainNodes.length; gi++) {
            if (this.gainNodes[gi].track === dragTrack) {
                this.gainNodes[gi].node.gain.value = vol;
            }
        }
        this._render();
        return;
    }

    // Segment drag
    if (this.selectedSegment && this.dragMode) {
        var seg = this.tracks[this.selectedSegment.trackIdx].segments[this.selectedSegment.segIdx];
        var dx = mx - this.dragStartX;
        var dt = dx / this.pixelsPerSec;

        if (this.dragMode === 'seg-volume') {
            // Drag volume line up/down (range 0..MAX_VOLUME)
            var segY = RULER_HEIGHT + this.selectedSegment.trackIdx * TRACK_HEIGHT + 4;
            var segH = TRACK_HEIGHT - 8;
            var dy = this.dragStartY - my; // up = positive
            var volDelta = (dy / segH) * MAX_VOLUME;
            seg.volume = Math.max(0, Math.min(MAX_VOLUME, this.dragOrigSegVol + volDelta));
            // Live update gain during playback
            if (this.isPlaying && this.segGainNodes) {
                for (var gi = 0; gi < this.segGainNodes.length; gi++) {
                    if (this.segGainNodes[gi].seg === seg) {
                        this.segGainNodes[gi].node.gain.cancelScheduledValues(this.audioCtx.currentTime);
                        this.segGainNodes[gi].node.gain.setValueAtTime(seg.volume, this.audioCtx.currentTime);
                    }
                }
            }
            this._render();
            return;
        } else if (this.dragMode === 'fade-in') {
            // Drag right = more fade-in
            var effectiveDur = seg.duration - seg.trimStart - seg.trimEnd;
            var newFade = Math.max(0, this.dragOrigFadeIn + dt);
            newFade = Math.min(newFade, effectiveDur * 0.45);
            seg.fadeIn = newFade;
            this._render();
            return;
        } else if (this.dragMode === 'fade-out') {
            // Drag left = more fade-out
            var effectiveDur = seg.duration - seg.trimStart - seg.trimEnd;
            var newFade = Math.max(0, this.dragOrigFadeOut - dt);
            newFade = Math.min(newFade, effectiveDur * 0.45);
            seg.fadeOut = newFade;
            this._render();
            return;
        } else if (this.dragMode === 'move') {
            seg.start = Math.max(0, this.dragOrigStart + dt);
        } else if (this.dragMode === 'resize-left') {
            // dt > 0 means mouse moved right = more trim from start
            var newTrim = Math.max(0, Math.min(this.dragOrigTrimStart + dt, seg.duration - seg.trimEnd - 0.05));
            var actualDelta = newTrim - this.dragOrigTrimStart;
            seg.trimStart = newTrim;
            seg.start = Math.max(0, this.dragOrigStart + actualDelta);
        } else if (this.dragMode === 'resize-right') {
            // dt > 0 means mouse moved right = less trim from end
            var newTrimEnd = this.dragOrigTrimEnd - dt;
            newTrimEnd = Math.max(0, newTrimEnd);
            var maxTrimEnd = seg.duration - seg.trimStart - 0.05;
            newTrimEnd = Math.min(newTrimEnd, maxTrimEnd);
            seg.trimEnd = newTrimEnd;
        }
        this._updateTotalDuration();
        this._render();
        return;
    }

    // Hover cursor — check playhead first
    var phX = this._timeToX(this.playhead);
    if (Math.abs(mx - phX) < 8 && mx >= HEADER_WIDTH && my > RULER_HEIGHT) {
        this.canvas.style.cursor = 'col-resize';
        return;
    }

    if (my > RULER_HEIGHT && mx >= HEADER_WIDTH) {
        var trackIdx = this._getTrackAt(my);
        var segIdx = this._getSegmentAt(trackIdx, mx);
        if (segIdx >= 0) {
            var seg = this.tracks[trackIdx].segments[segIdx];
            var segX = this._timeToX(seg.start);
            var effectiveDur = seg.duration - seg.trimStart - seg.trimEnd;
            var segEndX = segX + effectiveDur * this.pixelsPerSec;
            var segY = RULER_HEIGHT + trackIdx * TRACK_HEIGHT + 4;
            var segH = TRACK_HEIGHT - 8;
            var segVol = seg.volume !== undefined ? seg.volume : 1.0;
            var volFrac = segVol / MAX_VOLUME;
            var volLineY = segY + segH - (segH * volFrac);
            var fadeInPx = Math.min((seg.fadeIn || 0) * this.pixelsPerSec, (segEndX - segX) * 0.45);
            var fadeOutPx = Math.min((seg.fadeOut || 0) * this.pixelsPerSec, (segEndX - segX) * 0.45);

            // Check fade handle hover
            var fiHandleX = segX + fadeInPx;
            var foHandleX = segEndX - fadeOutPx;
            if (Math.abs(mx - fiHandleX) < FADE_HANDLE_SIZE + 4 && Math.abs(my - volLineY) < FADE_HANDLE_SIZE + 4) {
                this.canvas.style.cursor = 'ew-resize';
            } else if (Math.abs(mx - foHandleX) < FADE_HANDLE_SIZE + 4 && Math.abs(my - volLineY) < FADE_HANDLE_SIZE + 4) {
                this.canvas.style.cursor = 'ew-resize';
            }
            // Check volume line hover
            else if (Math.abs(my - volLineY) < 8 &&
                mx > segX + fadeInPx + FADE_HANDLE_SIZE && mx < segEndX - fadeOutPx - FADE_HANDLE_SIZE) {
                this.canvas.style.cursor = 'ns-resize';
            } else if (mx - segX < RESIZE_ZONE || segEndX - mx < RESIZE_ZONE) {
                this.canvas.style.cursor = 'ew-resize';
            } else {
                this.canvas.style.cursor = 'grab';
            }
        } else {
            this.canvas.style.cursor = 'default';
        }
    } else if (my < RULER_HEIGHT) {
        this.canvas.style.cursor = 'pointer';
    } else {
        this.canvas.style.cursor = 'default';
    }
};

TimelineEditor.prototype._onMouseUp = function(e) {
    if (this.dragMode) {
        this.dragMode = null;
        this._volumeTrackIdx = undefined;
        this.canvas.style.cursor = 'default';
    }
};

TimelineEditor.prototype._onDblClick = function(e) {
    // Double-click on ruler — reset playhead to 0
    var rect = this.canvas.getBoundingClientRect();
    var my = e.clientY - rect.top;
    if (my < RULER_HEIGHT) {
        this.playhead = 0;
        this._render();
    }
};

TimelineEditor.prototype._onKeyDown = function(e) {
    var key = e.key.toLowerCase();
    var sel = this.selectedSegment;
    var trackIdx = sel ? sel.trackIdx : -1;
    var ctrl = e.ctrlKey || e.metaKey;

    // Ctrl+C — копировать сегмент
    if (ctrl && key === 'c' && sel) {
        var seg = this.tracks[sel.trackIdx].segments[sel.segIdx];
        this.clipboard = {
            buffer: seg.buffer,
            duration: seg.duration,
            trimStart: seg.trimStart,
            trimEnd: seg.trimEnd,
            volume: seg.volume,
            fadeIn: seg.fadeIn,
            fadeOut: seg.fadeOut,
            name: seg.name,
            waveform: seg.waveform,
            sourceTrackIdx: sel.trackIdx
        };
        e.preventDefault();
        return;
    }

    // Ctrl+X — вырезать сегмент
    if (ctrl && key === 'x' && sel) {
        var seg = this.tracks[sel.trackIdx].segments[sel.segIdx];
        this.clipboard = {
            buffer: seg.buffer,
            duration: seg.duration,
            trimStart: seg.trimStart,
            trimEnd: seg.trimEnd,
            volume: seg.volume,
            fadeIn: seg.fadeIn,
            fadeOut: seg.fadeOut,
            name: seg.name,
            waveform: seg.waveform,
            sourceTrackIdx: sel.trackIdx
        };
        this.removeSegment(sel.trackIdx, sel.segIdx);
        this.selectedSegment = null;
        this._render();
        e.preventDefault();
        return;
    }

    // Ctrl+V — вставить сегмент на позицию playhead
    if (ctrl && key === 'v' && this.clipboard) {
        var targetTrack = trackIdx >= 0 ? trackIdx : this.clipboard.sourceTrackIdx;
        if (targetTrack >= 0 && targetTrack < this.tracks.length) {
            var newSeg = {
                buffer: this.clipboard.buffer,
                start: this.playhead,
                duration: this.clipboard.duration,
                trimStart: this.clipboard.trimStart,
                trimEnd: this.clipboard.trimEnd,
                volume: this.clipboard.volume,
                fadeIn: this.clipboard.fadeIn,
                fadeOut: this.clipboard.fadeOut,
                name: this.clipboard.name + ' [P]',
                waveform: this.clipboard.waveform
            };
            this.tracks[targetTrack].segments.push(newSeg);
            var newIdx = this.tracks[targetTrack].segments.length - 1;
            this.selectedSegment = {trackIdx: targetTrack, segIdx: newIdx};
            this._updateTotalDuration();
            if (this.isPlaying) this._scheduleLiveSegment(targetTrack, newSeg);
            this._render();
        }
        e.preventDefault();
        return;
    }

    // Ctrl+D — дублировать выделенный сегмент
    if (ctrl && key === 'd' && sel) {
        this.duplicateSegment(sel.trackIdx, sel.segIdx);
        e.preventDefault();
        return;
    }

    // Delete / Backspace — удалить выделенный сегмент
    if (key === 'delete' || key === 'backspace') {
        if (sel) {
            this.removeSegment(sel.trackIdx, sel.segIdx);
            this.selectedSegment = null;
            this._render();
        }
        e.preventDefault();
        return;
    }

    // D — дублировать выделенный сегмент (без Ctrl тоже работает)
    if (key === 'd' && !ctrl && sel) {
        this.duplicateSegment(sel.trackIdx, sel.segIdx);
        e.preventDefault();
        return;
    }

    // M — mute трека выделенного сегмента
    if (key === 'm' && trackIdx >= 0) {
        this.tracks[trackIdx].muted = !this.tracks[trackIdx].muted;
        this._render();
        e.preventDefault();
        return;
    }

    // S — solo трека выделенного сегмента
    if (key === 's' && !ctrl && trackIdx >= 0) {
        this.tracks[trackIdx].solo = !this.tracks[trackIdx].solo;
        this._render();
        e.preventDefault();
        return;
    }

    // X — удалить трек выделенного сегмента (без Ctrl)
    if (key === 'x' && !ctrl && trackIdx >= 0) {
        this.selectedSegment = null;
        this.removeTrack(trackIdx);
        e.preventDefault();
        return;
    }

    // + / = — zoom in
    if (key === '+' || key === '=') {
        this.zoomIn();
        e.preventDefault();
        return;
    }

    // - — zoom out
    if (key === '-') {
        this.zoomOut();
        e.preventDefault();
        return;
    }

    // Space — play/pause
    if (key === ' ') {
        if (this.isPlaying) {
            this.pause();
        } else {
            this.play();
        }
        e.preventDefault();
        return;
    }
};

TimelineEditor.prototype._onWheel = function(e) {
    e.preventDefault();
    if (e.ctrlKey) {
        // Zoom
        var delta = e.deltaY > 0 ? 0.85 : 1.18;
        this.pixelsPerSec = Math.max(10, Math.min(500, this.pixelsPerSec * delta));
    } else {
        // Scroll horizontal
        this.scrollX = Math.max(0, this.scrollX + e.deltaY);
    }
    this._render();
};

// ---- Playback ----

TimelineEditor.prototype.play = function() {
    if (this.isPlaying) this._stopPlayback();
    this.isPlaying = true;
    this.startTime = this.audioCtx.currentTime;
    this.startPlayhead = this.playhead;

    // Check solo
    var hasSolo = false;
    for (var t = 0; t < this.tracks.length; t++) {
        if (this.tracks[t].solo) { hasSolo = true; break; }
    }

    this.sources = [];
    this.gainNodes = [];
    this.segGainNodes = []; // per-segment {seg, node} for live volume updates
    for (var t = 0; t < this.tracks.length; t++) {
        var track = this.tracks[t];
        if (track.muted) continue;
        if (hasSolo && !track.solo) continue;

        var trackVol = track.volume !== undefined ? track.volume : 0.8;
        var trackGain = this.audioCtx.createGain();
        trackGain.gain.value = trackVol;
        trackGain.connect(this.audioCtx.destination);
        this.gainNodes.push({track: track, node: trackGain});

        for (var s = 0; s < track.segments.length; s++) {
            var seg = track.segments[s];
            var effectiveDur = seg.duration - seg.trimStart - seg.trimEnd;
            var offset = seg.start - this.playhead;
            var src = this.audioCtx.createBufferSource();
            src.buffer = seg.buffer;

            // Per-segment gain with fade automation
            var segGain = this.audioCtx.createGain();
            var segVol = seg.volume !== undefined ? seg.volume : 1.0;
            segGain.gain.value = segVol;
            src.connect(segGain);
            segGain.connect(trackGain);

            var startWhen, bufOffset, playDur;
            if (offset >= 0) {
                startWhen = this.audioCtx.currentTime + offset;
                bufOffset = seg.trimStart;
                playDur = effectiveDur;
            } else if (offset + effectiveDur > 0) {
                var skipTime = -offset;
                startWhen = this.audioCtx.currentTime;
                bufOffset = seg.trimStart + skipTime;
                playDur = effectiveDur - skipTime;
            } else {
                continue; // segment already passed
            }

            src.start(startWhen, bufOffset, playDur);
            this.segGainNodes.push({seg: seg, node: segGain});

            // Fade-in automation
            if (seg.fadeIn > 0) {
                var fadeStart = startWhen;
                if (offset < 0) {
                    // Already past some of the clip
                    var skipTime = -offset;
                    if (skipTime < seg.fadeIn) {
                        // Still in fade-in range
                        var currentFadePos = skipTime / seg.fadeIn;
                        segGain.gain.setValueAtTime(segVol * currentFadePos, fadeStart);
                        segGain.gain.linearRampToValueAtTime(segVol, fadeStart + (seg.fadeIn - skipTime));
                    }
                } else {
                    segGain.gain.setValueAtTime(0, fadeStart);
                    segGain.gain.linearRampToValueAtTime(segVol, fadeStart + seg.fadeIn);
                }
            }

            // Fade-out automation
            if (seg.fadeOut > 0) {
                var segEnd = startWhen + playDur;
                var fadeOutStart = segEnd - seg.fadeOut;
                if (fadeOutStart > this.audioCtx.currentTime) {
                    segGain.gain.setValueAtTime(segVol, Math.max(fadeOutStart, startWhen));
                    segGain.gain.linearRampToValueAtTime(0, segEnd);
                }
            }

            this.sources.push(src);
        }
    }

    this._animatePlayhead();
};

TimelineEditor.prototype._animatePlayhead = function() {
    if (!this.isPlaying) return;
    var elapsed = this.audioCtx.currentTime - this.startTime;
    this.playhead = this.startPlayhead + elapsed;

    // Check if past all content
    if (this.playhead >= this.contentDuration) {
        if (this.isLooping) {
            this.playhead = 0;
            this.isPlaying = false;
            this._stopPlayback();
            this.play();
            return;
        } else {
            this.stop();
            return;
        }
    }

    this._render();
    this.animFrame = requestAnimationFrame(this._animatePlayhead);
};

TimelineEditor.prototype._stopPlayback = function() {
    for (var i = 0; i < this.sources.length; i++) {
        try { this.sources[i].stop(); } catch(e) {}
    }
    this.sources = [];
    this.segGainNodes = [];
};

TimelineEditor.prototype.pause = function() {
    if (!this.isPlaying) return;
    this.isPlaying = false;
    this.playhead = this.startPlayhead + (this.audioCtx.currentTime - this.startTime);
    this._stopPlayback();
    if (this.animFrame) cancelAnimationFrame(this.animFrame);
    this._render();
};

// Schedule a single segment for live playback (used when adding segments during play)
TimelineEditor.prototype._scheduleLiveSegment = function(trackIdx, seg) {
    if (!this.isPlaying || !this.audioCtx) return;
    var track = this.tracks[trackIdx];
    if (!track || track.muted) return;

    // Check solo
    var hasSolo = false;
    for (var t = 0; t < this.tracks.length; t++) {
        if (this.tracks[t].solo) { hasSolo = true; break; }
    }
    if (hasSolo && !track.solo) return;

    // Find existing trackGain or create one
    var trackGain = null;
    for (var gi = 0; gi < this.gainNodes.length; gi++) {
        if (this.gainNodes[gi].track === track) {
            trackGain = this.gainNodes[gi].node;
            break;
        }
    }
    if (!trackGain) {
        var trackVol = track.volume !== undefined ? track.volume : 0.8;
        trackGain = this.audioCtx.createGain();
        trackGain.gain.value = trackVol;
        trackGain.connect(this.audioCtx.destination);
        this.gainNodes.push({track: track, node: trackGain});
    }

    var currentPlayhead = this.startPlayhead + (this.audioCtx.currentTime - this.startTime);
    var effectiveDur = seg.duration - seg.trimStart - seg.trimEnd;
    var offset = seg.start - currentPlayhead;

    var src = this.audioCtx.createBufferSource();
    src.buffer = seg.buffer;

    var segGain = this.audioCtx.createGain();
    var segVol = seg.volume !== undefined ? seg.volume : 1.0;
    segGain.gain.value = segVol;
    src.connect(segGain);
    segGain.connect(trackGain);
    this.segGainNodes.push({seg: seg, node: segGain});

    var startWhen, bufOffset, playDur;
    if (offset >= 0) {
        startWhen = this.audioCtx.currentTime + offset;
        bufOffset = seg.trimStart;
        playDur = effectiveDur;
    } else if (offset + effectiveDur > 0) {
        var skipTime = -offset;
        startWhen = this.audioCtx.currentTime;
        bufOffset = seg.trimStart + skipTime;
        playDur = effectiveDur - skipTime;
    } else {
        return; // segment already passed
    }

    src.start(startWhen, bufOffset, playDur);

    // Fade-in
    if (seg.fadeIn > 0 && offset >= 0) {
        segGain.gain.setValueAtTime(0, startWhen);
        segGain.gain.linearRampToValueAtTime(segVol, startWhen + seg.fadeIn);
    }
    // Fade-out
    if (seg.fadeOut > 0) {
        var segEnd = startWhen + playDur;
        var fadeOutStart = segEnd - seg.fadeOut;
        if (fadeOutStart > this.audioCtx.currentTime) {
            segGain.gain.setValueAtTime(segVol, Math.max(fadeOutStart, startWhen));
            segGain.gain.linearRampToValueAtTime(0, segEnd);
        }
    }

    this.sources.push(src);
};

TimelineEditor.prototype.stop = function() {
    this.isPlaying = false;
    this._stopPlayback();
    this.playhead = 0;
    if (this.animFrame) cancelAnimationFrame(this.animFrame);
    this._render();
};

TimelineEditor.prototype.toggleLoop = function() {
    this.isLooping = !this.isLooping;
    return this.isLooping;
};

TimelineEditor.prototype.zoomIn = function() {
    this.pixelsPerSec = Math.min(500, this.pixelsPerSec * 1.3);
    this._render();
};

TimelineEditor.prototype.zoomOut = function() {
    this.pixelsPerSec = Math.max(10, this.pixelsPerSec / 1.3);
    this._render();
};

// ---- Export WAV ----

TimelineEditor.prototype.exportWAV = function() {
    var sampleRate = 44100;
    // Find max end time
    var maxEnd = 0;
    for (var t = 0; t < this.tracks.length; t++) {
        var segs = this.tracks[t].segments;
        for (var s = 0; s < segs.length; s++) {
            var seg = segs[s];
            var end = seg.start + seg.duration - seg.trimStart - seg.trimEnd;
            if (end > maxEnd) maxEnd = end;
        }
    }
    if (maxEnd === 0) return;

    var length = Math.ceil(maxEnd * sampleRate);
    var offlineCtx = new OfflineAudioContext(2, length, sampleRate);

    var hasSolo = false;
    for (var t = 0; t < this.tracks.length; t++) {
        if (this.tracks[t].solo) { hasSolo = true; break; }
    }

    for (var t = 0; t < this.tracks.length; t++) {
        var track = this.tracks[t];
        if (track.muted) continue;
        if (hasSolo && !track.solo) continue;

        var trackVol = track.volume !== undefined ? track.volume : 0.8;
        var trackGain = offlineCtx.createGain();
        trackGain.gain.value = trackVol;
        trackGain.connect(offlineCtx.destination);

        for (var s = 0; s < track.segments.length; s++) {
            var seg = track.segments[s];
            var effectiveDur = seg.duration - seg.trimStart - seg.trimEnd;
            var src = offlineCtx.createBufferSource();
            src.buffer = seg.buffer;

            // Per-segment gain with fade
            var segGain = offlineCtx.createGain();
            var segVol = seg.volume !== undefined ? seg.volume : 1.0;
            segGain.gain.value = segVol;
            src.connect(segGain);
            segGain.connect(trackGain);

            var startWhen = seg.start;
            src.start(startWhen, seg.trimStart, effectiveDur);

            // Fade-in
            if (seg.fadeIn > 0) {
                segGain.gain.setValueAtTime(0, startWhen);
                segGain.gain.linearRampToValueAtTime(segVol, startWhen + seg.fadeIn);
            }

            // Fade-out
            if (seg.fadeOut > 0) {
                var segEnd = startWhen + effectiveDur;
                segGain.gain.setValueAtTime(segVol, segEnd - seg.fadeOut);
                segGain.gain.linearRampToValueAtTime(0, segEnd);
            }
        }
    }

    offlineCtx.startRendering().then(function(renderedBuffer) {
        var wav = _encodeWAV(renderedBuffer);
        var blob = new Blob([wav], {type: 'audio/wav'});
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'mix_' + new Date().toISOString().slice(0,19).replace(/[:T]/g,'-') + '.wav';
        a.click();
    });
};

function _encodeWAV(buffer) {
    var numCh = buffer.numberOfChannels;
    var sampleRate = buffer.sampleRate;
    var length = buffer.length;
    var dataLength = length * numCh * 2;
    var arrayBuffer = new ArrayBuffer(44 + dataLength);
    var view = new DataView(arrayBuffer);

    function writeString(offset, str) {
        for (var i = 0; i < str.length; i++) {
            view.setUint8(offset + i, str.charCodeAt(i));
        }
    }
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataLength, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numCh, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numCh * 2, true);
    view.setUint16(32, numCh * 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, dataLength, true);

    var channels = [];
    for (var ch = 0; ch < numCh; ch++) {
        channels.push(buffer.getChannelData(ch));
    }

    var offset = 44;
    for (var i = 0; i < length; i++) {
        for (var ch = 0; ch < numCh; ch++) {
            var sample = Math.max(-1, Math.min(1, channels[ch][i]));
            view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
            offset += 2;
        }
    }
    return arrayBuffer;
}

// ---- Load from URL ----

TimelineEditor.prototype.loadClip = function(url, name, trackIdx, startTime) {
    var self = this;
    return fetch(url)
        .then(function(r) { return r.arrayBuffer(); })
        .then(function(buf) { return self.audioCtx.decodeAudioData(buf); })
        .then(function(decoded) {
            // Auto-create track if needed
            if (trackIdx === undefined || trackIdx === null || trackIdx < 0) {
                trackIdx = self.addTrack(name || 'Track ' + (self.tracks.length + 1));
            } else if (trackIdx >= self.tracks.length) {
                while (self.tracks.length <= trackIdx) {
                    self.addTrack('Track ' + (self.tracks.length + 1));
                }
            }
            self.addSegment(trackIdx, decoded, name, startTime || 0);
            return {trackIdx: trackIdx, segIdx: self.tracks[trackIdx].segments.length - 1};
        });
};

// Expose
window.TimelineEditor = TimelineEditor;

})();
