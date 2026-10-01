/* =============================================================================
 * trackselect.js — Step 8: choose a circuit.
 *
 * Everything here is built from OR.TRACKS: adding a track in trackdata.js is
 * enough for it to appear as a card with a preview, a length, a difficulty
 * rating and its records. There is no per-track code anywhere in this file.
 *
 * The screen lives inside the main menu (the menu state has two panes), so
 * the five-state machine is untouched: the animated menu camera simply flies
 * along whichever circuit is selected.
 *
 * Records come from OR.Bests and are shown for the difficulty currently
 * selected on the menu.
 * ========================================================================== */
(function () {
  'use strict';

  const { CONFIG, Utils, Track, Renderer, Shards, Bests, Difficulty } = OR;

  /* Rating 1..3 -> a word and stars. Anything else falls back to the middle. */
  const RATINGS = ['', 'EASY', 'MEDIUM', 'HARD'];
  const RATING_MAX = 3;

  function ratingValue(rating) {
    return Utils.clamp(Math.round(rating) || RATINGS.length - 1, 1, RATING_MAX);
  }

  /* Step 9: the selected circuit is part of the shared save object. */
  function savedTrackId() {
    return OR.Save ? OR.Save.selection().track : null;
  }

  function rememberTrack(id) {
    if (OR.Save) OR.Save.setSelection(id, null);
  }

  const TrackSelect = {
    el: {},
    cards: [],
    _geometry: {},

    /** Cached centerline measurement for a track's preview and length. */
    geometry(track) {
      if (!TrackSelect._geometry[track.id]) {
        TrackSelect._geometry[track.id] = Track.measure(track);
      }
      return TrackSelect._geometry[track.id];
    },

    /** Lap length in metres, measured from the real centerline. */
    lengthMeters(track) {
      return Math.round(TrackSelect.geometry(track).total * CONFIG.track.metersPerUnit);
    },

    ratingLabel(track) {
      return RATINGS[ratingValue(track.rating)];
    },

    ratingStars(track) {
      const r = ratingValue(track.rating);
      return '★'.repeat(r) + '☆'.repeat(RATING_MAX - r);
    },

    /** The id saved from last time, or the first track. */
    savedId() {
      const saved = savedTrackId();
      return OR.trackById(saved) ? saved : OR.TRACKS[0].id;
    },

    /* ---- the screen ------------------------------------------------------ */

    init() {
      TrackSelect.el.list = document.getElementById('trackList');
      TrackSelect.el.summary = document.getElementById('trackSummary');
      if (!TrackSelect.el.list) return TrackSelect;

      TrackSelect.el.list.replaceChildren();
      TrackSelect.cards = OR.TRACKS.map(function (track) {
        return TrackSelect._buildCard(track);
      });

      /* Arrow keys move through the cards, exactly like the difficulty picker. */
      TrackSelect.el.list.addEventListener('keydown', function (e) {
        const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1
          : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
        if (!step) return;
        e.preventDefault();
        const ids = OR.TRACKS.map(t => t.id);
        const next = ids[(ids.indexOf(Track.id) + step + ids.length) % ids.length];
        TrackSelect.select(next);
        const card = TrackSelect.el.list.querySelector('[data-track="' + next + '"]');
        if (card) card.focus();
      });

      /* Restore the last choice without clobbering a test that already picked. */
      TrackSelect.select(TrackSelect.savedId());
      return TrackSelect;
    },

    _buildCard(track) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'track-card';
      card.dataset.track = track.id;
      card.setAttribute('role', 'radio');
      card.setAttribute('aria-checked', 'false');
      card.setAttribute('aria-label', track.name + ', ' + TrackSelect.ratingLabel(track) +
        ' difficulty, ' + TrackSelect.lengthMeters(track) + ' metres');

      const preview = document.createElement('canvas');
      preview.className = 'track-preview';
      preview.width = 220;
      preview.height = 120;
      preview.setAttribute('aria-hidden', 'true');

      const head = document.createElement('div');
      head.className = 'track-head';
      const name = document.createElement('h3');
      name.className = 'track-name';
      name.textContent = track.name;
      const badge = document.createElement('span');
      badge.className = 'rating-badge';
      badge.textContent = TrackSelect.ratingStars(track);
      badge.title = TrackSelect.ratingLabel(track) + ' difficulty';
      head.append(name, badge);

      const blurb = document.createElement('p');
      blurb.className = 'track-subtitle';
      blurb.textContent = track.subtitle;

      const meta = document.createElement('div');
      meta.className = 'track-meta';
      const facts = [
        TrackSelect.lengthMeters(track) + ' m',
        (track.laps || CONFIG.race.laps) + ' laps',
        (track.checkpointFractions || []).length + ' checkpoints',
        ((track.shards && track.shards.count) || CONFIG.boost.shards.count) + ' shards'
      ];
      facts.forEach(function (fact) {
        const span = document.createElement('span');
        span.className = 'track-fact';
        span.textContent = fact;
        meta.appendChild(span);
      });

      const best = document.createElement('p');
      best.className = 'track-best';
      const lap = document.createElement('p');
      lap.className = 'track-best-lap';

      const rating = document.createElement('span');
      rating.className = 'sr-only';
      rating.textContent = TrackSelect.ratingLabel(track) + ' difficulty';

      card.append(preview, head, blurb, meta, best, lap, rating);
      card.addEventListener('click', function (e) {
        e.preventDefault();
        TrackSelect.select(track.id);
      });
      TrackSelect.el.list.appendChild(card);

      TrackSelect.drawPreview(preview, track);
      return { track: track, node: card, preview: preview, best: best, lap: lap };
    },

    /**
     * Scale the real centerline into the card. Taking the geometry from
     * Track.measure() is what makes the preview genuinely match the circuit.
     */
    drawPreview(canvas, track) {
      if (!canvas || !canvas.getContext) return null;
      const ctx = canvas.getContext('2d');
      const rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
      const cssW = Math.max(120, Math.round((rect && rect.width) || canvas.clientWidth || 220));
      const cssH = Math.max(70, Math.round((rect && rect.height) || canvas.clientHeight || 120));
      const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);

      const pts = TrackSelect.geometry(track).points;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let i = 0; i < pts.length; i++) {
        minX = Math.min(minX, pts[i][0]); maxX = Math.max(maxX, pts[i][0]);
        minY = Math.min(minY, pts[i][1]); maxY = Math.max(maxY, pts[i][1]);
      }
      const pad = 16;
      const scale = Math.min((cssW - pad * 2) / Math.max(1, maxX - minX),
        (cssH - pad * 2) / Math.max(1, maxY - minY));
      const ox = cssW / 2 - ((minX + maxX) / 2) * scale;
      const oy = cssH / 2 - ((minY + maxY) / 2) * scale;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);
      ctx.fillStyle = 'rgba(5, 7, 14, 0.72)';
      ctx.fillRect(0, 0, cssW, cssH);

      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i <= pts.length; i++) {
        const p = pts[i % pts.length];
        const x = p[0] * scale + ox;
        const y = p[1] * scale + oy;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = Utils.rgba(CONFIG.theme.violet, 0.32);
      ctx.lineWidth = 6;
      ctx.stroke();
      ctx.strokeStyle = CONFIG.theme.cyan;
      ctx.lineWidth = 1.8;
      ctx.stroke();

      /* The start/finish line: the control point's fraction of the loop. */
      const f = (track.startIndex || 0) / Math.max(1, track.points.length);
      const idx = Math.round(f * pts.length) % pts.length;
      const a = pts[idx], b = pts[(idx + 1) % pts.length];
      const sx = a[0] * scale + ox, sy = a[1] * scale + oy;
      const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(angle);
      ctx.fillStyle = '#f4f8ff';
      ctx.fillRect(-2, -5, 4, 10);
      ctx.restore();

      canvas.setAttribute('data-track-length', String(Math.round(TrackSelect.geometry(track).total)));
      return canvas;
    },

    /* ---- selection ------------------------------------------------------- */

    /**
     * Make a track the active one: rebuild geometry, pickups and cached
     * layers, remember the choice, and update the cards.
     */
    select(id) {
      const track = OR.trackById(id) || OR.TRACKS[0];
      Track.use(track);
      Shards.reset();
      Renderer.invalidateTrack();
      rememberTrack(track.id);
      TrackSelect.refresh();
      return track;
    },

    /** Currently selected track (the live one). */
    current() {
      return OR.activeTrack;
    },

    /** Repaint every card for the current selection and difficulty. */
    refresh() {
      const difficultyId = Difficulty.currentId();
      TrackSelect.cards.forEach(function (card) {
        const selected = card.track.id === Track.id;
        card.node.classList.toggle('is-selected', selected);
        card.node.setAttribute('aria-checked', selected ? 'true' : 'false');
        card.node.tabIndex = selected ? 0 : -1;
        card.best.textContent = Bests.timeText(card.track.id, difficultyId);
        card.best.classList.toggle('has-time', Bests.bestTime(card.track.id, difficultyId) > 0);
        card.lap.textContent = Bests.bestLap(card.track.id, difficultyId)
          ? 'Best lap ' + Utils.formatTime(Bests.bestLap(card.track.id, difficultyId)) : '';
      });
      if (TrackSelect.el.summary) {
        const level = Difficulty.get(difficultyId);
        TrackSelect.el.summary.textContent = Track.name + ' — ' +
          TrackSelect.lengthMeters(Track) + ' m, ' + Track.laps + ' laps · ' +
          TrackSelect.ratingLabel(Track) + ' · ' +
          Bests.timeText(Track.id, level.id);
      }
      return TrackSelect;
    }
  };

  OR.TrackSelect = TrackSelect;
})();
