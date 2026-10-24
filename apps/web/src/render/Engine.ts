// Rendering lifecycle adapted from Agentshire (MIT); see licenses/Agentshire-MIT.txt.
// The office owns its camera controls; no town input, editor or post-processing.
import * as THREE from 'three'
import {World} from '../vendor/agentshire/World'

export interface GameScene {
  init(): void | Promise<void>
  update(deltaTime: number): void
  destroy(): void
}

export class Engine {
  readonly renderer: THREE.WebGLRenderer
  readonly camera: THREE.PerspectiveCamera
  readonly world = new World()
  private clock = new THREE.Clock(false)
  private scene?: GameScene
  private frame?: number
  private running = false
  private resize: ResizeObserver
  private events = new AbortController()

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({antialias: true})
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.camera = new THREE.PerspectiveCamera(50, 1, .1, 1000)
    container.appendChild(this.renderer.domElement)
    this.resize = new ResizeObserver(() => this.fit())
    this.resize.observe(container)
    this.fit()
  }

  private fit() {
    const width = Math.max(1, this.container.clientWidth)
    const height = Math.max(1, this.container.clientHeight)
    this.renderer.setSize(width, height)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
  }

  async init() {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.pauseFrames()
      else if (this.running) this.resumeFrames()
    }, {signal: this.events.signal})
  }

  async loadScene(scene: GameScene) {
    this.scene?.destroy()
    this.scene = scene
    await scene.init()
  }

  start() {
    this.running = true
    if (!document.hidden) this.resumeFrames()
  }

  private resumeFrames() {
    if (this.frame !== undefined) return
    this.clock.start()
    this.frame = requestAnimationFrame(this.animate)
  }

  private pauseFrames() {
    if (this.frame !== undefined) cancelAnimationFrame(this.frame)
    this.frame = undefined
    this.clock.stop()
  }

  private animate = () => {
    this.frame = requestAnimationFrame(this.animate)
    const dt = Math.min(this.clock.getDelta(), .1)
    this.world.update(dt)
    this.scene?.update(dt)
    this.renderer.render(this.world.scene, this.camera)
  }

  destroy() {
    this.running = false
    this.pauseFrames()
    this.events.abort()
    this.resize.disconnect()
    this.scene?.destroy()
    this.world.clear()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
