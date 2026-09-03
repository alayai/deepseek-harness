import { useEffect, useRef, useState } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import css from './CadPreviewOverlay.module.css'

export type CadPreviewOverlayProps = PropsRuntime<'shell.overlay'>

function mesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: THREE.Vector3Tuple,
  rotation: THREE.EulerTuple = [0, 0, 0],
): THREE.Mesh {
  const part = new THREE.Mesh(geometry, material)
  part.position.set(...position)
  part.rotation.set(...rotation)
  part.castShadow = true
  part.receiveShadow = true
  return part
}

function roundedBox(width: number, height: number, depth: number, material: THREE.Material, position: THREE.Vector3Tuple): THREE.Mesh {
  return mesh(new THREE.BoxGeometry(width, height, depth), material, position)
}

function cylinder(
  radius: number,
  depth: number,
  material: THREE.Material,
  position: THREE.Vector3Tuple,
  segments = 72,
): THREE.Mesh {
  return mesh(new THREE.CylinderGeometry(radius, radius, depth, segments), material, position, [Math.PI / 2, 0, 0])
}

function makeGear(teeth: number, innerRadius: number, outerRadius: number, depth: number, material: THREE.Material): THREE.Mesh {
  const shape = new THREE.Shape()
  const steps = teeth * 2
  for (let i = 0; i <= steps; i += 1) {
    const angle = (i / steps) * Math.PI * 2
    const radius = i % 2 === 0 ? outerRadius : innerRadius
    const x = Math.cos(angle) * radius
    const y = Math.sin(angle) * radius
    if (i === 0) shape.moveTo(x, y)
    else shape.lineTo(x, y)
  }
  shape.closePath()
  shape.holes.push(new THREE.Path().absarc(0, 0, outerRadius * 0.28, 0, Math.PI * 2, false))
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2
    const path = new THREE.Path()
    path.absarc(Math.cos(angle) * outerRadius * 0.58, Math.sin(angle) * outerRadius * 0.58, outerRadius * 0.07, 0, Math.PI * 2, false)
    shape.holes.push(path)
  }
  const geometry = new THREE.ExtrudeGeometry(shape, {
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: 0.025,
    bevelThickness: 0.025,
    depth,
    steps: 1,
  })
  geometry.center()
  const gear = new THREE.Mesh(geometry, material)
  gear.castShadow = true
  gear.receiveShadow = true
  return gear
}

function makeRackTooth(width: number, height: number, depth: number, material: THREE.Material, x: number): THREE.Mesh {
  const shape = new THREE.Shape()
  shape.moveTo(-width / 2, 0)
  shape.lineTo(0, height)
  shape.lineTo(width / 2, 0)
  shape.closePath()
  const geometry = new THREE.ExtrudeGeometry(shape, {
    bevelEnabled: true,
    bevelSegments: 1,
    bevelSize: 0.01,
    bevelThickness: 0.01,
    depth,
    steps: 1,
  })
  geometry.center()
  return mesh(geometry, material, [x, -0.18 + height / 2, 0.02], [0, 0, 0])
}

function makeSidePlate(width: number, height: number, depth: number, material: THREE.Material, position: THREE.Vector3Tuple): THREE.Mesh {
  const shape = new THREE.Shape()
  shape.moveTo(-width / 2, -height / 2)
  shape.lineTo(width / 2, -height / 2)
  shape.lineTo(-width / 2, height / 2)
  shape.closePath()
  const geometry = new THREE.ExtrudeGeometry(shape, {
    bevelEnabled: true,
    bevelSegments: 1,
    bevelSize: 0.012,
    bevelThickness: 0.012,
    depth,
    steps: 1,
  })
  geometry.center()
  return mesh(geometry, material, position)
}

function torus(radius: number, tube: number, material: THREE.Material, position: THREE.Vector3Tuple): THREE.Mesh {
  return mesh(new THREE.TorusGeometry(radius, tube, 18, 96), material, position)
}

function makeLabel(text: string, materialColor: string, position: THREE.Vector3Tuple): THREE.Mesh {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 96
  const context = canvas.getContext('2d')
  if (context !== null) {
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.font = '700 48px Arial, sans-serif'
    context.fillStyle = materialColor
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(text, canvas.width / 2, canvas.height / 2 + 2)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true })
  return mesh(new THREE.PlaneGeometry(1.58, 0.3), material, position)
}

function addBoltCircle(
  group: THREE.Group,
  centerX: number,
  centerY: number,
  radius: number,
  count: number,
  headMaterial: THREE.Material,
  washerMaterial: THREE.Material,
  z: number,
): void {
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2
    const x = centerX + Math.cos(angle) * radius
    const y = centerY + Math.sin(angle) * radius
    group.add(cylinder(0.085, 0.022, washerMaterial, [x, y, z - 0.018], 28))
    group.add(cylinder(0.052, 0.07, headMaterial, [x, y, z + 0.026], 24))
  }
}

function makeActuatorModel(): THREE.Group {
  const group = new THREE.Group()
  const bright = new THREE.MeshStandardMaterial({ color: 0xf1f3f4, metalness: 0.54, roughness: 0.18 })
  const satin = new THREE.MeshStandardMaterial({ color: 0xcfd5d9, metalness: 0.56, roughness: 0.22 })
  const shadowSilver = new THREE.MeshStandardMaterial({ color: 0xadb6bd, metalness: 0.48, roughness: 0.32 })
  const toothMat = new THREE.MeshStandardMaterial({ color: 0xd8dde0, metalness: 0.5, roughness: 0.24 })
  const boltMat = new THREE.MeshStandardMaterial({ color: 0x59636d, metalness: 0.68, roughness: 0.2 })
  const boreMat = new THREE.MeshStandardMaterial({ color: 0x15191d, metalness: 0.62, roughness: 0.3 })

  const rackY = -0.36
  group.add(roundedBox(4.95, 0.34, 0.44, bright, [0, rackY, 0]))
  group.add(roundedBox(5.12, 0.18, 0.48, satin, [0, rackY - 0.22, 0]))
  group.add(roundedBox(0.2, 0.44, 0.46, satin, [-2.58, rackY - 0.03, 0]))
  group.add(roundedBox(0.2, 0.44, 0.46, satin, [2.58, rackY - 0.03, 0]))
  for (let i = 0; i < 26; i += 1) {
    group.add(makeRackTooth(0.17, 0.2, 0.42, toothMat, -2.22 + i * 0.176))
  }
  for (const x of [-1.96, -0.95, 0.95, 1.96]) {
    group.add(cylinder(0.075, 0.026, boreMat, [x, rackY - 0.03, 0.235], 28))
    group.add(torus(0.1, 0.011, satin, [x, rackY - 0.03, 0.255]))
  }
  const label = makeLabel('HERION AUTOMATION', '#006c80', [0, rackY - 0.06, 0.235])
  label.rotation.x = 0
  group.add(label)

  const gearCenter: THREE.Vector3Tuple = [-0.18, 0.82, 0.36]
  group.add(cylinder(0.94, 0.46, shadowSilver, [-0.18, 0.82, 0.16], 96))
  group.add(cylinder(0.82, 0.18, bright, [-0.18, 0.82, 0.47], 96))
  const gear = makeGear(44, 0.72, 0.9, 0.26, bright)
  gear.position.set(...gearCenter)
  gear.rotation.z = 0.08
  gear.name = 'animated-drive-gear'
  group.add(gear)
  group.add(cylinder(0.38, 0.12, bright, [-0.18, 0.82, 0.55], 72))
  group.add(cylinder(0.21, 0.13, boreMat, [-0.18, 0.82, 0.64], 56))
  addBoltCircle(group, -0.18, 0.82, 0.54, 10, boltMat, bright, 0.61)
  group.add(torus(0.47, 0.018, shadowSilver, [-0.18, 0.82, 0.66]))

  group.add(cylinder(1.02, 0.2, bright, [-0.18, 0.82, -0.18], 96))
  group.add(torus(0.89, 0.026, shadowSilver, [-0.18, 0.82, -0.08]))
  group.add(torus(0.78, 0.02, bright, [-0.18, 0.82, -0.32]))
  group.add(cylinder(0.78, 0.56, satin, [-0.18, 0.82, -0.56], 96))
  group.add(cylinder(0.62, 0.42, bright, [-0.18, 0.82, -0.98], 96))

  group.add(roundedBox(1.18, 1.16, 0.72, bright, [-0.18, 0.82, -1.52]))
  group.add(roundedBox(1.32, 1.3, 0.18, satin, [-0.18, 0.82, -1.92]))
  for (const x of [-0.55, 0.55]) {
    for (const y of [0.29, 1.35]) {
      group.add(cylinder(0.06, 0.052, boltMat, [x - 0.18, y, -2.03], 24))
    }
  }

  group.add(makeSidePlate(0.84, 0.95, 0.12, shadowSilver, [-1.34, 0.08, -0.25]))
  group.add(makeSidePlate(0.84, 0.95, 0.12, shadowSilver, [-1.34, 0.08, 0.25]))

  group.rotation.x = -0.03
  group.rotation.y = -0.08
  return group
}

function ThreeViewport(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return undefined

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, canvas })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0xfbfcfd)

    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100)
    camera.position.set(3.45, 1.92, 3.35)

    const controls = new OrbitControls(camera, canvas)
    controls.enableDamping = true
    controls.dampingFactor = 0.06
    controls.minDistance = 2.6
    controls.maxDistance = 8.5
    controls.target.set(0, 0.26, -0.36)

    scene.add(new THREE.HemisphereLight(0xffffff, 0xcdd5dc, 2.5))
    const fill = new THREE.DirectionalLight(0xffffff, 1.4)
    fill.position.set(-2.5, 1.2, 3.5)
    scene.add(fill)
    const key = new THREE.DirectionalLight(0xffffff, 3.8)
    key.position.set(2.4, 3.4, 4.5)
    key.castShadow = true
    key.shadow.mapSize.set(1024, 1024)
    scene.add(key)
    const rim = new THREE.DirectionalLight(0x8fc2ff, 1.2)
    rim.position.set(-4, 1.6, -2.8)
    scene.add(rim)

    const model = makeActuatorModel()
    scene.add(model)

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(7, 4.6),
      new THREE.ShadowMaterial({ color: 0x233041, opacity: 0.08 }),
    )
    floor.rotation.x = -Math.PI / 2
    floor.position.y = -0.88
    floor.receiveShadow = true
    scene.add(floor)

    const resize = () => {
      const parent = canvas.parentElement
      const width = parent?.clientWidth ?? 1
      const height = parent?.clientHeight ?? 1
      renderer.setSize(width, height, false)
      camera.aspect = width / Math.max(height, 1)
      camera.updateProjectionMatrix()
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)

    let frame = 0
    const animate = () => {
      frame = requestAnimationFrame(animate)
      const gear = model.getObjectByName('animated-drive-gear')
      if (gear !== undefined) gear.rotation.z += 0.004
      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      controls.dispose()
      renderer.dispose()
      scene.traverse((object) => {
        const maybeMesh = object as THREE.Mesh
        if (maybeMesh.geometry !== undefined) maybeMesh.geometry.dispose()
        const material = maybeMesh.material
        if (Array.isArray(material)) material.forEach(item => item.dispose())
        else if (material !== undefined) material.dispose()
      })
    }
  }, [])

  return <canvas ref={canvasRef} className={css.canvas} aria-label="rack and pinion actuator 3D preview" />
}

export function CadPreviewOverlay(_props: CadPreviewOverlayProps): JSX.Element {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return undefined
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, [open])

  return (
    <>
      <button type="button" className={css.launcher} onClick={() => { setOpen(true) }} title="打开齿轮齿条执行器 3D 预览">
        <svg className={css.icon} viewBox="0 0 16 16" aria-hidden="true">
          <path fill="currentColor" d="M8 1.1 2.2 4.2v6.7L8 14.2l5.8-3.3V4.2L8 1.1Zm0 1.7 3.6 1.9L8 6.7 4.4 4.7 8 2.8ZM3.6 5.9l3.7 2.1v4.2l-3.7-2.1V5.9Zm5.1 6.3V8l3.7-2.1v4.2l-3.7 2.1Z" />
        </svg>
        3D 预览
      </button>
      {open && (
        <div className={css.backdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false) }}>
          <section className={css.panel} role="dialog" aria-modal="true" aria-label="齿轮齿条执行器 3D 在线预览">
            <header className={css.header}>
              <h2 className={css.title}>齿轮齿条执行器 · 在线 3D 预览</h2>
              <button type="button" className={css.close} onClick={() => { setOpen(false) }} aria-label="关闭 3D 预览">
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                  <path fill="currentColor" d="m8 6.94 3.18-3.19 1.07 1.07L9.06 8l3.19 3.18-1.07 1.07L8 9.06l-3.18 3.19-1.07-1.07L6.94 8 3.75 4.82l1.07-1.07L8 6.94Z" />
                </svg>
              </button>
            </header>
            <div className={css.viewport}>
              <ThreeViewport />
            </div>
            <footer className={css.caption}>
              <span>鼠标拖动旋转，滚轮缩放。模型保留参考图的齿条、外齿轮、圆柱减速壳、方形电机座和螺栓/法兰细节。</span>
              <span className={css.badges}>
                <span className={css.badge}>WebGL</span>
                <span className={css.badge}>Three.js</span>
                <span className={css.badge}>在线预览</span>
              </span>
            </footer>
          </section>
        </div>
      )}
    </>
  )
}
