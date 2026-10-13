import { useState, useEffect, useCallback, useRef, Fragment } from 'react';
import {
  Trophy, Users, User, Calendar, ShieldAlert, BarChart3, Settings,
  Plus, Trash2, X, AlertTriangle, Check, Pencil, Table2, Award, Loader2,
  LogIn, LogOut, Mail, Home, FileText, UserCircle2, Send, Clock, MapPin, Search, ArrowUpRight
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

// Añade la vuelta de las jornadas 1–5 sin cambiar ningún partido existente.
function createReturnLeg(data) {
  if (data.matches.some(m => Number(m.jornada) >= 6 && Number(m.jornada) <= 10)) {
    return { error: 'Ya hay partidos en las fechas 6 a 10. Se conservaron todos los datos y no se creó otra vuelta.' };
  }

  const groups = [1, 2, 3, 4, 5].map(jornada =>
    data.matches.filter(m => Number(m.jornada) === jornada)
      .slice().sort((a, b) => (a.time || '').localeCompare(b.time || ''))
  );
  if (groups.some(group => group.length === 0)) {
    return { error: 'Primero deben estar registradas las cinco primeras fechas.' };
  }
  for (const group of groups) {
    if (group.some(m => !/^([01]\d|2[0-3]):[0-5]\d$/.test(m.time || '')) ||
        new Set(group.map(m => m.time)).size !== group.length) {
      return { error: 'Revisa los horarios de las cinco primeras fechas: cada partido necesita una hora válida y distinta dentro de su fecha.' };
    }
  }

  const firstLegDates = groups.flat().map(m => m.date).filter(Boolean).sort();
  const lastDate = firstLegDates[firstLegDates.length - 1];
  if (!lastDate || !/^\d{4}-\d{2}-\d{2}$/.test(lastDate)) {
    return { error: 'Registra el día de las primeras cinco fechas para poder programar la vuelta.' };
  }
  let currentDate = new Date(lastDate + 'T00:00:00');
  if (isNaN(currentDate.getTime())) {
    return { error: 'Revisa el día registrado en las primeras cinco fechas.' };
  }
  const configuredDays = Array.isArray(data.meta.playDays)
    ? data.meta.playDays.filter(day => Number.isInteger(day) && day >= 0 && day <= 6)
    : [];
  const playDays = configuredDays.length > 0 ? configuredDays : [0, 1, 2, 3, 4, 5, 6];
  const occupiedSlots = new Set([...data.matches, ...data.playoffMatches].map(m => m.date + '|' + m.time));
  const newMatches = [];

  for (let index = 0; index < groups.length; index++) {
    do {
      currentDate.setDate(currentDate.getDate() + 1);
    } while (!playDays.includes(currentDate.getDay()));
    const date = currentDate.getFullYear() + '-' +
      String(currentDate.getMonth() + 1).padStart(2, '0') + '-' +
      String(currentDate.getDate()).padStart(2, '0');
    const group = groups[index];
    let shuffled = shuffleArray(group);
    // Repite el sorteo si salió exactamente el mismo orden de la ida.
    for (let attempt = 0; attempt < 10 && group.length > 1 &&
      shuffled.every((m, slot) => m.id === group[slot].id); attempt++) {
      shuffled = shuffleArray(group);
    }
    if (group.length > 1 && shuffled.every((m, slot) => m.id === group[slot].id)) {
      shuffled.push(shuffled.shift());
    }

    for (let slot = 0; slot < shuffled.length; slot++) {
      const time = group[slot].time;
      if (occupiedSlots.has(date + '|' + time)) {
        return { error: 'Ya hay un partido programado el ' + formatDateTime(date, time) + '. Se conservaron todos los datos y no se creó la vuelta.' };
      }
      occupiedSlots.add(date + '|' + time);
      newMatches.push({
        id: uid('match'), phase: 'liga', jornada: index + 6,
        teamAId: shuffled[slot].teamAId, teamBId: shuffled[slot].teamBId,
        date, time, played: false, scoreA: 0, scoreB: 0, playerStats: {},
      });
    }
  }
  return { matches: newMatches, firstDate: newMatches[0].date };
}

// Asigna fecha y hora a una lista de partidos (en el orden dado), uno detrás de otro,
// sin cruces, respetando una sola cancha: cada partido empieza cuando termina el
// descanso del anterior, y si no cabe antes de la hora de cierre, pasa al día siguiente.
// Motor de horarios: recibe una lista de "grupos" de partidos (cada grupo se juega
// completo el mismo día, en el orden dado) y los va colocando en los próximos días
// habilitados en meta.playDays, uno detrás de otro dentro del día según duración/descanso.
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
  // 0=domingo, 1=lunes, ... 6=sábado (getDay() de JS). Si no hay ninguno elegido, se juega todos los días.
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

  // Desempate: puntos, diferencia de gol y goles a favor.
  return table.sort((a, b) => b.pts - a.pts || b.dg - a.dg || b.gf - a.gf);
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

// La ficha solo lee estadísticas guardadas de encuentros finalizados.
function getPlayerProfile(playerId, data) {
  const goalsOf = (stats) => {
    const goals = Number(stats?.goals);
    return Number.isFinite(goals) ? Math.max(0, goals) : 0;
  };
  const allMatches = [
    ...data.matches.map(m => ({ ...m, phase: 'liga' })),
    ...data.playoffMatches.map(m => ({ ...m, phase: 'playoff' })),
  ];
  const history = allMatches.filter(m => m.played && m.playerStats?.[playerId]).map(m => ({
    id: m.id, phase: m.phase, jornada: m.jornada, round: m.round,
    label: m.phase === 'liga' ? 'Fecha ' + m.jornada : (m.round || 'Playoffs'),
    date: m.date || '', time: m.time || '',
    teamAId: m.teamAId, teamBId: m.teamBId, scoreA: m.scoreA, scoreB: m.scoreB,
    goals: goalsOf(m.playerStats[playerId]),
    yellow: m.playerStats[playerId].yellow ? 1 : 0,
    red: m.playerStats[playerId].red ? 1 : 0,
  })).sort((a, b) => ((a.date || '9999-99-99') + ' ' + a.time)
    .localeCompare((b.date || '9999-99-99') + ' ' + b.time) ||
    (Number(a.jornada) || 0) - (Number(b.jornada) || 0));
  const goals = history.reduce((sum, m) => sum + m.goals, 0);
  const scoringMatches = history.filter(m => m.goals > 0);
  const rank = goals > 0 ? 1 + data.players.filter(p => p.id !== playerId &&
    allMatches.reduce((sum, m) => sum + (m.played ? goalsOf(m.playerStats?.[p.id]) : 0), 0) > goals
  ).length : null;
  return {
    goals, history, scoringMatches, rank,
    matchesRecorded: history.length,
    average: history.length ? goals / history.length : 0,
    yellow: history.reduce((sum, m) => sum + m.yellow, 0),
    red: history.reduce((sum, m) => sum + m.red, 0),
    bestGoals: history.reduce((max, m) => Math.max(max, m.goals), 0),
    doubles: history.filter(m => m.goals === 2).length,
    threePlus: history.filter(m => m.goals >= 3).length,
  };
}

function teamName(teams, id) {
  const t = teams.find(t => t.id === id);
  return t ? t.name : 'Equipo eliminado';
}

function normalizeSearchText(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function getTeamPlayers(data, teamId, query = '') {
  if (!teamId || !data.teams.some(t => t.id === teamId)) return [];
  const term = normalizeSearchText(query);
  const numberTerm = term.replace(/^#/, '');
  return data.players.filter(p => p.teamId === teamId && (!term ||
    normalizeSearchText(p.name).includes(term) ||
    (numberTerm && String(p.number ?? '').includes(numberTerm))));
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
      .player-profile-trigger { font: inherit; color: inherit; text-align: left; background: transparent; border: 0; border-radius: 8px; cursor: pointer; }
      .player-profile-trigger:hover { background: #F0FDF4 !important; color: #15803D; }
      .player-profile-trigger:focus-visible { outline: 2px solid #16A34A; outline-offset: 3px; }
      .player-profile-layer > .modal-overlay { z-index: 70; }
      .player-profile-layer .modal-box h3 { min-width: 0; overflow-wrap: anywhere; }
      .player-profile-layer .modal-box > div:first-child > button { flex-shrink: 0; }
      .player-profile-hero { background: linear-gradient(135deg, #0B1121, #183B32); border-radius: 16px; color: #fff; padding: 22px; display: flex; align-items: center; gap: 16px; margin-bottom: 16px; }
      .player-profile-initials { width: 64px; height: 64px; flex-shrink: 0; border-radius: 18px; display: flex; align-items: center; justify-content: center; background: #22C55E; color: #052E16; font-size: 22px; font-weight: 800; }
      .player-profile-identity { min-width: 0; flex: 1; }
      .player-profile-name { font-size: 22px; font-weight: 800; line-height: 1.3; overflow-wrap: anywhere; }
      .player-profile-team { display: flex; align-items: center; gap: 8px; margin-top: 7px; font-size: 12.5px; color: #D1FAE5; }
      .player-profile-meta { font-size: 12px; color: #CBD5E1; margin-top: 10px; line-height: 1.5; }
      .player-profile-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-bottom: 12px; }
      .player-profile-stat { border: 1px solid #E2E8F0; border-radius: 12px; padding: 14px 16px; background: #F8FAFC; }
      .player-profile-stat.primary { background: #ECFDF5; border-color: #BBF7D0; }
      .player-profile-stat-label { display: flex; gap: 7px; align-items: center; font-size: 11px; color: #64748B; font-weight: 700; }
      .player-profile-stat-value { font-size: 28px; font-weight: 800; color: #0F172A; line-height: 1.2; margin-top: 8px; }
      .player-profile-stat.primary .player-profile-stat-value { color: #15803D; }
      .player-profile-stat small { display: block; color: #64748B; font-size: 10.5px; margin-top: 4px; line-height: 1.4; }
      .player-profile-extras { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 20px; }
      .player-profile-chip { display: inline-flex; gap: 6px; align-items: center; padding: 7px 10px; border-radius: 8px; font-size: 11px; font-weight: 600; background: #F1F5F9; color: #475569; }
      .player-profile-chart { border: 1px solid #E2E8F0; border-radius: 12px; padding: 16px; margin-bottom: 20px; }
      .player-profile-heading { font-weight: 700; font-size: 14px; color: #0F172A; margin-bottom: 12px; }
      .player-profile-bars { display: flex; align-items: flex-end; gap: 12px; overflow-x: auto; padding: 3px 2px 8px; }
      .player-profile-bar-item { flex: 1 0 36px; min-width: 36px; text-align: center; }
      .player-profile-bar-track { height: 82px; display: flex; align-items: flex-end; justify-content: center; }
      .player-profile-bar { width: 22px; border-radius: 5px 5px 0 0; background: linear-gradient(#4ADE80, #16A34A); }
      .player-profile-bar-count { font-size: 12px; font-weight: 800; color: #15803D; margin-bottom: 5px; }
      .player-profile-bar-label { font-size: 10px; color: #64748B; font-weight: 600; margin-top: 7px; }
      .player-profile-tabs { display: flex; gap: 6px; background: #F1F5F9; padding: 5px; border-radius: 10px; margin-bottom: 14px; }
      .player-profile-tabs button { flex: 1; border: 0; border-radius: 7px; padding: 10px 6px; font: inherit; font-size: 11.5px; font-weight: 700; cursor: pointer; background: transparent; color: #64748B; }
      .player-profile-tabs button[aria-pressed="true"] { background: #fff; color: #15803D; box-shadow: 0 1px 3px rgba(15,23,42,.08); }
      .player-profile-tabs button:focus-visible { outline: 2px solid #16A34A; }
      .player-profile-history { display: grid; gap: 10px; }
      .player-profile-match { border: 1px solid #E2E8F0; border-radius: 12px; padding: 14px; }
      .player-profile-match-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; font-size: 10.5px; color: #64748B; }
      .player-profile-match-teams { display: flex; align-items: center; gap: 9px; }
      .player-profile-match-team { flex: 1; min-width: 0; display: flex; gap: 6px; align-items: center; font-size: 12px; font-weight: 600; color: #0F172A; overflow-wrap: anywhere; }
      .player-profile-score { flex-shrink: 0; padding: 5px 8px; border-radius: 7px; background: #F1F5F9; color: #0F172A; font-size: 14px; font-weight: 800; }
      .player-profile-match-bottom { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; border-top: 1px solid #F1F5F9; margin-top: 12px; padding-top: 10px; }
      .player-profile-goals { font-size: 12px; font-weight: 800; color: #15803D; }
      .player-profile-record { font-size: 10px; font-weight: 700; border-radius: 5px; padding: 3px 6px; background: #ECFDF5; color: #15803D; }
      .player-profile-note { font-size: 11px; line-height: 1.6; color: #64748B; margin: 16px 0 0; }
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
      
      /* ==========================================================================
         MEJORAS VISUALES v2 · Tema "Estadio" (solo CSS, aditivo: no cambia nada
         de la lógica; si quieres quitarlo, borra desde aquí hasta "FIN MEJORAS")
         ========================================================================== */

      @property --ft-angle { syntax: '<angle>'; initial-value: 0deg; inherits: false; }

      .futbolito-app {
        --ft-green: #059669; --ft-teal: #0D9488; --ft-cyan: #0891B2; --ft-lime: #A3E635; --ft-gold: #FBBF24;
        --ft-grad: linear-gradient(135deg, #059669 0%, #0D9488 50%, #0891B2 100%);
        --ft-grad-soft: linear-gradient(135deg, #ECFDF5 0%, #ECFEFF 100%);
        --ft-glow: 0 10px 26px -8px rgba(5, 150, 105, 0.55);
        --ft-ease: cubic-bezier(0.22, 1, 0.36, 1);
        --ft-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
        background:
          radial-gradient(900px 520px at 100% -8%, rgba(16, 185, 129, 0.12), transparent 60%),
          radial-gradient(760px 520px at -10% 108%, rgba(6, 182, 212, 0.12), transparent 60%),
          #F4F7FB;
        background-attachment: fixed;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
        text-rendering: optimizeLegibility;
      }
      .futbolito-app ::selection { background: rgba(16, 185, 129, 0.28); color: #052E16; }
      .futbolito-app button { -webkit-tap-highlight-color: transparent; }
      .futbolito-app table.data-table td,
      .futbolito-app .stat-circle,
      .futbolito-app .font-display { font-variant-numeric: tabular-nums; }

      /* ---------- Animaciones base ---------- */
      @keyframes ftPageIn { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes ftPop { 0% { opacity: 0; transform: scale(0.82) translateY(8px); } 100% { opacity: 1; transform: scale(1) translateY(0); } }
      @keyframes ftFloat { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
      @keyframes ftGlow { 0%, 100% { box-shadow: 0 4px 12px rgba(16, 185, 129, 0.18); } 50% { box-shadow: 0 6px 22px rgba(6, 182, 212, 0.42); } }
      @keyframes ftBreathe { 0%, 100% { box-shadow: 0 4px 12px -2px rgba(5, 150, 105, 0.35); } 50% { box-shadow: 0 8px 22px -2px rgba(8, 145, 178, 0.55); } }
      @keyframes ftSweep { 0% { transform: translateX(-130%); } 60%, 100% { transform: translateX(130%); } }
      @keyframes ftShift { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }
      @keyframes ftRow { from { opacity: 0; transform: translateX(-10px); } to { opacity: 1; transform: translateX(0); } }
      @keyframes ftBar { from { transform: scaleY(0); } to { transform: scaleY(1); } }
      @keyframes ftDot { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.6); opacity: 0.45; } }
      @keyframes ftRing { to { --ft-angle: 360deg; } }
      @keyframes ftModal { from { opacity: 0; transform: translateY(26px) scale(0.96); } to { opacity: 1; transform: translateY(0) scale(1); } }
      @keyframes ftSheet { from { transform: translateY(100%); } to { transform: translateY(0); } }
      @keyframes ftWiggle { 0%, 100% { transform: rotate(0); } 25% { transform: rotate(-12deg) scale(1.1); } 75% { transform: rotate(10deg) scale(1.1); } }

      /* Entrada escalonada al cambiar de pestaña (no afecta a los modales) */
      .main-area > div > *:not(.modal-overlay):not(.player-profile-layer) { animation: ftPageIn 0.55s var(--ft-ease) backwards; }
      .main-area > div > *:nth-child(2) { animation-delay: 0.05s; }
      .main-area > div > *:nth-child(3) { animation-delay: 0.1s; }
      .main-area > div > *:nth-child(4) { animation-delay: 0.15s; }
      .main-area > div > *:nth-child(5) { animation-delay: 0.2s; }
      .main-area > div > *:nth-child(6) { animation-delay: 0.25s; }
      .main-area > div > *:nth-child(n+7) { animation-delay: 0.3s; }
      .page-header { animation: ftPageIn 0.5s var(--ft-ease) backwards; }

      /* ---------- Título de página ---------- */
      .page-title {
        position: relative; padding-bottom: 14px;
        background: linear-gradient(90deg, #0F172A 0%, #064E3B 55%, #0E7490 100%);
        -webkit-background-clip: text; background-clip: text;
        -webkit-text-fill-color: transparent; color: transparent;
      }
      .page-title::after { content: ''; position: absolute; left: 0; bottom: 0; width: 56px; height: 4px; border-radius: 4px; background: var(--ft-grad); transition: width 0.5s var(--ft-ease); }
      .page-header:hover .page-title::after { width: 120px; }
      .page-subtitle { letter-spacing: 0.02em; }

      /* ---------- Tarjetas ---------- */
      .card { border-color: #E3EAF3; box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04), 0 4px 14px -6px rgba(15, 23, 42, 0.08); transition: box-shadow 0.3s, border-color 0.3s, transform 0.3s var(--ft-ease); }
      .card-header-green { background: var(--ft-grad); background-size: 200% 200%; animation: ftShift 9s ease infinite; letter-spacing: 0.02em; position: relative; }
      .info-strip { position: relative; overflow: hidden; background: linear-gradient(135deg, #FFFFFF 0%, #F0FDFA 100%); border-color: #CCFBF1; }
      .info-strip::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 5px; background: var(--ft-grad); }
      .info-strip-item { transition: transform 0.3s var(--ft-spring); }
      .info-strip-item .val { background: linear-gradient(90deg, #0F172A, #065F46); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }

      /* Stats rápidas del Inicio (Equipos / Jugadores / Partidos / Clasificación) */
      button.card.quick-stat { position: relative; overflow: hidden; background: linear-gradient(150deg, #FFFFFF 0%, #F0FDF4 100%); border: 1px solid #D1FAE5 !important; animation: ftPop 0.6s var(--ft-spring) backwards; transition: transform 0.3s var(--ft-spring), box-shadow 0.3s, border-color 0.3s; }
      button.card.quick-stat::before { content: ''; position: absolute; left: 0; right: 0; top: 0; height: 4px; background: var(--ft-grad); }
      button.card.quick-stat::after { content: ''; position: absolute; inset: 0; background: linear-gradient(110deg, transparent 30%, rgba(16, 185, 129, 0.16) 50%, transparent 70%); transform: translateX(-130%); transition: transform 0.7s var(--ft-ease); pointer-events: none; }
      button.card.quick-stat .font-display { background: var(--ft-grad); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; color: transparent !important; display: inline-block; transition: transform 0.35s var(--ft-spring); transform-origin: left center; }
      button.card.quick-stat:nth-child(2) { animation-delay: 0.08s; }
      button.card.quick-stat:nth-child(3) { animation-delay: 0.16s; }
      button.card.quick-stat:nth-child(4) { animation-delay: 0.24s; }
      button.card.quick-stat:active { transform: scale(0.96); }

      /* Círculos de estadísticas (Partidos / Goles) con anillo giratorio */
      .stat-circle {
        border: 3px solid transparent;
        background: linear-gradient(#FFFFFF, #FFFFFF) padding-box, conic-gradient(from var(--ft-angle, 0deg), #10B981, #06B6D4, #A3E635, #10B981) border-box;
        animation: ftPop 0.7s var(--ft-spring) backwards, ftRing 5s linear infinite, ftGlow 3.4s ease-in-out infinite;
        transition: transform 0.35s var(--ft-spring);
        cursor: default;
      }
      .stat-circle { background-clip: padding-box, border-box; }

      /* Tarjetas de equipo */
      .team-card { transition: transform 0.35s var(--ft-spring), box-shadow 0.35s, border-color 0.35s; animation: ftPop 0.55s var(--ft-spring) backwards; }
      .team-card:nth-child(2) { animation-delay: 0.05s; } .team-card:nth-child(3) { animation-delay: 0.1s; }
      .team-card:nth-child(4) { animation-delay: 0.15s; } .team-card:nth-child(5) { animation-delay: 0.2s; }
      .team-card:nth-child(n+6) { animation-delay: 0.25s; }
      .team-card-accent { height: 5px; overflow: hidden; }
      .team-card-accent::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.75), transparent); animation: ftSweep 3.2s ease-in-out infinite; }
      .team-card .crest, .team-card img { transition: transform 0.4s var(--ft-spring); }
      .team-card:active { transform: scale(0.98); }

      /* ---------- Botones: brillo, rebote de iconos y feedback ---------- */
      .btn {
        position: relative; overflow: hidden; isolation: isolate;
        transition: transform 0.25s var(--ft-spring), box-shadow 0.3s, background-position 0.6s var(--ft-ease), background-color 0.2s, border-color 0.2s, color 0.2s;
      }
      .btn::before { content: ''; position: absolute; inset: 0; z-index: -1; background: linear-gradient(110deg, transparent 30%, rgba(255, 255, 255, 0.38) 50%, transparent 70%); transform: translateX(-130%); transition: transform 0.65s var(--ft-ease); pointer-events: none; }
      .btn svg { transition: transform 0.35s var(--ft-spring); }
      .btn:active { transform: scale(0.94); }
      .btn-primary { background: linear-gradient(120deg, #059669 0%, #0D9488 50%, #0891B2 100%); background-size: 200% 100%; box-shadow: 0 6px 16px -6px rgba(5, 150, 105, 0.6); }
      .btn-primary:not(:disabled) { animation: ftBreathe 3.2s ease-in-out infinite; }
      .btn-primary:disabled { animation: none; }
      .btn-outline::before { background: linear-gradient(110deg, transparent 30%, rgba(16, 185, 129, 0.2) 50%, transparent 70%); }
      .btn-danger::before { background: linear-gradient(110deg, transparent 30%, rgba(239, 68, 68, 0.22) 50%, transparent 70%); }
      .btn:disabled { cursor: not-allowed; }

      .icon-btn, .icon-btn-subtle { transition: transform 0.3s var(--ft-spring), background 0.2s, border-color 0.2s, color 0.2s, box-shadow 0.2s; }
      .icon-btn:active, .icon-btn-subtle:active { transform: scale(0.88); }
      .swatch { transition: transform 0.25s var(--ft-spring), box-shadow 0.2s; }
      .swatch:hover { transform: scale(1.25) rotate(8deg); }

      .btn:focus-visible, .icon-btn:focus-visible, .icon-btn-subtle:focus-visible, button.card:focus-visible {
        outline: 3px solid rgba(6, 182, 212, 0.55); outline-offset: 2px;
      }

      /* ---------- Formularios ---------- */
      .input, textarea.textarea { border-color: #CFD8E3; transition: border-color 0.25s, box-shadow 0.25s, background 0.25s, transform 0.2s; }
      .input:hover, textarea.textarea:hover { border-color: #94A3B8; }
      .input:focus, textarea.textarea:focus { border-color: #0D9488; box-shadow: 0 0 0 4px rgba(13, 148, 136, 0.16); }
      div:focus-within > label.field-label { color: #0D9488; }
      label.field-label { transition: color 0.2s; }
      select.input { appearance: none; -webkit-appearance: none; padding-right: 38px; cursor: pointer; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%230D9488' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 12px center; }
      input[type='color'] { width: 34px; height: 34px; padding: 2px; border: 1px solid #CFD8E3; border-radius: 8px; background: #FFFFFF; cursor: pointer; transition: transform 0.25s var(--ft-spring); }
      input[type='color']:hover { transform: scale(1.12); }
      .checkbox-row input { accent-color: #0D9488; transition: transform 0.2s var(--ft-spring); }
      .checkbox-row:active input { transform: scale(0.8); }

      /* Selectores del widget "Juegos" sobre la cabecera de color */
      .widget-select { appearance: none; -webkit-appearance: none; background: rgba(255, 255, 255, 0.18) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E") no-repeat right 10px center; color: #FFFFFF; border: 1px solid rgba(255, 255, 255, 0.4); border-radius: 8px; padding: 6px 30px 6px 12px; font-family: 'Inter', sans-serif; font-size: 12.5px; font-weight: 600; cursor: pointer; transition: background-color 0.2s, border-color 0.2s, transform 0.2s var(--ft-spring); }
      .widget-select:hover { background-color: rgba(255, 255, 255, 0.3); }
      .widget-select:active { transform: scale(0.96); }
      .widget-select:focus { outline: none; border-color: #FFFFFF; box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.28); }
      .widget-select option { color: #0F172A; background: #FFFFFF; }

      /* ---------- Tablas ---------- */
      table.data-table th { background: linear-gradient(180deg, #FFFFFF 0%, #F1F8F6 100%); color: #475569; border-bottom: 2px solid #CCFBF1; }
      table.data-table tbody tr { animation: ftRow 0.45s var(--ft-ease) backwards; }
      table.data-table tbody tr:nth-child(1) { animation-delay: 0.03s; } table.data-table tbody tr:nth-child(2) { animation-delay: 0.07s; }
      table.data-table tbody tr:nth-child(3) { animation-delay: 0.11s; } table.data-table tbody tr:nth-child(4) { animation-delay: 0.15s; }
      table.data-table tbody tr:nth-child(5) { animation-delay: 0.19s; } table.data-table tbody tr:nth-child(6) { animation-delay: 0.23s; }
      table.data-table tbody tr:nth-child(7) { animation-delay: 0.27s; } table.data-table tbody tr:nth-child(8) { animation-delay: 0.31s; }
      table.data-table tbody tr:nth-child(n+9) { animation-delay: 0.35s; }
      table.data-table tbody tr:last-child td { border-bottom: none; }
      table.data-table td { transition: background 0.2s, box-shadow 0.2s; }
      table.data-table tbody tr.row-alt td { background: #FAFCFE; }
      table.data-table tbody tr.zone-top td { background: #F0FDF4; }
      table.data-table tbody tr.zone-top td:first-child { box-shadow: inset 5px 0 0 #10B981; font-weight: 800; color: #047857; }
      table.data-table tbody tr.zone-bottom td { background: #FFF1F2; }
      table.data-table tbody tr.zone-bottom td:first-child { box-shadow: inset 5px 0 0 #F43F5E; font-weight: 800; color: #BE123C; }
      table.data-table tbody tr:hover td { background: #ECFDF5; }
      table.data-table tbody tr.zone-bottom:hover td { background: #FFE4E6; }
      table.data-table tbody tr:hover td:first-child { box-shadow: inset 5px 0 0 #0D9488; }

      /* ---------- Escudos, avatares y chips ---------- */
      .crest { box-shadow: 0 3px 8px rgba(15, 23, 42, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.3); transition: transform 0.35s var(--ft-spring); }
      .avatar-circle { background: linear-gradient(135deg, #F0FDFA 0%, #E0F2FE 100%); border-color: #CCFBF1; color: #0D9488; transition: transform 0.3s var(--ft-spring); }
      .card-chip { transition: transform 0.25s var(--ft-spring); }
      .card-chip:hover { transform: rotate(-12deg) scale(1.25); }
      .status-pill { display: inline-flex; align-items: center; gap: 6px; }
      .status-pill::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; animation: ftDot 1.8s ease-in-out infinite; }
      .status-pill.done { background: #ECFDF5; color: #047857; border: 1px solid #A7F3D0; }
      .status-pill.done::before { animation: none; }
      .status-pill.pending { background: #FFFBEB; color: #B45309; border: 1px solid #FDE68A; }

      .player-profile-trigger { transition: background 0.2s, color 0.2s, transform 0.25s var(--ft-spring); }

      /* ---------- Perfil del jugador ---------- */
      .player-profile-hero { position: relative; overflow: hidden; background: linear-gradient(135deg, #0B1121, #0F3D33 45%, #0B4A5C, #0B1121); background-size: 220% 220%; animation: ftShift 10s ease infinite; box-shadow: 0 14px 30px -14px rgba(8, 145, 178, 0.6); }
      .player-profile-hero::before { content: ''; position: absolute; width: 220px; height: 220px; right: -60px; top: -80px; border-radius: 50%; background: radial-gradient(circle, rgba(163, 230, 53, 0.35), transparent 65%); }
      .player-profile-hero > * { position: relative; z-index: 1; }
      .player-profile-initials { background: linear-gradient(135deg, #A3E635, #10B981); box-shadow: 0 8px 20px -4px rgba(163, 230, 53, 0.55); animation: ftPop 0.7s var(--ft-spring) backwards 0.1s; transition: transform 0.35s var(--ft-spring); }
      .player-profile-initials:hover { transform: rotate(-6deg) scale(1.08); }
      .player-profile-stat { background: linear-gradient(150deg, #FFFFFF, #F8FAFC); animation: ftPop 0.55s var(--ft-spring) backwards; transition: transform 0.3s var(--ft-spring), box-shadow 0.3s, border-color 0.3s; }
      .player-profile-stat:nth-child(1) { animation-delay: 0.1s; } .player-profile-stat:nth-child(2) { animation-delay: 0.18s; }
      .player-profile-stat:nth-child(3) { animation-delay: 0.26s; } .player-profile-stat:nth-child(4) { animation-delay: 0.34s; }
      .player-profile-stat.primary { background: linear-gradient(150deg, #ECFDF5, #CFFAFE); border-color: #99F6E4; }
      .player-profile-stat.primary .player-profile-stat-value { background: var(--ft-grad); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
      .player-profile-chip { transition: transform 0.25s var(--ft-spring), background 0.2s; }
      .player-profile-chip:hover { transform: translateY(-2px); background: #CCFBF1; }
      .player-profile-bar { transform-origin: bottom center; background: linear-gradient(#A3E635, #10B981 55%, #0891B2); animation: ftBar 0.9s var(--ft-ease) backwards; transition: filter 0.2s; }
      .player-profile-bar-item:nth-child(1) .player-profile-bar { animation-delay: 0.1s; } .player-profile-bar-item:nth-child(2) .player-profile-bar { animation-delay: 0.16s; }
      .player-profile-bar-item:nth-child(3) .player-profile-bar { animation-delay: 0.22s; } .player-profile-bar-item:nth-child(4) .player-profile-bar { animation-delay: 0.28s; }
      .player-profile-bar-item:nth-child(5) .player-profile-bar { animation-delay: 0.34s; } .player-profile-bar-item:nth-child(n+6) .player-profile-bar { animation-delay: 0.4s; }
      .player-profile-bar-item:hover .player-profile-bar { filter: brightness(1.15) saturate(1.2); }
      .player-profile-tabs button { transition: background 0.25s, color 0.25s, box-shadow 0.25s, transform 0.2s var(--ft-spring); }
      .player-profile-tabs button:active { transform: scale(0.94); }
      .player-profile-tabs button[aria-pressed="true"] { color: #0F766E; box-shadow: 0 4px 12px -4px rgba(13, 148, 136, 0.4); }
      .player-profile-match { transition: transform 0.3s var(--ft-spring), box-shadow 0.3s, border-color 0.3s; animation: ftPop 0.45s var(--ft-spring) backwards; }

      /* ---------- Modales ---------- */
      .modal-overlay { backdrop-filter: blur(7px) saturate(130%); background: rgba(6, 12, 28, 0.62); }
      .modal-box { border: none; overflow: hidden; box-shadow: 0 34px 70px -18px rgba(2, 6, 23, 0.55), 0 0 0 1px rgba(15, 23, 42, 0.06); animation: ftModal 0.4s var(--ft-spring); }
      .modal-box::before { content: ''; display: block; height: 5px; background: var(--ft-grad); background-size: 200% 100%; animation: ftShift 6s ease infinite; }
      .modal-box > div:first-child { background: linear-gradient(135deg, #F0FDF4 0%, #ECFEFF 60%, #FFFFFF 100%); border-bottom-color: #CCFBF1 !important; }
      .modal-box h3 { background: linear-gradient(90deg, #0F172A, #065F46); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
      .modal-box .icon-btn-subtle:hover { transform: rotate(90deg); background: #FEE2E2; color: #DC2626; }

      .empty-state-anim { animation: ftFloat 3s ease-in-out infinite; }
      .spin { animation: spin 0.9s linear infinite; }

      /* ---------- Scrollbar con color ---------- */
      .futbolito-app ::-webkit-scrollbar-thumb { background: linear-gradient(180deg, #6EE7B7, #22D3EE); border-radius: 6px; }
      .futbolito-app ::-webkit-scrollbar-thumb:hover { background: linear-gradient(180deg, #34D399, #06B6D4); }

      /* ---------- Efectos de mouse (solo equipos con puntero; en celular no se "pegan") ---------- */
      @media (hover: hover) and (pointer: fine) {
        .card:hover { box-shadow: 0 2px 4px rgba(15, 23, 42, 0.04), 0 18px 34px -14px rgba(8, 145, 178, 0.28); border-color: #BAE6FD; }
        button.card.quick-stat:hover { transform: translateY(-6px) scale(1.03); box-shadow: 0 18px 34px -12px rgba(5, 150, 105, 0.5); border-color: #6EE7B7 !important; }
        button.card.quick-stat:hover::after { transform: translateX(130%); }
        button.card.quick-stat:hover .font-display { transform: scale(1.12); }
        button.card:not(.quick-stat):hover { transform: translateY(-2px); }
        .stat-circle:hover { transform: scale(1.14) rotate(-5deg); }
        .info-strip-item:hover { transform: translateY(-2px); }
        .team-card:hover { transform: translateY(-6px) scale(1.01); box-shadow: 0 22px 36px -14px rgba(8, 145, 178, 0.35); border-color: #99F6E4; }
        .team-card:hover .crest, .team-card:hover img { transform: rotate(-6deg) scale(1.12); }
        .btn:hover:not(:disabled) { transform: translateY(-2px); }
        .btn:hover:not(:disabled)::before { transform: translateX(130%); }
        .btn:hover:not(:disabled) svg:not(.spin) { transform: scale(1.18) rotate(-8deg); }
        .btn-primary:hover:not(:disabled) { background-position: 100% 0; box-shadow: 0 12px 24px -8px rgba(8, 145, 178, 0.7); }
        .btn-outline:hover:not(:disabled) { border-color: #0D9488; color: #0F766E; background: #F0FDFA; box-shadow: 0 8px 18px -8px rgba(13, 148, 136, 0.4); }
        .btn-danger:hover:not(:disabled) { box-shadow: 0 8px 18px -6px rgba(220, 38, 38, 0.5); }
        .icon-btn:hover { transform: translateY(-2px) rotate(-6deg); border-color: #0D9488; color: #0F766E; box-shadow: 0 8px 16px -8px rgba(13, 148, 136, 0.5); }
        .icon-btn-subtle:hover { transform: scale(1.12); }
        .avatar-circle:hover { transform: scale(1.12); }
        .crest:hover { transform: rotate(-8deg) scale(1.15); }
        .player-profile-stat:hover { transform: translateY(-4px); box-shadow: 0 14px 24px -12px rgba(8, 145, 178, 0.4); border-color: #67E8F9; }
        .player-profile-match:hover { transform: translateY(-3px); box-shadow: 0 12px 22px -12px rgba(15, 23, 42, 0.25); border-color: #99F6E4; }
        .player-profile-trigger:hover { transform: translateX(3px); }
      }

      /* ---------- Rankings (Goleadores / Más amarillas / Más rojas) ---------- */
      @keyframes ftGrow { from { transform: scaleX(0); } to { transform: scaleX(1); } }
      .ranking-card { position: relative; overflow: hidden; padding: 20px 18px 12px !important; }
      .ranking-card::before { content: ''; position: absolute; left: 0; right: 0; top: 0; height: 5px; background: var(--rk); }
      .ranking-card.goals { --rk: var(--ft-grad); --rk-solid: #047857; --rk-soft: #ECFDF5; --rk-ring: rgba(16, 185, 129, 0.35); }
      .ranking-card.yellow { --rk: linear-gradient(90deg, #FDE047, #F59E0B); --rk-solid: #B45309; --rk-soft: #FFFBEB; --rk-ring: rgba(245, 158, 11, 0.4); }
      .ranking-card.red { --rk: linear-gradient(90deg, #FB7185, #DC2626); --rk-solid: #B91C1C; --rk-soft: #FEF2F2; --rk-ring: rgba(239, 68, 68, 0.4); }
      .ranking-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
      .ranking-title { display: flex; align-items: center; gap: 10px; font-size: 16px; font-weight: 700; color: #0F172A; }
      .ranking-title svg { color: var(--rk-solid); }
      .ranking-title .card-chip { width: 14px; height: 19px; }
      .ranking-count { font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 999px; background: var(--rk-soft); color: var(--rk-solid); }
      .ranking-empty { font-size: 13px; color: #94A3B8; padding: 18px 0 14px; text-align: center; }
      .player-profile-trigger.rank-row { width: 100%; display: flex; align-items: center; gap: 12px; padding: 11px 8px; border-radius: 14px; border: 0; border-bottom: 1px solid #F1F5F9; transition: background 0.25s, transform 0.25s var(--ft-spring); animation: ftRow 0.45s var(--ft-ease) backwards; }
      .player-profile-trigger.rank-row:last-child { border-bottom-color: transparent; }
      .player-profile-trigger.rank-row:nth-of-type(1) { animation-delay: 0.05s; } .player-profile-trigger.rank-row:nth-of-type(2) { animation-delay: 0.1s; }
      .player-profile-trigger.rank-row:nth-of-type(3) { animation-delay: 0.15s; } .player-profile-trigger.rank-row:nth-of-type(4) { animation-delay: 0.2s; }
      .player-profile-trigger.rank-row:nth-of-type(5) { animation-delay: 0.25s; } .player-profile-trigger.rank-row:nth-of-type(n+6) { animation-delay: 0.3s; }
      .player-profile-trigger.rank-row:hover { background: var(--rk-soft) !important; color: inherit; }
      .player-profile-trigger.rank-row:focus-visible { outline: 2px solid var(--rk-solid); outline-offset: 2px; }
      .rank-pos { width: 28px; height: 28px; flex-shrink: 0; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-family: 'Poppins', sans-serif; font-size: 12.5px; font-weight: 800; color: #64748B; background: #F1F5F9; }
      .rank-pos.p1 { background: linear-gradient(135deg, #FDE68A, #F59E0B); color: #78350F; box-shadow: 0 4px 10px -3px rgba(245, 158, 11, 0.7); }
      .rank-pos.p2 { background: linear-gradient(135deg, #F8FAFC, #CBD5E1); color: #334155; box-shadow: 0 4px 10px -3px rgba(100, 116, 139, 0.5); }
      .rank-pos.p3 { background: linear-gradient(135deg, #FED7AA, #FB923C); color: #7C2D12; box-shadow: 0 4px 10px -3px rgba(251, 146, 60, 0.6); }
      .rank-avatar { flex-shrink: 0; display: inline-flex; border-radius: 50%; box-shadow: 0 0 0 2px #FFFFFF, 0 0 0 4px var(--tc, #CBD5E1); }
      .rank-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; text-align: left; }
      .rank-name { font-size: 14px; font-weight: 700; color: #0F172A; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .rank-team { font-size: 11.5px; color: #64748B; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .rank-track { display: block; height: 6px; border-radius: 99px; background: #EEF2F7; overflow: hidden; margin-top: 6px; }
      .rank-fill { display: block; height: 100%; border-radius: 99px; background: var(--rk); transform-origin: left center; animation: ftGrow 0.9s var(--ft-ease) backwards 0.2s; }
      .rank-value { flex-shrink: 0; min-width: 48px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; padding: 6px 11px; border-radius: 11px; font-family: 'Poppins', sans-serif; font-weight: 800; font-size: 15px; background: var(--rk-soft); color: var(--rk-solid); box-shadow: inset 0 0 0 1px var(--rk-ring); }
      .rank-value .card-chip { width: 10px; height: 14px; }

      /* ---------- Mejor ataque / Mejor defensa ---------- */
      .stat-highlight { display: flex; align-items: center; gap: 16px; padding: 18px 20px; position: relative; overflow: hidden; animation: ftPop 0.55s var(--ft-spring) backwards; }
      .stat-highlight::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 5px; background: var(--ft-grad); }
      .stat-highlight.attack { background: linear-gradient(135deg, #FFFFFF 40%, #ECFDF5); }
      .stat-highlight.defense { background: linear-gradient(135deg, #FFFFFF 40%, #ECFEFF); }
      .stat-highlight.defense::before { background: linear-gradient(180deg, #0891B2, #6366F1); }
      .stat-highlight-icon { width: 46px; height: 46px; flex-shrink: 0; border-radius: 14px; display: flex; align-items: center; justify-content: center; color: #FFFFFF; background: var(--ft-grad); box-shadow: var(--ft-glow); transition: transform 0.4s var(--ft-spring); }
      .stat-highlight.defense .stat-highlight-icon { background: linear-gradient(135deg, #0891B2, #6366F1); box-shadow: 0 10px 24px -8px rgba(99, 102, 241, 0.6); }
      .stat-highlight-body { min-width: 0; }
      .stat-highlight-label { font-size: 11px; color: #64748B; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; }
      .stat-highlight-name { font-size: 18px; font-weight: 800; color: #0F172A; margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .stat-highlight-value { font-size: 13px; font-weight: 700; color: #059669; margin-top: 2px; }
      .stat-highlight.defense .stat-highlight-value { color: #0E7490; }

      /* ---------- Ficha de tarjetas (rojas / amarillas) ---------- */
      .player-profile-hero.red { background: linear-gradient(135deg, #1A0B12, #5B1226 45%, #8B1E2E, #1A0B12); background-size: 220% 220%; box-shadow: 0 14px 30px -14px rgba(220, 38, 38, 0.65); }
      .player-profile-hero.red::before { background: radial-gradient(circle, rgba(251, 113, 133, 0.4), transparent 65%); }
      .player-profile-hero.red .player-profile-initials { background: linear-gradient(135deg, #FB7185, #DC2626); color: #FFFFFF; box-shadow: 0 8px 20px -4px rgba(244, 63, 94, 0.6); }
      .player-profile-hero.red .player-profile-kicker { color: #FDA4AF !important; }
      .player-profile-hero.yellow { background: linear-gradient(135deg, #1C1405, #5B3D05 45%, #92400E, #1C1405); background-size: 220% 220%; box-shadow: 0 14px 30px -14px rgba(245, 158, 11, 0.65); }
      .player-profile-hero.yellow::before { background: radial-gradient(circle, rgba(253, 224, 71, 0.4), transparent 65%); }
      .player-profile-hero.yellow .player-profile-initials { background: linear-gradient(135deg, #FDE047, #F59E0B); color: #422006; box-shadow: 0 8px 20px -4px rgba(250, 204, 21, 0.6); }
      .player-profile-hero.yellow .player-profile-kicker { color: #FDE68A !important; }
      .player-profile-stat.primary.red { background: linear-gradient(150deg, #FFF1F2, #FFE4E6); border-color: #FECDD3; }
      .player-profile-stat.primary.yellow { background: linear-gradient(150deg, #FFFBEB, #FEF3C7); border-color: #FDE68A; }
      .player-profile-stat.primary.red .player-profile-stat-value { background: linear-gradient(135deg, #F43F5E, #B91C1C); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
      .player-profile-stat.primary.yellow .player-profile-stat-value { background: linear-gradient(135deg, #F59E0B, #B45309); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
      .player-profile-stat-label .card-chip { width: 10px; height: 14px; }
      .player-profile-card-shape { width: 24px; height: 34px; border-radius: 5px; border: 2px dashed #CBD5E1; background: transparent; transform-origin: bottom center; animation: ftBar 0.7s var(--ft-ease) backwards; }
      .player-profile-card-shape.on { border: none; transform: rotate(-6deg); }
      .player-profile-card-shape.on.yellow { background: linear-gradient(160deg, #FDE047, #F59E0B); box-shadow: 0 8px 14px -6px rgba(245, 158, 11, 0.8); }
      .player-profile-card-shape.on.red { background: linear-gradient(160deg, #FB7185, #DC2626); box-shadow: 0 8px 14px -6px rgba(220, 38, 38, 0.8); }
      .player-profile-bar-item:nth-child(1) .player-profile-card-shape { animation-delay: 0.1s; } .player-profile-bar-item:nth-child(2) .player-profile-card-shape { animation-delay: 0.16s; }
      .player-profile-bar-item:nth-child(3) .player-profile-card-shape { animation-delay: 0.22s; } .player-profile-bar-item:nth-child(4) .player-profile-card-shape { animation-delay: 0.28s; }
      .player-profile-bar-item:nth-child(5) .player-profile-card-shape { animation-delay: 0.34s; } .player-profile-bar-item:nth-child(n+6) .player-profile-card-shape { animation-delay: 0.4s; }
      .player-profile-bar-count.red { color: #DC2626; }
      .player-profile-bar-count.yellow { color: #B45309; }
      .player-profile-bar-count.none { color: #94A3B8; }
      .player-profile-meter { margin-top: 14px; padding: 12px 14px; border-radius: 12px; background: #FFFBEB; border: 1px solid #FDE68A; }
      .player-profile-meter.red { background: #FEF2F2; border-color: #FECACA; }
      .player-profile-meter-top { display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; font-size: 11.5px; font-weight: 600; color: #78350F; margin-bottom: 8px; }
      .player-profile-meter.red .player-profile-meter-top { color: #7F1D1D; }
      .player-profile-meter-top b { font-family: 'Poppins', sans-serif; font-weight: 800; }
      .player-profile-meter-segments { display: flex; gap: 6px; }
      .player-profile-meter-segments span { flex: 1; height: 10px; border-radius: 99px; background: rgba(120, 53, 15, 0.12); transition: background 0.3s; }
      .player-profile-meter-segments span.on { background: linear-gradient(90deg, #FDE047, #F59E0B); box-shadow: 0 2px 8px -2px rgba(245, 158, 11, 0.8); }
      .player-profile-meter.red .player-profile-meter-segments span { background: rgba(127, 29, 29, 0.12); }
      .player-profile-meter.red .player-profile-meter-segments span.on { background: linear-gradient(90deg, #FB7185, #DC2626); box-shadow: 0 2px 8px -2px rgba(220, 38, 38, 0.8); }
      .player-profile-meter.red .player-profile-meter-segments span.done { background: linear-gradient(90deg, #6EE7B7, #10B981); }
      .player-profile-card-tag { display: inline-flex; align-items: center; gap: 7px; padding: 4px 10px; border-radius: 8px; font-size: 11.5px; font-weight: 800; }
      .player-profile-card-tag.yellow { background: #FEF9C3; color: #854D0E; }
      .player-profile-card-tag.red { background: #FEE2E2; color: #991B1B; }
      .player-profile-card-tag.none { background: #F1F5F9; color: #64748B; font-weight: 600; }

      /* ---------- Sanciones: medidor de amarillas ---------- */
      .yellow-meter { display: inline-flex; flex-direction: column; align-items: flex-end; gap: 6px; }
      .yellow-meter-dots { display: inline-flex; gap: 5px; }
      .yellow-meter-dot { width: 16px; height: 22px; border-radius: 4px; border: 2px dashed #FCD34D; transition: transform 0.25s var(--ft-spring); }
      .yellow-meter-dot.on { border: none; background: linear-gradient(160deg, #FDE047, #F59E0B); box-shadow: 0 4px 10px -3px rgba(245, 158, 11, 0.8); transform: rotate(-6deg); animation: ftPop 0.5s var(--ft-spring) backwards; }
      .yellow-meter-text { font-size: 12.5px; font-weight: 700; color: #B45309; }

      /* ---------- Llaves de playoffs ---------- */
      @keyframes ftDraw { to { stroke-dashoffset: 0; } }
      svg path[stroke="#22C55E"] { stroke: #14B8A6; stroke-dasharray: 1000; stroke-dashoffset: 1000; animation: ftDraw 1.4s var(--ft-ease) forwards 0.25s; }
      .bracket-row { transition: background 0.3s, opacity 0.3s; position: relative; }
      .bracket-row.winner { background: linear-gradient(90deg, #ECFDF5, #FFFFFF); box-shadow: inset 4px 0 0 #10B981; }
      .bracket-row.winner span { color: #047857 !important; }
      .bracket-row.loser { opacity: 0.6; }

      /* ==================== FIN MEJORAS (parte general) ==================== */

      /* Responsive: solo cambia en pantallas pequeñas; escritorio queda igual */
      @media (max-width: 820px) {
        .player-profile-hero { padding: 16px; gap: 12px; }
        .player-profile-initials { width: 48px; height: 48px; border-radius: 13px; font-size: 18px; }
        .player-profile-name { font-size: 18px; }
        .player-profile-stat { padding: 12px; }
        .player-profile-stat-value { font-size: 25px; }
        .player-profile-match-top { flex-wrap: wrap; }
        .player-profile-match-team { font-size: 11px; }
        .player-profile-match-team .crest { display: none; }
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

        /* En móvil la columna secundaria baja debajo del contenido principal */
        .two-col {
          grid-template-columns: 1fr !important;
          gap: 16px !important;
          min-width: 0;
        }
        .two-col > * { min-width: 0; }

        /* Clasificación: ocupa el ancho disponible y evita tener que alejar el zoom */
        .two-col .data-table-wrap { min-width: 0; }
        table.data-table { width: 100%; min-width: 0; }
        table.data-table th { font-size: 9px; padding: 10px 3px; letter-spacing: 0.02em; }
        table.data-table td { font-size: 11px; padding: 9px 3px; }
        table.data-table th:first-child,
        table.data-table td:first-child { width: 25px; }
        table.data-table th:nth-child(2),
        table.data-table td:nth-child(2) { width: 105px; max-width: 105px; }
        table.data-table th:nth-child(n+3),
        table.data-table td:nth-child(n+3) { width: auto; }
        table.data-table td.team-name-cell { overflow: hidden; }
        table.data-table td.team-name-cell .team-name-cell {
          display: inline-block;
          max-width: 68px;
          overflow: hidden;
          text-overflow: ellipsis;
          vertical-align: middle;
        }
        table.data-table td.team-name-cell > span { gap: 5px !important; max-width: 100%; min-width: 0; }

        /* Menos espacio visual en móvil */
        .page-header { margin-bottom: 20px; }
        .page-title { font-size: 23px; }
        .page-subtitle { font-size: 13px; }

        /* Modales más compactos en celular */
        .modal-overlay { padding: 12px 10px; }
        .modal-box { max-width: 380px; border-radius: 16px; }
        .modal-box > div:first-child { padding: 14px 16px !important; }
        .modal-box > div:nth-child(2) { padding: 16px !important; }
        .modal-box h3 { font-size: 16px !important; }
        .login-form-copy { font-size: 13px !important; line-height: 1.4 !important; margin-bottom: 12px !important; }
        .login-form-row { margin-bottom: 12px !important; }
        .login-actions { gap: 8px !important; flex-wrap: wrap; }
        .login-actions .btn { padding: 9px 11px; font-size: 12px; }
      }
      
      /* ==========================================================================
         MEJORAS VISUALES v2 · CELULAR Y TABLET (se aplica encima del responsive anterior)
         ========================================================================== */
      @media (max-width: 820px) {
        .futbolito-app { background-attachment: scroll; }

        /* Contenido */
        .main-area { padding: 18px 14px calc(30px + env(safe-area-inset-bottom)); }
        .page-title { padding-bottom: 12px; }
        .page-title::after { width: 44px; height: 3px; }
        .card { border-radius: 14px; }
        .card-header-green { padding: 14px 16px; border-radius: 13px 13px 0 0; }
        .info-strip { gap: 14px 22px; padding: 14px 16px 14px 20px; border-radius: 14px; }
        .info-strip .btn { width: 100%; justify-content: center; }
        .stat-circle { width: 56px; height: 56px; font-size: 19px; }

        /* Banner del torneo (Inicio) */
        .hero-banner { height: auto !important; min-height: 170px; border-radius: 14px !important; margin-bottom: 18px !important; }
        .hero-content { height: auto !important; min-height: 170px; padding: 22px 18px !important; gap: 14px !important; }
        .hero-content > img { width: 76px !important; height: 76px !important; border-radius: 14px !important; }
        .hero-content .font-display { font-size: 24px !important; line-height: 1.15 !important; }
        .hero-content > div > div:last-child { font-size: 11px !important; margin-top: 8px !important; }

        /* Filas de partidos: nombres arriba, fecha abajo, todo cabe sin zoom */
        .match-row { flex-wrap: wrap; gap: 8px 10px !important; padding: 14px 12px !important; }
        .match-row > div:nth-child(1), .match-row > div:nth-child(3) { gap: 8px !important; }
        .match-row > div:nth-child(2) { min-width: 66px !important; }
        .match-row span:not(.status-pill) { font-size: 13px !important; }
        .match-row .crest, .match-row > div > img { width: 30px !important; height: 30px !important; font-size: 11px !important; }
        .match-row > div:nth-child(4) { flex: 0 0 100%; width: 100% !important; text-align: center !important; padding-top: 8px; border-top: 1px dashed #D1FAE5; color: #0F766E !important; font-weight: 600; }

        /* Selectores y botones a todo el ancho cuando hace falta */
        .main-area select.input { width: 100% !important; }
        .btn-sm { min-height: 38px; }

        /* Tablas: desplazamiento táctil suave */
        .card { -webkit-overflow-scrolling: touch; }
        table.data-table tbody tr.zone-top td:first-child, table.data-table tbody tr.zone-bottom td:first-child { box-shadow: inset 4px 0 0 currentColor; }
        table.data-table tbody tr:hover td:first-child { box-shadow: none; }

        /* Perfil del jugador */
        .player-profile-grid { gap: 8px; }
        .player-profile-bars { gap: 8px; }
        .player-profile-tabs { gap: 4px; padding: 4px; }
        .player-profile-tabs button { padding: 10px 4px; font-size: 11px; }

        /* Modales como "hoja inferior": se deslizan desde abajo y se alcanzan con el pulgar */
        .modal-overlay { padding: 0 !important; }
        .modal-box { max-width: 100% !important; width: 100%; margin: auto 0 0 !important; border-radius: 22px 22px 0 0 !important; padding-bottom: env(safe-area-inset-bottom); animation: ftSheet 0.45s var(--ft-ease); }
        .player-profile-layer .modal-box { max-width: 100% !important; }

        /* Rankings, ficha de tarjetas y destacados */
        .ranking-card { padding: 18px 14px 8px !important; }
        .player-profile-trigger.rank-row { gap: 10px; padding: 10px 4px; }
        .rank-value { min-width: 44px; padding: 5px 9px; font-size: 14px; }
        .stat-highlight { padding: 16px; gap: 14px; }
        .stat-highlight-icon { width: 42px; height: 42px; }
        .yellow-meter { align-items: flex-start; }
        .player-profile-meter { padding: 10px 12px; }
        .player-profile-card-shape { width: 20px; height: 28px; }
      }

      /* Pantallas táctiles: objetivos de toque cómodos, sin zoom de iOS y respuesta al tocar */
      @media (hover: none) and (pointer: coarse) {
        .btn { min-height: 44px; }
        .btn-sm { min-height: 40px; }
        .icon-btn { width: 40px; height: 40px; }
        .icon-btn-subtle { width: 40px; height: 40px; }
        .input, textarea.textarea, select.input { font-size: 16px; min-height: 44px; }
        .checkbox-row input { width: 20px; height: 20px; }
        .swatch { width: 30px; height: 30px; }
        .btn:active, .icon-btn:active, .icon-btn-subtle:active { transform: scale(0.92); }
        button.card:active, .team-card:active, .stat-circle:active { transform: scale(0.95); }
        .match-row:active { background: #ECFDF5 !important; }
        .btn::before { display: none; }
      }

      /* Teléfonos pequeños */
      @media (max-width: 400px) {
        .page-title { font-size: 21px; }
        .hero-content .font-display { font-size: 21px !important; }
        .hero-content > img { width: 62px !important; height: 62px !important; }
        .match-row span:not(.status-pill) { font-size: 12px !important; }
      }

      /* Menos movimiento si el sistema lo pide */
      @media (prefers-reduced-motion: reduce) {
        .futbolito-app *, .futbolito-app *::before, .futbolito-app *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; }
      }

      /* Impresión: sin animaciones ni textos con degradado */
      @media print {
        .futbolito-app *, .futbolito-app *::before, .futbolito-app *::after { animation: none !important; }
        .page-title, .modal-box h3, .info-strip-item .val, button.card.quick-stat .font-display { background: none !important; -webkit-text-fill-color: #0F172A !important; color: #0F172A !important; }
        table.data-table tbody tr { animation: none !important; }
      }

      @media print {
        .no-print { display: none !important; }
        .sidebar { display: none !important; }
        .app-shell { display: block !important; }
        .main-area { padding: 0 !important; }
        body, .futbolito-app { background: #fff !important; color: #000 !important; }
        .card { break-inside: avoid; border-color: #CBD5E1 !important; box-shadow: none !important; }
      }
      /* Planteles y equipos: estilos propios para conservar las otras vistas. */
      .tournament-pane { --pane-ink: #0F172A; --pane-muted: #64748B; min-width: 0; }
      .pane-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; flex-wrap: wrap; margin-bottom: 22px; }
      .pane-kicker { display: flex; align-items: center; gap: 7px; font-size: 10px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; color: #0F766E; margin-bottom: 8px; }
      .pane-title { font-family: 'Poppins', sans-serif; font-size: 25px; line-height: 1.25; font-weight: 800; color: var(--pane-ink); margin: 0; }
      .pane-description { font-size: 13px; color: var(--pane-muted); margin: 7px 0 0; line-height: 1.6; }
      .pane-counter { display: inline-flex; align-items: center; gap: 7px; padding: 8px 12px; background: #fff; border: 1px solid #E2E8F0; border-radius: 10px; font-size: 12px; font-weight: 600; color: #475569; }
      .pane-counter strong { color: #0F766E; font-size: 14px; }
      .pane-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
      .pane-toolbar { display: flex; align-items: flex-end; justify-content: space-between; gap: 14px; flex-wrap: wrap; margin-bottom: 20px; padding: 18px; background: #fff; border: 1px solid #E2E8F0; border-radius: 16px; }
      .pane-field { display: grid; gap: 7px; min-width: 0; flex: 1 1 220px; max-width: 380px; }
      .pane-field > label { font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: #64748B; }
      .pane-field .input { width: 100%; min-width: 0; height: 44px; box-shadow: none; }
      .pane-search { display: flex; align-items: center; gap: 9px; min-width: 0; border: 1px solid #CBD5E1; border-radius: 10px; padding: 0 12px; background: #F8FAFC; height: 44px; }
      .pane-search:focus-within { border-color: #0D9488; box-shadow: 0 0 0 3px #CCFBF1; }
      .pane-search > svg { flex-shrink: 0; color: #94A3B8; }
      .pane-search input { border: 0; outline: none; background: transparent; font: inherit; font-size: 13px; color: #0F172A; min-width: 0; width: 100%; }
      .pane-search input::placeholder { color: #94A3B8; }
      .pane-search button { border: 0; background: transparent; cursor: pointer; color: #64748B; display: flex; padding: 3px; }
      .tournament-pane button:focus-visible { outline: 3px solid #14B8A6; outline-offset: 3px; }
      .pane-empty { background: #fff; border: 1px dashed #CBD5E1; border-radius: 20px; padding: 52px 22px; text-align: center; }
      .pane-empty-icon { width: 72px; height: 72px; margin: 0 auto 18px; display: grid; place-items: center; color: #0F766E; background: #F0FDFA; border: 1px solid #CCFBF1; border-radius: 22px; }
      .pane-empty h3 { margin: 0; font-family: 'Poppins', sans-serif; font-size: 19px; font-weight: 700; color: #0F172A; }
      .pane-empty p { max-width: 400px; margin: 10px auto 0; font-size: 13px; color: #64748B; line-height: 1.7; }
      .clubs-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 22px; }
      .teams-page .club-card { min-width: 0; border-radius: 20px; animation: none; box-shadow: 0 4px 16px -10px rgba(15,23,42,.18); }
      .teams-page .club-card:hover { transform: translateY(-4px); border-color: var(--club-color, #0D9488); box-shadow: 0 18px 28px -20px rgba(15,23,42,.35); }
      .club-card-cover { display: block; position: relative; width: 100%; height: 150px; padding: 0; border: 0; background: linear-gradient(135deg, #0B1121, #183B32); overflow: hidden; cursor: pointer; text-align: left; }
      .club-card-cover::after { content: ''; position: absolute; inset: 0; background: linear-gradient(transparent 25%, rgba(11,17,33,.75)); pointer-events: none; }
      .club-cover-emblem { position: absolute; inset: 0; display: grid; place-items: center; opacity: .55; }
      .club-cover-emblem > * { transform: scale(1.65); }
      .club-cover-photo { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; transition: transform .35s ease; }
      .teams-page .club-card:hover .club-cover-photo { transform: scale(1.035); }
      .club-cover-label { position: absolute; left: 18px; bottom: 15px; z-index: 1; color: #fff; font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
      .club-position { position: absolute; left: 14px; top: 14px; z-index: 1; display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 800; color: #0F172A; padding: 6px 9px; border-radius: 7px; background: rgba(255,255,255,.95); }
      .club-card-content { display: flex; flex-direction: column; flex: 1; padding: 20px; border-top: 4px solid var(--club-color, #0D9488); }
      .club-card-heading { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 16px; }
      .club-card-name { flex: 1; min-width: 0; display: flex; align-items: flex-start; gap: 10px; padding: 0; border: 0; background: transparent; text-align: left; cursor: pointer; }
      .club-card-name > span { min-width: 0; font-family: 'Poppins', sans-serif; font-size: 16px; line-height: 1.45; font-weight: 800; color: #0F172A; overflow-wrap: anywhere; }
      .club-card-name > .crest, .club-card-name > img { margin-top: 2px; }
      .club-card-members { display: flex; align-items: center; gap: 6px; margin-bottom: 15px; color: #64748B; font-size: 12px; }
      .club-card-metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border: 1px solid #E2E8F0; border-radius: 12px; overflow: hidden; background: #F8FAFC; margin-bottom: 12px; }
      .club-card-metric { text-align: center; padding: 12px 4px; border-right: 1px solid #E2E8F0; }
      .club-card-metric:last-child { border-right: 0; }
      .club-card-metric strong { display: block; font-family: 'Poppins', sans-serif; font-size: 23px; font-weight: 800; line-height: 1.2; color: #0F172A; }
      .club-card-metric:first-child strong { color: #0F766E; }
      .club-card-metric span { display: block; margin-top: 5px; font-size: 9px; text-transform: uppercase; letter-spacing: .05em; font-weight: 700; color: #64748B; }
      .club-card-goals { display: flex; justify-content: space-between; gap: 10px; font-size: 11px; color: #64748B; padding: 0 2px 14px; }
      .club-card-goals b { color: #334155; }
      .club-card-form { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding-top: 12px; border-top: 1px solid #F1F5F9; margin-top: auto; }
      .club-card-form > span { font-size: 10px; font-weight: 600; color: #64748B; }
      .club-form-results { display: flex; gap: 5px; }
      .club-form-result { display: grid; place-items: center; width: 25px; height: 25px; border-radius: 7px; font-size: 10px; font-weight: 800; }
      .club-form-result.win { background: #DCFCE7; color: #15803D; }
      .club-form-result.draw { background: #FEF3C7; color: #92400E; }
      .club-form-result.loss { background: #FEE2E2; color: #B91C1C; }
      .club-card-footer { display: flex; padding-top: 16px; margin-top: 16px; border-top: 1px solid #E2E8F0; }
      .club-card-open { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 10px; border: 0; border-radius: 10px; padding: 11px 12px; background: #F0FDFA; color: #0F766E; font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; }
      .club-card-open:hover { background: #CCFBF1; }
      .teams-page .icon-btn-subtle, .players-page .icon-btn-subtle { min-width: 34px; min-height: 34px; }
      .club-card-confirm { margin-top: 12px; }
      .club-card-confirm > span { width: 100%; flex-wrap: wrap; }
      .roster-banner { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-bottom: 18px; padding: 20px; background: #fff; border: 1px solid #E2E8F0; border-left: 4px solid var(--club-color, #0D9488); border-radius: 16px; }
      .roster-banner-title { flex: 1; min-width: 150px; }
      .roster-banner-title h3 { margin: 0; font-family: 'Poppins', sans-serif; font-size: 18px; font-weight: 800; line-height: 1.4; color: #0F172A; overflow-wrap: anywhere; }
      .roster-banner-title p { margin: 5px 0 0; color: #64748B; font-size: 12px; }
      .roster-summary { display: flex; gap: 8px; flex-wrap: wrap; }
      .roster-summary > span { display: inline-flex; gap: 5px; align-items: center; border-radius: 8px; padding: 8px 10px; font-size: 11px; font-weight: 600; background: #F0FDFA; color: #0F766E; }
      .roster-table-wrap { overflow-x: auto; background: #fff; border: 1px solid #E2E8F0; border-radius: 16px; }
      .roster-table { border-collapse: collapse; width: 100%; }
      .roster-table th { padding: 14px 16px; text-align: center; white-space: nowrap; color: #64748B; font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: .06em; background: #F8FAFC; border-bottom: 1px solid #E2E8F0; }
      .roster-table th:first-child { text-align: left; }
      .roster-table td { padding: 14px 16px; text-align: center; border-bottom: 1px solid #F1F5F9; font-size: 12px; color: #334155; }
      .roster-table tbody tr:last-child td { border-bottom: 0; }
      .roster-table tbody tr:hover { background: #F8FAFC; }
      .roster-player-open { display: inline-flex; align-items: center; gap: 11px; padding: 0; max-width: 100%; }
      .roster-player-text { display: grid; gap: 3px; min-width: 0; }
      .roster-player-text strong { font-size: 13px; font-weight: 700; color: #0F172A; line-height: 1.4; overflow-wrap: anywhere; }
      .roster-player-text small { font-size: 10.5px; color: #64748B; line-height: 1.4; }
      .roster-number { display: inline-block; border-radius: 7px; padding: 5px 8px; background: #F1F5F9; color: #0F172A; font-weight: 800; font-size: 12px; white-space: nowrap; }
      .roster-age { display: inline-block; padding: 5px 8px; border-radius: 7px; font-size: 11px; font-weight: 800; white-space: nowrap; }
      .roster-goals { display: inline-block; min-width: 30px; padding: 5px 8px; border-radius: 7px; background: #F1F5F9; color: #64748B; font-weight: 800; }
      .roster-goals.scored { background: #DCFCE7; color: #15803D; }
      .roster-cards { display: inline-flex; gap: 5px; align-items: center; white-space: nowrap; }
      .roster-card-count { display: inline-flex; align-items: center; gap: 4px; padding: 4px 6px; border-radius: 6px; font-size: 11px; font-weight: 700; }
      .roster-card-count.yellow { background: #FFFBEB; color: #92400E; }
      .roster-card-count.red { background: #FEF2F2; color: #B91C1C; }
      .roster-card-count .card-chip { width: 8px; height: 11px; box-shadow: none; }
      .roster-row-actions { display: flex; align-items: center; justify-content: flex-end; gap: 4px; }
      .roster-row-actions > span { flex-wrap: wrap; }
      .roster-footer { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 11px; color: #64748B; margin-top: 14px; line-height: 1.5; }
      .roster-age-key { display: flex; gap: 12px; flex-wrap: wrap; }
      .roster-age-key span { display: inline-flex; align-items: center; gap: 5px; }
      .roster-age-key i { width: 8px; height: 8px; border-radius: 3px; }
      @media (max-width: 640px) {
        .pane-title { font-size: 22px; }
        .pane-heading { gap: 14px; margin-bottom: 16px; }
        .pane-heading > .pane-actions { width: 100%; }
        .pane-toolbar { padding: 14px; gap: 14px; }
        .pane-field { max-width: none; flex-basis: 100%; }
        .players-page .pane-toolbar > .pane-actions { width: 100%; }
        .players-page .pane-toolbar > .pane-actions .btn { flex: 1; justify-content: center; padding: 11px 8px; font-size: 12px; }
        .clubs-grid { grid-template-columns: minmax(0, 1fr); gap: 16px; }
        .club-card-cover { height: 160px; }
        .club-card-content { padding: 18px; }
        .roster-banner { padding: 16px; }
        .roster-summary { width: 100%; }
        .roster-table-wrap { overflow: visible; }
        .roster-table, .roster-table tbody { display: block; }
        .roster-table thead { display: none; }
        .roster-table tbody { display: grid; gap: 10px; padding: 12px; }
        .roster-table tr { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 10px 14px; padding: 14px; border: 1px solid #E2E8F0; border-radius: 12px; }
        .roster-table td { display: flex; justify-content: space-between; align-items: center; gap: 6px; padding: 0; border: 0; min-width: 0; text-align: left; }
        .roster-table td::before { content: attr(data-label); font-size: 9px; font-weight: 700; color: #64748B; }
        .roster-table td:first-child { grid-column: 1 / -1; margin-bottom: 4px; }
        .roster-table td:first-child::before, .roster-table td.roster-action-cell::before { display: none; }
        .roster-table td.roster-action-cell { grid-column: 1 / -1; padding-top: 10px; margin-top: 2px; border-top: 1px solid #F1F5F9; }
        .roster-action-cell .roster-row-actions { width: 100%; }
        .pane-empty { padding: 38px 18px; }
      }
      @media print {
        .pane-toolbar, .roster-row-actions, .club-card-actions, .club-card-open, .club-card-confirm { display: none !important; }
        .clubs-grid { grid-template-columns: repeat(2, minmax(0,1fr)); }
        .club-card { break-inside: avoid; }
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

function PlayerDetailModal({ player, data, onClose, focus = 'goals' }) {
  // focus: 'goals' (ficha de goles), 'yellow' o 'red' (ficha de tarjetas)
  const isCards = focus === 'yellow' || focus === 'red';
  const cardName = focus === 'red' ? 'roja' : 'amarilla';
  const cardNamePlural = focus === 'red' ? 'rojas' : 'amarillas';
  const [showAll, setShowAll] = useState(false);
  const layerRef = useRef(null);
  const profile = getPlayerProfile(player.id, data);
  const sanction = getPlayerStats(player.id, data);
  const team = data.teams.find(t => t.id === player.teamId);
  const recent = profile.history.slice(-10);
  const chartMax = Math.max(1, ...recent.map(m => m.goals));
  const focusMatches = isCards ? profile.history.filter(m => m[focus] > 0) : profile.scoringMatches;
  const visibleMatches = [...(showAll ? profile.history : focusMatches)].reverse();
  const cardRank = isCards && profile[focus] > 0
    ? 1 + data.players.filter(p => p.id !== player.id && getPlayerStats(p.id, data)[focus] > profile[focus]).length
    : null;
  const matchLabel = m => m.phase === 'liga' ? 'F' + m.jornada :
    ({ 'Cuartos de Final': 'CF', 'Semifinal': 'SF', 'Tercer Puesto': '3.º', 'Final': 'FIN' }[m.round] || 'PO');

  useEffect(() => {
    const previousFocus = document.activeElement;
    const layer = layerRef.current;
    layer?.querySelector('button[aria-label="Cerrar"]')?.focus();
    const handleKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key !== 'Tab') return;
      const buttons = layer?.querySelectorAll('button:not([disabled])');
      if (!buttons?.length) return;
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [onClose]);

  const heroLabel = isCards
    ? (cardRank ? '#' + cardRank + ' EN ' + cardNamePlural.toUpperCase() : 'FICHA DE TARJETAS')
    : (profile.rank ? '#' + profile.rank + ' EN GOLEADORES' : 'FICHA DEL JUGADOR');
  const modalTitle = focus === 'red' ? 'Tarjetas rojas del jugador' : focus === 'yellow' ? 'Tarjetas amarillas del jugador' : 'Estadísticas del jugador';

  return (
    <div className="player-profile-layer" ref={layerRef} role="dialog" aria-modal="true" aria-label={'Estadísticas de ' + player.name}>
      <Modal title={modalTitle} onClose={onClose}>
        <div className={'player-profile-hero' + (isCards ? ' ' + focus : '')}>
          <div className="player-profile-initials font-display">{initials(player.name)}</div>
          <div className="player-profile-identity">
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: '#86EFAC', marginBottom: 5 }} className="player-profile-kicker">
              {heroLabel}
            </div>
            <div className="player-profile-name font-display">{player.name}</div>
            <div className="player-profile-team"><Crest team={team} size="sm" /> {team ? team.name : 'Sin equipo'}</div>
            <div className="player-profile-meta">
              {[
                player.number !== '' && player.number != null ? 'Dorsal #' + player.number : null,
                player.position || null,
                player.age !== '' && player.age != null ? player.age + ' años' : null,
              ].filter(Boolean).join(' · ')}
            </div>
          </div>
        </div>

        {isCards ? (
          <div className="player-profile-grid">
            <div className={'player-profile-stat primary ' + focus}>
              <div className="player-profile-stat-label"><span className={'card-chip ' + focus} /> {focus === 'red' ? 'ROJAS TOTALES' : 'AMARILLAS TOTALES'}</div>
              <div className="player-profile-stat-value font-display">{profile[focus]}</div>
              <small>Liga y playoffs</small>
            </div>
            <div className="player-profile-stat">
              <div className="player-profile-stat-label"><Calendar size={14} /> ENCUENTROS CON REGISTRO</div>
              <div className="player-profile-stat-value font-display">{profile.matchesRecorded}</div>
              <small>Con estadísticas guardadas</small>
            </div>
            <div className="player-profile-stat">
              <div className="player-profile-stat-label"><Check size={14} /> {focus === 'red' ? 'PARTIDOS CON ROJA' : 'PARTIDOS CON AMARILLA'}</div>
              <div className="player-profile-stat-value font-display">{focusMatches.length}</div>
              <small>Recibió al menos una</small>
            </div>
            <div className="player-profile-stat">
              <div className="player-profile-stat-label"><ShieldAlert size={14} /> {focus === 'red' ? 'SANCIÓN PENDIENTE' : 'HACIA LA SANCIÓN'}</div>
              <div className="player-profile-stat-value font-display">
                {focus === 'red' ? sanction.pending : sanction.yellowSinceReset + ' / ' + sanction.yellowLimit}
              </div>
              <small>{focus === 'red' ? 'Cumplidas ' + sanction.served + ' de ' + sanction.triggered : 'Amarillas del ciclo actual'}</small>
            </div>
          </div>
        ) : (
          <div className="player-profile-grid">
            <div className="player-profile-stat primary">
              <div className="player-profile-stat-label"><Trophy size={14} /> GOLES TOTALES</div>
              <div className="player-profile-stat-value font-display">{profile.goals}</div>
              <small>Liga y playoffs</small>
            </div>
            <div className="player-profile-stat">
              <div className="player-profile-stat-label"><Calendar size={14} /> ENCUENTROS CON REGISTRO</div>
              <div className="player-profile-stat-value font-display">{profile.matchesRecorded}</div>
              <small>Con estadísticas guardadas</small>
            </div>
            <div className="player-profile-stat">
              <div className="player-profile-stat-label"><Check size={14} /> PARTIDOS CON GOL</div>
              <div className="player-profile-stat-value font-display">{profile.scoringMatches.length}</div>
              <small>Marcó al menos una vez</small>
            </div>
            <div className="player-profile-stat">
              <div className="player-profile-stat-label"><BarChart3 size={14} /> PROMEDIO DE GOL</div>
              <div className="player-profile-stat-value font-display">{profile.average.toLocaleString('es-EC', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</div>
              <small>Por encuentro con registro</small>
            </div>
          </div>
        )}

        <div className="player-profile-extras">
          <span className="player-profile-chip"><span className="card-chip yellow" /> {profile.yellow} amarillas</span>
          <span className="player-profile-chip"><span className="card-chip red" /> {profile.red} rojas</span>
          {isCards ? (
            <span className="player-profile-chip"><Trophy size={13} /> {profile.goals} goles</span>
          ) : (
            <>
              <span className="player-profile-chip"><Award size={13} /> Mejor marca: {profile.bestGoals} goles</span>
              <span className="player-profile-chip">Dobletes: {profile.doubles}</span>
              <span className="player-profile-chip">Partidos con 3+ goles: {profile.threePlus}</span>
            </>
          )}
        </div>

        {recent.length > 0 && isCards && (
          <div className="player-profile-chart">
            <div className="player-profile-heading font-display">{focus === 'red' ? 'Rojas' : 'Amarillas'} por encuentro</div>
            <div className="player-profile-bars" role="img" aria-label={recent.map(m => m.label + ': ' + (m[focus] ? cardName : 'sin tarjeta')).join('; ')}>
              {recent.map(m => (
                <div className="player-profile-bar-item" key={m.phase + '-' + m.id} title={m.label + ' · ' + teamName(data.teams, m.teamAId) + ' vs ' + teamName(data.teams, m.teamBId) + ' · ' + (m[focus] ? 'tarjeta ' + cardName : 'sin tarjeta')}>
                  <div className={'player-profile-bar-count ' + (m[focus] ? focus : 'none')}>{m[focus] ? 1 : 0}</div>
                  <div className="player-profile-bar-track">
                    <div className={'player-profile-card-shape' + (m[focus] ? ' on ' + focus : '')} />
                  </div>
                  <div className="player-profile-bar-label">{matchLabel(m)}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 10.5, color: '#64748B', marginTop: 6 }}>Últimos {recent.length} encuentros con registro, del más antiguo al más reciente.</div>
            {focus === 'yellow' && (
              <div className="player-profile-meter">
                <div className="player-profile-meter-top"><span>Camino a la sanción</span><b>{sanction.yellowSinceReset} / {sanction.yellowLimit}</b></div>
                <div className="player-profile-meter-segments">
                  {Array.from({ length: Math.min(sanction.yellowLimit, 12) }).map((_, di) => <span key={di} className={di < sanction.yellowSinceReset ? 'on' : ''} />)}
                </div>
              </div>
            )}
            {focus === 'red' && sanction.triggered > 0 && (
              <div className="player-profile-meter red">
                <div className="player-profile-meter-top"><span>Partidos de sanción</span><b>{sanction.served} cumplidos · {sanction.pending} pendientes</b></div>
                <div className="player-profile-meter-segments">
                  {Array.from({ length: Math.min(sanction.triggered, 12) }).map((_, di) => <span key={di} className={di < sanction.served ? 'done' : 'on'} />)}
                </div>
              </div>
            )}
          </div>
        )}

        {recent.length > 0 && !isCards && (
          <div className="player-profile-chart">
            <div className="player-profile-heading font-display">Goles por encuentro</div>
            <div className="player-profile-bars" role="img" aria-label={recent.map(m => m.label + ': ' + m.goals + ' goles').join('; ')}>
              {recent.map(m => (
                <div className="player-profile-bar-item" key={m.phase + '-' + m.id} title={m.label + ' · ' + teamName(data.teams, m.teamAId) + ' vs ' + teamName(data.teams, m.teamBId) + ' · ' + m.goals + ' goles'}>
                  <div className="player-profile-bar-count">{m.goals}</div>
                  <div className="player-profile-bar-track">
                    <div className="player-profile-bar" style={{ height: Math.max(3, m.goals / chartMax * 82), background: m.goals ? undefined : '#CBD5E1' }} />
                  </div>
                  <div className="player-profile-bar-label">{matchLabel(m)}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 10.5, color: '#64748B', marginTop: 6 }}>Últimos {recent.length} encuentros con registro, del más antiguo al más reciente.</div>
          </div>
        )}

        <div className="player-profile-tabs" aria-label="Historial del jugador">
          <button type="button" aria-pressed={!showAll} onClick={() => setShowAll(false)}>
            {isCards ? 'Partidos con ' + cardName + ' (' + focusMatches.length + ')' : 'Partidos con gol (' + profile.scoringMatches.length + ')'}
          </button>
          <button type="button" aria-pressed={showAll} onClick={() => setShowAll(true)}>Todos los registros ({profile.matchesRecorded})</button>
        </div>
        {visibleMatches.length === 0 ? (
          <div style={{ padding: '24px 12px', textAlign: 'center', fontSize: 13, color: '#64748B', background: '#F8FAFC', borderRadius: 12 }}>
            {showAll
              ? 'Todavía no hay estadísticas registradas para este jugador.'
              : isCards
                ? 'Todavía no tiene tarjetas ' + cardNamePlural + ' registradas en encuentros finalizados.'
                : 'Todavía no tiene goles registrados en encuentros finalizados.'}
          </div>
        ) : (
          <div className="player-profile-history">
            {visibleMatches.map(m => (
              <div className="player-profile-match" key={m.phase + '-' + m.id}>
                <div className="player-profile-match-top">
                  <span style={{ fontWeight: 700 }}>{m.label} · {m.phase === 'liga' ? 'Liga' : 'Playoffs'}</span>
                  <span>{formatDateTime(m.date, m.time) || 'Sin fecha registrada'}</span>
                </div>
                <div className="player-profile-match-teams">
                  <div className="player-profile-match-team"><Crest team={data.teams.find(t => t.id === m.teamAId)} size="sm" /> {teamName(data.teams, m.teamAId)}</div>
                  <div className="player-profile-score font-display">{m.scoreA ?? '—'} - {m.scoreB ?? '—'}</div>
                  <div className="player-profile-match-team"><Crest team={data.teams.find(t => t.id === m.teamBId)} size="sm" /> {teamName(data.teams, m.teamBId)}</div>
                </div>
                <div className="player-profile-match-bottom">
                  {isCards ? (
                    m[focus] > 0
                      ? <span className={'player-profile-card-tag ' + focus}><span className={'card-chip ' + focus} /> {focus === 'red' ? 'Roja' : 'Amarilla'}</span>
                      : <span className="player-profile-card-tag none">Sin {cardName}</span>
                  ) : (
                    <span className="player-profile-goals">⚽ {m.goals} {m.goals === 1 ? 'gol' : 'goles'}</span>
                  )}
                  {!isCards && m.goals > 0 && m.goals === profile.bestGoals && <span className="player-profile-record">Mejor marca</span>}
                  <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 10.5, color: '#64748B' }}>
                    {isCards && m.goals > 0 && <span>⚽ {m.goals} {m.goals === 1 ? 'gol' : 'goles'}</span>}
                    {m.yellow > 0 && focus !== 'yellow' && <span><span className="card-chip yellow" /> Amarilla</span>}
                    {m.red > 0 && focus !== 'red' && <span><span className="card-chip red" /> Roja</span>}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="player-profile-note">Las estadísticas incluyen únicamente encuentros finalizados con registros guardados para este jugador.</p>
      </Modal>
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

function TeamDetailModal({ team, data, onClose, onViewPlayer }) {
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
                <button type="button" key={p.id} className="player-profile-trigger" aria-label={'Ver estadísticas de ' + p.name} onClick={() => onViewPlayer(p.id)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: idx === players.length - 1 ? 'none' : '1px solid #F1F5F9' }}>
                  <Avatar size={28} />
                  <div style={{ flex: 1, fontSize: 14 }}>
                    {p.number !== '' && p.number !== undefined ? <span style={{ color: '#64748B', fontWeight: 700, marginRight: 8 }}>#{p.number}</span> : null}
                    {p.name}
                  </div>
                  {p.age !== '' && p.age !== undefined && (
                    <span style={{ fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 8, background: ac.bg, color: ac.fg, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>{p.age} años</span>
                  )}
                </button>
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

function MatchResultModal({ match, teams, players, allMatches, onClose, onSave, onDelete, onSwap, onViewPlayer }) {
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
  const [date, setDate] = useState(match.date || '');
  const [time, setTime] = useState(match.time || '');

  const conflict = (date && time && allMatches)
    ? allMatches.find(m => m.id !== match.id && m.date === date && m.time === time)
    : null;
  const conflictTeamA = conflict ? teams.find(t => t.id === conflict.teamAId) : null;
  const conflictTeamB = conflict ? teams.find(t => t.id === conflict.teamBId) : null;

  const setPlayerField = (pid, field, value) => {
    const nextStats = { ...stats, [pid]: { ...stats[pid], [field]: value } };
    setStats(nextStats);
    if (field === 'goals') {
      if (playersA.some(p => p.id === pid)) setScoreA(sumGoals(playersA, nextStats));
      if (playersB.some(p => p.id === pid)) setScoreB(sumGoals(playersB, nextStats));
    }
  };
  const sumGoals = (list, playerStats = stats) => list.reduce((acc, p) => acc + (Number(playerStats[p.id]?.goals) || 0), 0);

  const renderPlayerRows = (list) => list.length === 0
    ? <div style={{ fontSize: 13, color: '#94A3B8', padding: '12px 0' }}>Sin jugadores registrados en este equipo.</div>
    : list.map(p => (
      <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: '1px solid #F1F5F9' }}>
        <button type="button" className="player-profile-trigger" aria-label={'Ver estadísticas de ' + p.name} onClick={() => onViewPlayer(p.id)} style={{ flex: 1, minWidth: 0, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8, padding: 0 }}>
          {p.number !== '' && p.number !== undefined ? <span style={{ color: '#64748B', fontWeight: 700 }}>#{p.number}</span> : null} {p.name}
        </button>
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
          Suma de goleadores registrados: {sumGoals(playersA)} - {sumGoals(playersB)} (puede diferir si hubo autogoles)
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
            Ya hay otro partido a esta misma fecha y hora: <strong>{conflictTeamA ? conflictTeamA.name : '—'} vs {conflictTeamB ? conflictTeamB.name : '—'}</strong> (antes tenía {formatDateTime(match.date, match.time)}).
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
          {renderPlayerRows(playersA)}
        </div>
        <div>
          <div className="font-display" style={{ fontSize: 14, fontWeight: 700, color: '#0F172A', marginBottom: 8 }}><TeamChip team={teamB} size="md" /></div>
          {renderPlayerRows(playersB)}
        </div>
      </div>

      <div style={{ borderTop: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 24, paddingTop: 16, flexWrap: 'wrap', gap: 10 }}>
        {confirmDelete
          ? <ConfirmInline text="¿Eliminar este partido?" onConfirm={() => onDelete(match.id)} onCancel={() => setConfirmDelete(false)} />
          : <button className="btn btn-danger btn-sm" onClick={() => setConfirmDelete(true)}><Trash2 size={14} /> Eliminar partido</button>}
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-outline" onClick={onClose}>Cancelar</button>
          <button className="btn btn-outline" onClick={() => onSave({ date, time })}>Guardar solo horario</button>
          <button className="btn btn-primary" onClick={() => onSave({ date, time, scoreA: Number(scoreA), scoreB: Number(scoreB), played: true, playerStats: stats })}>
            <Check size={16} /> Guardar resultado
          </button>
        </div>
      </div>
    </Modal>
  );
}

function MatchDetailModal({ match, teams, players, onClose, onViewPlayer }) {
  const teamA = teams.find(t => t.id === match.teamAId);
  const teamB = teams.find(t => t.id === match.teamBId);
  const playersA = players.filter(p => p.teamId === match.teamAId);
  const playersB = players.filter(p => p.teamId === match.teamBId);
  const statFor = (pid) => (match.playerStats && match.playerStats[pid]) || { goals: 0, yellow: false, red: false };

  const renderList = (list) => list.length === 0
    ? <div style={{ fontSize: 13, color: '#94A3B8', padding: '12px 0' }}>Sin jugadores registrados en este equipo.</div>
    : list.map(p => {
      const s = statFor(p.id);
      return (
        <button type="button" key={p.id} className="player-profile-trigger" aria-label={'Ver estadísticas de ' + p.name} onClick={() => onViewPlayer(p.id)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #F1F5F9' }}>
          <Avatar size={28} />
          <div style={{ flex: 1, fontSize: 14, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {p.number !== '' && p.number !== undefined ? <span style={{ color: '#64748B', fontWeight: 700, marginRight: 8 }}>#{p.number}</span> : null}
            {p.name}
          </div>
          {s.goals > 0 && <span style={{ fontSize: 13, color: '#22C55E', fontWeight: 800, flexShrink: 0 }}>⚽ {s.goals}</span>}
          <CardBadge yellow={s.yellow ? 1 : 0} red={s.red ? 1 : 0} />
        </button>
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
          {renderList(playersA)}
        </div>
        <div>
          <div className="font-display" style={{ fontSize: 14, fontWeight: 700, color: '#0F172A', marginBottom: 8 }}><TeamChip team={teamB} size="md" /></div>
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
      <div className="login-form-copy" style={{ fontSize: 14, color: '#64748B', marginBottom: 16, lineHeight: 1.5 }}>
        Escribe tu correo y te enviamos un enlace de acceso — no necesitas contraseña. Quien inicie sesión con el correo registrado como organizador podrá editar los datos del torneo; el resto solo podrá ver.
      </div>
      <div className="login-form-row" style={{ marginBottom: 16 }}>
        <label className="field-label">Correo</label>
        <input className="input" type="email" value={email} autoFocus placeholder="tucorreo@ejemplo.com"
          onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} />
      </div>
      {error && <div style={{ fontSize: 13, color: '#DC2626', marginBottom: 16 }}>{error}</div>}
      <div className="login-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
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

function StatsWidgetCard({ data, onViewPlayer }) {
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
              <button type="button" key={p.id} className="player-profile-trigger" aria-label={'Ver estadísticas de ' + p.name} onClick={() => onViewPlayer(p.id)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #F1F5F9' }}>
                <Avatar size={28} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: '#0F172A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                  <div style={{ fontSize: 11.5, color: '#64748B' }}>{team ? team.name : ''}</div>
                </div>
                <div style={{ fontSize: 14, fontWeight: 800, color: '#22C55E' }}>{stats.goals}</div>
              </button>
            );
          })}
      </div>
    </div>
  );
}

function RightColumn({ data, onViewPlayer }) {
  return (
    <div>
      <MatchWidgetCard data={data} />
      <StatsWidgetCard data={data} onViewPlayer={onViewPlayer} />
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
  const [viewPlayerId, setViewPlayerId] = useState(null);
  const [viewPlayerFocus, setViewPlayerFocus] = useState('goals');
  const closePlayerProfile = useCallback(() => setViewPlayerId(null), []);
  // focus: 'goals' (por defecto), 'yellow' o 'red' según el ranking desde el que se abrió.
  const openPlayerProfile = useCallback((id, focus) => {
    setViewPlayerFocus(focus === 'yellow' || focus === 'red' ? focus : 'goals');
    setViewPlayerId(id);
  }, []);

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

  const generateReturnLeg = () => {
    const result = createReturnLeg(data);
    if (result.error) return result;
    update(d => {
      // También protege frente a un segundo clic antes de actualizar la pantalla.
      if (d.matches.some(m => Number(m.jornada) >= 6 && Number(m.jornada) <= 10)) return d;
      return { ...d, matches: [...d.matches, ...result.matches] };
    });
    return result;
  };

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

    // Empieza el siguiente día habilitado después del último partido de liga programado
    // (o desde la fecha de inicio del torneo si la liga todavía no tiene horarios).
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

          {tab === 'inicio' && <InicioTab data={data} isAdmin={isAdmin} onNavigate={setTab} onViewTeam={setViewTeamId} onViewPlayer={openPlayerProfile} onAddNews={addNews} onDeleteNews={deleteNews} />}

          {tab === 'tabla' && (
            <div className="two-col" style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 24, alignItems: 'start' }}>
              <TablaTab data={data} standings={standings} onViewTeam={setViewTeamId} />
              <RightColumn data={data} onViewPlayer={openPlayerProfile} />
            </div>
          )}

          {tab === 'equipos' && <EquiposTab data={data} isAdmin={isAdmin} onAdd={addTeam} onEdit={editTeam} onDelete={deleteTeam} standings={standings} onViewTeam={setViewTeamId} />}
          {tab === 'jugadores' && <JugadoresTab data={data} isAdmin={isAdmin} onAdd={addPlayer} onEdit={editPlayer} onDelete={deletePlayer} onBulkAdd={bulkAddPlayers} onViewPlayer={openPlayerProfile} />}
          {tab === 'partidos' && <PartidosTab data={data} isAdmin={isAdmin} onAddMatch={(p) => addMatch('liga', p)} onGenerateFixture={generateFixture}
            onGenerateReturnLeg={generateReturnLeg}
            onViewPlayer={openPlayerProfile}
            onAutoSchedule={autoScheduleMatches}
            onSaveResult={(id, payload) => saveMatchResult('liga', id, payload)} onDeleteMatch={(id) => deleteMatch('liga', id)}
            onSaveAnyMatch={saveMatchResult} />}
          {tab === 'playoffs' && <PlayoffsTab data={data} isAdmin={isAdmin} onAddMatch={(p) => addMatch('playoff', p)} onAutoSchedule={autoSchedulePlayoffs} onViewPlayer={openPlayerProfile}
            onSaveResult={(id, payload) => saveMatchResult('playoff', id, payload)} onDeleteMatch={(id) => deleteMatch('playoff', id)}
            onSaveAnyMatch={saveMatchResult} />}
          {tab === 'sanciones' && <SancionesTab data={data} isAdmin={isAdmin} onMarkServed={markSuspensionServed} onViewPlayer={openPlayerProfile} />}

          {tab === 'stats' && (
            <div className="two-col" style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 24, alignItems: 'start' }}>
              <StatsTab data={data} standings={standings} onViewPlayer={openPlayerProfile} />
              <RightColumn data={data} onViewPlayer={openPlayerProfile} />
            </div>
          )}
        </div>
      </div>

      {settingsOpen && isAdmin && <SettingsModal meta={data.meta} onClose={() => setSettingsOpen(false)} onSave={saveSettings} onReset={resetAll} onExport={exportData} onImport={importData} />}
      {loginOpen && <LoginModal onClose={() => setLoginOpen(false)} />}
      {viewTeamId && data.teams.find(t => t.id === viewTeamId) && (
        <TeamDetailModal team={data.teams.find(t => t.id === viewTeamId)} data={data} onClose={() => setViewTeamId(null)} onViewPlayer={openPlayerProfile} />
      )}
      {viewPlayerId && data.players.find(p => p.id === viewPlayerId) && (
        <PlayerDetailModal key={viewPlayerId} player={data.players.find(p => p.id === viewPlayerId)} data={data} focus={viewPlayerFocus} onClose={closePlayerProfile} />
      )}
    </div>
  );
}

/* ---------- Tabs ---------- */

function QuickStat({ label, value, isText, onClick }) {
  return (
    <button onClick={onClick} className="card quick-stat" style={{ padding: '20px', textAlign: 'left', cursor: 'pointer', width: '100%', border: 'none' }}>
      <div style={{ fontSize: 11, color: '#64748B', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div className="font-display" style={{ fontSize: isText ? 16 : 28, fontWeight: 800, color: '#0F172A', marginTop: 6 }}>{value}</div>
    </button>
  );
}

function PremiosSection({ data, onViewPlayer }) {
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
            <button type="button" className="font-display player-profile-trigger" aria-label={'Ver estadísticas de ' + topScorer.p.name} onClick={() => onViewPlayer(topScorer.p.id)} style={{ fontWeight: 700, fontSize: 16, color: '#0F172A', marginTop: 6, padding: 0 }}>{topScorer.p.name} ({topScorer.stats.goals})</button>
          </div>
        )}
      </div>
    </div>
  );
}

function InicioTab({ data, isAdmin, onNavigate, onViewTeam, onViewPlayer, onAddNews, onDeleteNews }) {
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

      <div className="hero-banner" style={{ position: 'relative', height: 220, borderRadius: 16, overflow: 'hidden', marginBottom: 24, background: '#0F172A', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)' }}>
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, #22C55E 0%, #16A34A 100%)', clipPath: 'polygon(42% 0, 100% 0, 68% 100%, 0 100%)' }} />
        {!data.meta.logoUrl && <Trophy size={160} color="rgba(255,255,255,.05)" style={{ position: 'absolute', right: 24, bottom: -24 }} />}
        <div className="hero-content" style={{ position: 'relative', zIndex: 1, height: '100%', display: 'flex', alignItems: 'center', gap: 24, padding: '0 40px' }}>
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

      <PremiosSection data={data} onViewPlayer={onViewPlayer} />

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
        Desempate: puntos → diferencia de gol → goles a favor.
      </div>
    </div>
  );
}

function EquiposTab({ data, isAdmin, onAdd, onEdit, onDelete, standings, onViewTeam }) {
  const [modal, setModal] = useState(null);
  const [confirmId, setConfirmId] = useState(null);
  const [search, setSearch] = useState('');
  const visibleTeams = data.teams.filter(t => normalizeSearchText(t.name).includes(normalizeSearchText(search)));

  return (
    <div className="tournament-pane teams-page">
      <div className="pane-heading">
        <div>
          <div className="pane-kicker"><Trophy size={13} /> Clubes del campeonato</div>
          <h2 className="pane-title">Equipos participantes</h2>
          <p className="pane-description">Conoce los planteles y sigue su rendimiento en la liga.</p>
        </div>
        <div className="pane-actions">
          <span className="pane-counter"><Users size={15} /><strong>{data.teams.length}</strong> equipos</span>
          {isAdmin && <button className="btn btn-primary" onClick={() => setModal('new')}><Plus size={16} /> Agregar equipo</button>}
        </div>
      </div>

      {data.teams.length > 0 && (
        <div className="pane-toolbar">
          <div className="pane-field">
            <label htmlFor="team-search">Encuentra un equipo</label>
            <div className="pane-search">
              <Search size={17} />
              <input id="team-search" type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nombre…" />
              {search && <button type="button" aria-label="Limpiar búsqueda de equipos" onClick={() => setSearch('')}><X size={14} /></button>}
            </div>
          </div>
          <span style={{ fontSize: 12, color: '#64748B' }} aria-live="polite">{visibleTeams.length} de {data.teams.length} equipos · {data.players.length} jugadores inscritos</span>
        </div>
      )}

      {data.teams.length === 0 ? (
        <EmptyState Icon={Users} title="Sin equipos todavía" text="Agrega el primer equipo del campeonato para empezar a registrar jugadores y partidos." />
      ) : visibleTeams.length === 0 ? (
        <div className="pane-empty">
          <div className="pane-empty-icon"><Search size={30} /></div>
          <h3>No encontramos ese equipo</h3>
          <p>Prueba con otra parte del nombre o limpia la búsqueda.</p>
          <button className="btn btn-outline btn-sm" style={{ marginTop: 18 }} onClick={() => setSearch('')}>Mostrar equipos</button>
        </div>
      ) : (
        <div className="clubs-grid">
          {visibleTeams.map(team => {
            const row = standings.find(s => s.teamId === team.id) || { pj: 0, pts: 0, dg: 0, gf: 0, gc: 0 };
            const position = standings.findIndex(s => s.teamId === team.id) + 1;
            const playerCount = data.players.filter(p => p.teamId === team.id).length;
            const recentMatches = data.matches.filter(m => m.played && (m.teamAId === team.id || m.teamBId === team.id))
              .slice().sort((a, b) => ((b.date || '') + ' ' + (b.time || ''))
                .localeCompare((a.date || '') + ' ' + (a.time || '')) || (Number(b.jornada) || 0) - (Number(a.jornada) || 0))
              .slice(0, 5).reverse();
            return (
              <article key={team.id} className="team-card club-card" style={{ '--club-color': team.color || '#0D9488' }}>
                <button type="button" className="club-card-cover" aria-label={'Abrir ficha de ' + team.name} onClick={() => onViewTeam(team.id)}>
                  <div className="club-cover-emblem" aria-hidden="true"><Crest team={team} size="lg" /></div>
                  {team.photoUrl && <img className="club-cover-photo" src={team.photoUrl} alt={'Plantel de ' + team.name} loading="lazy" onError={e => { e.currentTarget.style.display = 'none'; }} />}
                  <span className="club-position"><Trophy size={12} /> {row.pj > 0 && position ? '#' + position + ' en la tabla' : 'Sin resultados'}</span>
                  <span className="club-cover-label">{data.meta.category || 'Campeonato'} · Liga</span>
                </button>
                <div className="club-card-content">
                  <div className="club-card-heading">
                    <button type="button" className="club-card-name" onClick={() => onViewTeam(team.id)} aria-label={'Ver plantel de ' + team.name}>
                      <Crest team={team} size="md" /><span>{team.name}</span>
                    </button>
                    {isAdmin && (
                      <div className="team-card-actions club-card-actions">
                        <button className="icon-btn-subtle" aria-label={'Editar equipo ' + team.name} onClick={() => setModal(team.id)}><Pencil size={14} /></button>
                        {confirmId !== team.id && <button className="icon-btn-subtle danger" aria-label={'Eliminar equipo ' + team.name} onClick={() => setConfirmId(team.id)}><Trash2 size={14} /></button>}
                      </div>
                    )}
                  </div>
                  <div className="club-card-members"><Users size={14} /> {playerCount} jugador{playerCount !== 1 ? 'es' : ''} en el plantel</div>
                  <div className="club-card-metrics">
                    <div className="club-card-metric"><strong>{row.pts}</strong><span>Puntos</span></div>
                    <div className="club-card-metric"><strong>{row.pj}</strong><span>Partidos</span></div>
                    <div className="club-card-metric"><strong>{row.dg > 0 ? '+' + row.dg : row.dg}</strong><span>Dif. de gol</span></div>
                  </div>
                  <div className="club-card-goals"><span>Goles a favor <b>{row.gf}</b></span><span>En contra <b>{row.gc}</b></span></div>
                  <div className="club-card-form">
                    <span>{recentMatches.length ? 'Últimos ' + recentMatches.length + ' en liga' : 'Sin partidos finalizados'}</span>
                    <div className="club-form-results">
                      {recentMatches.map(m => {
                        const own = Number(m.teamAId === team.id ? m.scoreA : m.scoreB);
                        const rival = Number(m.teamAId === team.id ? m.scoreB : m.scoreA);
                        const valid = Number.isFinite(own) && Number.isFinite(rival);
                        const kind = !valid ? '' : own > rival ? 'win' : own < rival ? 'loss' : 'draw';
                        const label = !valid ? 'Sin marcador válido' : own > rival ? 'Ganado' : own < rival ? 'Perdido' : 'Empatado';
                        return <span key={m.id} className={'club-form-result ' + kind} title={'Fecha ' + m.jornada + ': ' + label + ' · ' + m.scoreA + '-' + m.scoreB} aria-label={'Fecha ' + m.jornada + ': ' + label}>{!valid ? '—' : own > rival ? 'G' : own < rival ? 'P' : 'E'}</span>;
                      })}
                    </div>
                  </div>
                  <div className="club-card-footer">
                    <button type="button" className="club-card-open" onClick={() => onViewTeam(team.id)} aria-label={'Ver ficha completa de ' + team.name}>Ver plantel y estadísticas <ArrowUpRight size={15} /></button>
                  </div>
                  {isAdmin && confirmId === team.id && (
                    <div className="club-card-confirm"><ConfirmInline text="¿Eliminar equipo?" onConfirm={() => { onDelete(team.id); setConfirmId(null); }} onCancel={() => setConfirmId(null)} /></div>
                  )}
                </div>
              </article>
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

function TeamRosterTable({ data, players, isAdmin, onViewPlayer, onEditClick, onDelete, confirmId, onConfirmDelete }) {
  return (
    <div className="roster-table-wrap">
      <table className="roster-table" aria-label="Plantel del equipo seleccionado">
        <thead><tr><th>Jugador</th><th>Dorsal</th><th>Edad</th><th>Goles</th><th>Tarjetas</th>{isAdmin && <th>Acciones</th>}</tr></thead>
        <tbody>
          {players.map(p => {
            const age = ageColor(p.age);
            const stats = getPlayerStats(p.id, data);
            return (
              <tr key={p.id}>
                <td style={{ textAlign: 'left' }}>
                  <button type="button" className="player-profile-trigger roster-player-open" aria-label={'Ver estadísticas de ' + p.name} onClick={() => onViewPlayer(p.id)}>
                    <Avatar size={34} />
                    <span className="roster-player-text"><strong>{p.name}</strong><small>{p.position || 'Ver estadísticas'}</small></span>
                  </button>
                </td>
                <td data-label="Dorsal"><span className="roster-number">{p.number !== '' && p.number != null ? '#' + p.number : '—'}</span></td>
                <td data-label="Edad">{p.age !== '' && p.age != null ? <span className="roster-age" style={{ background: age.bg, color: age.fg }}>{p.age}</span> : <span style={{ color: '#94A3B8' }}>—</span>}</td>
                <td data-label="Goles"><span className={'roster-goals' + (stats.goals > 0 ? ' scored' : '')}>{stats.goals}</span></td>
                <td data-label="Tarjetas">
                  <span className="roster-cards">
                    {stats.yellow > 0 && <span className="roster-card-count yellow" title={stats.yellow + ' amarillas'}><span className="card-chip yellow" />{stats.yellow}</span>}
                    {stats.red > 0 && <span className="roster-card-count red" title={stats.red + ' rojas'}><span className="card-chip red" />{stats.red}</span>}
                    {!stats.yellow && !stats.red && <span style={{ color: '#94A3B8', fontSize: 10.5 }}>Sin tarjetas</span>}
                  </span>
                </td>
                {isAdmin && (
                  <td className="roster-action-cell">
                    <div className="roster-row-actions">
                      {confirmId === p.id ? (
                        <ConfirmInline text="¿Eliminar?" onConfirm={() => { onDelete(p.id); onConfirmDelete(null); }} onCancel={() => onConfirmDelete(null)} />
                      ) : (
                        <>
                          <button className="icon-btn-subtle" aria-label={'Editar jugador ' + p.name} onClick={() => onEditClick(p.id)}><Pencil size={14} /></button>
                          <button className="icon-btn-subtle danger" aria-label={'Eliminar jugador ' + p.name} onClick={() => onConfirmDelete(p.id)}><Trash2 size={14} /></button>
                        </>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function JugadoresTab({ data, isAdmin, onAdd, onEdit, onDelete, onBulkAdd, onViewPlayer }) {
  const [modal, setModal] = useState(null);
  const [filterTeam, setFilterTeam] = useState('');
  const [search, setSearch] = useState('');
  const [confirmId, setConfirmId] = useState(null);
  const selectedTeam = data.teams.find(t => t.id === filterTeam);
  const teamPlayers = getTeamPlayers(data, filterTeam);
  const filtered = getTeamPlayers(data, filterTeam, search);
  const playerTotals = teamPlayers.reduce((total, p) => {
    const stats = getPlayerStats(p.id, data);
    return { goals: total.goals + (Number(stats.goals) || 0), yellow: total.yellow + stats.yellow, red: total.red + stats.red };
  }, { goals: 0, yellow: 0, red: 0 });

  return (
    <div className="tournament-pane players-page">
      <div className="pane-heading">
        <div>
          <div className="pane-kicker"><User size={13} /> Planteles</div>
          <h2 className="pane-title">Jugadores por equipo</h2>
          <p className="pane-description">Selecciona un equipo para ver sus jugadores y consultar sus estadísticas.</p>
        </div>
      </div>
      <div className="pane-toolbar">
        <div className="pane-field">
          <label htmlFor="roster-team">Equipo</label>
          <select id="roster-team" className="input" value={filterTeam} onChange={e => { setFilterTeam(e.target.value); setSearch(''); setConfirmId(null); }}>
            <option value="">Selecciona un equipo</option>
            {data.teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        {selectedTeam && (
          <div className="pane-field">
            <label htmlFor="roster-search">Busca en este plantel</label>
            <div className="pane-search">
              <Search size={17} />
              <input id="roster-search" type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Nombre o dorsal…" />
              {search && <button type="button" aria-label="Limpiar búsqueda de jugadores" onClick={() => setSearch('')}><X size={14} /></button>}
            </div>
          </div>
        )}
        {isAdmin && (
          <div className="pane-actions">
            <button className="btn btn-outline" disabled={!selectedTeam} title={!selectedTeam ? 'Primero selecciona un equipo' : undefined} onClick={() => setModal('bulk')}><FileText size={16} /> Pegar lista</button>
            <button className="btn btn-primary" disabled={!selectedTeam} title={!selectedTeam ? 'Primero selecciona un equipo' : undefined} onClick={() => setModal('new')}><Plus size={16} /> Agregar jugador</button>
          </div>
        )}
      </div>

      {!selectedTeam ? (
        <div className="pane-empty">
          <div className="pane-empty-icon"><Users size={32} /></div>
          <h3>{data.teams.length ? 'Elige un equipo para comenzar' : 'Primero registra un equipo'}</h3>
          <p>{data.teams.length ? 'Su plantel aparecerá aquí cuando lo selecciones en el menú de arriba.' : 'Agrega un equipo desde la sección Equipos y después podrás registrar su plantel.'}</p>
        </div>
      ) : (
        <>
          <div className="roster-banner" style={{ '--club-color': selectedTeam.color || '#0D9488' }}>
            <Crest team={selectedTeam} size="lg" />
            <div className="roster-banner-title"><h3>{selectedTeam.name}</h3><p>{teamPlayers.length} jugador{teamPlayers.length !== 1 ? 'es' : ''} · Pulsa un nombre para abrir su ficha</p></div>
            <div className="roster-summary"><span>⚽ {playerTotals.goals} goles registrados</span><span aria-label={playerTotals.yellow + ' tarjetas amarillas y ' + playerTotals.red + ' rojas'}><span className="card-chip yellow" />{playerTotals.yellow}<span className="card-chip red" />{playerTotals.red}</span></div>
          </div>
          {filtered.length === 0 ? (
            <div className="pane-empty">
              <div className="pane-empty-icon">{teamPlayers.length ? <Search size={30} /> : <User size={30} />}</div>
              <h3>{teamPlayers.length ? 'No encontramos ese jugador' : 'Este plantel todavía está vacío'}</h3>
              <p>{teamPlayers.length ? 'Prueba con otra parte del nombre o con el número de su dorsal.' : isAdmin ? 'Usa Agregar jugador o Pegar lista para registrar a los integrantes de este equipo.' : 'Todavía no hay jugadores registrados para este equipo.'}</p>
              {search && <button className="btn btn-outline btn-sm" style={{ marginTop: 18 }} onClick={() => setSearch('')}>Mostrar el plantel</button>}
            </div>
          ) : (
            <TeamRosterTable data={data} players={filtered} isAdmin={isAdmin} onViewPlayer={onViewPlayer} onEditClick={setModal} onDelete={onDelete} confirmId={confirmId} onConfirmDelete={setConfirmId} />
          )}
          {teamPlayers.length > 0 && (
            <div className="roster-footer">
              <span aria-live="polite">Mostrando {filtered.length} de {teamPlayers.length} jugadores</span>
              <div className="roster-age-key"><span><i style={{ background: '#10B981' }} />39 o menos</span><span><i style={{ background: '#F97316' }} />40–49</span><span><i style={{ background: '#EF4444' }} />50 o más</span></div>
            </div>
          )}
        </>
      )}

      {isAdmin && selectedTeam && modal === 'new' && <PlayerFormModal teams={data.teams} defaultTeamId={selectedTeam.id} onClose={() => setModal(null)} onSave={(p) => { onAdd(p); setModal(null); }} />}
      {isAdmin && selectedTeam && modal === 'bulk' && (
        <BulkPlayersModal teams={data.teams} defaultTeamId={selectedTeam.id}
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
    <div className="match-row" onClick={isClickable ? onOpen : undefined}
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

function PartidosTab({ data, isAdmin, onAddMatch, onGenerateFixture, onGenerateReturnLeg, onAutoSchedule, onSaveResult, onDeleteMatch, onSaveAnyMatch, onViewPlayer }) {
  const [modal, setModal] = useState(null);
  const [confirmGenerate, setConfirmGenerate] = useState(false);
  const [confirmSchedule, setConfirmSchedule] = useState(false);
  const [returnLegMessage, setReturnLegMessage] = useState(null);
  const openMatch = data.matches.find(m => m.id === modal);
  const maxJornada = data.matches.reduce((mx, m) => Math.max(mx, m.jornada || 0), 0);
  const returnLegExists = data.matches.some(m => Number(m.jornada) >= 6 && Number(m.jornada) <= 10);

  return (
    <div>
      {isAdmin && (
        <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {data.matches.length > 0 && (
              <button className="btn btn-outline" disabled={returnLegExists} onClick={() => {
                const result = onGenerateReturnLeg();
                setReturnLegMessage(result.error
                  ? { error: true, text: result.error }
                  : { error: false, text: 'Se añadieron ' + result.matches.length + ' partidos en las fechas 6 a 10, desde el ' + formatDate(result.firstDate) + ', con horarios sorteados. Los partidos anteriores se conservaron.' });
              }}><Calendar size={16} /> {returnLegExists ? 'Vuelta ya registrada (6–10)' : 'Crear vuelta (fechas 6–10)'}</button>
            )}
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

      {isAdmin && returnLegMessage && (
        <div role={returnLegMessage.error ? 'alert' : 'status'} style={{ fontSize: 13, color: returnLegMessage.error ? '#DC2626' : '#15803D', marginBottom: 16, lineHeight: 1.5 }}>
          {returnLegMessage.text}
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
          ? <MatchResultModal match={openMatch} teams={data.teams} players={data.players} allMatches={[...data.matches, ...data.playoffMatches]} onSwap={onSaveAnyMatch} onViewPlayer={onViewPlayer}
              onClose={() => setModal(null)}
              onSave={(payload) => { onSaveResult(openMatch.id, payload); setModal(null); }}
              onDelete={(id) => { onDeleteMatch(id); setModal(null); }} />
          : <MatchDetailModal match={openMatch} teams={data.teams} players={data.players} onClose={() => setModal(null)} onViewPlayer={onViewPlayer} />
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
      {[[teamA, m.scoreA], [teamB, m.scoreB]].map(([t, score], idx) => {
        const winnerIdx = m.played && m.scoreA !== m.scoreB ? (m.scoreA > m.scoreB ? 0 : 1) : -1;
        return (
        <div key={idx} className={'bracket-row' + (winnerIdx === idx ? ' winner' : winnerIdx >= 0 ? ' loser' : '')} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderBottom: idx === 0 ? '1px solid #F1F5F9' : 'none' }}>
          <Crest team={t} size="sm" />
          <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#0F172A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t ? t.name : 'Por definir'}</span>
          <span style={{ fontSize: 14, fontWeight: 800, color: m.played ? '#0F172A' : '#94A3B8', flexShrink: 0 }}>{m.played ? score : '–'}</span>
        </div>
        );
      })}
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

function PlayoffsTab({ data, isAdmin, onAddMatch, onAutoSchedule, onSaveResult, onDeleteMatch, onSaveAnyMatch, onViewPlayer }) {
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
          ? <MatchResultModal match={openMatch} teams={data.teams} players={data.players} allMatches={[...data.matches, ...data.playoffMatches]} onSwap={onSaveAnyMatch} onViewPlayer={onViewPlayer}
              onClose={() => setModal(null)}
              onSave={(payload) => { onSaveResult(openMatch.id, payload); setModal(null); }}
              onDelete={(id) => { onDeleteMatch(id); setModal(null); }} />
          : <MatchDetailModal match={openMatch} teams={data.teams} players={data.players} onClose={() => setModal(null)} onViewPlayer={onViewPlayer} />
      )}
    </div>
  );
}

function SancionesTab({ data, isAdmin, onMarkServed, onViewPlayer }) {
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
                    <button type="button" className="player-profile-trigger" aria-label={'Ver estadísticas de ' + p.name} onClick={() => onViewPlayer(p.id, stats.red > 0 ? 'red' : 'yellow')} style={{ fontWeight: 700, fontSize: 14.5, color: '#0F172A', padding: 0 }}>{p.name}</button>
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
                    <button type="button" className="player-profile-trigger" aria-label={'Ver estadísticas de ' + p.name} onClick={() => onViewPlayer(p.id, 'yellow')} style={{ fontWeight: 700, fontSize: 14.5, color: '#0F172A', padding: 0 }}>{p.name}</button>
                    <div style={{ fontSize: 12.5, marginTop: 2 }}><TeamChip team={team} size="sm" /></div>
                  </div>
                  <div className="yellow-meter" title={stats.yellowSinceReset + ' de ' + stats.yellowLimit + ' amarillas'}>
                    <span className="yellow-meter-dots">
                      {Array.from({ length: Math.min(stats.yellowLimit, 10) }).map((_, di) => (
                        <span key={di} className={'yellow-meter-dot' + (di < stats.yellowSinceReset ? ' on' : '')} />
                      ))}
                    </span>
                    <span className="yellow-meter-text">{stats.yellowSinceReset} / {stats.yellowLimit} amarillas</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
    </div>
  );
}

function StatsTab({ data, standings, onViewPlayer }) {
  const withStats = data.players.map(p => ({ p, stats: getPlayerStats(p.id, data) }));
  const topScorers = [...withStats].filter(x => x.stats.goals > 0).sort((a, b) => b.stats.goals - a.stats.goals).slice(0, 10);
  const topYellow = [...withStats].filter(x => x.stats.yellow > 0).sort((a, b) => b.stats.yellow - a.stats.yellow).slice(0, 10);
  const topRed = [...withStats].filter(x => x.stats.red > 0).sort((a, b) => b.stats.red - a.stats.red).slice(0, 10);

  const bestAttack = [...standings].sort((a, b) => b.gf - a.gf)[0];
  const bestDefense = [...standings].filter(s => s.pj > 0).sort((a, b) => a.gc - b.gc)[0];

  // Al tocar un jugador, la ficha se abre mostrando lo que corresponde al ranking (goles, amarillas o rojas).
  const ranking = (list, valueKey, label, cardType) => {
    const kind = cardType || 'goals';
    const top = list.length ? list[0].stats[valueKey] : 0;
    return (
      <div className={'card ranking-card ' + kind}>
        <div className="ranking-head">
          <div className="ranking-title font-display">
            {cardType ? <span className={'card-chip ' + cardType} /> : <Trophy size={18} />}
            {label}
          </div>
          {list.length > 0 && <span className="ranking-count">Top {list.length}</span>}
        </div>
        {list.length === 0 ? <div className="ranking-empty">Sin datos todavía.</div> : list.map(({ p, stats }, i) => {
          const team = data.teams.find(t => t.id === p.teamId);
          const pct = top > 0 ? Math.max(8, Math.round(stats[valueKey] / top * 100)) : 0;
          return (
            <button type="button" key={p.id} className="player-profile-trigger rank-row" aria-label={'Ver estadísticas de ' + p.name} onClick={() => onViewPlayer(p.id, kind)}>
              <span className={'rank-pos' + (i < 3 ? ' p' + (i + 1) : '')}>{i + 1}</span>
              <span className="rank-avatar" style={{ '--tc': team ? team.color : '#CBD5E1' }}><Avatar size={34} /></span>
              <span className="rank-main">
                <span className="rank-name">{p.name}</span>
                <span className="rank-team">{team ? team.name : 'Sin equipo'}</span>
                <span className="rank-track"><span className="rank-fill" style={{ width: pct + '%' }} /></span>
              </span>
              <span className="rank-value">
                {cardType && <CardBadge yellow={cardType === 'yellow' ? stats[valueKey] : 0} red={cardType === 'red' ? stats[valueKey] : 0} />}
                {stats[valueKey]}
              </span>
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px,1fr))', gap: 16, marginBottom: 24 }}>
        <div className="card stat-highlight attack">
          <div className="stat-highlight-icon"><BarChart3 size={22} /></div>
          <div className="stat-highlight-body">
            <div className="stat-highlight-label">Mejor ataque</div>
            <div className="stat-highlight-name font-display">{bestAttack ? teamName(data.teams, bestAttack.teamId) : '—'}</div>
            <div className="stat-highlight-value">{bestAttack ? bestAttack.gf + ' goles a favor' : ''}</div>
          </div>
        </div>
        <div className="card stat-highlight defense">
          <div className="stat-highlight-icon"><ShieldAlert size={22} /></div>
          <div className="stat-highlight-body">
            <div className="stat-highlight-label">Mejor defensa</div>
            <div className="stat-highlight-name font-display">{bestDefense ? teamName(data.teams, bestDefense.teamId) : '—'}</div>
            <div className="stat-highlight-value">{bestDefense ? bestDefense.gc + ' goles recibidos' : ''}</div>
          </div>
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
