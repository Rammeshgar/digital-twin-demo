// Optional studio interface cues. Nothing plays until the visitor enables them.
// These cues are separate from speech output and never use an external service.
const toggle = document.getElementById('studio-sound-toggle');
const panel = document.getElementById('ai-mascot-panel');
const AudioContextClass = window.AudioContext || window.webkitAudioContext;
let context;
let enabled = false;
let lastCueAt = 0;
let disposed = false;

function reflectPreference() {
    if (!toggle) return;
    const label = enabled ? 'Disable interface sounds' : 'Enable interface sounds';
    toggle.setAttribute('aria-pressed', String(enabled));
    toggle.setAttribute('aria-label', 'Interface sounds');
    toggle.title = label;
    toggle.dataset.soundEnabled = String(enabled);
    const visibleLabel = toggle.querySelector('[data-sound-label], .studio-action-label');
    if (visibleLabel) visibleLabel.textContent = enabled ? 'Sounds on' : 'Sounds off';
}

async function prepareAudio() {
    if (!AudioContextClass || disposed) return false;
    try {
        context ??= new AudioContextClass();
        if (context.state === 'suspended') await context.resume();
        return !disposed && context?.state === 'running';
    } catch {
        return false;
    }
}

function cue(kind = 'select') {
    if (disposed || !enabled || context?.state !== 'running') return;
    // A cue must not be recorded with a voice question or overlap the twin's reply.
    const state = panel?.dataset.studioState || '';
    if (['listening', 'speaking', 'thinking', 'recording'].includes(state) ||
        document.getElementById('ai-mic-btn')?.classList.contains('is-listening')) return;
    const now = context.currentTime;
    if (now - lastCueAt < 0.12 && lastCueAt !== 0) return;
    lastCueAt = now;
    const notes = kind === 'enable' ? [440, 587.33] : [392];
    notes.forEach((frequency, i) => {
        const oscillator = context.createOscillator();
        const envelope = context.createGain();
        const start = now + i * 0.09;
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        envelope.gain.setValueAtTime(0.0001, start);
        envelope.gain.exponentialRampToValueAtTime(0.028, start + 0.018);
        envelope.gain.exponentialRampToValueAtTime(0.0001, start + 0.14);
        oscillator.connect(envelope).connect(context.destination);
        oscillator.start(start);
        oscillator.stop(start + 0.15);
        oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); };
    });
}

if (toggle) {
    reflectPreference();
    if (!AudioContextClass) {
        toggle.disabled = true;
        toggle.title = 'Interface sounds are unavailable in this browser';
        toggle.setAttribute('aria-label', toggle.title);
    }
    toggle.addEventListener('click', async () => {
        if (disposed) return;
        if (enabled) {
            enabled = false;
            reflectPreference();
            return;
        }
        enabled = await prepareAudio();
        reflectPreference();
        if (enabled) cue('enable');
    });

    // Capture only deliberate studio control activations; never hover, typing, or mic.
    document.addEventListener('click', (event) => {
        if (!event.isTrusted) return;
        const button = event.target instanceof Element && event.target.closest('button');
        if (!button || button.disabled || !button.matches('#ai-mascot-toggle, #ai-mascot-expand, #ai-mascot-close, #ai-mascot-voice-toggle, [data-studio-camera]')) return;
        cue();
    }, { capture: true });
}

document.addEventListener('twin-dispose', () => {
    disposed = true;
    enabled = false;
    reflectPreference();
    context?.close().catch(() => {});
    context = null;
}, { once: true });
