#!/usr/bin/env python3
"""
Hugging Face Hub Cache-Compatible Model Downloader with Real-Time Progress & Resume.

Downloads any Hugging Face repository directly into standard Hugging Face Hub cache
layout (`models--<org>--<repo>/blobs/<oid>`, `snapshots/<sha>/<file>`, `refs/main`)
using only Python standard library (`urllib.request`), so it works in any Python 3
environment without requiring `huggingface_hub` to be pre-installed.

Usage:
  model_downloader.py <repo_id> <cache_dir>
Environment:
  HF_TOKEN (optional)
"""

import json
import os
import signal
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

CHUNK_SIZE = 256 * 1024  # 256 KB
SKIP_PATTERNS = {'.DS_Store'}


def emit(payload):
    sys.stdout.write(json.dumps(payload) + '\n')
    sys.stdout.flush()


def handle_sig(signum, _frame):
    emit({'type': 'cancelled', 'message': 'Download cancelled by user'})
    sys.exit(130)


signal.signal(signal.SIGTERM, handle_sig)
signal.signal(signal.SIGINT, handle_sig)


def make_headers(token=None, extra=None):
    headers = {'User-Agent': 'pdf-reader-model-manager/1.0'}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    if extra:
        headers.update(extra)
    return headers


def fetch_json(url, token=None):
    req = urllib.request.Request(url, headers=make_headers(token))
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode('utf-8'))


def list_repo_files(repo_id, sha, token=None):
    encoded_repo = '/'.join(urllib.parse.quote(p, safe='') for p in repo_id.split('/'))
    url = f'https://huggingface.co/api/models/{encoded_repo}/tree/{sha}?recursive=true'
    items = fetch_json(url, token)
    files = []
    for item in items:
        if item.get('type') != 'file':
            continue
        rpath = item.get('path') or ''
        if not rpath or os.path.basename(rpath) in SKIP_PATTERNS:
            continue
        lfs = item.get('lfs') or {}
        oid = lfs.get('oid') or item.get('oid') or rpath.replace('/', '_')
        size = int(lfs.get('size') or item.get('size') or 0)
        files.append({'path': rpath, 'oid': oid, 'size': size})
    return files


def ensure_symlink(target_blob, link_path):
    os.makedirs(os.path.dirname(link_path), exist_ok=True)
    rel_target = os.path.relpath(target_blob, os.path.dirname(link_path))
    if os.path.lexists(link_path):
        try:
            os.remove(link_path)
        except OSError:
            pass
    try:
        os.symlink(rel_target, link_path)
    except OSError:
        import shutil
        shutil.copy2(target_blob, link_path)


def main():
    if len(sys.argv) < 3:
        emit({'type': 'error', 'error': 'Usage: model_downloader.py <repo_id> <cache_dir>'})
        sys.exit(1)

    repo_id = sys.argv[1].strip()
    cache_dir = os.path.expanduser(sys.argv[2].strip())
    token = (os.environ.get('HF_TOKEN') or '').strip() or None

    try:
        encoded_repo = '/'.join(urllib.parse.quote(p, safe='') for p in repo_id.split('/'))
        info = fetch_json(f'https://huggingface.co/api/models/{encoded_repo}', token)
        sha = info.get('sha') or 'main'
        files = list_repo_files(repo_id, sha, token)
    except urllib.error.HTTPError as exc:
        msg = f'Hugging Face API HTTP {exc.code}: {exc.reason}'
        if exc.code in (401, 403):
            msg += ' (Check HF_TOKEN or repository permissions)'
        elif exc.code == 404:
            msg += f' (Repository "{repo_id}" not found)'
        emit({'type': 'error', 'error': msg})
        sys.exit(1)
    except Exception as exc:
        emit({'type': 'error', 'error': f'Failed to query Hugging Face: {exc}'})
        sys.exit(1)

    if not files:
        emit({'type': 'error', 'error': f'No downloadable files found in {repo_id}'})
        sys.exit(1)

    repo_folder = 'models--' + repo_id.replace('/', '--')
    repo_root = os.path.join(cache_dir, repo_folder)
    blobs_dir = os.path.join(repo_root, 'blobs')
    refs_dir = os.path.join(repo_root, 'refs')
    snapshot_dir = os.path.join(repo_root, 'snapshots', sha)

    os.makedirs(blobs_dir, exist_ok=True)
    os.makedirs(refs_dir, exist_ok=True)
    os.makedirs(snapshot_dir, exist_ok=True)

    total_bytes = sum(f['size'] for f in files)
    downloaded_bytes = 0

    # Pre-account already complete or partially downloaded blobs
    for f in files:
        blob_path = os.path.join(blobs_dir, f['oid'])
        inc_path = blob_path + '.incomplete'
        if os.path.exists(blob_path):
            downloaded_bytes += f['size'] or os.path.getsize(blob_path)
        elif os.path.exists(inc_path):
            downloaded_bytes += min(os.path.getsize(inc_path), f['size'] or os.path.getsize(inc_path))

    emit({
        'type': 'start',
        'repoId': repo_id,
        'sha': sha,
        'fileCount': len(files),
        'totalBytes': total_bytes,
        'downloadedBytes': downloaded_bytes,
        'percent': round((downloaded_bytes / total_bytes) * 100, 1) if total_bytes > 0 else 0
    })

    start_time = time.time()
    session_bytes = 0
    last_emit = 0.0

    for idx, f in enumerate(files):
        rpath = f['path']
        oid = f['oid']
        expected_size = f['size']
        blob_path = os.path.join(blobs_dir, oid)
        inc_path = blob_path + '.incomplete'
        link_path = os.path.join(snapshot_dir, rpath)

        if os.path.exists(blob_path) and (expected_size == 0 or os.path.getsize(blob_path) >= expected_size):
            ensure_symlink(blob_path, link_path)
            continue

        resume_from = os.path.getsize(inc_path) if os.path.exists(inc_path) else 0
        if expected_size > 0 and resume_from > expected_size:
            resume_from = 0

        quoted_path = '/'.join(urllib.parse.quote(p, safe='') for p in rpath.split('/'))
        file_url = f'https://huggingface.co/{encoded_repo}/resolve/{sha}/{quoted_path}'

        extra_headers = {}
        if resume_from > 0:
            extra_headers['Range'] = f'bytes={resume_from}-'

        req = urllib.request.Request(file_url, headers=make_headers(token, extra_headers))
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                status = getattr(resp, 'status', 200)
                mode = 'ab' if (resume_from > 0 and status == 206) else 'wb'
                if mode == 'wb' and resume_from > 0:
                    downloaded_bytes = max(0, downloaded_bytes - resume_from)

                with open(inc_path, mode) as out_fh:
                    while True:
                        chunk = resp.read(CHUNK_SIZE)
                        if not chunk:
                            break
                        out_fh.write(chunk)
                        n = len(chunk)
                        downloaded_bytes += n
                        session_bytes += n

                        now = time.time()
                        if now - last_emit >= 0.25:
                            elapsed = max(0.001, now - start_time)
                            speed = session_bytes / elapsed
                            remaining = max(0, total_bytes - downloaded_bytes)
                            eta = int(remaining / speed) if speed > 0 else None
                            pct = min(99.9, round((downloaded_bytes / total_bytes) * 100, 1)) if total_bytes > 0 else 0
                            emit({
                                'type': 'progress',
                                'downloadedBytes': downloaded_bytes,
                                'totalBytes': total_bytes,
                                'percent': pct,
                                'speedBps': round(speed),
                                'etaSeconds': eta,
                                'currentFile': rpath,
                                'fileIndex': idx + 1,
                                'fileCount': len(files)
                            })
                            last_emit = now
        except Exception as exc:
            emit({'type': 'error', 'error': f'Failed while downloading {rpath}: {exc}'})
            sys.exit(1)

        os.replace(inc_path, blob_path)
        ensure_symlink(blob_path, link_path)

    with open(os.path.join(refs_dir, 'main'), 'w', encoding='utf-8') as ref_fh:
        ref_fh.write(sha)

    emit({
        'type': 'complete',
        'repoId': repo_id,
        'sha': sha,
        'snapshotPath': snapshot_dir,
        'downloadedBytes': total_bytes,
        'totalBytes': total_bytes,
        'percent': 100
    })


if __name__ == '__main__':
    main()
