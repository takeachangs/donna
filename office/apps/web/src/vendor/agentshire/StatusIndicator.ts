// Adapted from Agentshire; MIT. See licenses/Agentshire-MIT.txt and docs/UPSTREAM.md.
import * as THREE from 'three'

type IndicatorState = 'idle' | 'thinking' | 'working' | 'waiting' | 'done' | 'error'

export class StatusIndicator {
  private group: THREE.Group
  private state: IndicatorState = 'idle'
  private elapsed = 0
  private currentMeshes: THREE.Object3D[] = []
  private parent: THREE.Object3D

  constructor(parent: THREE.Object3D) {
    this.parent = parent
    this.group = new THREE.Group()
    this.group.position.y = 2.0
    parent.add(this.group)
  }

  setState(state: IndicatorState): void {
    if (this.state === state) return
    this.state = state
    this.elapsed = 0
    this.clearMeshes()

    switch (state) {
      case 'thinking': this.buildThinking(); break
      case 'working': this.buildWorking(); break
      case 'waiting': this.buildWaiting(); break
      case 'done': this.buildDone(); break
      case 'error': this.buildError(); break
      case 'idle': break
    }
  }

  getState(): IndicatorState { return this.state }

  setHeight(y: number): void {
    this.group.position.y = y
  }

  private clearMeshes(): void {
    for (const m of this.currentMeshes) {
      this.group.remove(m)
      m.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose()
          if (Array.isArray(child.material)) child.material.forEach(mt => mt.dispose())
          else child.material.dispose()
        }
        if (child instanceof THREE.Line) {
          child.geometry.dispose()
          ;(child.material as THREE.Material).dispose()
        }
      })
    }
    this.currentMeshes = []
  }

  private buildThinking(): void {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.2, 0.025, 6, 16),
      new THREE.MeshBasicMaterial({ color: 0xffcc44, transparent: true, opacity: 0.6 }),
    )
    ring.rotation.x = -Math.PI / 2

    const dotGeo = new THREE.SphereGeometry(0.04, 6, 6)
    const dotMat = new THREE.MeshBasicMaterial({ color: 0xffdd66, transparent: true, opacity: 0.8 })
    const dots = new THREE.Group()
    for (let i = 0; i < 3; i++) {
      const dot = new THREE.Mesh(dotGeo, dotMat.clone())
      const angle = (i / 3) * Math.PI * 2
      dot.position.set(Math.cos(angle) * 0.12, 0.25, Math.sin(angle) * 0.12)
      dots.add(dot)
    }

    this.group.add(ring)
    this.group.add(dots)
    this.currentMeshes.push(ring, dots)
  }

  private buildWorking(): void {
    const ORBIT_R = 0.16
    const DOT_COUNT = 5
    const dotGeo = new THREE.SphereGeometry(0.035, 8, 8)

    const orbitGroup = new THREE.Group()
    for (let i = 0; i < DOT_COUNT; i++) {
      const t = i / DOT_COUNT
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color().setHSL(0.62, 0.92, 0.5 + t * 0.2),
        transparent: true,
        opacity: 0.3 + t * 0.7,
      })
      const dot = new THREE.Mesh(dotGeo, mat)
      dot.scale.setScalar(0.5 + t * 0.5)
      orbitGroup.add(dot)
    }

    const coreGeo = new THREE.SphereGeometry(0.06, 10, 10)
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0x3b82f6, transparent: true, opacity: 0.85,
    })
    const core = new THREE.Mesh(coreGeo, coreMat)
    core.position.y = 0.05

    const ringGeo = new THREE.TorusGeometry(ORBIT_R, 0.008, 6, 32)
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x3b82f6, transparent: true, opacity: 0.15,
    })
    const ring = new THREE.Mesh(ringGeo, ringMat)
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.05

    this.group.add(ring)
    this.group.add(core)
    this.group.add(orbitGroup)
    this.currentMeshes.push(ring, core, orbitGroup)
  }

  private buildWaiting(): void {
    const topGeo = new THREE.ConeGeometry(0.1, 0.15, 6)
    const botGeo = new THREE.ConeGeometry(0.1, 0.15, 6)
    const mat = new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.7 })

    const top = new THREE.Mesh(topGeo, mat)
    top.position.y = 0.12
    const bot = new THREE.Mesh(botGeo, mat.clone())
    bot.position.y = -0.05
    bot.rotation.x = Math.PI

    const g = new THREE.Group()
    g.add(top, bot)
    this.group.add(g)
    this.currentMeshes.push(g)
  }

  private buildDone(): void {
    const points = [
      new THREE.Vector3(-0.1, 0, 0),
      new THREE.Vector3(-0.03, -0.08, 0),
      new THREE.Vector3(0.12, 0.1, 0),
    ]
    const geo = new THREE.BufferGeometry().setFromPoints(points)
    const mat = new THREE.LineBasicMaterial({ color: 0x44ff44, linewidth: 2 })
    const check = new THREE.Line(geo, mat)

    const ringGeo = new THREE.TorusGeometry(0.18, 0.015, 6, 24)
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x44ff44, transparent: true, opacity: 0.5 })
    const ring = new THREE.Mesh(ringGeo, ringMat)
    ring.rotation.x = -Math.PI / 2

    this.group.add(check)
    this.group.add(ring)
    this.currentMeshes.push(check, ring)
  }

  private buildError(): void {
    const p1 = [new THREE.Vector3(-0.08, 0.08, 0), new THREE.Vector3(0.08, -0.08, 0)]
    const p2 = [new THREE.Vector3(0.08, 0.08, 0), new THREE.Vector3(-0.08, -0.08, 0)]
    const mat = new THREE.LineBasicMaterial({ color: 0xff4444, linewidth: 2 })
    const l1 = new THREE.Line(new THREE.BufferGeometry().setFromPoints(p1), mat)
    const l2 = new THREE.Line(new THREE.BufferGeometry().setFromPoints(p2), mat.clone())

    const ringGeo = new THREE.TorusGeometry(0.15, 0.015, 6, 24)
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xff4444, transparent: true, opacity: 0.5 })
    const ring = new THREE.Mesh(ringGeo, ringMat)
    ring.rotation.x = -Math.PI / 2

    this.group.add(l1, l2, ring)
    this.currentMeshes.push(l1, l2, ring)
  }

  update(dt: number): void {
    if (this.state === 'idle') return
    this.elapsed += dt

    switch (this.state) {
      case 'thinking': {
        const ring = this.currentMeshes[0]
        if (ring) ring.rotation.z = this.elapsed * 1.5
        const dots = this.currentMeshes[1]
        if (dots) {
          dots.children.forEach((dot, i) => {
            dot.position.y = 0.25 + Math.sin(this.elapsed * 3 + i * 1.2) * 0.06
            ;(dot as THREE.Mesh).material && ((dot as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity !== undefined &&
              (((dot as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.5 + 0.4 * Math.sin(this.elapsed * 4 + i))
          })
        }
        break
      }
      case 'working': {
        const ORBIT_R = 0.16
        const DOT_COUNT = 5
        const SPEED = 3.5
        const TAIL_SPREAD = 0.6

        const core = this.currentMeshes[1] as THREE.Mesh | undefined
        if (core) {
          const pulse = 0.85 + 0.15 * Math.sin(this.elapsed * 4)
          ;(core.material as THREE.MeshBasicMaterial).opacity = pulse
          const s = 1 + 0.08 * Math.sin(this.elapsed * 4)
          core.scale.setScalar(s)
        }

        const orbitGroup = this.currentMeshes[2] as THREE.Group | undefined
        if (orbitGroup) {
          const headAngle = this.elapsed * SPEED
          for (let i = 0; i < DOT_COUNT; i++) {
            const dot = orbitGroup.children[i]
            if (!dot) continue
            const lag = (i / DOT_COUNT) * TAIL_SPREAD
            const angle = headAngle - lag * Math.PI * 2
            dot.position.set(
              Math.cos(angle) * ORBIT_R,
              0.05 + Math.sin(this.elapsed * 2.5 + i * 0.8) * 0.03,
              Math.sin(angle) * ORBIT_R,
            )
          }
        }
        break
      }
      case 'waiting': {
        const g = this.currentMeshes[0]
        if (g) g.rotation.z = this.elapsed * 2
        break
      }
      case 'done': {
        const ring = this.currentMeshes[1] as THREE.Mesh | undefined
        if (ring && this.elapsed < 1) {
          const s = 1 + this.elapsed * 2
          ring.scale.set(s, s, 1)
          ;(ring.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.5 - this.elapsed * 0.4)
        }
        break
      }
      case 'error': {
        const offset = Math.sin(this.elapsed * 20) * 0.03
        this.group.position.x = offset
        if (this.elapsed > 0.5) this.group.position.x = 0
        break
      }
    }
  }

  destroy(): void {
    this.clearMeshes()
    if (this.group.parent) this.group.parent.remove(this.group)
  }
}
