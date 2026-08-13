// Configuration
const API = ''; // Same origin

// State
let currentJobId = null;
let eventSource = null;

// DOM Elements
const urlInput = document.getElementById('urlInput');
const processBtn = document.getElementById('processBtn');
const stopBtn = document.getElementById('stopBtn');
const statusBar = document.getElementById('statusBar');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const logSection = document.getElementById('logSection');
const logConsole = document.getElementById('logConsole');
const clipsSection = document.getElementById('clipsSection');
const clipsGrid = document.getElementById('clipsGrid');
const errorBanner = document.getElementById('errorBanner');
const subtitlesToggle = document.getElementById('subtitlesToggle');
const mouseGlow = document.getElementById('mouseGlow');

// Cookies Upload Elements (Removed for stateless deployment)

// Event Listeners
document.addEventListener('mousemove', (e) => {
    // Only move if we aren't hovering over an interactive element that should have its own focus
    mouseGlow.style.left = `${e.clientX}px`;
    mouseGlow.style.top = `${e.clientY}px`;
});

urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') startProcessing();
});
processBtn.addEventListener('click', startProcessing);
stopBtn.addEventListener('click', stopProcessing);

// Main Processing Logic
function startProcessing() {
    const url = urlInput.value.trim();
    if (!url) {
        showError('Please enter a YouTube URL');
        return;
    }

    // Reset UI State
    hideError();
    logConsole.innerHTML = '';
    clipsGrid.innerHTML = '';
    clipsSection.classList.remove('visible');
    
    // Update Buttons
    processBtn.disabled = true;
    processBtn.textContent = 'Processing...';
    stopBtn.classList.add('visible');

    // Show Status & Log
    statusBar.classList.add('visible');
    logSection.classList.add('visible');
    statusDot.className = 'status-dot';
    statusText.innerHTML = '<strong>Starting...</strong>';

    const subtitles_enabled = subtitlesToggle.checked;
    
    // Connect directly to the stateless process_stream endpoint
    if (eventSource) {
        eventSource.close();
    }
    
    const streamUrl = `${API}/api/process_stream?url=${encodeURIComponent(url)}&subtitles_enabled=${subtitles_enabled}`;
    eventSource = new EventSource(streamUrl);

    eventSource.addEventListener('progress', (e) => {
        const msg = JSON.parse(e.data);
        appendLog(msg);

        // Note: For stateless download, the backend would need to push to Cloud Storage
        // Right now, clips won't download properly on Cloud Run because they are on a random ephemeral instance.
        if (msg.clip) {
            displaySingleClip(msg.clip, "stateless"); 
        }

        const stageLabels = {
            'init': 'Initializing',
            'download': 'Downloading',
            'transcribe': 'Transcribing',
            'highlights': 'Detecting Highlights',
            'processing': 'Processing Clips',
            'subtitles': 'Generating Subtitles',
            'rendering': 'Rendering',
            'error': 'Error',
            'stopped': 'Stopped'
        };
        const label = stageLabels[msg.stage] || msg.stage;
        statusText.innerHTML = `<strong>${label}</strong> — ${msg.message}`;
    });

    eventSource.addEventListener('done', (e) => {
        const result = JSON.parse(e.data);
        eventSource.close();
        eventSource = null;

        if (result.status === 'completed') {
            statusDot.classList.add('done');
            statusText.innerHTML = `<strong>Complete!</strong> ${result.clips.length} clips generated`;

            appendLog({
                stage: 'complete',
                message: `All done! ${result.clips.length} clips ready.`,
                time: new Date().toLocaleTimeString('en-GB', { hour12: false }),
            });

            displayClips(result.clips, "stateless");
            
        } else if (result.error && result.error.includes('stopped by user')) {
            statusDot.classList.add('error');
            statusText.innerHTML = `<strong>Stopped</strong> — Pipeline was cancelled`;
            appendLog({
                stage: 'stopped',
                message: 'Pipeline stopped by user.',
                time: new Date().toLocaleTimeString('en-GB', { hour12: false }),
            });
        } else {
            statusDot.classList.add('error');
            statusText.innerHTML = `<strong>Failed</strong> — ${result.error || 'Unknown error'}`;
            showError(result.error || 'Pipeline failed');
        }

        resetButtons();
    });

    eventSource.onerror = (err) => {
        eventSource.close();
        eventSource = null;
        showError('Lost connection to server or server crashed.');
        resetButtons();
    };
}

function stopProcessing() {
    if (eventSource) {
        // Closing the SSE connection will trigger an asyncio.CancelledError on the server
        eventSource.close();
        eventSource = null;
        
        appendLog({
            stage: 'stopped',
            message: 'Stop requested — pipeline is terminating...',
            time: new Date().toLocaleTimeString('en-GB', { hour12: false }),
        });
        
        statusDot.classList.add('error');
        statusText.innerHTML = `<strong>Stopped</strong> — Pipeline was cancelled`;
        resetButtons();
    }
}

// UI Helpers
function appendLog(msg) {
    const line = document.createElement('div');
    line.className = 'log-line';

    if (msg.stage === 'error') line.classList.add('error');
    if (msg.stage === 'complete' || msg.stage === 'done') line.classList.add('success');
    if (msg.stage === 'stopped') line.classList.add('error');

    const time = msg.time || new Date().toLocaleTimeString('en-GB', { hour12: false });

    line.innerHTML = `<span class="log-time">${time}</span>`
        + `<span class="log-stage">${msg.stage}</span>`
        + `<span class="log-msg">${escapeHtml(msg.message)}</span>`;

    logConsole.appendChild(line);
    logConsole.scrollTop = logConsole.scrollHeight;
}

function displaySingleClip(clip, jobId) {
    clipsSection.classList.add('visible');
    const downloadUrl = `${API}/api/download/${jobId}/${clip.index}`;

    const card = document.createElement('div');
    card.className = 'clip-card';
    card.innerHTML = `
        <video controls preload="metadata" src="${downloadUrl}"></video>
        <div class="clip-info">
            <div class="clip-title" title="${escapeHtml(clip.title)}">${escapeHtml(clip.title)}</div>
            <div class="clip-meta">
                <div class="meta-badge">⏱ ${clip.duration}s</div>
                <div class="meta-badge score">⭐ ${clip.score}/10</div>
            </div>
            <a class="btn-download" href="${downloadUrl}" download="${clip.filename}">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="7 10 12 15 17 10"></polyline>
                    <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
                Download HD
            </a>
        </div>
    `;
    clipsGrid.appendChild(card);
}

function displayClips(clips, jobId) {
    clipsGrid.innerHTML = '';
    if (clips && clips.length > 0) {
        clipsSection.classList.add('visible');
        
        // Sort from best to worst score
        const sortedClips = [...clips].sort((a, b) => b.score - a.score);
        
        sortedClips.forEach((clip) => {
            displaySingleClip(clip, jobId);
        });
    }
}

function showError(msg) {
    errorBanner.innerHTML = `<strong>Error:</strong> ${escapeHtml(msg)}`;
    errorBanner.classList.add('visible');
}

function hideError() {
    errorBanner.classList.remove('visible');
}

function resetButtons() {
    processBtn.disabled = false;
    processBtn.textContent = 'Generate Clips';
    stopBtn.classList.remove('visible');
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
