<h1 align="center">
  YouTube Ad-Free
</h1>
<p align="center">
  <img src="https://img.shields.io/github/stars/webosbrew/youtube-webos?style=flat-square&logo=github" alt="GitHub Stars">
  <img src="https://img.shields.io/github/v/release/webosbrew/youtube-webos?style=flat-square" alt="Latest Release">
  <img src="https://img.shields.io/github/contributors/webosbrew/youtube-webos?style=flat-square" alt="Contributors">
  <img src="https://img.shields.io/github/downloads/webosbrew/youtube-webos/total?style=flat-square" alt="Total Downloads">
  <img src="https://img.shields.io/badge/LG-webOS-000000?logo=webos&logoColor=white&style=flat-square" alt="webOS">
</p>

<p align="center">
  YouTube app for webOS TV with ad blocking and other enhancements
</p>

![Configuration Screen](./screenshots/1_sm.jpg?raw=true)
![Segment Skipped](./screenshots/2_sm.jpg?raw=true)

---

## Features

- Ad Blocking
- [SponsorBlock](https://sponsor.ajay.app/) Integration (segments shown on the progress bar)
- [Autostart Support](#autostart)
- Always Highest Video Quality (set before playback, no mid-start switch)
- Automatic recovery when a video hangs on a black loading screen
- Audio-Only Mode (🟦 Blue button on remote)
- Full Animation Support
- Shorts Removal (all feeds)
- HD Thumbnails (1280×720 instead of 320×180)
- On-Screen Clock Overlay
- YouTube Logo Removal
- Remove end screens
- Bypass account selector screen

> [!NOTE]
> All options live in **YouTube's own Settings page**, in the
> **YouTube AdFree** category at the top (SponsorBlock categories and
> _Reset/About_ are at the bottom). No colour button needed – which matters on
> the 2025+ Magic Remote, which has none. The 🟩 **Green** button still opens a
> quick panel with the same options, handy during playback.

### What this fork changes

| Area                 | Change                                                                                                                                                                                                                                                    |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Settings             | Native categories inside YouTube's Settings page (real On/Off toggles), plus a rewritten quick panel without the 1.7k-line spatial-navigation polyfill. Swedish/English UI.                                                                               |
| Settings reset       | Settings are mirrored to IndexedDB and `localStorage.clear()`/`removeItem()` can no longer delete them. YouTube TV wipes its storage in some flows (its storage service calls `localStorage.clear()`), which is what reset the old settings.              |
| Black loading screen | A playback watchdog detects a video stuck in BUFFERING with nothing loaded and escalates: re-show the video surface → play → seek in place → reopen the video.                                                                                            |
| Max quality          | Writes YouTube's own `yt-player-quality` preference before playback instead of forcing a quality switch right after start (a known trigger of the webOS 25 black screen).                                                                                 |
| Thumbnails           | Upgrades every tile type (the current UI uses `<image>`, which upstream missed) by hooking the style/preload assignment – no page-wide MutationObserver, no double loading. Falls back to `sddefault` and then the original when a video has no HD frame. |
| SponsorBlock         | Segments are drawn as a CSS gradient on the bar: YouTube's incremental DOM recycled upstream's overlay `<div>`, so segments never showed. Skip categories apply immediately.                                                                              |
| Shorts               | Also removes the newer `lockupViewModel` Shorts tiles.                                                                                                                                                                                                    |
| Performance          | One `JSON.parse` hook instead of three, no deep clone on every `JSON.stringify`, modern build for webOS 22+ (userScript 272 KB → 85 KB). `pnpm run build:legacy` still targets webOS 1–21.                                                                |

---

## Requirements

- Uninstall the official YouTube app before installing this one.

---

## Installation

You can install the app using one of the following methods:

- **[webOS Homebrew Channel](https://github.com/webosbrew/webos-homebrew-channel):**
  add this fork's repository in _Settings → Add repository_:
  `https://raw.githubusercontent.com/Zucchiniii/youtube-webos/main/homebrew-repository.json`
  (upstream's version is in the default webOS Brew repository).
- **[Device Manager](https://github.com/webosbrew/dev-manager-desktop):**
  Use a pre-built `.ipk` file from the [Releases](https://github.com/Zucchiniii/youtube-webos/releases) page.
- **Command Line (webOS CLI):** Configure the tools [below](#development-setup)

The app id is the same as upstream (`youtube.leanback.v4`), so installing over
it keeps your YouTube sign-in and settings.

---

## Autostart

To enable autostart, run the following command needs to be executed on the TV via **SSH** or **Telnet**:

```sh
luna-send-pub -n 1 'luna://com.webos.service.eim/addDevice' '{"appId":"youtube.leanback.v4","pigImage":"","mvpdIcon":""}'
```

This allows the app to show up as an input source and launch automatically if it was the last used app. It will remain active in the background for faster startup (minor increase in idle memory usage).

To disable autostart:

```sh
luna-send-pub -n 1 'luna://com.webos.service.eim/deleteDevice' '{"appId":"youtube.leanback.v4"}'
```

---

## Development Setup

### Pre-requisites

- The latest **Node.js** LTS release. Refer to `devEngines` in [`package.json`](package.json) for the minimum version.
- **pnpm**. If you already have `Node.js`, you can have it automatically setup by running `corepack enable`.
- **git**

### Setup

1. Clone the repository.

   ```sh
   git clone https://github.com/webosbrew/youtube-webos.git
   cd youtube-webos
   ```

2. Install dependencies.

   ```sh
   pnpm install
   ```

### Building an IPK

```sh
pnpm run build:dev
pnpm run package
```

The `.ipk` file will be generated in the project root directory. You can stop here if you're fine with installing the IPK via [the webOS Dev Manager app](https://github.com/webosbrew/dev-manager-desktop). Alternatively, continue below if you want to make it so you can install the IPK on your TV with one command.

### On the TV

> [!IMPORTANT]
> If your TV is rooted, follow [the alternative setup section](#alternate-setup-rooted-tv) instead and then skip to [installing to the TV](#installing-to-the-tv)

1. Create an [LG Developer account](https://webostv.developer.lge.com/login)
2. Install the [**Developer Mode** app](https://in.lgappstv.com/main/tvapp/detail?appId=232503) from the LG Content Store
3. Navigate to the app, Log-in in with LG Developer Credentials and enable:
   - Developer Mode
   - Key Server

### Add the TV to the CLI

```sh
pnpm exec ares-setup-device
```

Follow the prompts:

1. Add device
2. Enter IP from the Developer Mode app
3. Use default values unless needed
4. Enter 6-digit passphrase shown on the TV screen

Verify:

```sh
pnpm exec ares-setup-device --list
```

Sample output:

```log
name            deviceinfo                     connection  profile    passphrase
--------------  -----------------------------  ----------  -------    ----------
mytv (default)  prisoner@192.168.137.102:9922  ssh         tv         EF32E8
```

---

## Installing to the TV

```sh
pnpm run deploy # Installs to the default device selected via `ares-setup-device`.
```

## Debugging

webOS supports the standard Chrome Devtools Protocol which allows you to inspect the app.

```sh
ares-inspect -d <device_name> --app youtube.leanback.v4
```

Or if you've set your TV as the default device:

```sh
pnpm run inspect
```

---

## Alternate Setup (Rooted TV)

1. Enable SSH via Homebrew Channel
2. Generate SSH key:

   ```sh
   ssh-keygen -t rsa
   ```

3. Copy `id_rsa` to `~/.ssh` (Windows: `%USERPROFILE%\.ssh`)
4. Append `id_rsa.pub` to `/home/root/.ssh/authorized_keys` on the TV
5. Set up device:

   ```sh
   ares-setup-device -a webos \
     -i "username=root" \
     -i "privatekey=id_rsa" \
     -i "passphrase=SSH_KEY_PASSPHRASE" \
     -i "host=TV_IP" \
     -i "port=22"
   ```

---

## Quick Commands

### Build, Install, and Launch

```sh
pnpm run build:dev && pnpm run package && pnpm run deploy && pnpm run launch
```

To launch a specific video directly:

```sh
pnpm run launch -- -p '{"contentTarget":"v=F8PGWLvn1mQ"}'
```
