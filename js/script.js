import { defaultLyrics } from '../data/lyrics.js';

let player;
let timerInterval;
let isLooping = false;
let currentLyricIndex = -1;
let lyricsData = []; // Dynamic
let currentSongId = 'default';
let syncMode = false;
let syncData = [];
let syncIndex = 0;

// State for custom songs
let customSongs = JSON.parse(localStorage.getItem('mySongs')) || [];
const envKey = (window.CONFIG && window.CONFIG.GEMINI_API_KEY) ? window.CONFIG.GEMINI_API_KEY : '';
let apiKey = envKey || localStorage.getItem('geminiApiKey') || '';

// DOM Elements
const els = {
    lyricsContainer: document.getElementById('lyrics-container'),
    loopToggle: document.getElementById('loopToggle'),
    speedSelect: document.getElementById('speedSelect'),
    openLibraryBtn: document.getElementById('openLibraryBtn'),
    libraryModal: document.getElementById('libraryModal'),
    closeLibraryBtn: document.getElementById('closeLibraryBtn'),
    apiKeyInput: document.getElementById('apiKeyInput'),
    saveKeyBtn: document.getElementById('saveKeyBtn'),
    savedSongsList: document.getElementById('savedSongsList'),
    newSongUrl: document.getElementById('newSongUrl'),
    newSongTitle: document.getElementById('newSongTitle'),
    newSongArtist: document.getElementById('newSongArtist'),
    newSongLyrics: document.getElementById('newSongLyrics'), // New
    generateBtn: document.getElementById('generateLyricsBtn'),

    // Editor Elements
    editorModal: document.getElementById('editorModal'),
    closeEditorBtn: document.getElementById('closeEditorBtn'),
    saveEditorBtn: document.getElementById('saveEditorBtn'),
    addLyricLineBtn: document.getElementById('addLyricLineBtn'),
    editorRows: document.getElementById('editorRows'),

    syncModal: document.getElementById('syncModal'),
    syncCurrent: document.getElementById('syncCurrentLine'),
    syncNext: document.getElementById('syncNextLine'),
    saveSyncBtn: document.getElementById('saveSyncBtn'),
    cancelSyncBtn: document.getElementById('cancelSyncBtn'),
    syncPlayBtn: document.getElementById('syncPlayBtn'),
    songTitle: document.getElementById('songTitle'),
    songArtist: document.getElementById('songArtist'),
    videoLink: document.getElementById('videoLink')
};

// Initialize
function init() {
    // Load API Key
    if (apiKey && els.apiKeyInput) els.apiKeyInput.value = apiKey;

    loadSong('default');
    setupEventListeners();
    loadYouTubeAPI();
    renderSongList();
}

function loadSong(id) {
    currentSongId = id;
    if (id === 'default') {
        lyricsData = defaultLyrics;
        updateMetadata("back number - 幸せ", "互動式歌詞學習 (Cover by Kobasolo & 藤川千愛)", "ruxJacIFKL4");
    } else {
        const song = customSongs.find(s => s.id === id);
        if (song) {
            lyricsData = song.lyrics;
            updateMetadata(song.title, song.artist, song.videoId);
        }
    }
    renderLyrics();

    // If player ready, load new video
    if (player && player.loadVideoById) {
        let videoId = (id === 'default') ? 'ruxJacIFKL4' : customSongs.find(s => s.id === id).videoId;
        player.loadVideoById(videoId);
    }

    // Close modal if open
    els.libraryModal.classList.add('hidden');
}

function updateMetadata(title, artist, videoId) {
    els.songTitle.textContent = title;
    els.songArtist.textContent = artist;
    els.videoLink.href = `https://www.youtube.com/watch?v=${videoId}`;
}

function renderLyrics() {
    els.lyricsContainer.innerHTML = '';

    lyricsData.forEach((line, index) => {
        const div = document.createElement('div');
        div.className = 'lyric-item bg-white p-4 rounded-lg shadow-sm mb-3 group';
        div.dataset.index = index;
        div.dataset.time = line.time;

        div.innerHTML = `
            <div class="flex items-start gap-4">
                <div class="text-xs font-mono text-gray-400 mt-1 min-w-[40px]">${line.time !== undefined && line.time !== null ? formatTime(line.time) : '--:--'}</div>
                <div class="flex-1">
                    <p class="jp-text text-lg text-gray-800 mb-1 leading-relaxed">${line.jp || ''}</p>
                    <p class="text-sm text-blue-500 font-medium mb-1">${line.ro || ''}</p>
                    <p class="text-sm text-gray-500">${line.cn || ''}</p>
                </div>
                <div class="opacity-0 group-hover:opacity-100 transition-opacity text-blue-500 self-center">
                    <i class="fas fa-play-circle text-2xl"></i>
                </div>
            </div>
        `;

        div.addEventListener('click', () => {
            if (line.time !== undefined && line.time !== null) seekToLine(index);
        });

        els.lyricsContainer.appendChild(div);
    });
}

function setupEventListeners() {
    els.loopToggle.addEventListener('change', (e) => isLooping = e.target.checked);

    // Speed
    if (els.speedSelect) {
        els.speedSelect.addEventListener('change', (e) => {
            if (player && player.setPlaybackRate) player.setPlaybackRate(parseFloat(e.target.value));
        });
    }

    // Library
    els.openLibraryBtn.addEventListener('click', () => els.libraryModal.classList.remove('hidden'));
    els.closeLibraryBtn.addEventListener('click', () => els.libraryModal.classList.add('hidden'));

    // API Key
    if (els.saveKeyBtn) {
        els.saveKeyBtn.addEventListener('click', () => {
            apiKey = els.apiKeyInput.value.trim();
            localStorage.setItem('geminiApiKey', apiKey);
            alert('API Key Saved!');
        });
    }

    // Generate
    if (els.generateBtn) els.generateBtn.addEventListener('click', handleGenerate);

    // Saved Song Click Delegation
    els.savedSongsList.addEventListener('click', (e) => {
        const item = e.target.closest('.song-item');
        if (item) loadSong(item.dataset.id);
    });

    // Sync Controls
    document.addEventListener('keydown', (e) => {
        if (!syncMode) return;
        if (e.code === 'Space') {
            e.preventDefault();
            markSyncTimestamp();
        }
    });

    els.saveSyncBtn.addEventListener('click', saveSync);
    els.cancelSyncBtn.addEventListener('click', () => {
        syncMode = false;
        els.syncModal.classList.add('hidden');
        if (player) player.pauseVideo();
    });

    els.syncPlayBtn.addEventListener('click', () => {
        if (player) player.playVideo();
        els.syncPlayBtn.classList.add('hidden');
    });

    // Editor
    els.closeEditorBtn.addEventListener('click', () => els.editorModal.classList.add('hidden'));
    els.saveEditorBtn.addEventListener('click', saveEditorChanges);
    els.addLyricLineBtn.addEventListener('click', () => addEditorRow({}));
}

// --- Logic Modules ---

async function handleGenerate() {
    const url = els.newSongUrl.value.trim();
    const title = els.newSongTitle.value.trim();
    const artist = els.newSongArtist.value.trim();
    const pastedLyrics = els.newSongLyrics ? els.newSongLyrics.value.trim() : "";

    if (!apiKey) return alert('Please enter and save your Gemini API Key first.');
    if (!url || !title) return alert('Please enter YouTube URL and Song Title.');

    // Extract ID
    const videoId = extractVideoId(url);
    if (!videoId) return alert('Invalid YouTube URL');

    // UI Loading
    const btn = els.generateBtn;
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
    btn.disabled = true;

    try {
        let lyrics;
        if (pastedLyrics) {
            // Use pasted lyrics
            lyrics = await fetchFormattedLyricsFromGemini(pastedLyrics, title, artist);
        } else {
            // Generate from scratch
            lyrics = await fetchLyricsFromGemini(title, artist);
        }

        // Start Sync Mode
        startSyncMode(lyrics, { title, artist, videoId });

    } catch (err) {
        console.error(err);
        alert('Error generating lyrics: ' + err.message);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

function extractVideoId(url) {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
}

// Format existing lyrics
async function fetchFormattedLyricsFromGemini(pastedText, title, artist) {
    const prompt = `
        I have the raw lyrics for the song "${title}" by "${artist}". 
        Please format them into a JSON array for my app.
        
        Raw Lyrics:
        """
        ${pastedText}
        """

        Return ONLY a raw JSON array. Do not include markdown formatting like \`\`\`json.
        Each item in the array represents a line and should have:
        "time": Best guess timestamp in seconds (number) relative to start. estimating is okay.
        "jp": The lyric line from the text above (keep original language).
        "ro": Romaji (OR transliteration if not English).
        "cn": Traditional Chinese translation of this line.
        Break lines naturally.
    `;
    return callGemini(prompt);
}

// Generate new lyrics
async function fetchLyricsFromGemini(title, artist) {
    const prompt = `
        Generate the lyrics for the song "${title}" by "${artist}".
        Please be as ACCURATE as possible with the original lyrics. 
        Do not make up lyrics. If you don't know the song perfectly, return a JSON error.

        Return ONLY a raw JSON array. Do not include markdown formatting like \`\`\`json.
        Each item should have:
        "time": Best guess timestamp in seconds (number). estimating is okay.
        "jp": Japanese lyrics (or original language).
        "ro": Romaji (if Japanese) or transliteration.
        "cn": Traditional Chinese translation.
        Break lines naturally.
    `;
    return callGemini(prompt);
}

async function callGemini(prompt) {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }]
        })
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);

    let text = data.candidates[0].content.parts[0].text;
    text = text.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(text);
}

function startSyncMode(lyrics, meta) {
    // Check if AI provided times
    const hasTimes = lyrics.every(l => typeof l.time === 'number');

    if (hasTimes) {
        // Ask user choice
        const useAI = confirm('AI has estimated timestamps.\n\nOK: Use AI timings (Fast, but might be inaccurate)\nCancel: Sync Manually (Recommended for accuracy)');

        if (useAI) {
            // Direct Save!
            const newSong = {
                id: Date.now().toString(),
                title: meta.title,
                artist: meta.artist,
                videoId: meta.videoId,
                lyrics: lyrics
            };
            customSongs.push(newSong);
            localStorage.setItem('mySongs', JSON.stringify(customSongs));
            renderSongList();
            loadSong(newSong.id);
            return;
        }
    }

    syncMode = true;
    syncData = lyrics.map(l => ({ ...l, time: null })); // clear times
    syncIndex = 0;

    // Store temp meta
    syncData._meta = meta;

    els.libraryModal.classList.add('hidden');
    els.syncModal.classList.remove('hidden');
    els.syncPlayBtn.classList.remove('hidden');

    // Load video
    if (player) {
        player.loadVideoById(meta.videoId);
        player.pauseVideo();
    }

    updateSyncUI();
}

function updateSyncUI() {
    if (syncIndex < syncData.length) {
        els.syncCurrent.textContent = syncData[syncIndex].jp;
        els.syncNext.textContent = syncData[syncIndex + 1]?.jp || "(End of song)";
    } else {
        els.syncCurrent.textContent = "Finished!";
        els.syncNext.textContent = "";
    }
}

function markSyncTimestamp() {
    if (!player || syncIndex >= syncData.length) return;

    const currentTime = player.getCurrentTime();
    syncData[syncIndex].time = Math.max(0, currentTime - 0.2); // slight offset

    syncIndex++;
    updateSyncUI();
}

function saveSync() {
    const meta = syncData._meta;
    const newSong = {
        id: Date.now().toString(),
        title: meta.title,
        artist: meta.artist,
        videoId: meta.videoId,
        lyrics: syncData.filter(l => l.time !== null) // remove unsynced
    };

    customSongs.push(newSong);
    localStorage.setItem('mySongs', JSON.stringify(customSongs));

    syncMode = false;
    els.syncModal.classList.add('hidden');
    renderSongList();
    loadSong(newSong.id);
}

function renderSongList() {
    // Clear list but keep default
    els.savedSongsList.querySelectorAll('.song-item').forEach(e => e.remove());

    customSongs.forEach(song => {
        const div = document.createElement('div');
        div.className = 'song-item flex items-center justify-between p-3 bg-white rounded-lg border border-gray-200 hover:bg-gray-50 transition cursor-pointer';
        div.dataset.id = song.id;

        div.innerHTML = `
             <div class="flex items-center gap-3">
                <div class="w-10 h-10 bg-blue-100 rounded-md flex items-center justify-center text-blue-500">
                    <i class="fas fa-play"></i>
                </div>
                <div>
                    <h4 class="text-sm font-bold text-gray-800">${song.title}</h4>
                    <p class="text-xs text-gray-500">${song.artist}</p>
                </div>
            </div>
            <div class="flex gap-1">
                <button class="text-blue-400 hover:text-blue-600 px-2 stop-prop" onclick="editSong('${song.id}', event)">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="text-red-400 hover:text-red-600 px-2 stop-prop" onclick="deleteSong('${song.id}', event)">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        `;
        els.savedSongsList.appendChild(div);
    });
}

window.deleteSong = function (id, event) {
    if (event) event.stopPropagation();
    if (!confirm('Delete this song?')) return;

    customSongs = customSongs.filter(s => s.id !== id);
    localStorage.setItem('mySongs', JSON.stringify(customSongs));
    renderSongList();

    if (currentSongId === id) loadSong('default');
}

window.editSong = function (id, event) {
    if (event) event.stopPropagation();
    const song = customSongs.find(s => s.id === id);
    if (!song) return;

    openEditor(song);
}

// --- Editor Logic ---
let editingSongId = null;

function openEditor(song) {
    editingSongId = song.id;
    els.editorRows.innerHTML = '';

    // Sort logic to ensure times are valid numbers for sorting, treating null as infinity or 0 depending on pref. 
    // Ideally lyrics are sorted by time.
    const sortedLyrics = [...song.lyrics].sort((a, b) => (a.time || 0) - (b.time || 0));

    sortedLyrics.forEach(line => addEditorRow(line));
    els.editorModal.classList.remove('hidden');
    els.libraryModal.classList.add('hidden'); // hide library
}

function addEditorRow(line) {
    const tr = document.createElement('tr');
    tr.className = "hover:bg-gray-50";
    tr.innerHTML = `
        <td class="p-1">
            <input type="number" step="0.1" class="w-full border border-gray-300 rounded px-1 py-1 text-xs text-center font-mono" value="${line.time !== null && line.time !== undefined ? line.time : ''}" placeholder="--">
        </td>
        <td class="p-1">
            <input type="text" class="w-full border border-gray-300 rounded px-2 py-1 text-sm" value="${line.jp || ''}">
        </td>
        <td class="p-1">
            <input type="text" class="w-full border border-gray-300 rounded px-2 py-1 text-sm text-gray-600" value="${line.ro || ''}">
        </td>
        <td class="p-1">
            <input type="text" class="w-full border border-gray-300 rounded px-2 py-1 text-sm text-gray-600" value="${line.cn || ''}">
        </td>
        <td class="p-1 text-center">
            <button class="text-red-400 hover:text-red-600" onclick="this.closest('tr').remove()"><i class="fas fa-times"></i></button>
        </td>
    `;
    els.editorRows.appendChild(tr);
}

function saveEditorChanges() {
    if (!editingSongId) return;

    const rows = Array.from(els.editorRows.children);
    const newLyrics = rows.map(tr => {
        const inputs = tr.querySelectorAll('input');
        const timeVal = inputs[0].value;
        return {
            time: timeVal !== '' ? parseFloat(timeVal) : null,
            jp: inputs[1].value,
            ro: inputs[2].value,
            cn: inputs[3].value
        };
    }).filter(l => l.jp || l.cn); // Filter empty

    // Sort by time
    newLyrics.sort((a, b) => (a.time || 0) - (b.time || 0));

    // Update data
    const songIndex = customSongs.findIndex(s => s.id === editingSongId);
    if (songIndex !== -1) {
        customSongs[songIndex].lyrics = newLyrics;
        localStorage.setItem('mySongs', JSON.stringify(customSongs));

        // Reload if current
        if (currentSongId === editingSongId) {
            loadSong(editingSongId);
        }

        renderSongList(); // Update library UI
    }

    els.editorModal.classList.add('hidden');
    els.libraryModal.classList.remove('hidden'); // Show library again
}

// --- Utils ---
function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function loadYouTubeAPI() {
    var tag = document.createElement('script');
    tag.src = "https://www.youtube.com/iframe_api";
    var firstScriptTag = document.getElementsByTagName('script')[0];
    firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
}

window.onYouTubeIframeAPIReady = function () {
    player = new YT.Player('player', {
        height: '100%',
        width: '100%',
        videoId: 'ruxJacIFKL4',
        playerVars: {
            'playsinline': 1,
            'modestbranding': 1,
            'rel': 0,
            'origin': window.location.origin
        },
        events: {
            'onReady': onPlayerReady,
            'onStateChange': onPlayerStateChange,
            'onError': onPlayerError
        }
    });
}

function onPlayerReady(event) {
    startTimer();
}

function onPlayerStateChange(event) {
    if (event.data == YT.PlayerState.PLAYING) {
        startTimer();
    } else {
        stopTimer();
    }
}

function onPlayerError(event) {
    if (event.data === 150 || event.data === 101 || event.data === 153) {
        document.getElementById('error-overlay').style.display = 'flex';
    }
}

function startTimer() {
    stopTimer();
    timerInterval = setInterval(checkTime, 200);
}

function stopTimer() {
    clearInterval(timerInterval);
}

function seekToLine(index) {
    if (index >= 0 && index < lyricsData.length) {
        player.seekTo(lyricsData[index].time, true);
        player.playVideo();
        updateActiveLyric(index);
    }
}

function checkTime() {
    if (!player || !player.getCurrentTime) return;

    const currentTime = player.getCurrentTime();

    if (isLooping && currentLyricIndex !== -1 && currentLyricIndex < lyricsData.length - 1) {
        const nextTime = lyricsData[currentLyricIndex + 1].time;
        if (currentTime >= nextTime - 0.2) {
            player.seekTo(lyricsData[currentLyricIndex].time, true);
            return;
        }
    }

    let activeIndex = -1;
    for (let i = 0; i < lyricsData.length; i++) {
        const t = lyricsData[i].time;
        if (t !== null && currentTime >= t) {
            activeIndex = i;
        } else {
            if (t !== null) break;
        }
    }

    if (activeIndex !== currentLyricIndex) {
        updateActiveLyric(activeIndex);
    }
}

function updateActiveLyric(index) {
    if (index === -1) return;

    const prev = document.querySelector('.lyric-item.active');
    if (prev) prev.classList.remove('active');

    const current = els.lyricsContainer.children[index];
    if (current) {
        current.classList.add('active');
        currentLyricIndex = index;

        current.scrollIntoView({
            behavior: 'smooth',
            block: 'center'
        });
    }
}

// Start
init();
