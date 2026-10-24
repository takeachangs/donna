// Adapted from Agentshire; MIT. See licenses/Agentshire-MIT.txt and docs/UPSTREAM.md.
import * as THREE from 'three'
import { NPC } from './NPC'
type NPCConfig = ConstructorParameters<typeof NPC>[0]

export class NPCManager {
  private npcs: Map<string, NPC> = new Map()
  private scene: THREE.Scene
  private labelContainer: HTMLElement

  constructor(scene: THREE.Scene, labelContainer: HTMLElement) {
    this.scene = scene
    this.labelContainer = labelContainer
  }

  createNPCs(configs: NPCConfig[]): void {
    for (const cfg of configs) {
      const existing = this.npcs.get(cfg.id)
      if (existing) {
        existing.destroy()
        this.npcs.delete(cfg.id)
      }
      const npc = new NPC(cfg)
      this.scene.add(npc.mesh)
      npc.createLabel(this.labelContainer)
      this.npcs.set(cfg.id, npc)
    }
  }

  get(id: string): NPC | undefined { return this.npcs.get(id) }
  getAll(): NPC[] { return Array.from(this.npcs.values()) }
  getWorkers(): NPC[] { return this.getAll().filter(n => n.role === 'worker') }

  remove(id: string): void {
    const npc = this.npcs.get(id)
    if (!npc) return
    npc.destroy()
    this.npcs.delete(id)
  }

  update(dt: number, camera: THREE.Camera, renderer: THREE.WebGLRenderer, activeScene?: THREE.Scene): void {
    for (const npc of this.npcs.values()) {
      npc.isInActiveScene = !activeScene || npc.mesh.parent === activeScene
      npc.mesh.userData.isInActiveScene = npc.isInActiveScene
      npc.update(dt)
      npc.updateLabel(camera, renderer)
    }
  }

  findNearestNPC(worldPos: THREE.Vector3, maxDist = 3): NPC | null {
    let best: NPC | null = null
    let bestDist = maxDist
    for (const npc of this.npcs.values()) {
      if (!npc.mesh.visible) continue
      if (!npc.isInActiveScene) continue
      const d = npc.getPosition().distanceTo(worldPos)
      if (d < bestDist) { bestDist = d; best = npc }
    }
    return best
  }

  setScene(scene: THREE.Scene): void {
    for (const npc of this.npcs.values()) {
      if (npc.mesh.parent) npc.mesh.parent.remove(npc.mesh)
      scene.add(npc.mesh)
    }
    this.scene = scene
  }

  moveNpcsToScene(npcIds: string[], scene: THREE.Scene): void {
    for (const id of npcIds) {
      const npc = this.npcs.get(id)
      if (!npc) continue
      if (npc.mesh.parent) npc.mesh.parent.remove(npc.mesh)
      scene.add(npc.mesh)
    }
  }

  setAllVisible(visible: boolean): void {
    for (const npc of this.npcs.values()) npc.setVisible(visible)
  }

  destroy(): void {
    for (const npc of this.npcs.values()) npc.destroy()
    this.npcs.clear()
  }
}
