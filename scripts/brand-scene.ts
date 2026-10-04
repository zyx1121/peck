import * as THREE from "three"
import { SVGLoader } from "three/addons/loaders/SVGLoader.js"
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js"

declare global {
  interface Window {
    peckSvg: string
    brandReady: boolean
  }
}

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  preserveDrawingBuffer: true,
})
renderer.setSize(1024, 1024)
renderer.setPixelRatio(1)
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.VSMShadowMap
document.body.append(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color("#cbd6df")
const pmrem = new THREE.PMREMGenerator(renderer)
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
scene.environmentIntensity = 0.85

const camera = new THREE.OrthographicCamera(-1.65, 1.65, 1.65, -1.65, 0.1, 100)
camera.position.set(0, 0.5, 7)
camera.lookAt(0, 0, 0)
const material = new THREE.MeshPhysicalMaterial({
  color: "#28774f",
  metalness: 0.5,
  roughness: 0.2,
  clearcoat: 1,
  clearcoatRoughness: 0.18,
})
const group = new THREE.Group()
for (const path of new SVGLoader().parse(window.peckSvg).paths) {
  for (const shape of SVGLoader.createShapes(path)) {
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: 30,
      bevelEnabled: true,
      bevelThickness: 8,
      bevelSize: 8,
      bevelSegments: 12,
      curveSegments: 48,
      steps: 1,
    })
    geometry.center()
    const mesh = new THREE.Mesh(geometry, material)
    mesh.scale.set(0.0115, -0.0115, 0.0115)
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
  }
}
group.rotation.y = 0.36
scene.add(group)
const bounds = new THREE.Box3().setFromObject(group)
group.position.x -= bounds.getCenter(new THREE.Vector3()).x
const floorY = bounds.min.y - 0.01
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200),
  new THREE.MeshBasicMaterial({ color: "#cbd6df", toneMapped: false })
)
floor.rotation.x = -Math.PI / 2
floor.position.y = floorY
scene.add(floor)
const shadow = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200),
  new THREE.ShadowMaterial({ opacity: 0.24 })
)
shadow.rotation.x = -Math.PI / 2
shadow.position.y = floorY + 0.001
shadow.receiveShadow = true
scene.add(shadow)
scene.add(new THREE.HemisphereLight("#ffffff", "#8794a5", 1.1))
const key = new THREE.DirectionalLight("#fffaf1", 2.2)
key.position.set(4, 6, 5)
key.castShadow = true
key.shadow.mapSize.set(512, 512)
key.shadow.camera.left = -3
key.shadow.camera.right = 3
key.shadow.camera.top = 3
key.shadow.camera.bottom = -3
key.shadow.normalBias = 0.015
key.shadow.radius = 6
key.shadow.blurSamples = 16
scene.add(key)
const composite = document.createElement("canvas")
composite.width = composite.height = 1024
const context = composite.getContext("2d")!
for (let sample = 0; sample < 24; sample++) {
  const angle = sample * 2.399963229728653
  const radius = 2.5 * Math.sqrt((sample + 0.5) / 24)
  key.position.set(4 + Math.cos(angle) * radius, 6 + Math.sin(angle) * radius, 5)
  renderer.render(scene, camera)
  context.globalAlpha = 1 / (sample + 1)
  context.drawImage(renderer.domElement, 0, 0)
}
renderer.domElement.replaceWith(composite)
window.brandReady = true
