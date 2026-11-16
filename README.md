# PDF Reader & Intelligent Audiobook Narrator

Turn PDFs and scanned book pages into natural, human-sounding audiobooks — with a
synced reader view that highlights the sentence being read.

It is built for multilingual literature: **Bengali**, **Arabic** and **English**
(including Quran and Hadith citations), and it can narrate in a **voice you clone**
from a short audio sample.

> Runs on your own machine. Your books, notes, API keys and audio stay on your computer
> unless you choose to connect a cloud service (Google Drive, Google Colab, or an LLM API).

---

## ✨ Features

- **Reads both kinds of PDF** — native digital PDFs and scanned / photographed pages.
- **Side-by-side reader** — the PDF page on one side, clean readable text on the other.
- **Synced narration** — the current sentence is highlighted while audio plays.
- **Smart text cleanup** — an LLM removes headers, footers, page numbers, footnotes and
  publisher boilerplate so the narration sounds natural.
- **Bijoy / SutonnyMJ auto-decoding** — old Bengali PDFs are converted to proper Unicode
  automatically.
- **Resumable, page-by-page processing** — every stage is cached in SQLite. Stop, close or
  crash the app at any time and it picks up exactly where it left off.
- **Multi-project library** — each PDF is its own project with its own progress and cache.
- **Voice cloning** — narrate with a voice cloned from a 10–30 second sample.
- **Optional GPU narration on Google Colab** — for long books, offload audio generation to a
  free or paid Colab GPU.
- **Optional Google Drive backup** — keep generated audio safe in your own Drive.

---

## 🧭 How it works

Each page moves through four stages. Every result is saved, so nothing is ever processed twice.

```
PDF page ──► 1. Render / OCR ──► 2. Refine script (LLM) ──► 3. Synthesize audio ──► 4. Timing marks
              (text extraction)                                (TTS voice)              (sentence sync)
```

Stages run in parallel "lanes", so a slow LLM call never blocks text extraction for the next page.

---

## 📋 Requirements

| Item | Needed for | Notes |
| :--- | :--- | :--- |
| **Node.js 20.19+** (22 LTS recommended) and npm | Everything | Check with `node -v` |
| **Git** | Cloning | |
| **ffmpeg** | MP3 export, voice-sample conversion | `brew install ffmpeg` |
| **Tesseract** | Local OCR for scanned pages | `brew install tesseract` (optional) |
| **Python 3.10+** | Local voice cloning, local speech-to-text | Only if you run voice models on your Mac |
| **An LLM API key** | Script refining and vision OCR fallback | OpenAI, Gemini, OpenRouter, or any OpenAI-compatible server |
| **macOS** | Apple Vision OCR (`macos_ocr`) | Optional. Other platforms use Tesseract and LLM OCR |

Recommended hardware: 8 GB RAM or more. Large voice models run better with a Colab GPU
(see below).

---

## 🚀 Quick start

These steps get the reader running in about five minutes. You can add the optional
services later.

**1. Clone the project**

```bash
git clone https://github.com/<your-username>/pdf-reader.git
```

```bash
cd pdf-reader
```

**2. Install dependencies**

```bash
npm install
```

**3. Create your private config file**

```bash
cp .env.example .env
```

You can leave the values in `.env` as they are for now. You only need to fill them in if you
turn on Google Drive or the Antigravity bridge (see below).

**4. Build the interface**

```bash
npm run build:frontend
```

**5. Start the app**

```bash
npm run dev
```

**6. Open it**

Go to **http://localhost:4321** in your browser.

> **Developing the UI?** Run `npm run dev` in one terminal and `npx vite` in another, then open
> **http://localhost:3000** for hot reload. Vite forwards API calls to the server.

---

## ⚙️ Configuration

There are two places to configure the app:

| Where | What goes there | Stored in |
| :--- | :--- | :--- |
| **`.env` file** | Google OAuth client IDs and secrets (Drive, Antigravity) | Your local `.env` file (git-ignored) |
| **Settings screen** (gear icon) | LLM endpoints and keys, voices, Colab, Drive options | Your local SQLite database in `data/` (git-ignored) |

### `.env` reference

| Variable | Required? | What it does |
| :--- | :--- | :--- |
| `PORT` | No | Main app port. Default `4321` |
| `SHARE_PORT` | No | Read-only "listen on phone" port on your LAN. Default `4322` |
| `GOOGLE_DRIVE_CLIENT_ID` | Only for Drive | OAuth client ID (see [Google Drive setup](#-optional-google-drive-backup)) |
| `GOOGLE_DRIVE_CLIENT_SECRET` | Only for Drive | OAuth client secret |
| `ANTIGRAVITY_CLIENT_ID` | Only for the Antigravity bridge | Google OAuth client ID used by the local bridge |
| `ANTIGRAVITY_CLIENT_SECRET` | Only for the Antigravity bridge | Google OAuth client secret used by the local bridge |

> **Never commit `.env`.** It is already listed in `.gitignore`. Only `.env.example`
> (which has placeholder values) belongs in git.

---

## 🤖 LLM setup (script refiner and vision OCR)

The app uses two LLM roles. Both speak the **OpenAI-compatible** `/v1/chat/completions` API,
so any provider with that API works.

| Role | What it does | Setting names in the Settings screen |
| :--- | :--- | :--- |
| **Refiner** | Cleans extracted text and rewrites it as natural narration | Refiner Endpoint URL, Refiner Model, Refiner API Key |
| **Vision** | Reads scanned pages when local OCR is not good enough (fallback) | Vision Endpoint URL, Vision Model, Vision API Key |

### Step by step

1. Get an API key from your provider (see examples below).
2. Open the app and click the **gear icon** → **Settings**.
3. Find the **Refiner** and **Vision** sections.
4. Fill in the three fields for each role:
   - **Endpoint URL** — the base URL, ending in `/v1` (or the provider's compatible base URL).
   - **Model** — the exact model name from your provider.
   - **API Key** — paste your key here. It is saved only on your computer.
5. Save, then run a single page to confirm it works.

### Example settings

Model names change often. Check your provider's current model list before you save.

| Provider | Endpoint URL | Example model | Notes |
| :--- | :--- | :--- | :--- |
| **OpenAI** | `https://api.openai.com/v1` | `gpt-4o-mini` | Create a key at platform.openai.com |
| **Google Gemini** (OpenAI-compatible) | `https://generativelanguage.googleapis.com/v1beta/openai/` | `gemini-2.5-flash` | Create a key in Google AI Studio |
| **OpenRouter** | `https://openrouter.ai/api/v1` | any model listed on openrouter.ai | One key, many models |
| **Ollama** (fully local, free) | `http://localhost:11434/v1` | e.g. `llama3.1` | Run `ollama pull <model>` first. Any placeholder key works |

### Advanced: Antigravity local bridge

The default URLs in the app point to a local bridge at `http://127.0.0.1:8085/v1`
(`server/proxy/antigravity-proxy.mjs`). It turns your Google login into an OpenAI-style
endpoint.

- It needs your own Google OAuth client (`ANTIGRAVITY_CLIENT_ID` and `ANTIGRAVITY_CLIENT_SECRET`
  in `.env`) and a login stored at `~/.pi/agent/auth.json`.
- If you do not use it, change the Refiner and Vision endpoints to one of the providers above.
- Check the terms of service of any provider you connect this way.

---

## ☁️ Optional: Google Drive backup

Drive keeps your generated audio backed up in a folder the app creates. The app uses the
narrow `drive.file` scope, so it can only see files it created. It cannot read the rest of
your Drive.

### 1. Create a Google Cloud project

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and create a project.
2. Open **APIs & Services → Library**, search for **Google Drive API**, and click **Enable**.

### 2. Configure the consent screen

1. Go to **APIs & Services → OAuth consent screen**.
2. Choose **External**, then fill in the app name and your email.
3. Under **Test users**, add the Google account you will connect.
   While the app is in "Testing" mode, only test users can sign in.

### 3. Create the OAuth client

1. Go to **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type: **Web application**.
3. Under **Authorized redirect URIs**, add exactly:

   ```
   http://localhost:4321/api/drive/auth/callback
   ```

   If you changed `PORT`, use that port instead.
4. Copy the **Client ID** and **Client secret**.

### 4. Add them to `.env`

```bash
GOOGLE_DRIVE_CLIENT_ID=your-id.apps.googleusercontent.com
```

```bash
GOOGLE_DRIVE_CLIENT_SECRET=your-secret
```

Restart the app (`Ctrl+C`, then `npm run dev`). Open **Settings → Audio storage**, click
**Connect Google Drive**, sign in and approve access.

---

## 🎮 Optional: Google Colab GPU narration

Colab gives you a GPU in the cloud. The app uses it to generate audio much faster than a
laptop, which is ideal for 300+ page books. Your local Mac stays the source of truth, and
every page is still cached locally.

### 1. Prerequisites

- A Google account with Colab access. Colab Pro gives more reliable GPUs (T4, L4, A100).
- **uv** or **pipx** to install the Colab CLI:

  ```bash
  brew install uv
  ```

- An SSH key for the tunnel. If you have none, create one:

  ```bash
  ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N ""
  ```

### 2. Connect in the app

1. Open **Settings → TTS backend & GPU**.
2. Click **Install Google Colab CLI** — this installs `google-colab-cli` and sets up your SSH key.
3. Click **Connect Google Account** and follow the Google prompts.
4. Pick a **Colab GPU Type** (T4 is the cheapest to start with).
5. Set **TTS backend** to `auto`. The app tries Colab first and falls back to your Mac.

The first session takes a few minutes to set up. After that, pages are synthesized one at a
time, and the session stops automatically after idle time (`colab_idle_stop_min`, default 30
minutes). Colab limits how many GPU runtimes one account can hold at once.

---

## 🎙️ Optional: local voice models

For narration on your Mac, the app uses the **OmniVoice** text-to-speech model and
**faster-whisper** for speech-to-text. Models download from Hugging Face the first time you
use them, and the app reuses any copy already in `~/.cache/huggingface/hub/`.

Create a Python environment inside the project:

```bash
python3 -m venv .venv
```

```bash
source .venv/bin/activate
```

```bash
pip install torch omnivoice faster-whisper
```

Then open **Models** in the app and download the models you want. The app checks for
`torch`, `omnivoice`, `faster_whisper`, `sherpa_onnx`, `transformers` and `huggingface_hub`.
If it cannot find them, it shows which ones are missing.

> The app is tuned for an 8 GB Mac. It loads one model at a time and unloads idle models.
> For very long books, use Colab.

---

## 🔤 OCR setup

Text is extracted in this order:

1. **Digital text layer** — free and instant, when the PDF already contains text.
2. **Apple Vision (`bin/macos_ocr`)** — on macOS, fast on the Neural Engine. Supports
   Latin and Arabic scripts, not Bengali.
3. **Tesseract** — local OCR with the Bengali (`ben`), Arabic (`ara`) and English (`eng`)
   language data already in `bin/tessdata/`:

   ```bash
   brew install tesseract
   ```

4. **Vision LLM** — the fallback when local OCR fails or the script looks wrong.

To rebuild the Apple Vision helper after editing it:

```bash
swiftc -O bin/macos_ocr.swift -o bin/macos_ocr
```

---

## 🗣️ Voice cloning

The repository does **not** include anyone's personal voice. To clone a voice:

1. Record a clean sample of 10–30 seconds (quiet room, one speaker, no music).
2. Open **Voices** in the app and upload it.
3. Edit the transcript if needed, then assign the voice to a language.

Voice samples and clone prompts are stored in `data/` and are git-ignored.

---

## 🧪 Testing

Run the pipeline tests. They stub OCR, LLM and TTS, and use a temporary database:

```bash
npm run test:pipeline
```

Check the production build:

```bash
npm run build:frontend
```

---

## 🗂️ Project structure

```
pdf-reader/
├── server/            Node/Express API and pipeline
│   ├── index.js       HTTP routes and server start-up
│   ├── pipeline.js    Page-by-page stage scheduler
│   ├── ocr.js         OCR tiers (text layer, Apple Vision, Tesseract, LLM)
│   ├── refiner.js     LLM script refiner
│   ├── tts.js         Audio synthesis (local or Colab)
│   ├── drive.js       Google Drive backup
│   ├── remote/        Colab CLI controller and GPU worker
│   └── proxy/         Optional Antigravity LLM bridge
├── src/               React interface (reader, library, voices, models, settings)
├── bin/               Helper tools: Apple Vision OCR, PDF tool, Python scripts, Tesseract data
├── docs/              Architecture, PRD, pipeline, model and API notes
├── tests/             Pipeline tests and sample PDFs
├── data/              Your local data: projects, uploads, voices, database (git-ignored)
├── .env.example       Template for private settings
└── package.json       Scripts and dependencies
```

---

## 🛡️ Privacy and security

- **Keys stay local.** API keys and OAuth secrets live in `.env` or your local database.
  Neither is committed to git.
- **Your books and voices stay local** unless you connect Drive or Colab.
- **Two ports.** The main app listens on `127.0.0.1` only. The read-only "listen" port
  (`SHARE_PORT`, default `4322`) listens on your local network so you can play audio on
  another device. Turn it off or use a firewall if you do not need it.
- **Do not share your `data/` folder.** It contains your books, cached text and database.

---

## 🩺 Troubleshooting

| Problem | What to try |
| :--- | :--- |
| Blank page at `localhost:4321` | Run `npm run build:frontend`, then restart with `npm run dev` |
| `port 4321 already in use` | Set a different `PORT` in `.env` and restart |
| LLM says "API key missing" | Enter the key in Settings → Refiner / Vision, and check the endpoint URL ends in `/v1` |
| LLM returns 401 or 404 | Check the key and the exact model name for that provider |
| Drive says `redirect_uri_mismatch` | The redirect URI in Google Cloud must match `http://localhost:<PORT>/api/drive/auth/callback` exactly |
| Drive says "access blocked" | Add your Google account under **Test users** on the consent screen |
| Colab "allocation refused" | Your account has reached its GPU limit. Stop other runtimes or try a different GPU |
| MP3 export or voice upload fails | Install ffmpeg: `brew install ffmpeg` |
| Bengali text is garbled | The Bijoy decoder runs automatically for SutonnyMJ fonts. For other encodings, use the Vision LLM |
| Voice cloning says "no reference audio" | Upload a voice sample in the Voices tab (see [Voice cloning](#️-voice-cloning)) |

---

## 📚 More documentation

- [AGENTS.md](AGENTS.md) — operating rules for AI coding agents working in this repo
- [docs/PRD.md](docs/PRD.md) — product requirements
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — system architecture and pipeline flow
- [docs/NARRATION_PIPELINE.md](docs/NARRATION_PIPELINE.md) — text cleaning, script routing, audio synthesis
- [docs/LOCAL_MODELS.md](docs/LOCAL_MODELS.md) — local model inventory and loading notes
- [docs/API_USAGE.md](docs/API_USAGE.md) — API usage and cost tracking
- [docs/ROADMAP.md](docs/ROADMAP.md) — development plan

---

## 🤝 Contributing

Contributions are welcome.

1. Fork the repo and create a branch: `git checkout -b feature/your-idea`
2. Make small, focused changes and match the existing code style.
3. Run `npm run test:pipeline` and `npm run build:frontend`.
4. Open a pull request that explains what changed and why.

Please never commit `.env`, `data/`, API keys, personal recordings or copyrighted books.

---

## 📄 License

Released under the **MIT License** (see the `license` field in `package.json`).
