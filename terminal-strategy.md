# 🐧 CollabCode Terminal & Runtime (Linux Runtime Strategy)

## Goals
1. Execute **any shell command** reliably across platforms.
2. Support **long-running processes** (`npm run dev`, `python -m http.server`).
3. Provide **HTTP preview URLs** for running apps.
4. Seamlessly **install / manage dependencies** (`npm install`, `pip install`).
5. Ensure **file consistency** between DB and runtime environment.
6. Run commands in a **secure, isolated, resource-bounded environment**.

---

## 🔄 Revised Architecture Overview

### 1. Runtime Environment
- **Execution inside Linux containers** (Docker, Podman, or Firecracker VM).
- Each project gets its own isolated container → predictable POSIX tools (`ls`, `bash`, `python`, `node`).
- No need for cross-platform command aliasing (`ls` always works).

### 2. File Sync
- **Bind-mount or sync project folder into container**:
  1. On command execution, call `syncProjectToDisk(projectId)` → writes to `temp/projects/{projectId}`.
  2. Mount this folder into the container at `/workspace`.
- **Optional future**: detect changes inside container (e.g., `npm install`) and push back to DB.

### 3. Process Management
- Use **node-pty** connected to the container runtime:
  ```ts
  docker run -it --rm \
    --user node \
    --cpus 1 --memory 512m \
    -w /workspace \
    -v $(pwd)/temp/projects/{projectId}:/workspace \
    node:18 bash
  ```
- Backend maintains a `Map<socketId, PtyProcess>` to track interactive sessions.
- Events:
  - `terminal-command` → write command into pty.
  - `terminal-interrupt` → send SIGINT.
  - `disconnect` → stop container gracefully.

### 4. Long-Running Commands & HTTP Preview
- Containerized processes expose ports; forwarded via reverse proxy.
- Workflow:
  1. Detect port binding (stdout parsing or `docker port`).
  2. Proxy maps container port → `https://preview.collabcode.dev/{projectId}/{port}`.
  3. Emit `terminal-preview` to frontend → shows “Open Preview” button.
- Auto-increment ports on conflict (`get-port`).

### 5. Dependency Management
- Base images include runtimes (Node, Python, etc.).
- Dependencies installed inside `/workspace` persist across runs (mounted volume).
- **Cache mounts** for faster installs:
  - npm → `-v ~/.collabcache/npm:/home/node/.npm`.
  - pip → `-v ~/.collabcache/pip:/home/node/.cache/pip`.

### 6. Security & Limits
- Containers run as **non-root user** (`--user node`).
- **Resource quotas** via Docker flags (`--memory 512m --cpus 1`).
- **Timeouts**: 2 h for dev servers, 5 m for misc commands.
- Filesystem: only `/workspace` writable; image layers read-only.

### 7. Frontend UX
- **xterm.js** terminal (unchanged) with tabs and status bar.
- Events handled: `terminal-output`, `terminal-preview`, `terminal-error`.

### 8. Testing Checklist
- ✅ POSIX commands (`ls`, `cat`, `touch`).
- ✅ `npm install` and `npm run dev` with preview URL.
- ✅ `python -m http.server 8000` preview.
- ✅ Interrupt infinite loops.
- ✅ Editor file edits reflected inside container.

---

## 📌 Task Breakdown
1. **backend/fileSync.ts** → `syncProjectToDisk(projectId)`.
2. **runtime/ContainerManager.ts** → wrapper for Docker run/stop/exec with node-pty.
3. **socketHandler.js** → integrate `ContainerManager`; stream pty to client.
4. **frontend/TerminalComponent** → handle `terminal-preview`; add tabs/stop buttons.
5. **proxy service** → reverse proxy container ports → stable preview URLs.
6. **Docs** → update runtime requirements (Docker/Podman).

---

## 🚀 Milestones
1. MVP: file sync + `ContainerManager` + node-pty.
2. Preview URLs: reverse proxy + port detection.
3. Dependency caching mounts.
4. UX polish (multi-tab, restart/stop).
5. Security hardening (quotas, non-root, read-only FS).

---

_Sign-off_: Linux container strategy enables predictable tools, stronger isolation, and eliminates cross-platform quirks.