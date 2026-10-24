import * as THREE from 'three'
import {Engine,type GameScene} from '../render/Engine'
import {AssetLoader} from '../vendor/agentshire/AssetLoader'
import {NPC} from '../vendor/agentshire/NPC'
import {NPCManager} from '../vendor/agentshire/NPCManager'
import {t} from '../i18n'
import type {Colleague,Project,Worker,Workspace} from './types'

type Room={id:string;x:number;width:number;group:THREE.Group;stations:THREE.Group}
export class AgencyScene implements GameScene {
 private assets=new AssetLoader();private npcs:NPCManager;private rooms=new Map<string,Room>();private selected='mara';private loaded=false;private resize:ResizeObserver
 private pointer?:{x:number;y:number;target:THREE.Vector3};private target=new THREE.Vector3(15.7,.3,5.6);private current=this.target.clone();private zoom=1;private currentZoom=1;private corridor?:THREE.Mesh;private workerSignature='';private secretaryName='';private lastWorkspace?:Workspace;private activities=new Map<string,string>();private roomId='secretary';private lights:THREE.Light[]=[];private events=new AbortController()
 constructor(private engine:Engine,private container:HTMLElement,private cast:Colleague[],private select:(id:string)=>void,private progress:(n:number,total:number)=>void,private selectRoom:(id:string)=>void){this.npcs=new NPCManager(engine.world.scene,container);this.resize=new ResizeObserver(()=>this.fit());this.resize.observe(container)}
 private fit(){const w=this.container.clientWidth,h=this.container.clientHeight;this.engine.renderer.setSize(w,h);this.engine.camera.aspect=w/Math.max(1,h);this.engine.camera.updateProjectionMatrix()}
 private box(parent:THREE.Object3D,w:number,h:number,d:number,x:number,y:number,z:number,color:number){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),new THREE.MeshStandardMaterial({color,roughness:.85}));m.userData.agencyOwned=true;m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m}
 private clearOwned(group:THREE.Object3D){group.traverse(o=>{const m=o as THREE.Mesh;if(!m.userData.agencyOwned)return;m.geometry?.dispose();for(const material of (Array.isArray(m.material)?m.material:[m.material])){(material as THREE.MeshBasicMaterial).map?.dispose();material.dispose()}});group.clear()}
 private furniture(g:THREE.Group,key:string,x:number,z:number,scale=1,rotation=0){const m=this.assets.getFurnitureModel(key);if(m){m.position.set(x,0,z);m.scale.setScalar(scale);m.rotation.y=rotation;g.add(m)}return m}
 private screen(g:THREE.Group,name:string,role:string,x:number,z:number,width=1.15){
  this.box(g,.12,.4,.1,x,1.5,z,0x3d3934);this.box(g,width,.72,.09,x,1.9,z,0x37332e)
  const c=document.createElement('canvas');c.width=512;c.height=256;const ctx=c.getContext('2d')!;ctx.fillStyle='#25231f';ctx.fillRect(0,0,512,256);ctx.fillStyle='#D4A574';ctx.font='bold 50px system-ui';ctx.fillText(name.slice(0,20),28,98,450);ctx.fillStyle='#E7DDCC';ctx.font='34px system-ui';ctx.fillText(role.slice(0,27),28,174,450)
  const screen=new THREE.Mesh(new THREE.PlaneGeometry(width-.12,.59),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(c)}));screen.userData.agencyOwned=true;screen.position.set(x,1.9,z+.06);g.add(screen)
 }
 private desk(g:THREE.Group,name:string,role:string,x:number,z:number){this.furniture(g,'table_medium',x,z,1.05);this.furniture(g,'chair_B',x,z+1.7,1,Math.PI);this.screen(g,name,role,x,z)}
 private buildRoom(id:string,name:string,x:number,width:number){
  const g=new THREE.Group();g.position.x=x;this.engine.world.scene.add(g)
  this.box(g,width,.18,10,width/2,-.1,5,id==='command'?0xb49a79:0xbca88b);this.box(g,width,2.3,.18,width/2,1.15,0,0xe2dbcd)
  for(let z=.65;z<10;z+=.7)this.box(g,width,.012,.013,width/2,.001,z,0xae997c)
  this.box(g,2.5,1.35,.12,width*.56,1.45,.13,0x8f806c);this.box(g,2.25,1.1,.13,width*.56,1.45,.2,0xc7d3ce);this.box(g,.05,1.15,.16,width*.56,1.45,.26,0xe7ddcc);this.box(g,2.28,.05,.16,width*.56,1.45,.26,0xe7ddcc)
  for(const side of [0,width]){const suiteDoor=(id==='command'&&side===width)||(id==='secretary'&&side===0);if(suiteDoor){this.box(g,.18,1.5,5.4,side,.75,2.7,0xcac0ae);this.box(g,.18,1.5,2.5,side,.75,8.75,0xcac0ae)}else this.box(g,.18,1.5,10,side,.75,5,0xcac0ae)}
  const flank=(width-2.4)/2;this.box(g,flank,.45,.18,flank/2,.225,10,0xcac0ae);this.box(g,flank,.45,.18,width-flank/2,.225,10,0xcac0ae);this.box(g,2.5,.06,.25,width/2,.03,10,0x675745)
  this.furniture(g,'shelf_B_small_decorated',.7,1.2,1.2);this.furniture(g,'cactus_medium_A',width-.7,1,1.5);this.furniture(g,'lamp_standing',width-.7,8.8,1.2)
  if(id==='command'){
   this.screen(g,t('agency.command_short'),t('agency.decisions_results'),width/2,1.1,4.3)
   const rug=this.furniture(g,'rug_rectangle_A',width/2,5.8);if(rug)rug.scale.set(3,1,2)
   this.box(g,4.8,.15,2.4,width/2,.85,5.6,0xa97d51);for(const dx of [-1.7,0,1.7]){this.furniture(g,'chair_B',width/2+dx,7.8,1,Math.PI);this.furniture(g,'chair_B',width/2+dx,3.6)}
  }
  const stations=new THREE.Group();g.add(stations)
  g.name=name;this.rooms.set(id,{id,x,width,group:g,stations});g.visible=id===this.roomId
 }
 async init(){
  await this.assets.preload(['characters','furniture'],this.progress);this.engine.world.scene.background=new THREE.Color(0xe7e1d7);this.lights.push(this.engine.world.addAmbientLight(0xfff9ef,1.7),this.engine.world.addDirectionalLight(0xfff4df,1.7,{x:8,y:18,z:14}));this.buildRoom('command',t('agency.command_room'),0,12);this.buildRoom('secretary',t('agency.secretary_office'),12.2,7);NPC.setAssetLoader(this.assets)
  const secretary=this.cast.find(a=>a.id==='mara')||this.cast[0];if(secretary){const r=this.rooms.get('secretary')!;this.desk(r.stations,secretary.name,t('agency.secretary_role'),3.5,3);this.npcs.createNPCs([{id:secretary.id,name:secretary.name,color:0xD4A574,role:'worker',characterKey:secretary.characterKey,label:secretary.name,spawn:{x:r.x+3.5,y:0,z:5.4}}]);this.npcs.get(secretary.id)?.lookAtTarget({x:r.x+5,z:12})}
  this.engine.camera.fov=43;this.fit();this.loaded=true;this.updateCorridor();this.camera(true);if(this.lastWorkspace)this.workspace(this.lastWorkspace)
  this.container.addEventListener('wheel',e=>{if(!e.ctrlKey)return;e.preventDefault();this.zoom=Math.max(.65,Math.min(8,this.zoom*(e.deltaY>0?1.07:.93)))},{passive:false,signal:this.events.signal})
  this.container.addEventListener('pointerdown',e=>{if(e.target!==this.engine.renderer.domElement)return;this.pointer={x:e.clientX,y:e.clientY,target:this.target.clone()};this.container.setPointerCapture(e.pointerId)},{signal:this.events.signal})
  this.container.addEventListener('pointermove',e=>{if(!this.pointer)return;const p=this.pointer;this.target.set(p.target.x-(e.clientX-p.x)*.02*this.zoom,.3,p.target.z-(e.clientY-p.y)*.02*this.zoom)},{signal:this.events.signal})
  this.container.addEventListener('pointerup',e=>{const p=this.pointer;this.pointer=undefined;if(!p||Math.hypot(e.clientX-p.x,e.clientY-p.y)>6)return;const b=this.container.getBoundingClientRect(),ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((e.clientX-b.left)/b.width*2-1,-(e.clientY-b.top)/b.height*2+1),this.engine.camera);const hits=ray.intersectObjects(this.npcs.getAll().filter(n=>n.mesh.visible).map(n=>n.mesh),true);if(hits.length){let o:THREE.Object3D|null=hits[0].object;while(o&&!o.userData.npcId)o=o.parent;if(o?.userData.npcId)this.select(o.userData.npcId)}},{signal:this.events.signal});this.container.addEventListener('pointercancel',()=>{this.pointer=undefined},{signal:this.events.signal})
 }
 projects(projects:Project[]){if(!this.loaded)return;let changed=false;for(const [i,p] of projects.entries()){const existing=this.rooms.get(p.id);if(existing){existing.group.name=p.name;continue}const x=i%2===0?-12*(1+Math.floor(i/2)):21.2+12*Math.floor(i/2);this.buildRoom(p.id,p.name,x,10);changed=true}if(changed)this.updateCorridor()}
 workspace(workspace:Workspace){
  this.lastWorkspace=workspace;if(!this.loaded)return;this.projects(workspace.projects)
  if(this.secretaryName!==workspace.secretary.name){this.secretaryName=workspace.secretary.name;const secretary=this.npcs.get('mara'),r=this.rooms.get('secretary')!;if(secretary){secretary.name=workspace.secretary.name;secretary.setLabel(workspace.secretary.name)}this.clearOwned(r.stations);this.desk(r.stations,workspace.secretary.name,t('agency.secretary_role'),3.5,3)}
  const signature=JSON.stringify(workspace.workers.map(w=>[w.id,w.projectId,w.name,w.role,w.characterKey]));if(signature!==this.workerSignature){this.workerSignature=signature
   for(const n of this.npcs.getAll())if(n.id!=='mara'){this.npcs.remove(n.id);this.activities.delete(n.id)}
   for(const r of this.rooms.values())if(r.id!=='command'&&r.id!=='secretary')this.clearOwned(r.stations)
   for(const p of workspace.projects){const r=this.rooms.get(p.id);if(!r)continue;const workers=workspace.workers.filter(w=>w.projectId===p.id);workers.forEach((w,i)=>{const cols=Math.min(3,Math.max(1,workers.length)),x=r.width/(cols+1)*(i%cols+1),z=2.1+Math.floor(i/cols)*3.3,name=w.name||t('agency.naming');this.desk(r.stations,name,w.role,x,z);this.npcs.createNPCs([{id:w.id,name,color:0xD4A574,role:'worker',characterKey:w.characterKey||'char-male-d',label:name,spawn:{x:r.x+x,y:0,z:z+1.65}}]);this.npcs.get(w.id)?.lookAtTarget({x:r.x+x,z})})}
  }
  for(const w of workspace.workers)this.workerActivity(w)
 }
 private workerActivity(w:Worker){this.activity(w.id,w.status==='working'?'working':w.status==='queued'?'thinking':'idle')}
 private updateCorridor(){const rooms=[...this.rooms.values()],min=Math.min(...rooms.map(r=>r.x)),max=Math.max(...rooms.map(r=>r.x+r.width));if(this.corridor){this.engine.world.scene.remove(this.corridor);this.corridor.geometry.dispose();(this.corridor.material as THREE.Material).dispose()}this.corridor=this.box(this.engine.world.scene,max-min,.16,2.8,(min+max)/2,-.12,11.5,0x625c52);this.corridor.visible=this.roomId==='all'}
 private camera(now=false){const k=now||matchMedia('(prefers-reduced-motion: reduce)').matches?1:.12;this.current.lerp(this.target,k);this.currentZoom+=(this.zoom-this.currentZoom)*k;const p=this.current,z=this.currentZoom*Math.max(1,this.container.clientHeight/Math.max(1,this.container.clientWidth)*.82);this.engine.camera.position.set(p.x+z*3,p.y+z*12,p.z+z*13);this.engine.camera.lookAt(p)}
 viewRoom(id:string){const r=this.rooms.get(id);if(!r)return;this.roomId=id;for(const room of this.rooms.values())room.group.visible=room.id===id;if(this.corridor)this.corridor.visible=false;this.target.set(r.x+r.width/2,.3,5);this.zoom=id==='secretary'?.9:1.05;this.camera(true)}
 overview(){this.roomId='all';for(const r of this.rooms.values())r.group.visible=true;if(this.corridor)this.corridor.visible=true;const rooms=[...this.rooms.values()],min=Math.min(...rooms.map(r=>r.x)),max=Math.max(...rooms.map(r=>r.x+r.width));this.target.set((min+max)/2,.3,6);this.zoom=Math.min(8,Math.max(1,(max-min)/15))}
 focus(id:string){this.selected=id;for(const n of this.npcs.getAll())n.setGlow(n.id===id?'gold':'none')}
 activity(id:string,kind:'thinking'|'working'|'talking'|'idle'){const n=this.npcs.get(id);if(!n)return;if(this.activities.get(id)!==kind){this.activities.set(id,kind);n.transitionTo('idle');if(kind==='working')n.transitionTo('working');if(kind==='thinking')n.transitionTo('thinking')}n.setGlow(id===this.selected?'gold':'none')}
 update(dt:number){this.camera();this.npcs.update(Math.min(dt,.1),this.engine.camera,this.engine.renderer);for(const n of this.npcs.getAll()){if(n.labelElement)n.labelElement.style.display='none';const room=n.id==='mara'?'secretary':this.lastWorkspace?.workers.find(w=>w.id===n.id)?.projectId;n.mesh.visible=this.roomId==='all'||room===this.roomId}}
 destroy(){this.events.abort();this.resize.disconnect();this.npcs.destroy();for(const r of this.rooms.values()){this.clearOwned(r.group);this.engine.world.scene.remove(r.group)}if(this.corridor){this.corridor.geometry.dispose();(this.corridor.material as THREE.Material).dispose();this.engine.world.scene.remove(this.corridor)}for(const light of this.lights){this.engine.world.scene.remove(light);if(light instanceof THREE.DirectionalLight)light.shadow.dispose()}}
}
