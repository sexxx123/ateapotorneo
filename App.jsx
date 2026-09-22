import { useState, useEffect, useCallback, Fragment } from 'react';
import {
  Trophy, Users, User, Calendar, ShieldAlert, BarChart3, Settings,
  Plus, Trash2, X, AlertTriangle, Check, Pencil, Table2, Award, Loader2,
  LogIn, LogOut, Mail, Home, FileText, UserCircle2, Send, Clock, MapPin
} from 'lucide-react';
import { supabase } from './supabaseClient';

const PALETTE = ['#22C55E', '#EF4444', '#3B82F6', '#F97316', '#A855F7', '#14B8A6', '#E11D48', '#6366F1', '#EAB308', '#EC4899'];

function ageColor(age) {
  if (age === '' || age === undefined || age === null) return { bg: '#F1F5F9', fg: '#64748B', label: '' };
  const n = Number(age);
  // Colores sólidos para resaltar claramente las categorías por reglas de cancha
  if (n >= 50) return { bg: '#EF4444', fg: '#FFFFFF', label: '50+' };
  if (n >= 40) return { bg: '#F97316', fg: '#FFFFFF', label: '40-49' };
  return { bg: '#10B981', fg: '#FFFFFF', label: '≤39' };
}

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

function formatDateTime(date, time) {
  const d = formatDate(date);
  if (!d) return null;
  return time ? d + ' · ' + time : d;
}

function formatPlayDays(playDays) {
  const names = { 0: 'domingos', 1: 'lunes', 2: 'martes', 3: 'miércoles', 4: 'jueves', 5: 'viernes', 6: 'sábados' };
  const days = (Array.isArray(playDays) && playDays.length > 0) ? playDays : [0, 1, 2, 3, 4, 5, 6];
  if (days.length === 7) return 'todos los días';
  const order = [1, 2, 3, 4, 5, 6, 0];
  return order.filter(d => days.includes(d)).map(d => names[d]).join(', ');
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function scheduleGroupsSequentially(dayGroups, meta, startFromDate) {
  const duration = Math.max(5, Number(meta.matchDurationMinutes) || 20);
  const rest = Math.max(0, Number(meta.breakBetweenMatchesMinutes) || 0);
  const slot = duration + rest;
  const toMinutes = (hhmm) => {
    const [h, m] = (hhmm || '09:00').split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  const toHHMM = (mins) => {
    const h = Math.floor(mins / 60) % 24;
    const m = mins % 60;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  };
  const dayStartMin = toMinutes(meta.dailyStartTime || '09:00');
  const playDays = (Array.isArray(meta.playDays) && meta.playDays.length > 0) ? meta.playDays : [0, 1, 2, 3, 4, 5, 6];

  const advanceToPlayDay = (d) => {
    let date = new Date(d.getTime());
    let guard = 0;
    while (!playDays.includes(date.getDay()) && guard < 60) {
      date = new Date(date.getTime() + 86400000);
      guard++;
    }
    return date;
  };

  let base = startFromDate ? new Date(startFromDate.getTime()) : new Date();
  if (isNaN(base.getTime())) base = new Date();
  let currentDate = advanceToPlayDay(base);

  const result = [];
  let lastDate = null;

  dayGroups.forEach((group, idx) => {
    if (idx > 0) currentDate = advanceToPlayDay(new Date(currentDate.getTime() + 86400000));
    let currentMin = dayStartMin;
    group.forEach(m => {
      const y = currentDate.getFullYear();
      const mo = String(currentDate.getMonth() + 1).padStart(2, '0');
      const da = String(currentDate.getDate()).padStart(2, '0');
      result.push({ ...m, date: `${y}-${mo}-${da}`, time: toHHMM(currentMin) });
      currentMin += slot;
    });
    lastDate = new Date(currentDate.getTime());
  });

  return { matches: result, lastDate };
}

const PLAYOFF_DAY_GROUPS_ORDER = [['Cuartos de Final'], ['Semifinal'], ['Tercer Puesto', 'Final']];

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
      rulesPdfUrl: '',
      venueAddress: '',
      logoUrl: '',
      championText: '', runnerUpText: '',
      pointsWin: 3, pointsDraw: 1, pointsLoss: 0,
      yellowLimit: 3, redSuspensionMatches: 1, playoffSpots: 4, relegationSpots: 0, idaYVuelta: false,
      courtName: '', dailyStartTime: '09:00', dailyEndTime: '18:00',
      matchDurationMinutes: 20, breakBetweenMatchesMinutes: 10, playDays: [0, 1, 2, 3, 4, 5, 6],
      adminEmail: '',
    },
    teams: [],
    players: [],
    matches: [],
    playoffMatches: [],
    news: [],
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
  const table = data.teams.map(t => ({ teamId: t.id, name: t.name, pj: 0, pg: 0, pe: 0, pp: 0, gf: 0, gc: 0, pts: 0 }));
  const map = Object.fromEntries(table.map(t => [t.teamId, t]));
  const played = data.matches.filter(m => m.played);
  played.forEach(m => {
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

  const sorted = [...table].sort((a, b) => b.pts - a.pts);
  const groups = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i + 1;
    while (j < sorted.length && sorted[j].pts === sorted[i].pts) j++;
    groups.push(sorted.slice(i, j));
    i = j;
  }

  const resolveGroup = (group) => {
    if (group.length <= 1) return group;
    const ids = new Set(group.map(t => t.teamId));
    const h2h = Object.fromEntries(group.map(t => [t.teamId, { pts: 0, gf: 0, gc: 0 }]));
    played.filter(m => ids.has(m.teamAId) && ids.has(m.teamBId)).forEach(m => {
      h2h[m.teamAId].gf += m.scoreA; h2h[m.teamAId].gc += m.scoreB;
      h2h[m.teamBId].gf += m.scoreB; h2h[m.teamBId].gc += m.scoreA;
      if (m.scoreA > m.scoreB) { h2h[m.teamAId].pts += data.meta.pointsWin; h2h[m.teamBId].pts += data.meta.pointsLoss; }
      else if (m.scoreA < m.scoreB) { h2h[m.teamBId].pts += data.meta.pointsWin; h2h[m.teamAId].pts += data.meta.pointsLoss; }
      else { h2h[m.teamAId].pts += data.meta.pointsDraw; h2h[m.teamBId].pts += data.meta.pointsDraw; }
    });
    return [...group].sort((a, b) => {
      const ha = h2h[a.teamId], hb = h2h[b.teamId];
      if (hb.pts !== ha.pts) return hb.pts - ha.pts;
      const hDgA = ha.gf - ha.gc, hDgB = hb.gf - hb.gc;
      if (hDgB !== hDgA) return hDgB - hDgA;
      if (hb.gf !== ha.gf) return hb.gf - ha.gf;
      if (b.dg !== a.dg) return b.dg - a.dg;
      if (b.gf !== a.gf) return b.gf - a.gf;
      return a.name.localeCompare(b.name);
    });
  };

  return groups.flatMap(resolveGroup);
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
      
      .futbolito-app { font-family: 'Inter', sans-serif; background: #F8FAFC; color: #1E293B; }
      .futbolito-app * { box-sizing: border-box; }
      .font-display { font-family: 'Poppins', sans-serif; }
      .app-shell { display: flex; min-height: 100vh; }
      
      /* Sidebar Premium Refinado y Fijo (Sticky) */
      .sidebar { 
        width: 260px; 
        flex-shrink: 0; 
        background: #0B1121; 
        border-right: 1px solid rgba(255,255,255,0.05); 
        display: flex; 
        flex-direction: column; 
        padding: 28px 20px; 
        z-index: 10;
        position: sticky;
        top: 0;
        height: 100vh;
        overflow-y: auto;
      }
      /* Ocultar barra de desplazamiento del sidebar en webkit para un look más limpio */
      .sidebar::-webkit-scrollbar { width: 4px; }
      .sidebar::-webkit-scrollbar-track { background: transparent; }
      .sidebar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }

      .sidebar-logo-row { display: flex; align-items: center; gap: 12px; margin-bottom: 32px; padding: 0 6px; }
      .sidebar-logo-badge { width: 42px; height: 42px; border-radius: 12px; background: linear-gradient(135deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.02) 100%); border: 1px solid rgba(255,255,255,0.1); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
      .sidebar-title { font-family: 'Poppins', sans-serif; font-weight: 700; font-size: 15px; color: #FFFFFF; line-height: 1.25; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
      .sidebar-nav { display: flex; flex-direction: column; gap: 4px; flex: 1; }
      .sidebar-nav-item { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 10px; color: #94A3B8; font-family: 'Inter', sans-serif; font-weight: 500; font-size: 14px; cursor: pointer; background: transparent; border: none; text-align: left; width: 100%; transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); }
      .sidebar-nav-item:hover { background: rgba(255,255,255,0.05); color: #F8FAFC; }
      .sidebar-nav-item.active { background: linear-gradient(90deg, #22C55E 0%, #16A34A 100%); color: #FFFFFF; font-weight: 600; box-shadow: 0 4px 12px rgba(34,197,94,0.25); }
      
      .sidebar-footer { margin-top: 16px; display: flex; flex-direction: column; gap: 8px; }
      .sidebar-footer-link { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 10px; color: #94A3B8; font-size: 13px; font-weight: 500; cursor: pointer; background: transparent; border: none; text-align: left; width: 100%; transition: all 0.2s; }
      .sidebar-footer-link:hover { background: rgba(255,255,255,0.05); color: #F8FAFC; }
      
      /* Tarjeta de usuario en Sidebar */
      .sidebar-user-card { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
      .sidebar-footer-link.logout:hover { background: rgba(239, 68, 68, 0.1) !important; color: #FCA5A5 !important; }
      
      /* Área Principal */
      .main-area { flex: 1; padding: 36px 48px; min-width: 0; }
      .page-header { margin-bottom: 32px; }
      .page-title { font-family: 'Poppins', sans-serif; font-weight: 800; font-size: 32px; color: #0F172A; letter-spacing: -0.02em; line-height: 1.15; }
      .page-subtitle { font-family: 'Inter', sans-serif; font-weight: 500; font-size: 15px; color: #64748B; margin-top: 6px; }
      
      /* Tarjetas Genéricas */
      .card { background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 16px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05); font-family: 'Inter', sans-serif; }
      .card-header-green { background: #22C55E; color: #fff; font-family: 'Poppins', sans-serif; font-weight: 700; font-size: 14px; padding: 16px 20px; border-radius: 15px 15px 0 0; }
      
      /* Tarjetas de Equipo (EquiposTab) */
      .team-card { display: flex; flex-direction: column; position: relative; background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 16px; overflow: hidden; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.02); transition: all 0.25s ease; height: 100%; }
      .team-card:hover { transform: translateY(-3px); box-shadow: 0 12px 20px -8px rgba(0, 0, 0, 0.08), 0 4px 6px -4px rgba(0, 0, 0, 0.04); border-color: #CBD5E1; }
      .team-card-accent { position: absolute; top: 0; left: 0; right: 0; height: 4px; opacity: 0.9; }
      .team-card-header { padding: 20px 16px 12px; display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
      .team-card-title-group { display: flex; align-items: center; gap: 12px; min-width: 0; cursor: pointer; flex: 1; }
      .team-card-title { font-family: 'Poppins', sans-serif; font-weight: 700; font-size: 15px; color: #0F172A; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .team-card-actions { display: flex; gap: 4px; flex-shrink: 0; }
      .team-card-body { padding: 0 16px 20px; display: flex; flex-direction: column; gap: 8px; margin-top: auto; }
      .team-card-players { font-size: 13px; color: #64748B; display: flex; align-items: center; gap: 6px; }
      .team-card-stats { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: #475569; }
      .team-card-stats strong { color: #0F172A; font-weight: 700; }
      .team-card-stats .dot { color: #CBD5E1; font-size: 10px; }
      
      /* Botones sutiles (Editar/Borrar en cards) */
      .icon-btn-subtle { width: 32px; height: 32px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; background: transparent; border: 1px solid transparent; color: #94A3B8; cursor: pointer; transition: all 0.2s; }
      .icon-btn-subtle:hover { background: #F1F5F9; color: #334155; }
      .icon-btn-subtle.danger:hover { background: #FEF2F2; color: #DC2626; }
      
      /* Botones y UI Base */
      .btn { font-family: 'Inter', sans-serif; font-weight: 600; padding: 10px 16px; border-radius: 10px; font-size: 13.5px; cursor: pointer; border: 1px solid transparent; display: inline-flex; align-items: center; gap: 8px; white-space: nowrap; transition: all 0.2s; }
      .btn:active { transform: scale(0.97); }
      .btn-primary { background: #22C55E; color: #fff; box-shadow: 0 2px 4px rgba(34,197,94,0.2); }
      .btn-primary:hover { background: #16A34A; box-shadow: 0 4px 6px rgba(34,197,94,0.3); }
      .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; box-shadow: none; }
      .btn-outline { background: #FFFFFF; color: #334155; border-color: #CBD5E1; }
      .btn-outline:hover { border-color: #22C55E; color: #16A34A; background: #F8FAFC; }
      .btn-danger { background: #FEF2F2; color: #DC2626; border-color: #FECACA; }
      .btn-danger:hover { background: #DC2626; color: #fff; border-color: #DC2626; }
      .btn-sm { padding: 8px 14px; font-size: 12.5px; }
      
      .icon-btn { width: 34px; height: 34px; border-radius: 10px; display: inline-flex; align-items: center; justify-content: center; background: #FFFFFF; border: 1px solid #E2E8F0; color: #64748B; cursor: pointer; flex-shrink: 0; transition: all 0.2s; }
      .icon-btn:hover { border-color: #22C55E; color: #16A34A; }
      
      /* Inputs */
      .input, textarea.textarea { background: #F8FAFC; border: 1px solid #CBD5E1; color: #1E293B; padding: 10px 14px; border-radius: 10px; font-family: 'Inter', sans-serif; font-size: 14px; width: 100%; transition: all 0.2s; }
      .input:focus, textarea.textarea:focus { background: #FFFFFF; border-color: #22C55E; box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.15); outline: none; }
      .input::placeholder, textarea.textarea::placeholder { color: #94A3B8; }
      textarea.textarea { resize: vertical; min-height: 80px; }
      label.field-label { font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748B; margin-bottom: 6px; display: block; font-weight: 700; }
      
      /* Escudos y Chips */
      .crest { display: inline-flex; align-items: center; justify-content: center; border-radius: 8px; color: #fff; font-family: 'Poppins', sans-serif; font-weight: 700; flex-shrink: 0; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
      .team-name-cell { font-family: 'Inter', sans-serif; font-weight: 600; text-align: left !important; color: #0F172A; }
      .card-chip { display: inline-block; width: 12px; height: 16px; border-radius: 3px; flex-shrink: 0; box-shadow: 0 1px 2px rgba(0,0,0,0.1); }
      .card-chip.yellow { background: #FACC15; }
      .card-chip.red { background: #EF4444; }
      
      /* Tablas de Datos Refinadas */
      table.data-table { border-collapse: separate; border-spacing: 0; width: 100%; }
      table.data-table th { background: #FFFFFF; font-family: 'Inter', sans-serif; font-weight: 700; color: #64748B; font-size: 11px; text-align: center; padding: 16px 16px; white-space: nowrap; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 2px solid #F1F5F9; }
      table.data-table th:first-child { text-align: left; border-top-left-radius: 16px; }
      table.data-table th:last-child { border-top-right-radius: 16px; }
      table.data-table td { background: #FFFFFF; font-family: 'Inter', sans-serif; font-size: 14px; text-align: center; padding: 14px 16px; white-space: nowrap; color: #334155; border-bottom: 1px solid #F1F5F9; transition: background 0.15s; vertical-align: middle; }
      table.data-table td:first-child { text-align: left; }
      table.data-table tbody tr:hover td { background: #F8FAFC; }
      
      .dorsal-text { font-family: 'Poppins', sans-serif; font-weight: 800; font-size: 14px; color: #0F172A; }
      
      /* Elementos visuales auxiliares */
      .avatar-circle { border-radius: 50%; background: #F1F5F9; border: 1px solid #E2E8F0; display: flex; align-items: center; justify-content: center; color: #94A3B8; flex-shrink: 0; }
      .status-pill { font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 20px; display: inline-block; letter-spacing: 0.02em; }
      .status-pill.done { background: #EFF6FF; color: #2563EB; border: 1px solid #BFDBFE; }
      .status-pill.pending { background: #F8FAFC; color: #64748B; border: 1px solid #E2E8F0; }
      .info-strip { background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 16px; padding: 16px 20px; display: flex; gap: 32px; flex-wrap: wrap; align-items: center; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05); }
      .info-strip-item .lbl { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748B; font-weight: 700; }
      .info-strip-item .val { font-size: 14.5px; color: #0F172A; font-weight: 600; margin-top: 4px; }
      .stat-circle { width: 64px; height: 64px; border-radius: 50%; border: 3px solid #22C55E; display: flex; align-items: center; justify-content: center; font-family: 'Poppins', sans-serif; font-weight: 800; font-size: 22px; color: #0F172A; margin: 0 auto; box-shadow: 0 4px 10px rgba(34,197,94,0.15); background: #FFFFFF; }
      
      .checkbox-row { display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none; }
      .checkbox-row input { accent-color: #22C55E; width: 16px; height: 16px; cursor: pointer; }
      .swatch { width: 24px; height: 24px; border-radius: 6px; cursor: pointer; border: 2px solid transparent; flex-shrink: 0; transition: transform 0.1s; }
      .swatch:hover { transform: scale(1.1); }
      .swatch.selected { border-color: #0F172A; box-shadow: 0 0 0 2px #FFFFFF, 0 0 0 4px #0F172A; }
      
      .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
      .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }
      
      /* Scrollbar */
      .futbolito-app ::-webkit-scrollbar { width: 8px; height: 8px; }
      .futbolito-app ::-webkit-scrollbar-track { background: transparent; }
      .futbolito-app ::-webkit-scrollbar-thumb { background: #CBD5E1; border-radius: 4px; }
      .futbolito-app ::-webkit-scrollbar-thumb:hover { background: #94A3B8; }
      
      /* Modales */
      .modal-overlay { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.6); backdrop-filter: blur(4px); display: flex; align-items: flex-start; justify-content: center; z-index: 50; padding: 32px 16px; overflow-y: auto; animation: fadeIn 0.2s ease-out; }
      .modal-box { background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 20px; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25); max-width: 640px; width: 100%; margin: auto; animation: slideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1); }
      
      @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      @keyframes slideUp { from { opacity: 0; transform: translateY(20px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
      @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
      .spin { animation: spin 1s linear infinite; }
      
      /* Responsive */
      @media (max-width: 820px) {
        .app-shell { flex-direction: column; }
        .sidebar { 
          width: 100%; 
          height: auto; 
          position: relative; 
          flex-direction: column; 
          align-items: stretch; 
          padding: 16px; 
          gap: 8px; 
          border-right: none; 
          border-bottom: 1px solid rgba(255,255,255,0.05); 
        }
        .sidebar-logo-row { margin-bottom: 8px; }
        .sidebar-nav { flex-direction: row; overflow-x: auto; flex: none; width: 100%; gap: 6px; -webkit-overflow-scrolling: touch; padding-bottom: 8px; }
        .sidebar-nav-item { flex-shrink: 0; width: auto; white-space: nowrap; padding: 10px 16px; }
        .sidebar-footer { border-top: 1px solid rgba(255,255,255,0.05); margin-top: 8px; padding-top: 12px; }
        .main-area { padding: 24px 16px; }
        .grid-2, .grid-3 { grid-template-columns: 1fr !important; }
      }
      
      @media print {
        .no-print { display: none !important; }
        .sidebar { display: none !important; }
        .app-shell { display: block !important; }
        .main-area { padding: 0 !important; }
        body, .futbolito-app { background: #fff !important; color: #000 !important; }
        .card { break-inside: avoid; border-color: #CBD5E1 !important; box-shadow: none !important; }
      }
    `}</style>
  );
}

function Crest({ team, size }) {
  const s = size === 'sm' ? 24 : size === 'md' ? 36 : size === 'lg' ? 46 : 30;
  const fs = Math.round(s * 0.36);
  const [imgError, setImgError] = useState(false);
  if (!team) return <div className="crest" style={{ width: s, height: s, background: '#E2E8F0', color: '#94A3B8', fontSize: fs }}>?</div>;
  if (team.logoUrl && !imgError) {
    return <img src={team.logoUrl} alt="" onError={() => setImgError(true)}
      style={{ width: s, height: s, borderRadius: 8, objectFit: 'cover', flexShrink: 0, border: '1px solid #E2E8F0' }} />;
  }
  return <div className="crest" style={{ width: s, height: s, background: team.color, fontSize: fs }}>{initials(team.name)}</div>;
}

function TeamChip({ team, size, onClick }) {
  if (!team) return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#94A3B8' }}><Crest size={size} /> Equipo eliminado</span>;
  const content = (
    <>
      <Crest team={team} size={size} />
      <span className="team-name-cell">{team.name}</span>
    </>
  );
  if (onClick) {
    return (
      <span onClick={(e) => { e.stopPropagation(); onClick(); }} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
        {content}
      </span>
    );
  }
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>{content}</span>;
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
  if (!yellow && !red) return <span style={{ color: '#CBD5E1' }}>—</span>;
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
      {yellow > 0 && <span className="card-chip yellow" title={yellow + ' amarilla(s)'} />}
      {red > 0 && <span className="card-chip red" title={red + ' roja(s)'} />}
    </span>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid #E2E8F0' }}>
          <h3 className="font-display" style={{ fontSize: 18, fontWeight: 700, color: '#0F172A', margin: 0 }}>{title}</h3>
          <button onClick={onClose} className="icon-btn-subtle" aria-label="Cerrar"><X size={18} /></button>
        </div>
        <div style={{ padding: 24 }}>{children}</div>
      </div>
    </div>
  );
}

function EmptyState({ Icon, title, text }) {
  return (
    <div className="card" style={{ padding: '48px 24px', textAlign: 'center' }}>
      <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
        <Icon size={32} color="#94A3B8" />
      </div>
      <div className="font-display" style={{ fontSize: 18, fontWeight: 700, color: '#0F172A' }}>{title}</div>
      <div style={{ fontSize: 14, color: '#64748B', marginTop: 8, maxWidth: 400, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.5 }}>{text}</div>
    </div>
  );
}

function ConfirmInline({ text, onConfirm, onCancel }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#FEF2F2', padding: '6px 10px', borderRadius: 10, border: '1px solid #FECACA' }}>
      <span style={{ fontSize: 12.5, color: '#DC2626', fontWeight: 600 }}>{text}</span>
      <button className="btn btn-danger btn-sm" onClick={onConfirm}><Check size={14} /></button>
      <button className="btn btn-outline btn-sm" onClick={onCancel} style={{ borderColor: '#FCA5A5', color: '#DC2626' }}><X size={14} /></button>
    </span>
  );
}

/* ---------- Formularios modales ---------- */

function LogoUploadField({ value, onChange, label, folder, kind = 'image' }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const isPdf = kind === 'pdf';
  const inputId = 'logo-upload-' + folder + '-' + Math.random().toString(36).slice(2, 8);

  const handleFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (isPdf ? file.type !== 'application/pdf' : !file.type.startsWith('image/')) {
      setError(isPdf ? 'Elige un archivo PDF.' : 'Elige un archivo de imagen (jpg, png, etc.).');
      return;
    }
    if (file.size > 10 * 1024 * 1024) { setError('El archivo pesa más de 10MB, elige uno más liviano.'); return; }
    setError('');
    setUploading(true);
    try {
      const ext = (file.name.split('.').pop() || (isPdf ? 'pdf' : 'png')).toLowerCase().replace(/[^a-z0-9]/g, '') || (isPdf ? 'pdf' : 'png');
      const path = folder + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
      const { error: upErr } = await supabase.storage.from('torneo-logos').upload(path, file, { upsert: true, cacheControl: '3600' });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from('torneo-logos').getPublicUrl(path);
      onChange(pub.publicUrl);
    } catch (err) {
      setError('No se pudo subir el archivo. Revisa que exista el bucket "torneo-logos" en Supabase, o pega un link manualmente abajo.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <label className="field-label">{label}</label>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
        {value && !isPdf && (
          <img src={value} alt="" style={{ width: 44, height: 44, borderRadius: 10, objectFit: 'cover', border: '1px solid #E2E8F0', flexShrink: 0 }}
            onError={e => { e.currentTarget.style.visibility = 'hidden'; }} />
        )}
        {value && isPdf && (
          <a href={value} target="_blank" rel="noreferrer" className="btn btn-outline btn-sm"><FileText size={14} /> Ver PDF actual</a>
        )}
        <label htmlFor={inputId} className="btn btn-outline btn-sm" style={{ cursor: uploading ? 'default' : 'pointer', opacity: uploading ? .6 : 1 }}>
          {uploading ? <Loader2 size={14} className="spin" /> : <Send size={14} />} {uploading ? 'Subiendo…' : (isPdf ? 'Subir PDF' : 'Subir imagen')}
        </label>
        <input id={inputId} type="file" accept={isPdf ? 'application/pdf' : 'image/*'} style={{ display: 'none' }} onChange={handleFile} disabled={uploading} />
      </div>
      <input className="input" value={value} onChange={e => onChange(e.target.value)} placeholder="o pega un link https://..." />
      {error && <div style={{ fontSize: 12, color: '#DC2626', marginTop: 6 }}>{error}</div>}
    </div>
  );
}

function TeamFormModal({ initial, onClose, onSave }) {
  const [name, setName] = useState(initial ? initial.name : '');
  const [color, setColor] = useState(initial ? initial.color : PALETTE[0]);
  const [logoUrl, setLogoUrl] = useState(initial ? (initial.logoUrl || '') : '');
  const [photoUrl, setPhotoUrl] = useState(initial ? (initial.photoUrl || '') : '');
  return (
    <Modal title={initial ? 'Editar equipo' : 'Nuevo equipo'} onClose={onClose}>
      <div style={{ marginBottom: 16 }}>
        <label className="field-label">Nombre del equipo</label>
        <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Ej: Los Halcones" autoFocus />
      </div>
      <div style={{ marginBottom: 16 }}>
        <label className="field-label">Color / identidad</label>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {PALETTE.map(c => (
            <span key={c} className={'swatch' + (c === color ? ' selected' : '')} style={{ background: c }} onClick={() => setColor(c)} />
          ))}
          <input type="color" value={color} onChange={e => setColor(e.target.value)} />
        </div>
      </div>
      <div style={{ marginBottom: 16 }}>
        <LogoUploadField value={logoUrl} onChange={setLogoUrl} label="Logo del equipo (opcional)" folder="equipos" />
        <div style={{ fontSize: 12, color: '#64748B', marginTop: 6 }}>Si no pones nada, se usa un escudo con las iniciales del equipo.</div>
      </div>
      <div style={{ marginBottom: 24 }}>
        <LogoUploadField value={photoUrl} onChange={setPhotoUrl} label="Foto del equipo (opcional)" folder="equipos-fotos" />
        <div style={{ fontSize: 12, color: '#64748B', marginTop: 6 }}>La foto grupal de los integrantes. Se muestra en Inicio y en la ficha del equipo.</div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <button className="btn btn-outline" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" disabled={!name.trim()} onClick={() => name.trim() && onSave({ name: name.trim(), color, logoUrl: logoUrl.trim(), photoUrl: photoUrl.trim() })}>
          {initial ? 'Guardar cambios' : 'Agregar equipo'}
        </button>
      </div>
    </Modal>
  );
}

function PlayerFormModal({ initial, teams, defaultTeamId, onClose, onSave }) {
  const [name, setName] = useState(initial ? initial.name : '');
  const [number, setNumber] = useState(initial ? initial.number : '');
  const [age, setAge] = useState(initial ? (initial.age ?? '') : '');
  const [teamId, setTeamId] = useState(initial ? initial.teamId : (defaultTeamId || (teams[0] && teams[0].id) || ''));
  const preview = age !== '' ? ageColor(age) : null;
  return (
    <Modal title={initial ? 'Editar jugador' : 'Nuevo jugador'} onClose={onClose}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px', gap: 16, marginBottom: 16 }}>
        <div>
          <label className="field-label">Nombre del jugador</label>
          <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Ej: Juan Pérez" autoFocus />
        </div>
        <div>
          <label className="field-label">Dorsal</label>
          <input className="input" type="number" min="0" value={number} onChange={e => setNumber(e.target.value)} placeholder="#" />
        </div>
      </div>
      <div className="grid-2" style={{ marginBottom: 24 }}>
        <div>
          <label className="field-label">Equipo</label>
          <select className="input" value={teamId} onChange={e => setTeamId(e.target.value)}>
            {teams.length === 0 && <option value="">Sin equipos</option>}
            {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div>
          <label className="field-label">Edad</label>
          <input className="input" type="number" min="0" max="99" value={age} onChange={e => setAge(e.target.value)} placeholder="Ej: 34" />
          {preview && preview.label && (
            <span style={{ display: 'inline-block', marginTop: 8, fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 8, background: preview.bg, color: preview.fg, boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>{preview.label}</span>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <button className="btn btn-outline" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" disabled={!name.trim() || !teamId}
          onClick={() => name.trim() && teamId && onSave({ name: name.trim(), number: number === '' ? '' : Number(number), age: age === '' ? '' : Number(age), teamId })}>
          {initial ? 'Guardar cambios' : 'Agregar jugador'}
        </button>
      </div>
    </Modal>
  );
}

function BulkPlayersModal({ teams, defaultTeamId, onClose, onSave }) {
  const [teamId, setTeamId] = useState(defaultTeamId || (teams[0] && teams[0].id) || '');
  const [text, setText] = useState('');

  const parsed = text.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
    const match = line.match(/^(\d+)\s+(.+)$/);
    if (match) return { number: match[1], name: match[2].trim() };
    return { number: '', name: line };
  });

  return (
    <Modal title="Pegar lista de jugadores" onClose={onClose}>
      <div style={{ marginBottom: 16 }}>
        <label className="field-label">Equipo</label>
        <select className="input" value={teamId} onChange={e => setTeamId(e.target.value)}>
          {teams.length === 0 && <option value="">Sin equipos</option>}
          {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>
      <div style={{ marginBottom: 10 }}>
        <label className="field-label">Un jugador por línea</label>
        <textarea className="textarea" rows={8} value={text} onChange={e => setText(e.target.value)}
          placeholder={'7 Juan Pérez\n10 María Gómez\nCarlos Ruiz'} />
        <div style={{ fontSize: 12, color: '#64748B', marginTop: 6 }}>Si la línea empieza con un número, se usa como dorsal. El resto queda como nombre. La posición se puede ajustar después, jugador por jugador.</div>
      </div>
      {parsed.length > 0 && (
        <div className="card" style={{ padding: 12, marginBottom: 24, maxHeight: 160, overflowY: 'auto' }}>
          {parsed.map((p, i) => (
            <div key={i} style={{ fontSize: 13.5, padding: '4px 0', color: '#1E293B' }}>
              {p.number ? <span style={{ color: '#64748B', fontWeight: 700, marginRight: 8 }}>#{p.number}</span> : null}
              {p.name}
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <button className="btn btn-outline" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" disabled={!teamId || parsed.length === 0}
          onClick={() => teamId && parsed.length > 0 && onSave(teamId, parsed)}>
          Agregar {parsed.length || ''} jugador{parsed.length !== 1 ? 'es' : ''}
        </button>
      </div>
    </Modal>
  );
}

function NewsFormModal({ onClose, onSave }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  return (
    <Modal title="Nueva noticia" onClose={onClose}>
      <div style={{ marginBottom: 16 }}>
        <label className="field-label">Título</label>
        <input className="input" value={title} onChange={e => setTitle(e.target.value)} placeholder="Ej: Arranca la fase de grupos" autoFocus />
      </div>
      <div style={{ marginBottom: 16 }}>
        <label className="field-label">Texto</label>
        <textarea className="textarea" rows={4} value={body} onChange={e => setBody(e.target.value)} placeholder="Detalles de la noticia…" />
      </div>
      <div style={{ marginBottom: 24 }}>
        <LogoUploadField value={imageUrl} onChange={setImageUrl} label="Imagen (opcional)" folder="noticias" />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <button className="btn btn-outline" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" disabled={!title.trim()}
          onClick={() => title.trim() && onSave({ title: title.trim(), body: body.trim(), imageUrl: imageUrl.trim(), date: new Date().toISOString().slice(0, 10) })}>
          Publicar
        </button>
      </div>
    </Modal>
  );
}

function TeamDetailModal({ team, data, onClose }) {
  const players = data.players.filter(p => p.teamId === team.id);
  const allMatches = [
    ...data.matches.map(m => ({ ...m, _label: 'Jornada ' + m.jornada })),
    ...data.playoffMatches.map(m => ({ ...m, _label: m.round })),
  ].filter(m => m.teamAId === team.id || m.teamBId === team.id);
  const upcoming = [...allMatches].filter(m => !m.played).sort((a, b) => (a.date || '9999-99-99').localeCompare(b.date || '9999-99-99'));
  const past = [...allMatches].filter(m => m.played).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const standings = computeStandings(data);
  const row = standings.find(s => s.teamId === team.id);

  const opponentOf = (m) => data.teams.find(t => t.id === (m.teamAId === team.id ? m.teamBId : m.teamAId));

  return (
    <Modal title={team.name} onClose={onClose}>
      {team.photoUrl && (
        <img src={team.photoUrl} alt="" style={{ width: '100%', maxHeight: 260, objectFit: 'cover', borderRadius: 12, marginBottom: 20, border: '1px solid #E2E8F0' }}
          onError={e => { e.currentTarget.style.display = 'none'; }} />
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
        <Crest team={team} size="lg" />
        <div>
          <div className="font-display" style={{ fontWeight: 800, fontSize: 20, color: '#0F172A' }}>{team.name}</div>
          {row && <div style={{ fontSize: 13.5, color: '#64748B', marginTop: 4, fontWeight: 500 }}>{row.pj} PJ · {row.pts} PTS · DIF {row.dg > 0 ? '+' + row.dg : row.dg}</div>}
        </div>
      </div>

      <div className="font-display" style={{ fontSize: 15, fontWeight: 700, color: '#0F172A', marginBottom: 10 }}>Jugadores ({players.length})</div>
      {players.length === 0
        ? <div style={{ fontSize: 13.5, color: '#94A3B8', marginBottom: 24 }}>Sin jugadores registrados.</div>
        : (
          <div className="card" style={{ marginBottom: 24, overflow: 'hidden' }}>
            {players.map((p, idx) => {
              const ac = ageColor(p.age);
              return (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: idx === players.length - 1 ? 'none' : '1px solid #F1F5F9' }}>
                  <Avatar size={28} />
                  <div style={{ flex: 1, fontSize: 14 }}>
                    {p.number !== '' && p.number !== undefined ? <span style={{ color: '#64748B', fontWeight: 700, marginRight: 8 }}>#{p.number}</span> : null}
                    {p.name}
                  </div>
                  {p.age !== '' && p.age !== undefined && (
                    <span style={{ fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 8, background: ac.bg, color: ac.fg, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>{p.age} años</span>
                  )}
                </div>
              );
            })}
          </div>
        )}

      <div className="font-display" style={{ fontSize: 15, fontWeight: 700, color: '#0F172A', marginBottom: 10 }}>Próximos partidos</div>
      {upcoming.length === 0
        ? <div style={{ fontSize: 13.5, color: '#94A3B8', marginBottom: 24 }}>No hay partidos programados.</div>
        : (
          <div className="card" style={{ marginBottom: 24, overflow: 'hidden' }}>
            {upcoming.map((m, idx) => {
              const opp = opponentOf(m);
              return (
                <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: idx === upcoming.length - 1 ? 'none' : '1px solid #F1F5F9' }}>
                  <Crest team={opp} size="md" />
                  <div style={{ flex: 1, fontSize: 14, fontWeight: 600, color: '#0F172A' }}>vs {opp ? opp.name : 'Por definir'}</div>
                  <div style={{ fontSize: 12, color: '#64748B', textAlign: 'right' }}>{m._label}{m.date ? ' · ' + formatDateTime(m.date, m.time) : ''}</div>
                </div>
              );
            })}
          </div>
        )}

      {past.length > 0 && (
        <>
          <div className="font-display" style={{ fontSize: 15, fontWeight: 700, color: '#0F172A', marginBottom: 10 }}>Resultados recientes</div>
          <div className="card" style={{ overflow: 'hidden' }}>
            {past.slice(0, 8).map((m, idx, arr) => {
              const opp = opponentOf(m);
              const myScore = m.teamAId === team.id ? m.scoreA : m.scoreB;
              const oppScore = m.teamAId === team.id ? m.scoreB : m.scoreA;
              const color = myScore > oppScore ? '#22C55E' : myScore < oppScore ? '#DC2626' : '#64748B';
              return (
                <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: idx === arr.length - 1 ? 'none' : '1px solid #F1F5F9' }}>
                  <Crest team={opp} size="md" />
                  <div style={{ flex: 1, fontSize: 14, fontWeight: 600, color: '#0F172A' }}>vs {opp ? opp.name : 'Por definir'}</div>
                  <div className="font-display" style={{ fontSize: 14, fontWeight: 800, color }}>{myScore} - {oppScore}</div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </Modal>
  );
}

function MatchFormModal({ teams, phase, onClose, onSave, suggestedJornada }) {
  const [teamAId, setTeamAId] = useState(teams[0] ? teams[0].id : '');
  const [teamBId, setTeamBId] = useState(teams[1] ? teams[1].id : '');
  const [jornada, setJornada] = useState(suggestedJornada || 1);
  const [round, setRound] = useState('Semifinal');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const invalid = !teamAId || !teamBId || teamAId === teamBId;
  return (
    <Modal title={phase === 'liga' ? 'Agregar partido de liga' : 'Agregar partido de playoffs'} onClose={onClose}>
      <div className="grid-2" style={{ marginBottom: 16 }}>
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
        <div style={{ fontSize: 13, color: '#DC2626', marginBottom: 16, display: 'flex', gap: 6, alignItems: 'center' }}>
          <AlertTriangle size={14} /> Selecciona dos equipos distintos.
        </div>
      )}
      <div className="grid-3" style={{ marginBottom: 24 }}>
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
        <div>
          <label className="field-label">Hora (opcional)</label>
          <input className="input" type="time" value={time} onChange={e => setTime(e.target.value)} />
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <button className="btn btn-outline" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" disabled={invalid} onClick={() => onSave({
          teamAId, teamBId, date, time,
          jornada: phase === 'liga' ? jornada : undefined,
          round: phase === 'playoff' ? (round.trim() || 'Ronda') : undefined,
        })}>Agregar partido</button>
      </div>
    </Modal>
  );
}

function validateAgeRule(teamPlayers) {
  const over50 = teamPlayers.filter(p => p.age !== '' && p.age !== null && Number(p.age) >= 50).length;
  const over40 = teamPlayers.filter(p => p.age !== '' && p.age !== null && Number(p.age) >= 40 && Number(p.age) < 50).length;
  return {
    valid: over50 >= 2 && over40 >= 1,
    over50,
    over40
  };
}

function MatchResultModal({ match, teams, players, allMatches, onClose, onSave, onDelete, onSwap }) {
  const teamA = teams.find(t => t.id === match.teamAId);
  const teamB = teams.find(t => t.id === match.teamBId);
  const playersA = players.filter(p => p.teamId === match.teamAId);
  const playersB = players.filter(p => p.teamId === match.teamBId);

  const ruleA = validateAgeRule(playersA);
  const ruleB = validateAgeRule(playersB);

  const initStats = {};
  [...playersA, ...playersB].forEach(p => {
    const existing = match.playerStats && match.playerStats[p.id];
    initStats[p.id] = { goals: existing ? existing.goals || 0 : 0, yellow: existing ? !!existing.yellow : false, red: existing ? !!existing.red : false };
  });

  const [scoreA, setScoreA] = useState(match.scoreA || 0);
  const [scoreB, setScoreB] = useState(match.scoreB || 0);
  const [stats, setStats] = useState(initStats);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [date, setDate] = useState(match.date || '');
  const [time, setTime] = useState(match.time || '');

  const conflict = (date && time && allMatches)
    ? allMatches.find(m => m.id !== match.id && m.date === date && m.time === time)
    : null;
  const conflictTeamA = conflict ? teams.find(t => t.id === conflict.teamAId) : null;
  const conflictTeamB = conflict ? teams.find(t => t.id === conflict.teamBId) : null;

  const setPlayerField = (pid, field, value) => setStats(prev => ({ ...prev, [pid]: { ...prev[pid], [field]: value } }));
  const sumGoals = (list) => list.reduce((acc, p) => acc + (Number(stats[p.id]?.goals) || 0), 0);

  const renderPlayerRows = (list) => list.length === 0
    ? <div style={{ fontSize: 13, color: '#94A3B8', padding: '12px 0' }}>Sin jugadores registrados en este equipo.</div>
    : list.map(p => (
      <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: '1px solid #F1F5F9' }}>
        <div style={{ flex: 1, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
          {p.number !== '' && p.number !== undefined ? <span style={{ color: '#64748B', fontWeight: 700 }}>#{p.number}</span> : null} {p.name}
        </div>
        <input className="input" type="number" min="0" style={{ width: 64, textAlign: 'center', padding: '8px' }}
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
      <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 12, padding: 20, marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, textAlign: 'right' }}><TeamChip team={teamA} /></div>
          <input className="input" type="number" min="0" style={{ width: 64, textAlign: 'center', fontSize: 20, fontWeight: 800, padding: '10px' }} value={scoreA} onChange={e => setScoreA(Math.max(0, Number(e.target.value)))} />
          <span className="font-display" style={{ color: '#94A3B8', fontWeight: 700, fontSize: 16 }}>VS</span>
          <input className="input" type="number" min="0" style={{ width: 64, textAlign: 'center', fontSize: 20, fontWeight: 800, padding: '10px' }} value={scoreB} onChange={e => setScoreB(Math.max(0, Number(e.target.value)))} />
          <div style={{ flex: 1 }}><TeamChip team={teamB} /></div>
        </div>
        <div style={{ textAlign: 'center', fontSize: 12, color: '#64748B', marginTop: 12 }}>
          Suma de goleadores registrados: {sumGoals(playersA)} - {sumGoals(playersB)}
        </div>
      </div>

      <div className="grid-2" style={{ marginBottom: conflict ? 10 : 24 }}>
        <div>
          <label className="field-label">Fecha</label>
          <input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} />
        </div>
        <div>
          <label className="field-label">Hora</label>
          <input className="input" type="time" value={time} onChange={e => setTime(e.target.value)} />
        </div>
      </div>
      {conflict && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: '12px 16px', marginBottom: 24, fontSize: 13, color: '#DC2626', flexWrap: 'wrap' }}>
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <span style={{ flex: 1, minWidth: 200, lineHeight: 1.5 }}>
            Ya hay otro partido a esta misma fecha y hora: <strong>{conflictTeamA ? conflictTeamA.name : '—'} vs {conflictTeamB ? conflictTeamB.name : '—'}</strong>
          </span>
          <button type="button" className="btn btn-outline btn-sm" style={{ borderColor: '#FCA5A5', color: '#DC2626' }}
            onClick={() => {
              onSwap(conflict.phase, conflict.id, { date: match.date, time: match.time });
              onSave({ date, time });
            }}>
            Intercambiar horarios
          </button>
        </div>
      )}

      <div className="grid-2" style={{ gap: 24 }}>
        <div>
          <div className="font-display" style={{ fontSize: 14, fontWeight: 700, color: '#0F172A', marginBottom: 8 }}><TeamChip team={teamA} size="md" /></div>
          {!ruleA.valid && (
            <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: '8px 12px', marginBottom: 12, fontSize: 12, color: '#DC2626', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>Plantilla incompleta: Tiene {ruleA.over50}/2 de 50+ y {ruleA.over40}/1 de 40-49.</span>
            </div>
          )}
          {renderPlayerRows(playersA)}
        </div>
        <div>
          <div className="font-display" style={{ fontSize: 14, fontWeight: 700, color: '#0F172A', marginBottom: 8 }}><TeamChip team={teamB} size="md" /></div>
          {!ruleB.valid && (
            <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: '8px 12px', marginBottom: 12, fontSize: 12, color: '#DC2626', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>Plantilla incompleta: Tiene {ruleB.over50}/2 de 50+ y {ruleB.over40}/1 de 40-49.</span>
            </div>
          )}
          {renderPlayerRows(playersB)}
        </div>
      </div>

      <div style={{ borderTop: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 24, paddingTop: 16, flexWrap: 'wrap', gap: 10 }}>
        {confirmDelete
          ? <ConfirmInline text="¿Eliminar partido?" onConfirm={() => onDelete(match.id)} onCancel={() => setConfirmDelete(false)} />
          : <button className="btn btn-danger btn-sm" onClick={() => setConfirmDelete(true)}><Trash2 size={14} /> Eliminar partido</button>}
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-outline" onClick={onClose}>Cancelar</button>
          <button className="btn btn-outline" onClick={() => onSave({ date, time })}>Guardar horario</button>
          <button className="btn btn-primary" onClick={() => onSave({ date, time, scoreA: Number(scoreA), scoreB: Number(scoreB), played: true, playerStats: stats })}>
            <Check size={16} /> Guardar resultado
          </button>
        </div>
      </div>
    </Modal>
  );
}

function MatchDetailModal({ match, teams, players, onClose }) {
  const teamA = teams.find(t => t.id === match.teamAId);
  const teamB = teams.find(t => t.id === match.teamBId);
  const playersA = players.filter(p => p.teamId === match.teamAId);
  const playersB = players.filter(p => p.teamId === match.teamBId);
  
  const ruleA = validateAgeRule(playersA);
  const ruleB = validateAgeRule(playersB);
  
  const statFor = (pid) => (match.playerStats && match.playerStats[pid]) || { goals: 0, yellow: false, red: false };

  const renderList = (list) => list.length === 0
    ? <div style={{ fontSize: 13, color: '#94A3B8', padding: '12px 0' }}>Sin jugadores registrados en este equipo.</div>
    : list.map(p => {
      const s = statFor(p.id);
      return (
        <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #F1F5F9' }}>
          <Avatar size={28} />
          <div style={{ flex: 1, fontSize: 14, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {p.number !== '' && p.number !== undefined ? <span style={{ color: '#64748B', fontWeight: 700, marginRight: 8 }}>#{p.number}</span> : null}
            {p.name}
          </div>
          {s.goals > 0 && <span style={{ fontSize: 13, color: '#22C55E', fontWeight: 800, flexShrink: 0 }}>⚽ {s.goals}</span>}
          <CardBadge yellow={s.yellow ? 1 : 0} red={s.red ? 1 : 0} />
        </div>
      );
    });

  return (
    <Modal title={(match.phase === 'liga' ? 'Jornada ' + match.jornada : match.round) + ' · Alineación'} onClose={onClose}>
      <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 12, padding: 20, marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, textAlign: 'right' }}><TeamChip team={teamA} /></div>
          {match.played
            ? <div className="font-display" style={{ fontSize: 24, fontWeight: 800, color: '#0F172A', border: '1px solid #E2E8F0', borderRadius: 10, padding: '6px 16px', background: '#fff' }}>{match.scoreA} : {match.scoreB}</div>
            : <span className="status-pill pending" style={{ fontSize: 12, padding: '6px 14px' }}>Programado</span>}
          <div style={{ flex: 1 }}><TeamChip team={teamB} /></div>
        </div>
        {match.date && <div style={{ textAlign: 'center', fontSize: 12.5, color: '#64748B', marginTop: 12 }}>{formatDateTime(match.date, match.time)}</div>}
      </div>

      <div className="grid-2" style={{ gap: 24 }}>
        <div>
          <div className="font-display" style={{ fontSize: 14, fontWeight: 700, color: '#0F172A', marginBottom: 8 }}><TeamChip team={teamA} size="md" /></div>
          {!ruleA.valid && (
            <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: '8px 12px', marginBottom: 12, fontSize: 12, color: '#DC2626', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>Plantilla incompleta: Tiene {ruleA.over50}/2 de 50+ y {ruleA.over40}/1 de 40-49.</span>
            </div>
          )}
          {renderList(playersA)}
        </div>
        <div>
          <div className="font-display" style={{ fontSize: 14, fontWeight: 700, color: '#0F172A', marginBottom: 8 }}><TeamChip team={teamB} size="md" /></div>
          {!ruleB.valid && (
            <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: '8px 12px', marginBottom: 12, fontSize: 12, color: '#DC2626', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>Plantilla incompleta: Tiene {ruleB.over50}/2 de 50+ y {ruleB.over40}/1 de 40-49.</span>
            </div>
          )}
          {renderList(playersB)}
        </div>
      </div>
    </Modal>
  );
}

function SettingsModal({ meta, onClose, onSave, onReset, onExport, onImport }) {
  const [form, setForm] = useState({ ...meta });
  const [confirmReset, setConfirmReset] = useState(false);
  const [pendingImport, setPendingImport] = useState(null);
  const [importError, setImportError] = useState('');
  const setField = (key, val) => setForm(f => ({ ...f, [key]: val }));
  const numField = (key, label) => (
    <div>
      <label className="field-label">{label}</label>
      <input className="input" type="number" value={form[key]} onChange={e => setField(key, Number(e.target.value))} />
    </div>
  );

  const handleFileSelected = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setImportError('');
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed.meta || !Array.isArray(parsed.teams) || !Array.isArray(parsed.players) || !Array.isArray(parsed.matches)) {
          setImportError('Ese archivo no tiene el formato esperado de un respaldo de este torneo.');
          return;
        }
        setPendingImport(parsed);
      } catch (err) {
        setImportError('No se pudo leer el archivo. ¿Seguro que es el JSON de respaldo?');
      }
    };
    reader.readAsText(file);
  };

  return (
    <Modal title="Configuración del torneo" onClose={onClose}>
      <div style={{ marginBottom: 16 }}>
        <label className="field-label">Nombre del torneo</label>
        <input className="input" value={form.name} onChange={e => setField('name', e.target.value)} />
      </div>
      <div style={{ marginBottom: 16 }}>
        <LogoUploadField value={form.logoUrl} onChange={v => setField('logoUrl', v)} label="Logo del torneo (opcional)" folder="torneo" />
        <div style={{ fontSize: 12, color: '#64748B', marginTop: 6 }}>Se muestra en la barra lateral y en Inicio.</div>
      </div>
      <div className="grid-2" style={{ marginBottom: 16 }}>
        <div>
          <label className="field-label">Categoría / deporte</label>
          <input className="input" value={form.category} onChange={e => setField('category', e.target.value)} placeholder="Ej: Futbolito" />
        </div>
        <div>
          <label className="field-label">Organizador</label>
          <input className="input" value={form.organizerName} onChange={e => setField('organizerName', e.target.value)} placeholder="Nombre del organizador" />
        </div>
      </div>
      <div className="grid-2" style={{ marginBottom: 16 }}>
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
      <div style={{ marginBottom: 24 }}>
        <label className="field-label">Reglas del campeonato</label>
        <textarea className="textarea" value={form.rules} onChange={e => setField('rules', e.target.value)} rows={4} placeholder="Formato, duración de partidos, reglas específicas…" />
      </div>
      <div style={{ marginBottom: 24 }}>
        <LogoUploadField value={form.rulesPdfUrl} onChange={v => setField('rulesPdfUrl', v)} label="PDF de reglas (opcional)" folder="reglas" kind="pdf" />
        <div style={{ fontSize: 12, color: '#64748B', marginTop: 6 }}>Si subes un PDF, aparece un botón para verlo/descargarlo junto al texto de reglas.</div>
      </div>
      <div style={{ marginBottom: 24 }}>
        <label className="field-label">Sitio (dirección o nombre del lugar)</label>
        <input className="input" value={form.venueAddress} onChange={e => setField('venueAddress', e.target.value)} placeholder="Ej: Cancha anexa al Coliseo Universitario, Machala" />
        <div style={{ fontSize: 12, color: '#64748B', marginTop: 6 }}>Se muestra en Inicio con un mapa. Mientras más específico (con ciudad), mejor lo ubica el mapa.</div>
      </div>

      <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>Puntuación y sanciones</div>
      <div className="grid-3" style={{ marginBottom: 16 }}>
        {numField('pointsWin', 'Pts. victoria')}
        {numField('pointsDraw', 'Pts. empate')}
        {numField('pointsLoss', 'Pts. derrota')}
      </div>
      <div className="grid-2" style={{ marginBottom: 24 }}>
        {numField('yellowLimit', 'Amarillas p/ sanción')}
        {numField('redSuspensionMatches', 'Partidos por roja')}
      </div>

      <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>Clasificación</div>
      <div className="grid-2" style={{ marginBottom: 16 }}>
        {numField('playoffSpots', 'Cupos a playoffs')}
        {numField('relegationSpots', 'Equipos en zona de alerta')}
      </div>
      <label className="checkbox-row" style={{ marginBottom: 24, fontSize: 14 }}>
        <input type="checkbox" checked={!!form.idaYVuelta} onChange={e => setField('idaYVuelta', e.target.checked)} />
        Ida y vuelta (todos contra todos dos veces, local y visitante)
      </label>

      <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>Horarios (para "Asignar horarios automáticamente")</div>
      <div style={{ marginBottom: 16 }}>
        <label className="field-label">Cancha</label>
        <input className="input" value={form.courtName} onChange={e => setField('courtName', e.target.value)} placeholder="Ej: Cancha Principal" />
      </div>
      <div className="grid-2" style={{ marginBottom: 16 }}>
        <div>
          <label className="field-label">Hora de inicio diaria</label>
          <input className="input" type="time" value={form.dailyStartTime} onChange={e => setField('dailyStartTime', e.target.value)} />
        </div>
        <div>
          <label className="field-label">Hora de cierre diaria</label>
          <input className="input" type="time" value={form.dailyEndTime} onChange={e => setField('dailyEndTime', e.target.value)} />
        </div>
      </div>
      <div className="grid-2" style={{ marginBottom: 8 }}>
        {numField('matchDurationMinutes', 'Duración partido (min)')}
        {numField('breakBetweenMatchesMinutes', 'Descanso entre partidos (min)')}
      </div>
      <div style={{ fontSize: 12, color: '#64748B', marginBottom: 24, lineHeight: 1.5 }}>
        Cada partido empieza <strong>{(Number(form.matchDurationMinutes) || 0) + (Number(form.breakBetweenMatchesMinutes) || 0)} minutos</strong> después del anterior. Para que sea cada hora en punto (9:00, 10:00, 11:00…), que estos dos números sumen 60.
      </div>
      <div style={{ marginBottom: 24 }}>
        <label className="field-label">Días en que se juega</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {[[1, 'Lun'], [2, 'Mar'], [3, 'Mié'], [4, 'Jue'], [5, 'Vie'], [6, 'Sáb'], [0, 'Dom']].map(([num, label]) => {
            const active = (form.playDays || []).includes(num);
            return (
              <button key={num} type="button"
                onClick={() => setField('playDays', active ? (form.playDays || []).filter(d => d !== num) : [...(form.playDays || []), num])}
                className={active ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm'}>
                {label}
              </button>
            );
          })}
        </div>
        <div style={{ fontSize: 12, color: '#64748B', marginTop: 8 }}>"Asignar horarios automáticamente" solo va a usar estos días. Si no quieres restringir nada, deja los 7 marcados.</div>
      </div>

      <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>Premios (se muestran en Inicio cuando el torneo termine)</div>
      <div className="grid-2" style={{ marginBottom: 24 }}>
        <div>
          <label className="field-label">Campeón</label>
          <input className="input" value={form.championText} onChange={e => setField('championText', e.target.value)} placeholder="Ej: Firewall FC" />
        </div>
        <div>
          <label className="field-label">2° Puesto</label>
          <input className="input" value={form.runnerUpText} onChange={e => setField('runnerUpText', e.target.value)} placeholder="Ej: Niupi" />
        </div>
      </div>
      <div style={{ fontSize: 12, color: '#64748B', marginTop: -14, marginBottom: 24 }}>El "Máximo Goleador" se calcula solo, no hay que escribirlo.</div>

      <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>Acceso</div>
      <div style={{ marginBottom: 24 }}>
        <label className="field-label">Correo del organizador</label>
        <input className="input" type="email" value={form.adminEmail} onChange={e => setField('adminEmail', e.target.value)} placeholder="tucorreo@ejemplo.com" />
        <div style={{ fontSize: 12, color: '#64748B', marginTop: 8, lineHeight: 1.5 }}>Solo este correo puede iniciar sesión como organizador y editar los datos. Si lo cambias por uno distinto al tuyo, perderás el acceso hasta iniciar sesión con el nuevo correo.</div>
      </div>

      <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>Respaldo</div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-outline btn-sm" onClick={onExport}><FileText size={14} /> Descargar respaldo (JSON)</button>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => document.getElementById('import-backup-file').click()}><FileText size={14} /> Restaurar desde archivo</button>
        <input id="import-backup-file" type="file" accept="application/json" style={{ display: 'none' }} onChange={handleFileSelected} />
      </div>
      {importError && <div style={{ fontSize: 13, color: '#DC2626', marginBottom: 12 }}>{importError}</div>}
      <div style={{ fontSize: 12, color: '#64748B', marginBottom: 24, lineHeight: 1.5 }}>Descarga de vez en cuando una copia por si acaso. Restaurar reemplaza TODOS los datos actuales por los del archivo — no se puede deshacer.</div>

      <div style={{ borderTop: '1px solid #E2E8F0', paddingTop: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        {confirmReset
          ? <ConfirmInline text="Esto borra TODOS los datos ¿continuar?" onConfirm={onReset} onCancel={() => setConfirmReset(false)} />
          : <button className="btn btn-danger btn-sm" onClick={() => setConfirmReset(true)}><Trash2 size={14} /> Reiniciar todos los datos</button>}
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-outline" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={() => onSave(form)}><Check size={16} /> Guardar</button>
        </div>
      </div>

      {pendingImport && (
        <Modal title="Restaurar respaldo" onClose={() => setPendingImport(null)}>
          <div style={{ fontSize: 14, color: '#1E293B', marginBottom: 20, lineHeight: 1.6 }}>
            Vas a reemplazar TODOS los datos actuales (equipos, jugadores, partidos, configuración) con los del archivo que elegiste. Esto no se puede deshacer.
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button className="btn btn-outline" onClick={() => setPendingImport(null)}>Cancelar</button>
            <button className="btn btn-danger" onClick={() => { onImport(pendingImport); setPendingImport(null); }}><Check size={16} /> Sí, reemplazar todo</button>
          </div>
        </Modal>
      )}
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
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '16px 0 8px' }}>
          <Mail size={40} color="#22C55E" style={{ marginBottom: 16 }} />
          <div style={{ fontSize: 15, color: '#0F172A', marginBottom: 8 }}>
            Te enviamos un enlace de acceso a <strong>{email}</strong>.
          </div>
          <div style={{ fontSize: 13.5, color: '#64748B', lineHeight: 1.5 }}>Ábrelo desde este mismo dispositivo para iniciar sesión. Puede tardar uno o dos minutos.</div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 24 }}>
          <button className="btn btn-outline" onClick={onClose}>Cerrar</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Hacer login" onClose={onClose}>
      <div style={{ fontSize: 14, color: '#64748B', marginBottom: 16, lineHeight: 1.5 }}>
        Escribe tu correo y te enviamos un enlace de acceso — no necesitas contraseña. Quien inicie sesión con el correo registrado como organizador podrá editar los datos del torneo; el resto solo podrá ver.
      </div>
      <div style={{ marginBottom: 16 }}>
        <label className="field-label">Correo</label>
        <input className="input" type="email" value={email} autoFocus placeholder="tucorreo@ejemplo.com"
          onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} />
      </div>
      {error && <div style={{ fontSize: 13, color: '#DC2626', marginBottom: 16 }}>{error}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <button className="btn btn-outline" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" disabled={sending} onClick={submit}>
          {sending ? <Loader2 size={16} className="spin" /> : <Send size={16} />} {sending ? 'Enviando…' : 'Enviar enlace de acceso'}
        </button>
      </div>
    </Modal>
  );
}

/* ---------- Panel derecho (partido destacado + estadísticas) ---------- */

function buildTimeline(data) {
  const all = [
    ...data.matches.map(m => ({ ...m, _label: 'Jornada ' + m.jornada, _phase: 'liga', _groupKey: m.jornada })),
    ...data.playoffMatches.map(m => ({ ...m, _label: m.round, _phase: 'playoff', _groupKey: m.round })),
  ].filter(m => m.date);
  all.sort((a, b) => (a.date + ' ' + (a.time || '00:00')).localeCompare(b.date + ' ' + (b.time || '00:00')));
  return all;
}

const PLAYOFF_ROUND_ORDER = ['Cuartos de Final', 'Semifinal', 'Tercer Puesto', 'Final'];

function MiniMatchRow({ m, teams }) {
  const teamA = teams.find(t => t.id === m.teamAId);
  const teamB = teams.find(t => t.id === m.teamBId);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0' }}>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end', minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#0F172A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{teamA ? teamA.name : '—'}</span>
        <Crest team={teamA} size="sm" />
      </div>
      <div style={{ fontSize: 13, fontWeight: 800, color: m.played ? '#0F172A' : '#CBD5E1', minWidth: 40, textAlign: 'center', flexShrink: 0 }}>
        {m.played ? m.scoreA + '-' + m.scoreB : 'vs'}
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <Crest team={teamB} size="sm" />
        <span style={{ fontSize: 13, fontWeight: 600, color: '#0F172A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{teamB ? teamB.name : '—'}</span>
      </div>
    </div>
  );
}

function MatchWidgetCard({ data }) {
  const ligaJornadas = [...new Set(data.matches.map(m => m.jornada))].sort((a, b) => a - b);
  const playoffRoundsPresent = [...new Set(data.playoffMatches.map(m => m.round))];
  const playoffRounds = PLAYOFF_ROUND_ORDER.filter(r => playoffRoundsPresent.includes(r))
    .concat(playoffRoundsPresent.filter(r => !PLAYOFF_ROUND_ORDER.includes(r)));

  const hasLiga = ligaJornadas.length > 0;
  const hasPlayoffs = playoffRounds.length > 0;

  const timeline = buildTimeline(data);
  const defaultItem = timeline.find(m => !m.played) || timeline[timeline.length - 1] || null;

  const [phase, setPhase] = useState(defaultItem ? defaultItem._phase : (hasLiga ? 'liga' : 'playoff'));
  const [groupKey, setGroupKey] = useState(defaultItem ? defaultItem._groupKey : (hasLiga ? ligaJornadas[0] : playoffRounds[0]));

  if (!hasLiga && !hasPlayoffs) {
    return (
      <div className="card" style={{ overflow: 'hidden', marginBottom: 16 }}>
        <div className="card-header-green">Juegos</div>
        <div style={{ padding: 20, fontSize: 13.5, color: '#94A3B8', textAlign: 'center' }}>Aún no hay partidos programados.</div>
      </div>
    );
  }

  const groupOptions = phase === 'liga' ? ligaJornadas : playoffRounds;
  const safeGroupKey = groupOptions.includes(groupKey) ? groupKey : groupOptions[0];
  const groupMatches = phase === 'liga'
    ? data.matches.filter(m => m.jornada === safeGroupKey)
    : data.playoffMatches.filter(m => m.round === safeGroupKey);

  const changePhase = (newPhase) => {
    setPhase(newPhase);
    const opts = newPhase === 'liga' ? ligaJornadas : playoffRounds;
    setGroupKey(opts[0]);
  };

  const metaLine = [
    phase === 'liga' ? 'Jornada ' + safeGroupKey : safeGroupKey,
    data.meta.courtName || null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="card" style={{ overflow: 'hidden', marginBottom: 16 }}>
      <div className="card-header-green" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <span>Juegos</span>
        <span style={{ display: 'flex', gap: 8 }}>
          {hasLiga && hasPlayoffs && (
            <select className="widget-select" value={phase} onChange={e => changePhase(e.target.value)}>
              <option value="liga">Fase 1 · Liga</option>
              <option value="playoff">Fase 2 · Playoffs</option>
            </select>
          )}
          <select className="widget-select" value={safeGroupKey} onChange={e => setGroupKey(phase === 'liga' ? Number(e.target.value) : e.target.value)}>
            {groupOptions.map(opt => (
              <option key={opt} value={opt}>{phase === 'liga' ? 'Jornada ' + opt : opt}</option>
            ))}
          </select>
        </span>
      </div>
      <div style={{ padding: 20 }}>
        {groupMatches.length === 0 && (
          <div style={{ fontSize: 13.5, color: '#94A3B8', textAlign: 'center', padding: '12px 0' }}>Sin partidos en esta selección.</div>
        )}

        {groupMatches.length === 1 && (() => {
          const match = groupMatches[0];
          const teamA = data.teams.find(t => t.id === match.teamAId);
          const teamB = data.teams.find(t => t.id === match.teamBId);
          return (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
                <div style={{ textAlign: 'center', flex: 1, minWidth: 0 }}>
                  <Crest team={teamA} size="lg" />
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: '#0F172A', marginTop: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{teamA ? teamA.name : '—'}</div>
                </div>
                <div style={{ textAlign: 'center', flexShrink: 0 }}>
                  {match.played
                    ? <div className="font-display" style={{ fontSize: 24, fontWeight: 800, color: '#0F172A', border: '1px solid #E2E8F0', borderRadius: 10, padding: '4px 12px' }}>{match.scoreA} : {match.scoreB}</div>
                    : <div style={{ fontSize: 14, fontWeight: 700, color: '#94A3B8', border: '1px solid #E2E8F0', borderRadius: 10, padding: '8px 14px' }}>VS</div>}
                  <div style={{ marginTop: 8 }}>
                    <span className={'status-pill ' + (match.played ? 'done' : 'pending')}>{match.played ? 'Finalizado' : 'Programado'}</span>
                  </div>
                </div>
                <div style={{ textAlign: 'center', flex: 1, minWidth: 0 }}>
                  <Crest team={teamB} size="lg" />
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: '#0F172A', marginTop: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{teamB ? teamB.name : '—'}</div>
                </div>
              </div>
              <div style={{ textAlign: 'center', fontSize: 12.5, color: '#64748B', marginTop: 16, borderTop: '1px solid #F1F5F9', paddingTop: 12 }}>
                {metaLine}{match.date ? ' · ' + formatDateTime(match.date, match.time) : ''}
              </div>
            </>
          );
        })()}

        {groupMatches.length > 1 && (
          <>
            {groupMatches.map((m, idx) => (
              <div key={m.id} style={{ borderBottom: idx === groupMatches.length - 1 ? 'none' : '1px solid #F1F5F9' }}>
                <MiniMatchRow m={m} teams={data.teams} />
              </div>
            ))}
            <div style={{ textAlign: 'center', fontSize: 12.5, color: '#64748B', marginTop: 12, borderTop: '1px solid #F1F5F9', paddingTop: 12 }}>
              {metaLine}
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
      <div style={{ padding: 20 }}>
        <div style={{ display: 'flex', gap: 24, justifyContent: 'center', marginBottom: 20 }}>
          <div style={{ textAlign: 'center' }}>
            <div className="stat-circle">{allPlayed.length}</div>
            <div style={{ fontSize: 11, color: '#64748B', marginTop: 8, fontWeight: 700 }}>PARTIDOS</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div className="stat-circle">{totalGoals}</div>
            <div style={{ fontSize: 11, color: '#64748B', marginTop: 8, fontWeight: 700 }}>GOLES</div>
          </div>
        </div>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>Goleadores</div>
        {top3.length === 0
          ? <div style={{ fontSize: 13, color: '#94A3B8' }}>Sin goles registrados todavía.</div>
          : top3.map(({ p, stats }) => {
            const team = data.teams.find(t => t.id === p.teamId);
            return (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #F1F5F9' }}>
                <Avatar size={28} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: '#0F172A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                  <div style={{ fontSize: 11.5, color: '#64748B' }}>{team ? team.name : ''}</div>
                </div>
                <div style={{ fontSize: 14, fontWeight: 800, color: '#22C55E' }}>{stats.goals}</div>
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

function Sidebar({ tab, setTab, isAdmin, sessionEmail, onOpenSettings, onLogout, onLoginClick, tournamentName, logoUrl }) {
  const [logoError, setLogoError] = useState(false);
  return (
    <div className="sidebar">
      <div className="sidebar-logo-row">
        <div className="sidebar-logo-badge">
          {logoUrl && !logoError
            ? <img src={logoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 10 }} onError={() => setLogoError(true)} />
            : <Trophy size={20} color="#fff" />}
        </div>
        <div className="sidebar-title">{tournamentName}</div>
      </div>
      <div className="sidebar-nav">
        {NAV_ITEMS.map(({ id, label, Icon }) => (
          <button key={id} className={'sidebar-nav-item' + (tab === id ? ' active' : '')} onClick={() => setTab(id)}>
            <Icon size={18} /> {label}
          </button>
        ))}
      </div>
      <div className="sidebar-footer">
        {isAdmin && <button className="sidebar-footer-link" onClick={onOpenSettings}><Settings size={16} /> Configuración</button>}
        
        <div className="sidebar-user-card">
          {sessionEmail && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 4px 8px', borderBottom: '1px solid rgba(255,255,255,0.08)', marginBottom: 4 }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg, #22C55E 0%, #16A34A 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 'bold', fontSize: 12, flexShrink: 0 }}>
                {initials(sessionEmail.split('@')[0])}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#F8FAFC', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sessionEmail.split('@')[0]}</div>
                <div style={{ fontSize: 10, color: '#94A3B8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sessionEmail}</div>
              </div>
            </div>
          )}
          <button className="sidebar-footer-link logout" onClick={sessionEmail ? onLogout : onLoginClick}>
            {sessionEmail ? <LogOut size={16} /> : <LogIn size={16} />} {sessionEmail ? 'Cerrar sesión' : 'Hacer login'}
          </button>
        </div>
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
  const [viewTeamId, setViewTeamId] = useState(null);

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

  const logoutSession = () => supabase.auth.signOut();

  useEffect(() => {
    if (!data) return;
    document.title = data.meta.name || 'Torneo de Futbolito';
    if (data.meta.logoUrl) {
      let link = document.getElementById('app-favicon');
      if (!link) {
        link = document.createElement('link');
        link.id = 'app-favicon';
        link.rel = 'icon';
        document.head.appendChild(link);
      }
      link.href = data.meta.logoUrl;
    }
  }, [data && data.meta.name, data && data.meta.logoUrl]);

  if (loading || !data) {
    return (
      <div className="futbolito-app" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <GlobalStyles />
        <div style={{ textAlign: 'center', color: '#64748B' }}>
          <Loader2 className="spin" size={32} style={{ margin: '0 auto 12px' }} />
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
  const bulkAddPlayers = (teamId, players) => update(d => ({
    ...d,
    players: [...d.players, ...players.map(p => ({
      id: uid('player'), servedSuspensions: 0, teamId,
      name: p.name, number: p.number === '' ? '' : Number(p.number), age: '',
    }))],
  }));
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
    const shuffledIds = shuffleArray(d.teams.map(t => t.id));
    let pairings = generateRoundRobin(shuffledIds);
    if (d.meta.idaYVuelta) {
      const maxJ = pairings.reduce((mx, f) => Math.max(mx, f.jornada), 0);
      const vuelta = pairings.map(f => ({ jornada: f.jornada + maxJ, teamAId: f.teamBId, teamBId: f.teamAId }));
      pairings = [...pairings, ...vuelta];
    }
    const fixture = pairings.map(f => ({
      id: uid('match'), phase: 'liga', played: false, scoreA: 0, scoreB: 0, playerStats: {}, date: '', time: '', ...f,
    }));
    return { ...d, matches: fixture };
  });

  const autoScheduleMatches = () => update(d => {
    const jornadas = [...new Set(d.matches.map(m => m.jornada))].sort((a, b) => a - b);
    const dayGroups = jornadas.map(j => d.matches.filter(m => m.jornada === j));
    const start = d.meta.startDate ? new Date(d.meta.startDate + 'T00:00:00') : new Date();
    const { matches: scheduled } = scheduleGroupsSequentially(dayGroups, d.meta, start);
    const byId = Object.fromEntries(scheduled.map(m => [m.id, m]));
    return { ...d, matches: d.matches.map(m => byId[m.id] || m) };
  });

  const autoSchedulePlayoffs = () => update(d => {
    const presentRounds = [...new Set(d.playoffMatches.map(m => m.round))];
    const groups = [];
    const used = new Set();
    PLAYOFF_DAY_GROUPS_ORDER.forEach(g => {
      const roundsHere = g.filter(r => presentRounds.includes(r));
      if (roundsHere.length > 0) { groups.push(roundsHere); roundsHere.forEach(r => used.add(r)); }
    });
    presentRounds.forEach(r => { if (!used.has(r)) groups.push([r]); });
    const dayGroups = groups.map(roundNames => d.playoffMatches.filter(m => roundNames.includes(m.round)));

    const ligaDates = d.matches.map(m => m.date).filter(Boolean).sort();
    const lastLigaDate = ligaDates.length > 0 ? ligaDates[ligaDates.length - 1] : null;
    const startFrom = lastLigaDate
      ? new Date(new Date(lastLigaDate + 'T00:00:00').getTime() + 86400000)
      : (d.meta.startDate ? new Date(d.meta.startDate + 'T00:00:00') : new Date());

    const { matches: scheduled } = scheduleGroupsSequentially(dayGroups, d.meta, startFrom);
    const byId = Object.fromEntries(scheduled.map(m => [m.id, m]));
    return { ...d, playoffMatches: d.playoffMatches.map(m => byId[m.id] || m) };
  });

  const saveSettings = (meta) => { update(d => ({ ...d, meta })); setSettingsOpen(false); };
  const resetAll = () => { update(() => defaultData()); setSettingsOpen(false); };

  const addNews = (item) => update(d => ({ ...d, news: [{ id: uid('news'), ...item }, ...(d.news || [])] }));
  const deleteNews = (id) => update(d => ({ ...d, news: (d.news || []).filter(n => n.id !== id) }));

  const exportData = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'torneo-respaldo-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const importData = (parsed) => {
    update(() => ({
      ...defaultData(),
      ...parsed,
      meta: { ...defaultData().meta, ...parsed.meta },
    }));
    setSettingsOpen(false);
  };

  const standings = computeStandings(data);

  return (
    <div className="futbolito-app">
      <GlobalStyles />
      <div className="app-shell">
        <Sidebar tab={tab} setTab={setTab} isAdmin={isAdmin} sessionEmail={sessionEmail}
          onOpenSettings={() => setSettingsOpen(true)}
          onLogout={logoutSession}
          onLoginClick={() => setLoginOpen(true)}
          tournamentName={data.meta.name} logoUrl={data.meta.logoUrl} />

        <div className="main-area">
          <div className="page-header">
            <div className="page-title">{data.meta.name}</div>
            <div className="page-subtitle">{data.meta.category || 'Futbolito'}</div>
          </div>

          {saveError && (
            <div style={{ marginBottom: 20, padding: '12px 16px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, fontSize: 13, color: '#DC2626', display: 'flex', gap: 8, alignItems: 'center' }}>
              <AlertTriangle size={16} /> {saveError}
            </div>
          )}

          {tab === 'inicio' && <InicioTab data={data} isAdmin={isAdmin} onNavigate={setTab} onViewTeam={setViewTeamId} onAddNews={addNews} onDeleteNews={deleteNews} />}

          {tab === 'tabla' && (
            <div className="two-col" style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 24, alignItems: 'start' }}>
              <TablaTab data={data} standings={standings} onViewTeam={setViewTeamId} />
              <RightColumn data={data} />
            </div>
          )}

          {tab === 'equipos' && <EquiposTab data={data} isAdmin={isAdmin} onAdd={addTeam} onEdit={editTeam} onDelete={deleteTeam} standings={standings} onViewTeam={setViewTeamId} />}
          {tab === 'jugadores' && <JugadoresTab data={data} isAdmin={isAdmin} onAdd={addPlayer} onEdit={editPlayer} onDelete={deletePlayer} onBulkAdd={bulkAddPlayers} />}
          {tab === 'partidos' && <PartidosTab data={data} isAdmin={isAdmin} onAddMatch={(p) => addMatch('liga', p)} onGenerateFixture={generateFixture}
            onAutoSchedule={autoScheduleMatches}
            onSaveResult={(id, payload) => saveMatchResult('liga', id, payload)} onDeleteMatch={(id) => deleteMatch('liga', id)}
            onSaveAnyMatch={saveMatchResult} />}
          {tab === 'playoffs' && <PlayoffsTab data={data} isAdmin={isAdmin} onAddMatch={(p) => addMatch('playoff', p)} onAutoSchedule={autoSchedulePlayoffs}
            onSaveResult={(id, payload) => saveMatchResult('playoff', id, payload)} onDeleteMatch={(id) => deleteMatch('playoff', id)}
            onSaveAnyMatch={saveMatchResult} />}
          {tab === 'sanciones' && <SancionesTab data={data} isAdmin={isAdmin} onMarkServed={markSuspensionServed} />}

          {tab === 'stats' && (
            <div className="two-col" style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 24, alignItems: 'start' }}>
              <StatsTab data={data} standings={standings} />
              <RightColumn data={data} />
            </div>
          )}
        </div>
      </div>

      {settingsOpen && isAdmin && <SettingsModal meta={data.meta} onClose={() => setSettingsOpen(false)} onSave={saveSettings} onReset={resetAll} onExport={exportData} onImport={importData} />}
      {loginOpen && <LoginModal onClose={() => setLoginOpen(false)} />}
      {viewTeamId && data.teams.find(t => t.id === viewTeamId) && (
        <TeamDetailModal team={data.teams.find(t => t.id === viewTeamId)} data={data} onClose={() => setViewTeamId(null)} />
      )}
    </div>
  );
}

/* ---------- Tabs ---------- */

function QuickStat({ label, value, isText, onClick }) {
  return (
    <button onClick={onClick} className="card" style={{ padding: '20px', textAlign: 'left', cursor: 'pointer', width: '100%', border: 'none' }}>
      <div style={{ fontSize: 11, color: '#64748B', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div className="font-display" style={{ fontSize: isText ? 16 : 28, fontWeight: 800, color: '#0F172A', marginTop: 6 }}>{value}</div>
    </button>
  );
}

function PremiosSection({ data }) {
  const withStats = data.players.map(p => ({ p, stats: getPlayerStats(p.id, data) }));
  const topScorer = [...withStats].filter(x => x.stats.goals > 0).sort((a, b) => b.stats.goals - a.stats.goals)[0];
  const hasChampion = !!data.meta.championText;
  const hasRunnerUp = !!data.meta.runnerUpText;
  if (!hasChampion && !hasRunnerUp && !topScorer) return null;

  return (
    <div className="card" style={{ padding: 24, marginBottom: 24 }}>
      <div className="font-display" style={{ fontWeight: 700, fontSize: 18, color: '#0F172A', marginBottom: 20 }}>Premios</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 20 }}>
        {hasChampion && (
          <div style={{ textAlign: 'center' }}>
            <Trophy size={36} color="#EAB308" style={{ margin: '0 auto 12px' }} />
            <div style={{ fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Campeón</div>
            <div className="font-display" style={{ fontWeight: 700, fontSize: 16, color: '#0F172A', marginTop: 6 }}>{data.meta.championText}</div>
          </div>
        )}
        {hasRunnerUp && (
          <div style={{ textAlign: 'center' }}>
            <Award size={36} color="#94A3B8" style={{ margin: '0 auto 12px' }} />
            <div style={{ fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>2° Puesto</div>
            <div className="font-display" style={{ fontWeight: 700, fontSize: 16, color: '#0F172A', marginTop: 6 }}>{data.meta.runnerUpText}</div>
          </div>
        )}
        {topScorer && (
          <div style={{ textAlign: 'center' }}>
            <BarChart3 size={36} color="#22C55E" style={{ margin: '0 auto 12px' }} />
            <div style={{ fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Máximo goleador</div>
            <div className="font-display" style={{ fontWeight: 700, fontSize: 16, color: '#0F172A', marginTop: 6 }}>{topScorer.p.name} ({topScorer.stats.goals})</div>
          </div>
        )}
      </div>
    </div>
  );
}

function InicioTab({ data, isAdmin, onNavigate, onViewTeam, onAddNews, onDeleteNews }) {
  const [rulesOpen, setRulesOpen] = useState(false);
  const [newsModalOpen, setNewsModalOpen] = useState(false);
  const [confirmDeleteNewsId, setConfirmDeleteNewsId] = useState(null);
  const news = data.news || [];
  return (
    <div>
      <div className="info-strip" style={{ marginBottom: 24 }}>
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
        <button className="btn btn-outline btn-sm" onClick={() => setRulesOpen(true)}><FileText size={14} /> Reglas del campeonato</button>
      </div>

      <div style={{ position: 'relative', height: 220, borderRadius: 16, overflow: 'hidden', marginBottom: 24, background: '#0F172A', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)' }}>
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, #22C55E 0%, #16A34A 100%)', clipPath: 'polygon(42% 0, 100% 0, 68% 100%, 0 100%)' }} />
        {!data.meta.logoUrl && <Trophy size={160} color="rgba(255,255,255,.05)" style={{ position: 'absolute', right: 24, bottom: -24 }} />}
        <div style={{ position: 'relative', zIndex: 1, height: '100%', display: 'flex', alignItems: 'center', gap: 24, padding: '0 40px' }}>
          {data.meta.logoUrl && (
            <img src={data.meta.logoUrl} alt="" style={{ width: 140, height: 140, borderRadius: 16, objectFit: 'cover', background: 'rgba(255,255,255,.15)', flexShrink: 0, boxShadow: '0 10px 25px rgba(0,0,0,.2)' }}
              onError={e => { e.currentTarget.style.display = 'none'; }} />
          )}
          <div>
            <div className="font-display" style={{ fontWeight: 800, fontSize: 36, color: '#fff', lineHeight: 1.1, maxWidth: 500, textShadow: '0 4px 10px rgba(0,0,0,0.2)' }}>{data.meta.name}</div>
            <div style={{ fontWeight: 700, fontSize: 13, color: 'rgba(255,255,255,.9)', marginTop: 12, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{data.meta.category || 'Futbolito'}</div>
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 24, marginBottom: 24 }}>
        <div className="font-display" style={{ fontWeight: 700, fontSize: 18, color: '#0F172A', marginBottom: 12 }}>Acerca de</div>
        <div style={{ fontSize: 14.5, color: '#475569', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
          {data.meta.description || 'Todavía no hay una descripción del torneo.'}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 16, marginBottom: 24 }}>
        <QuickStat label="Equipos" value={data.teams.length} onClick={() => onNavigate('equipos')} />
        <QuickStat label="Jugadores" value={data.players.length} onClick={() => onNavigate('jugadores')} />
        <QuickStat label="Partidos" value={data.matches.length + data.playoffMatches.length} onClick={() => onNavigate('partidos')} />
        <QuickStat label="Clasificación" value="Ver tabla" isText onClick={() => onNavigate('tabla')} />
      </div>

      <PremiosSection data={data} />

      <div className="card" style={{ padding: 24, marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: news.length > 0 ? 20 : 12 }}>
          <div className="font-display" style={{ fontWeight: 700, fontSize: 18, color: '#0F172A' }}>Noticias</div>
          {isAdmin && <button className="btn btn-outline btn-sm" onClick={() => setNewsModalOpen(true)}><Plus size={14} /> Agregar</button>}
        </div>
        {news.length === 0
          ? <div style={{ fontSize: 13.5, color: '#94A3B8' }}>Todavía no hay noticias publicadas.</div>
          : news.map((n, idx) => (
            <div key={n.id} style={{ display: 'flex', gap: 16, padding: '16px 0', borderTop: idx === 0 ? 'none' : '1px solid #F1F5F9' }}>
              {n.imageUrl && (
                <img src={n.imageUrl} alt="" style={{ width: 100, height: 100, borderRadius: 10, objectFit: 'cover', flexShrink: 0, border: '1px solid #E2E8F0' }}
                  onError={e => { e.currentTarget.style.display = 'none'; }} />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                  <div className="font-display" style={{ fontWeight: 700, fontSize: 16, color: '#0F172A' }}>{n.title}</div>
                  {isAdmin && (
                    confirmDeleteNewsId === n.id
                      ? <ConfirmInline text="¿Eliminar?" onConfirm={() => { onDeleteNews(n.id); setConfirmDeleteNewsId(null); }} onCancel={() => setConfirmDeleteNewsId(null)} />
                      : <button className="icon-btn-subtle" style={{ flexShrink: 0 }} onClick={() => setConfirmDeleteNewsId(n.id)}><Trash2 size={14} /></button>
                  )}
                </div>
                <div style={{ fontSize: 12, color: '#64748B', margin: '4px 0 10px' }}>{formatDate(n.date)}</div>
                {n.body && <div style={{ fontSize: 14, color: '#475569', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{n.body}</div>}
              </div>
            </div>
          ))}
      </div>

      {data.teams.length > 0 && (
        <div className="card" style={{ padding: 24, marginBottom: 24 }}>
          <div className="font-display" style={{ fontWeight: 700, fontSize: 18, color: '#0F172A', marginBottom: 20 }}>Equipos</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 20 }}>
            {data.teams.map(t => (
              <button key={t.id} onClick={() => onViewTeam(t.id)} style={{ display: 'flex', flexDirection: 'column', gap: 10, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left', transition: 'transform 0.2s' }} onMouseOver={e => e.currentTarget.style.transform = 'scale(1.05)'} onMouseOut={e => e.currentTarget.style.transform = 'scale(1)'}>
                <div style={{ position: 'relative', width: '100%', aspectRatio: '1', borderRadius: 12, overflow: 'hidden', background: t.color + '15', border: '1px solid #E2E8F0', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
                  {t.photoUrl ? (
                    <img src={t.photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      onError={e => { e.currentTarget.style.display = 'none'; }} />
                  ) : (
                    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Users size={36} color={t.color} style={{ opacity: .4 }} />
                    </div>
                  )}
                  <div style={{ position: 'absolute', left: 10, bottom: 10, filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.2))' }}>
                    <Crest team={t} size="sm" />
                  </div>
                </div>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: '#0F172A', textAlign: 'center', lineHeight: 1.3 }}>{t.name}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {data.meta.venueAddress && (
        <div className="card" style={{ padding: 24, marginBottom: 24, overflow: 'hidden' }}>
          <div className="font-display" style={{ fontWeight: 700, fontSize: 18, color: '#0F172A', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
            <MapPin size={18} color="#22C55E" /> Sitio
          </div>
          <div style={{ fontSize: 14.5, color: '#475569', marginBottom: 16 }}>{data.meta.venueAddress}</div>
          <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid #E2E8F0' }}>
            <iframe
              title="Mapa del sitio"
              width="100%"
              height="280"
              style={{ border: 0, display: 'block' }}
              loading="lazy"
              src={`https://maps.google.com/maps?q=${encodeURIComponent(data.meta.venueAddress)}&output=embed`}
            />
          </div>
        </div>
      )}

      {rulesOpen && (
        <Modal title="Reglas del campeonato" onClose={() => setRulesOpen(false)}>
          {data.meta.rulesPdfUrl && (
            <a href={data.meta.rulesPdfUrl} target="_blank" rel="noreferrer" className="btn btn-primary" style={{ marginBottom: data.meta.rules ? 20 : 0 }}>
              <FileText size={16} /> Ver / descargar PDF de reglas
            </a>
          )}
          {data.meta.rules
            ? <div style={{ fontSize: 14.5, color: '#1E293B', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{data.meta.rules}</div>
            : (!data.meta.rulesPdfUrl && (
              <div style={{ fontSize: 14, color: '#64748B' }}>{isAdmin ? 'Todavía no agregaste las reglas. Puedes escribirlas o subir un PDF en Configuración.' : 'El organizador todavía no publicó las reglas del campeonato.'}</div>
            ))}
        </Modal>
      )}
      {isAdmin && newsModalOpen && (
        <NewsFormModal onClose={() => setNewsModalOpen(false)} onSave={(item) => { onAddNews(item); setNewsModalOpen(false); }} />
      )}
    </div>
  );
}

function TablaTab({ data, standings, onViewTeam }) {
  if (data.teams.length === 0) {
    return <EmptyState Icon={Table2} title="Todavía no hay tabla" text="Agrega equipos en la pestaña Equipos para que la tabla de posiciones empiece a calcularse automáticamente." />;
  }
  const relegation = data.meta.relegationSpots || 0;
  const n = standings.length;
  return (
    <div>
      <div className="no-print" style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <button className="btn btn-outline btn-sm" onClick={() => window.print()}><FileText size={14} /> Imprimir / PDF</button>
      </div>
      <div className="card" style={{ overflowX: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>#</th><th>Equipo</th><th>Pts</th><th>PJ</th><th>PG</th><th>PE</th><th>PP</th><th>GF</th><th>GC</th><th>DIF</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((row, i) => {
              const team = data.teams.find(t => t.id === row.teamId);
              const qualifies = i < (data.meta.playoffSpots || 0);
              const relegated = relegation > 0 && i >= n - relegation;
              return (
                <tr key={row.teamId}
                  className={(i % 2 === 1 ? 'row-alt ' : '') + (qualifies ? 'zone-top' : relegated ? 'zone-bottom' : '')}>
                  <td>{i + 1}</td>
                  <td className="team-name-cell"><TeamChip team={team} size="sm" onClick={team ? () => onViewTeam(team.id) : undefined} /></td>
                  <td style={{ color: '#22C55E', fontWeight: 800 }}>{row.pts}</td>
                  <td>{row.pj}</td><td>{row.pg}</td><td>{row.pe}</td><td>{row.pp}</td>
                  <td>{row.gf}</td><td>{row.gc}</td><td>{row.dg > 0 ? '+' + row.dg : row.dg}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', gap: 20, marginTop: 12, flexWrap: 'wrap' }}>
        {data.meta.playoffSpots > 0 && (
          <div style={{ fontSize: 12, color: '#64748B', display: 'flex', alignItems: 'center', gap: 8, fontWeight: 500 }}>
            <span style={{ width: 12, height: 12, background: '#22C55E', borderRadius: 4 }} /> Clasifica a playoffs
          </div>
        )}
        {relegation > 0 && (
          <div style={{ fontSize: 12, color: '#64748B', display: 'flex', alignItems: 'center', gap: 8, fontWeight: 500 }}>
            <span style={{ width: 12, height: 12, background: '#EF4444', borderRadius: 4 }} /> Zona de alerta
          </div>
        )}
      </div>
      <div style={{ fontSize: 11.5, color: '#94A3B8', marginTop: 12 }}>
        Desempate: puntos → resultado entre ellos → diferencia de gol → goles a favor.
      </div>
    </div>
  );
}

function EquiposTab({ data, isAdmin, onAdd, onEdit, onDelete, standings, onViewTeam }) {
  const [modal, setModal] = useState(null);
  const [confirmId, setConfirmId] = useState(null);

  return (
    <div>
      {isAdmin && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 20 }}>
          <button className="btn btn-primary" onClick={() => setModal('new')}><Plus size={16} /> Agregar equipo</button>
        </div>
      )}

      {data.teams.length === 0
        ? <EmptyState Icon={Users} title="Sin equipos todavía" text="Agrega el primer equipo del campeonato para empezar a registrar jugadores y partidos." />
        : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 20 }}>
            {data.teams.map(team => {
              const row = standings.find(s => s.teamId === team.id);
              const playerCount = data.players.filter(p => p.teamId === team.id).length;
              return (
                <div key={team.id} className="team-card">
                  <div className="team-card-accent" style={{ background: team.color }} />
                  <div className="team-card-header">
                    <div className="team-card-title-group" onClick={() => onViewTeam(team.id)}>
                      <Crest team={team} size="md" />
                      <div className="team-card-title">{team.name}</div>
                    </div>
                    {isAdmin && (
                      <div className="team-card-actions">
                        <button className="icon-btn-subtle" onClick={() => setModal(team.id)}><Pencil size={14} /></button>
                        {confirmId !== team.id && <button className="icon-btn-subtle danger" onClick={() => setConfirmId(team.id)}><Trash2 size={14} /></button>}
                      </div>
                    )}
                  </div>
                  
                  <div className="team-card-body">
                    <div className="team-card-players">
                      <Users size={14} /> {playerCount} jugador{playerCount !== 1 ? 'es' : ''}
                    </div>
                    {row ? (
                      <div className="team-card-stats">
                        <span><strong>{row.pj}</strong> PJ</span>
                        <span className="dot">•</span>
                        <span><strong>{row.pts}</strong> PTS</span>
                        <span className="dot">•</span>
                        <span>DIF <strong>{row.dg}</strong></span>
                      </div>
                    ) : (
                      <div className="team-card-stats">
                        <span><strong>0</strong> PJ</span>
                        <span className="dot">•</span>
                        <span><strong>0</strong> PTS</span>
                        <span className="dot">•</span>
                        <span>DIF <strong>0</strong></span>
                      </div>
                    )}
                  </div>
                  
                  {isAdmin && confirmId === team.id && (
                    <div style={{ padding: '0 16px 16px' }}>
                      <ConfirmInline text="¿Eliminar equipo?" onConfirm={() => { onDelete(team.id); setConfirmId(null); }} onCancel={() => setConfirmId(null)} />
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

function JugadoresTab({ data, isAdmin, onAdd, onEdit, onDelete, onBulkAdd }) {
  const [modal, setModal] = useState(null);
  const [filterTeam, setFilterTeam] = useState('all');
  const [confirmId, setConfirmId] = useState(null);

  const filtered = data.players.filter(p => filterTeam === 'all' || p.teamId === filterTeam);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <select className="input" style={{ width: 240 }} value={filterTeam} onChange={e => setFilterTeam(e.target.value)}>
          <option value="all">Todos los equipos</option>
          {data.teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        {isAdmin && (
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-outline" disabled={data.teams.length === 0} onClick={() => setModal('bulk')}><FileText size={16} /> Pegar lista</button>
            <button className="btn btn-primary" disabled={data.teams.length === 0} onClick={() => setModal('new')}><Plus size={16} /> Agregar jugador</button>
          </div>
        )}
      </div>

      {data.teams.length === 0 && <div style={{ fontSize: 14, color: '#64748B', marginBottom: 16 }}>Crea al menos un equipo antes de registrar jugadores.</div>}

      {filtered.length === 0
        ? <EmptyState Icon={User} title="Sin jugadores" text="Agrega jugadores y asígnalos a un equipo para llevar sus goles y tarjetas." />
        : (
          <>
            <div className="card" style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead><tr><th>Jugador</th><th style={{textAlign: 'center'}}>#</th><th>Equipo</th><th>Edad</th>{isAdmin && <th></th>}</tr></thead>
                <tbody>
                  {filtered.map((p, idx) => {
                    const team = data.teams.find(t => t.id === p.teamId);
                    const ac = ageColor(p.age);
                    return (
                      <tr key={p.id}>
                        <td className="team-name-cell">
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
                            <Avatar size={32} />
                            <span style={{fontWeight: 500, fontSize: 14.5}}>{p.name}</span>
                          </span>
                        </td>
                        <td style={{textAlign: 'center'}}>
                          {p.number !== '' && p.number !== undefined 
                            ? <span className="dorsal-text">#{p.number}</span> 
                            : <span style={{color: '#94A3B8'}}>—</span>}
                        </td>
                        <td><TeamChip team={team} size="md" /></td>
                        <td>
                          {p.age !== '' && p.age !== undefined
                            ? <span style={{ fontSize: 12.5, fontWeight: 700, padding: '4px 12px', borderRadius: 8, background: ac.bg, color: ac.fg, boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>{p.age}</span>
                            : <span style={{ color: '#CBD5E1' }}>—</span>}
                        </td>
                        {isAdmin && (
                          <td>
                            {confirmId === p.id
                              ? <ConfirmInline text="¿Eliminar?" onConfirm={() => { onDelete(p.id); setConfirmId(null); }} onCancel={() => setConfirmId(null)} />
                              : (
                                <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                                  <button className="icon-btn-subtle" onClick={() => setModal(p.id)}><Pencil size={14} /></button>
                                  <button className="icon-btn-subtle danger" onClick={() => setConfirmId(p.id)}><Trash2 size={14} /></button>
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
          <div style={{ display: 'flex', gap: 20, marginTop: 16, flexWrap: 'wrap', fontSize: 12, color: '#64748B', fontWeight: 500 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ width: 12, height: 12, borderRadius: 4, background: '#10B981' }} /> 39 o menos</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ width: 12, height: 12, borderRadius: 4, background: '#F97316' }} /> 40 a 49</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ width: 12, height: 12, borderRadius: 4, background: '#EF4444' }} /> 50 o más</span>
          </div>
          </>
        )}

      {isAdmin && modal === 'new' && <PlayerFormModal teams={data.teams} defaultTeamId={filterTeam !== 'all' ? filterTeam : undefined} onClose={() => setModal(null)} onSave={(p) => { onAdd(p); setModal(null); }} />}
      {isAdmin && modal === 'bulk' && (
        <BulkPlayersModal teams={data.teams} defaultTeamId={filterTeam !== 'all' ? filterTeam : undefined}
          onClose={() => setModal(null)} onSave={(teamId, players) => { onBulkAdd(teamId, players); setModal(null); }} />
      )}
      {isAdmin && modal && modal !== 'new' && modal !== 'bulk' && (
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
    <div key={j} style={{ marginBottom: 24 }}>
      <div className="font-display" style={{ fontSize: 14, fontWeight: 700, color: '#64748B', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Jornada {j}</div>
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
      style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px', cursor: isClickable ? 'pointer' : 'default', borderBottom: last ? 'none' : '1px solid #F1F5F9', transition: 'background 0.2s' }}
      onMouseOver={e => isClickable && (e.currentTarget.style.background = '#F8FAFC')}
      onMouseOut={e => isClickable && (e.currentTarget.style.background = 'transparent')}>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'flex-end', minWidth: 0 }}>
        <span style={{ fontSize: 14.5, fontWeight: 600, color: '#0F172A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{teamA ? teamA.name : 'Equipo eliminado'}</span>
        <Crest team={teamA} size="md" />
      </div>
      <div style={{ minWidth: 80, textAlign: 'center', flexShrink: 0 }}>
        <div className="font-display" style={{ fontWeight: 800, fontSize: 16, color: m.played ? '#0F172A' : '#94A3B8' }}>
          {m.played ? m.scoreA + ' - ' + m.scoreB : 'vs'}
        </div>
        <span className={'status-pill ' + (m.played ? 'done' : 'pending')} style={{ marginTop: 4 }}>{m.played ? 'Finalizado' : 'Pendiente'}</span>
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
        <Crest team={teamB} size="md" />
        <span style={{ fontSize: 14.5, fontWeight: 600, color: '#0F172A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{teamB ? teamB.name : 'Equipo eliminado'}</span>
      </div>
      {m.date && <div style={{ fontSize: 12.5, color: '#64748B', width: 110, textAlign: 'right', flexShrink: 0 }}>{formatDateTime(m.date, m.time)}</div>}
    </div>
  );
}

function PartidosTab({ data, isAdmin, onAddMatch, onGenerateFixture, onAutoSchedule, onSaveResult, onDeleteMatch, onSaveAnyMatch }) {
  const [modal, setModal] = useState(null);
  const [confirmGenerate, setConfirmGenerate] = useState(false);
  const [confirmSchedule, setConfirmSchedule] = useState(false);
  const openMatch = data.matches.find(m => m.id === modal);
  const maxJornada = data.matches.reduce((mx, m) => Math.max(mx, m.jornada || 0), 0);

  return (
    <div>
      {isAdmin && (
        <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {data.teams.length >= 2 && (
              confirmGenerate
                ? <ConfirmInline text={data.matches.length > 0 ? 'Esto borra el fixture actual ¿continuar?' : (data.meta.idaYVuelta ? '¿Generar fixture ida y vuelta?' : '¿Generar fixture todos-contra-todos?')} onConfirm={() => { onGenerateFixture(); setConfirmGenerate(false); }} onCancel={() => setConfirmGenerate(false)} />
                : <button className="btn btn-outline" onClick={() => setConfirmGenerate(true)}><Calendar size={16} /> {data.matches.length > 0 ? 'Regenerar fixture' : (data.meta.idaYVuelta ? 'Generar fixture (ida y vuelta)' : 'Generar fixture (todos vs todos)')}</button>
            )}
            {data.matches.length > 0 && (
              confirmSchedule
                ? <ConfirmInline text="Esto reemplaza fecha y hora de todos los partidos ¿continuar?" onConfirm={() => { onAutoSchedule(); setConfirmSchedule(false); }} onCancel={() => setConfirmSchedule(false)} />
                : <button className="btn btn-outline" onClick={() => setConfirmSchedule(true)}><Clock size={16} /> Asignar horarios automáticamente</button>
            )}
          </div>
          <button className="btn btn-primary" disabled={data.teams.length < 2} onClick={() => setModal('new')}><Plus size={16} /> Agregar partido manual</button>
        </div>
      )}

      {data.matches.length > 0 && (
        <div className="no-print" style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
          <button className="btn btn-outline btn-sm" onClick={() => window.print()}><FileText size={14} /> Imprimir / PDF</button>
        </div>
      )}

      {isAdmin && data.matches.length > 0 && (
        <div style={{ fontSize: 13, color: '#64748B', marginBottom: 20, lineHeight: 1.5 }}>
          Cancha: {data.meta.courtName || 'sin nombre (configúrala en Configuración)'} · cada jornada completa se juega en un solo día ({formatPlayDays(data.meta.playDays)}), empezando a las {data.meta.dailyStartTime}, {data.meta.matchDurationMinutes} min por partido + {data.meta.breakBetweenMatchesMinutes} min de descanso.
        </div>
      )}

      {data.teams.length < 2 && <EmptyState Icon={Calendar} title="Faltan equipos" text="Necesitas al menos dos equipos para generar el fixture o agregar partidos." />}

      {data.teams.length >= 2 && data.matches.length === 0 && (
        <EmptyState Icon={Calendar} title="Todavía no hay partidos" text={isAdmin ? 'Genera el fixture automático de liga o agrega partidos manualmente.' : 'El organizador todavía no publicó el fixture.'} />
      )}

      {data.matches.length > 0 && <MatchList matches={data.matches} teams={data.teams} groupByJornada clickable onOpenResult={(m) => setModal(m.id)} />}

      {isAdmin && modal === 'new' && (
        <MatchFormModal teams={data.teams} phase="liga" suggestedJornada={maxJornada + 1 || 1}
          onClose={() => setModal(null)} onSave={(p) => { onAddMatch(p); setModal(null); }} />
      )}
      {openMatch && (
        isAdmin
          ? <MatchResultModal match={openMatch} teams={data.teams} players={data.players} allMatches={[...data.matches, ...data.playoffMatches]} onSwap={onSaveAnyMatch}
              onClose={() => setModal(null)}
              onSave={(payload) => { onSaveResult(openMatch.id, payload); setModal(null); }}
              onDelete={(id) => { onDeleteMatch(id); setModal(null); }} />
          : <MatchDetailModal match={openMatch} teams={data.teams} players={data.players} onClose={() => setModal(null)} />
      )}
    </div>
  );
}

const BRACKET_ROUNDS = ['Cuartos de Final', 'Semifinal', 'Final'];
const BRACKET_SLOT_BASE_HEIGHT = 70;
const BRACKET_CARD_WIDTH = 230;
const BRACKET_GAP_WIDTH = 48;

function buildConnectorPath(count, slotHeight, gapWidth) {
  let d = '';
  const midX = gapWidth / 2;
  for (let i = 0; i < count; i += 2) {
    const y1 = i * slotHeight + slotHeight / 2;
    const y2 = (i + 1) * slotHeight + slotHeight / 2;
    const ymid = (y1 + y2) / 2;
    d += `M0,${y1} H${midX} M0,${y2} H${midX} M${midX},${y1} V${y2} M${midX},${ymid} H${gapWidth} `;
  }
  return d;
}

function BracketMatchCard({ m, teams, onOpen }) {
  const teamA = teams.find(t => t.id === m.teamAId);
  const teamB = teams.find(t => t.id === m.teamBId);
  return (
    <button onClick={onOpen} className="card" style={{ width: BRACKET_CARD_WIDTH, padding: 0, overflow: 'hidden', cursor: 'pointer', textAlign: 'left', display: 'block', transition: 'box-shadow 0.2s', border: '1px solid #E2E8F0' }} onMouseOver={e => e.currentTarget.style.boxShadow = '0 4px 6px -1px rgba(0,0,0,0.1)'} onMouseOut={e => e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.05)'}>
      {[[teamA, m.scoreA], [teamB, m.scoreB]].map(([t, score], idx) => (
        <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderBottom: idx === 0 ? '1px solid #F1F5F9' : 'none' }}>
          <Crest team={t} size="sm" />
          <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#0F172A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t ? t.name : 'Por definir'}</span>
          <span style={{ fontSize: 14, fontWeight: 800, color: m.played ? '#0F172A' : '#94A3B8', flexShrink: 0 }}>{m.played ? score : '–'}</span>
        </div>
      ))}
    </button>
  );
}

function canRenderBracket(data) {
  const presentRounds = BRACKET_ROUNDS.filter(r => data.playoffMatches.some(m => m.round === r));
  if (presentRounds.length === 0) return false;
  const roundMatches = presentRounds.map(r => data.playoffMatches.filter(m => m.round === r));
  if (roundMatches[0].length < 2) return false;
  for (let i = 1; i < roundMatches.length; i++) {
    if (roundMatches[i - 1].length !== roundMatches[i].length * 2) return false;
  }
  return true;
}

function PlayoffBracket({ data, onOpenMatch }) {
  const presentRounds = BRACKET_ROUNDS.filter(r => data.playoffMatches.some(m => m.round === r));
  const roundMatches = presentRounds.map(r => data.playoffMatches.filter(m => m.round === r));
  const thirdPlace = data.playoffMatches.filter(m => m.round === 'Tercer Puesto');

  if (!canRenderBracket(data)) return null;

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ overflowX: 'auto', paddingBottom: 16 }}>
        <div style={{ display: 'flex', width: 'fit-content', marginBottom: 12 }}>
          {roundMatches.map((matches, ri) => (
            <Fragment key={ri}>
              <div style={{ width: BRACKET_CARD_WIDTH, textAlign: 'center', fontSize: 13, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{presentRounds[ri]}</div>
              {ri < roundMatches.length - 1 && <div style={{ width: BRACKET_GAP_WIDTH, flexShrink: 0 }} />}
            </Fragment>
          ))}
        </div>
        <div style={{ display: 'flex', width: 'fit-content' }}>
          {roundMatches.map((matches, ri) => {
            const slotHeight = BRACKET_SLOT_BASE_HEIGHT * Math.pow(2, ri);
            return (
              <Fragment key={ri}>
                <div style={{ width: BRACKET_CARD_WIDTH, display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
                  {matches.map(m => (
                    <div key={m.id} style={{ height: slotHeight, display: 'flex', alignItems: 'center' }}>
                      <BracketMatchCard m={m} teams={data.teams} onOpen={() => onOpenMatch(m.id)} />
                    </div>
                  ))}
                </div>
                {ri < roundMatches.length - 1 && (
                  <svg width={BRACKET_GAP_WIDTH} height={matches.length * slotHeight} style={{ flexShrink: 0 }}>
                    <path d={buildConnectorPath(matches.length, slotHeight, BRACKET_GAP_WIDTH)} stroke="#22C55E" strokeWidth="2.5" fill="none" opacity="0.6" />
                  </svg>
                )}
              </Fragment>
            );
          })}
        </div>
      </div>

      {thirdPlace.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>Tercer Puesto</div>
          {thirdPlace.map(m => (
            <div key={m.id} style={{ marginBottom: 12 }}><BracketMatchCard m={m} teams={data.teams} onOpen={() => onOpenMatch(m.id)} /></div>
          ))}
        </div>
      )}
    </div>
  );
}

function PlayoffsTab({ data, isAdmin, onAddMatch, onAutoSchedule, onSaveResult, onDeleteMatch, onSaveAnyMatch }) {
  const [modal, setModal] = useState(null);
  const [confirmSchedule, setConfirmSchedule] = useState(false);
  const openMatch = data.playoffMatches.find(m => m.id === modal);

  return (
    <div>
      {isAdmin && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
          <div>
            {data.playoffMatches.length > 0 && (
              confirmSchedule
                ? <ConfirmInline text="Esto reemplaza fecha y hora de todos los partidos de playoffs ¿continuar?" onConfirm={() => { onAutoSchedule(); setConfirmSchedule(false); }} onCancel={() => setConfirmSchedule(false)} />
                : <button className="btn btn-outline" onClick={() => setConfirmSchedule(true)}><Clock size={16} /> Asignar horarios automáticamente</button>
            )}
          </div>
          <button className="btn btn-primary" disabled={data.teams.length < 2} onClick={() => setModal('new')}><Plus size={16} /> Agregar partido de playoffs</button>
        </div>
      )}

      {isAdmin && data.playoffMatches.length > 0 && (
        <div style={{ fontSize: 13, color: '#64748B', marginBottom: 20, lineHeight: 1.5 }}>
          Cada ronda se juega completa en un solo día ({formatPlayDays(data.meta.playDays)}): cuartos, luego semis, y tercer puesto + final juntos el último día. Empieza el día siguiente al último partido de liga programado.
        </div>
      )}

      {data.teams.length < 2 && <EmptyState Icon={Award} title="Faltan equipos" text="Registra equipos antes de armar el cuadro de playoffs." />}
      {data.teams.length >= 2 && data.playoffMatches.length === 0 && (
        <EmptyState Icon={Award} title="Aún no hay cuadro de playoffs" text={isAdmin ? 'Cuando termine la fase de liga, agrega aquí semifinales, final y demás cruces.' : 'El organizador todavía no publicó el cuadro de playoffs.'} />
      )}

      {data.playoffMatches.length > 0 && canRenderBracket(data) && (
        <PlayoffBracket data={data} onOpenMatch={(id) => setModal(id)} />
      )}

      {data.playoffMatches.length > 0 && !canRenderBracket(data) && (
        <>
          {isAdmin && (
            <div style={{ fontSize: 13, color: '#94A3B8', marginBottom: 20 }}>
              El cuadro visual aparece cuando cada ronda tiene exactamente la mitad de partidos que la anterior (ej. 4 cuartos → 2 semis → 1 final). Mientras tanto, se muestra como lista.
            </div>
          )}
          {['Cuartos de Final', 'Semifinal', 'Tercer Puesto', 'Final'].concat(
            [...new Set(data.playoffMatches.map(m => m.round))].filter(r => !['Cuartos de Final', 'Semifinal', 'Tercer Puesto', 'Final'].includes(r))
          ).map(round => {
            const matches = data.playoffMatches.filter(m => m.round === round);
            if (matches.length === 0) return null;
            return (
              <div key={round} style={{ marginBottom: 24 }}>
                <div className="font-display" style={{ fontSize: 14, fontWeight: 700, color: '#64748B', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{round}</div>
                <div className="card">
                  {matches.map((m, idx) => <MatchRow key={m.id} m={m} teams={data.teams} clickable onOpen={() => setModal(m.id)} last={idx === matches.length - 1} />)}
                </div>
              </div>
            );
          })}
        </>
      )}

      {isAdmin && modal === 'new' && (
        <MatchFormModal teams={data.teams} phase="playoff" onClose={() => setModal(null)} onSave={(p) => { onAddMatch(p); setModal(null); }} />
      )}
      {openMatch && (
        isAdmin
          ? <MatchResultModal match={openMatch} teams={data.teams} players={data.players} allMatches={[...data.matches, ...data.playoffMatches]} onSwap={onSaveAnyMatch}
              onClose={() => setModal(null)}
              onSave={(payload) => { onSaveResult(openMatch.id, payload); setModal(null); }}
              onDelete={(id) => { onDeleteMatch(id); setModal(null); }} />
          : <MatchDetailModal match={openMatch} teams={data.teams} players={data.players} onClose={() => setModal(null)} />
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
      <div style={{ background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 12, padding: 16, fontSize: 13.5, color: '#065F46', marginBottom: 24, display: 'flex', gap: 12, alignItems: 'flex-start', lineHeight: 1.5 }}>
        <ShieldAlert size={18} style={{ flexShrink: 0, marginTop: 2 }} color="#059669" />
        <span>Un jugador queda suspendido automáticamente al acumular {data.meta.yellowLimit} amarillas (el conteo se reinicia después) o al recibir 1 tarjeta roja ({data.meta.redSuspensionMatches} partido{data.meta.redSuspensionMatches !== 1 ? 's' : ''} de sanción). Marca "cumplido" cuando el jugador ya se perdió ese encuentro.</span>
      </div>

      <div className="font-display" style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', marginBottom: 12 }}>Jugadores suspendidos</div>
      {suspended.length === 0
        ? <div style={{ fontSize: 14, color: '#94A3B8', marginBottom: 32 }}>No hay jugadores suspendidos actualmente.</div>
        : (
          <div className="card" style={{ marginBottom: 32 }}>
            {suspended.map(({ p, stats }, idx) => {
              const team = data.teams.find(t => t.id === p.teamId);
              return (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px', flexWrap: 'wrap', borderBottom: idx === suspended.length - 1 ? 'none' : '1px solid #F1F5F9' }}>
                  <Avatar size={36} />
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <div style={{ fontWeight: 700, fontSize: 14.5, color: '#0F172A' }}>{p.name}</div>
                    <div style={{ fontSize: 12.5, marginTop: 2 }}><TeamChip team={team} size="sm" /></div>
                  </div>
                  <CardBadge yellow={stats.yellow} red={stats.red} />
                  <div style={{ fontSize: 13.5, color: '#DC2626', fontWeight: 700, minWidth: 140, textAlign: 'center' }}>
                    {stats.pending} partido{stats.pending !== 1 ? 's' : ''} pendiente{stats.pending !== 1 ? 's' : ''}
                  </div>
                  {isAdmin && <button className="btn btn-outline btn-sm" onClick={() => onMarkServed(p.id)}>Marcar cumplido</button>}
                </div>
              );
            })}
          </div>
        )}

      <div className="font-display" style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', marginBottom: 12 }}>A una amarilla de la sanción</div>
      {warning.length === 0
        ? <div style={{ fontSize: 14, color: '#94A3B8' }}>Nadie está en riesgo por acumulación de amarillas.</div>
        : (
          <div className="card">
            {warning.map(({ p, stats }, idx) => {
              const team = data.teams.find(t => t.id === p.teamId);
              return (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px', borderBottom: idx === warning.length - 1 ? 'none' : '1px solid #F1F5F9' }}>
                  <Avatar size={36} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 14.5, color: '#0F172A' }}>{p.name}</div>
                    <div style={{ fontSize: 12.5, marginTop: 2 }}><TeamChip team={team} size="sm" /></div>
                  </div>
                  <div style={{ fontSize: 13.5, color: '#D97706', fontWeight: 700 }}>{stats.yellowSinceReset} / {stats.yellowLimit} amarillas</div>
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
    <div className="card" style={{ padding: 20 }}>
      <div className="font-display" style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', marginBottom: 12 }}>{label}</div>
      {list.length === 0 ? <div style={{ fontSize: 13, color: '#94A3B8' }}>Sin datos todavía.</div> : list.map(({ p, stats }, i) => {
        const team = data.teams.find(t => t.id === p.teamId);
        return (
          <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid #F1F5F9' }}>
            <span style={{ width: 20, fontSize: 13, color: '#64748B', fontWeight: 800, flexShrink: 0, textAlign: 'center' }}>{i + 1}</span>
            <Avatar size={32} />
            <span style={{ flex: 1, fontSize: 14, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <span style={{ color: '#0F172A', fontWeight: 600 }}>{p.name}</span>{' '}
              <span style={{ color: '#64748B', fontSize: 12 }}>{team ? team.name : ''}</span>
            </span>
            {cardType && <CardBadge yellow={cardType === 'yellow' ? stats[valueKey] : 0} red={cardType === 'red' ? stats[valueKey] : 0} />}
            <span style={{ fontWeight: 800, color: '#22C55E', fontSize: 14.5 }}>{stats[valueKey]}</span>
          </div>
        );
      })}
    </div>
  );

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px,1fr))', gap: 16, marginBottom: 24 }}>
        <div className="card" style={{ padding: 20, textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: '#64748B', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Mejor ataque</div>
          <div className="font-display" style={{ fontSize: 18, fontWeight: 800, color: '#0F172A', marginTop: 8 }}>{bestAttack ? teamName(data.teams, bestAttack.teamId) : '—'}</div>
          <div style={{ color: '#22C55E', fontWeight: 700, fontSize: 14, marginTop: 4 }}>{bestAttack ? bestAttack.gf + ' goles' : ''}</div>
        </div>
        <div className="card" style={{ padding: 20, textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: '#64748B', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Mejor defensa</div>
          <div className="font-display" style={{ fontSize: 18, fontWeight: 800, color: '#0F172A', marginTop: 8 }}>{bestDefense ? teamName(data.teams, bestDefense.teamId) : '—'}</div>
          <div style={{ color: '#22C55E', fontWeight: 700, fontSize: 14, marginTop: 4 }}>{bestDefense ? bestDefense.gc + ' recibidos' : ''}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px,1fr))', gap: 20 }}>
        {ranking(topScorers, 'goals', 'Goleadores')}
        {ranking(topYellow, 'yellow', 'Más amarillas', 'yellow')}
        {ranking(topRed, 'red', 'Más rojas', 'red')}
      </div>
    </div>
  );
}