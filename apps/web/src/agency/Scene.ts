import * as THREE from 'three'
import {Engine,type GameScene} from '../render/Engine'
import {AssetLoader} from '../vendor/agentshire/AssetLoader'
import {NPC} from '../vendor/agentshire/NPC'
import {NPCManager} from '../vendor/agentshire/NPCManager'
import {t} from '../i18n'
import {projectRoom,secretaryRoom,secretaryPosition,deliveryRoute,type Footprint,type Point} from './floor'
import type {Colleague,Project,Worker,Workspace,Briefing} from './types'

type Room=Footprint&{id:string;group:THREE.Group;stations:THREE.Group;label:THREE.Group}
type Trip={points:Point[];index:number;returning:boolean;wait:number;moving:boolean;hold?:boolean}
export class AgencyScene implements GameScene {
 private assets=new AssetLoader();private npcs:NPCManager;private rooms=new Map<string,Room>();private selected='mara';private loaded=false;private resize:ResizeObserver
 private pointer?:{x:number;y:number;target:THREE.Vector3};private target=new THREE.Vector3(0,.3,4);private current=this.target.clone();private zoom=2.5;private currentZoom=2.5
 private autoFrame=true
 private hall=new THREE.Group();private workerSignature='';private secretaryName='';private lastWorkspace?:Workspace;private activities=new Map<string,string>();private roomId='all';private lights:THREE.Light[]=[];private events=new AbortController()
 private homes=new Map<string,Point>();private trips=new Map<string,Trip>();private seen?:Set<string>;private handoffs:Briefing[]=[]
 constructor(private engine:Engine,private container:HTMLElement,private cast:Colleague[],private select:(id:string)=>void,private progress:(n:number,total:number)=>void,private selectRoom:(id:string)=>void,private handoffStatus:(name:string|null)=>void=()=>{}){this.npcs=new NPCManager(engine.world.scene,container);this.resize=new ResizeObserver(()=>this.fit());this.resize.observe(container)}
 private fit(){const w=this.container.clientWidth,h=this.container.clientHeight;this.engine.renderer.setSize(w,h);this.engine.camera.aspect=w/Math.max(1,h);this.engine.camera.updateProjectionMatrix();if(this.loaded&&this.roomId==='all'&&this.autoFrame)this.frameFloor()}
 private box(parent:THREE.Object3D,w:number,h:number,d:number,x:number,y:number,z:number,color:number){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),new THREE.MeshStandardMaterial({color,roughness:.85}));m.userData.agencyOwned=true;m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m}
 private clearOwned(group:THREE.Object3D){group.traverse(o=>{const m=o as THREE.Mesh;if(!m.userData.agencyOwned)return;m.geometry?.dispose();for(const material of (Array.isArray(m.material)?m.material:[m.material])){(material as THREE.MeshBasicMaterial).map?.dispose();material.dispose()}});group.clear()}
 private furniture(g:THREE.Group,key:string,x:number,z:number,scale=1,rotation=0){const m=this.assets.getFurnitureModel(key);if(m){m.position.set(x,0,z);m.scale.setScalar(scale);m.rotation.y=rotation;g.add(m)}return m}
 private screen(g:THREE.Group,name:string,role:string,x:number,z:number,width=1.15){
  this.box(g,.12,.4,.1,x,1.5,z,0x3d3934);this.box(g,width,.72,.09,x,1.9,z,0x37332e)
  const c=document.createElement('canvas');c.width=512;c.height=256;const ctx=c.getContext('2d')!;ctx.fillStyle='#25231f';ctx.fillRect(0,0,512,256);ctx.fillStyle='#D4A574';ctx.font='bold 50px system-ui';ctx.fillText(name.slice(0,20),28,98,450);ctx.fillStyle='#E7DDCC';ctx.font='34px system-ui';ctx.fillText(role.slice(0,27),28,174,450)
  const m=new THREE.Mesh(new THREE.PlaneGeometry(width-.12,.59),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(c)}));m.userData.agencyOwned=true;m.position.set(x,1.9,z+.06);g.add(m)
 }
 private plaque(g:THREE.Group,text:string,x:number,z:number,width=7){
  const c=document.createElement('canvas');c.width=1024;c.height=128;const ctx=c.getContext('2d')!;ctx.fillStyle='#eee7da';ctx.fillRect(0,0,1024,128);ctx.fillStyle='#494137';ctx.font='600 54px system-ui';ctx.textAlign='center';ctx.fillText(text,512,85,960)
  const m=new THREE.Mesh(new THREE.PlaneGeometry(width,.85),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(c)}));m.userData.agencyOwned=true;m.rotation.x=-Math.PI/2;m.position.set(x,.025,z);g.add(m)
 }
 private desk(g:THREE.Group,name:string,role:string,x:number,z:number){this.furniture(g,'table_medium',x,z,1.05);this.furniture(g,'chair_B',x,z+1.7,1,Math.PI);this.screen(g,name,role,x,z)}
 private buildRoom(id:string,name:string,p:Footprint){
  const {width:w,depth:d,side}=p,g=new THREE.Group();g.position.set(p.x,0,p.z);g.userData.roomId=id;g.name=name;this.engine.world.scene.add(g)
  this.box(g,w,.18,d,w/2,-.1,d/2,side==='secretary'?0x789b91:0xbca88b)
  for(let z=.65;z<d;z+=.7)this.box(g,w,.012,.013,w/2,.001,z,side==='secretary'?0x68897f:0xae997c)
  for(const x of [0,w]){const door=(side==='left'&&x===w)||(side==='right'&&x===0);if(door){for(const z of [1.85,8.15])this.box(g,.18,1.4,3.7,x,.7,z,0xd8cfbf)}else this.box(g,.18,1.4,d,x,.7,d/2,0xd8cfbf)}
  if(side==='secretary'){for(const x of [1.4,w-1.4])this.box(g,2.8,1.4,.18,x,.7,0,0xd8cfbf)}else this.box(g,w,1.8,.18,w/2,.9,0,0xe2dbcd)
  this.box(g,w,.32,.18,w/2,.16,d,0xd8cfbf)
  this.furniture(g,'shelf_B_small_decorated',.7,1.1,1.15);this.furniture(g,'cactus_medium_A',w-.7,1,1.4);this.furniture(g,'lamp_standing',w-.7,d-1.4,1.1)
  const stations=new THREE.Group(),label=new THREE.Group();g.add(stations,label);this.plaque(label,name,w/2,d-.65,Math.min(w-1,8))
  this.rooms.set(id,{id,...p,group:g,stations,label});g.visible=this.roomId==='all'||this.roomId===id
 }
 async init(){
  await this.assets.preload(['characters','furniture'],this.progress);this.engine.world.scene.background=new THREE.Color(0xe7e1d7);this.lights.push(this.engine.world.addAmbientLight(0xfff9ef,1.7),this.engine.world.addDirectionalLight(0xfff4df,1.7,{x:8,y:18,z:14}));this.engine.world.scene.add(this.hall);this.buildRoom('secretary',t('agency.secretary_office'),secretaryRoom);NPC.setAssetLoader(this.assets)
  const secretary=this.cast.find(a=>a.id==='mara')||this.cast[0];if(secretary){this.npcs.createNPCs([{id:secretary.id,name:secretary.name,color:0xD4A574,role:'worker',characterKey:secretary.characterKey,label:secretary.name,spawn:{...secretaryPosition,y:0}}]);this.npcs.get(secretary.id)?.lookAtTarget({x:1.5,z:17.5})}
  this.engine.camera.fov=43;this.loaded=true;this.fit();this.updateHall();if(this.lastWorkspace)this.workspace(this.lastWorkspace);this.overview();this.camera(true)
  this.engine.renderer.domElement.setAttribute('role','img');this.engine.renderer.domElement.setAttribute('aria-label',t('agency.scene_controls'))
  this.container.addEventListener('wheel',e=>{e.preventDefault();const pixels=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?this.container.clientHeight:1);this.zoomBy(Math.exp(Math.max(-400,Math.min(400,pixels))*.002),{x:e.clientX,y:e.clientY})},{passive:false,signal:this.events.signal})
  this.container.addEventListener('pointerdown',e=>{if(e.target!==this.engine.renderer.domElement)return;this.pointer={x:e.clientX,y:e.clientY,target:this.target.clone()};this.container.setPointerCapture(e.pointerId)},{signal:this.events.signal})
  this.container.addEventListener('pointermove',e=>{if(!this.pointer)return;const p=this.pointer;if(Math.hypot(e.clientX-p.x,e.clientY-p.y)<3)return;this.autoFrame=false;this.target.set(p.target.x-(e.clientX-p.x)*.02*this.zoom,.3,p.target.z-(e.clientY-p.y)*.02*this.zoom)},{signal:this.events.signal})
  this.container.addEventListener('pointerup',e=>{const p=this.pointer;this.pointer=undefined;if(!p||Math.hypot(e.clientX-p.x,e.clientY-p.y)>6)return;const b=this.container.getBoundingClientRect(),ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((e.clientX-b.left)/b.width*2-1,-(e.clientY-b.top)/b.height*2+1),this.engine.camera);const hits=ray.intersectObjects([...this.npcs.getAll().filter(n=>n.mesh.visible).map(n=>n.mesh),...Array.from(this.rooms.values()).filter(r=>r.group.visible).map(r=>r.group)],true);if(hits.length){let o:THREE.Object3D|null=hits[0].object;while(o&&!o.userData.npcId&&!o.userData.roomId)o=o.parent;if(o?.userData.npcId)this.select(o.userData.npcId);else if(o?.userData.roomId)this.selectRoom(o.userData.roomId)}},{signal:this.events.signal});this.container.addEventListener('pointercancel',()=>{this.pointer=undefined},{signal:this.events.signal})
 }
 projects(projects:Project[]){
  if(!this.loaded)return;let changed=false
  for(const [id,room] of this.rooms)if(id!=='secretary'&&!projects.some(p=>p.id===id&&!p.deletedAt)){this.clearOwned(room.group);this.engine.world.scene.remove(room.group);this.rooms.delete(id);changed=true}
  for(const [i,p] of projects.entries()){
   if(p.deletedAt)continue
   const existing=this.rooms.get(p.id),count=this.lastWorkspace?.workers.filter(w=>w.projectId===p.id).length||0,footprint=projectRoom(i,count)
   if(existing&&existing.width===footprint.width&&existing.x===footprint.x&&existing.z===footprint.z){if(existing.group.name!==p.name){existing.group.name=p.name;this.clearOwned(existing.label);this.plaque(existing.label,p.name,existing.width/2,9.35)}continue}
   if(existing){this.clearOwned(existing.group);this.engine.world.scene.remove(existing.group)}this.buildRoom(p.id,p.name,footprint);changed=true
  }
  if(changed){this.workerSignature='';this.updateHall();if(this.roomId==='all'&&this.autoFrame)this.frameFloor()}
 }
 workspace(workspace:Workspace){
  this.lastWorkspace=workspace;if(!this.loaded)return;this.projects(workspace.projects)
  if(this.secretaryName!==workspace.secretary.name){this.secretaryName=workspace.secretary.name;const secretary=this.npcs.get('mara'),r=this.rooms.get('secretary')!;if(secretary){secretary.name=workspace.secretary.name;secretary.setLabel(workspace.secretary.name)}this.clearOwned(r.stations);this.desk(r.stations,workspace.secretary.name,t('agency.briefing_queue'),2.4,4);this.furniture(r.stations,'chair_B',5.5,5.5,1,-Math.PI/2);this.box(r.stations,.12,.55,.12,2.25,.28,.4,0x6d5138);this.box(r.stations,.34,.12,.2,2.25,.6,.4,0x2f2a25)}
  const activeProjects=workspace.projects.filter(p=>!p.deletedAt),activeWorkers=workspace.workers.filter(w=>activeProjects.some(p=>p.id===w.projectId)),signature=JSON.stringify([activeProjects.map(p=>[p.id,p.name]),activeWorkers.map(w=>[w.id,w.projectId,w.name,w.role,w.characterKey])]);if(signature!==this.workerSignature){this.workerSignature=signature
   for(const n of this.npcs.getAll())if(n.id!=='mara'){this.npcs.remove(n.id);this.activities.delete(n.id)}for(const k of [...this.trips.keys()])if(k!=='mara')this.trips.delete(k);this.handoffStatus(null);this.homes.clear()
   for(const r of this.rooms.values())if(r.id!=='secretary')this.clearOwned(r.stations)
   for(const p of activeProjects){const r=this.rooms.get(p.id);if(!r)continue;const workers=activeWorkers.filter(w=>w.projectId===p.id);if(!workers.length)this.desk(r.stations,p.name,t('agency.empty_desk'),r.width/2,3);workers.forEach((w,i)=>{const cols=Math.max(1,Math.ceil(workers.length/2)),x=r.width/(cols+1)*(i%cols+1),z=2.1+Math.floor(i/cols)*3.3,name=w.name||t('agency.naming'),home={x:r.x+x,z:r.z+z+1.65};this.desk(r.stations,name,w.role,x,z);this.homes.set(w.id,home);this.npcs.createNPCs([{id:w.id,name,color:0xD4A574,role:'worker',characterKey:w.characterKey||'char-male-d',label:name,spawn:{...home,y:0}}]);this.npcs.get(w.id)?.lookAtTarget({x:home.x,z:home.z-1.65})})}
  }
  for(const w of workspace.workers)if(!this.trips.has(w.id))this.workerActivity(w)
  const briefings=workspace.briefings||[];if(!this.seen)this.seen=new Set(briefings.map(b=>b.id));else for(const b of briefings)if(!this.seen.has(b.id)){this.seen.add(b.id);if(b.status==='queued')this.handoffs.push(b)}
 }
 ring(on:boolean){const trip=this.trips.get('mara');if(on){if(trip){if(!trip.returning)trip.hold=true;return}if(!this.npcs.get('mara')||matchMedia('(prefers-reduced-motion: reduce)').matches)return;this.trips.set('mara',{points:[{x:-.3,z:17.65},{x:-.3,z:13.1},{x:-1.05,z:13.05}],index:0,returning:false,wait:0,moving:false,hold:true})}else if(trip){trip.hold=false;if(trip.wait===Infinity)trip.wait=0}}
 replayHandoff(id:string){const b=this.lastWorkspace?.briefings.find(b=>b.id===id);if(b&&!this.trips.has(b.workerId)&&!this.handoffs.some(x=>x.id===id))this.handoffs.push(b)}
 private workerActivity(w:Worker){this.activity(w.id,w.status==='working'?'working':w.status==='queued'?'thinking':'idle')}
 private updateHall(){this.clearOwned(this.hall);const rooms=[...this.rooms.values()],minZ=Math.min(0,...rooms.map(r=>r.z));this.box(this.hall,8,.14,12-minZ,0,-.12,(12+minZ)/2,0xd2c7b5);this.plaque(this.hall,'CHAMBER',0,10.5,5.5);for(let z=minZ+1;z<10;z+=3)this.box(this.hall,.045,.01,1.2,0,.01,z,0xb7a78d)}
 private frameFloor(){const rooms=[...this.rooms.values()],minX=Math.min(...rooms.map(r=>r.x)),maxX=Math.max(...rooms.map(r=>r.x+r.width)),minZ=Math.min(...rooms.map(r=>r.z)),maxZ=Math.max(...rooms.map(r=>r.z+r.depth));this.target.set((minX+maxX)/2,.3,(minZ+maxZ)/2+(maxZ-minZ)*.06);const aspect=this.container.clientWidth/Math.max(1,this.container.clientHeight);this.zoom=Math.max(1.3,(maxX-minX+3)/(16*aspect),(maxZ-minZ+3)/18)}
 zoomBy(factor:number,pointer?:{x:number;y:number}){
  const next=Math.max(.4,Math.min(40,this.zoom*factor));if(next===this.zoom)return;this.autoFrame=false
  if(pointer){const b=this.container.getBoundingClientRect(),ray=new THREE.Raycaster(),hit=new THREE.Vector3();ray.setFromCamera(new THREE.Vector2((pointer.x-b.left)/b.width*2-1,-(pointer.y-b.top)/b.height*2+1),this.engine.camera);if(ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,1,0),-.3),hit))this.target.addScaledVector(hit.sub(this.current),(this.zoom-next)/this.currentZoom)}
  this.zoom=next
 }
 private camera(now=false,dt=1/60){const k=now||matchMedia('(prefers-reduced-motion: reduce)').matches?1:1-Math.exp(-22*Math.max(0,dt));this.current.lerp(this.target,k);this.currentZoom+=(this.zoom-this.currentZoom)*k;const p=this.current,z=this.currentZoom;this.engine.camera.position.set(p.x+z*2,p.y+z*16,p.z+z*14);this.engine.camera.lookAt(p)}
 viewRoom(id:string){if(id==='command'||id==='all'){this.overview();return}const r=this.rooms.get(id);if(!r)return;this.roomId=id;for(const room of this.rooms.values())room.group.visible=room.id===id;this.hall.visible=false;this.target.set(r.x+r.width/2,.3,r.z+r.depth/2);this.zoom=Math.max(1,r.width/(16*this.engine.camera.aspect));this.camera(true)}
 overview(){this.autoFrame=true;this.roomId='all';for(const r of this.rooms.values())r.group.visible=true;this.hall.visible=true;this.frameFloor()}
 focus(id:string){this.selected=id;for(const n of this.npcs.getAll())n.setGlow(n.id===id?'gold':'none')}
 activity(id:string,kind:'thinking'|'working'|'talking'|'idle'){const n=this.npcs.get(id);if(!n||this.trips.has(id))return;if(this.activities.get(id)!==kind){this.activities.set(id,kind);n.transitionTo('idle');if(kind==='working')n.transitionTo('working');if(kind==='thinking')n.transitionTo('thinking')}n.setGlow(id===this.selected?'gold':'none')}
 update(dt:number){
  this.camera(false,dt);this.npcs.update(Math.min(dt,.1),this.engine.camera,this.engine.renderer)
  if(![...this.trips.keys()].some(k=>k!=='mara')&&this.handoffs.length){const b=this.handoffs.shift()!,w=this.lastWorkspace?.workers.find(w=>w.id===b.workerId),r=w&&this.rooms.get(w.projectId),home=this.homes.get(b.workerId);if(r&&home&&!matchMedia('(prefers-reduced-motion: reduce)').matches&&w?.status!=='working'){this.trips.set(b.workerId,{points:deliveryRoute(r,home),index:0,returning:false,wait:0,moving:false});this.handoffStatus(w?.name||'Worker')}}
  for(const [id,trip] of this.trips){const n=this.npcs.get(id),home=id==='mara'?secretaryPosition:this.homes.get(id);if(!n||!home){this.trips.delete(id);continue}if(trip.moving)continue;if(trip.wait>0){trip.wait-=dt;continue}if(trip.index>=trip.points.length){if(!trip.returning){trip.returning=true;trip.wait=trip.hold?Infinity:.8;trip.points=[...trip.points].reverse().slice(1).concat(home);trip.index=0;n.lookAtTarget(id==='mara'?{x:-1.75,z:12.4}:secretaryPosition);continue}this.trips.delete(id);this.activities.delete(id);if(id==='mara'){n.lookAtTarget({x:1.5,z:17.5});n.transitionTo('idle');continue}n.lookAtTarget({x:home.x,z:home.z-1.65});const w=this.lastWorkspace?.workers.find(w=>w.id===id);if(w)this.workerActivity(w);this.handoffStatus(null);continue}trip.moving=true;void n.moveTo(trip.points[trip.index],13).then(status=>{if(this.trips.get(id)!==trip)return;if(status==='arrived'){trip.index++;trip.moving=false}else{this.trips.delete(id);if(id!=='mara')this.handoffStatus(null)}})}
  for(const n of this.npcs.getAll()){if(n.labelElement)n.labelElement.style.display='none';const room=n.id==='mara'?'secretary':this.lastWorkspace?.workers.find(w=>w.id===n.id)?.projectId;n.mesh.visible=this.roomId==='all'||(!this.trips.has(n.id)&&room===this.roomId)||(this.roomId==='secretary'&&n.mesh.position.z>=12)}
 }
 destroy(){this.events.abort();this.resize.disconnect();this.trips.clear();this.npcs.destroy();for(const r of this.rooms.values()){this.clearOwned(r.group);this.engine.world.scene.remove(r.group)}this.clearOwned(this.hall);this.engine.world.scene.remove(this.hall);for(const light of this.lights){this.engine.world.scene.remove(light);if(light instanceof THREE.DirectionalLight)light.shadow.dispose()}}
}
