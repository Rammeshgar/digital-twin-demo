import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { createMovement } from './movement.mjs';
import { refineCharacter, updateNaturalBlink } from './character-refinement.mjs?v=lip-sync-restored';
import { createStudioSet } from './studio-scene.mjs';

const embeddedAssistant = document.documentElement.dataset.twinEmbed === 'assistant';
const parentOrigin = embeddedAssistant ? location.origin : null;

const ui = {
    toggle: document.getElementById("ai-mascot-toggle"),
    toggleLabel: document.querySelector("#ai-mascot-toggle .ai-mascot-toggle__label"),
    panel: document.getElementById("ai-mascot-panel"),
    close: document.getElementById("ai-mascot-close"),
    voiceToggle: document.getElementById("ai-mascot-voice-toggle"),
    expand: document.getElementById("ai-mascot-expand"),
    resetView: document.getElementById("ai-mascot-reset-view"),
    status: document.getElementById("ai-mascot-status"),
    stage: document.getElementById("ai-mascot-stage"),
    loader: document.getElementById("ai-mascot-loader"),
    log: document.getElementById("ai-chat-log"),
    form: document.getElementById("ai-chat-form"),
    input: document.getElementById("ai-chat-input"),
    mic: document.getElementById("ai-mic-btn"),
    send: document.getElementById("ai-send-btn"),
};

const state = {
    disposed: false,
    loaded: false,
    loading: false,
    busy: false,
    voiceEnabled: true,
    recognition: null,
    recognitionStarting: false,
    recognitionSubmitted: false,
    recognitionError: "",
    microphoneGeneration: 0,
    recognitionGeneration: null,
    chatAbortController: null,
    transcriptionAbortController: null,
    recorderSupported: false,
    forceRecorderFallback: false,
    mediaRecorder: null,
    recordingStream: null,
    recordingChunks: [],
    recordingTimer: null,
    discardRecording: false,
    recordingAudioContext: null,
    recordingAnalyser: null,
    recordingMonitorFrame: null,
    recordingSpeechDetected: false,
    recordingSilenceStartedAt: 0,
    speaking: false,
    activeCharacter: "",
    previousInteractionId: null,
    currentAudio: null,
    currentAudioUrl: null,
    transcriptTimeline: [],
    mouthEnergy: 0,
    expanded: ui.panel.classList.contains("is-expanded"),
    renderError: false,
    currentSpeechText: "",
    hasStartedPerformance: false,
    currentTalkGesture: 0,
    talkGestureBag: [],
    playbackGeneration: 0,
};

let scene;
let camera;
let renderer;
let controls;
let mixer;
let movement;
let movementElapsed=0;
let model;
let headBone;
let neckBone;
let animationFrameId;
let resizeObserver;
let audioContext;
let audioAnalyser;
let audioSource;
let audioSamples;
const animationActions = new Map();
let activeBodyAction;
let cameraTransition;
let characterFrame;
let manualView = false;
let cameraDragging = false;
let lastStudioMode;
let studioSet;
let reducedPose;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const initialLoaderMarkup = ui.loader.innerHTML;
const lipSyncMeshes = [];
const clock = new THREE.Clock();
const targetVisemes = new Map();
const smoothedMouse = new THREE.Vector2();
const targetMouse = new THREE.Vector2();
const desiredGaze = new THREE.Vector2();
let pointerInsideStage = false;
const animatedHeadQuaternion = new THREE.Quaternion();
const animatedNeckQuaternion = new THREE.Quaternion();
const lookQuaternion = new THREE.Quaternion();
const lookEuler = new THREE.Euler();
let headLookApplied = false;
let neckLookApplied = false;

const MODEL_URL = "assets/sadeq-digital-twin.meshopt.glb";
const MODEL_ASSET_VERSION = "20260906-paper-18";
const TRANSCRIBE_API_URL = "https://test-rammeshgar-webpage.netlify.app/api/transcribe";
const VISEME_NAMES = ["AA/AH", "EE/IH", "OH/O", "OO/WQ", "FV", "MBP", "L", "TH"];
const IDLE_ANIMATION = "Mascot_Idle_Subtle_30f";
const TALK_INTRO_ANIMATION = "Mascot_Talk_Intro_Smooth";
const TALK_START_ANIMATION = "Mascot_Talk_Start_Smooth";
const TALK_GESTURES = ["Start", "Explain1", "Explain2"];
const TALK_PLAYBACK_SPEED = 0.68;

function applyPapercutFinish(mesh) {
    if (/glass|lence|mouth_cavity/i.test(mesh.name)) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const isSkin = /new_head/i.test(mesh.name);
    const isBody = /^body$/i.test(mesh.name);
    const isHair = /^hair/i.test(mesh.name);
    const paperStrength = isSkin ? 0.19 : isBody ? 0.23 : 0.17;
    const paletteTreatment = isSkin
        ? `diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.07, 0.97, 0.89), 0.48);
           diffuseColor.rgb += vec3(0.010, 0.005, 0.0);`
        : isBody
            ? `float ivoryMask = smoothstep(0.52, 0.88, paperLuma);
               vec3 midnightCloth = diffuseColor.rgb * vec3(0.76, 0.94, 1.02);
               vec3 warmIvory = diffuseColor.rgb * vec3(1.12, 0.89, 0.75);
               diffuseColor.rgb = mix(midnightCloth, warmIvory, ivoryMask * 0.82);`
            : isHair
                ? `diffuseColor.rgb *= vec3(0.84, 0.90, 1.0);`
                : "";

    for (const material of materials) {
        if (!material?.isMeshStandardMaterial) continue;
        const matteRoughness = isHair ? 0.98 : isSkin ? 0.90 : isBody ? 0.92 : 0.88;
        material.roughness = Math.max(material.roughness ?? 0, matteRoughness);
        material.metalness = Math.min(material.metalness ?? 0, 0.02);
        material.envMapIntensity = Math.min(material.envMapIntensity ?? 1, isHair ? 0.18 : isSkin ? 0.30 : 0.42);
        material.flatShading = true;
        material.onBeforeCompile = (shader) => {
            shader.vertexShader = shader.vertexShader
                .replace("#include <common>", "#include <common>\nvarying vec3 vPaperPosition;")
                .replace("#include <begin_vertex>", "#include <begin_vertex>\nvPaperPosition = position;");
            shader.fragmentShader = shader.fragmentShader
                .replace("#include <common>", `#include <common>
                    varying vec3 vPaperPosition;
                    float paperHash(vec3 p) {
                        p = fract(p * 0.3183099 + vec3(0.17, 0.31, 0.53));
                        p *= 17.0;
                        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
                    }
                    float paperNoise(vec3 p) {
                        vec3 i = floor(p);
                        vec3 f = fract(p);
                        f = f * f * (3.0 - 2.0 * f);
                        return mix(
                            mix(mix(paperHash(i), paperHash(i + vec3(1,0,0)), f.x),
                                mix(paperHash(i + vec3(0,1,0)), paperHash(i + vec3(1,1,0)), f.x), f.y),
                            mix(mix(paperHash(i + vec3(0,0,1)), paperHash(i + vec3(1,0,1)), f.x),
                                mix(paperHash(i + vec3(0,1,1)), paperHash(i + vec3(1,1,1)), f.x), f.y), f.z);
                    }`)
                .replace("#include <color_fragment>", `#include <color_fragment>
                    float paperBroad = paperNoise(vPaperPosition * 18.0);
                    float paperFiber = paperNoise(vPaperPosition * 115.0);
                    float paperGrain = mix(paperBroad, paperFiber, 0.42);
                    float paperValue = mix(0.88, 1.08, paperGrain);
                    float paperLuma = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
                    diffuseColor.rgb = mix(vec3(paperLuma), diffuseColor.rgb, 1.12);
                    diffuseColor.rgb *= mix(1.0, paperValue, ${paperStrength.toFixed(3)});
                    diffuseColor.rgb *= vec3(1.018, 1.0, 0.965);
                    ${paletteTreatment}`);
        };
        // Skin, cloth and hair each compile a different palette treatment.
        material.customProgramCacheKey = () => `papercut-v3-${isSkin ? 'skin' : isBody ? 'cloth' : isHair ? 'hair' : 'general'}-${paperStrength}`;
        material.needsUpdate = true;
    }
}

function setStatus(message) {
    ui.status.textContent = message;
    updateStudioMode();
}

function getStudioMode() {
    if (state.renderError) return 'error';
    if (state.speaking) return 'speaking';
    if (state.listening || state.recordingStream || state.recognitionStarting) return 'listening';
    if (state.busy) return 'thinking';
    return state.loaded ? 'idle' : 'loading';
}

function updateStudioMode() {
    const mode = getStudioMode();
    if (mode === lastStudioMode) return;
    lastStudioMode = mode;
    ui.panel.dataset.studioState = mode;
    if (!manualView && characterFrame && state.loaded && !reducedMotion.matches) {
        moveCameraForMode(false);
    }
}

function addMessage(text, role = "bot", extraClass = "") {
    const message = document.createElement("div");
    message.className = `ai-message ai-message-${role} ${extraClass}`.trim();
    message.textContent = text;
    ui.log.appendChild(message);
    ui.log.scrollTop = ui.log.scrollHeight;
    return message;
}

function isPanelActive() {
    return !state.disposed && ui.panel.classList.contains('is-open');
}

function notifyHost(type) {
    if (embeddedAssistant && parentOrigin && parentOrigin !== 'null') {
        window.parent.postMessage({ type }, parentOrigin);
    }
}

function openPanel() {
    if (state.disposed) return;
    ui.panel.classList.add("is-open");
    ui.panel.setAttribute("aria-hidden", "false");
    ui.toggle.setAttribute("aria-expanded", "true");
    document.body.classList.add("ai-open", "ai-available");
    if (ui.toggleLabel) ui.toggleLabel.textContent = "Studio open";
    if (!state.loaded && !state.loading) loadMascot();
    else if (state.loaded) startRenderLoop();
    requestAnimationFrame(() => {
        if (!isPanelActive()) return;
        if (!embeddedAssistant) {
            const top = document.querySelector('.site-header')?.getBoundingClientRect().bottom || 0;
            const rect = ui.panel.getBoundingClientRect();
            if (rect.top < top - 1 || rect.top > top + 56) {
                ui.panel.scrollIntoView({ block: 'start', behavior: 'instant' });
            }
        }
        // Opening on a phone should not immediately launch its soft keyboard.
        const focusTarget = matchMedia('(max-width: 760px), (pointer: coarse)').matches ? ui.close : ui.input;
        focusTarget?.focus({ preventScroll: true });
    });
}

function closePanel() {
    if (embeddedAssistant) {
        // The host owns its dialog and focus return, so never focus the hidden
        // standalone launcher inside this iframe.
        try { disposeAssistant(); }
        finally { notifyHost('twin-close'); }
        return;
    }
    ui.panel.classList.remove("is-open");
    ui.panel.setAttribute("aria-hidden", "true");
    ui.toggle.setAttribute("aria-expanded", "false");
    document.body.classList.remove("ai-open");
    if (ui.toggleLabel) ui.toggleLabel.textContent = "Enter the studio";
    pointerInsideStage = false;
    targetMouse.set(0, 0);
    cancelMicrophoneInput();
    stopAllSpeech();
    stopRenderLoop();
    // The launcher has just become visible again. Flush its layout and return
    // focus synchronously in this keyboard/click event, not on a future frame.
    const launcher = ui.toggle.getBoundingClientRect();
    ui.toggle.focus({ preventScroll: true });
    const top = document.querySelector('.site-header')?.getBoundingClientRect().bottom || 0;
    if (launcher.top < top || launcher.bottom > innerHeight) ui.toggle.scrollIntoView({ block: 'nearest', behavior: 'instant' });
}

function disposeAssistant() {
    if (state.disposed) return;
    state.disposed = true;
    ui.panel.classList.remove('is-open');
    ui.panel.setAttribute('aria-hidden', 'true');
    // In-flight permissions can resolve after a close, so the microphone
    // generation also invalidates delayed results before they begin capture.
    const cleanup = (name, operation) => {
        try { operation(); }
        catch (error) { console.warn(`Assistant cleanup (${name}) was incomplete.`, error); }
    };
    cleanup('microphone', cancelMicrophoneInput);
    // Always stop the underlying media tracks even if a recognition API call
    // threw before the higher-level cancellation could finish.
    cleanup('media tracks', () => state.recordingStream?.getTracks().forEach(track => track.stop()));
    cleanup('recording monitor', stopRecordingMonitor);
    cleanup('chat', () => state.chatAbortController?.abort());
    cleanup('transcription', () => state.transcriptionAbortController?.abort());
    cleanup('speech', stopAllSpeech);
    cleanup('speech output', () => window.speechSynthesis?.cancel());
    cleanup('generated audio', () => state.currentAudio?.pause());
    cleanup('interface sounds', () => document.dispatchEvent(new Event('twin-dispose')));
    cleanup('audio context', () => audioContext?.close().catch(() => {}));
    audioContext = null;
    cleanup('render loop', stopRenderLoop);
    cleanup('studio controls', () => controls?.dispose());
    controls = null;
    cleanup('resize observer', () => resizeObserver?.disconnect());
    resizeObserver = null;
    cleanup('renderer', () => renderer?.dispose());
    cleanup('canvas', () => renderer?.domElement.remove());
    renderer = null;
    state.loaded = false;
}

if (embeddedAssistant) {
    window.addEventListener('message', event => {
        if (event.source !== window.parent || event.origin !== parentOrigin || event.data?.type !== 'twin-dispose') return;
        try { disposeAssistant(); }
        finally { notifyHost('twin-disposed'); }
    });
    window.addEventListener('pagehide', disposeAssistant, { once: true });
    document.getElementById('ai-open-standalone')?.addEventListener('click', disposeAssistant);
}

ui.toggle.addEventListener("click", () => {
    if (ui.panel.classList.contains("is-open")) closePanel();
    else openPanel();
});
ui.close.addEventListener("click", closePanel);
ui.expand?.addEventListener("click", () => {
    state.expanded = !state.expanded;
    ui.panel.classList.toggle("is-expanded", state.expanded);
    ui.expand.setAttribute("aria-pressed", String(state.expanded));
    ui.expand.setAttribute("aria-label", "Expanded character viewer");
    ui.expand.title = state.expanded ? "Use compact viewer" : "Expand mascot viewer";
    const icon = ui.expand.querySelector("[data-icon]");
    if (icon) icon.dataset.icon = state.expanded ? "compress" : "expand";
    manualView = false;
    moveCameraForMode();
    requestAnimationFrame(resizeRenderer);
});
ui.resetView?.addEventListener('click', () => {
    manualView = false;
    moveCameraForMode();
});
document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && ui.panel.classList.contains("is-open")) {
        event.preventDefault();
        closePanel();
    }
});

document.querySelectorAll("[data-ai-prompt]").forEach((button) => {
    button.addEventListener("click", () => {
        if (!ui.panel.classList.contains("is-open")) openPanel();
        askGemini(button.dataset.aiPrompt);
    });
});

ui.voiceToggle.addEventListener("click", () => {
    state.voiceEnabled = !state.voiceEnabled;
    const icon = ui.voiceToggle.querySelector("[data-icon]");
    if (icon) icon.dataset.icon = state.voiceEnabled ? "volume" : "muted";
    ui.voiceToggle.title = state.voiceEnabled ? "Mute voice" : "Enable voice";
    ui.voiceToggle.setAttribute("aria-label", "Voice output");
    ui.voiceToggle.setAttribute("aria-pressed", String(state.voiceEnabled));
    if (!state.voiceEnabled) {
        stopAllSpeech();
    }
});

async function loadMascot() {
    if (state.disposed) return;
    state.loading = true;
    state.renderError = false;
    ui.loader.innerHTML = initialLoaderMarkup;
    ui.loader.classList.remove('is-hidden');
    characterFrame = null;
    cameraTransition = null;
    manualView = false;
    cameraDragging = false;
    reducedPose = null;
    model = null;
    headBone = neckBone = null;
    headLookApplied = neckLookApplied = false;
    movement = mixer = activeBodyAction = null;
    lipSyncMeshes.length = 0;
    animationActions.clear();
    setStatus("Chat ready · loading the 3D mascot");

    try {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(0, 1.5, 1.8);

    const compactViewer = window.matchMedia("(max-width: 760px)").matches || (navigator.deviceMemory && navigator.deviceMemory <= 4);
    renderer = new THREE.WebGLRenderer({ antialias: !compactViewer, alpha: false, powerPreference: compactViewer ? "low-power" : "high-performance" });
    // Retain detail without rendering at full 3x DPR on dense screens.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, compactViewer ? 1.4 : 1.65));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.94;
    renderer.shadowMap.enabled = !compactViewer;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.setAttribute('aria-label', 'Interactive three-dimensional digital twin');
    renderer.domElement.setAttribute('role', 'img');
    ui.stage.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1.5, 0);
    controls.enableDamping = !reducedMotion.matches;
    controls.enablePan = false;
    controls.minDistance = 1.0;
    controls.maxDistance = 3.8;
    controls.zoomSpeed = 0.7;
    controls.minAzimuthAngle = -Math.PI * 0.21;
    controls.maxAzimuthAngle = Math.PI * 0.21;
    controls.minPolarAngle = Math.PI * 0.36;
    controls.maxPolarAngle = Math.PI * 0.59;
    controls.addEventListener('start', () => {
        manualView = true;
        cameraDragging = true;
        cameraTransition = null;
        ui.stage.dataset.cameraMode = 'manual';
    });
    controls.addEventListener('end', () => { cameraDragging = false; });
    studioSet = createStudioSet(scene, compactViewer);

    renderer.domElement.addEventListener("pointermove", (event) => {
        if (event.pointerType === 'touch' || reducedMotion.matches) return;
        pointerInsideStage = true;
        const rect = renderer.domElement.getBoundingClientRect();
        targetMouse.x = THREE.MathUtils.clamp(((event.clientX - rect.left) / rect.width) * 2 - 1, -1, 1);
        targetMouse.y = THREE.MathUtils.clamp(((event.clientY - rect.top) / rect.height) * 2 - 1, -1, 1);
    });
    renderer.domElement.addEventListener("pointerleave", () => {
        pointerInsideStage = false;
        targetMouse.set(0, 0);
    });

    resizeObserver = new ResizeObserver(resizeRenderer);
    resizeObserver.observe(ui.stage);
    resizeRenderer();

        const loader = new GLTFLoader();
        loader.setMeshoptDecoder(MeshoptDecoder);
        const gltf = await loader.loadAsync(`${MODEL_URL}?v=${MODEL_ASSET_VERSION}`);
        if (state.disposed) return;
        model = gltf.scene;
        refineCharacter(model);
        scene.add(model);

        model.traverse((child) => {
            if (child.isMesh) {
                // The preserved authored GLB includes a first-generation studio.
                // Render the new world-space set instead of stacking the two sets.
                if (/^Studio_/i.test(child.name)) { child.visible = false; return; }
                const isGlasses = /glass/i.test(child.name);
                child.castShadow = !isGlasses;
                child.receiveShadow = !isGlasses;
                applyPapercutFinish(child);
                if (child.morphTargetDictionary) {
                    const names = Object.keys(child.morphTargetDictionary);
                    if (VISEME_NAMES.some((name) => names.includes(name))) lipSyncMeshes.push(child);
                }
            }
            if (child.isBone) {
                const name = child.name.toLowerCase();
                if (!headBone && name.includes("head")) headBone = child;
                else if (!neckBone && name.includes("neck")) neckBone = child;
            }
        });
        // These are the actual exported head/neck joints in the current GLB;
        // naming-based fallback still supports human-named replacement rigs.
        const rigHead = model.getObjectByName('bone_51');
        const rigNeck = model.getObjectByName('bone_50');
        if (!headBone && rigHead?.isBone) headBone = rigHead;
        if (!neckBone && rigNeck?.isBone) neckBone = rigNeck;
        const visibleHead = model.getObjectByName('new_head');
        const visibleHeadLipSync = Boolean(visibleHead?.morphTargetDictionary && VISEME_NAMES.every((name) => name in visibleHead.morphTargetDictionary));

        frameMascot();

        try { movement = await createMovement(model); }
        catch (error) { console.warn('Authored gesture library unavailable; using embedded clips.', error); }
        if (state.disposed) return;
        if (!movement && gltf.animations.length) {
            mixer = new THREE.AnimationMixer(model);
            for (const clip of gltf.animations) {
                const action = mixer.clipAction(clip);
                animationActions.set(clip.name, action);
            }
            mixer.addEventListener("finished", ({ action }) => {
                if (!state.speaking || action !== activeBodyAction) return;
                playRandomTalkAnimation(0.32);
            });
            playBodyAnimation(IDLE_ANIMATION, 0.72, false, 0.18);
        }

        // Sample a composed pose and draw it before revealing the studio;
        // there is no transient rig rest pose during the loading transition.
        if (movement) movement.update(0.34, state, movementElapsed);
        else mixer?.update(0.34);
        renderer.render(scene, camera);
        state.loaded = true;
        state.loading = false;
        ui.loader.classList.add("is-hidden");
        setStatus(visibleHeadLipSync ? "Ready · voice and lip movement online" : "Ready · 3D mascot online");
        startRenderLoop();
    } catch (error) {
        if (state.disposed) return;
        state.loading = false;
        state.renderError = true;
        state.loaded = false;
        stopRenderLoop();
        controls?.dispose();
        controls = null;
        resizeObserver?.disconnect();
        renderer?.domElement.remove();
        renderer?.dispose();
        renderer = null;
        ui.loader.innerHTML = '<span class="css-icon css-icon--warning" aria-hidden="true"></span><span>The 3D mascot is unavailable.<small>You can still use the full chat below.</small></span>';
        ui.loader.classList.remove('is-hidden');
        setStatus("Chat ready · 3D view unavailable");
        console.error("Mascot load error:", error);
    }
}

function frameMascot() {
    if (!model || !camera || !controls) return;

    model.updateMatrixWorld(true);
    const characterMeshes = [];
    model.traverse((child) => {
        if (child.isMesh && !/^Studio_/i.test(child.name)) characterMeshes.push(child);
    });
    const getCharacterBounds = () => {
        const box = new THREE.Box3();
        for (const mesh of characterMeshes) box.expandByObject(mesh);
        return box;
    };
    const initialBounds = getCharacterBounds();
    const initialSize = initialBounds.getSize(new THREE.Vector3());
    if (!Number.isFinite(initialSize.y) || initialSize.y <= 0) return;

    // Normalize different replacement mascots to the same real-world height.
    const normalizedHeight = 1.9;
    const fittedScale = normalizedHeight / initialSize.y;
    model.scale.multiplyScalar(fittedScale);
    model.updateMatrixWorld(true);

    // Put the feet on the stage, regardless of the model's export origin.
    const groundedBounds = getCharacterBounds();
    model.position.y -= groundedBounds.min.y;
    model.updateMatrixWorld(true);

    const bounds = getCharacterBounds();
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    characterFrame = { bounds, size, center };
    controls.minDistance = size.y * 0.50;
    controls.maxDistance = size.y * 2.10;
    const destination = getCameraDestination();
    controls.target.copy(destination.target);
    camera.position.copy(destination.position);
    camera.lookAt(destination.target);
    ui.stage.dataset.cameraMode = state.expanded ? 'studio' : 'portrait';
    ui.stage.dataset.motion = reducedMotion.matches ? 'reduced' : 'full';
    controls.update();
}

// Framing is calculated in world units with the current stage aspect. This
// prevents the large portrait from cropping hair/shoulders on short screens.
// State changes are a subtle adjustment, not a new camera angle or animation.
function getCameraDestination(mode = getStudioMode()) {
    if (!characterFrame || !camera) return null;
    const { bounds, size, center } = characterFrame;
    const aspect = Math.max(camera.aspect, 0.35);
    // On a phone the portrait takes a deliberately nearer shot; a full waist
    // composition in a 240px stage makes facial motion unnecessarily tiny.
    const smallStage = matchMedia('(max-width: 760px)').matches && ui.stage.clientHeight < 390;
    const faceBias = mode === 'listening' ? 0.023 : mode === 'speaking' ? -0.015 : mode === 'thinking' ? 0.006 : 0;
    const sideBias = mode === 'thinking' ? -0.042 : mode === 'speaking' ? 0.035 : 0.012;
    const targetRatio = smallStage ? (state.expanded ? 0.803 : 0.832) : (state.expanded ? 0.776 : 0.815);
    const verticalRatio = smallStage ? (state.expanded ? 0.545 : 0.495) : (state.expanded ? 0.635 : 0.545);
    const target = new THREE.Vector3(center.x, bounds.min.y + size.y * (targetRatio + faceBias), center.z);
    const visibleHeight = Math.max(size.y * verticalRatio, (state.expanded ? 0.96 : 0.80) / aspect);
    // Listening closes the distance only slightly; speaking breathes room into
    // the frame for authored body motion. Never move the camera radically.
    const modeScale = mode === 'listening' ? 0.98 : mode === 'speaking' ? 1.045 : 1;
    const distance = visibleHeight * modeScale / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    const position = new THREE.Vector3(target.x + size.y * sideBias, target.y + size.y * 0.012, target.z + distance);
    return { position, target };
}

function moveCameraForMode(explicit = true) {
    const destination = getCameraDestination();
    if (!destination || !camera || !controls) return;
    ui.stage.dataset.cameraMode = state.expanded ? 'studio' : 'portrait';
    if (reducedMotion.matches) {
        cameraTransition = null;
        camera.position.copy(destination.position);
        controls.target.copy(destination.target);
        camera.lookAt(controls.target);
        controls.update();
        return;
    }
    cameraTransition = {
        startedAt: performance.now(),
        duration: explicit ? 760 : 1250,
        fromPosition: camera.position.clone(),
        fromTarget: controls.target.clone(),
        toPosition: destination.position.clone(),
        toTarget: destination.target.clone(),
    };
}

function resizeRenderer() {
    if (!renderer || !camera) return;
    const width = Math.max(ui.stage.clientWidth, 1);
    const height = Math.max(ui.stage.clientHeight, 1);
    if (width < 2 || height < 2) return;
    renderer.setSize(width, height, false);
    const previousAspect = camera.aspect;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (characterFrame && !manualView && Math.abs(previousAspect - camera.aspect) > 0.015) {
        if (state.loaded) moveCameraForMode(false);
        else {
            const destination = getCameraDestination();
            camera.position.copy(destination.position);
            controls.target.copy(destination.target);
            controls.update();
        }
    }
}

function startRenderLoop() {
    if (state.disposed || !state.loaded || !renderer || animationFrameId || document.hidden || !ui.panel.classList.contains('is-open')) return;
    clock.getDelta();
    animationFrameId = requestAnimationFrame(animate);
}

function stopRenderLoop() {
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
}

document.addEventListener('visibilitychange', () => document.hidden ? stopRenderLoop() : startRenderLoop());
reducedMotion.addEventListener?.('change', () => {
    ui.stage.dataset.motion = reducedMotion.matches ? 'reduced' : 'full';
    if (controls) controls.enableDamping = !reducedMotion.matches;
    if (reducedMotion.matches) targetMouse.set(0, 0);
    if (!manualView) moveCameraForMode();
});

function animate() {
    if (!renderer || document.hidden || !ui.panel.classList.contains('is-open')) { stopRenderLoop(); return; }
    animationFrameId = requestAnimationFrame(animate);
    const delta = Math.min(clock.getDelta(), 0.05);
    controls?.update();
    updateStudioMode();

    if (headBone && headLookApplied) {
        headBone.quaternion.copy(animatedHeadQuaternion);
        headLookApplied = false;
    }
    if (neckBone && neckLookApplied) {
        neckBone.quaternion.copy(animatedNeckQuaternion);
        neckLookApplied = false;
    }

    movementElapsed += delta;
    // Reduced-motion visitors retain speech-driven performance, but idle and
    // thinking stay as still poses rather than looping gestural animation.
    if (!reducedMotion.matches || state.speaking) {
        if (movement) movement.update(delta, state, movementElapsed);
        else mixer?.update(delta);
        reducedPose = null;
    } else {
        const mode = getStudioMode();
        if (mode !== reducedPose) {
            if (movement) movement.update(0.34, state, movementElapsed);
            else mixer?.update(0.34);
            reducedPose = mode;
        }
    }

    if (cameraTransition) {
        const progress = THREE.MathUtils.clamp((performance.now() - cameraTransition.startedAt) / cameraTransition.duration, 0, 1);
        const eased = progress * progress * (3 - 2 * progress);
        camera.position.lerpVectors(cameraTransition.fromPosition, cameraTransition.toPosition, eased);
        controls.target.lerpVectors(cameraTransition.fromTarget, cameraTransition.toTarget, eased);
        camera.lookAt(controls.target);
        if (progress >= 1) {
            cameraTransition = null;
            controls.update();
        }
    }

    const alpha = 1 - Math.exp(-3.2 * delta);
    if (reducedMotion.matches) {
        smoothedMouse.set(0, 0);
    } else {
        // A very small, additive head/neck look over the authored body poses.
        // Speaking favours the listener; thinking briefly looks off-centre;
        // listening becomes attentive. The visitor can still attract the gaze.
        if (state.speaking) desiredGaze.set(Math.sin(movementElapsed * 0.51) * 0.075, 0);
        else if (state.busy) desiredGaze.set(-0.26 + Math.sin(movementElapsed * 0.36) * 0.05, -0.13);
        else if (state.listening || state.recordingStream || state.recognitionStarting) desiredGaze.set(0, 0.12);
        else desiredGaze.set(Math.sin(movementElapsed * 0.31) * 0.16, Math.sin(movementElapsed * 0.42 + 1.8) * 0.09);
        if (pointerInsideStage && !cameraDragging) desiredGaze.lerp(targetMouse, state.speaking ? 0.28 : state.busy ? 0.35 : 0.72);
        smoothedMouse.lerp(desiredGaze, alpha);
    }
    if (headBone) {
        animatedHeadQuaternion.copy(headBone.quaternion);
        lookEuler.set(smoothedMouse.y * THREE.MathUtils.degToRad(5), smoothedMouse.x * THREE.MathUtils.degToRad(9), 0, "YXZ");
        lookQuaternion.setFromEuler(lookEuler);
        headBone.quaternion.copy(animatedHeadQuaternion).multiply(lookQuaternion);
        headLookApplied = true;
    }
    if (neckBone) {
        animatedNeckQuaternion.copy(neckBone.quaternion);
        lookEuler.set(smoothedMouse.y * THREE.MathUtils.degToRad(2), smoothedMouse.x * THREE.MathUtils.degToRad(4), 0, "YXZ");
        lookQuaternion.setFromEuler(lookEuler);
        neckBone.quaternion.copy(animatedNeckQuaternion).multiply(lookQuaternion);
        neckLookApplied = true;
    }

    updateGeneratedSpeechViseme();
    updateVisemes();
    updateNaturalBlink(delta,reducedMotion.matches);
    // Signal intensity is a real state indication; no decorative flashing.
    if (studioSet?.signal) {
        const targetIntensity = state.listening || state.recordingStream ? 0.95 : state.speaking ? 0.75 : 0.48;
        studioSet.signal.emissiveIntensity = reducedMotion.matches ? targetIntensity : THREE.MathUtils.lerp(studioSet.signal.emissiveIntensity, targetIntensity, 1 - Math.exp(-3 * delta));
    }
    renderer.render(scene, camera);
}

function characterToViseme(character) {
    const c = String(character || "").toLowerCase();
    if (/[aáàäâ]/.test(c)) return "AA/AH";
    if (/[eéèëêiíìïîy]/.test(c)) return "EE/IH";
    if (/[oóòöô]/.test(c)) return "OH/O";
    if (/[uúùüûwq]/.test(c)) return "OO/WQ";
    if (/[fv]/.test(c)) return "FV";
    if (/[bmp]/.test(c)) return "MBP";
    if (/[l]/.test(c)) return "L";
    if (/[th]/.test(c)) return "TH";
    if (/[cgjksxz]/.test(c)) return "EE/IH";
    if (/[dnr]/.test(c)) return "AA/AH";
    return null;
}

function pickVisemeCharacter(text, startIndex = 0) {
    const fragment = String(text || "").slice(startIndex, startIndex + 24);
    return Array.from(fragment).find((character) => characterToViseme(character)) || "";
}

function buildTranscriptTimeline(text) {
    let totalWeight = 0;
    const timeline = Array.from(String(text || "")).map((character) => {
        const weight = /\s/.test(character)
            ? 0.42
            : /[.,!?;:—-]/.test(character)
                ? 0.85
                : /[aeiouyáàäâéèëêíìïîóòöôúùüû]/i.test(character)
                    ? 1.22
                    : 0.78;
        totalWeight += weight;
        return { character, end: totalWeight };
    });

    if (totalWeight > 0) {
        for (const entry of timeline) entry.end /= totalWeight;
    }
    return timeline;
}

function setupAudioAnalysis(audio) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    try {
        audioContext ||= new AudioContextClass();
        audioAnalyser = audioContext.createAnalyser();
        audioAnalyser.fftSize = 256;
        audioAnalyser.smoothingTimeConstant = 0.72;
        audioSamples = new Uint8Array(audioAnalyser.fftSize);
        audioSource = audioContext.createMediaElementSource(audio);
        audioSource.connect(audioAnalyser);
        audioAnalyser.connect(audioContext.destination);
        audioContext.resume().catch(() => {});
    } catch (error) {
        audioAnalyser = null;
        audioSamples = null;
        console.warn("Audio analysis unavailable; using transcript timing only.", error);
    }
}

function updateGeneratedSpeechViseme() {
    const audio = state.currentAudio;
    if (!audio || audio.paused || audio.ended) return;

    if (state.transcriptTimeline.length && Number.isFinite(audio.duration) && audio.duration > 0) {
        const progress = THREE.MathUtils.clamp(audio.currentTime / audio.duration, 0, 1);
        const entry = state.transcriptTimeline.find((item) => item.end >= progress);
        state.activeCharacter = entry?.character || "";
    }

    if (audioAnalyser && audioSamples) {
        audioAnalyser.getByteTimeDomainData(audioSamples);
        let energy = 0;
        for (const sample of audioSamples) {
            const centered = (sample - 128) / 128;
            energy += centered * centered;
        }
        const rms = Math.sqrt(energy / audioSamples.length);
        const speechEnergy = THREE.MathUtils.clamp((rms - 0.012) / 0.11, 0, 1);
        state.mouthEnergy = THREE.MathUtils.lerp(state.mouthEnergy, speechEnergy, 0.38);
    } else {
        state.mouthEnergy = THREE.MathUtils.lerp(state.mouthEnergy, 0.72, 0.18);
    }
}

function updateVisemes() {
    const activeName = state.speaking ? characterToViseme(state.activeCharacter) : null;
    const strength = 0.2 + state.mouthEnergy * 0.72;
    for (const mesh of lipSyncMeshes) {
        for (const [name, index] of Object.entries(mesh.morphTargetDictionary)) {
            if (!VISEME_NAMES.includes(name)) continue;
            const target = name === activeName ? strength : 0;
            mesh.morphTargetInfluences[index] = THREE.MathUtils.lerp(mesh.morphTargetInfluences[index] || 0, target, state.speaking ? 0.32 : 0.2);
        }
    }
}

function playBodyAnimation(name, timeScale = 1, loop = false, transition = 0.38) {
    const nextAction = animationActions.get(name);
    if (!nextAction) return;

    const previousAction = activeBodyAction;
    activeBodyAction = nextAction;
    nextAction.reset();
    nextAction.enabled = true;
    nextAction.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    nextAction.clampWhenFinished = !loop;
    nextAction.setEffectiveTimeScale(timeScale);
    nextAction.setEffectiveWeight(1);
    nextAction.play();
    if (previousAction && previousAction !== nextAction) {
        nextAction.crossFadeFrom(previousAction, transition, true);
    } else {
        nextAction.fadeIn(transition).play();
    }
}

function stopBodyAnimation() {
    const action = activeBodyAction;
    activeBodyAction = null;
    if (!action) return;
    action.fadeOut(0.18);
    window.setTimeout(() => action.stop(), 220);
}

function playRandomTalkAnimation(transition = 0.72) {
    const currentIndex = state.currentTalkGesture;
    state.talkGestureBag = state.talkGestureBag.filter((index) => index !== currentIndex);
    if (!state.talkGestureBag.length) {
        state.talkGestureBag = TALK_GESTURES
            .map((_, index) => index)
            .filter((index) => index !== currentIndex)
            .sort(() => Math.random() - 0.5);
    }
    const nextIndex = state.talkGestureBag.pop();
    const name = `Mascot_Talk_${TALK_GESTURES[currentIndex]}_To_${TALK_GESTURES[nextIndex]}_Smooth`;
    state.currentTalkGesture = nextIndex;
    playBodyAnimation(name, TALK_PLAYBACK_SPEED, false, transition);
}

function startSpeakingAnimation() {
    state.speaking = true;
    state.mouthEnergy = 0.68;
    setStatus("Speaking…");
    window.portfolioMusic?.pauseForVoice?.();
    const beginsWithGreeting = /^(hi|hey|hello)\b/i.test(state.currentSpeechText.trim());
    state.currentTalkGesture = 0;
    state.talkGestureBag = [];
    const continuingConversation = state.hasStartedPerformance;
    const openingAnimation = beginsWithGreeting ? TALK_INTRO_ANIMATION : TALK_START_ANIMATION;
    state.hasStartedPerformance = true;
    if (continuingConversation) {
        playRandomTalkAnimation(0.72);
    } else {
        playBodyAnimation(openingAnimation, TALK_PLAYBACK_SPEED, false, 0.72);
    }
}

function stopSpeakingAnimation() {
    state.speaking = false;
    state.activeCharacter = "";
    state.transcriptTimeline = [];
    state.currentSpeechText = "";
    state.mouthEnergy = 0;
    setStatus(state.loaded ? "Ready" : "Chat ready · mascot still loading");
    window.portfolioMusic?.resumeAfterVoice?.();
    playBodyAnimation(IDLE_ANIMATION, 0.72, false, 0.62);
}

function stopAllSpeech() {
    state.playbackGeneration += 1;
    const wasSpeaking = state.speaking;
    window.speechSynthesis?.cancel();

    audioSource?.disconnect();
    audioSource = null;
    audioAnalyser = null;
    audioSamples = null;

    if (state.currentAudio) {
        state.currentAudio.pause();
        state.currentAudio.src = "";
        state.currentAudio = null;
    }

    if (state.currentAudioUrl) {
        URL.revokeObjectURL(state.currentAudioUrl);
        state.currentAudioUrl = null;
    }

    if (wasSpeaking) stopSpeakingAnimation();
}

async function playGeneratedAudio(audioBase64, mimeType = "audio/mpeg", transcript = "") {
    if (!state.voiceEnabled || !audioBase64) return false;

    stopAllSpeech();
    const playbackGeneration = state.playbackGeneration;

    try {
        const binary = atob(audioBase64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

        const blob = new Blob([bytes], { type: mimeType });
        const audioUrl = URL.createObjectURL(blob);
        const audio = new Audio(audioUrl);

        state.currentAudio = audio;
        state.currentAudioUrl = audioUrl;
        state.currentSpeechText = transcript;
        state.transcriptTimeline = buildTranscriptTimeline(transcript);
        setupAudioAnalysis(audio);

        audio.addEventListener("ended", stopAllSpeech, { once: true });
        audio.addEventListener("error", stopAllSpeech, { once: true });

        audio.preload = "auto";
        audio.load();
        if (audio.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
            await Promise.race([
                new Promise((resolve) => audio.addEventListener("canplay", resolve, { once: true })),
                new Promise((resolve) => window.setTimeout(resolve, 1200)),
            ]);
        }
        if (playbackGeneration !== state.playbackGeneration) return true;
        startSpeakingAnimation();
        await new Promise((resolve) => window.setTimeout(resolve, 420));
        if (playbackGeneration !== state.playbackGeneration) return true;
        await audio.play();
        return true;
    } catch (error) {
        console.error("Generated audio playback failed:", error);
        stopAllSpeech();
        return false;
    }
}

function chooseVoice() {
    const voices = window.speechSynthesis.getVoices();
    return voices.find((v) => /^en(-|_)/i.test(v.lang) && /natural|online|google|microsoft/i.test(v.name))
        || voices.find((v) => /^en(-|_)/i.test(v.lang))
        || voices[0];
}

function speak(text) {
    if (!state.voiceEnabled || !text || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const playbackGeneration = ++state.playbackGeneration;
    state.currentSpeechText = text;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = 1;
    utterance.pitch = 1;
    const voice = chooseVoice();
    if (voice) utterance.voice = voice;
    utterance.onboundary = (event) => {
        const index = Math.min(event.charIndex || 0, text.length - 1);
        state.activeCharacter = pickVisemeCharacter(text, index);
    };
    utterance.onend = stopSpeakingAnimation;
    utterance.onerror = stopSpeakingAnimation;
    startSpeakingAnimation();
    window.setTimeout(() => {
        if (playbackGeneration === state.playbackGeneration && state.voiceEnabled) {
            window.speechSynthesis.speak(utterance);
        }
    }, 420);
}

function setBusy(value) {
    state.busy = value;
    ui.input.disabled = value;
    ui.send.disabled = value;
    ui.mic.disabled = value || (!state.recognition && !state.recorderSupported);
    updateStudioMode();
}

async function askGemini(message) {
    const cleanMessage = String(message || "").trim();
    if (!cleanMessage || state.busy || !isPanelActive()) return;

    stopAllSpeech();
    addMessage(cleanMessage, "user");
    ui.input.value = "";
    setBusy(true);
    setStatus("Thinking…");
    const thinking = addMessage("Thinking…", "bot", "ai-message-thinking");
    const requestController = new AbortController();
    state.chatAbortController = requestController;

    try {
        const API_URL = "https://test-rammeshgar-webpage.netlify.app/api/chat";

        const response = await fetch(API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: requestController.signal,
            body: JSON.stringify({
                message: cleanMessage,
                previousInteractionId: state.previousInteractionId,
                voice: state.voiceEnabled,
            }),
        });
        const data = await response.json().catch(() => ({}));
        if (state.disposed) return;
        if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);

        thinking.remove();
        addMessage(data.answer, "bot");
        state.previousInteractionId = data.interactionId || null;
        setStatus("Ready");

        if (state.voiceEnabled && ui.panel.classList.contains('is-open')) {
            const played = data.audioBase64
                ? await playGeneratedAudio(data.audioBase64, data.audioMimeType || "audio/mpeg", data.answer)
                : false;
            if (!played && ui.panel.classList.contains('is-open')) speak(data.answer);
        }
    } catch (error) {
        thinking.remove();
        if (state.disposed || requestController.signal.aborted) return;
        addMessage(error.message || "The AI could not answer.", "bot", "ai-message-error");
        setStatus("Connection error");
        console.error("AI request failed:", error);
    } finally {
        if (state.chatAbortController === requestController) state.chatAbortController = null;
        if (!state.disposed) setBusy(false);
        // Never reopen the mobile keyboard or jump the page when a reply arrives.
        if (ui.panel.classList.contains('is-open') && !matchMedia('(max-width: 760px), (pointer: coarse)').matches) {
            ui.input.focus({ preventScroll: true });
        }
    }
}

ui.form.addEventListener("submit", (event) => {
    event.preventDefault();
    askGemini(ui.input.value);
});

function setupSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    state.recorderSupported = Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
    if (!SpeechRecognition) {
        ui.mic.disabled = !state.recorderSupported;
        ui.mic.title = state.recorderSupported
            ? "Talk instead of typing"
            : "Voice input is unavailable in this browser";
        if (state.recorderSupported) {
            ui.mic.classList.add("is-voice-ready");
            ui.mic.setAttribute("aria-label", "Start voice input — talk instead of typing");
        }
        return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onstart = () => {
        if (!isPanelActive() || state.recognitionGeneration !== state.microphoneGeneration) {
            try { recognition.abort(); } catch (_) { /* already stopped */ }
            return;
        }
        state.listening = true;
        state.recognitionStarting = false;
        state.recognitionSubmitted = false;
        state.recognitionError = "";
        ui.mic.classList.add("is-listening");
        ui.mic.disabled = false;
        ui.mic.title = "Stop listening";
        ui.mic.setAttribute("aria-label", "Stop voice input");
        setStatus("Listening…");
        window.portfolioMusic?.pauseForVoice?.();
    };
    recognition.onaudiostart = () => { if (isPanelActive()) setStatus("Microphone active · listening…"); };
    recognition.onspeechstart = () => { if (isPanelActive()) setStatus("Speech detected · keep talking…"); };
    recognition.onresult = (event) => {
        if (!isPanelActive() || state.recognitionGeneration !== state.microphoneGeneration) return;
        let transcript = "";
        let hasFinalResult = false;
        for (let i = 0; i < event.results.length; i++) {
            transcript += event.results[i][0].transcript;
            hasFinalResult ||= event.results[i].isFinal;
        }
        ui.input.value = transcript.trim();
        if (hasFinalResult && !state.recognitionSubmitted && ui.input.value) {
            state.recognitionSubmitted = true;
            askGemini(ui.input.value);
        }
    };
    recognition.onerror = (event) => {
        if (!isPanelActive() || state.recognitionGeneration !== state.microphoneGeneration) return;
        const messages = {
            "not-allowed": "Microphone blocked · allow access in the address bar and retry",
            "service-not-allowed": "Voice recognition is blocked by this browser",
            "audio-capture": "No working microphone was found",
            "no-speech": "I didn’t hear anything · tap the mic and try again",
            network: "Browser voice service blocked · tap the mic again to use secure transcription",
            aborted: "Voice input stopped",
        };
        if (event.error === "network") state.forceRecorderFallback = true;
        state.recognitionError = messages[event.error] || `Voice input error: ${event.error}`;
        setStatus(state.recognitionError);
    };
    recognition.onend = () => {
        if (!isPanelActive() || state.recognitionGeneration !== state.microphoneGeneration) return;
        state.recognitionGeneration = null;
        state.listening = false;
        state.recognitionStarting = false;
        ui.mic.classList.remove("is-listening");
        ui.mic.disabled = state.busy;
        ui.mic.title = "Talk instead of typing";
        ui.mic.setAttribute("aria-label", "Start voice input — talk instead of typing");
        if (!state.busy && !state.recognitionError) setStatus("Ready");
        if (!state.busy) window.portfolioMusic?.resumeAfterVoice?.();
    };

    state.recognition = recognition;
    ui.mic.disabled = false;
    ui.mic.classList.add("is-voice-ready");
    ui.mic.title = "Talk instead of typing";
    ui.mic.setAttribute("aria-label", "Start voice input — talk instead of typing");
}

function stopRecognition(discard = false) {
    if (state.mediaRecorder?.state === "recording") {
        stopMediaRecorder(discard);
        return;
    }
    if (!state.recognition) return;
    try {
        if (discard) state.recognition.abort();
        else state.recognition.stop();
    } catch (_) { /* already stopped */ }
}

function cancelMicrophoneInput() {
    // Release captured tracks immediately, even if an asynchronous recorder
    // callback has not fired. Ignore pending permission results and transcripts.
    state.microphoneGeneration += 1;
    state.recognitionGeneration = null;
    state.recognitionSubmitted = true;
    state.recognitionStarting = false;
    state.listening = false;
    state.discardRecording = true;
    try { state.recognition?.abort(); } catch (_) { /* already stopped */ }
    const recorder = state.mediaRecorder;
    if (recorder) {
        recorder.onstop = recorder.ondataavailable = recorder.onerror = null;
        try { if (recorder.state !== 'inactive') recorder.stop(); } catch (_) { /* already stopped */ }
    }
    state.mediaRecorder = null;
    state.recordingStream?.getTracks().forEach(track => track.stop());
    state.recordingStream = null;
    state.recordingChunks = [];
    window.clearTimeout(state.recordingTimer);
    state.recordingTimer = null;
    stopRecordingMonitor();
    state.transcriptionAbortController?.abort();
    ui.mic.classList.remove('is-listening');
    ui.mic.disabled = state.busy || (!state.recognition && !state.recorderSupported);
    ui.mic.title = 'Talk instead of typing';
    ui.mic.setAttribute('aria-label', 'Start voice input — talk instead of typing');
}

async function requestMicrophoneAccess() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Microphone capture is unavailable");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
}

function preferredRecordingMimeType() {
    return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]
        .find((type) => MediaRecorder.isTypeSupported?.(type)) || "";
}

function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error || new Error("Could not read recording"));
        reader.onloadend = () => resolve(String(reader.result || "").split(",")[1] || "");
        reader.readAsDataURL(blob);
    });
}

async function finishRecordedQuestion(blob, microphoneGeneration) {
    stopRecordingMonitor();
    state.mediaRecorder = null;
    state.recordingStream?.getTracks().forEach((track) => track.stop());
    state.recordingStream = null;
    state.recordingChunks = [];
    ui.mic.classList.remove("is-listening");
    ui.mic.title = "Talk instead of typing";
    ui.mic.setAttribute("aria-label", "Start voice input — talk instead of typing");
    window.portfolioMusic?.resumeAfterVoice?.();

    if (state.discardRecording || !isPanelActive() || microphoneGeneration !== state.microphoneGeneration) {
        state.discardRecording = false;
        if (!state.busy) setStatus("Ready");
        ui.mic.disabled = state.busy;
        return;
    }

    if (!blob.size || (state.recordingAnalyser && !state.recordingSpeechDetected)) {
        state.recognitionError = "I didn’t hear anything · tap the mic and try again";
        setStatus(state.recognitionError);
        ui.mic.disabled = false;
        return;
    }

    setBusy(true);
    setStatus("Transcribing your question…");
    const requestController = new AbortController();
    state.transcriptionAbortController = requestController;
    try {
        const audioBase64 = await blobToBase64(blob);
        if (!isPanelActive() || microphoneGeneration !== state.microphoneGeneration || requestController.signal.aborted) return;
        const response = await fetch(TRANSCRIBE_API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: requestController.signal,
            body: JSON.stringify({
                audioBase64,
                mimeType: blob.type || "audio/webm",
            }),
        });
        const data = await response.json().catch(() => ({}));
        if (!isPanelActive() || microphoneGeneration !== state.microphoneGeneration || requestController.signal.aborted) return;
        if (!response.ok) throw new Error(data.error || `Transcription failed (${response.status})`);
        const transcript = String(data.transcript || "").trim();
        if (!transcript) throw new Error("No speech was detected");
        ui.input.value = transcript;
        setBusy(false);
        await askGemini(transcript);
    } catch (error) {
        setBusy(false);
        if (!isPanelActive() || microphoneGeneration !== state.microphoneGeneration || requestController.signal.aborted) return;
        state.recognitionError = error.message || "Couldn’t transcribe the recording";
        setStatus(state.recognitionError);
    } finally {
        if (state.transcriptionAbortController === requestController) state.transcriptionAbortController = null;
        if (!state.disposed && requestController.signal.aborted) setBusy(false);
    }
}

function stopMediaRecorder(discard = false) {
    const recorder = state.mediaRecorder;
    if (!recorder || recorder.state !== "recording") return;
    state.discardRecording = discard;
    window.clearTimeout(state.recordingTimer);
    state.recordingTimer = null;
    recorder.stop();
}

function stopRecordingMonitor() {
    if (state.recordingMonitorFrame) cancelAnimationFrame(state.recordingMonitorFrame);
    state.recordingMonitorFrame = null;
    state.recordingAnalyser = null;
    state.recordingAudioContext?.close().catch(() => {});
    state.recordingAudioContext = null;
    state.recordingSpeechDetected = false;
    state.recordingSilenceStartedAt = 0;
}

function startRecordingMonitor(stream) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    try {
        const context = new AudioContextClass();
        const analyser = context.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.72;
        context.createMediaStreamSource(stream).connect(analyser);
        const samples = new Uint8Array(analyser.fftSize);
        state.recordingAudioContext = context;
        state.recordingAnalyser = analyser;
        state.recordingSpeechDetected = false;
        state.recordingSilenceStartedAt = 0;

        const monitor = () => {
            if (state.mediaRecorder?.state !== "recording" || state.recordingAnalyser !== analyser) return;
            analyser.getByteTimeDomainData(samples);
            let energy = 0;
            for (const sample of samples) {
                const centered = (sample - 128) / 128;
                energy += centered * centered;
            }
            const rms = Math.sqrt(energy / samples.length);
            const now = performance.now();
            if (rms > 0.028) {
                if (!state.recordingSpeechDetected) {
                    setStatus("Speech detected · listening until you finish…");
                }
                state.recordingSpeechDetected = true;
                state.recordingSilenceStartedAt = 0;
            } else if (state.recordingSpeechDetected) {
                state.recordingSilenceStartedAt ||= now;
                if (now - state.recordingSilenceStartedAt > 1600) {
                    stopMediaRecorder(false);
                    return;
                }
            }
            state.recordingMonitorFrame = requestAnimationFrame(monitor);
        };
        state.recordingMonitorFrame = requestAnimationFrame(monitor);
    } catch (error) {
        console.warn("Automatic voice-stop monitoring is unavailable.", error);
    }
}

async function startMediaRecorder() {
    const microphoneGeneration = ++state.microphoneGeneration;
    state.recognitionStarting = true;
    state.recognitionError = "";
    state.discardRecording = false;
    ui.mic.disabled = true;
    setStatus("Checking microphone access…");
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
            },
        });
        if (!isPanelActive() || microphoneGeneration !== state.microphoneGeneration) {
            stream.getTracks().forEach(track => track.stop());
            return;
        }
        const mimeType = preferredRecordingMimeType();
        const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        state.recordingStream = stream;
        state.recordingChunks = [];
        state.mediaRecorder = recorder;
        recorder.ondataavailable = (event) => {
            if (event.data?.size) state.recordingChunks.push(event.data);
        };
        recorder.onerror = () => {
            state.recognitionError = "The microphone recording failed · please retry";
            setStatus(state.recognitionError);
        };
        recorder.onstop = () => {
            const blob = new Blob(state.recordingChunks, { type: recorder.mimeType || "audio/webm" });
            finishRecordedQuestion(blob, microphoneGeneration);
        };
        recorder.start(250);
        startRecordingMonitor(stream);
        state.recognitionStarting = false;
        ui.mic.disabled = false;
        ui.mic.classList.add("is-listening");
        ui.mic.title = "Stop and send recording";
        ui.mic.setAttribute("aria-label", "Stop recording and send voice question");
        setStatus("Listening… speak your question");
        window.portfolioMusic?.pauseForVoice?.();
        state.recordingTimer = window.setTimeout(() => stopMediaRecorder(false), 15000);
    } catch (error) {
        if (!isPanelActive() || microphoneGeneration !== state.microphoneGeneration) return;
        state.recognitionStarting = false;
        state.recordingStream?.getTracks().forEach((track) => track.stop());
        state.recordingStream = null;
        ui.mic.disabled = false;
        const blocked = error?.name === "NotAllowedError" || error?.name === "SecurityError";
        state.recognitionError = blocked
            ? "Microphone blocked · allow access in the address bar and retry"
            : error?.name === "NotFoundError"
                ? "No working microphone was found"
                : "Couldn’t start microphone recording · please retry";
        setStatus(state.recognitionError);
    }
}

ui.mic.addEventListener("click", async () => {
    if (!isPanelActive() || state.busy || state.recognitionStarting) return;
    if (state.mediaRecorder?.state === "recording") {
        stopMediaRecorder(false);
        return;
    }
    if (ui.mic.classList.contains("is-listening")) {
        stopRecognition();
        return;
    }
    stopAllSpeech();
    const useRecorder = state.forceRecorderFallback || !state.recognition || Boolean(navigator.brave);
    if (useRecorder && state.recorderSupported) {
        await startMediaRecorder();
        return;
    }
    if (!state.recognition) {
        state.recognitionError = "Voice input is unavailable in this browser";
        setStatus(state.recognitionError);
        return;
    }
    state.recognitionStarting = true;
    const microphoneGeneration = ++state.microphoneGeneration;
    state.recognitionGeneration = microphoneGeneration;
    state.recognitionSubmitted = false;
    state.recognitionError = "";
    ui.mic.disabled = true;
    setStatus("Checking microphone access…");
    try {
        await requestMicrophoneAccess();
        if (!isPanelActive() || microphoneGeneration !== state.microphoneGeneration) return;
        state.recognition.start();
    } catch (error) {
        if (!isPanelActive() || microphoneGeneration !== state.microphoneGeneration) return;
        state.recognitionStarting = false;
        ui.mic.disabled = false;
        const blocked = error?.name === "NotAllowedError" || error?.name === "SecurityError";
        state.recognitionError = blocked
            ? "Microphone blocked · allow access in the address bar and retry"
            : error?.name === "NotFoundError"
                ? "No working microphone was found"
                : "Couldn’t start voice input · please retry or type your question";
        setStatus(state.recognitionError);
    }
});

setupSpeechRecognition();
window.speechSynthesis?.getVoices();

if (embeddedAssistant) {
    // The iframe itself is created only after the user's launch action. Give
    // the host an explicit ready acknowledgement once the real panel is open;
    // loading the 3D model doesn't prevent immediate access to text.
    openPanel();
    requestAnimationFrame(() => {
        if (isPanelActive()) notifyHost('twin-ready');
    });
}
