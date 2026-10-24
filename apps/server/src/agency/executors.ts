import {LocalCodex} from './codex.js';
import {LocalClaudeCode} from './claude.js';

/** Codex is the default executor; Claude Code is selectable per worker. */
export class AgencyExecutors {
 readonly codex=new LocalCodex();
 readonly claude=new LocalClaudeCode();
 async status(){return {defaultProvider:'codex',codex:await this.codex.status(),claude:await this.claude.status()};}
 close(){this.codex.close();this.claude.close();}
}
