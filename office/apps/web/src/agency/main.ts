import { initLocale, setLocale, t } from '../i18n';
import { Engine } from '../render/Engine';
import { AgencyScene } from './Scene';
import type { Workspace, View, Assignment, Decision, Briefing } from './types';
import './style.css';
import './board.css';
initLocale();
setLocale('en');

// A display only: the server streams ~/.higgs/office.json over /agency-ws and this page draws it. Nothing here writes.
const root = document.querySelector<HTMLDivElement>('#agency-root')!;
root.innerHTML = `<main class="app">
 <header class="callbar">
  <span class="brand" aria-hidden="true"><svg class="brand-plan" viewBox="0 0 32 36" aria-hidden="true"><path d="M12 3H3v11h9M20 3h9v11h-9M12 19H3v11h9M20 19h9v11h-9M16 7v25" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="square"/><circle cx="16" cy="33" r="2.5" fill="currentColor"/></svg><span class="brand-wordmark">${t('agency.title')}</span></span>
  <span id="pill" class="pill" data-state="reconnecting" role="status">${t('agency.loading')}</span>
 </header>
 <section class="office" aria-label="${t('agency.scene')}">
  <div id="agency-scene"><div id="handoff-status" class="handoff-status" role="status" hidden></div></div>
  <div class="scene-tools"><button id="zoom-out" class="quiet" aria-label="${t('agency.zoom_out')}" title="${t('agency.zoom_out')}">−</button><button id="zoom-in" class="quiet" aria-label="${t('agency.zoom_in')}" title="${t('agency.zoom_in')}">+</button><button id="overview" class="quiet" title="${t('agency.scene_controls')}">${t('agency.map')}</button></div>
  <button id="drawer-open" class="drawer-tab">${t('agency.reports')} <span id="unread-count" class="count"></span></button>
  <aside id="drawer" class="drawer" aria-labelledby="drawer-title">
   <header class="drawer-head"><button id="drawer-back" class="quiet" hidden>${t('agency.back')}</button><h2 id="drawer-title">${t('agency.reports')}</h2><button id="drawer-close" class="icon-button" aria-label="${t('agency.hide_panel')}">×</button></header>
   <div class="drawer-body">
    <section id="questions-section" hidden><h3>${t('agency.questions')}</h3><div id="questions"></div></section>
    <section id="reports-section"><ol id="reports" class="report-list"></ol><h3>${t('agency.activity')}</h3><ol id="activity" class="activity-list"></ol></section>
    <section id="report-section" hidden><div id="report"></div></section>
    <section id="room-section" hidden><div id="room"></div></section>
   </div>
  </aside>
 </section>
 <dialog id="work-dialog" aria-labelledby="work-title"><header><h2 id="work-title"></h2><button id="work-close" aria-label="${t('agency.close')}">×</button></header><p id="work-meta"></p><div id="work-body"></div></dialog>
</main>`;
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
const make = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => {
  const e = document.createElement(tag);
  e.className = cls;
  e.textContent = text;
  return e;
};
let scene: AgencyScene | undefined,
  starting: Promise<void> | undefined,
  workspace: Workspace | undefined,
  selectedProject = '',
  view: View = 'command',
  online = false,
  attempt = 0,
  call = '';
let pane: 'reports' | 'report' = 'reports',
  openReport: string | undefined,
  drawerOpen = true;
const signatures = new Map<string, string>();
const name = (id: string) =>
  (id === 'mara' ? workspace?.secretary.name : undefined) || workspace?.workers.find((w) => w.id === id)?.name || id;
const projectName = (id: string) => workspace?.projects.find((p) => p.id === id)?.name || id;
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
/** The status line where the call bar was: bridge.py's call state, or Reconnecting while the office server is away. */
function paintCall() {
  const state = workspace?.call?.state || 'off',
    pill = el('pill'),
    label: Record<string, string> = {
      off: t('agency.call_off'),
      ringing: t('agency.call_ringing', { name: workspace?.secretary.name || 'Donna' }),
      listening: t('agency.call_listening'),
      thinking: t('agency.call_thinking'),
      speaking: t('agency.call_speaking'),
    };
  pill.dataset.state = online ? state : 'reconnecting';
  pill.textContent = online ? label[state] || label.off : t('agency.reconnecting');
  if (!scene || state === call) return;
  // Donna walks to the entrance phone while she rings you, and talks or thinks with the voice.
  if ((state === 'ringing') !== (call === 'ringing')) scene.ring(state === 'ringing');
  scene.activity('mara', state === 'speaking' ? 'talking' : state === 'thinking' ? 'thinking' : 'idle');
  call = state;
}
function assignmentCard(a: Assignment) {
  const worker = workspace?.workers.find((w) => w.id === a.workerId),
    row = make('article', 'work-item');
  row.dataset.assignmentId = a.id;
  row.append(make('h3', 'item-title', a.title));
  const byline = make('div', 'item-byline'),
    owner = make('div', 'item-owner');
  owner.append(make('strong', '', worker?.name || t('agency.naming')), make('span', '', worker?.role || ''));
  byline.append(
    owner,
    make('span', 'work-status', t(`agency.${a.status === 'review' ? 'badge_review' : 'status_' + a.status}`)),
  );
  row.append(byline);
  const progress = a.status === 'working' ? worker?.currentAction : a.summary;
  if (progress) row.append(make('p', 'item-summary summary-preview', progress));
  const actions = make('div', 'item-actions');
  const inspect = make('button', 'inspect-result', t('agency.view_details'));
  inspect.setAttribute('aria-haspopup', 'dialog');
  inspect.setAttribute('aria-label', t('agency.view_assignment', { title: a.title }));
  inspect.onclick = () => openWork(a.id);
  actions.append(inspect);
  row.append(actions);
  return row;
}
function openWork(id: string) {
  const a = workspace?.assignments.find((a) => a.id === id);
  if (!a) return;
  const worker = workspace?.workers.find((w) => w.id === a.workerId),
    body = el('work-body');
  body.replaceChildren();
  el('work-title').textContent = a.title;
  el('work-meta').textContent = [
    worker?.name || t('agency.naming'),
    worker?.role,
    projectName(a.projectId),
    t(`agency.status_${a.status}`),
  ]
    .filter(Boolean)
    .join(' · ');
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
  if (a.summary) body.append(make('h3', '', t('agency.result_summary')), make('p', 'work-prose', a.summary));
  const details = make('details', 'execution-details');
  details.dataset.key = a.id;
  details.append(make('summary', '', t('agency.execution_details')), make('p', '', a.brief));
  if (a.acceptance) details.append(make('p', '', `${t('agency.acceptance')}: ${a.acceptance}`));
  if (a.cwd) details.append(make('p', '', `${t('agency.working_directory')}: ${a.cwd}`));
  if (worker?.currentAction)
    details.append(make('p', '', t('agency.latest_action')), make('pre', 'token-usage', worker.currentAction));
  body.append(details);
  const dialog = el<HTMLDialogElement>('work-dialog');
  dialog.showModal();
  dialog.scrollTop = 0;
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
  const li = make('li', 'report-row'),
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
  const replay = make('button', 'quiet', t('agency.show_handoff')),
    actions = make('div', 'report-actions');
  replay.onclick = () => {
    setView('command');
    el('agency-scene').scrollIntoView({ block: 'center', behavior: 'instant' });
    scene?.replayHandoff(b.id);
  };
  actions.append(replay);
  return [
    make('h3', 'report-title', b.title),
    make('p', 'item-meta', [byWho(b), projectName(b.projectId), when(b.createdAt)].filter(Boolean).join(' · ')),
    make('p', 'work-prose', b.summary),
    actions,
  ];
}
/** "Needs you": an open decision, read-only. Donna asks it on the call; the answer goes back through her. */
function questionCard(d: Decision) {
  const row = make('article', 'question-item');
  row.dataset.decisionId = d.id;
  row.append(
    make('strong', '', d.title),
    make('p', 'item-meta', [projectName(d.projectId), d.options?.join(' / ')].filter(Boolean).join(' · ')),
  );
  if (d.context) row.append(make('p', 'item-summary summary-preview', d.context));
  return row;
}
function activityRow(a: Workspace['activity'][number]) {
  const li = make('li', 'activity-row');
  li.append(
    make('span', 'report-meta', [when(a.at), a.projectId && projectName(a.projectId)].filter(Boolean).join(' · ')),
    make('span', '', a.message),
  );
  return li;
}
function roomItems(p: NonNullable<Workspace['projects'][number]>, assignments: Assignment[], reports: Briefing[]) {
  const out: HTMLElement[] = [];
  for (const [key, value] of [
    ['agency.latest', p.memory?.latest],
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
    report = reports.find((b) => b.id === openReport),
    project = workspace.projects.find((p) => p.id === selectedProject && !p.deletedAt),
    activity = workspace.activity.slice(-12).reverse();
  if (pane === 'report' && !report) pane = 'reports';
  // The open report wins, then the selected room, else the list: needs-you questions, reports and activity.
  const detail = pane === 'report',
    room = !detail && view === 'project',
    list = !detail && !room,
    names = [workspace.workers.map((w) => [w.id, w.name]), workspace.projects.map((p) => [p.id, p.name])];
  el('questions-section').hidden = !list || !questions.length;
  el('reports-section').hidden = !list;
  el('report-section').hidden = !detail;
  el('room-section').hidden = !room;
  el('drawer-back').hidden = list;
  el('drawer-title').textContent = room ? project?.name || t('agency.project') : t('agency.reports');
  el('unread-count').textContent = unread ? String(unread) : '';
  document.body.dataset.drawer = drawerOpen ? 'open' : 'closed';
  const roomReports = reports.filter((b) => b.projectId === selectedProject),
    roomWork = workspace.assignments.filter((a) => a.projectId === selectedProject),
    workerMeta = workspace.workers.map((w) => [w.id, w.name, w.role, w.currentAction]);
  section('questions', [questions, names], () => questions.map(questionCard));
  section('reports', [reports, names], () =>
    reports.length ? reports.map(reportRow) : [make('li', 'empty', t('agency.no_reports'))],
  );
  section('activity', [activity, names], () => activity.map(activityRow));
  section('report', [report, names], () => (report ? reportDetail(report) : []));
  section('room', [project, roomWork, roomReports, workerMeta, names], () =>
    project ? roomItems(project, roomWork, roomReports) : [],
  );
}
function render() {
  if (!workspace) return;
  document.body.dataset.view = view;
  if (selectedProject && !workspace.projects.some((p) => p.id === selectedProject && !p.deletedAt)) {
    selectedProject = '';
    if (view === 'project') {
      view = 'command';
      scene?.overview();
      document.body.dataset.view = view;
    }
  }
  scene?.workspace(workspace);
  paintCall();
  renderDrawer();
}
/** Scene walks briefing.workerId to Donna, so it must be a worker with a desk. The producer may send the lead's id
 * (the brain row has no desk) or none: then it is the first contributor's worker. */
function adapt(w: Workspace): Workspace {
  const desk = (id?: string) => w.workers.find((k) => !k.lead && k.id === id)?.id;
  return {
    ...w,
    briefings: w.briefings.map((b) => {
      const contributors = b.contributors || [];
      return {
        ...b,
        contributors,
        workerId:
          desk(b.workerId) ||
          w.workers.find((k) => !k.lead && k.name === contributors[0]?.name)?.id ||
          b.workerId ||
          '',
      };
    }),
  };
}
function startScene(w: Workspace) {
  return (starting ??= (async () => {
    const engine = new Engine(el('agency-scene'));
    await engine.init();
    const s = new AgencyScene(
      engine,
      el('agency-scene'),
      [{ ...w.secretary, id: 'mara' }],
      (id) => {
        s.focus(id);
        if (id === 'mara') setView('secretary');
        else {
          const worker = workspace?.workers.find((w) => w.id === id);
          if (worker) switchProject(worker.projectId);
        }
      },
      () => {},
      switchProject,
      (person) => {
        el('handoff-status').hidden = !person;
        el('handoff-status').textContent = person ? t('agency.handoff_status', { name: person }) : '';
      },
    );
    await engine.loadScene(s);
    engine.start();
    scene = s;
    render();
    s.viewRoom(view === 'project' ? selectedProject : view);
    s.focus('mara');
  })());
}
/** The server sends the workspace on connect and on every change of the file; reconnect with backoff (1 s doubling, 15 s cap). */
function connect() {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/agency-ws`);
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type !== 'workspace') return;
    online = true;
    attempt = 0;
    workspace = adapt(m.workspace);
    render();
    void startScene(workspace);
  };
  ws.onclose = () => {
    online = false;
    paintCall();
    window.setTimeout(connect, Math.min(15000, 1000 * 2 ** attempt++));
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
  render();
  drawerTop();
}
function switchProject(id: string) {
  if (id === 'command' || id === 'secretary') {
    setView(id);
    return;
  }
  pane = 'reports';
  setDrawer(true);
  selectedProject = id;
  setView('project');
}
el('overview').onclick = () => setView('command');
el('zoom-in').onclick = () => scene?.zoomBy(1 / 1.25);
el('zoom-out').onclick = () => scene?.zoomBy(1.25);
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
setDrawer(true);
connect();
