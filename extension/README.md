# RemoteCtrl Chrome Extension

A Manifest V3 Chrome Extension that brings RemoteCtrl directly into your everyday browser.

## Features

- **Automate This Page**: One-click delegation of your active tab, authenticated session, or internal site to RemoteCtrl Desktop AI.
- **Workflow Recorder**: Record browser interactions (`click`, `input`, `navigate`) cleanly with automatic password masking (`[MASKED]`) and sync them instantly to your `~/.config/RemoteCtrl/workflows.json`.
- **Local Desktop Bridge**: Connects over WebSocket (`ws://127.0.0.1:45456`) to the running RemoteCtrl desktop application.

## How to Load in Chrome

1. Open Google Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode** (top right toggle).
3. Click **Load unpacked** (top left button).
4. Select this directory (`/Users/ganesh/dev/remcon/extension`).
5. Pin **RemoteCtrl — Automate & Record** to your Chrome toolbar and click the icon on any page to open the Side Panel!
