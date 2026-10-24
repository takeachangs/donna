import {LocalCodex} from './codex.js';
import {LocalClaudeCode} from './claude.js';

/** Claude is registered but deliberately not routed to the live queue until verified. */
export class AgencyExecutors {
 readonly codex=new LocalCodex();
 readonly claude=new LocalClaudeCode();
 async status(){return {defaultProvider:'codex',codex:await this.codex.status(),claude:this.claude.status()};}
 close(){this.codex.close();this.claude.close();}
}
