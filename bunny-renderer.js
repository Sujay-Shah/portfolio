/**
 * bunny-renderer.js
 * Stanford Bunny LOD demo — rotates continuously and cycles between
 * ~0.5% → 3% → 12% → 40% → 100% triangle density, then regresses back.
 *
 * Loads the bunny model locally from the project directory.
 * Cross-fades transitions between different LOD states smoothly.
 */

import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';

// ── Configuration ─────────────────────────────────────────────────────────────
const BUNNY_URL  = 'models/bunny.obj';
const LOD_FRACS  = [0.005, 0.03, 0.12, 0.40, 1.0];   // fraction of total faces per LOD level
const HOLD_MS    = 2400;   // ms to hold each LOD level before switching
const ROTATION_SPEED = 0.45; // rad/s
const FADE_SPEED = 4.0;    // speed multiplier for cross-fade transitions

// ── Main entry ────────────────────────────────────────────────────────────────
export function initBunnyRenderer() {
    const canvas = document.getElementById('bunny-canvas');
    const triEl  = document.getElementById('bunny-tri-count');
    if (!canvas) return;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);

    const container = canvas.parentElement;
    let W = container.offsetWidth  || 380;
    let H = container.offsetHeight || 380;
    renderer.setSize(W, H);

    // Scene / Camera
    const scene  = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, W / H, 0.001, 100);
    camera.position.set(0, 0.08, 0.33);
    camera.lookAt(0, 0.04, 0);

    // Lighting
    scene.add(new THREE.AmbientLight(0xffffff, 0.06));

    const keyLight = new THREE.DirectionalLight(0x00e5ff, 4.0);
    keyLight.position.set(1.5, 3, 2);
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0xff5722, 2.0);
    rimLight.position.set(-2, -1, -2);
    scene.add(rimLight);

    const topLight = new THREE.DirectionalLight(0xffffff, 0.4);
    topLight.position.set(0, 5, 0);
    scene.add(topLight);

    // Group that holds all LOD meshes
    const group = new THREE.Group();
    scene.add(group);

    // LOD state
    let lodMeshes  = [];   // [{ group: THREE.Group, triCount: number, solidMesh, wireMesh, currentOpacity, targetOpacity }]
    let currentLod = 0;
    let lodDir     = 1;    // +1 = ascending detail, -1 = descending
    let lastSwap   = performance.now();

    // ── Wireframe material (shared template) ──────────────────────────────────
    const wireMat = new THREE.LineBasicMaterial({
        color: 0x00e5ff,
        transparent: true,
        opacity: 0.0,
    });

    const solidMat = new THREE.MeshStandardMaterial({
        color: 0x050d1a,
        roughness: 1.0,
        metalness: 0.0,
        transparent: true,
        opacity: 0.0,
        side: THREE.DoubleSide,
    });

    // ── Build LOD meshes from a flat (non-indexed) position array ────────────
    function buildLODs(positions) {
        const totalFaces = Math.floor(positions.length / 9); // 3 verts × 3 floats per face

        LOD_FRACS.forEach((frac, i) => {
            const targetFaces = Math.max(8, Math.floor(totalFaces * frac));
            const step        = totalFaces / targetFaces;

            // Sample faces evenly across the whole model so every region is
            // represented at every LOD level (visually covers the silhouette).
            const lodPos = new Float32Array(targetFaces * 9);
            for (let j = 0; j < targetFaces; j++) {
                const srcFace = Math.floor(j * step);
                const src     = srcFace * 9;
                lodPos.set(positions.subarray(src, src + 9), j * 9);
            }

            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(lodPos, 3));
            geo.computeVertexNormals();

            const solid = new THREE.Mesh(geo, solidMat.clone());
            const wire  = new THREE.LineSegments(
                new THREE.EdgesGeometry(geo, 20),
                wireMat.clone(),
            );

            const lodGroup = new THREE.Group();
            lodGroup.add(solid, wire);
            
            const isInitial = (i === 0);
            lodGroup.visible = isInitial;
            solid.material.opacity = isInitial ? 0.80 : 0.0;
            wire.material.opacity = isInitial ? 0.90 : 0.0;
            
            group.add(lodGroup);

            lodMeshes.push({
                group: lodGroup,
                triCount: targetFaces,
                solidMesh: solid,
                wireMesh: wire,
                currentOpacity: isInitial ? 1.0 : 0.0,
                targetOpacity: isInitial ? 1.0 : 0.0
            });
        });

        fitGroup();
        updateTriCount();
    }

    // ── Center + scale the group to fit nicely in the camera frustum ─────────
    function fitGroup() {
        const bbox = new THREE.Box3().setFromObject(group);
        const center = bbox.getCenter(new THREE.Vector3());
        const size   = bbox.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const scale  = 0.14 / maxDim;

        group.scale.setScalar(scale);
        group.position.copy(center.multiplyScalar(-scale));
        group.position.y += 0.015; // Shift bunny up slightly to prevent bottom clipping
    }

    // ── Update the triangle counter overlay ──────────────────────────────────
    function updateTriCount() {
        if (!triEl || !lodMeshes.length) return;
        const tc = lodMeshes[currentLod].triCount;
        triEl.textContent = `▲ ${tc.toLocaleString()} triangles`;
    }

    // ── Load OBJ ─────────────────────────────────────────────────────────────
    const loader = new OBJLoader();
    loader.load(
        BUNNY_URL,
        (obj) => {
            let loaded = false;
            obj.traverse((child) => {
                if (loaded || !child.isMesh) return;
                loaded = true;

                let geo = child.geometry;
                // Convert indexed → non-indexed so we can sample raw faces
                if (geo.index) geo = geo.toNonIndexed();

                buildLODs(new Float32Array(geo.attributes.position.array));
            });
        },
        undefined,
        (error) => {
            console.error('Failed to load local Stanford Bunny model:', error);
        }
    );

    // ── Render + animation loop ───────────────────────────────────────────────
    const clock = new THREE.Clock();

    function animate() {
        requestAnimationFrame(animate);

        const dt  = clock.getDelta();
        group.rotation.y += dt * ROTATION_SPEED;

        // LOD cycling and transitions
        if (lodMeshes.length) {
            const now = performance.now();
            if (now - lastSwap > HOLD_MS) {
                lastSwap = now;

                // Deactivate current
                lodMeshes[currentLod].targetOpacity = 0.0;
                
                currentLod += lodDir;

                // Bounce at ends
                if (currentLod >= lodMeshes.length) {
                    currentLod = lodMeshes.length - 2;
                    lodDir = -1;
                } else if (currentLod < 0) {
                    currentLod = 1;
                    lodDir = 1;
                }

                // Activate new
                lodMeshes[currentLod].targetOpacity = 1.0;
                updateTriCount();
            }

            // Lerp opacities for smooth transition
            lodMeshes.forEach(mesh => {
                if (mesh.currentOpacity !== mesh.targetOpacity) {
                    const diff = mesh.targetOpacity - mesh.currentOpacity;
                    if (Math.abs(diff) < 0.005) {
                        mesh.currentOpacity = mesh.targetOpacity;
                    } else {
                        mesh.currentOpacity += diff * dt * FADE_SPEED;
                    }

                    // Apply interpolated opacities
                    mesh.solidMesh.material.opacity = mesh.currentOpacity * 0.80;
                    mesh.wireMesh.material.opacity = mesh.currentOpacity * 0.90;

                    // Keep hidden if completely faded out to save performance
                    mesh.group.visible = (mesh.currentOpacity > 0.005);
                }
            });
        }

        renderer.render(scene, camera);
    }
    animate();

    // ── Responsive resize ─────────────────────────────────────────────────────
    new ResizeObserver(() => {
        W = container.offsetWidth  || 380;
        H = container.offsetHeight || 380;
        renderer.setSize(W, H);
        camera.aspect = W / H;
        camera.updateProjectionMatrix();
    }).observe(container);
}

