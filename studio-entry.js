/* Direct assistant entry, portfolio embed and legacy case-study anchors. */
(() => {
    'use strict';
    const root = document.documentElement;
    const framed = window.parent !== window;
    const requestedEmbed = new URLSearchParams(location.search).get('embed') === 'assistant';

    // Embed mode is only meaningful inside the same-origin portfolio. The
    // parent mounts the frame after a visitor requests the assistant.
    let embedded = false;
    if (framed && requestedEmbed && location.origin !== 'null') {
        try { embedded = window.parent.location.origin === location.origin; } catch { /* Cross-origin parent. */ }
    }
    if (embedded) root.dataset.twinEmbed = 'assistant';
    if (framed) return; // The parent owns page analytics; never double-count its assistant.

    // Preserve earlier public deep-links while keeping technical detail in the
    // single canonical portfolio case study. Old standalone guide/map URLs
    // remain available and their Back links resolve through this mapping.
    const legacyAnchors = new Map([
        ['#inside', '#inside'],
        ['#case-study', '#main'],
        ['#inside-heading', '#inside'],
        ['#panel-map', '#panel-map'],
        ['#map', '#map'],
        ['#system-map', '#system-map'],
        ['#panel-guide', '#panel-guide'],
        ['#guide', '#guide'],
        ['#animated-guide', '#animated-guide'],
        ['#architecture', '#inside'],
        ['#evidence', '#design'],
        ['#art-direction', '#design'],
        ['#integration-notes', '#design'],
        ['#contribution-heading', '#design'],
        ['#evidence-heading', '#design'],
        ['#limits-heading', '#limits'],
        ['#design', '#design'],
        ['#limits', '#limits'],
    ]);
    function forwardLegacyAnchor() {
        const target = legacyAnchors.get(location.hash);
        if (!target) return false;
        location.replace('/digital-twin/' + target);
        return true;
    }
    if (forwardLegacyAnchor()) return;
    window.addEventListener('hashchange', forwardLegacyAnchor);

    document.addEventListener('DOMContentLoaded', () => {
        if (legacyAnchors.has(location.hash)) return;
        const analytics = document.createElement('script');
        analytics.src = '/assets/portfolio-analytics.js?v=20261107';
        analytics.async = true;
        document.head.appendChild(analytics);
    }, { once: true });
})();
