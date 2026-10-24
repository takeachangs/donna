// Adapted from Agentshire; MIT. See licenses/Agentshire-MIT.txt and docs/UPSTREAM.md.
import * as THREE from 'three'
import { AssetLoader } from './AssetLoader'
import { StatusIndicator } from './StatusIndicator'


const GLOW_COLORS: Record<string, number> = {
  gold: 0xffd700,
  cyan: 0x3b82f6,
  yellow: 0xffcc00,
  green: 0x44ff44,
  red: 0xff4444,
  gray: 0x888888,
}

const _labelWorldPos = new THREE.Vector3()
const _labelNDC = new THREE.Vector3()

export type NpcState =
  | 'idle'
  | 'walking'
  | 'working'
  | 'thinking'
  | 'celebrating'
  | 'emoting'
  | 'departing'
  | 'resting'

const STATE_TRANSITIONS: Record<NpcState, Set<NpcState>> = {
  idle:        new Set(['walking', 'working', 'thinking', 'celebrating', 'emoting', 'departing', 'resting']),
  walking:     new Set(['idle', 'working']),
  working:     new Set(['idle', 'thinking', 'celebrating', 'departing']),
  thinking:    new Set(['idle', 'working', 'celebrating']),
  celebrating: new Set(['idle', 'departing']),
  emoting:     new Set(['idle']),
  departing:   new Set(['idle']),
  resting:     new Set(['idle']),
}

export class NPC {
  public id: string
  public name: string
  public color: number
  public role: string
  public mesh: THREE.Group
  public state: string = 'idle'
  public npcState: NpcState = 'idle'
  public label: string
  public labelElement: HTMLDivElement | null = null

  private static assetLoader: AssetLoader | null = null

  private targetPos: THREE.Vector3 | null = null
  private speed: number = 3
  private moveResolve: ((status: 'arrived' | 'interrupted') => void) | null = null

  private bobPhase: number = 0
  private isMoving: boolean = false

  private bodyMesh: THREE.Mesh | null = null
  private headMesh: THREE.Mesh | null = null
  private usingGLTF: boolean = false
  private _characterKey: string
  get characterKey(): string { return this._characterKey }
  private modelRoot: THREE.Group

  private mixer: THREE.AnimationMixer | null = null
  get animationMixer(): THREE.AnimationMixer | null { return this.mixer }
  private idleAction: THREE.AnimationAction | null = null
  private walkAction: THREE.AnimationAction | null = null
  private typingAction: THREE.AnimationAction | null = null
  private waveAction: THREE.AnimationAction | null = null
  private cheerAction: THREE.AnimationAction | null = null
  private readingAction: THREE.AnimationAction | null = null
  private frustratedAction: THREE.AnimationAction | null = null
  private dancingAction: THREE.AnimationAction | null = null
  private sitAction: THREE.AnimationAction | null = null
  private sipAction: THREE.AnimationAction | null = null
  private currentAction: THREE.AnimationAction | null = null

  private glowRing: THREE.Mesh | null = null
  private glowColor: string = 'none'
  private glowPhase: number = 0

  private labelYOffset: number = 1.95
  private statusSpan: HTMLSpanElement | null = null
  private labelTextSpan: HTMLSpanElement | null = null
  public indicator: StatusIndicator
  public isInActiveScene = true
  private desiredRotationY: number | null = null
  private smoothTurnSpeed = 10
  private characterTransition:
    | {
      phase: 'fadeOut' | 'fadeIn'
      nextCharacterKey: string
      elapsed: number
      halfDuration: number
      resolve: () => void
      modelOpts?: { modelUrl?: string; modelTransform?: any; animMapping?: any; animFileUrls?: string[] }
    }
    | null = null

  static setAssetLoader(loader: AssetLoader): void {
    NPC.assetLoader = loader
  }

  private _modelUrl?: string
  private _modelTransform?: { scale: number; rotationX: number; rotationY: number; rotationZ: number; offsetX: number; offsetY: number; offsetZ: number }
  private _animMapping?: Partial<Record<string, string>>
  private _animFileUrls?: string[]

  constructor(config: {
    id: string
    name: string
    color: number
    role: string
    label?: string
    spawn: { x: number; y: number; z: number }
    characterKey?: string
    modelUrl?: string
    modelTransform?: { scale: number; rotationX: number; rotationY: number; rotationZ: number; offsetX: number; offsetY: number; offsetZ: number }
    animMapping?: Partial<Record<string, string>>
    animFileUrls?: string[]
  }) {
    this.id = config.id
    this.name = config.name
    this.color = config.color
    this.role = config.role
    this.label = config.label ?? config.name
    this._characterKey = config.characterKey || 'char-male-a'
    this._modelUrl = config.modelUrl
    this._modelTransform = config.modelTransform
    this._animMapping = config.animMapping
    this._animFileUrls = config.animFileUrls

    this.mesh = new THREE.Group()
    this.mesh.position.set(config.spawn.x, config.spawn.y, config.spawn.z)
    this.mesh.userData.npcId = this.id
    this.modelRoot = new THREE.Group()
    this.mesh.add(this.modelRoot)
    this.indicator = new StatusIndicator(this.mesh)

    this.buildModel()
  }

  private buildModel(): void {
    if (!NPC.assetLoader) { this.buildFallbackModel(); return }

    const key = this._characterKey
    if (key.startsWith('lib-') || key.startsWith('custom-')) {
      this.buildFallbackModel()
      this.loadModelAsync()
      return
    }

    const model = NPC.assetLoader.getCharacterModel(key)
    if (!model) { this.buildFallbackModel(); return }

    this.applyModel(model, NPC.assetLoader.getAnimations('characters', key))
  }

  private async loadModelAsync(): Promise<void> {
    if (!NPC.assetLoader) return
    const key = this._characterKey
    let model: THREE.Group | null = null
    let clips: THREE.AnimationClip[] = []

    try {
      if (key.startsWith('lib-') && this._modelUrl) {
        model = await NPC.assetLoader.loadLibraryCharacterByUrl(this._modelUrl)
        if (model) {
          const cacheKey = `characters/lib-url-${this._modelUrl}`
          clips = NPC.assetLoader.getAnimationsForKey(cacheKey)
        }
      } else if (key.startsWith('custom-') && this._modelUrl) {
        model = await NPC.assetLoader.loadCustomCharacter(this._modelUrl, this._animFileUrls)
        if (model) {
          const cacheKey = `characters/custom-${this._modelUrl}`
          clips = NPC.assetLoader.getAnimationsForKey(cacheKey)
        }
      }
    } catch (err) {
      console.warn(`[NPC] Async model load failed for ${this.id} (${key}):`, err)
    }

    if (!model) return
    this.clearModel()
    this.applyModel(model, clips)
    if (this.state === 'walking' && this.walkAction) {
      this.crossFadeTo(this.walkAction)
    } else if (this.idleAction) {
      this.crossFadeTo(this.idleAction)
    }
  }

  private applyModel(model: THREE.Group, clips: THREE.AnimationClip[]): void {
    const t = this._modelTransform
    const s = t?.scale ?? 2.8
    model.scale.set(s, s, s)

    model.updateMatrixWorld(true)
    const modelTop = new THREE.Box3().setFromObject(model).max.y

    this.modelRoot.add(model)
    this.usingGLTF = true
    this.labelYOffset = modelTop

    if (t) {
      const deg = Math.PI / 180
      this.modelRoot.rotation.set(t.rotationX * deg, t.rotationY * deg, t.rotationZ * deg)
      this.modelRoot.position.set(t.offsetX, t.offsetY, t.offsetZ)
    }

    if (clips.length > 0) {
      this.mixer = new THREE.AnimationMixer(model)
      this.bindAnimations(clips)
      if (this.idleAction) {
        this.idleAction.play()
        this.currentAction = this.idleAction
      } else if (clips.length > 0) {
        const fallbackAction = this.mixer.clipAction(clips[0])
        fallbackAction.play()
        this.currentAction = fallbackAction
      }
      this.mixer.addEventListener('finished', this.onAnimFinished)
    }

    this.createGlowRing()

    const offsetY = t?.offsetY ?? 0
    this.indicator.setHeight(modelTop + offsetY + 0.15)
  }

  private bindAnimations(clips: THREE.AnimationClip[]): void {
    if (!this.mixer) return
    const mapping = this._animMapping
    if (mapping && Object.keys(mapping).length > 0) {
      const clipMap = new Map(clips.map(c => [c.name, c]))
      const bind = (slot: string) => {
        const clipName = mapping[slot]
        if (!clipName) return null
        const clip = clipMap.get(clipName)
        return clip ? this.mixer!.clipAction(clip) : null
      }
      this.idleAction = bind('idle')
      this.walkAction = bind('walk')
      this.typingAction = bind('typing')
      this.waveAction = bind('wave')
      this.cheerAction = bind('cheer')
      this.readingAction = bind('reading')
      this.frustratedAction = bind('frustrated')
      this.dancingAction = bind('dancing')
      this.sitAction = bind('sit')
      this.sipAction = bind('sip')
    } else {
      const animMap: Record<string, THREE.AnimationClip> = {}
      for (const clip of clips) animMap[clip.name.toLowerCase()] = clip

      const find = (...names: string[]) => {
        for (const n of names) { if (animMap[n]) return animMap[n] }
        for (const n of names) {
          for (const [k, c] of Object.entries(animMap)) { if (k.includes(n)) return c }
        }
        return null
      }

      const idleClip = find('idle')
      const walkClip = find('walk')
      const typingClip = find('interact-right', 'interact-left', 'interact', 'typing')
      const waveClip = find('emote-yes', 'wave', 'pick-up')
      const cheerClip = find('jump', 'cheer')
      const readingClip = find('interact', 'interact-left')
      const frustratedClip = find('emote-no')
      const dancingClip = find('dance')
      const sitClip = find('sit')
      const sipClip = find('holding-right')

      if (idleClip) this.idleAction = this.mixer.clipAction(idleClip)
      if (walkClip) this.walkAction = this.mixer.clipAction(walkClip)
      if (typingClip) this.typingAction = this.mixer.clipAction(typingClip)
      if (waveClip) this.waveAction = this.mixer.clipAction(waveClip)
      if (cheerClip) this.cheerAction = this.mixer.clipAction(cheerClip)
      if (readingClip) this.readingAction = this.mixer.clipAction(readingClip)
      if (frustratedClip) this.frustratedAction = this.mixer.clipAction(frustratedClip)
      if (dancingClip) this.dancingAction = this.mixer.clipAction(dancingClip)
      if (sitClip) this.sitAction = this.mixer.clipAction(sitClip)
      if (sipClip) this.sipAction = this.mixer.clipAction(sipClip)
    }
  }

  private buildFallbackModel(): void {
    this.usingGLTF = false
    this.labelYOffset = 1.95

    const bodyGeo = new THREE.CapsuleGeometry(0.3, 0.8, 8, 16)
    const bodyMat = new THREE.MeshStandardMaterial({
      color: this.color,
      roughness: 0.6,
      metalness: 0.1,
    })
    this.bodyMesh = new THREE.Mesh(bodyGeo, bodyMat)
    this.bodyMesh.position.y = 0.7
    this.bodyMesh.castShadow = true
    this.modelRoot.add(this.bodyMesh)

    const headColor = new THREE.Color(this.color)
    headColor.lerp(new THREE.Color(0xffffff), 0.25)

    const headGeo = new THREE.SphereGeometry(0.3, 16, 16)
    const headMat = new THREE.MeshStandardMaterial({
      color: headColor,
      roughness: 0.5,
      metalness: 0.1,
    })
    this.headMesh = new THREE.Mesh(headGeo, headMat)
    this.headMesh.position.y = 1.4
    this.headMesh.castShadow = true
    this.modelRoot.add(this.headMesh)

    if (this.role === 'user') {
      const starGeo = new THREE.ConeGeometry(0.12, 0.25, 5)
      const starMat = new THREE.MeshStandardMaterial({
        color: 0xffd700,
        emissive: 0xffd700,
        emissiveIntensity: 0.4,
        roughness: 0.3,
        metalness: 0.6,
      })
      const star = new THREE.Mesh(starGeo, starMat)
      star.position.y = 1.85
      this.modelRoot.add(star)
    }

    this.createGlowRing()
  }

  private crossFadeTo(newAction: THREE.AnimationAction): void {
    if (this.currentAction === newAction) return
    newAction.reset()
    newAction.setEffectiveTimeScale(1)
    newAction.setEffectiveWeight(1)
    newAction.play()
    if (this.currentAction) {
      const clip = this.currentAction.getClip()
      if (this.currentAction.clampWhenFinished && clip.duration > 0 && this.currentAction.time >= clip.duration - 0.01) {
        this.currentAction.stop()
      } else {
        this.currentAction.crossFadeTo(newAction, 0.25, false)
      }
    }
    this.currentAction = newAction
  }

  // ── NPC State Machine ──

  private onAnimFinished = (_e: { action: THREE.AnimationAction }): void => {
    if (this.npcState === 'celebrating' || this.npcState === 'emoting') {
      this.transitionTo('idle')
    }
  }

  transitionTo(newState: NpcState, opts?: { anim?: string }): boolean {
    if (this.npcState === newState) return true
    if (!STATE_TRANSITIONS[this.npcState]?.has(newState)) {
      if (newState === 'idle') {
        this.npcState = 'idle'
        this.state = 'idle'
        this.playAnimInternal('idle')
        return true
      }
      console.warn(`[NPC:${this.id}] Invalid transition: ${this.npcState} → ${newState}`)
      return false
    }
    this.npcState = newState
    this.onEnterState(newState, opts)
    return true
  }

  private onEnterState(state: NpcState, opts?: { anim?: string }): void {
    switch (state) {
      case 'idle':
        this.state = 'idle'
        this.playAnimInternal('idle')
        break
      case 'walking':
        this.state = 'walking'
        this.playAnimInternal('walk')
        break
      case 'working':
        this.state = opts?.anim === 'reading' ? 'reading' : 'typing'
        this.playAnimInternal(opts?.anim === 'reading' ? 'reading' : 'typing')
        break
      case 'thinking':
        this.state = 'thinking'
        this.playAnimInternal('thinking')
        break
      case 'celebrating':
        this.state = 'cheer'
        this.playAnimInternal('cheer')
        break
      case 'emoting':
        this.state = opts?.anim ?? 'wave'
        this.playAnimInternal(opts?.anim ?? 'wave')
        break
      case 'departing':
        this.state = 'walking'
        this.playAnimInternal('walk')
        break
      case 'resting':
        this.state = opts?.anim === 'sip' ? 'sip' : 'sit'
        this.playAnimInternal(this.state)
        break
    }
  }

  private playAnimInternal(name: string): void {
    const map: Record<string, THREE.AnimationAction | null> = {
      idle: this.idleAction,
      walk: this.walkAction,
      typing: this.typingAction,
      wave: this.waveAction,
      cheer: this.cheerAction,
      reading: this.readingAction ?? this.typingAction,
      frustrated: this.frustratedAction ?? this.idleAction,
      dancing: this.dancingAction ?? this.cheerAction,
      thinking: this.idleAction,
      sit: this.sitAction ?? this.idleAction,
      sip: this.sipAction ?? this.idleAction,
    }
    const action = map[name] ?? map['idle']
    if (!action) return

    const onceAnims = new Set(['wave', 'cheer', 'frustrated', 'dancing'])
    const isOnceAnim = onceAnims.has(name)
    const isFallbackToShared = isOnceAnim && (
      (name === 'frustrated' && action === this.idleAction) ||
      (name === 'dancing' && action === this.cheerAction)
    )

    if (isOnceAnim && !isFallbackToShared) {
      action.setLoop(THREE.LoopOnce, 1)
      action.clampWhenFinished = true
    } else {
      action.setLoop(THREE.LoopRepeat, Infinity)
      action.clampWhenFinished = false
    }

    if (name === 'thinking') {
      action.setEffectiveTimeScale(0.5)
    } else {
      action.setEffectiveTimeScale(1)
    }

    this.crossFadeTo(action)
  }

  private createGlowRing(): void {
    if (this.glowRing) return
    const ringGeo = new THREE.TorusGeometry(0.4, 0.05, 8, 32)
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
    })
    this.glowRing = new THREE.Mesh(ringGeo, ringMat)
    this.glowRing.rotation.x = -Math.PI / 2
    this.glowRing.position.y = 0.02
    this.glowRing.visible = false
    this.mesh.add(this.glowRing)
  }

  createLabel(container: HTMLElement): void {
    const el = document.createElement('div')
    el.className = 'npc-label'
    Object.assign(el.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      willChange: 'transform',
      color: '#ffffff',
      fontSize: '13px',
      fontWeight: '600',
      fontFamily: 'sans-serif',
      textShadow: '0 0 4px rgba(0,0,0,0.8), 0 1px 2px rgba(0,0,0,0.6)',
      pointerEvents: 'none',
      whiteSpace: 'nowrap',
      userSelect: 'none',
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
    })

    const textSpan = document.createElement('span')
    textSpan.textContent = this.label
    el.appendChild(textSpan)
    this.labelTextSpan = textSpan

    container.appendChild(el)
    this.labelElement = el
  }

  setLabel(newLabel: string): void {
    this.label = newLabel
    this.name = newLabel
    if (this.labelTextSpan) this.labelTextSpan.textContent = newLabel
  }

  setCharacterKey(newCharacterKey: string, opts?: { modelUrl?: string; modelTransform?: any; animMapping?: any; animFileUrls?: string[] }): void {
    if (!newCharacterKey || this._characterKey === newCharacterKey) return
    this._characterKey = newCharacterKey
    if (opts?.modelUrl !== undefined) this._modelUrl = opts.modelUrl
    if (opts?.modelTransform !== undefined) this._modelTransform = opts.modelTransform
    if (opts?.animMapping !== undefined) this._animMapping = opts.animMapping
    if (opts?.animFileUrls !== undefined) this._animFileUrls = opts.animFileUrls
    this.clearModel()
    this.buildModel()

    if (this.state === 'walking' && this.walkAction) {
      this.crossFadeTo(this.walkAction)
    } else if (this.idleAction) {
      this.crossFadeTo(this.idleAction)
    }
  }

  transitionCharacterKey(newCharacterKey: string, totalDurationMs = 1600, opts?: { modelUrl?: string; modelTransform?: any; animMapping?: any; animFileUrls?: string[] }): Promise<void> {
    if (!newCharacterKey || this._characterKey === newCharacterKey) return Promise.resolve()
    if (this.characterTransition) {
      this.characterTransition.resolve()
      this.characterTransition = null
    }
    const halfDuration = Math.max(0.15, totalDurationMs / 2000)
    this.ensureModelMaterialsFadeReady()
    return new Promise<void>((resolve) => {
      this.characterTransition = {
        phase: 'fadeOut',
        nextCharacterKey: newCharacterKey,
        elapsed: 0,
        halfDuration,
        resolve,
        modelOpts: opts,
      }
    })
  }

  private resolveMove(status: 'arrived' | 'interrupted'): void {
    if (!this.moveResolve) return
    const resolve = this.moveResolve
    this.moveResolve = null
    resolve(status)
  }

  private finishMove(status: 'arrived' | 'interrupted'): void {
    this.isMoving = false
    this.targetPos = null
    this.desiredRotationY = null
    this.transitionTo('idle')
    this.resolveMove(status)
  }

  stopMoving(): void {
    if (this.isMoving) {
      this.finishMove('interrupted')
    }
  }

  moveTo(target: { x: number; z: number }, speed?: number): Promise<'arrived' | 'interrupted'> {
    return new Promise<'arrived' | 'interrupted'>((resolve) => {
      if (this.moveResolve) {
        this.finishMove('interrupted')
      }
      this.isMoving = true
      this.moveResolve = resolve
      this.speed = speed ?? 3
      this.targetPos = new THREE.Vector3(target.x, 0, target.z)

      if (this.npcState !== 'idle' && this.npcState !== 'walking') {
        this.transitionTo('idle')
      }
      this.transitionTo('walking')
    })
  }

  async walkPath(
    waypoints: { x: number; z: number }[],
    speed?: number
  ): Promise<void> {
    for (const wp of waypoints) {
      const status = await this.moveTo(wp, speed)
      if (status !== 'arrived') return
    }
  }

  setGlow(color: string): void {
    this.glowColor = color
    if (!this.glowRing) return

    if (color === 'none' || !GLOW_COLORS[color]) {
      this.glowRing.visible = false
      ;(this.glowRing.material as THREE.MeshBasicMaterial).opacity = 0
      return
    }

    ;(this.glowRing.material as THREE.MeshBasicMaterial).color.setHex(
      GLOW_COLORS[color]
    )
    this.glowRing.visible = true
    this.glowPhase = 0
  }

  setVisible(visible: boolean): void {
    this.mesh.visible = visible
    if (this.labelElement) {
      this.labelElement.style.display = visible ? '' : 'none'
    }
  }

  update(deltaTime: number): void {
    if (this.mixer) {
      this.mixer.update(deltaTime)
    }
    this.indicator.update(deltaTime)
    this.updateCharacterTransition(deltaTime)

    if (!this.usingGLTF && this.bodyMesh && this.headMesh) {
      this.bobPhase += deltaTime * (this.isMoving ? 8 : 2)
      const bobAmplitude = this.isMoving ? 0.08 : 0.03
      const bobOffset = Math.sin(this.bobPhase) * bobAmplitude
      this.bodyMesh.position.y = 0.7 + bobOffset
      this.headMesh.position.y = 1.4 + bobOffset
    }

    if (this.targetPos && this.isMoving) {
      const current = this.mesh.position
      const dx = this.targetPos.x - current.x
      const dz = this.targetPos.z - current.z
      const dist = Math.sqrt(dx * dx + dz * dz)

      if (dist < 0.15) {
        current.set(this.targetPos.x, 0, this.targetPos.z)
        this.finishMove('arrived')
      } else {
        const step = Math.min(this.speed * deltaTime, dist)
        const nx = dx / dist
        const nz = dz / dist
        current.x += nx * step
        current.z += nz * step

        this.desiredRotationY = Math.atan2(nx, nz)
      }
    }

    if (this.desiredRotationY !== null) {
      let current = this.mesh.rotation.y
      let delta = this.desiredRotationY - current
      if (delta > Math.PI) delta -= Math.PI * 2
      if (delta < -Math.PI) delta += Math.PI * 2
      if (Math.abs(delta) < 0.02) {
        this.mesh.rotation.y = this.desiredRotationY
        if (!this.isMoving) this.desiredRotationY = null
      } else {
        this.mesh.rotation.y = current + delta * Math.min(1, this.smoothTurnSpeed * deltaTime)
      }
    }

    if (this.glowRing && this.glowRing.visible) {
      this.glowPhase += deltaTime * 3
      const opacity = 0.35 + 0.3 * Math.sin(this.glowPhase)
      ;(this.glowRing.material as THREE.MeshBasicMaterial).opacity = opacity
    }
  }

  private updateCharacterTransition(deltaTime: number): void {
    if (!this.characterTransition) return

    this.characterTransition.elapsed += deltaTime
    const t = Math.min(this.characterTransition.elapsed / this.characterTransition.halfDuration, 1)

    if (this.characterTransition.phase === 'fadeOut') {
      this.setModelOpacity(1 - t)
      if (t >= 1) {
        const nextKey = this.characterTransition.nextCharacterKey
        const previousCharacterKey = this._characterKey
        this._characterKey = nextKey
        const mOpts = this.characterTransition.modelOpts
        if (mOpts?.modelUrl !== undefined) this._modelUrl = mOpts.modelUrl
        if (mOpts?.modelTransform !== undefined) this._modelTransform = mOpts.modelTransform
        if (mOpts?.animMapping !== undefined) this._animMapping = mOpts.animMapping
        if (mOpts?.animFileUrls !== undefined) this._animFileUrls = mOpts.animFileUrls
        this.clearModel()
        this.buildModel()
        this.ensureModelMaterialsFadeReady()
        this.setModelOpacity(0)
        console.log(`[NPC][PersonaTransition] npc=${this.id} swapped model ${previousCharacterKey} -> ${nextKey}`)
        if (this.state === 'walking' && this.walkAction) {
          this.crossFadeTo(this.walkAction)
        } else if (this.idleAction) {
          this.crossFadeTo(this.idleAction)
        }
        this.characterTransition.phase = 'fadeIn'
        this.characterTransition.elapsed = 0
      }
      return
    }

    this.setModelOpacity(t)
    if (t >= 1) {
      this.setModelOpacity(1)
      const done = this.characterTransition.resolve
      this.characterTransition = null
      done()
    }
  }

  private ensureModelMaterialsFadeReady(): void {
    this.modelRoot.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return
      if (Array.isArray(child.material)) {
        child.material = child.material.map((m) => {
          const cloned = m.clone()
          cloned.transparent = true
          cloned.opacity = 1
          ;(cloned as any).userData = { ...((cloned as any).userData ?? {}), npcOwnedMaterial: true }
          return cloned
        })
      } else {
        child.material = child.material.clone()
        child.material.transparent = true
        child.material.opacity = 1
        ;(child.material as any).userData = { ...((child.material as any).userData ?? {}), npcOwnedMaterial: true }
      }
    })
  }

  private setModelOpacity(opacity: number): void {
    const clamped = Math.max(0, Math.min(1, opacity))
    this.modelRoot.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return
      if (Array.isArray(child.material)) {
        for (const m of child.material) {
          m.transparent = true
          m.opacity = clamped
        }
      } else {
        child.material.transparent = true
        child.material.opacity = clamped
      }
    })
  }

  async fadeOut(duration = 500): Promise<void> {
    if (this.labelElement) this.labelElement.style.display = 'none'
    const start = Date.now()
    return new Promise<void>((resolve) => {
      const tick = () => {
        const t = Math.min(1, (Date.now() - start) / duration)
        const v = 1 - t
        this.mesh.scale.setScalar(Math.max(0.01, v))
        this.setModelOpacity(v)
        if (t < 1) requestAnimationFrame(tick)
        else resolve()
      }
      tick()
    })
  }

  restoreVisual(): void {
    this.mesh.scale.setScalar(1)
    this.setModelOpacity(1)
  }

  updateLabel(camera: THREE.Camera, renderer: THREE.WebGLRenderer): void {
    if (!this.labelElement) return

    if (!this.isInActiveScene || !this.mesh.visible) {
      this.labelElement.style.display = 'none'
      return
    }

    this.mesh.getWorldPosition(_labelWorldPos)
    _labelWorldPos.y += this.labelYOffset

    _labelNDC.copy(_labelWorldPos).project(camera)

    if (_labelNDC.z > 1 || _labelNDC.x < -1 || _labelNDC.x > 1 || _labelNDC.y < -1 || _labelNDC.y > 1) {
      this.labelElement.style.display = 'none'
      return
    }

    const el = renderer.domElement
    const screenX = (_labelNDC.x * 0.5 + 0.5) * el.clientWidth
    const screenY = (-_labelNDC.y * 0.5 + 0.5) * el.clientHeight

    this.labelElement.style.display = ''
    this.labelElement.style.transform = `translate3d(${screenX}px, ${screenY}px, 0) translate(-50%, -100%)`
  }

  getPosition(): THREE.Vector3 {
    return this.mesh.position.clone()
  }

  lookAtTarget(target: { x: number; z: number }): void {
    const dx = target.x - this.mesh.position.x
    const dz = target.z - this.mesh.position.z
    if (dx !== 0 || dz !== 0) {
      this.mesh.rotation.y = Math.atan2(dx, dz)
    }
  }

  smoothLookAt(target: { x: number; z: number }): void {
    const dx = target.x - this.mesh.position.x
    const dz = target.z - this.mesh.position.z
    if (dx !== 0 || dz !== 0) {
      this.desiredRotationY = Math.atan2(dx, dz)
    }
  }

  playAnim(name: string): void {
    const stateMap: Record<string, NpcState> = {
      idle: 'idle', walk: 'walking', typing: 'working',
      thinking: 'thinking', cheer: 'celebrating',
      wave: 'emoting', frustrated: 'emoting', dancing: 'emoting',
      reading: 'working',
    }
    const targetState = stateMap[name] ?? 'idle'
    if (!this.transitionTo(targetState, { anim: name })) {
      this.transitionTo('idle')
      this.transitionTo(targetState, { anim: name })
    }
  }

  private static STATUS_SVGS: Record<string, string> = {}
  private static svgsLoaded = false

  private static loadStatusSvgs(): void {
    if (NPC.svgsLoaded) return
    NPC.svgsLoaded = true
    const svgFiles = import.meta.glob('../assets/status-*.svg', { as: 'raw', eager: true }) as Record<string, string>
    for (const [path, content] of Object.entries(svgFiles)) {
      const name = path.match(/status-(\w+)\.svg$/)?.[1]
      if (name) NPC.STATUS_SVGS[name] = content
    }
  }

  private currentStatusKey: string | null = null

  setStatusEmoji(emoji: string | null): void {
    if (!this.labelElement) return
    if (emoji === this.currentStatusKey) return
    this.currentStatusKey = emoji
    NPC.loadStatusSvgs()

    if (this.statusSpan) {
      this.statusSpan.remove()
      this.statusSpan = null
    }

    if (!emoji) return

    const svgMap: Record<string, string> = {
      'working': 'working',
      'success': 'success',
      'error': 'error',
      'celebrate': 'celebrate',
    }

    const svgKey = svgMap[emoji]
    const svgContent = svgKey ? NPC.STATUS_SVGS[svgKey] : null

    const span = document.createElement('span')
    span.className = 'npc-si'
    Object.assign(span.style, {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '18px',
      height: '18px',
    })

    if (svgContent) {
      span.innerHTML = svgContent.replace(/width="120"/, 'width="18"').replace(/height="120"/, 'height="18"')
    } else {
      span.textContent = emoji
      span.style.fontSize = '14px'
    }

    this.labelElement.appendChild(span)
    this.statusSpan = span
  }

  updateStatusPosition(_camera: THREE.Camera, _renderer: THREE.WebGLRenderer, _inActiveScene?: boolean): void {
    // no-op: status icon is now inline with the label
  }

  private clearModel(): void {
    const disposeOwnedMeshes = !this.usingGLTF

    if (this.mixer) {
      this.mixer.removeEventListener('finished', this.onAnimFinished)
      this.mixer.stopAllAction()
      this.mixer.uncacheRoot(this.modelRoot)
      this.mixer = null
    }
    this.idleAction = null
    this.walkAction = null
    this.typingAction = null
    this.waveAction = null
    this.cheerAction = null
    this.readingAction = null
    this.frustratedAction = null
    this.dancingAction = null
    this.sitAction = null
    this.sipAction = null
    this.currentAction = null
    this.bodyMesh = null
    this.headMesh = null
    this.usingGLTF = false

    // Character GLTF clones may share geometry/material references with the
    // asset cache, so only dispose meshes we know were created locally.
    this.modelRoot.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return
      const maybeDisposeOwnedMaterial = (mat: THREE.Material) => {
        const owned = Boolean((mat as any).userData?.npcOwnedMaterial)
        if (owned) mat.dispose()
      }
      if (Array.isArray(child.material)) child.material.forEach(maybeDisposeOwnedMaterial)
      else maybeDisposeOwnedMaterial(child.material)
    })

    if (disposeOwnedMeshes) {
      this.modelRoot.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose()
          if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose())
          else child.material.dispose()
        }
      })
    }
    this.modelRoot.clear()
  }

  destroy(): void {
    if (this.labelElement && this.labelElement.parentElement) {
      this.labelElement.parentElement.removeChild(this.labelElement)
      this.labelElement = null
    }

    this.clearModel()
    this.indicator.destroy()

    if (this.statusSpan) {
      this.statusSpan.remove()
      this.statusSpan = null
    }

    if (this.glowRing) {
      this.glowRing.geometry.dispose()
      if (Array.isArray(this.glowRing.material)) this.glowRing.material.forEach((m) => m.dispose())
      else this.glowRing.material.dispose()
      this.glowRing = null
    }

    if (this.mesh.parent) {
      this.mesh.parent.remove(this.mesh)
    }

    this.targetPos = null
    if (this.moveResolve) {
      this.resolveMove('interrupted')
    }
    if (this.characterTransition) {
      this.characterTransition.resolve()
      this.characterTransition = null
    }
  }
}
