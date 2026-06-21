# Bilibili Subtitle Vocabulary Assistant

A Chrome and Edge extension for collecting, understanding, and reviewing English vocabulary from Bilibili's generated English subtitles.

The project is designed around a complete learning loop:

1. Encounter a word while watching a video.
2. Read its Chinese definition and pronunciation.
3. Save the word together with its original subtitle context.
4. Practice spelling from a contextual cloze sentence.
5. Review it again at the time scheduled by FSRS.

## Features

### Subtitle capture

- Captures subtitle tracks and JSON responses requested by Bilibili's web player.
- Supplements captured data with Bilibili player APIs.
- Matches the active subtitle against the video's current playback time.
- Works in Bilibili fullscreen mode.

### Vocabulary lookup

- Press `Space` to pause the video, then press `V` within three seconds.
- Click any English word in the subtitle panel.
- View its lemma, phonetic transcription, part of speech, Chinese definition, and original subtitle context.
- Play English pronunciation using the browser's speech synthesis.
- Save multiple video contexts under the same lemma.

### Local dictionary

- Includes an 80,000-entry core dictionary generated from [ECDICT](https://github.com/skywind3000/ECDICT).
- Includes more than 45,000 inflected-form mappings, such as:
  - `running` to `run`
  - `went` to `go`
  - `better` to `good`
- Dictionary files are split by initial letter and loaded on demand.
- Chrome's local Translator API is used as a fallback when available.

### Review system

- Uses [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) for spaced-repetition scheduling.
- Stores cards, contexts, review logs, and settings in IndexedDB.
- Automatically migrates cards from older `chrome.storage.local` versions.
- Introduces up to 30 recommended new words per day by default.
- Dynamically reduces the recommendation when review backlog or recent error rate is high.
- Does not impose a hard daily study limit.
- Allows another 10 new words or all remaining new words after the default session.

### Contextual spelling

- New cards first show their meaning and original subtitle context.
- Review cards hide the original word inside the subtitle.
- Answers must match the subtitle's original word form; case is ignored.
- Letter-by-letter hints are available.
- Incorrect answers reappear later in the same session.
- Multiple saved contexts rotate between reviews.

Automatic FSRS ratings:

| Result | Rating |
| --- | --- |
| Incorrect, skipped, or revealed | Again |
| Correct after using a hint | Hard |
| Correct without a hint | Good |
| Stable card answered correctly within four seconds | Easy |

## Installation

### Load the current development build

1. Download or clone this repository.
2. Open `chrome://extensions` or `edge://extensions`.
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Choose the repository's `dist` directory.
6. Open a Bilibili video and enable its generated English subtitle.

After updating the repository, click **Reload** on the extension card and refresh any already-open Bilibili tabs.

## Usage

### Collect a word

1. Play a Bilibili video with generated English subtitles enabled.
2. Press `Space` to pause.
3. Press `V` within three seconds.
4. Select a word from the subtitle panel.
5. Review its definition and click **Save**.

### Start a review

1. Open the extension popup.
2. Check today's due reviews and recommended new words.
3. Click **Start review**.
4. Complete the contextual spelling session.

## Repository Layout

```text
dist/                 Directly loadable browser extension
  assets/             Background, content, popup, and review scripts/styles
  dictionary/         Generated ECDICT dictionary shards
  licenses/           Third-party license notices
  vendor/             Vendored browser build of ts-fsrs
scripts/
  build_ecdict.py     Builds compact dictionary shards from ECDICT CSV
  validate.mjs        Validates extension files and manifest references
  package.ps1         Creates the release ZIP
```

The `dist` directory is intentionally committed so a cloned repository can be loaded into Chrome or Edge immediately.

## Development

Requirements:

- Node.js 20 or newer
- Python 3, only when rebuilding the dictionary
- PowerShell, only when creating the ZIP package on Windows

Validate the extension:

```bash
npm run validate
```

Create `bilibili-vocab-assistant.zip`:

```powershell
npm run package
```

### Rebuild the dictionary

Download `ecdict.csv` from the official ECDICT repository, then run:

```bash
python scripts/build_ecdict.py path/to/ecdict.csv dist/dictionary --limit 80000
```

The original ECDICT CSV is a build input and must not be committed.

## Updating GitHub

Future updates are straightforward:

```bash
git pull --rebase
git add .
git commit -m "Describe the update"
git push
```

Recommended version workflow:

1. Update `version` in `dist/manifest.json`.
2. Update `version` in `package.json`.
3. Run `npm run validate`.
4. Test the unpacked extension locally.
5. Commit and push the changes.
6. Run `npm run package` and attach the ZIP to a GitHub Release.

Release ZIP files and local caches are excluded from Git history.

## Data and Privacy

- Vocabulary and review data are stored locally in the browser's IndexedDB.
- Subtitle text is processed locally by the extension.
- The extension does not require an account or a custom backend.
- Bilibili API requests are used only to locate subtitle tracks already associated with the current video.

## Third-Party Projects

- [ECDICT](https://github.com/skywind3000/ECDICT), MIT License
- [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs), MIT License

The corresponding license texts are included in `dist/licenses`.

## License

This project is licensed under the [MIT License](LICENSE).
