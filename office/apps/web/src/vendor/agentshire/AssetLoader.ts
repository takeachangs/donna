// Adapted from Agentshire; MIT. See licenses/Agentshire-MIT.txt and docs/UPSTREAM.md.
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js'

export interface AssetManifest {
  characters: Record<string, string>
  buildings: Record<string, string>
  furniture: Record<string, string>
  props: Record<string, string>
}

const BASE = import.meta.env.BASE_URL + 'assets/models'
const LIBRARY_BASE = import.meta.env.BASE_URL + 'assets/Characters_1/gLTF'

const MANIFEST: AssetManifest = {
  characters: {
    'char-male-a': `${BASE}/characters/character-male-a.glb`,
    'char-male-b': `${BASE}/characters/character-male-b.glb`,
    'char-male-d': `${BASE}/characters/character-male-d.glb`,
    'char-female-b': `${BASE}/characters/character-female-b.glb`,
    'char-female-d': `${BASE}/characters/character-female-d.glb`,
    'char-female-e': `${BASE}/characters/character-female-e.glb`,
  },
  furniture: {
    'table_medium': `${BASE}/furniture/table_medium.gltf`,
    'chair_B': `${BASE}/furniture/chair_B.gltf`,
    'shelf_B_small_decorated': `${BASE}/furniture/shelf_B_small_decorated.gltf`,
    'cactus_medium_A': `${BASE}/furniture/cactus_medium_A.gltf`,
    'lamp_standing': `${BASE}/furniture/lamp_standing.gltf`,
    'rug_rectangle_A': `${BASE}/furniture/rug_rectangle_A.gltf`,
  },
  buildings: {},
  props: {},
}

type CategoryKey = keyof AssetManifest

export class AssetLoader {
  private loader = new GLTFLoader()
  private cache = new Map<string, THREE.Group>()
  private skinned = new Set<string>()
  private animations = new Map<string, THREE.AnimationClip[]>()
  private loaded = false
  private sharedLibraryAnims: THREE.AnimationClip[] | null = null
  private loadingPromises = new Map<string, Promise<void>>()

  async preload(
    categories: CategoryKey[] = ['characters', 'buildings', 'furniture', 'props'],
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<void> {
    const entries: [string, string][] = []
    for (const cat of categories) {
      for (const [key, url] of Object.entries(MANIFEST[cat])) {
        entries.push([`${cat}/${key}`, url])
      }
    }

    let done = 0
    const total = entries.length

    const loadOne = async ([key, url]: [string, string]) => {
      try {
        const gltf = await this.loader.loadAsync(url)
        const model = gltf.scene
        let hasSkin = false
        model.traverse(child => {
          if ((child as THREE.Mesh).isMesh) {
            const m = child as THREE.Mesh
            m.castShadow = true
            m.receiveShadow = true
          }
          if ((child as THREE.SkinnedMesh).isSkinnedMesh) {
            hasSkin = true
          }
        })
        this.cache.set(key, model)
        if (hasSkin) this.skinned.add(key)
        if (gltf.animations.length > 0) {
          this.animations.set(key, gltf.animations)
        }
      } catch {
        console.warn(`[AssetLoader] Failed to load: ${key} (${url})`)
      }
      done++
      onProgress?.(done, total)
    }

    const batchSize = 6
    for (let i = 0; i < entries.length; i += batchSize) {
      await Promise.all(entries.slice(i, i + batchSize).map(loadOne))
    }

    this.loaded = true
  }

  getModel(category: CategoryKey, key: string): THREE.Group | null {
    const cacheKey = `${category}/${key}`
    const cached = this.cache.get(cacheKey)
    if (!cached) return null
    if (this.skinned.has(cacheKey)) {
      return SkeletonUtils.clone(cached) as THREE.Group
    }
    return cached.clone()
  }

  getAnimations(category: CategoryKey, key: string): THREE.AnimationClip[] {
    return this.animations.get(`${category}/${key}`) ?? []
  }

  isLoaded(): boolean {
    return this.loaded
  }

  getCharacterModel(charKey: string): THREE.Group | null {
    return this.getModel('characters', charKey)
  }

  getBuildingModel(key: string): THREE.Group | null {
    return this.getModel('buildings', key)
  }

  getFurnitureModel(key: string): THREE.Group | null {
    return this.getModel('furniture', key)
  }

  getPropModel(key: string): THREE.Group | null {
    return this.getModel('props', key)
  }

  private async loadSharedLibraryAnimations(): Promise<THREE.AnimationClip[]> {
    if (this.sharedLibraryAnims) return this.sharedLibraryAnims
    const url = '/ext-assets/Characters_1/gLTF/Animations/Animations.glb'
    try {
      const gltf = await this.loader.loadAsync(url)
      this.sharedLibraryAnims = gltf.animations
      return gltf.animations
    } catch {
      console.warn('[AssetLoader] Failed to load shared library animations')
      return []
    }
  }

  private async loadGltfToCache(cacheKey: string, url: string, animClips?: THREE.AnimationClip[]): Promise<void> {
    if (this.cache.has(cacheKey)) return
    try {
      const gltf = await this.loader.loadAsync(url)
      const model = gltf.scene
      let hasSkin = false
      model.traverse(child => {
        if ((child as THREE.Mesh).isMesh) {
          const m = child as THREE.Mesh
          m.castShadow = true
          m.receiveShadow = true
        }
        if ((child as THREE.SkinnedMesh).isSkinnedMesh) hasSkin = true
      })
      this.cache.set(cacheKey, model)
      if (hasSkin) this.skinned.add(cacheKey)

      const clips = gltf.animations.length > 0 ? gltf.animations : (animClips ?? [])
      if (clips.length > 0) this.animations.set(cacheKey, clips)
    } catch {
      console.warn(`[AssetLoader] Failed to load: ${cacheKey} (${url})`)
    }
  }

  async loadLibraryCharacter(meshFileName: string): Promise<THREE.Group | null> {
    const cacheKey = `characters/${meshFileName}`
    if (!this.cache.has(cacheKey)) {
      if (!this.loadingPromises.has(cacheKey)) {
        const promise = (async () => {
          const sharedAnims = await this.loadSharedLibraryAnimations()
          const meshUrl = `${LIBRARY_BASE}/Characters/${meshFileName}.glb`
          await this.loadGltfToCache(cacheKey, meshUrl, sharedAnims)
        })()
        this.loadingPromises.set(cacheKey, promise)
      }
      await this.loadingPromises.get(cacheKey)
    }
    return this.getModelFromCache(cacheKey)
  }

  async loadLibraryCharacterByUrl(modelUrl: string): Promise<THREE.Group | null> {
    const cacheKey = `characters/lib-url-${modelUrl}`
    if (!this.cache.has(cacheKey)) {
      if (!this.loadingPromises.has(cacheKey)) {
        const promise = (async () => {
          const sharedAnims = await this.loadSharedLibraryAnimations()
          await this.loadGltfToCache(cacheKey, modelUrl, sharedAnims)
        })()
        this.loadingPromises.set(cacheKey, promise)
      }
      await this.loadingPromises.get(cacheKey)
    }
    return this.getModelFromCache(cacheKey)
  }

  async loadCustomCharacter(meshUrl: string, animFileUrls?: string[]): Promise<THREE.Group | null> {
    const cacheKey = `characters/custom-${meshUrl}`
    if (!this.cache.has(cacheKey)) {
      if (!this.loadingPromises.has(cacheKey)) {
        const promise = (async () => {
          const allClips: THREE.AnimationClip[] = []
          if (animFileUrls?.length) {
            for (const url of animFileUrls) {
              try {
                const animGltf = await this.loader.loadAsync(url)
                allClips.push(...animGltf.animations)
              } catch {
                console.warn(`[AssetLoader] Failed to load custom animation: ${url}`)
              }
            }
          }
          await this.loadGltfToCache(cacheKey, meshUrl, allClips.length > 0 ? allClips : undefined)
          this.fixCustomMaterials(cacheKey)
        })()
        this.loadingPromises.set(cacheKey, promise)
      }
      await this.loadingPromises.get(cacheKey)
    }
    return this.getModelFromCache(cacheKey)
  }

  private fixCustomMaterials(cacheKey: string): void {
    const model = this.cache.get(cacheKey)
    if (!model) return
    model.traverse(child => {
      if (!(child as THREE.Mesh).isMesh) return
      const mats = Array.isArray((child as THREE.Mesh).material)
        ? (child as THREE.Mesh).material as THREE.MeshStandardMaterial[]
        : [(child as THREE.Mesh).material as THREE.MeshStandardMaterial]
      for (const mat of mats) {
        if (mat.transparent) {
          mat.transparent = false
          mat.alphaTest = 0.5
          mat.opacity = 1
        }
        if (mat.alphaMap) mat.alphaTest = Math.max(mat.alphaTest, 0.5)
        mat.depthWrite = true
        mat.side = THREE.FrontSide
      }
    })
  }

  getAnimationsForKey(cacheKey: string): THREE.AnimationClip[] {
    return this.animations.get(cacheKey) ?? []
  }

  private getModelFromCache(cacheKey: string): THREE.Group | null {
    const cached = this.cache.get(cacheKey)
    if (!cached) return null
    if (this.skinned.has(cacheKey)) {
      return SkeletonUtils.clone(cached) as THREE.Group
    }
    return cached.clone()
  }
}
