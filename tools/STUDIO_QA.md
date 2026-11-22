# Studio v2 browser QA

The test is isolated from the production services. It runs the actual HTML, CSS, local Three.js distribution, character GLB and authored movement data in Chrome; it intercepts network requests in the test browser. Chat requests receive a deterministic local fixture response or a deliberately simulated 503. No conversation is submitted to the live AI provider, analytics is inactive, and real microphone access and transcription calls are blocked.

## Run

From the repository root with Playwright installed:

```sh
node tools/studio-v2-check.mjs
```

The test first resolves Playwright from the repository, then the existing local QA tooling. `PLAYWRIGHT_MODULE` and `CHROME_PATH` can override these locations. A compatible locally installed Three.js package can be passed via `THREE_VENDOR_ROOT` for diagnosis, but the vendored pinned distribution is preferred. Artifacts default to a unique OS temporary directory; set `STUDIO_SHOT_DIR` to keep them elsewhere.

- `STUDIO_CASES=1280,390` selects matching scenarios.
- `STUDIO_LAYOUT_ONLY=1` skips mock chat/failure and camera-interaction tests for a fast geometry regression after typography/layout edits.
- `STUDIO_RENDER_ASSETS=1` additionally captures an actual desktop studio view and portrait (with only test-page HTML overlays temporarily hidden).

## Coverage

| Viewport | Theme | Motion |
| --- | --- | --- |
| 1920 × 1080 | Light | Standard |
| 1280 × 720 | Dark | Standard |
| 390 × 844 | Light | Standard |
| 320 × 667 | Dark | Reduced |

Across these sizes verify:

- No horizontal overflow, correctly initialized theme, visible first-screen launch, no initial WebGL loading request.
- Opening via keyboard starts the actual model. The stage and conversation composer fit together; all three prompt chips remain readable.
- Escape closes the panel and returns focus to its launch button; desktop keyboard reopen reuses the renderer.
- Reduced-motion preference reaches the renderer. Manual orbit, camera reset and portrait mode respond to user input.
- Interface sounds start disabled; explicit enable and disable are respected. Voice output can be muted independently.
- Suggested questions submit their intended text; a simulated service error leaves the composer enabled; the next question succeeds with the prior interaction ID. Theme switches preserve conversation history and the loaded renderer.
- Forced GLB load failure and forced WebGL unavailability leave the text chat operational and provide readable fallback state.
- No unexpected JavaScript errors or missing local assets.

The report and screenshots represent a deterministic isolated browser session. They are **not evidence of production provider availability, microphone quality, speech recognition accuracy, or spoken-response lip-sync quality**. Those require a separate, intentional live check with appropriate browser permissions. CPU software rendering also does not represent device GPU performance.
