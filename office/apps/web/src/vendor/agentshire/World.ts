// Adapted from Agentshire; MIT. See licenses/Agentshire-MIT.txt and docs/UPSTREAM.md.
// ────────────────────────────────────────────────────────────
// World — Three.js scene & game object graph
// ────────────────────────────────────────────────────────────

import * as THREE from 'three'

export interface GameObject {
  mesh: THREE.Object3D
  update?(deltaTime: number): void
  destroy?(): void
}

export class World {
  public scene: THREE.Scene
  private objects: Map<string, GameObject> = new Map()
  private nextId = 1

  constructor() {
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x1a1a2e)
  }

  addObject(obj: THREE.Object3D, updateFn?: (dt: number) => void): string {
    const id = `obj_${this.nextId++}`
    this.scene.add(obj)
    this.objects.set(id, { mesh: obj, update: updateFn })
    return id
  }

  removeObject(id: string): void {
    const obj = this.objects.get(id)
    if (obj) {
      this.scene.remove(obj.mesh)
      obj.destroy?.()
      this.objects.delete(id)
    }
  }

  getObject(id: string): GameObject | undefined {
    return this.objects.get(id)
  }

  update(deltaTime: number): void {
    for (const obj of this.objects.values()) {
      obj.update?.(deltaTime)
    }
  }

  clear(): void {
    for (const [id] of this.objects) this.removeObject(id)
    while (this.scene.children.length > 0) this.scene.remove(this.scene.children[0])
  }

  addAmbientLight(color = 0xffffff, intensity = 0.5): THREE.AmbientLight {
    const light = new THREE.AmbientLight(color, intensity)
    this.scene.add(light)
    return light
  }

  addDirectionalLight(color = 0xffffff, intensity = 1, position = { x: 5, y: 10, z: 5 }): THREE.DirectionalLight {
    const light = new THREE.DirectionalLight(color, intensity)
    light.position.set(position.x, position.y, position.z)
    light.castShadow = true
    light.shadow.mapSize.width = 2048
    light.shadow.mapSize.height = 2048
    this.scene.add(light)
    return light
  }
}
