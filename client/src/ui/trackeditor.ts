import { OVAL_TRACK, STARTER_TRACKS, type TrackCorner, type TrackDef } from '../../../shared/tracks.ts';
import type { Island } from '../game/island.ts';
import { blockBounds } from '../game/layout.ts';
import { raceTime } from '../game/race.ts';
import { HALF_WIDTH, MAX_RADIUS, MIN_RADIUS, WALL, checkTrack, planTrack, trackArea, type TrackCheck, type TrackPlan } from '../game/trackplan.ts';
import type { Tracks } from '../tracks.ts';
import { h, type Panel } from './panel.ts';

const COLOR = '#e8645c';
/** Rough average kart speed, for the lap-time estimate. */
const AVG_SPEED = 17;
const HANDLE = 8;

const fmtDate = (ms: number) => new Date(ms).toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** The race booth's track workshop: pick which saved track the circuit uses, or design a new one. */
export function openTrackWorkshop(panel: Panel, tracks: Tracks, island: Island, toast: (t: string) => void) {
  const block = island.world?.circuit;
  const bb = block ? blockBounds(block) : { minX: 0, maxX: 160, minZ: 0, maxZ: 100 };
  const W = bb.maxX - bb.minX, D = bb.maxZ - bb.minZ;

  const showList = () => {
    const active = tracks.active;
    const body = h('div', { class: 'tracks' });
    body.append(
      h('div', { class: 'group-title' }, `🏁 Racing now: ${active.name}`),
      board(active),
      h('div', { class: 'group-title' }, '📂 Saved tracks'),
      h('div', { class: 'race-note' }, 'Every saved version is a file in .data/tracks/ with its own top 10. Pick one to race it.'),
    );
    if (!tracks.list.length) body.append(h('div', { class: 'race-note' }, 'No saved tracks yet (is the island server up to date?).'));
    for (const t of tracks.list) {
      const fits = checkTrack(t.corners, W, D);
      const isActive = t.id === tracks.activeId;
      const race = h('button', { class: 'btn small' + (isActive ? '' : ' primary') }, isActive ? '✔ Racing' : '🏁 Race this');
      race.toggleAttribute('disabled', isActive || !fits.ok);
      race.addEventListener('click', () => {
        tracks.activate(t.id);
        toast(`🏁 The circuit is now ${t.name}.`);
        showList();
      });
      const edit = h('button', { class: 'btn small' }, '✏️ Edit');
      edit.addEventListener('click', () => showEditor(t.corners.map((c) => [...c] as TrackCorner), t.name, t.id));
      const del = h('button', { class: 'btn small danger', title: 'Delete this file' }, '🗑️');
      del.toggleAttribute('disabled', isActive);
      del.addEventListener('click', () => {
        if (!confirm(`Delete “${t.name}” (saved ${fmtDate(t.created)}) and its times?`)) return;
        tracks.delete(t.id);
      });
      const best = t.times[0];
      body.append(h('div', { class: 'track-row' + (isActive ? ' on' : '') },
        thumb(t.corners, W, D),
        h('div', { class: 'track-info' },
          h('div', { class: 'track-name' }, t.name),
          h('div', { class: 'race-date' }, `${fmtDate(t.created)} · ${Math.round(fits.length)} m · ${t.corners.length} corners`),
          h('div', { class: 'race-date' }, best ? `🏆 ${raceTime(best.timeMs)} · ${t.times.length} time${t.times.length === 1 ? '' : 's'}` : 'No times yet'),
          fits.ok ? null : h('div', { class: 'track-bad' }, '⚠️ Doesn’t fit this circuit: edit it first'),
          h('div', { class: 'race-date', style: 'opacity:0.7' }, `${t.id}.json`)),
        h('div', { class: 'row' }, race, edit, del)));
    }
    const newBtns = [
      ...STARTER_TRACKS.map((s) => ({ label: `✨ New from ${s.name}`, corners: s.corners })),
      { label: '✨ New oval', corners: OVAL_TRACK },
    ].map((o) => {
      const b = h('button', { class: 'btn' }, o.label);
      b.addEventListener('click', () => showEditor(o.corners.map((c) => [...c] as TrackCorner), 'My track'));
      return b;
    });
    const close = h('button', { class: 'btn' }, '👋 Close');
    close.addEventListener('click', () => panel.close());
    panel.open({
      title: '🛠️ Track workshop', color: COLOR, body, kind: 'tracks',
      foot: h('div', { class: 'row' }, ...newBtns, h('div', { class: 'spacer' }), close),
      onClose: () => (tracks.onChange = undefined),
    });
    // After open(): it runs the previous view's onClose first.
    tracks.onChange = () => {
      if (panel.isOpen && panel.kind === 'tracks') showList();
    };
  };

  const showEditor = (start: TrackCorner[], startName: string, parent?: string) => {
    tracks.onChange = undefined;
    let corners = start;
    let sel = -1;
    let dirty = false;
    const undo: TrackCorner[][] = [];
    const snapshot = () => {
      undo.push(corners.map((c) => [...c] as TrackCorner));
      if (undo.length > 100) undo.shift();
      dirty = true;
    };
    let plan: TrackPlan = planTrack(corners);
    let check: TrackCheck = checkTrack(corners, W, D, plan);

    const name = h('input', { class: 'big', value: startName, maxlength: '60', placeholder: 'Track name' }) as HTMLInputElement;
    name.addEventListener('input', () => (dirty = true));
    const canvas = h('canvas', { class: 'track-canvas', tabindex: '0' }) as HTMLCanvasElement;
    const status = h('div', { class: 'race-note' });
    const problems = h('div', { class: 'track-bad' });
    const radius = h('input', { type: 'range', min: String(MIN_RADIUS), max: String(MAX_RADIUS), step: '0.5' }) as HTMLInputElement;
    const radiusLabel = h('span', { class: 'race-date' });
    const delBtn = h('button', { class: 'btn small' }, '🗑️ Delete corner');
    const startBtn = h('button', { class: 'btn small', title: 'The start/finish straight runs from the selected corner to the next one' }, '🏁 Start after this corner');
    const revBtn = h('button', { class: 'btn small' }, '🔄 Reverse direction');
    const undoBtn = h('button', { class: 'btn small' }, '↩️ Undo');
    const help = h('div', { class: 'race-date' },
      'Drag a corner to move it · click a dashed edge to add a corner · double-click (or Delete) removes one · mouse wheel or the slider sets the selected corner’s radius · arrows nudge · Ctrl+Z undoes.');

    // --- drawing ---------------------------------------------------------------------
    const maxW = Math.min(940, window.innerWidth - 90);
    const maxH = Math.max(260, Math.min(520, window.innerHeight - 380));
    const scale = Math.min(maxW / W, maxH / D);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W * scale * dpr);
    canvas.height = Math.round(D * scale * dpr);
    canvas.style.width = `${W * scale}px`;
    canvas.style.height = `${D * scale}px`;
    const ctx = canvas.getContext('2d')!;
    const area = trackArea(W, D);
    let hoverEdge: { i: number; x: number; z: number } | null = null;

    const draw = () => {
      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
      ctx.clearRect(0, 0, W, D);
      ctx.fillStyle = '#bfe3a0';
      ctx.fillRect(0, 0, W, D);
      // Grandstand and paddock strips, the area the track must stay in.
      ctx.fillStyle = '#e9dcc4';
      ctx.fillRect(0, 0, W, area.minZ - WALL - 0.5);
      ctx.fillRect(0, area.maxZ + WALL + 0.5, W, D - area.maxZ - WALL - 0.5);
      ctx.fillStyle = '#8a7a63';
      ctx.font = 'bold 3px system-ui';
      ctx.fillText('grandstands', 3, 5);
      ctx.fillText('paddock · gate · booth', 3, D - 2.5);
      ctx.setLineDash([1.5, 1.2]);
      ctx.strokeStyle = '#6f8f58';
      ctx.lineWidth = 0.3;
      ctx.strokeRect(area.minX, area.minZ, area.maxX - area.minX, area.maxZ - area.minZ);
      ctx.setLineDash([]);

      const { pts, left } = plan;
      const path = (off: number) => {
        ctx.beginPath();
        pts.forEach((p, i) => {
          const x = p.x + left[i].x * off, z = p.z + left[i].z * off;
          if (i) ctx.lineTo(x, z);
          else ctx.moveTo(x, z);
        });
        ctx.closePath();
      };
      // Walls, asphalt, centre line.
      ctx.lineJoin = 'round';
      for (const side of [-1, 1]) {
        path(side * WALL);
        ctx.strokeStyle = '#e8645c';
        ctx.lineWidth = 0.6;
        ctx.stroke();
      }
      path(0);
      ctx.strokeStyle = '#5c5f66';
      ctx.lineWidth = HALF_WIDTH * 2;
      ctx.stroke();
      ctx.setLineDash([1.2, 1.2]);
      ctx.strokeStyle = '#e9e6dc';
      ctx.lineWidth = 0.2;
      ctx.stroke();
      ctx.setLineDash([]);
      // Direction arrows every ~25 units.
      const every = Math.max(1, Math.round(25 / (plan.length / pts.length)));
      ctx.fillStyle = '#ffffffcc';
      for (let i = Math.round(every / 2); i < pts.length; i += every) {
        const p = pts[i], t = plan.tan[i], l = left[i];
        ctx.beginPath();
        ctx.moveTo(p.x + t.x * 1.6, p.z + t.z * 1.6);
        ctx.lineTo(p.x - t.x * 1.0 + l.x * 1.2, p.z - t.z * 1.0 + l.z * 1.2);
        ctx.lineTo(p.x - t.x * 1.0 - l.x * 1.2, p.z - t.z * 1.0 - l.z * 1.2);
        ctx.closePath();
        ctx.fill();
      }
      // Start/finish line.
      {
        const p = pts[plan.startIndex], l = left[plan.startIndex], t = plan.tan[plan.startIndex];
        for (let k = 0; k < 8; k++) {
          for (let r = 0; r < 2; r++) {
            const a = -HALF_WIDTH + (k * 2 * HALF_WIDTH) / 8;
            const c = (k + r) % 2 ? '#222226' : '#ffffff';
            const sz = (2 * HALF_WIDTH) / 8;
            const x = p.x + l.x * (a + sz / 2) + t.x * (r - 0.5) * sz, z = p.z + l.z * (a + sz / 2) + t.z * (r - 0.5) * sz;
            ctx.fillStyle = c;
            ctx.fillRect(x - sz / 2, z - sz / 2, sz, sz);
          }
        }
      }
      // Problem spots.
      ctx.fillStyle = '#ff2d55';
      for (const b of check.bad) {
        ctx.beginPath();
        ctx.arc(b.x, b.z, 0.7, 0, Math.PI * 2);
        ctx.fill();
      }
      // Control polygon and handles (in pixels for a constant size).
      ctx.setLineDash([1, 1]);
      ctx.strokeStyle = '#2b2d3199';
      ctx.lineWidth = 0.25;
      ctx.beginPath();
      corners.forEach(([x, z], i) => (i ? ctx.lineTo(x, z) : ctx.moveTo(x, z)));
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (hoverEdge && sel < 0) {
        ctx.fillStyle = '#3fa7a0';
        ctx.beginPath();
        ctx.arc(hoverEdge.x * scale, hoverEdge.z * scale, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 12px system-ui';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('+', hoverEdge.x * scale, hoverEdge.z * scale + 0.5);
      }
      corners.forEach(([x, z], i) => {
        ctx.beginPath();
        ctx.arc(x * scale, z * scale, HANDLE, 0, Math.PI * 2);
        ctx.fillStyle = i === sel ? '#ff9f43' : '#ffffff';
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = check.badCorners.has(i) ? '#ff2d55' : '#2b2d31';
        ctx.stroke();
        ctx.fillStyle = '#2b2d31';
        ctx.font = 'bold 10px system-ui';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(i + 1), x * scale, z * scale + 0.5);
      });
    };

    const refresh = () => {
      plan = planTrack(corners);
      check = checkTrack(corners, W, D, plan);
      const lap = plan.length / AVG_SPEED;
      status.textContent = `${Math.round(plan.length)} m · ${corners.length} corners · about ${Math.round(lap)} s a lap` + (check.ok ? ' · ✅ ready to race' : '');
      problems.innerHTML = '';
      for (const p of check.problems) problems.append(h('div', {}, `⚠️ ${p}`));
      const has = sel >= 0 && sel < corners.length;
      radius.disabled = !has;
      if (has) radius.value = String(corners[sel][2]);
      radiusLabel.textContent = has ? `Corner ${sel + 1} radius: ${corners[sel][2]}` : 'Select a corner to change its radius';
      delBtn.toggleAttribute('disabled', !has || corners.length <= 3);
      startBtn.toggleAttribute('disabled', !has || sel === 0);
      undoBtn.toggleAttribute('disabled', !undo.length);
      draw();
    };
    let queued = false;
    const later = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        refresh();
      });
    };

    // --- editing ---------------------------------------------------------------------
    const snap = (v: number) => Math.round(v * 2) / 2;
    const clampX = (x: number) => Math.max(0, Math.min(W, x));
    const clampZ = (z: number) => Math.max(0, Math.min(D, z));
    const toTrack = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: (e.clientX - r.left) / scale, z: (e.clientY - r.top) / scale };
    };
    const handleAt = (x: number, z: number) => {
      let best = -1, bestD = (HANDLE + 3) / scale;
      corners.forEach(([cx, cz], i) => {
        const d = Math.hypot(cx - x, cz - z);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      return best;
    };
    const edgeAt = (x: number, z: number): { i: number; x: number; z: number } | null => {
      let best: { i: number; x: number; z: number } | null = null, bestD = 10 / scale;
      for (let i = 0; i < corners.length; i++) {
        const [ax, az] = corners[i], [bx, bz] = corners[(i + 1) % corners.length];
        const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz || 1;
        const t = Math.max(0.1, Math.min(0.9, ((x - ax) * dx + (z - az) * dz) / len2));
        const px = ax + dx * t, pz = az + dz * t;
        const d = Math.hypot(px - x, pz - z);
        if (d < bestD) {
          bestD = d;
          best = { i, x: px, z: pz };
        }
      }
      return best;
    };
    const setRadius = (i: number, r: number) => {
      corners[i] = [corners[i][0], corners[i][1], Math.max(MIN_RADIUS, Math.min(MAX_RADIUS, snap(r)))];
    };
    const removeCorner = (i: number) => {
      if (corners.length <= 3) return;
      snapshot();
      corners.splice(i, 1);
      sel = -1;
      refresh();
    };

    let drag = -1;
    canvas.addEventListener('mousedown', (e) => {
      canvas.focus();
      const p = toTrack(e);
      const i = handleAt(p.x, p.z);
      if (i >= 0) {
        snapshot();
        sel = drag = i;
      } else {
        const edge = edgeAt(p.x, p.z);
        if (edge) {
          snapshot();
          corners.splice(edge.i + 1, 0, [snap(edge.x), snap(edge.z), 8]);
          sel = drag = edge.i + 1;
        } else sel = -1;
      }
      refresh();
    });
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    function onMove(e: MouseEvent) {
      if (!canvas.isConnected) {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        return;
      }
      const p = toTrack(e);
      if (drag >= 0) {
        corners[drag] = [clampX(snap(p.x)), clampZ(snap(p.z)), corners[drag][2]];
        later();
        return;
      }
      if (e.target !== canvas) return;
      const over = handleAt(p.x, p.z);
      const edge = over >= 0 ? null : edgeAt(p.x, p.z);
      canvas.style.cursor = over >= 0 ? 'grab' : edge ? 'copy' : 'default';
      if (JSON.stringify(edge) !== JSON.stringify(hoverEdge)) {
        hoverEdge = edge;
        draw();
      }
    }
    function onUp() {
      drag = -1;
    }
    canvas.addEventListener('mouseleave', () => {
      hoverEdge = null;
      draw();
    });
    canvas.addEventListener('dblclick', (e) => {
      const p = toTrack(e);
      const i = handleAt(p.x, p.z);
      if (i >= 0) {
        undo.pop(); // the mousedown before already saved this state
        removeCorner(i);
      }
    });
    canvas.addEventListener('wheel', (e) => {
      const p = toTrack(e);
      const i = handleAt(p.x, p.z) >= 0 ? handleAt(p.x, p.z) : sel;
      if (i < 0) return;
      e.preventDefault();
      snapshot();
      sel = i;
      setRadius(i, corners[i][2] + (e.deltaY < 0 ? 0.5 : -0.5));
      later();
    }, { passive: false });
    canvas.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
        e.preventDefault();
        doUndo();
        return;
      }
      if (sel < 0) return;
      if (e.code === 'Delete' || e.code === 'Backspace') {
        e.preventDefault();
        removeCorner(sel);
        return;
      }
      const step = e.shiftKey ? 2 : 0.5;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.code];
      if (!d) return;
      e.preventDefault();
      snapshot();
      corners[sel] = [clampX(corners[sel][0] + d[0]), clampZ(corners[sel][1] + d[1]), corners[sel][2]];
      later();
    });
    radius.addEventListener('pointerdown', () => sel >= 0 && snapshot());
    radius.addEventListener('input', () => {
      if (sel < 0) return;
      setRadius(sel, Number(radius.value));
      later();
    });
    const doUndo = () => {
      const prev = undo.pop();
      if (!prev) return;
      corners = prev;
      if (sel >= corners.length) sel = -1;
      refresh();
    };
    undoBtn.addEventListener('click', doUndo);
    delBtn.addEventListener('click', () => sel >= 0 && removeCorner(sel));
    startBtn.addEventListener('click', () => {
      if (sel <= 0) return;
      snapshot();
      corners = [...corners.slice(sel), ...corners.slice(0, sel)];
      sel = 0;
      refresh();
    });
    revBtn.addEventListener('click', () => {
      snapshot();
      // Keep the same start straight, driven the other way: it now runs from old corner 2 to old corner 1.
      const r = [...corners].reverse();
      corners = [...r.slice(-2), ...r.slice(0, -2)];
      sel = -1;
      refresh();
    });

    // --- saving ----------------------------------------------------------------------
    const save = async (race: boolean) => {
      if (!check.ok) {
        toast('⚠️ Fix the problems shown under the map before saving.');
        return;
      }
      const trackName = name.value.trim() || 'My track';
      try {
        const id = await tracks.save({ name: trackName, corners, parent });
        dirty = false;
        if (race) {
          tracks.activate(id);
          toast(`🏁 Saved! The circuit is now ${trackName}.`);
        } else toast(`💾 Saved ${trackName} as ${id}.json`);
        showList();
      } catch (err) {
        toast(`⚠️ ${(err as Error).message}`);
      }
    };
    const back = h('button', { class: 'btn' }, '⬅️ All tracks');
    back.addEventListener('click', () => {
      if (dirty && !confirm('Leave without saving your changes?')) return;
      showList();
    });
    const saveBtn = h('button', { class: 'btn' }, '💾 Save as new version');
    saveBtn.addEventListener('click', () => void save(false));
    const raceBtn = h('button', { class: 'btn primary' }, '🏁 Save & race it');
    raceBtn.addEventListener('click', () => void save(true));

    const body = h('div', { class: 'tracks' },
      h('div', { class: 'row' }, h('div', { style: 'flex:1;min-width:200px' }, name), undoBtn, revBtn),
      h('div', { class: 'track-canvas-wrap' }, canvas),
      h('div', { class: 'row' }, radiusLabel, radius, startBtn, delBtn),
      status, problems, help);
    panel.open({
      title: parent ? '✏️ Edit track' : '✨ New track', color: COLOR, body, kind: 'tracks',
      subtitle: parent ? `Editing a copy of ${parent}.json; saving makes a new version` : 'Saving makes a new file in .data/tracks/',
      foot: h('div', { class: 'row' }, back, h('div', { class: 'spacer' }), saveBtn, raceBtn),
    });
    refresh();
    canvas.focus();
  };

  showList();
}

/** A track's top 10. */
function board(t: TrackDef) {
  const table = h('div', { class: 'race-board' });
  if (!t.times.length) table.append(h('div', { class: 'race-note' }, 'No times yet: hop in your kart and drive onto the start pad!'));
  t.times.forEach((b, i) => table.append(h('div', { class: 'race-row' },
    h('span', { class: 'race-rank' }, `${i + 1}.`),
    h('span', { class: 'race-t' }, raceTime(b.timeMs)),
    h('span', { class: 'race-date' }, fmtDate(b.date)))));
  return table;
}

/** A small top-down sketch of a track. */
function thumb(corners: TrackCorner[], W: number, D: number) {
  const c = h('canvas', { class: 'track-thumb' }) as HTMLCanvasElement;
  const s = 120 / W, dpr = window.devicePixelRatio || 1;
  c.width = Math.round(W * s * dpr);
  c.height = Math.round(D * s * dpr);
  c.style.width = `${W * s}px`;
  c.style.height = `${D * s}px`;
  const ctx = c.getContext('2d')!;
  ctx.setTransform(s * dpr, 0, 0, s * dpr, 0, 0);
  ctx.fillStyle = '#bfe3a0';
  ctx.fillRect(0, 0, W, D);
  const { pts } = planTrack(corners);
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.z) : ctx.moveTo(p.x, p.z)));
  ctx.closePath();
  ctx.strokeStyle = '#5c5f66';
  ctx.lineWidth = HALF_WIDTH * 2;
  ctx.lineJoin = 'round';
  ctx.stroke();
  return c;
}
