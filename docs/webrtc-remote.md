# WebRTC Remote Control & Streaming

RemoteCtrl supports a low-latency remote-control mode allowing a **Controller** peer to view and interact with the browser of a **Host** peer in real-time.

---

## 1. Peer Connections & Signaling

WebRTC coordination is managed by `src/main/webrtc-manager.ts` and `src/renderer/hooks/useWebRTC.ts`.

```
[Host App] <─── Socket.io (PIN) ───> [Signaling Server] <─── Socket.io (PIN) ───> [Controller App]
    │                                                                                  │
    └───────────────────────────── Peer-to-Peer WebRTC ────────────────────────────────┘
```

1.  **Signaling Channel**: Peers exchange SDP offers/answers and ICE candidates via a Socket.io WebSocket server (`src/main/signaling-client.ts`).
2.  **PIN Verification**: To establish a session, the Host generates a random connection PIN. The Controller enters this PIN to authenticate the signaling link.
3.  **Roles**:
    *   **Host**: Owns the persistent Playwright browser context, captures screencast feeds, and executes actions.
    *   **Controller**: Receives screencast feeds and broadcasts user interactions.

---

## 2. CDP Screencast Capture (`screencast.ts`)

Instead of standard, CPU-heavy operating-system screen captures, RemoteCtrl streams browser frames directly using the Chrome DevTools Protocol (CDP):
*   **CDP Session**: The main process establishes a CDP session with the target page via Playwright.
*   **Frame Capture**: It triggers `Page.startScreencast` with configurations (format: JPEG, quality: 80, scale: 1).
*   **Packet Dispatch**: When the browser emits a `screencastFrame` event, the main process extracts the base64-encoded frame buffer, attaches metadata, and sends it to the Controller over the WebRTC RTCDataChannel or Electron IPC.
*   **Settle States**: Frame capturing suspends automatically when the browser tab is idle to conserve network bandwidth.

---

## 3. Remote Input Synchronization

When a Controller interacts with the video viewport in `src/renderer/screens/BrowserPanel.tsx`, the inputs are translated and injected into the Host browser.

### Coordinate Mapping
Browser viewports can vary in size. To guarantee clicks land on the correct element:
1.  The Controller captures the click offset relative to the rendering canvas.
2.  It converts the offsets to percentage coordinates: `xPercent` and `yPercent` (between `0` and `100`).
3.  The coordinates are packed into a `RemoteMousePayload` and dispatched over the RTCDataChannel.

### Event Injection (`browser-manager.ts`)
Upon receiving input payloads in `src/main/browser-manager.ts`, the Host maps the percentage values back to the actual active viewport dimensions:
```typescript
const x = Math.round((payload.xPercent / 100) * viewportWidth);
const y = Math.round((payload.yPercent / 100) * viewportHeight);
```
The Host then invokes native Playwright keyboard/mouse methods to inject the interaction:
*   Mouse movements: `page.mouse.move(x, y)`
*   Clicks: `page.mouse.click(x, y, { button: payload.button })`
*   Scrolls: `page.mouse.wheel(0, payload.deltaY)`
*   Keystrokes: `page.keyboard.down(payload.key)` / `page.keyboard.up(payload.key)`
