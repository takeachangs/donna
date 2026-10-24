import { initLocale, setLocale, t } from '../i18n';
import { Engine } from '../render/Engine';
import { AgencyScene } from './Scene';
import { OfficeAudio, chime } from './Audio';
import { projectActions } from './projectActions';
import { callControls, drawerSections, reportActions, redials, backoff, keyAction } from './call';
import type { Pane } from './call';
import type { State, Colleague, Project, Workspace, View, Assignment, Decision, Briefing } from './types';
import { version } from '../../../../package.json';
import './style.css';
import './board.css';
initLocale();
setLocale('en');

const root = document.querySelector<HTMLDivElement>('#agency-root')!;
root.innerHTML = `<main class="app">
 <header class="callbar">
  <span class="brand" aria-hidden="true"><svg class="brand-plan" viewBox="0 0 32 36" aria-hidden="true"><path d="M12 3H3v11h9M20 3h9v11h-9M12 19H3v11h9M20 19h9v11h-9M16 7v25" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="square"/><circle cx="16" cy="33" r="2.5" fill="currentColor"/></svg><span class="brand-wordmark">${t('agency.title')}</span></span>
  <span id="pill" class="pill" data-state="available" role="status">${t('agency.pill_available')}</span>
  <button id="connect" class="primary">${t('agency.connect')}</button>
  <button id="mic" aria-pressed="false" hidden disabled>${t('agency.mute')}</button>
  <button id="interrupt" class="quiet" hidden disabled>${t('agency.interrupt')}</button>
  <p class="caption" aria-live="polite"><span id="caption"></span><span id="status">${t('agency.loading')}</span></p>
  <details id="type-instead"><summary>${t('agency.type_instead')}</summary>
   <form id="command-form"><label class="sr-only" for="command">${t('agency.command')}</label><input id="command" maxlength="5000" autocomplete="off" placeholder="${t('agency.placeholder')}" disabled><button id="send" disabled>${t('agency.send')}</button></form></details>
  <button id="gear" class="icon-button" aria-label="${t('agency.engine_settings')}" title="${t('agency.engine_settings')}" aria-expanded="false">⚙</button>
 </header>
 <section class="office" aria-label="${t('agency.scene')}">
  <div id="agency-scene"><div id="handoff-status" class="handoff-status" role="status" hidden></div></div>
  <div class="scene-tools"><button id="zoom-out" class="quiet" aria-label="${t('agency.zoom_out')}" title="${t('agency.zoom_out')}">−</button><button id="zoom-in" class="quiet" aria-label="${t('agency.zoom_in')}" title="${t('agency.zoom_in')}">+</button><button id="overview" class="quiet" title="${t('agency.scene_controls')}">${t('agency.map')}</button></div>
  <button id="drawer-open" class="drawer-tab">${t('agency.reports')} <span id="unread-count" class="count"></span></button>
  <aside id="drawer" class="drawer" aria-labelledby="drawer-title">
   <header class="drawer-head"><button id="drawer-back" class="quiet" hidden>${t('agency.back')}</button><h2 id="drawer-title">${t('agency.reports')}</h2><button id="drawer-close" class="icon-button" aria-label="${t('agency.hide_panel')}">×</button></header>
   <div class="drawer-body">
    <section id="questions-section" hidden><h3>${t('agency.questions')}</h3><div id="questions"></div></section>
    <section id="reports-section"><ol id="reports" class="report-list"></ol></section>
    <section id="report-section" hidden><div id="report"></div></section>
    <section id="room-section" hidden><div id="room"></div></section>
    <section id="engine-section" hidden><dl id="engine" class="engine-list"></dl><div class="engine-actions"><button id="new-project">${t('agency.new_room')}</button><button id="deleted-projects">${t('agency.recently_deleted')} <span id="deleted-count" class="count"></span></button></div></section>
   </div>
  </aside>
 </section>
 <div id="toasts" class="toasts" aria-live="polite"></div>
 <dialog id="project-dialog"><form id="project-form"><h2>${t('agency.new_room')}</h2><label for="project-name">${t('agency.project_name')}</label><input id="project-name" required maxlength="80" placeholder="${t('agency.project_name_hint')}"><label for="project-brief">${t('agency.project_brief')}</label><textarea id="project-brief" maxlength="2000" rows="3"></textarea><p id="project-error" role="alert" hidden></p><div class="project-dialog-actions"><button type="button" id="project-cancel">${t('agency.cancel')}</button><button type="submit">${t('agency.create_room')}</button></div></form></dialog>
 <dialog id="work-dialog" aria-labelledby="work-title"><header><h2 id="work-title"></h2><button id="work-close" aria-label="${t('agency.close')}">×</button></header><p id="work-meta"></p><div id="work-body"></div></dialog>
</main>`;
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
const make = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => {
  const e = document.createElement(tag);
  e.className = cls;
  e.textContent = text;
  return e;
};
let socket: WebSocket | undefined,
  audio: OfficeAudio | undefined,
  scene: AgencyScene | undefined,
  cast: Colleague[] = [],
  workspace: Workspace | undefined,
  ready = false,
  mic = false,
  micBlocked = false,
  currentResponse = '',
  connected = false,
  firstTurnAt = 0,
  projects: Project[] = [],
  selectedProject = '',
  view: View = 'command',
  switching = false;
let hungUp = false,
  redialing = false,
  redialTimer: number | undefined,
  redialAttempt = 0,
  micWasLive = false,
  voiceDown = false,
  offline = false,
  failures = 0;
let pane: Pane = 'reports',
  openReport: string | undefined,
  drawerOpen = true;
const heard = new Set<string>(),
  signatures = new Map<string, string>();
let listenWhenReady: string | undefined,
  ringing: string | undefined,
  ringShown = false,
  seenBriefings: Set<string> | undefined;
const roomKey = 'personal-agency-room';
const name = (id: string) =>
  (id === 'mara' ? workspace?.secretary.name : undefined) ||
  workspace?.workers.find((w) => w.id === id)?.name ||
  cast.find((a) => a.id === id)?.name ||
  ({ iris: 'Iris', theo: 'Theo' } as Record<string, string>)[id] ||
  id;
const projectName = (id: string) => workspace?.projects.find((p) => p.id === id)?.name || id;
const callOn = () => !!socket || redialing;
const send = (e: any) => {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(e));
};
const status = (text: string) => {
  el('status').textContent = text;
};
const projectManager = projectActions({
  projects: () => workspace?.projects || [],
  request: api,
  refresh: loadWorkspace,
  notice: (m) => toast(m, 'info'),
});
class TransportError extends Error {
  constructor() {
    super('Offline');
    this.name = 'TransportError';
  }
}
/** Short visible message: at most 3 stacked, each gone after 6 s, the same text never twice. */
function toast(text: string, level: 'error' | 'warn' | 'info' = 'error') {
  const host = el('toasts');
  if ([...host.children].some((c) => c.textContent === text)) return;
  const n = make('div', 'toast', text);
  n.dataset.level = level;
  host.append(n);
  while (host.children.length > 3) host.firstElementChild!.remove();
  window.setTimeout(() => n.remove(), 6000);
}
/** A dropped connection is the pill's business (reconnecting), never a toast; anything else is. */
function fail(err: unknown) {
  if (err instanceof TransportError) {
    offline = true;
    failures++;
    paintCall();
  } else toast(String(err).replace(/^Error: /, ''));
}
function paintCall() {
  const c = callControls({
    socket: callOn(),
    ringing: !!ringing,
    mic: mic ? 'live' : micBlocked ? 'blocked' : 'muted',
    reconnecting: redialing || voiceDown || offline,
  });
  el('connect').textContent = t(c.connect);
  el('connect').classList.toggle('is-ringing', !!ringing && !c.onCall);
  el('mic').textContent = t(c.mic);
  el('mic').setAttribute('aria-pressed', String(!mic && !micBlocked));
  el('mic').hidden = el('interrupt').hidden = !c.onCall;
  el('pill').textContent = t(c.pillLabel);
  el('pill').dataset.state = c.pill;
  document.body.dataset.call = String(c.onCall);
  document.body.dataset.pill = c.pill;
  if (c.typeOpen) el<HTMLDetailsElement>('type-instead').open = true;
  renderDrawer();
  return c;
}
const controls = (value: boolean) => {
  ready = value;
  document.body.dataset.ready = String(value);
  for (const id of ['mic', 'interrupt', 'command', 'send']) (el(id) as HTMLButtonElement).disabled = !value;
  renderDrawer();
};
async function api<T = any>(url: string, body?: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(
      url,
      body === undefined
        ? undefined
        : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    );
  } catch {
    throw new TransportError();
  }
  if (r.status >= 500) throw new TransportError();
  let value: any;
  try {
    value = await r.json();
  } catch {
    throw new TransportError();
  }
  if (r.status === 404 && body !== undefined && /^\/agency-api\/projects\/[^/]+\/(rename|delete|restore)$/.test(url))
    throw Error(t('agency.project_controls_unavailable'));
  if (!r.ok) throw Error(value.error || t('agency.request_failed'));
  return value;
}
function section(id: string, value: unknown, render: () => HTMLElement[]) {
  const signature = JSON.stringify(value);
  if (signatures.get(id) === signature) return;
  signatures.set(id, signature);
  const host = el(id),
    open = new Set([...host.querySelectorAll<HTMLDetailsElement>('details[open]')].map((d) => d.dataset.key));
  host.replaceChildren(...render());
  for (const d of host.querySelectorAll<HTMLDetailsElement>('details')) if (open.has(d.dataset.key)) d.open = true;
}
function empty(text: string) {
  return make('p', 'empty', text);
}
// Text readers may already have read the full caption while speech is playing.
// The text request cancels generation server-side; do not truncate its visible
// conversation history to the audio playhead when they type a follow-up.
function command(text: string) {
  if (!ready || !text.trim()) return;
  audio?.stop();
  firstTurnAt = performance.now();
  currentResponse = '';
  el('caption').textContent = '';
  send({ type: 'text', text, agentId: 'mara' });
  status(t('agency.thinking'));
}
function assignmentCard(a: Assignment) {
  const worker = workspace?.workers.find((w) => w.id === a.workerId),
    row = make('article', 'work-item');
  row.dataset.assignmentId = a.id;
  row.append(make('h3', 'item-title', a.title));
  const byline = make('div', 'item-byline'),
    owner = make('div', 'item-owner');
  owner.append(
    make('strong', '', worker?.name || t('agency.naming')),
    make('span', '', worker?.role || t('agency.codex_worker')),
  );
  byline.append(
    owner,
    make('span', 'work-status', t(`agency.${a.status === 'review' ? 'badge_review' : 'status_' + a.status}`)),
  );
  row.append(byline);
  const progress =
    a.status === 'working'
      ? t('agency.codex_executing')
      : a.status === 'queued'
        ? t('agency.execution_queued')
        : a.summary;
  if (progress || a.error)
    row.append(make('p', a.error ? 'item-summary' : 'item-summary summary-preview', a.error || progress));
  appendArtifacts(row, a);
  const actions = make('div', 'item-actions');
  const inspect = make('button', 'inspect-result', t('agency.view_details'));
  inspect.setAttribute('aria-haspopup', 'dialog');
  inspect.setAttribute('aria-label', t('agency.view_assignment', { title: a.title }));
  inspect.onclick = () => openWork(a.id);
  actions.append(inspect);
  function action(label: string, endpoint: string) {
    const b = make('button', '', t(label));
    b.onclick = () =>
      void (async () => {
        b.disabled = true;
        try {
          await api(`/agency-api/assignments/${a.id}/${endpoint}`, {});
          await loadWorkspace();
        } catch (err) {
          fail(err);
          b.disabled = false;
        }
      })();
    actions.append(b);
  }
  if (a.status === 'review') action('agency.accept', 'accept');
  if (['working', 'queued', 'waiting'].includes(a.status)) action('agency.pause_work', 'pause');
  if (['paused', 'failed', 'waiting'].includes(a.status)) action('agency.resume_work', 'resume');
  if (actions.childElementCount) row.append(actions);
  return row;
}
function appendArtifacts(host: HTMLElement, a: Pick<Assignment, 'artifacts'>, fullPath = false) {
  for (const saved of [true, false]) {
    const files = (a.artifacts || []).filter((artifact) => !!artifact.snapshotAt === saved);
    if (!files.length) continue;
    const group = make('div', 'artifact-group');
    group.append(
      make('p', 'artifact-heading', t(saved ? 'agency.saved_deliverables' : 'agency.current_project_files')),
    );
    const links = make('div', 'artifact-links');
    for (const artifact of files) {
      const link = make(
        'a',
        'artifact-link',
        fullPath ? artifact.path : artifact.path.split(/[\\/]/).pop() || artifact.path,
      );
      if (artifact.url.startsWith('/') || /^https?:\/\//.test(artifact.url)) {
        link.href = artifact.url;
        link.target = '_blank';
        link.rel = 'noopener';
      }
      link.title = artifact.path;
      links.append(link);
    }
    group.append(links);
    if (!saved) group.append(make('p', 'artifact-note', t('agency.current_files_note')));
    host.append(group);
  }
}
function openWork(id: string) {
  const a = workspace?.assignments.find((a) => a.id === id);
  if (!a) return;
  const worker = workspace?.workers.find((w) => w.id === a.workerId),
    body = el('work-body');
  body.replaceChildren();
  el('work-title').textContent = a.title;
  el('work-meta').textContent =
    `${worker?.name || t('agency.naming')} · ${worker?.role || t('agency.codex_worker')} · ${projectName(a.projectId)} · ${t(`agency.status_${a.status}`)}`;
  if (a.completedAt) {
    const completedAt = new Date(a.completedAt);
    if (!Number.isNaN(completedAt.valueOf()))
      body.append(
        make(
          'p',
          'item-meta',
          t('agency.completed_at', {
            time: new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeStyle: 'short' }).format(completedAt),
          }),
        ),
      );
  }
  if (a.error) body.append(make('p', 'work-error', a.error));
  if (a.summary) body.append(make('h3', '', t('agency.result_summary')), make('p', 'work-prose', a.summary));
  appendArtifacts(body, a, true);
  if (a.verification?.length) {
    body.append(make('h3', '', t('agency.verification')));
    const verification = make('ul', 'verification');
    for (const v of a.verification) verification.append(make('li', '', v));
    body.append(verification);
  }
  const details = make('details', 'execution-details');
  details.dataset.key = a.id;
  details.append(make('summary', '', t('agency.execution_details')), make('p', '', a.brief));
  if (a.acceptance) details.append(make('p', '', `${t('agency.acceptance')}: ${a.acceptance}`));
  details.append(make('p', '', `${t('agency.working_directory')}: ${a.cwd}`));
  if (worker?.currentAction)
    details.append(make('p', '', t('agency.latest_action')), make('pre', 'token-usage', worker.currentAction));
  if (a.sessionId) {
    const label = make('label', '', t('agency.native_session')),
      input = make('input', 'session-command') as HTMLInputElement;
    input.readOnly = true;
    input.value = a.provider === 'claude' ? `claude --resume ${a.sessionId}` : `codex resume ${a.sessionId}`;
    input.setAttribute('aria-label', t('agency.native_session'));
    input.onclick = () => input.select();
    details.append(label, input, make('p', 'agency-note', t('agency.native_session_hint')));
  }
  if (a.tokens)
    details.append(
      make('p', 'agency-note', t('agency.native_tokens_note')),
      make('pre', 'token-usage', JSON.stringify(a.tokens, null, 2)),
    );
  body.append(details);
  const dialog = el<HTMLDialogElement>('work-dialog');
  dialog.showModal();
  dialog.scrollTop = 0;
}
function presentBriefing(id?: string) {
  if (!ready) return;
  setView('secretary');
  audio?.stop();
  firstTurnAt = performance.now();
  currentResponse = '';
  el('caption').textContent = '';
  send({ type: 'present_briefing', briefingId: id });
  status(t('agency.thinking'));
}
const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.valueOf())
    ? ''
    : new Intl.DateTimeFormat(
        'en',
        d.toDateString() === new Date().toDateString()
          ? { hour: 'numeric', minute: '2-digit' }
          : { month: 'short', day: 'numeric' },
      ).format(d);
};
const byWho = (b: Briefing) => b.contributors.map((c) => c.name).join(', ') || name(b.workerId);
function showReport(id: string) {
  pane = 'report';
  openReport = id;
  setDrawer(true);
  renderDrawer();
  drawerTop();
}
function reportRow(b: Briefing) {
  const li = make('li', `report-row${b.id === ringing ? ' is-ringing' : ''}`),
    open = make('button', 'report-open');
  li.dataset.status = b.status;
  open.append(
    make('strong', '', b.title),
    make('span', 'report-meta', [byWho(b), projectName(b.projectId), when(b.createdAt)].filter(Boolean).join(' · ')),
    make('span', 'report-badge', t(b.status === 'queued' ? 'agency.unread' : 'agency.read')),
  );
  open.onclick = () => showReport(b.id);
  li.append(open);
  return li;
}
function reportDetail(b: Briefing) {
  const out: HTMLElement[] = [
      make('h3', 'report-title', b.title),
      make('p', 'item-meta', [byWho(b), projectName(b.projectId), when(b.createdAt)].filter(Boolean).join(' · ')),
      make('p', 'work-prose', b.summary),
    ],
    files = make('div');
  appendArtifacts(files, b, true);
  out.push(...(files.children as unknown as HTMLElement[]));
  if (b.verification.length) {
    const list = make('ul', 'verification');
    for (const v of b.verification) list.append(make('li', '', v));
    out.push(make('p', 'artifact-heading', t('agency.verification')), list);
  }
  out.push(make('p', 'agency-note', t('agency.presentation_not_acceptance')));
  const can = reportActions(callOn(), b.status),
    actions = make('div', 'report-actions');
  if (can.ask) {
    const ask = make('button', 'primary', t('agency.ask_donna'));
    ask.disabled = !ready;
    ask.onclick = () => presentBriefing(b.id);
    actions.append(ask);
  }
  if (can.markRead) {
    const done = make('button', 'quiet', t('agency.mark_read'));
    done.onclick = () =>
      void (async () => {
        done.disabled = true;
        try {
          await api(`/agency-api/briefings/${b.id}/presented`, {});
          await loadWorkspace();
        } catch (err) {
          fail(err);
          done.disabled = false;
        }
      })();
    actions.append(done);
  }
  const replay = make('button', 'quiet', t('agency.show_handoff'));
  replay.onclick = () => {
    setView('command');
    el('agency-scene').scrollIntoView({ block: 'center', behavior: 'instant' });
    scene?.replayHandoff(b.id);
  };
  actions.append(replay);
  return [...out, actions];
}
function questionCard(d: Decision) {
  const row = make('article', 'question-item'),
    call = make('button', 'primary', t('agency.call_to_answer'));
  row.dataset.decisionId = d.id;
  call.onclick = () => void dial().catch(dialFailed);
  row.append(
    make('strong', '', d.title),
    make('p', 'item-meta', [projectName(d.projectId), d.options?.join(' / ')].filter(Boolean).join(' · ')),
    make('p', 'item-summary summary-preview', d.context),
    call,
  );
  return row;
}
function roomItems(p: NonNullable<Workspace['projects'][number]>, assignments: Assignment[], reports: Briefing[]) {
  const out: HTMLElement[] = [];
  for (const [key, value] of [
    ['agency.checkpoint', p.memory?.checkpoint],
    ['agency.next_step', p.memory?.nextStep],
  ])
    if (value) {
      const row = make('div', 'brief-row');
      row.append(make('span', '', t(key)), make('p', '', value));
      out.push(row);
    }
  out.push(
    make('h3', '', t('agency.work')),
    ...(assignments.length ? assignments.map(assignmentCard) : [empty(t('agency.no_work'))]),
  );
  if (reports.length) {
    const list = make('ol', 'report-list');
    list.append(...reports.map(reportRow));
    out.push(make('h3', '', t('agency.reports')), list);
  }
  const settings = make('button', 'quiet', t('agency.project_settings'));
  settings.id = 'room-settings';
  settings.onclick = () => projectManager.open(p.id);
  out.push(settings);
  return out;
}
function renderDrawer() {
  if (!workspace) return;
  const live = new Set(workspace.projects.filter((p) => !p.deletedAt).map((p) => p.id)),
    reports = workspace.briefings
      .filter((b) => (b.status === 'queued' || b.status === 'presented') && live.has(b.projectId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    unread = reports.filter((b) => b.status === 'queued').length;
  const questions = workspace.decisions.filter((d) => d.status === 'open' && live.has(d.projectId)),
    onCall = callOn(),
    report = reports.find((b) => b.id === openReport),
    project = workspace.projects.find((p) => p.id === selectedProject && !p.deletedAt);
  if (pane === 'report' && !report) pane = 'reports';
  const s = drawerSections({ onCall, view, pane, questions: questions.length }),
    names = [workspace.workers.map((w) => [w.id, w.name]), workspace.projects.map((p) => [p.id, p.name])];
  for (const [id, on] of [
    ['questions-section', s.questions],
    ['reports-section', s.reports],
    ['report-section', s.report],
    ['room-section', s.room],
    ['engine-section', s.engine],
  ] as const)
    el(id).hidden = !on;
  el('drawer-back').hidden = !s.back;
  el('drawer-title').textContent = s.engine
    ? t('agency.engine')
    : s.report
      ? t('agency.reports')
      : s.room
        ? project?.name || t('agency.project')
        : t('agency.reports');
  el('unread-count').textContent = unread ? String(unread) : '';
  el('gear').setAttribute('aria-expanded', String(drawerOpen && s.engine));
  document.body.dataset.drawer = drawerOpen ? 'open' : 'closed';
  const roomReports = reports.filter((b) => b.projectId === selectedProject),
    roomWork = workspace.assignments.filter((a) => a.projectId === selectedProject),
    workerMeta = workspace.workers.map((w) => [w.id, w.name, w.role, w.currentAction]);
  section('questions', [questions, names], () => questions.map(questionCard));
  section('reports', [reports, names, ringing], () =>
    reports.length ? reports.map(reportRow) : [make('li', 'empty', t('agency.no_reports'))],
  );
  section('report', [report, names, onCall, ready], () => (report ? reportDetail(report) : []));
  section('room', [project, roomWork, roomReports, workerMeta, names, ringing], () =>
    project ? roomItems(project, roomWork, roomReports) : [],
  );
}
function ring(id: string | undefined) {
  if (ringing === id) return;
  ringing = id;
  if (id && !socket) {
    chime();
    scene?.ring(true);
    ringShown = true;
    status(
      t('agency.ring_status', {
        name: workspace?.secretary.name || '',
        title: workspace?.briefings.find((b) => b.id === id)?.title || '',
      }),
    );
  } else if (ringShown) {
    scene?.ring(false);
    ringShown = false;
    if (!socket) status(t('agency.offline_ready'));
  }
  paintCall();
}
function watchRing() {
  if (!workspace) return;
  const queued = workspace.briefings
      .filter((b) => b.status === 'queued' && workspace!.projects.some((p) => p.id === b.projectId && !p.deletedAt))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    ids = queued.map((b) => b.id);
  if (!seenBriefings) {
    seenBriefings = new Set(ids);
    return;
  }
  const fresh = queued.find((b) => !seenBriefings!.has(b.id));
  ids.forEach((id) => seenBriefings!.add(id));
  if (ringing && !ids.includes(ringing)) ring(undefined);
  if (fresh && !socket && !ringing) ring(fresh.id);
}
function render() {
  if (!workspace) return;
  watchRing();
  document.body.dataset.view = view;
  document.body.dataset.ready = String(ready);
  projects = workspace.projects.filter((p) => !p.deletedAt);
  if (selectedProject && !projects.some((p) => p.id === selectedProject)) {
    if (callOn()) hangUp();
    selectedProject = projects[0]?.id || '';
    view = 'command';
    rememberRoom();
    scene?.overview();
    document.body.dataset.view = view;
  }
  // Connected: the server selects the room it creates and sends `state`; switch_project here would cancel the voice's in-progress turn.
  if (!selectedProject && projects.length && !socket) {
    selectedProject = projects[0].id;
    rememberRoom();
  }
  scene?.workspace(workspace);
  projectManager.renderTrash();
  el('deleted-count').textContent = workspace.projects.some((p) => p.deletedAt)
    ? String(workspace.projects.filter((p) => p.deletedAt).length)
    : '';
  renderDrawer();
}
async function loadEngine() {
  const get = async (u: string) => {
    try {
      const r = await fetch(u);
      return r.ok ? await r.json() : undefined;
    } catch {
      return undefined;
    }
  };
  const [health, st] = await Promise.all([get('/agency-api/health'), get('/agency-api/status')]),
    p = st?.providers,
    key = health?.available ?? st?.available,
    def = health?.engines?.default ?? p?.defaultProvider;
  const up = (x: any) =>
    x
      ? t(x.available && x.authenticated !== false ? 'agency.engine_ready' : 'agency.engine_unavailable') +
        (x.version ? ` · ${x.version}` : '')
      : undefined;
  const rows: [string, string | undefined][] = [
    [t('agency.engine_voice_key'), key === undefined ? undefined : t(key ? 'agency.key_set' : 'agency.key_missing')],
    [t('agency.engine_default'), def ? t(def === 'claude' ? 'agency.claude_label' : 'agency.codex_label') : undefined],
    [t('agency.codex_label'), up(p?.codex)],
    [t('agency.claude_label'), up(p?.claude)],
    [t('agency.engine_version'), health?.version ?? version],
  ];
  el('engine').replaceChildren(
    ...rows.flatMap(([k, v]) => (v ? [make('dt', '', k), make('dd', '', v)] : [])),
    ...((health?.problems || []) as string[]).map((m) => make('dd', '', m)),
  );
}
function onEvent(e: any) {
  if (e.type === 'workspace') {
    workspace = e.workspace;
    render();
  }
  if (e.type === 'view' && ['secretary', 'command', 'project'].includes(e.view)) {
    view = e.view;
    scene?.viewRoom(view === 'project' ? selectedProject : view);
    render();
  }
  if (e.type === 'state') {
    selectedProject = e.state.id;
    rememberRoom();
    render();
  }
  if (e.type === 'project_ready') {
    switching = false;
    controls(true);
    status(t('agency.ready'));
    send({ type: 'set_view', view });
  }
  if (e.type === 'ring') ring(e.briefingId);
  if (e.type === 'colleague_ready' || e.type === 'connection_retry') status(t('agency.connecting'));
  if (e.type === 'ready') {
    connected = true;
    redialing = false;
    redialAttempt = 0;
    controls(true);
    status(t(paintCall().idle));
  }
  if (e.type === 'voice_state') {
    voiceDown = e.state === 'reconnecting';
    const c = paintCall();
    status(t(voiceDown ? 'agency.reconnecting' : c.idle));
  }
  if (e.type === 'notice' && e.message)
    toast(String(e.message), ['error', 'warn', 'info'].includes(e.level) ? e.level : 'info');
  if (e.type === 'thinking') {
    scene?.activity('mara', 'thinking');
    status(t('agency.thinking'));
    if (!firstTurnAt) firstTurnAt = performance.now();
  }
  // ponytail: Scene.toolTrip lands with #17; until then tool events are ignored.
  if (e.type === 'tool_started' || e.type === 'tool_finished') {
    const s = scene as any;
    if (typeof s?.toolTrip === 'function') s.toolTrip(e.type === 'tool_started' ? 'start' : 'finish', e);
  }
  if (e.type === 'audio') {
    audio?.play(e);
    scene?.activity('mara', 'talking');
  }
  if (e.type === 'speech_text') {
    if (currentResponse !== e.responseId) {
      currentResponse = e.responseId;
      el('caption').textContent = '';
    }
    el('caption').textContent += e.delta;
  }
  if (e.type === 'speech_started') {
    audio?.stop();
    firstTurnAt = performance.now();
    status(t('agency.listening'));
    currentResponse = '';
    el('caption').textContent = '';
  }
  if (e.type === 'interrupted') {
    audio?.stop();
    status(t('agency.interrupted'));
  }
  if (e.type === 'await_playback') audio?.done(e.jobId);
  if (e.type === 'turn_done') {
    if (!e.cancelled) {
      status(t(paintCall().idle));
    }
    scene?.activity('mara', 'idle');
    void loadWorkspace().catch(fail);
  }
  if (e.type === 'error' || e.type === 'colleague_disconnected') {
    toast(e.message || t('agency.connection_lost'));
    status(t('agency.error'));
    if (switching) {
      switching = false;
      controls(connected);
    }
  }
}
function rememberRoom() {
  localStorage.setItem(roomKey, selectedProject);
  const u = new URL(location.href);
  if (selectedProject) u.searchParams.set('room', selectedProject);
  else u.searchParams.delete('room');
  history.replaceState({}, '', u);
}
function clearRedial() {
  window.clearTimeout(redialTimer);
  redialTimer = undefined;
  redialing = false;
  redialAttempt = 0;
}
/** Everything a finished call leaves behind, whether the user hung up or the line was lost for good. */
function endCall() {
  el('caption').textContent = '';
  currentResponse = '';
  ring(undefined);
  clearRedial();
  listenWhenReady = undefined;
  audio?.stop();
  mic = false;
  connected = false;
  voiceDown = false;
  controls(false);
  paintCall();
  void audio?.mic(false);
  el<HTMLButtonElement>('connect').disabled = false;
  status(t('agency.disconnected'));
}
function hangUp() {
  hungUp = true;
  const ws = socket;
  if (ws) {
    send({ type: 'stop' });
    socket = undefined;
    ws.close();
  }
  endCall();
}
const dialFailed = (err: unknown) => {
  el<HTMLButtonElement>('connect').disabled = false;
  fail(err);
};
async function dial(o: { resume?: boolean } = {}) {
  const resume = !!o.resume,
    connect = el<HTMLButtonElement>('connect');
  if (!resume) {
    if (callOn() || connect.disabled) return;
    hungUp = false;
    if (ringing) {
      listenWhenReady ??= ringing;
      ring(undefined);
    }
  }
  audio ??= new OfficeAudio(send, (e, delay) => {
    if (heard.has(e.jobId)) return;
    heard.add(e.jobId);
    void fetch('/agency-api/measurement', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId: selectedProject,
        kind: 'first-audible',
        jobId: e.jobId,
        agentId: e.agentId,
        commandToAudibleMs: firstTurnAt ? performance.now() - firstTurnAt + delay : undefined,
      }),
    });
    firstTurnAt = 0;
  });
  if (!resume) connect.disabled = true;
  await audio.resume();
  status(t('agency.connecting'));
  if (!resume || micWasLive)
    try {
      await audio.mic(true);
      mic = true;
      micBlocked = false;
    } catch {
      mic = false;
      micBlocked = true;
    }
  if (hungUp) {
    void audio.mic(false);
    mic = false;
    return;
  }
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/agency-ws`);
  socket = ws;
  paintCall();
  ws.onopen = () => {
    send(
      resume
        ? { type: 'start', roomId: selectedProject, view, resume: true }
        : { type: 'start', roomId: selectedProject, view, answer: listenWhenReady },
    );
    listenWhenReady = undefined;
    connect.disabled = false;
  };
  ws.onmessage = (e) => {
    try {
      onEvent(JSON.parse(e.data));
    } catch (err) {
      fail(err);
    }
  };
  ws.onclose = (e) => {
    if (socket !== ws) return;
    socket = undefined;
    connected = false;
    controls(false);
    micWasLive = mic;
    void audio?.mic(false);
    mic = false;
    audio?.stop();
    connect.disabled = false;
    const wait = redials(e, hungUp) ? backoff(redialAttempt++) : undefined;
    if (wait !== undefined) {
      redialing = true;
      status(t('agency.reconnecting'));
      paintCall();
      redialTimer = window.setTimeout(() => {
        redialTimer = undefined;
        void dial({ resume: true }).catch(dialFailed);
      }, wait);
      return;
    }
    const lost = redials(e, hungUp);
    endCall();
    if (lost) toast(t('agency.call_lost'));
  };
}
function setDrawer(open: boolean) {
  drawerOpen = open;
  document.body.dataset.drawer = open ? 'open' : 'closed';
}
const drawerTop = () => {
  document.querySelector<HTMLElement>('.drawer-body')!.scrollTop = 0;
};
function setView(next: View) {
  view = next;
  scene?.viewRoom(next === 'project' ? selectedProject : next);
  if (connected) send({ type: 'set_view', view });
  render();
  drawerTop();
}
function switchProject(id: string) {
  if (id === 'command' || id === 'secretary') {
    setView(id);
    return;
  }
  if (switching) return;
  pane = 'reports';
  setDrawer(true);
  setView('project');
  scene?.viewRoom(id);
  if (selectedProject === id) return;
  audio?.stop();
  selectedProject = id;
  rememberRoom();
  render();
  status(t('agency.switching'));
  if (connected) {
    switching = true;
    controls(false);
    send({ type: 'switch_project', roomId: id });
  } else status(t('agency.offline_ready'));
}
function toggleMic() {
  if (!audio || redialing) return;
  void (async () => {
    try {
      await audio!.resume();
      await audio!.mic(!mic);
      mic = !mic;
      micBlocked = false;
      paintCall();
      status(t(mic ? 'agency.listening' : 'agency.ready'));
    } catch {
      mic = false;
      micBlocked = true;
      paintCall();
      toast(t('agency.mic_blocked'), 'warn');
    }
  })();
}
function holdOn() {
  audio?.stop();
  send({ type: 'interrupt' });
  status(t('agency.interrupted'));
}
const keyFor = (e: KeyboardEvent) => {
  const n = e.target as HTMLElement | null;
  return keyAction({
    key: e.key,
    typing: !!n && (/^(INPUT|TEXTAREA|SELECT)$/.test(n.tagName) || n.isContentEditable),
    dialog: !!document.querySelector('dialog[open]'),
    onCall: callOn(),
  });
};
el('overview').onclick = () => setView('command');
el('zoom-in').onclick = () => scene?.zoomBy(1 / 1.25);
el('zoom-out').onclick = () => scene?.zoomBy(1.25);
el('new-project').onclick = () => el<HTMLDialogElement>('project-dialog').showModal();
el('project-cancel').onclick = () => el<HTMLDialogElement>('project-dialog').close();
el('deleted-projects').onclick = () => projectManager.trash();
el('project-form').onsubmit = (e) => {
  e.preventDefault();
  void (async () => {
    const submit = el('project-form').querySelector<HTMLButtonElement>('[type=submit]')!;
    submit.disabled = true;
    el('project-error').hidden = true;
    try {
      const p = await api<Project>('/agency-api/projects', {
        name: el<HTMLInputElement>('project-name').value,
        brief: el<HTMLTextAreaElement>('project-brief').value,
      });
      await loadWorkspace();
      el<HTMLDialogElement>('project-dialog').close();
      el<HTMLFormElement>('project-form').reset();
      switchProject(p.id);
    } catch (err) {
      el('project-error').hidden = false;
      el('project-error').textContent = String(err);
    } finally {
      submit.disabled = false;
    }
  })();
};
el('connect').onclick = () => {
  if (callOn()) hangUp();
  else void dial().catch(dialFailed);
};
el('mic').onclick = toggleMic;
el('interrupt').onclick = holdOn;
el('command-form').onsubmit = (e) => {
  e.preventDefault();
  const input = el<HTMLInputElement>('command');
  command(input.value);
  input.value = '';
};
el('work-close').onclick = () => el<HTMLDialogElement>('work-dialog').close();
el('drawer-close').onclick = () => {
  setDrawer(false);
  renderDrawer();
};
el('drawer-open').onclick = () => {
  setDrawer(true);
  renderDrawer();
};
el('drawer-back').onclick = () => {
  if (pane === 'reports' && view === 'project') setView('command');
  else {
    pane = 'reports';
    renderDrawer();
    drawerTop();
  }
};
el('gear').onclick = () => {
  if (drawerOpen && pane === 'engine') pane = 'reports';
  else {
    pane = 'engine';
    setDrawer(true);
    void loadEngine();
  }
  renderDrawer();
  drawerTop();
};
window.addEventListener('keydown', (e) => {
  const a = keyFor(e);
  if (a === 'ptt') {
    e.preventDefault();
    if (!e.repeat) toggleMic();
  } else if (a === 'interrupt') holdOn();
});
window.addEventListener('keyup', (e) => {
  if (keyFor(e) === 'ptt') e.preventDefault();
});
window.addEventListener('pagehide', () => {
  hungUp = true;
  clearRedial();
  socket?.close();
  void audio?.close();
});
async function loadWorkspace() {
  const next = await api<Workspace>('/agency-api/workspace');
  workspace = next;
  if (offline || failures) {
    offline = false;
    failures = 0;
    paintCall();
  }
  render();
}
// Self-scheduling: 1.5 s normally, backing off while the server is unreachable.
function schedulePoll() {
  window.setTimeout(
    async () => {
      if (document.visibilityState !== 'hidden') await loadWorkspace().catch(fail);
      schedulePoll();
    },
    failures ? (backoff(failures - 1, Infinity) ?? 15000) : 1500,
  );
}
async function boot() {
  const data = await api('/agency-api/status');
  cast = data.assistants.filter((a: Colleague) => a.id === 'mara');
  workspace = await api<Workspace>('/agency-api/workspace');
  projects = workspace.projects.filter((p) => !p.deletedAt);
  const candidate = new URLSearchParams(location.search).get('room') || localStorage.getItem(roomKey) || '';
  if (candidate && /^[a-f0-9-]{36}$/.test(candidate) && !workspace.projects.some((p) => p.id === candidate)) {
    const old = await api<State>(`/agency-api/rooms/${candidate}`);
    if (old.projectName || old.documents.length) {
      await api('/agency-api/projects/register', { id: candidate, name: old.projectName || t('agency.first_project') });
      workspace = await api<Workspace>('/agency-api/workspace');
      projects = workspace.projects.filter((p) => !p.deletedAt);
    }
  }
  selectedProject = projects.some((p) => p.id === candidate) ? candidate : projects[0]?.id || '';
  rememberRoom();
  await loadWorkspace();
  return data;
}
const initFailed = (err: unknown) => {
  fail(err);
  status(t('agency.error'));
};
async function init(n = 0) {
  let data: any;
  try {
    data = await boot();
  } catch (err) {
    if (err instanceof TransportError) {
      fail(err);
      window.setTimeout(() => void init(n + 1).catch(initFailed), backoff(n, Infinity) ?? 15000);
      return;
    }
    throw err;
  }
  const engine = new Engine(el('agency-scene'));
  await engine.init();
  scene = new AgencyScene(
    engine,
    el('agency-scene'),
    cast,
    (id) => {
      scene?.focus(id);
      if (id === 'mara') setView('secretary');
      else {
        const worker = workspace?.workers.find((w) => w.id === id);
        if (worker) switchProject(worker.projectId);
      }
    },
    (n, total) => status(`${t('agency.loading')} ${n}/${total}`),
    switchProject,
    (person) => {
      el('handoff-status').hidden = !person;
      el('handoff-status').textContent = person ? t('agency.handoff_status', { name: person }) : '';
    },
  );
  await engine.loadScene(scene);
  engine.start();
  render();
  scene.viewRoom(view === 'project' ? selectedProject : view);
  scene.focus('mara');
  status(t('agency.offline_ready'));
  if (!data.available) toast(t('agency.missing_key'));
  schedulePoll();
}
setDrawer(true);
void init().catch(initFailed);
