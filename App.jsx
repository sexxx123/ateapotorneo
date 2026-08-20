import { useState, useEffect, useCallback } from 'react';
import {
  Trophy, Users, User, Calendar, ShieldAlert, BarChart3, Settings,
  Plus, Trash2, X, AlertTriangle, Check, Pencil, Table2, Award, Loader2,
  LogIn, LogOut, Mail, Home, FileText, UserCircle2, Send
} from 'lucide-react';
import { supabase } from './supabaseClient';

const PALETTE = ['#2E9E4A', '#D8432E', '#3B82C4', '#E67E22', '#9B59B6', '#1ABC9C', '#C0392B', '#5B6EE1', '#B7950B', '#EC4899'];
const POSITIONS = ['Portero', 'Defensa', 'Mediocampo', 'Delantero'];

function uid(prefix) {
  return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function formatDate(d) {
  if (!d) return null;
  try {
    const dt = new Date(d + 'T00:00:00');
    if (isNaN(dt.getTime())) return d;
    return dt.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch (e) { return d; }
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function defaultData() {
  return {
    meta: {
      name: 'Jornadas de Futbolito 2026',
      category: 'Futbolito',
      organizerName: '',
      startDate: '',
      endDate: '',
      description: 'Campeonato de futbolito jugado entre los equipos participantes.',
      rules: '',
      pointsWin: 3, pointsDraw: 1, pointsLoss: 0,
      yellowLimit: 3, redSuspensionMatches: 1, playoffSpots: 4, relegationSpots: 0,
      adminEmail: '',
    },
    teams: [],
    players: [],
    matches: [],
    playoffMatches: [],
  };
}

function generateRoundRobin(teamIds) {
  let ids = [...teamIds];
  if (ids.length % 2 !== 0) ids.push(null);
  const n = ids.length;
  const rounds = n - 1;
  const half = n / 2;
  let arr = [...ids];
  const fixture = [];
  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < half; i++) {
      const a = arr[i], b = arr[n - 1 - i];
      if (a !== null && b !== null) fixture.push({ jornada: r + 1, teamAId: a, teamBId: b });
    }
    const fixed = arr[0];
    const rest = arr.slice(1);
    rest.unshift(rest.pop());
    arr = [fixed, ...rest];
  }
  return fixture;
}

function computeStandings(data) {
  const table = data.teams.map(t => ({ teamId: t.id, pj: 0, pg: 0, pe: 0, pp: 0, gf: 0, gc: 0, pts: 0 }));
  const map = Object.fromEntries(table.map(t => [t.teamId, t]));
  data.matches.filter(m => m.played).forEach(m => {
    const a = map[m.teamAId], b = map[m.teamBId];
    if (!a || !b) return;
    a.pj++; b.pj++;
    a.gf += m.scoreA; a.gc += m.scoreB;
    b.gf += m.scoreB; b.gc += m.scoreA;
    if (m.scoreA > m.scoreB) { a.pg++; a.pts += data.meta.pointsWin; b.pp++; b.pts += data.meta.pointsLoss; }
    else if (m.scoreA < m.scoreB) { b.pg++; b.pts += data.meta.pointsWin; a.pp++; a.pts += data.meta.pointsLoss; }
    else { a.pe++; b.pe++; a.pts += data.meta.pointsDraw; b.pts += data.meta.pointsDraw; }
  });
  table.forEach(t => t.dg = t.gf - t.gc);
  table.sort((x, y) => y.pts - x.pts || y.dg - x.dg || y.gf - x.gf);
  return table;
}

function getPlayerStats(playerId, data) {
  let goals = 0, yellow = 0, red = 0, matchesPlayed = 0;
  [...data.matches, ...data.playoffMatches].forEach(m => {
    if (m.played && m.playerStats && m.playerStats[playerId]) {
      const s = m.playerStats[playerId];
      goals += s.goals || 0;
      if (s.yellow) yellow += 1;
      if (s.red) red += 1;
      matchesPlayed += 1;
    }
  });
  const yellowLimit = data.meta.yellowLimit || 3;
  const redSusp = data.meta.redSuspensionMatches || 1;
  const triggered = Math.floor(yellow / yellowLimit) + red * redSusp;
  const player = data.players.find(p => p.id === playerId);
  const served = (player && player.servedSuspensions) || 0;
  const pending = Math.max(0, triggered - served);
  const yellowSinceReset = yellow % yellowLimit;
  return { goals, yellow, red, triggered, served, pending, yellowSinceReset, yellowLimit, matchesPlayed };
}

function teamName(teams, id) {
  const t = teams.find(t => t.id === id);
  return t ? t.name : 'Equipo eliminado';
}

/* ---------- Piezas reutilizables ---------- */

function GlobalStyles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@500;600;700;800&family=Inter:wght@400;500;600;700&display=swap');
      .futbolito-app{ font-family:'Inter',sans-serif; background:#F1F2F4; color:#2A2E35; }
      .futbolito-app *{ box-sizing:border-box; }
      .font-display{ font-family:'Poppins',sans-serif; }
      .app-shell{ display:flex; min-height:640px; }
      .sidebar{ width:240px; flex-shrink:0; background:#2E9E4A; display:flex; flex-direction:column; padding:22px 16px; }
      .sidebar-logo-row{ display:flex; align-items:center; gap:10px; margin-bottom:24px; padding:0 6px; }
      .sidebar-logo-badge{ width:38px; height:38px; border-radius:10px; background:rgba(255,255,255,.18); display:flex; align-items:center; justify-content:center; flex-shrink:0; }
      .sidebar-title{ font-family:'Poppins',sans-serif; font-weight:700; font-size:14.5px; color:#fff; line-height:1.25; overflow:hidden; text-overflow:ellipsis; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }
      .sidebar-nav{ display:flex; flex-direction:column; gap:2px; flex:1; }
      .sidebar-nav-item{ display:flex; align-items:center; gap:10px; padding:10px 12px; border-radius:8px; color:rgba(255,255,255,.82); font-family:'Inter',sans-serif; font-weight:600; font-size:13.5px; cursor:pointer; background:transparent; border:none; text-align:left; width:100%; transition:background .12s, color .12s; }
      .sidebar-nav-item:hover{ background:rgba(255,255,255,.12); color:#fff; }
      .sidebar-nav-item.active{ background:#1E6F34; color:#fff; }
      .sidebar-footer{ border-top:1px solid rgba(255,255,255,.18); padding-top:12px; margin-top:12px; display:flex; flex-direction:column; gap:2px; }
      .sidebar-footer-link{ display:flex; align-items:center; gap:8px; padding:8px 12px; border-radius:8px; color:rgba(255,255,255,.85); font-size:12.5px; font-weight:600; cursor:pointer; background:transparent; border:none; text-align:left; width:100%; }
      .sidebar-footer-link:hover{ background:rgba(255,255,255,.12); color:#fff; }
      .main-area{ flex:1; padding:28px 32px; min-width:0; }
      .page-header{ margin-bottom:22px; }
      .page-title{ font-family:'Poppins',sans-serif; font-weight:800; font-size:28px; color:#1B2A4D; line-height:1.15; }
      .page-subtitle{ font-family:'Inter',sans-serif; font-weight:600; font-size:14.5px; color:#3B4A6B; margin-top:4px; }
      .card{ background:#fff; border:1px solid #E3E5E9; border-radius:10px; font-family:'Inter',sans-serif; }
      .card-header-green{ background:#2E9E4A; color:#fff; font-family:'Poppins',sans-serif; font-weight:700; font-size:13.5px; padding:12px 16px; border-radius:10px 10px 0 0; }
      .btn{ font-family:'Inter',sans-serif; font-weight:600; padding:9px 16px; border-radius:8px; font-size:13px; cursor:pointer; border:1px solid transparent; display:inline-flex; align-items:center; gap:6px; white-space:nowrap; transition:opacity .15s, background .15s, border-color .15s, color .15s, transform .08s; }
      .btn:active{ transform:scale(.97); }
      .btn-primary{ background:#2E9E4A; color:#fff; }
      .btn-primary:hover{ background:#278641; }
      .btn-primary:disabled{ opacity:.4; cursor:not-allowed; }
      .btn-outline{ background:#fff; color:#2A2E35; border-color:#D8DBE0; }
      .btn-outline:hover{ border-color:#2E9E4A; color:#2E9E4A; }
      .btn-danger{ background:#fff; color:#C4302B; border-color:#F1C9C7; }
      .btn-danger:hover{ background:#E5484D; color:#fff; border-color:#E5484D; }
      .btn-sm{ padding:6px 11px; font-size:12px; }
      .icon-btn{ width:32px; height:32px; border-radius:8px; display:inline-flex; align-items:center; justify-content:center; background:transparent; border:1px solid #D8DBE0; color:#6B7280; cursor:pointer; flex-shrink:0; }
      .icon-btn:hover{ border-color:#2E9E4A; color:#2E9E4A; }
      .input, textarea.textarea{ background:#fff; border:1px solid #D8DBE0; color:#2A2E35; padding:8px 11px; border-radius:8px; font-family:'Inter',sans-serif; font-size:13px; width:100%; }
      .input:focus, textarea.textarea:focus{ outline:2px solid #2E9E4A; outline-offset:1px; border-color:#2E9E4A; }
      .input::placeholder, textarea.textarea::placeholder{ color:#A7ACB4; }
      textarea.textarea{ resize:vertical; min-height:76px; }
      label.field-label{ font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:#6B7280; margin-bottom:5px; display:block; font-weight:700; }
      .crest{ display:inline-flex; align-items:center; justify-content:center; border-radius:8px; color:#fff; font-family:'Poppins',sans-serif; font-weight:700; flex-shrink:0; }
      .team-name-cell{ font-family:'Inter',sans-serif; font-weight:600; text-align:left !important; color:#1B2A4D; }
      .card-chip{ display:inline-block; width:10px; height:14px; border-radius:2px; flex-shrink:0; }
      .card-chip.yellow{ background:#F2C230; }
      .card-chip.red{ background:#D8432E; }
      table.data-table{ border-collapse:collapse; width:100%; }
      table.data-table th{ font-family:'Inter',sans-serif; font-weight:700; color:#8A8F98; font-size:11px; text-align:center; padding:11px 8px; white-space:nowrap; text-transform:uppercase; letter-spacing:.03em; }
      table.data-table td{ font-family:'Inter',sans-serif; font-size:13px; text-align:center; padding:9px 8px; white-space:nowrap; color:#2A2E35; }
      tr.row-alt td{ background:#F7F8F7; }
      tr.zone-top{ box-shadow: inset 3px 0 0 #2E9E4A; }
      tr.zone-bottom{ box-shadow: inset 3px 0 0 #E5484D; }
      .avatar-circle{ border-radius:50%; background:#E7E9EC; display:flex; align-items:center; justify-content:center; color:#9AA1AC; flex-shrink:0; }
      .status-pill{ font-size:10px; font-weight:700; padding:3px 9px; border-radius:20px; display:inline-block; }
      .status-pill.done{ background:#E7F0FC; color:#2E6FD9; }
      .status-pill.pending{ background:#F0F1F3; color:#6B7280; }
      .info-strip{ background:#EAF7EE; border:1px solid #D3EFDA; border-radius:10px; padding:14px 18px; display:flex; gap:28px; flex-wrap:wrap; align-items:center; }
      .info-strip-item .lbl{ font-size:10.5px; text-transform:uppercase; letter-spacing:.04em; color:#3F8A50; font-weight:700; }
      .info-strip-item .val{ font-size:13.5px; color:#1B2A4D; font-weight:600; margin-top:2px; }
      .stat-circle{ width:60px; height:60px; border-radius:50%; border:2px solid #2E9E4A; display:flex; align-items:center; justify-content:center; font-family:'Poppins',sans-serif; font-weight:800; font-size:19px; color:#1B2A4D; margin:0 auto; }
      .checkbox-row{ display:flex; align-items:center; gap:6px; cursor:pointer; user-select:none; }
      .checkbox-row input{ accent-color:#2E9E4A; width:15px; height:15px; cursor:pointer; }
      .swatch{ width:22px; height:22px; border-radius:6px; cursor:pointer; border:2px solid transparent; flex-shrink:0; }
      .swatch.selected{ border-color:#1B2A4D; }
      .futbolito-app ::-webkit-scrollbar{ width:8px; height:8px; }
      .futbolito-app ::-webkit-scrollbar-thumb{ background:#D8DBE0; border-radius:4px; }
      .futbolito-app input[type=color]{ -webkit-appearance:none; appearance:none; border:none; width:34px; height:34px; padding:0; border-radius:6px; overflow:hidden; background:transparent; cursor:pointer; }
      .futbolito-app input[type=color]::-webkit-color-swatch-wrapper{ padding:0; }
      .futbolito-app input[type=color]::-webkit-color-swatch{ border:1px solid #D8DBE0; border-radius:6px; }
      .modal-overlay{ position:fixed; inset:0; background:rgba(20,26,22,.55); display:flex; align-items:flex-start; justify-content:center; z-index:50; padding:24px 16px; overflow-y:auto; animation:fadeIn .12s ease; }
      .modal-box{ background:#fff; border:1px solid #E3E5E9; border-radius:12px; max-width:640px; width:100%; margin:auto; }
      @keyframes fadeIn{ from{opacity:0} to{opacity:1} }
      @keyframes spin{ from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
      .spin{ animation:spin 1s linear infinite; }
      @media (max-width:820px){
        .app-shell{ flex-direction:column; }
        .sidebar{ width:100%; flex-direction:row; align-items:center; padding:14px 16px; gap:14px; }
        .sidebar-logo-row{ margin-bottom:0; }
        .sidebar-title{ max-width:120px; }
        .sidebar-nav{ flex-direction:row; overflow-x:auto; flex:1; }
        .sidebar-nav-item{ flex-shrink:0; width:auto; }
        .sidebar-footer{ border-top:none; margin-top:0; padding-top:0; flex-direction:row; flex-shrink:0; }
        .main-area{ padding:20px; }
        .two-col{ grid-template-columns:1fr !important; }
      }
    `}</style>
  );
}

function Crest({ team, size }) {
  const s = size === 'sm' ? 24 : size === 'lg' ? 46 : 30;
  const fs = Math.round(s * 0.36);
  if (!team) return <div className="crest" style={{ width: s, height: s, background: '#B9BEC6', fontSize: fs }}>?</div>;
  return <div className="crest" style={{ width: s, height: s, background: team.color, fontSize: fs }}>{initials(team.name)}</div>;
}

function TeamChip({ team, size }) {
  if (!team) return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#9AA1AC' }}><Crest size={size} /> Equipo eliminado</span>;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <Crest team={team} size={size} />
      <span className="team-name-cell">{team.name}</span>
    </span>
  );
}

function Avatar({ size }) {
  const s = size || 32;
  return (
    <div className="avatar-circle" style={{ width: s, height: s }}>
      <UserCircle2 size={Math.round(s * 0.72)} />
    </div>
  );
}

function CardBadge({ yellow, red }) {
  if (!yellow && !red) return <span style={{ color: '#C7CBD1' }}>—</span>;
  return (
    <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}>
      {yellow > 0 && <span className="card-chip yellow" title={yellow + ' amarilla(s)'} />}
      {red > 0 && <span className="card-chip red" title={red + ' roja(s)'} />}
    </span>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #E3E5E9' }}>
          <h3 className="font-display" style={{ fontSize: 18, fontWeight: 700, color: '#1B2A4D', margin: 0 }}>{title}</h3>
          <button onClick={onClose} className="icon-btn" aria-label="Cerrar"><X size={16} /></button>
        </div>
        <div style={{ padding: 20 }}>{children}</div>
      </div>
    </div>
  );
}

function EmptyState({ Icon, title, text }) {
  return (
    <div className="card" style={{ padding: '40px 20px', textAlign: 'center' }}>
      <Icon size={28} color="#C7CBD1" style={{ margin: '0 auto 12px' }} />
      <div className="font-display" style={{ fontSize: 16, fontWeight: 700, color: '#1B2A4D' }}>{title}</div>
      <div style={{ fontSize: 13, color: '#6B7280', marginTop: 4, maxWidth: 380, marginLeft: 'auto', marginRight: 'auto' }}>{text}</div>
    </div>
  );
}

function ConfirmInline({ text, onConfirm, onCancel }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 12, color: '#C4302B', fontWeight: 600 }}>{text}</span>
      <button className="btn btn-danger btn-sm" onClick={onConfirm}><Check size={13} /></button>
      <button className="btn btn-outline btn-sm" onClick={onCancel}><X size={13} /></button>
    </span>
  );
}

/* ---------- Formularios modales ---------- */

function TeamFormModal({ initial, onClose, onSave }) {
  const [name, setName] = useState(initial ? initial.name : '');
  const [color, setColor] = useState(initial ? initial.color : PALETTE[0]);
  return (
    <Modal title={initial ? 'Editar equipo' : 'Nuevo equipo'} onClose={onClose}>
      <div style={{ marginBottom: 14 }}>
        <label className="field-label">Nombre del equipo</label>
        <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Ej: Los Halcones" autoFocus />
      </div>
      <div style={{ marginBottom: 18 }}>
        <label className="field-label">Color / identidad</label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {PALETTE.map(c => (
            <span key={c} className={'swatch' + (c === color ? ' selected' : '')} style={{ background: c }} onClick={() => setColor(c)} />
          ))}
          <input type="color" value={color} onChange={e => setColor(e.target.value)} />
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button className="btn btn-outline" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" disabled={!name.trim()} onClick={() => name.trim() && onSave({ name: name.trim(), color })}>
          {initial ? 'Guardar cambios' : 'Agregar equipo'}
        </button>
      </div>
    </Modal>
  );
}

function PlayerFormModal({ initial, teams, defaultTeamId, onClose, onSave }) {
  const [name, setName] = useState(initial ? initial.name : '');
  const [number, setNumber] = useState(initial ? initial.number : '');
  const [position, setPosition] = useState(initial ? initial.position : POSITIONS[0]);
  const [teamId, setTeamId] = useState(initial ? initial.teamId : (defaultTeamId || (teams[0] && teams[0].id) || ''));
  return (
    <Modal title={initial ? 'Editar jugador' : 'Nuevo jugador'} onClose={onClose}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px', gap: 12, marginBottom: 14 }}>
        <div>
          <label className="field-label">Nombre del jugador</label>
          <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Ej: Juan Pérez" autoFocus />
        </div>
        <div>
          <label className="field-label">Dorsal</label>
          <input className="input" type="number" min="0" value={number} onChange={e => setNumber(e.target.value)} placeholder="#" />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 18 }}>
        <div>
          <label className="field-label">Equipo</label>
          <select className="input" value={teamId} onChange={e => setTeamId(e.target.value)}>
            {teams.length === 0 && <option value="">Sin equipos</option>}
            {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div>
          <label className="field-label">Posición</label>
          <select className="input" value={position} onChange={e => setPosition(e.target.value)}>
            {POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button className="btn btn-outline" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" disabled={!name.trim() || !teamId}
          onClick={() => name.trim() && teamId && onSave({ name: name.trim(), number: number === '' ? '' : Number(number), position, teamId })}>
          {initial ? 'Guardar cambios' : 'Agregar jugador'}
        </button>
      </div>
    </Modal>
  );
}

function MatchFormModal({ teams, phase, onClose, onSave, suggestedJornada }) {
  const [teamAId, setTeamAId] = useState(teams[0] ? teams[0].id : '');
  const [teamBId, setTeamBId] = useState(teams[1] ? teams[1].id : '');
  const [jornada, setJornada] = useState(suggestedJornada || 1);
  const [round, setRound] = useState('Semifinal');
  const [date, setDate] = useState('');
  const invalid = !teamAId || !teamBId || teamAId === teamBId;
  return (
    <Modal title={phase === 'liga' ? 'Agregar partido de liga' : 'Agregar partido de playoffs'} onClose={onClose}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
        <div>
          <label className="field-label">Equipo local</label>
          <select className="input" value={teamAId} onChange={e => setTeamAId(e.target.value)}>
            {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div>
          <label className="field-label">Equipo visitante</label>
          <select className="input" value={teamBId} onChange={e => setTeamBId(e.target.value)}>
            {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      </div>
      {invalid && teamAId && teamBId && (
        <div style={{ fontSize: 12, color: '#C4302B', marginBottom: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
          <AlertTriangle size={13} /> Selecciona dos equipos distintos.
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 18 }}>
        <div>
          <label className="field-label">{phase === 'liga' ? 'Jornada' : 'Ronda'}</label>
          {phase === 'liga'
            ? <input className="input" type="number" min="1" value={jornada} onChange={e => setJornada(Number(e.target.value))} />
            : <input className="input" value={round} onChange={e => setRound(e.target.value)} placeholder="Ej: Semifinal, Final" />}
        </div>
        <div>
          <label className="field-label">Fecha (opcional)</label>
          <input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} />
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button className="btn btn-outline" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" disabled={invalid} onClick={() => onSave({
          teamAId, teamBId, date,
          jornada: phase === 'liga' ? jornada : undefined,
          round: phase === 'playoff' ? (round.trim() || 'Ronda') : undefined,
        })}>Agregar partido</button>
      </div>
    </Modal>
  );
}

function MatchResultModal({ match, teams, players, onClose, onSave, onDelete }) {
  const teamA = teams.find(t => t.id === match.teamAId);
  const teamB = teams.find(t => t.id === match.teamBId);
  const playersA = players.filter(p => p.teamId === match.teamAId);
  const playersB = players.filter(p => p.teamId === match.teamBId);

  const initStats = {};
  [...playersA, ...playersB].forEach(p => {
    const existing = match.playerStats && match.playerStats[p.id];
    initStats[p.id] = { goals: existing ? existing.goals || 0 : 0, yellow: existing ? !!existing.yellow : false, red: existing ? !!existing.red : false };
  });

  const [scoreA, setScoreA] = useState(match.scoreA || 0);
  const [scoreB, setScoreB] = useState(match.scoreB || 0);
  const [stats, setStats] = useState(initStats);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const setPlayerField = (pid, field, value) => setStats(prev => ({ ...prev, [pid]: { ...prev[pid], [field]: value } }));
  const sumGoals = (list) => list.reduce((acc, p) => acc + (Number(stats[p.id]?.goals) || 0), 0);

  const renderPlayerRows = (list) => list.length === 0
    ? <div style={{ fontSize: 12, color: '#9AA1AC', padding: '10px 0' }}>Sin jugadores registrados en este equipo.</div>
    : list.map(p => (
      <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid #EEF0F2' }}>
        <div style={{ flex: 1, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
          {p.number !== '' && p.number !== undefined ? <span style={{ color: '#9AA1AC', fontWeight: 700 }}>#{p.number}</span> : null} {p.name}
        </div>
        <input className="input" type="number" min="0" style={{ width: 56, textAlign: 'center' }}
          value={stats[p.id]?.goals ?? 0}
          onChange={e => setPlayerField(p.id, 'goals', Math.max(0, Number(e.target.value)))} />
        <label className="checkbox-row" title="Tarjeta amarilla">
          <input type="checkbox" checked={!!stats[p.id]?.yellow} onChange={e => setPlayerField(p.id, 'yellow', e.target.checked)} />
          <span className="card-chip yellow" />
        </label>
        <label className="checkbox-row" title="Tarjeta roja">
          <input type="checkbox" checked={!!stats[p.id]?.red} onChange={e => setPlayerField(p.id, 'red', e.target.checked)} />
          <span className="card-chip red" />
        </label>
      </div>
    ));

  return (
    <Modal title={(match.phase === 'liga' ? 'Jornada ' + match.jornada : match.round) + ' · Resultado'} onClose={onClose}>
      <div style={{ background: '#F6F9F7', border: '1px solid #E3E5E9', borderRadius: 10, padding: 16, marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
          <div style={{ flex: 1, textAlign: 'right' }}><TeamChip team={teamA} /></div>
          <input className="input" type="number" min="0" style={{ width: 54, textAlign: 'center', fontSize: 18, fontWeight: 700 }} value={scoreA} onChange={e => setScoreA(Math.max(0, Number(e.target.value)))} />
          <span className="font-display" style={{ color: '#9AA1AC', fontWeight: 700 }}>VS</span>
          <input className="input" type="number" min="0" style={{ width: 54, textAlign: 'center', fontSize: 18, fontWeight: 700 }} value={scoreB} onChange={e => setScoreB(Math.max(0, Number(e.target.value)))} />
          <div style={{ flex: 1 }}><TeamChip team={teamB} /></div>
        </div>
        <div style={{ textAlign: 'center', fontSize: 11, color: '#9AA1AC', marginTop: 8 }}>
          Suma de goleadores registrados: {sumGoals(playersA)} - {sumGoals(playersB)} (puede diferir si hubo autogoles)
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        <div>
          <div className="font-display" style={{ fontSize: 13, fontWeight: 700, color: '#1B2A4D', marginBottom: 4 }}><TeamChip team={teamA} size="sm" /></div>
          {renderPlayerRows(playersA)}
        </div>
        <div>
          <div className="font-display" style={{ fontSize: 13, fontWeight: 700, color: '#1B2A4D', marginBottom: 4 }}><TeamChip team={teamB} size="sm" /></div>
          {renderPlayerRows(playersB)}
        </div>
      </div>

      <div style={{ borderTop: '1px solid #E3E5E9', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 18, paddingTop: 14, flexWrap: 'wrap', gap: 8 }}>
        {confirmDelete
          ? <ConfirmInline text="¿Eliminar este partido?" onConfirm={() => onDelete(match.id)} onCancel={() => setConfirmDelete(false)} />
          : <button className="btn btn-danger btn-sm" onClick={() => setConfirmDelete(true)}><Trash2 size={13} /> Eliminar partido</button>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-outline" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={() => onSave({ scoreA: Number(scoreA), scoreB: Number(scoreB), played: true, playerStats: stats })}>
            <Check size={14} /> Guardar resultado
          </button>
        </div>
      </div>
    </Modal>
  );
}

function SettingsModal({ meta, onClose, onSave, onReset }) {
  const [form, setForm] = useState({ ...meta });
  const [confirmReset, setConfirmReset] = useState(false);
  const setField = (key, val) => setForm(f => ({ ...f, [key]: val }));
  const numField = (key, label) => (
    <div>
      <label className="field-label">{label}</label>
      <input className="input" type="number" value={form[key]} onChange={e => setField(key, Number(e.target.value))} />
    </div>
  );
  return (
    <Modal title="Configuración del torneo" onClose={onClose}>
      <div style={{ marginBottom: 16 }}>
        <label className="field-label">Nombre del torneo</label>
        <input className="input" value={form.name} onChange={e => setField('name', e.target.value)} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        <div>
          <label className="field-label">Categoría / deporte</label>
          <input className="input" value={form.category} onChange={e => setField('category', e.target.value)} placeholder="Ej: Futbolito" />
        </div>
        <div>
          <label className="field-label">Organizador</label>
          <input className="input" value={form.organizerName} onChange={e => setField('organizerName', e.target.value)} placeholder="Nombre del organizador" />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        <div>
          <label className="field-label">Fecha de inicio</label>
          <input className="input" type="date" value={form.startDate} onChange={e => setField('startDate', e.target.value)} />
        </div>
        <div>
          <label className="field-label">Fecha de finalización</label>
          <input className="input" type="date" value={form.endDate} onChange={e => setField('endDate', e.target.value)} />
        </div>
      </div>
      <div style={{ marginBottom: 16 }}>
        <label className="field-label">Acerca de (descripción)</label>
        <textarea className="textarea" value={form.description} onChange={e => setField('description', e.target.value)} rows={3} />
      </div>
      <div style={{ marginBottom: 20 }}>
        <label className="field-label">Reglas del campeonato</label>
        <textarea className="textarea" value={form.rules} onChange={e => setField('rules', e.target.value)} rows={4} placeholder="Formato, duración de partidos, reglas específicas…" />
      </div>

      <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 10 }}>Puntuación y sanciones</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 14 }}>
        {numField('pointsWin', 'Pts. victoria')}
        {numField('pointsDraw', 'Pts. empate')}
        {numField('pointsLoss', 'Pts. derrota')}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
        {numField('yellowLimit', 'Amarillas p/ sanción')}
        {numField('redSuspensionMatches', 'Partidos por roja')}
      </div>

      <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 10 }}>Clasificación</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
        {numField('playoffSpots', 'Cupos a playoffs')}
        {numField('relegationSpots', 'Equipos en zona de alerta')}
      </div>

      <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 10 }}>Acceso</div>
      <div style={{ marginBottom: 20 }}>
        <label className="field-label">Correo del organizador</label>
        <input className="input" type="email" value={form.adminEmail} onChange={e => setField('adminEmail', e.target.value)} placeholder="tucorreo@ejemplo.com" />
        <div style={{ fontSize: 11, color: '#9AA1AC', marginTop: 5 }}>Solo este correo puede iniciar sesión como organizador y editar los datos. Si lo cambias por uno distinto al tuyo, perderás el acceso hasta iniciar sesión con el nuevo correo.</div>
      </div>

      <div style={{ borderTop: '1px solid #E3E5E9', paddingTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        {confirmReset
          ? <ConfirmInline text="Esto borra TODOS los datos ¿continuar?" onConfirm={onReset} onCancel={() => setConfirmReset(false)} />
          : <button className="btn btn-danger btn-sm" onClick={() => setConfirmReset(true)}><Trash2 size={13} /> Reiniciar todos los datos</button>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-outline" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={() => onSave(form)}><Check size={14} /> Guardar</button>
        </div>
      </div>
    </Modal>
  );
}

function LoginModal({ onClose }) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async () => {
    if (!isValidEmail(email)) { setError('Ingresa un correo válido.'); return; }
    setError('');
    setSending(true);
    const { error: err } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    });
    setSending(false);
    if (err) { setError('No se pudo enviar el enlace. Intenta de nuevo en unos minutos.'); return; }
    setSent(true);
  };

  if (sent) {
    return (
      <Modal title="Revisa tu correo" onClose={onClose}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '10px 0 4px' }}>
          <Mail size={30} color="#2E9E4A" style={{ marginBottom: 12 }} />
          <div style={{ fontSize: 13.5, color: '#2A2E35', marginBottom: 6 }}>
            Te enviamos un enlace de acceso a <strong>{email}</strong>.
          </div>
          <div style={{ fontSize: 12.5, color: '#6B7280' }}>Ábrelo desde este mismo dispositivo para iniciar sesión. Puede tardar uno o dos minutos.</div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 18 }}>
          <button className="btn btn-outline" onClick={onClose}>Cerrar</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Hacer login" onClose={onClose}>
      <div style={{ fontSize: 13, color: '#6B7280', marginBottom: 14 }}>
        Escribe tu correo y te enviamos un enlace de acceso — no necesitas contraseña. Quien inicie sesión con el correo registrado como organizador podrá editar los datos del torneo; el resto solo podrá ver.
      </div>
      <div style={{ marginBottom: 14 }}>
        <label className="field-label">Correo</label>
        <input className="input" type="email" value={email} autoFocus placeholder="tucorreo@ejemplo.com"
          onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} />
      </div>
      {error && <div style={{ fontSize: 12, color: '#C4302B', marginBottom: 12 }}>{error}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button className="btn btn-outline" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" disabled={sending} onClick={submit}>
          {sending ? <Loader2 size={14} className="spin" /> : <Send size={14} />} {sending ? 'Enviando…' : 'Enviar enlace de acceso'}
        </button>
      </div>
    </Modal>
  );
}

/* ---------- Panel derecho (partido destacado + estadísticas) ---------- */

function findFeaturedMatch(data) {
  const all = [
    ...data.matches.map(m => ({ ...m, _label: 'Jornada ' + m.jornada })),
    ...data.playoffMatches.map(m => ({ ...m, _label: m.round })),
  ];
  const upcoming = all.filter(m => !m.played);
  if (upcoming.length > 0) return { match: upcoming[0], status: 'pending' };
  const played = all.filter(m => m.played);
  if (played.length > 0) return { match: played[played.length - 1], status: 'done' };
  return null;
}

function MatchWidgetCard({ data }) {
  const featured = findFeaturedMatch(data);
  const teamA = featured ? data.teams.find(t => t.id === featured.match.teamAId) : null;
  const teamB = featured ? data.teams.find(t => t.id === featured.match.teamBId) : null;
  return (
    <div className="card" style={{ overflow: 'hidden', marginBottom: 16 }}>
      <div className="card-header-green">{featured && featured.status === 'pending' ? 'Próximo partido' : 'Último resultado'}</div>
      <div style={{ padding: 18 }}>
        {!featured ? (
          <div style={{ fontSize: 12.5, color: '#9AA1AC', textAlign: 'center', padding: '10px 0' }}>Aún no hay partidos programados.</div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
              <div style={{ textAlign: 'center', flex: 1, minWidth: 0 }}>
                <Crest team={teamA} size="lg" />
                <div style={{ fontSize: 11.5, fontWeight: 600, color: '#1B2A4D', marginTop: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{teamA ? teamA.name : '—'}</div>
              </div>
              <div style={{ textAlign: 'center', flexShrink: 0 }}>
                {featured.status === 'done'
                  ? <div className="font-display" style={{ fontSize: 20, fontWeight: 800, color: '#1B2A4D', border: '1px solid #E3E5E9', borderRadius: 8, padding: '4px 10px' }}>{featured.match.scoreA} : {featured.match.scoreB}</div>
                  : <div style={{ fontSize: 13, fontWeight: 700, color: '#9AA1AC', border: '1px solid #E3E5E9', borderRadius: 8, padding: '8px 12px' }}>VS</div>}
                <div style={{ marginTop: 6 }}>
                  <span className={'status-pill ' + (featured.status === 'done' ? 'done' : 'pending')}>{featured.status === 'done' ? 'Finalizado' : 'Programado'}</span>
                </div>
              </div>
              <div style={{ textAlign: 'center', flex: 1, minWidth: 0 }}>
                <Crest team={teamB} size="lg" />
                <div style={{ fontSize: 11.5, fontWeight: 600, color: '#1B2A4D', marginTop: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{teamB ? teamB.name : '—'}</div>
              </div>
            </div>
            <div style={{ textAlign: 'center', fontSize: 11.5, color: '#9AA1AC', marginTop: 14, borderTop: '1px solid #EEF0F2', paddingTop: 10 }}>
              {featured.match._label}{featured.match.date ? ' · ' + formatDate(featured.match.date) : ''}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function StatsWidgetCard({ data }) {
  const allPlayed = [...data.matches, ...data.playoffMatches].filter(m => m.played);
  const totalGoals = allPlayed.reduce((a, m) => a + m.scoreA + m.scoreB, 0);
  const withStats = data.players.map(p => ({ p, stats: getPlayerStats(p.id, data) }));
  const top3 = [...withStats].filter(x => x.stats.goals > 0).sort((a, b) => b.stats.goals - a.stats.goals).slice(0, 3);
  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div className="card-header-green">Estadísticas del torneo</div>
      <div style={{ padding: 18 }}>
        <div style={{ display: 'flex', gap: 20, justifyContent: 'center', marginBottom: 16 }}>
          <div style={{ textAlign: 'center' }}>
            <div className="stat-circle">{allPlayed.length}</div>
            <div style={{ fontSize: 10.5, color: '#6B7280', marginTop: 6, fontWeight: 700 }}>PARTIDOS</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div className="stat-circle">{totalGoals}</div>
            <div style={{ fontSize: 10.5, color: '#6B7280', marginTop: 6, fontWeight: 700 }}>GOLES</div>
          </div>
        </div>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>Goleadores</div>
        {top3.length === 0
          ? <div style={{ fontSize: 12, color: '#9AA1AC' }}>Sin goles registrados todavía.</div>
          : top3.map(({ p, stats }) => {
            const team = data.teams.find(t => t.id === p.teamId);
            return (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #F0F1F3' }}>
                <Avatar size={26} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: '#1B2A4D', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                  <div style={{ fontSize: 10.5, color: '#9AA1AC' }}>{team ? team.name : ''}</div>
                </div>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#2E9E4A' }}>{stats.goals}</div>
              </div>
            );
          })}
      </div>
    </div>
  );
}

function RightColumn({ data }) {
  return (
    <div>
      <MatchWidgetCard data={data} />
      <StatsWidgetCard data={data} />
    </div>
  );
}

/* ---------- Barra lateral ---------- */

const NAV_ITEMS = [
  { id: 'inicio', label: 'Inicio', Icon: Home },
  { id: 'tabla', label: 'Clasificación', Icon: Table2 },
  { id: 'equipos', label: 'Equipos', Icon: Users },
  { id: 'jugadores', label: 'Jugadores', Icon: User },
  { id: 'partidos', label: 'Partidos', Icon: Calendar },
  { id: 'playoffs', label: 'Playoffs', Icon: Award },
  { id: 'sanciones', label: 'Sanciones', Icon: ShieldAlert },
  { id: 'stats', label: 'Rankings', Icon: BarChart3 },
];

function Sidebar({ tab, setTab, isAdmin, sessionEmail, canClaim, onOpenSettings, onLogout, onLoginClick, onClaim, tournamentName }) {
  return (
    <div className="sidebar">
      <div className="sidebar-logo-row">
        <div className="sidebar-logo-badge"><Trophy size={19} color="#fff" /></div>
        <div className="sidebar-title">{tournamentName}</div>
      </div>
      <div className="sidebar-nav">
        {NAV_ITEMS.map(({ id, label, Icon }) => (
          <button key={id} className={'sidebar-nav-item' + (tab === id ? ' active' : '')} onClick={() => setTab(id)}>
            <Icon size={16} /> {label}
          </button>
        ))}
      </div>
      <div className="sidebar-footer">
        {isAdmin && <button className="sidebar-footer-link" onClick={onOpenSettings}><Settings size={14} /> Configuración</button>}
        {canClaim && (
          <button className="sidebar-footer-link" style={{ background: 'rgba(255,255,255,.14)' }} onClick={onClaim}>
            <ShieldAlert size={14} /> Registrarme como organizador
          </button>
        )}
        {sessionEmail && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', color: 'rgba(255,255,255,.7)', fontSize: 11.5, overflow: 'hidden' }}>
            <Mail size={12} style={{ flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sessionEmail}</span>
          </div>
        )}
        <button className="sidebar-footer-link" onClick={sessionEmail ? onLogout : onLoginClick}>
          {sessionEmail ? <LogOut size={14} /> : <LogIn size={14} />} {sessionEmail ? 'Cerrar sesión' : 'Hacer login'}
        </button>
      </div>
    </div>
  );
}

/* ---------- App principal ---------- */

const TOURNAMENT_ROW_ID = 1;

export default function FutbolitoApp() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('inicio');
  const [saveError, setSaveError] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [session, setSession] = useState(null);
  const [loginOpen, setLoginOpen] = useState(false);

  // Carga inicial de datos + sesión, y suscripción a cambios en vivo.
  useEffect(() => {
    let channel;

    (async () => {
      const { data: row, error } = await supabase
        .from('tournament_data')
        .select('data')
        .eq('id', TOURNAMENT_ROW_ID)
        .maybeSingle();

      setData(!error && row ? row.data : defaultData());

      const { data: sessionData } = await supabase.auth.getSession();
      setSession(sessionData.session);
      setLoading(false);
    })();

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    channel = supabase
      .channel('tournament_data_changes')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tournament_data', filter: `id=eq.${TOURNAMENT_ROW_ID}` },
        (payload) => { if (payload.new && payload.new.data) setData(payload.new.data); })
      .subscribe();

    return () => {
      authListener.subscription.unsubscribe();
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  const persist = useCallback(async (next) => {
    const { error } = await supabase.from('tournament_data').update({ data: next }).eq('id', TOURNAMENT_ROW_ID);
    if (error) {
      setSaveError('No se pudo guardar el último cambio. Revisa tu conexión.');
      setTimeout(() => setSaveError(''), 3500);
    }
  }, []);

  const update = useCallback((updater) => {
    setData(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      persist(next);
      return next;
    });
  }, [persist]);

  const sessionEmail = session?.user?.email || '';
  const isAdmin = !!(sessionEmail && data && data.meta.adminEmail && sessionEmail.toLowerCase() === data.meta.adminEmail.toLowerCase());
  const canClaim = !!(sessionEmail && data && !data.meta.adminEmail);

  const claimAdmin = () => update(d => ({ ...d, meta: { ...d.meta, adminEmail: sessionEmail } }));
  const logoutSession = () => supabase.auth.signOut();

  if (loading || !data) {
    return (
      <div className="futbolito-app" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <GlobalStyles />
        <div style={{ textAlign: 'center', color: '#6B7280' }}>
          <Loader2 className="spin" size={26} style={{ margin: '0 auto 10px' }} />
          Cargando campeonato…
        </div>
      </div>
    );
  }

  const addTeam = (payload) => update(d => ({ ...d, teams: [...d.teams, { id: uid('team'), ...payload }] }));
  const editTeam = (id, payload) => update(d => ({ ...d, teams: d.teams.map(t => t.id === id ? { ...t, ...payload } : t) }));
  const deleteTeam = (id) => update(d => ({
    ...d,
    teams: d.teams.filter(t => t.id !== id),
    players: d.players.filter(p => p.teamId !== id),
    matches: d.matches.filter(m => m.teamAId !== id && m.teamBId !== id),
    playoffMatches: d.playoffMatches.filter(m => m.teamAId !== id && m.teamBId !== id),
  }));

  const addPlayer = (payload) => update(d => ({ ...d, players: [...d.players, { id: uid('player'), servedSuspensions: 0, ...payload }] }));
  const editPlayer = (id, payload) => update(d => ({ ...d, players: d.players.map(p => p.id === id ? { ...p, ...payload } : p) }));
  const deletePlayer = (id) => update(d => ({ ...d, players: d.players.filter(p => p.id !== id) }));
  const markSuspensionServed = (id) => update(d => ({ ...d, players: d.players.map(p => p.id === id ? { ...p, servedSuspensions: (p.servedSuspensions || 0) + 1 } : p) }));

  const addMatch = (phase, payload) => update(d => {
    const match = { id: uid('match'), phase, played: false, scoreA: 0, scoreB: 0, playerStats: {}, ...payload };
    return phase === 'liga' ? { ...d, matches: [...d.matches, match] } : { ...d, playoffMatches: [...d.playoffMatches, match] };
  });
  const saveMatchResult = (phase, id, payload) => update(d => {
    const key = phase === 'liga' ? 'matches' : 'playoffMatches';
    return { ...d, [key]: d[key].map(m => m.id === id ? { ...m, ...payload } : m) };
  });
  const deleteMatch = (phase, id) => update(d => {
    const key = phase === 'liga' ? 'matches' : 'playoffMatches';
    return { ...d, [key]: d[key].filter(m => m.id !== id) };
  });
  const generateFixture = () => update(d => {
    const fixture = generateRoundRobin(d.teams.map(t => t.id)).map(f => ({
      id: uid('match'), phase: 'liga', played: false, scoreA: 0, scoreB: 0, playerStats: {}, date: '', ...f,
    }));
    return { ...d, matches: fixture };
  });

  const saveSettings = (meta) => { update(d => ({ ...d, meta })); setSettingsOpen(false); };
  const resetAll = () => { update(() => defaultData()); setSettingsOpen(false); };

  const standings = computeStandings(data);

  return (
    <div className="futbolito-app" style={{ minHeight: '100vh' }}>
      <GlobalStyles />
      <div className="app-shell">
        <Sidebar tab={tab} setTab={setTab} isAdmin={isAdmin} sessionEmail={sessionEmail} canClaim={canClaim}
          onOpenSettings={() => setSettingsOpen(true)}
          onLogout={logoutSession}
          onLoginClick={() => setLoginOpen(true)}
          onClaim={claimAdmin}
          tournamentName={data.meta.name} />

        <div className="main-area">
          <div className="page-header">
            <div className="page-title">{data.meta.name}</div>
            <div className="page-subtitle">{data.meta.category || 'Futbolito'}</div>
          </div>

          {saveError && (
            <div style={{ marginBottom: 16, padding: '10px 14px', background: '#FDEEEE', border: '1px solid #F1C9C7', borderRadius: 8, fontSize: 12, color: '#C4302B', display: 'flex', gap: 6, alignItems: 'center' }}>
              <AlertTriangle size={13} /> {saveError}
            </div>
          )}

          {tab === 'inicio' && <InicioTab data={data} isAdmin={isAdmin} onNavigate={setTab} />}

          {tab === 'tabla' && (
            <div className="two-col" style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 20, alignItems: 'start' }}>
              <TablaTab data={data} standings={standings} />
              <RightColumn data={data} />
            </div>
          )}

          {tab === 'equipos' && <EquiposTab data={data} isAdmin={isAdmin} onAdd={addTeam} onEdit={editTeam} onDelete={deleteTeam} standings={standings} />}
          {tab === 'jugadores' && <JugadoresTab data={data} isAdmin={isAdmin} onAdd={addPlayer} onEdit={editPlayer} onDelete={deletePlayer} />}
          {tab === 'partidos' && <PartidosTab data={data} isAdmin={isAdmin} onAddMatch={(p) => addMatch('liga', p)} onGenerateFixture={generateFixture}
            onSaveResult={(id, payload) => saveMatchResult('liga', id, payload)} onDeleteMatch={(id) => deleteMatch('liga', id)} />}
          {tab === 'playoffs' && <PlayoffsTab data={data} isAdmin={isAdmin} onAddMatch={(p) => addMatch('playoff', p)}
            onSaveResult={(id, payload) => saveMatchResult('playoff', id, payload)} onDeleteMatch={(id) => deleteMatch('playoff', id)} />}
          {tab === 'sanciones' && <SancionesTab data={data} isAdmin={isAdmin} onMarkServed={markSuspensionServed} />}

          {tab === 'stats' && (
            <div className="two-col" style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 20, alignItems: 'start' }}>
              <StatsTab data={data} standings={standings} />
              <RightColumn data={data} />
            </div>
          )}
        </div>
      </div>

      {settingsOpen && isAdmin && <SettingsModal meta={data.meta} onClose={() => setSettingsOpen(false)} onSave={saveSettings} onReset={resetAll} />}
      {loginOpen && <LoginModal onClose={() => setLoginOpen(false)} />}
    </div>
  );
}

/* ---------- Tabs ---------- */

function QuickStat({ label, value, isText, onClick }) {
  return (
    <button onClick={onClick} className="card" style={{ padding: '16px 18px', textAlign: 'left', cursor: 'pointer', width: '100%' }}>
      <div style={{ fontSize: 10.5, color: '#6B7280', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
      <div className="font-display" style={{ fontSize: isText ? 15 : 23, fontWeight: 800, color: '#1B2A4D', marginTop: 4 }}>{value}</div>
    </button>
  );
}

function InicioTab({ data, isAdmin, onNavigate }) {
  const [rulesOpen, setRulesOpen] = useState(false);
  return (
    <div>
      <div className="info-strip" style={{ marginBottom: 20 }}>
        <div className="info-strip-item">
          <div className="lbl">Inicio</div>
          <div className="val">{formatDate(data.meta.startDate) || 'Por definir'}</div>
        </div>
        <div className="info-strip-item">
          <div className="lbl">Finalización</div>
          <div className="val">{formatDate(data.meta.endDate) || 'Por definir'}</div>
        </div>
        <div className="info-strip-item">
          <div className="lbl">Organizador</div>
          <div className="val">{data.meta.organizerName || 'Por definir'}</div>
        </div>
        <div style={{ flex: 1 }} />
        <button className="btn btn-outline btn-sm" onClick={() => setRulesOpen(true)}><FileText size={13} /> Reglas del campeonato</button>
      </div>

      <div style={{ position: 'relative', height: 190, borderRadius: 12, overflow: 'hidden', marginBottom: 20, background: '#1B2A4D' }}>
        <div style={{ position: 'absolute', inset: 0, background: '#2E9E4A', clipPath: 'polygon(38% 0, 100% 0, 68% 100%, 0 100%)' }} />
        <Trophy size={130} color="rgba(255,255,255,.08)" style={{ position: 'absolute', right: 18, bottom: -16 }} />
        <div style={{ position: 'relative', zIndex: 1, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 34px' }}>
          <div className="font-display" style={{ fontWeight: 800, fontSize: 28, color: '#fff', lineHeight: 1.1, maxWidth: 420 }}>{data.meta.name}</div>
          <div style={{ fontWeight: 700, fontSize: 12.5, color: 'rgba(255,255,255,.85)', marginTop: 8, textTransform: 'uppercase', letterSpacing: '.08em' }}>{data.meta.category || 'Futbolito'}</div>
        </div>
      </div>

      <div className="card" style={{ padding: 20, marginBottom: 20 }}>
        <div className="font-display" style={{ fontWeight: 700, fontSize: 16, color: '#1B2A4D', marginBottom: 8 }}>Acerca de</div>
        <div style={{ fontSize: 13.5, color: '#4A4F58', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
          {data.meta.description || 'Todavía no hay una descripción del torneo.'}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12 }}>
        <QuickStat label="Equipos" value={data.teams.length} onClick={() => onNavigate('equipos')} />
        <QuickStat label="Jugadores" value={data.players.length} onClick={() => onNavigate('jugadores')} />
        <QuickStat label="Partidos" value={data.matches.length + data.playoffMatches.length} onClick={() => onNavigate('partidos')} />
        <QuickStat label="Clasificación" value="Ver tabla" isText onClick={() => onNavigate('tabla')} />
      </div>

      {rulesOpen && (
        <Modal title="Reglas del campeonato" onClose={() => setRulesOpen(false)}>
          {data.meta.rules
            ? <div style={{ fontSize: 13.5, color: '#2A2E35', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{data.meta.rules}</div>
            : <div style={{ fontSize: 13, color: '#6B7280' }}>{isAdmin ? 'Todavía no agregaste las reglas. Puedes escribirlas en Configuración.' : 'El organizador todavía no publicó las reglas del campeonato.'}</div>}
        </Modal>
      )}
    </div>
  );
}

function TablaTab({ data, standings }) {
  if (data.teams.length === 0) {
    return <EmptyState Icon={Table2} title="Todavía no hay tabla" text="Agrega equipos en la pestaña Equipos para que la tabla de posiciones empiece a calcularse automáticamente." />;
  }
  const relegation = data.meta.relegationSpots || 0;
  const n = standings.length;
  return (
    <div>
      <div className="card" style={{ overflowX: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr style={{ borderBottom: '1px solid #E3E5E9' }}>
              <th>#</th><th style={{ textAlign: 'left' }}>Equipo</th><th>Pts</th><th>PJ</th><th>PG</th><th>PE</th><th>PP</th><th>GF</th><th>GC</th><th>DIF</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((row, i) => {
              const team = data.teams.find(t => t.id === row.teamId);
              const qualifies = i < (data.meta.playoffSpots || 0);
              const relegated = relegation > 0 && i >= n - relegation;
              return (
                <tr key={row.teamId}
                  className={(i % 2 === 1 ? 'row-alt ' : '') + (qualifies ? 'zone-top' : relegated ? 'zone-bottom' : '')}
                  style={{ borderBottom: '1px solid #EEF0F2' }}>
                  <td>{i + 1}</td>
                  <td className="team-name-cell"><TeamChip team={team} size="sm" /></td>
                  <td style={{ color: '#2E9E4A', fontWeight: 800 }}>{row.pts}</td>
                  <td>{row.pj}</td><td>{row.pg}</td><td>{row.pe}</td><td>{row.pp}</td>
                  <td>{row.gf}</td><td>{row.gc}</td><td>{row.dg > 0 ? '+' + row.dg : row.dg}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', gap: 18, marginTop: 10, flexWrap: 'wrap' }}>
        {data.meta.playoffSpots > 0 && (
          <div style={{ fontSize: 11.5, color: '#6B7280', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 10, background: '#2E9E4A', borderRadius: 3 }} /> Clasifica a playoffs
          </div>
        )}
        {relegation > 0 && (
          <div style={{ fontSize: 11.5, color: '#6B7280', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 10, background: '#E5484D', borderRadius: 3 }} /> Zona de alerta
          </div>
        )}
      </div>
    </div>
  );
}

function EquiposTab({ data, isAdmin, onAdd, onEdit, onDelete, standings }) {
  const [modal, setModal] = useState(null);
  const [confirmId, setConfirmId] = useState(null);

  return (
    <div>
      {isAdmin && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
          <button className="btn btn-primary" onClick={() => setModal('new')}><Plus size={14} /> Agregar equipo</button>
        </div>
      )}

      {data.teams.length === 0
        ? <EmptyState Icon={Users} title="Sin equipos todavía" text="Agrega el primer equipo del campeonato para empezar a registrar jugadores y partidos." />
        : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 12 }}>
            {data.teams.map(team => {
              const row = standings.find(s => s.teamId === team.id);
              const playerCount = data.players.filter(p => p.teamId === team.id).length;
              return (
                <div key={team.id} className="card" style={{ padding: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                      <Crest team={team} />
                      <div className="font-display" style={{ fontWeight: 700, fontSize: 15, color: '#1B2A4D', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{team.name}</div>
                    </div>
                    {isAdmin && (
                      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                        <button className="icon-btn" onClick={() => setModal(team.id)}><Pencil size={13} /></button>
                        {confirmId !== team.id && <button className="icon-btn" onClick={() => setConfirmId(team.id)}><Trash2 size={13} /></button>}
                      </div>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: '#6B7280', marginTop: 10 }}>{playerCount} jugador{playerCount !== 1 ? 'es' : ''}</div>
                  {row && (
                    <div style={{ fontSize: 12, color: '#4A4F58', marginTop: 6, fontWeight: 600 }}>
                      {row.pj} PJ · {row.pts} PTS · DIF {row.dg > 0 ? '+' + row.dg : row.dg}
                    </div>
                  )}
                  {isAdmin && confirmId === team.id && (
                    <div style={{ marginTop: 10 }}>
                      <ConfirmInline text="¿Eliminar equipo, jugadores y partidos?" onConfirm={() => { onDelete(team.id); setConfirmId(null); }} onCancel={() => setConfirmId(null)} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

      {isAdmin && modal === 'new' && <TeamFormModal onClose={() => setModal(null)} onSave={(p) => { onAdd(p); setModal(null); }} />}
      {isAdmin && modal && modal !== 'new' && (
        <TeamFormModal initial={data.teams.find(t => t.id === modal)} onClose={() => setModal(null)} onSave={(p) => { onEdit(modal, p); setModal(null); }} />
      )}
    </div>
  );
}

function JugadoresTab({ data, isAdmin, onAdd, onEdit, onDelete }) {
  const [modal, setModal] = useState(null);
  const [filterTeam, setFilterTeam] = useState('all');
  const [confirmId, setConfirmId] = useState(null);

  const filtered = data.players.filter(p => filterTeam === 'all' || p.teamId === filterTeam);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <select className="input" style={{ width: 200 }} value={filterTeam} onChange={e => setFilterTeam(e.target.value)}>
          <option value="all">Todos los equipos</option>
          {data.teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        {isAdmin && <button className="btn btn-primary" disabled={data.teams.length === 0} onClick={() => setModal('new')}><Plus size={14} /> Agregar jugador</button>}
      </div>

      {data.teams.length === 0 && <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 12 }}>Crea al menos un equipo antes de registrar jugadores.</div>}

      {filtered.length === 0
        ? <EmptyState Icon={User} title="Sin jugadores" text="Agrega jugadores y asígnalos a un equipo para llevar sus goles y tarjetas." />
        : (
          <div className="card" style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead><tr style={{ borderBottom: '1px solid #E3E5E9' }}><th style={{ textAlign: 'left' }}>Jugador</th><th>#</th><th style={{ textAlign: 'left' }}>Equipo</th><th>Posición</th>{isAdmin && <th></th>}</tr></thead>
              <tbody>
                {filtered.map((p, idx) => {
                  const team = data.teams.find(t => t.id === p.teamId);
                  return (
                    <tr key={p.id} className={idx % 2 === 1 ? 'row-alt' : ''} style={{ borderBottom: '1px solid #EEF0F2' }}>
                      <td className="team-name-cell">
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Avatar size={26} />{p.name}</span>
                      </td>
                      <td>{p.number !== '' && p.number !== undefined ? p.number : '—'}</td>
                      <td style={{ textAlign: 'left' }}><TeamChip team={team} size="sm" /></td>
                      <td style={{ color: '#6B7280' }}>{p.position}</td>
                      {isAdmin && (
                        <td>
                          {confirmId === p.id
                            ? <ConfirmInline text="¿Eliminar?" onConfirm={() => { onDelete(p.id); setConfirmId(null); }} onCancel={() => setConfirmId(null)} />
                            : (
                              <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                                <button className="icon-btn" onClick={() => setModal(p.id)}><Pencil size={13} /></button>
                                <button className="icon-btn" onClick={() => setConfirmId(p.id)}><Trash2 size={13} /></button>
                              </div>
                            )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

      {isAdmin && modal === 'new' && <PlayerFormModal teams={data.teams} defaultTeamId={filterTeam !== 'all' ? filterTeam : undefined} onClose={() => setModal(null)} onSave={(p) => { onAdd(p); setModal(null); }} />}
      {isAdmin && modal && modal !== 'new' && (
        <PlayerFormModal teams={data.teams} initial={data.players.find(p => p.id === modal)} onClose={() => setModal(null)} onSave={(p) => { onEdit(modal, p); setModal(null); }} />
      )}
    </div>
  );
}

function MatchList({ matches, teams, groupByJornada, clickable, onOpenResult }) {
  if (matches.length === 0) return null;
  if (!groupByJornada) {
    return (
      <div className="card">
        {matches.map((m, idx) => <MatchRow key={m.id} m={m} teams={teams} clickable={clickable} onOpen={() => onOpenResult(m)} last={idx === matches.length - 1} />)}
      </div>
    );
  }
  const jornadas = [...new Set(matches.map(m => m.jornada))].sort((a, b) => a - b);
  return jornadas.map(j => (
    <div key={j} style={{ marginBottom: 16 }}>
      <div className="font-display" style={{ fontSize: 13, fontWeight: 700, color: '#6B7280', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.03em' }}>Jornada {j}</div>
      <div className="card">
        {matches.filter(m => m.jornada === j).map((m, idx, arr) => <MatchRow key={m.id} m={m} teams={teams} clickable={clickable} onOpen={() => onOpenResult(m)} last={idx === arr.length - 1} />)}
      </div>
    </div>
  ));
}

function MatchRow({ m, teams, onOpen, last, clickable }) {
  const teamA = teams.find(t => t.id === m.teamAId);
  const teamB = teams.find(t => t.id === m.teamBId);
  const isClickable = clickable !== false;
  return (
    <div onClick={isClickable ? onOpen : undefined}
      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', cursor: isClickable ? 'pointer' : 'default', borderBottom: last ? 'none' : '1px solid #EEF0F2' }}>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end', minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#1B2A4D', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{teamA ? teamA.name : 'Equipo eliminado'}</span>
        <Crest team={teamA} size="sm" />
      </div>
      <div style={{ minWidth: 64, textAlign: 'center', flexShrink: 0 }}>
        <div className="font-display" style={{ fontWeight: 800, fontSize: 14, color: m.played ? '#1B2A4D' : '#B9BEC6' }}>
          {m.played ? m.scoreA + ' - ' + m.scoreB : 'vs'}
        </div>
        <span className={'status-pill ' + (m.played ? 'done' : 'pending')} style={{ marginTop: 2 }}>{m.played ? 'Finalizado' : 'Pendiente'}</span>
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <Crest team={teamB} size="sm" />
        <span style={{ fontSize: 13, fontWeight: 600, color: '#1B2A4D', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{teamB ? teamB.name : 'Equipo eliminado'}</span>
      </div>
      {m.date && <div style={{ fontSize: 11, color: '#9AA1AC', width: 80, textAlign: 'right', flexShrink: 0 }}>{formatDate(m.date)}</div>}
    </div>
  );
}

function PartidosTab({ data, isAdmin, onAddMatch, onGenerateFixture, onSaveResult, onDeleteMatch }) {
  const [modal, setModal] = useState(null);
  const [confirmGenerate, setConfirmGenerate] = useState(false);
  const openMatch = isAdmin ? data.matches.find(m => m.id === modal) : null;
  const maxJornada = data.matches.reduce((mx, m) => Math.max(mx, m.jornada || 0), 0);

  return (
    <div>
      {isAdmin && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
          <div>
            {data.teams.length >= 2 && (
              confirmGenerate
                ? <ConfirmInline text={data.matches.length > 0 ? 'Esto borra el fixture actual ¿continuar?' : '¿Generar fixture todos-contra-todos?'} onConfirm={() => { onGenerateFixture(); setConfirmGenerate(false); }} onCancel={() => setConfirmGenerate(false)} />
                : <button className="btn btn-outline" onClick={() => setConfirmGenerate(true)}><Calendar size={14} /> {data.matches.length > 0 ? 'Regenerar fixture' : 'Generar fixture (todos vs todos)'}</button>
            )}
          </div>
          <button className="btn btn-primary" disabled={data.teams.length < 2} onClick={() => setModal('new')}><Plus size={14} /> Agregar partido manual</button>
        </div>
      )}

      {data.teams.length < 2 && <EmptyState Icon={Calendar} title="Faltan equipos" text="Necesitas al menos dos equipos para generar el fixture o agregar partidos." />}

      {data.teams.length >= 2 && data.matches.length === 0 && (
        <EmptyState Icon={Calendar} title="Todavía no hay partidos" text={isAdmin ? 'Genera el fixture automático de liga o agrega partidos manualmente.' : 'El organizador todavía no publicó el fixture.'} />
      )}

      {data.matches.length > 0 && <MatchList matches={data.matches} teams={data.teams} groupByJornada clickable={isAdmin} onOpenResult={(m) => setModal(m.id)} />}

      {isAdmin && modal === 'new' && (
        <MatchFormModal teams={data.teams} phase="liga" suggestedJornada={maxJornada + 1 || 1}
          onClose={() => setModal(null)} onSave={(p) => { onAddMatch(p); setModal(null); }} />
      )}
      {isAdmin && openMatch && (
        <MatchResultModal match={openMatch} teams={data.teams} players={data.players}
          onClose={() => setModal(null)}
          onSave={(payload) => { onSaveResult(openMatch.id, payload); setModal(null); }}
          onDelete={(id) => { onDeleteMatch(id); setModal(null); }} />
      )}
    </div>
  );
}

function PlayoffsTab({ data, isAdmin, onAddMatch, onSaveResult, onDeleteMatch }) {
  const [modal, setModal] = useState(null);
  const openMatch = isAdmin ? data.playoffMatches.find(m => m.id === modal) : null;

  return (
    <div>
      {isAdmin && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
          <button className="btn btn-primary" disabled={data.teams.length < 2} onClick={() => setModal('new')}><Plus size={14} /> Agregar partido de playoffs</button>
        </div>
      )}

      {data.teams.length < 2 && <EmptyState Icon={Award} title="Faltan equipos" text="Registra equipos antes de armar el cuadro de playoffs." />}
      {data.teams.length >= 2 && data.playoffMatches.length === 0 && (
        <EmptyState Icon={Award} title="Aún no hay cuadro de playoffs" text={isAdmin ? 'Cuando termine la fase de liga, agrega aquí semifinales, final y demás cruces.' : 'El organizador todavía no publicó el cuadro de playoffs.'} />
      )}

      {['Cuartos de Final', 'Semifinal', 'Tercer Puesto', 'Final'].concat(
        [...new Set(data.playoffMatches.map(m => m.round))].filter(r => !['Cuartos de Final', 'Semifinal', 'Tercer Puesto', 'Final'].includes(r))
      ).map(round => {
        const matches = data.playoffMatches.filter(m => m.round === round);
        if (matches.length === 0) return null;
        return (
          <div key={round} style={{ marginBottom: 16 }}>
            <div className="font-display" style={{ fontSize: 13, fontWeight: 700, color: '#6B7280', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.03em' }}>{round}</div>
            <div className="card">
              {matches.map((m, idx) => <MatchRow key={m.id} m={m} teams={data.teams} clickable={isAdmin} onOpen={() => setModal(m.id)} last={idx === matches.length - 1} />)}
            </div>
          </div>
        );
      })}

      {isAdmin && modal === 'new' && (
        <MatchFormModal teams={data.teams} phase="playoff" onClose={() => setModal(null)} onSave={(p) => { onAddMatch(p); setModal(null); }} />
      )}
      {isAdmin && openMatch && (
        <MatchResultModal match={openMatch} teams={data.teams} players={data.players}
          onClose={() => setModal(null)}
          onSave={(payload) => { onSaveResult(openMatch.id, payload); setModal(null); }}
          onDelete={(id) => { onDeleteMatch(id); setModal(null); }} />
      )}
    </div>
  );
}

function SancionesTab({ data, isAdmin, onMarkServed }) {
  const withStats = data.players.map(p => ({ p, stats: getPlayerStats(p.id, data) }));
  const suspended = withStats.filter(x => x.stats.pending > 0).sort((a, b) => b.stats.pending - a.stats.pending);
  const warning = withStats.filter(x => x.stats.pending === 0 && x.stats.yellowSinceReset === x.stats.yellowLimit - 1 && x.stats.yellowLimit > 1);

  return (
    <div>
      <div style={{ background: '#EAF7EE', border: '1px solid #D3EFDA', borderRadius: 10, padding: 14, fontSize: 12.5, color: '#2E6B3E', marginBottom: 20, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <ShieldAlert size={16} style={{ flexShrink: 0, marginTop: 1 }} color="#2E9E4A" />
        <span>Un jugador queda suspendido automáticamente al acumular {data.meta.yellowLimit} amarillas (el conteo se reinicia después) o al recibir 1 tarjeta roja ({data.meta.redSuspensionMatches} partido{data.meta.redSuspensionMatches !== 1 ? 's' : ''} de sanción). Marca "cumplido" cuando el jugador ya se perdió ese encuentro.</span>
      </div>

      <div className="font-display" style={{ fontSize: 15, fontWeight: 700, color: '#1B2A4D', marginBottom: 8 }}>Jugadores suspendidos</div>
      {suspended.length === 0
        ? <div style={{ fontSize: 13, color: '#9AA1AC', marginBottom: 24 }}>No hay jugadores suspendidos actualmente.</div>
        : (
          <div className="card" style={{ marginBottom: 24 }}>
            {suspended.map(({ p, stats }, idx) => {
              const team = data.teams.find(t => t.id === p.teamId);
              return (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', flexWrap: 'wrap', borderBottom: idx === suspended.length - 1 ? 'none' : '1px solid #EEF0F2' }}>
                  <Avatar size={30} />
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: '#1B2A4D' }}>{p.name}</div>
                    <div style={{ fontSize: 11 }}><TeamChip team={team} size="sm" /></div>
                  </div>
                  <CardBadge yellow={stats.yellow} red={stats.red} />
                  <div style={{ fontSize: 12, color: '#C4302B', fontWeight: 700, minWidth: 130, textAlign: 'center' }}>
                    {stats.pending} partido{stats.pending !== 1 ? 's' : ''} pendiente{stats.pending !== 1 ? 's' : ''}
                  </div>
                  {isAdmin && <button className="btn btn-outline btn-sm" onClick={() => onMarkServed(p.id)}>Marcar cumplido</button>}
                </div>
              );
            })}
          </div>
        )}

      <div className="font-display" style={{ fontSize: 15, fontWeight: 700, color: '#1B2A4D', marginBottom: 8 }}>A una amarilla de la sanción</div>
      {warning.length === 0
        ? <div style={{ fontSize: 13, color: '#9AA1AC' }}>Nadie está en riesgo por acumulación de amarillas.</div>
        : (
          <div className="card">
            {warning.map(({ p, stats }, idx) => {
              const team = data.teams.find(t => t.id === p.teamId);
              return (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: idx === warning.length - 1 ? 'none' : '1px solid #EEF0F2' }}>
                  <Avatar size={30} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: '#1B2A4D' }}>{p.name}</div>
                    <div style={{ fontSize: 11 }}><TeamChip team={team} size="sm" /></div>
                  </div>
                  <div style={{ fontSize: 12, color: '#B8860B', fontWeight: 700 }}>{stats.yellowSinceReset} / {stats.yellowLimit} amarillas</div>
                </div>
              );
            })}
          </div>
        )}
    </div>
  );
}

function StatsTab({ data, standings }) {
  const withStats = data.players.map(p => ({ p, stats: getPlayerStats(p.id, data) }));
  const topScorers = [...withStats].filter(x => x.stats.goals > 0).sort((a, b) => b.stats.goals - a.stats.goals).slice(0, 10);
  const topYellow = [...withStats].filter(x => x.stats.yellow > 0).sort((a, b) => b.stats.yellow - a.stats.yellow).slice(0, 10);
  const topRed = [...withStats].filter(x => x.stats.red > 0).sort((a, b) => b.stats.red - a.stats.red).slice(0, 10);

  const bestAttack = [...standings].sort((a, b) => b.gf - a.gf)[0];
  const bestDefense = [...standings].filter(s => s.pj > 0).sort((a, b) => a.gc - b.gc)[0];

  const ranking = (list, valueKey, label, cardType) => (
    <div className="card" style={{ padding: 16 }}>
      <div className="font-display" style={{ fontSize: 14, fontWeight: 700, color: '#1B2A4D', marginBottom: 10 }}>{label}</div>
      {list.length === 0 ? <div style={{ fontSize: 12, color: '#9AA1AC' }}>Sin datos todavía.</div> : list.map(({ p, stats }, i) => {
        const team = data.teams.find(t => t.id === p.teamId);
        return (
          <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: '1px solid #EEF0F2' }}>
            <span style={{ width: 16, fontSize: 12, color: '#9AA1AC', fontWeight: 700, flexShrink: 0 }}>{i + 1}</span>
            <Avatar size={26} />
            <span style={{ flex: 1, fontSize: 12.5, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <span style={{ color: '#1B2A4D', fontWeight: 600 }}>{p.name}</span>{' '}
              <span style={{ color: '#9AA1AC', fontSize: 11 }}>{team ? team.name : ''}</span>
            </span>
            {cardType && <CardBadge yellow={cardType === 'yellow' ? stats[valueKey] : 0} red={cardType === 'red' ? stats[valueKey] : 0} />}
            <span style={{ fontWeight: 800, color: '#2E9E4A', fontSize: 13 }}>{stats[valueKey]}</span>
          </div>
        );
      })}
    </div>
  );

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px,1fr))', gap: 12, marginBottom: 20 }}>
        <div className="card" style={{ padding: 16, textAlign: 'center' }}>
          <div style={{ fontSize: 10.5, color: '#6B7280', fontWeight: 700, textTransform: 'uppercase' }}>Mejor ataque</div>
          <div className="font-display" style={{ fontSize: 16, fontWeight: 800, color: '#1B2A4D', marginTop: 4 }}>{bestAttack ? teamName(data.teams, bestAttack.teamId) : '—'}</div>
          <div style={{ color: '#2E9E4A', fontWeight: 700, fontSize: 13 }}>{bestAttack ? bestAttack.gf + ' goles' : ''}</div>
        </div>
        <div className="card" style={{ padding: 16, textAlign: 'center' }}>
          <div style={{ fontSize: 10.5, color: '#6B7280', fontWeight: 700, textTransform: 'uppercase' }}>Mejor defensa</div>
          <div className="font-display" style={{ fontSize: 16, fontWeight: 800, color: '#1B2A4D', marginTop: 4 }}>{bestDefense ? teamName(data.teams, bestDefense.teamId) : '—'}</div>
          <div style={{ color: '#2E9E4A', fontWeight: 700, fontSize: 13 }}>{bestDefense ? bestDefense.gc + ' recibidos' : ''}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px,1fr))', gap: 16 }}>
        {ranking(topScorers, 'goals', 'Goleadores')}
        {ranking(topYellow, 'yellow', 'Más amarillas', 'yellow')}
        {ranking(topRed, 'red', 'Más rojas', 'red')}
      </div>
    </div>
  );
}
