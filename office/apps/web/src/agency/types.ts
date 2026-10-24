export type Colleague = { id: string; name: string; role: string; voice: string; characterKey: string };
export type Project = { id: string; name: string; deletedAt?: string };
export type View = 'secretary' | 'command' | 'project';
export type WorkStatus = 'queued' | 'working' | 'waiting' | 'review' | 'done' | 'paused' | 'failed';
export type Worker = {
  id: string;
  projectId: string;
  name?: string;
  role: string;
  responsibility: string;
  characterKey: string;
  status: WorkStatus;
  assignmentId?: string;
  currentAction?: string;
  lead?: boolean;
  voice?: string;
};
export type Assignment = {
  id: string;
  projectId: string;
  workerId: string;
  title: string;
  brief: string;
  acceptance: string;
  status: WorkStatus;
  kind?: 'plan' | 'review';
  cwd: string;
  summary?: string;
  startedAt?: string;
  completedAt?: string;
};
export type Decision = {
  id: string;
  projectId: string;
  title: string;
  context: string;
  options?: string[];
  status: 'open' | 'decided';
  decision?: string;
  reason?: string;
  createdAt: string;
};
export type ProjectMemory = {
  outcome: string;
  checkpoint: string;
  latest: string;
  nextStep: string;
  updatedAt: string;
};
/** workerId is not in the file; main.ts fills it from the first contributor's name ('' when none) so Scene can walk the worker to Donna. */
export type Briefing = {
  id: string;
  projectId: string;
  workerId: string;
  title: string;
  summary: string;
  status: 'queued' | 'presented' | 'superseded';
  contributors: { name: string }[];
  createdAt: string;
};
export type CallState = 'off' | 'ringing' | 'listening' | 'thinking' | 'speaking';
export type Workspace = {
  revision: number;
  /** with: while a call is on, 'donna' or the id of the worker it is put through to. */
  call: { state: CallState; with?: string };
  secretary: Colleague;
  projects: (Project & { goal: string; memory: ProjectMemory })[];
  workers: Worker[];
  assignments: Assignment[];
  decisions: Decision[];
  briefings: Briefing[];
  activity: { at: string; projectId?: string; message: string }[];
};
