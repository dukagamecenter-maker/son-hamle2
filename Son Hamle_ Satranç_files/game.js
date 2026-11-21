const FILES = 'abcdefgh';
const PIECE_GLYPHS = {
    white: { k: '♔', q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' },
    black: { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' }
};
const PIECE_NAMES = { k: 'Şah', q: 'Vezir', r: 'Kale', b: 'Fil', n: 'At', p: 'Piyon' };
const PIECE_VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };
const DIFFICULTY_NAMES = { easy: 'Kolay', medium: 'Orta', hard: 'Zor' };
const START_BACK_ROW = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
const SETTINGS_STORAGE_KEY = 'son-hamle.settings.v1';
const ACHIEVEMENTS_STORAGE_KEY = 'son-hamle.achievements.v1';
const RANK_EVENT_STORAGE_KEY = 'son-hamle.rank-event.v1';
const RANK_EVENT_WINS_PER_TIER = 3;
const RANK_EVENT_TIERS = [
    { name: 'Bronz', difficulty: 'easy' },
    { name: 'Gümüş', difficulty: 'easy' },
    { name: 'Altın', difficulty: 'medium' },
    { name: 'Platin', difficulty: 'medium' },
    { name: 'Elmas', difficulty: 'hard' },
    { name: 'Usta', difficulty: 'hard' },
    { name: 'Büyük Usta', difficulty: 'hard' }
];
const DEFAULT_SETTINGS = {
    version: 1,
    theme: 'dark',
    musicEnabled: false,
    soundEffects: false,
    duelAnimations: true,
    showMoveHints: true,
    boardFlipped: false
};
const DEFAULT_ACHIEVEMENTS = { version: 1, moves: 0, captures: 0, checkmates: 0, computerWins: 0 };
const DEFAULT_RANK_EVENT_PROGRESS = { version: 1, rankIndex: 0, wins: 0 };
const MUSIC_SEQUENCE = [146.83, 174.61, 220, 196, 130.81, 164.81, 220, 174.61];

let storageWarnings = [];
let rankEventNotice = '';
let audioNotice = '';
let audioContext = null;
let musicBus = null;
let effectsBus = null;
let musicTimer = null;
let musicStep = 0;

function isValidSettings(value) {
    return value?.version === 1
        && (value.theme === 'dark' || value.theme === 'light')
        && typeof value.musicEnabled === 'boolean'
        && typeof value.soundEffects === 'boolean'
        && typeof value.duelAnimations === 'boolean'
        && typeof value.showMoveHints === 'boolean'
        && typeof value.boardFlipped === 'boolean';
}

function isLegacySettings(value) {
    return value?.version === 1
        && typeof value.duelAnimations === 'boolean'
        && typeof value.boardFlipped === 'boolean'
        && !('theme' in value)
        && !('musicEnabled' in value)
        && !('soundEffects' in value)
        && !('showMoveHints' in value);
}

function loadSettings() {
    const stored = readStoredData(
        SETTINGS_STORAGE_KEY,
        DEFAULT_SETTINGS,
        value => isValidSettings(value) || isLegacySettings(value),
        'Ayarlar'
    );
    if (!isLegacySettings(stored)) return stored;
    const migrated = { ...DEFAULT_SETTINGS, ...stored };
    saveStoredData(SETTINGS_STORAGE_KEY, migrated, 'Ayarlar');
    return migrated;
}

function isValidAchievements(value) {
    return value?.version === 1
        && ['moves', 'captures', 'checkmates', 'computerWins'].every(key => Number.isSafeInteger(value[key]) && value[key] >= 0);
}

function isValidRankEventProgress(value) {
    return value?.version === 1
        && Number.isSafeInteger(value.rankIndex)
        && value.rankIndex >= 0
        && value.rankIndex <= RANK_EVENT_TIERS.length
        && Number.isSafeInteger(value.wins)
        && value.wins >= 0
        && value.wins < RANK_EVENT_WINS_PER_TIER
        && (value.rankIndex < RANK_EVENT_TIERS.length || value.wins === 0);
}

function updateStorageStatus() {
    const message = [...storageWarnings, audioNotice].filter(Boolean).join(' ');
    for (const id of ['settings-status', 'achievement-status', 'rank-event-status']) {
        const status = document.getElementById(id);
        if (status) status.textContent = id === 'rank-event-status'
            ? [rankEventNotice, message].filter(Boolean).join(' ')
            : message;
    }
}

function addStorageWarning(message) {
    if (!storageWarnings.includes(message)) storageWarnings.push(message);
    updateStorageStatus();
}

function readStoredData(key, fallback, validate, label) {
    let raw;
    try {
        raw = window.localStorage.getItem(key);
    } catch (error) {
        if (!(error instanceof DOMException)) throw error;
        addStorageWarning(`${label} bu cihazda okunamadı.`);
        return { ...fallback };
    }
    if (raw === null) return { ...fallback };

    let value;
    try {
        value = JSON.parse(raw);
    } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        addStorageWarning(`${label} kaydı bozuk; varsayılanlar kullanılıyor.`);
        return { ...fallback };
    }
    if (!validate(value)) {
        addStorageWarning(`${label} kaydı tanınmıyor; varsayılanlar kullanılıyor.`);
        return { ...fallback };
    }
    return value;
}

function saveStoredData(key, value, label) {
    try {
        window.localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
        if (!(error instanceof DOMException)) throw error;
        addStorageWarning(`${label} bu cihaza kaydedilemedi.`);
    }
}

async function ensureAudioContext() {
    const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextConstructor) throw new DOMException('Web Audio is unavailable.', 'NotSupportedError');
    if (!audioContext) {
        audioContext = new AudioContextConstructor();
        musicBus = audioContext.createGain();
        effectsBus = audioContext.createGain();
        musicBus.gain.value = settings.musicEnabled ? 0.24 : 0;
        effectsBus.gain.value = settings.soundEffects ? 0.3 : 0;
        musicBus.connect(audioContext.destination);
        effectsBus.connect(audioContext.destination);
    }
    if (audioContext.state === 'suspended') await audioContext.resume();
    return audioContext;
}

function playTone(bus, frequency, waveform, volume, duration, delay = 0, endFrequency = frequency) {
    if (!audioContext || !bus || audioContext.state !== 'running') return;
    const oscillator = audioContext.createOscillator();
    const envelope = audioContext.createGain();
    const startAt = audioContext.currentTime + delay;
    oscillator.type = waveform;
    oscillator.frequency.setValueAtTime(frequency, startAt);
    if (endFrequency !== frequency) oscillator.frequency.exponentialRampToValueAtTime(endFrequency, startAt + duration);
    envelope.gain.setValueAtTime(0.0001, startAt);
    envelope.gain.exponentialRampToValueAtTime(volume, startAt + 0.1);
    envelope.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
    oscillator.connect(envelope);
    envelope.connect(bus);
    oscillator.start(startAt);
    oscillator.stop(startAt + duration + 0.02);
}

function playCaptureSound(pieceType) {
    switch (pieceType) {
        case 'p':
            playTone(effectsBus, 260, 'triangle', 0.075, 0.16, 0, 170);
            playTone(effectsBus, 430, 'sine', 0.035, 0.19, 0.035);
            break;
        case 'n':
            playTone(effectsBus, 470, 'sine', 0.055, 0.24, 0, 760);
            playTone(effectsBus, 760, 'triangle', 0.04, 0.19, 0.17, 430);
            playTone(effectsBus, 430, 'sine', 0.03, 0.18, 0.34, 570);
            break;
        case 'b':
            playTone(effectsBus, 784, 'sine', 0.045, 0.48);
            playTone(effectsBus, 1046.5, 'triangle', 0.032, 0.56, 0.07);
            playTone(effectsBus, 1318.5, 'sine', 0.022, 0.42, 0.15);
            break;
        case 'r':
            playTone(effectsBus, 145, 'triangle', 0.11, 0.32, 0, 76);
            playTone(effectsBus, 290, 'square', 0.035, 0.12, 0.025, 180);
            break;
        case 'q':
            playTone(effectsBus, 920, 'sawtooth', 0.035, 0.18, 0, 380);
            playTone(effectsBus, 620, 'triangle', 0.055, 0.25, 0.02, 280);
            playTone(effectsBus, 1244.5, 'sine', 0.03, 0.44, 0.06);
            break;
        case 'k':
            playTone(effectsBus, 110, 'triangle', 0.11, 0.42, 0, 72);
            playTone(effectsBus, 330, 'sawtooth', 0.035, 0.3, 0.035, 250);
            playTone(effectsBus, 659.3, 'sine', 0.025, 0.52, 0.1);
            break;
    }
}

function playMusicStep() {
    if (!settings.musicEnabled || !audioContext || audioContext.state !== 'running') return;
    const note = MUSIC_SEQUENCE[musicStep % MUSIC_SEQUENCE.length];
    playTone(musicBus, note, 'sine', 0.055, 1.65);
    if (musicStep % 4 === 0) playTone(musicBus, note / 2, 'triangle', 0.035, 2.1, 0.08);
    if (musicStep % 2 === 1) playTone(musicBus, note * 2, 'sine', 0.018, 0.8, 0.2);
    musicStep++;
}

async function startMusic() {
    const context = await ensureAudioContext();
    musicBus.gain.setTargetAtTime(0.24, context.currentTime, 0.22);
    if (musicTimer !== null) return;
    playMusicStep();
    musicTimer = window.setInterval(playMusicStep, 1450);
}

function stopMusic() {
    if (musicTimer !== null) {
        clearInterval(musicTimer);
        musicTimer = null;
    }
    if (audioContext && musicBus) musicBus.gain.setTargetAtTime(0, audioContext.currentTime, 0.12);
}

async function startConfiguredMusic() {
    if (!settings.musicEnabled) return;
    try {
        await startMusic();
        audioNotice = '';
        updateStorageStatus();
    } catch (error) {
        if (!(error instanceof DOMException)) throw error;
        settings.musicEnabled = false;
        audioNotice = 'Oyun müziği bu tarayıcıda başlatılamadı.';
        saveStoredData(SETTINGS_STORAGE_KEY, settings, 'Ayarlar');
        renderSettings();
    }
}

async function playGameSound(isCapture, capturingPieceType) {
    if (!settings.soundEffects) return;
    try {
        await ensureAudioContext();
        if (!settings.soundEffects) return;
        if (isCapture) {
            playCaptureSound(capturingPieceType);
        } else {
            playTone(effectsBus, 261.63, 'sine', 0.06, 0.12);
        }
    } catch (error) {
        if (!(error instanceof DOMException)) throw error;
        audioNotice = 'Ses efektleri bu tarayıcıda başlatılamadı.';
        updateStorageStatus();
    }
}

const settings = loadSettings();
const achievementProgress = readStoredData(ACHIEVEMENTS_STORAGE_KEY, DEFAULT_ACHIEVEMENTS, isValidAchievements, 'Ödüller');
const rankEventProgress = readStoredData(
    RANK_EVENT_STORAGE_KEY,
    DEFAULT_RANK_EVENT_PROGRESS,
    isValidRankEventProgress,
    'Rütbe etkinliği'
);
const boardElement = document.getElementById('chessboard');
const duelOverlay = document.getElementById('duel-overlay');
const promotionOverlay = document.getElementById('promotion-overlay');
const menuOverlay = document.getElementById('menu-overlay');
const moveHint = document.getElementById('move-hint');
const moveButton = document.getElementById('undo-move');

let board;
let turn;
let selected = null;
let legalMoves = [];
let enPassantTarget = null;
let flipped = settings.boardFlipped;
let gameOver = false;
let animating = false;
let captured;
let moveHistory;
let lastMove = null;
let pendingPromotion = null;
let duelTimer = null;
let gameMode = 'local';
let aiDifficulty = 'medium';
let aiTimer = null;
let aiThinking = false;
let eventMatchActive = false;
let eventMatchRankIndex = 0;

function makePiece(type, color) {
    return { type, color, moved: false };
}

function resetGame() {
    clearTimeout(duelTimer);
    clearTimeout(aiTimer);
    aiTimer = null;
    aiThinking = false;
    board = Array.from({ length: 8 }, () => Array(8).fill(null));
    for (let file = 0; file < 8; file++) {
        board[0][file] = makePiece(START_BACK_ROW[file], 'black');
        board[1][file] = makePiece('p', 'black');
        board[6][file] = makePiece('p', 'white');
        board[7][file] = makePiece(START_BACK_ROW[file], 'white');
    }
    turn = 'white';
    selected = null;
    legalMoves = [];
    enPassantTarget = null;
    gameOver = false;
    animating = false;
    captured = { white: [], black: [] };
    moveHistory = [];
    lastMove = null;
    pendingPromotion = null;
    duelOverlay.classList.remove('visible');
    duelOverlay.setAttribute('aria-hidden', 'true');
    promotionOverlay.classList.remove('visible');
    promotionOverlay.setAttribute('aria-hidden', 'true');
    render();
}

function inBounds(row, col) {
    return row >= 0 && row < 8 && col >= 0 && col < 8;
}

function opposite(color) {
    return color === 'white' ? 'black' : 'white';
}

function squareName(row, col) {
    return `${FILES[col]}${8 - row}`;
}

function findKing(color, position = board) {
    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            const piece = position[row][col];
            if (piece?.type === 'k' && piece.color === color) return { row, col };
        }
    }
    return null;
}

function isSquareAttacked(row, col, byColor, position = board) {
    const pawnSourceRow = row + (byColor === 'white' ? 1 : -1);
    for (const pawnCol of [col - 1, col + 1]) {
        if (inBounds(pawnSourceRow, pawnCol)) {
            const piece = position[pawnSourceRow][pawnCol];
            if (piece?.color === byColor && piece.type === 'p') return true;
        }
    }

    for (const [dr, dc] of [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]) {
        const r = row + dr;
        const c = col + dc;
        if (inBounds(r, c) && position[r][c]?.color === byColor && position[r][c]?.type === 'n') return true;
    }

    for (const [dr, dc, types] of [
        [-1, 0, ['r', 'q']], [1, 0, ['r', 'q']], [0, -1, ['r', 'q']], [0, 1, ['r', 'q']],
        [-1, -1, ['b', 'q']], [-1, 1, ['b', 'q']], [1, -1, ['b', 'q']], [1, 1, ['b', 'q']]
    ]) {
        let r = row + dr;
        let c = col + dc;
        let first = true;
        while (inBounds(r, c)) {
            const piece = position[r][c];
            if (piece) {
                if (piece.color === byColor && (types.includes(piece.type) || (first && piece.type === 'k'))) return true;
                break;
            }
            first = false;
            r += dr;
            c += dc;
        }
    }
    return false;
}

function isInCheck(color, position = board) {
    const king = findKing(color, position);
    return king ? isSquareAttacked(king.row, king.col, opposite(color), position) : true;
}

function pseudoMoves(row, col, position = board, epTarget = enPassantTarget) {
    const piece = position[row][col];
    if (!piece) return [];
    const moves = [];
    const add = (toRow, toCol, extra = {}) => {
        if (!inBounds(toRow, toCol)) return false;
        const target = position[toRow][toCol];
        if (target?.color === piece.color || target?.type === 'k') return false;
        moves.push({ fromRow: row, fromCol: col, toRow, toCol, ...extra });
        return !target;
    };

    if (piece.type === 'p') {
        const direction = piece.color === 'white' ? -1 : 1;
        const startRow = piece.color === 'white' ? 6 : 1;
        const oneRow = row + direction;
        if (inBounds(oneRow, col) && !position[oneRow][col]) {
            add(oneRow, col);
            const twoRow = row + direction * 2;
            if (row === startRow && !position[twoRow][col]) add(twoRow, col, { doublePawn: true });
        }
        for (const targetCol of [col - 1, col + 1]) {
            if (!inBounds(oneRow, targetCol)) continue;
            const target = position[oneRow][targetCol];
            if (target?.color === opposite(piece.color)) add(oneRow, targetCol);
            else if (epTarget?.row === oneRow && epTarget.col === targetCol) {
                moves.push({ fromRow: row, fromCol: col, toRow: oneRow, toCol: targetCol, enPassant: true });
            }
        }
        return moves;
    }

    if (piece.type === 'n') {
        for (const [dr, dc] of [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]) add(row + dr, col + dc);
        return moves;
    }

    if (piece.type === 'k') {
        for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
                if (dr || dc) add(row + dr, col + dc);
            }
        }
        if (!piece.moved && !isSquareAttacked(row, col, opposite(piece.color), position)) {
            for (const [rookCol, targetCol, emptyCols, kingPath] of [
                [7, 6, [5, 6], [5, 6]],
                [0, 2, [1, 2, 3], [3, 2]]
            ]) {
                const rook = position[row][rookCol];
                if (rook?.type !== 'r' || rook.color !== piece.color || rook.moved) continue;
                if (emptyCols.some(emptyCol => position[row][emptyCol])) continue;
                if (kingPath.some(pathCol => isSquareAttacked(row, pathCol, opposite(piece.color), position))) continue;
                moves.push({ fromRow: row, fromCol: col, toRow: row, toCol: targetCol, castle: rookCol === 7 ? 'king' : 'queen' });
            }
        }
        return moves;
    }

    const directions = piece.type === 'r'
        ? [[-1, 0], [1, 0], [0, -1], [0, 1]]
        : piece.type === 'b'
            ? [[-1, -1], [-1, 1], [1, -1], [1, 1]]
            : [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]];
    for (const [dr, dc] of directions) {
        let toRow = row + dr;
        let toCol = col + dc;
        while (add(toRow, toCol)) {
            toRow += dr;
            toCol += dc;
        }
    }
    return moves;
}

function applyMoveToPosition(position, move) {
    const next = position.map(rank => rank.map(piece => piece ? { ...piece } : null));
    const piece = next[move.fromRow][move.fromCol];
    next[move.fromRow][move.fromCol] = null;
    if (move.enPassant) next[move.fromRow][move.toCol] = null;
    if (move.castle) {
        const rookFrom = move.castle === 'king' ? 7 : 0;
        const rookTo = move.castle === 'king' ? 5 : 3;
        next[move.toRow][rookTo] = next[move.toRow][rookFrom];
        next[move.toRow][rookFrom] = null;
        next[move.toRow][rookTo].moved = true;
    }
    next[move.toRow][move.toCol] = { ...piece, moved: true };
    return next;
}

function legalMovesFor(row, col, position = board, epTarget = enPassantTarget) {
    const piece = position[row][col];
    if (!piece) return [];
    return pseudoMoves(row, col, position, epTarget).filter(move => !isInCheck(piece.color, applyMoveToPosition(position, move)));
}

function allLegalMoves(color, position = board, epTarget = enPassantTarget) {
    const moves = [];
    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            if (position[row][col]?.color === color) moves.push(...legalMovesFor(row, col, position, epTarget));
        }
    }
    return moves;
}

function applySearchMove(position, move) {
    const next = applyMoveToPosition(position, move);
    const movedPiece = next[move.toRow][move.toCol];
    if (movedPiece.type === 'p' && (move.toRow === 0 || move.toRow === 7)) movedPiece.type = 'q';
    return next;
}

function nextEnPassantTarget(move) {
    return move.doublePawn ? { row: (move.fromRow + move.toRow) / 2, col: move.fromCol } : null;
}

function orderMoves(moves, position) {
    return moves.sort((a, b) => {
        const score = move => {
            const moving = position[move.fromRow][move.fromCol];
            const captured = move.enPassant ? position[move.fromRow][move.toCol] : position[move.toRow][move.toCol];
            return (captured ? 10000 + PIECE_VALUES[captured.type] - PIECE_VALUES[moving.type] / 10 : 0)
                + (moving.type === 'p' && (move.toRow === 0 || move.toRow === 7) ? 800 : 0)
                + (move.castle ? 50 : 0);
        };
        return score(b) - score(a);
    });
}

function evaluatePosition(position) {
    let score = 0;
    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            const piece = position[row][col];
            if (!piece) continue;
            const side = piece.color === 'white' ? 1 : -1;
            const center = 3.5 - (Math.abs(3.5 - row) + Math.abs(3.5 - col)) / 2;
            const advance = piece.color === 'white' ? 6 - row : row - 1;
            let positional = 0;
            if (piece.type === 'p') positional = advance * 7 + center * 2;
            else if (piece.type === 'n' || piece.type === 'b') positional = center * 8;
            else if (piece.type === 'q' || piece.type === 'r') positional = center * 2;
            score += side * (PIECE_VALUES[piece.type] + positional);
        }
    }
    return score;
}

function searchPosition(position, side, depth, alpha, beta, computerColor, epTarget, ply) {
    const moves = allLegalMoves(side, position, epTarget);
    if (!moves.length) {
        if (!isInCheck(side, position)) return 0;
        return side === computerColor ? -100000 + ply : 100000 - ply;
    }
    if (depth === 0) return evaluatePosition(position) * (computerColor === 'white' ? 1 : -1);

    const maximizing = side === computerColor;
    let bestScore = maximizing ? -Infinity : Infinity;
    for (const move of orderMoves(moves, position)) {
        const nextPosition = applySearchMove(position, move);
        const score = searchPosition(nextPosition, opposite(side), depth - 1, alpha, beta, computerColor, nextEnPassantTarget(move), ply + 1);
        if (maximizing) {
            bestScore = Math.max(bestScore, score);
            alpha = Math.max(alpha, bestScore);
        } else {
            bestScore = Math.min(bestScore, score);
            beta = Math.min(beta, bestScore);
        }
        if (beta <= alpha) break;
    }
    return bestScore;
}

function chooseComputerMove() {
    const moves = allLegalMoves('black', board, enPassantTarget);
    if (!moves.length) return null;
    if (aiDifficulty === 'easy') return moves[Math.floor(Math.random() * moves.length)];

    const depth = aiDifficulty === 'hard' ? 3 : 2;
    let bestMove = null;
    let bestScore = -Infinity;
    let alpha = -Infinity;
    for (const move of orderMoves(moves, board)) {
        const score = searchPosition(
            applySearchMove(board, move),
            'white',
            depth - 1,
            alpha,
            Infinity,
            'black',
            nextEnPassantTarget(move),
            1
        );
        if (score > bestScore) {
            bestScore = score;
            bestMove = move;
        }
        alpha = Math.max(alpha, bestScore);
    }
    return bestMove;
}

function scheduleComputerTurn() {
    if (gameMode !== 'computer' || turn !== 'black' || gameOver || animating || pendingPromotion || aiTimer !== null || aiThinking) return;
    aiThinking = true;
    moveHint.textContent = 'Bilgisayar düşünüyor...';
    render();
    aiTimer = window.setTimeout(() => {
        aiTimer = null;
        if (gameMode !== 'computer' || turn !== 'black' || gameOver || animating) {
            aiThinking = false;
            render();
            return;
        }
        const move = chooseComputerMove();
        aiThinking = false;
        if (move) makeMove(move);
        else render();
    }, 250);
}

function showMenuScreen(screenId) {
    const screenIds = ['menu-home', 'play-options', 'settings-options', 'achievement-options', 'rank-event-options', 'tutorial-options'];
    for (const id of screenIds) {
        document.getElementById(id).hidden = id !== screenId;
    }
    document.querySelector('.game-shell').setAttribute('aria-hidden', 'true');
    menuOverlay.classList.add('visible');
    menuOverlay.setAttribute('aria-hidden', 'false');
    if (screenId === 'settings-options') renderSettings();
    if (screenId === 'achievement-options') renderAchievements();
    if (screenId === 'menu-home' || screenId === 'rank-event-options') renderRankEvent();
    const screen = document.getElementById(screenId);
    const focusTarget = screen.querySelector('.menu-section-heading h2')
        || screen.querySelector('.menu-choice, .setting-toggle, .menu-back');
    if (focusTarget) focusTarget.focus();
}

function showSettingsMenu() {
    void startConfiguredMusic();
    showMenuScreen('settings-options');
}

function showAchievementsMenu() {
    void startConfiguredMusic();
    showMenuScreen('achievement-options');
}

function showRankEventMenu() {
    void startConfiguredMusic();
    showMenuScreen('rank-event-options');
}

function showTutorialMenu() {
    void startConfiguredMusic();
    showMenuScreen('tutorial-options');
}

function showPlayMenu() {
    void startConfiguredMusic();
    document.getElementById('mode-options').hidden = false;
    document.getElementById('difficulty-options').hidden = true;
    showMenuScreen('play-options');
}

function showModeMenu() {
    clearTimeout(aiTimer);
    aiTimer = null;
    aiThinking = false;
    showMenuScreen('menu-home');
}

function showDifficultyMenu() {
    document.getElementById('mode-options').hidden = true;
    document.getElementById('difficulty-options').hidden = false;
    document.querySelector('#difficulty-options .difficulty-choice').focus();
}

function applyTheme() {
    document.body.dataset.palette = settings.theme;
    document.querySelectorAll('[data-theme-choice]').forEach(button => {
        button.setAttribute('aria-pressed', String(button.dataset.themeChoice === settings.theme));
    });
}

function renderSettings() {
    applyTheme();
    document.getElementById('setting-music').checked = settings.musicEnabled;
    document.getElementById('setting-sound-effects').checked = settings.soundEffects;
    document.getElementById('setting-animations').checked = settings.duelAnimations;
    document.getElementById('setting-move-hints').checked = settings.showMoveHints;
    document.getElementById('setting-flip-board').checked = settings.boardFlipped;
    updateStorageStatus();
}

function saveSettings() {
    saveStoredData(SETTINGS_STORAGE_KEY, settings, 'Ayarlar');
    document.getElementById('setting-flip-board').checked = settings.boardFlipped;
    render();
}

async function updateSoundEffectsSetting() {
    if (!settings.soundEffects) {
        if (audioContext && effectsBus) effectsBus.gain.setTargetAtTime(0, audioContext.currentTime, 0.12);
        saveSettings();
        renderSettings();
        return;
    }
    try {
        const context = await ensureAudioContext();
        effectsBus.gain.setTargetAtTime(0.3, context.currentTime, 0.12);
        audioNotice = '';
    } catch (error) {
        if (!(error instanceof DOMException)) throw error;
        settings.soundEffects = false;
        audioNotice = 'Ses efektleri bu tarayıcıda başlatılamadı.';
    }
    saveSettings();
    renderSettings();
}

function achievementDefinitions() {
    return [
        { title: 'İlk Hamle', description: 'Tahtadaki ilk hamleni yap.', icon: '♙', value: achievementProgress.moves, goal: 1 },
        { title: 'İlk Darbe', description: 'Rakibinden ilk taşı al.', icon: '⚔', value: achievementProgress.captures, goal: 1 },
        { title: 'Kale Avcısı', description: 'Toplam 10 taş ele geçir.', icon: '♜', value: achievementProgress.captures, goal: 10 },
        { title: 'Şah Mat Ustası', description: 'Bir oyunu şah mat ile bitir.', icon: '♛', value: achievementProgress.checkmates, goal: 1 },
        { title: 'Bilgisayar Fatihi', description: 'Bilgisayara karşı bir oyun kazan.', icon: '♚', value: achievementProgress.computerWins, goal: 1 }
    ];
}

function renderAchievements() {
    const list = document.getElementById('achievement-list');
    const fragment = document.createDocumentFragment();
    for (const achievement of achievementDefinitions()) {
        const unlocked = achievement.value >= achievement.goal;
        const card = document.createElement('article');
        card.className = `achievement-card ${unlocked ? 'unlocked' : 'locked'}`;
        const icon = document.createElement('span');
        icon.className = 'achievement-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = achievement.icon;
        const copy = document.createElement('span');
        copy.className = 'achievement-copy';
        const title = document.createElement('strong');
        title.textContent = achievement.title;
        const description = document.createElement('small');
        description.textContent = achievement.description;
        copy.append(title, description);
        const count = document.createElement('span');
        count.className = 'achievement-count';
        count.textContent = unlocked ? 'AÇILDI' : `${Math.min(achievement.value, achievement.goal)} / ${achievement.goal}`;
        const meter = document.createElement('div');
        meter.className = 'achievement-meter';
        meter.setAttribute('role', 'progressbar');
        meter.setAttribute('aria-label', `${achievement.title} ilerlemesi`);
        meter.setAttribute('aria-valuemin', '0');
        meter.setAttribute('aria-valuemax', String(achievement.goal));
        meter.setAttribute('aria-valuenow', String(Math.min(achievement.value, achievement.goal)));
        const fill = document.createElement('span');
        fill.style.width = `${Math.min(achievement.value / achievement.goal, 1) * 100}%`;
        meter.append(fill);
        card.append(icon, copy, count, meter);
        fragment.append(card);
    }
    list.replaceChildren(fragment);
    updateStorageStatus();
}

function renderRankEvent() {
    const currentTier = RANK_EVENT_TIERS[rankEventProgress.rankIndex];
    const homeProgress = document.getElementById('rank-event-home-progress');
    const currentLabel = document.getElementById('rank-event-current');
    const progressLabel = document.getElementById('rank-event-progress');
    const ladder = document.getElementById('rank-event-ladder');
    const playButton = document.getElementById('rank-event-play');

    homeProgress.textContent = currentTier
        ? `${currentTier.name} aşaması • ${rankEventProgress.wins} / ${RANK_EVENT_WINS_PER_TIER} galibiyet`
        : 'Tamamlandı • tüm rütbeler açıldı';
    currentLabel.textContent = currentTier ? `${currentTier.name} aşaması` : 'Etkinlik tamamlandı';
    progressLabel.textContent = currentTier
        ? `${rankEventProgress.wins} / ${RANK_EVENT_WINS_PER_TIER} galibiyet`
        : 'Tüm rütbeler açıldı';
    playButton.disabled = !currentTier;
    playButton.textContent = currentTier ? `${currentTier.name} aşamasına başla` : 'Etkinlik tamamlandı';

    const fragment = document.createDocumentFragment();
    RANK_EVENT_TIERS.forEach((tier, index) => {
        const complete = index < rankEventProgress.rankIndex;
        const current = index === rankEventProgress.rankIndex;
        const stage = document.createElement('li');
        stage.className = `rank-event-stage ${complete ? 'complete' : current ? 'current' : 'locked'}`;
        if (current) stage.setAttribute('aria-current', 'step');

        const medal = document.createElement('span');
        medal.className = 'rank-event-medal';
        medal.setAttribute('aria-hidden', 'true');
        medal.textContent = String(index + 1).padStart(2, '0');

        const copy = document.createElement('span');
        copy.className = 'rank-event-stage-copy';
        const name = document.createElement('strong');
        name.textContent = tier.name;
        const difficulty = document.createElement('small');
        difficulty.textContent = `Bilgisayar • ${DIFFICULTY_NAMES[tier.difficulty]}`;
        copy.append(name, difficulty);

        const progress = document.createElement('span');
        progress.className = 'rank-event-stage-progress';
        progress.textContent = complete
            ? 'TAMAMLANDI'
            : current
                ? `${rankEventProgress.wins} / ${RANK_EVENT_WINS_PER_TIER}`
                : 'KİLİTLİ';
        stage.append(medal, copy, progress);
        fragment.append(stage);
    });
    ladder.replaceChildren(fragment);
    updateStorageStatus();
}

function recordCompletedMove(capturedPiece, attacker) {
    achievementProgress.moves++;
    if (capturedPiece) achievementProgress.captures++;
    saveStoredData(ACHIEVEMENTS_STORAGE_KEY, achievementProgress, 'Ödüller');
    renderAchievements();
    void playGameSound(Boolean(capturedPiece), capturedPiece ? attacker.type : null);
}

function recordRankEventWin() {
    const tier = RANK_EVENT_TIERS[rankEventProgress.rankIndex];
    if (!tier) return;

    rankEventProgress.wins++;
    if (rankEventProgress.wins === RANK_EVENT_WINS_PER_TIER) {
        rankEventProgress.rankIndex++;
        rankEventProgress.wins = 0;
        const nextTier = RANK_EVENT_TIERS[rankEventProgress.rankIndex];
        rankEventNotice = nextTier
            ? `${tier.name} tamamlandı! ${nextTier.name} aşaması açıldı.`
            : 'Etkinlik tamamlandı! Tüm rütbeleri açtın.';
    } else {
        rankEventNotice = `${tier.name} aşaması: ${rankEventProgress.wins} / ${RANK_EVENT_WINS_PER_TIER} galibiyet.`;
    }
    saveStoredData(RANK_EVENT_STORAGE_KEY, rankEventProgress, 'Rütbe etkinliği');
    renderRankEvent();
}

function recordCheckmate() {
    achievementProgress.checkmates++;
    if (gameMode === 'computer' && opposite(turn) === 'white') {
        achievementProgress.computerWins++;
        if (eventMatchActive) recordRankEventWin();
    }
    saveStoredData(ACHIEVEMENTS_STORAGE_KEY, achievementProgress, 'Ödüller');
    renderAchievements();
}

function startSelectedGame(mode, difficulty = aiDifficulty, isEventMatch = false) {
    gameMode = mode;
    aiDifficulty = difficulty;
    eventMatchActive = isEventMatch;
    eventMatchRankIndex = rankEventProgress.rankIndex;
    void startConfiguredMusic();
    menuOverlay.classList.remove('visible');
    menuOverlay.setAttribute('aria-hidden', 'true');
    document.querySelector('.game-shell').removeAttribute('aria-hidden');
    resetGame();
}

function render() {
    boardElement.replaceChildren();
    document.getElementById('flip-board').setAttribute('aria-pressed', String(flipped));
    const checkedKing = isInCheck(turn) ? findKing(turn) : null;
    for (let viewRow = 0; viewRow < 8; viewRow++) {
        for (let viewCol = 0; viewCol < 8; viewCol++) {
            const row = flipped ? 7 - viewRow : viewRow;
            const col = flipped ? 7 - viewCol : viewCol;
            const piece = board[row][col];
            const square = document.createElement('button');
            square.className = `square ${(row + col) % 2 === 0 ? 'light' : 'dark'}`;
            square.type = 'button';
            square.dataset.row = String(row);
            square.dataset.col = String(col);
            square.setAttribute('role', 'gridcell');
            square.setAttribute('aria-label', `${squareName(row, col)}${piece ? ` ${piece.color === 'white' ? 'beyaz' : 'siyah'} ${PIECE_NAMES[piece.type]}` : ''}`);
            if (selected?.row === row && selected.col === col) square.classList.add('selected');
            if (lastMove && ((lastMove.fromRow === row && lastMove.fromCol === col) || (lastMove.toRow === row && lastMove.toCol === col))) square.classList.add('last-move');
            if (checkedKing?.row === row && checkedKing.col === col) square.classList.add('check-square');
            const move = settings.showMoveHints
                ? legalMoves.find(candidate => candidate.toRow === row && candidate.toCol === col)
                : null;
            if (move) {
                square.classList.add(piece ? 'legal-capture' : 'legal-empty');
                square.setAttribute('aria-label', `${square.getAttribute('aria-label')}, ${piece ? 'taş alma hedefi' : 'hamle hedefi'}`);
            }
            if (viewCol === 0) {
                const rank = document.createElement('span');
                rank.className = 'square-label';
                rank.textContent = String(8 - row);
                square.append(rank);
            }
            if (viewRow === 7) {
                const file = document.createElement('span');
                file.className = 'square-label';
                file.style.left = 'auto';
                file.style.right = '3px';
                file.style.bottom = 'auto';
                file.style.top = '1px';
                file.textContent = FILES[col];
                square.append(file);
            }
            if (piece) {
                const pieceElement = document.createElement('span');
                pieceElement.className = `piece ${piece.color}`;
                pieceElement.dataset.piece = piece.type;
                pieceElement.textContent = PIECE_GLYPHS[piece.color][piece.type];
                pieceElement.setAttribute('aria-hidden', 'true');
                square.append(pieceElement);
            }
            square.addEventListener('click', onSquareClick);
            boardElement.append(square);
        }
    }
    renderStatus();
}

function renderStatus() {
    const check = isInCheck(turn);
    const hasMoves = allLegalMoves(turn).length > 0;
    if (!hasMoves && !gameOver) {
        gameOver = true;
        if (check) recordCheckmate();
    }
    const status = document.getElementById('game-status');
    const detail = document.getElementById('status-detail');
    if (!hasMoves && check) {
        status.textContent = 'Şah mat';
        detail.textContent = eventMatchActive
            ? opposite(turn) === 'white'
                ? rankEventNotice
                : 'Bilgisayar kazandı. Rütbe ilerlemen korundu.'
            : `${turn === 'white' ? 'Siyah' : 'Beyaz'} oyunu kazandı.`;
    } else if (!hasMoves) {
        status.textContent = 'Pat';
        detail.textContent = 'Oyun beraberlikle sonuçlandı.';
    } else if (check) {
        status.textContent = 'Şah!';
        detail.textContent = 'Şahı tehdit altındaki taraf hamle yapmalı.';
    } else if (aiThinking) {
        status.textContent = 'Bilgisayar düşünüyor';
        detail.textContent = 'Hamlesi hazırlanıyor.';
    } else {
        status.textContent = lastMove ? 'Oyun devam ediyor' : 'Açılış hamlesi';
        detail.textContent = lastMove ? 'Tahtadaki taşlarından birini seç.' : 'Taşlarından birini seçerek başla.';
    }
    const turnLabel = document.getElementById('turn-label');
    if (!hasMoves) turnLabel.textContent = check ? `${turn === 'white' ? 'Siyah' : 'Beyaz'} kazandı` : 'Berabere';
    else if (gameMode === 'computer' && turn === 'black') turnLabel.textContent = aiThinking ? 'Bilgisayar düşünüyor' : 'Bilgisayar oynuyor';
    else turnLabel.textContent = `${turn === 'white' ? 'Beyaz' : 'Siyah'} oynuyor`;
    document.querySelector('.black-player-card .player-copy strong').textContent = gameMode === 'computer' ? 'BİLGİSAYAR' : 'SİYAH TARAF';
    document.getElementById('turn-icon').textContent = PIECE_GLYPHS[turn].k;
    document.getElementById('white-status').textContent = gameOver ? 'Oyun tamamlandı' : turn === 'white' ? 'Sıra sende' : gameMode === 'computer' ? 'Bilgisayar oynuyor' : 'Rakip oynuyor';
    document.getElementById('black-status').textContent = gameOver ? 'Oyun tamamlandı' : gameMode === 'computer' ? aiThinking ? 'Düşünüyor...' : 'Bilgisayar' : turn === 'black' ? 'Sıra sende' : 'Rakip oynuyor';
    document.getElementById('mode-note').textContent = gameMode === 'computer'
        ? eventMatchActive
            ? `Rütbe etkinliği • ${RANK_EVENT_TIERS[eventMatchRankIndex]?.name || 'Tamamlandı'} • Zorluk: ${DIFFICULTY_NAMES[aiDifficulty]}.`
            : `Bilgisayara karşı • Zorluk: ${DIFFICULTY_NAMES[aiDifficulty]}.`
        : 'İki kişi aynı cihazda oynar. Taş alma anındaki düelloyu istersen atlayabilirsin.';
    document.querySelector('.white-player-card').classList.toggle('active-card', turn === 'white' && !gameOver);
    document.querySelector('.black-player-card').classList.toggle('active-card', turn === 'black' && !gameOver);
    document.getElementById('white-turn-dot').style.background = turn === 'white' && !gameOver ? 'var(--gold)' : 'transparent';
    document.getElementById('black-turn-dot').style.background = turn === 'black' && !gameOver ? 'var(--gold)' : 'transparent';
    document.getElementById('white-captured').replaceChildren(...captured.white.map(piece => capturedElement(piece)));
    document.getElementById('black-captured').replaceChildren(...captured.black.map(piece => capturedElement(piece)));
    document.getElementById('white-captured-count').textContent = String(captured.white.length);
    document.getElementById('black-captured-count').textContent = String(captured.black.length);
    document.getElementById('last-move').textContent = lastMove ? `${squareName(lastMove.fromRow, lastMove.fromCol)} → ${squareName(lastMove.toRow, lastMove.toCol)}` : '—';
    moveButton.disabled = moveHistory.length === 0 || animating || Boolean(pendingPromotion) || aiThinking;
}

function capturedElement(piece) {
    const element = document.createElement('span');
    element.className = `captured-piece ${piece.color}`;
    element.textContent = PIECE_GLYPHS[piece.color][piece.type];
    element.title = `${piece.color === 'white' ? 'Beyaz' : 'Siyah'} ${PIECE_NAMES[piece.type]}`;
    return element;
}

function onSquareClick(event) {
    if (animating || gameOver || aiThinking || (gameMode === 'computer' && turn === 'black')) return;
    const row = Number(event.currentTarget.dataset.row);
    const col = Number(event.currentTarget.dataset.col);
    const piece = board[row][col];
    const targetMove = legalMoves.find(move => move.toRow === row && move.toCol === col);
    if (selected && targetMove) {
        makeMove(targetMove);
        return;
    }
    if (piece?.color === turn) {
        selected = { row, col };
        legalMoves = legalMovesFor(row, col);
        moveHint.textContent = legalMoves.length ? 'Hedef kareyi seç.' : 'Bu taş şu anda hamle yapamıyor.';
    } else {
        selected = null;
        legalMoves = [];
        moveHint.textContent = piece
            ? `${turn === 'white' ? 'Beyaz' : 'Siyah'} oynuyor; o tarafın taşlarından birini seç.`
            : 'Kendi taşlarından birini seç.';
    }
    render();
}

function makeMove(move) {
    const piece = board[move.fromRow][move.fromCol];
    const capturedPiece = move.enPassant ? board[move.fromRow][move.toCol] : board[move.toRow][move.toCol];
    const record = {
        board: board.map(rank => rank.map(item => item ? { ...item } : null)),
        turn,
        enPassantTarget: enPassantTarget ? { ...enPassantTarget } : null,
        captured: { white: [...captured.white], black: [...captured.black] },
        lastMove: lastMove ? { ...lastMove } : null
    };
    moveHistory.push(record);
    if (capturedPiece) captured[capturedPiece.color].push({ ...capturedPiece });
    board = applyMoveToPosition(board, move);
    enPassantTarget = move.doublePawn ? { row: (move.fromRow + move.toRow) / 2, col: move.fromCol } : null;
    if (piece.type === 'p' && (move.toRow === 0 || move.toRow === 7)) {
        if (gameMode === 'computer' && piece.color === 'black') {
            board[move.toRow][move.toCol].type = 'q';
            completeMove(move, capturedPiece, board[move.toRow][move.toCol]);
            return;
        }
        pendingPromotion = { move, color: piece.color, capturedPiece };
        showPromotion(piece.color);
        return;
    }
    completeMove(move, capturedPiece, piece);
}

function completeMove(move, capturedPiece, attacker) {
    lastMove = { ...move };
    turn = opposite(turn);
    selected = null;
    legalMoves = [];
    moveHint.textContent = 'Hamle yapıldı.';
    recordCompletedMove(capturedPiece, attacker);
    if (capturedPiece) {
        showDuel(attacker, capturedPiece);
        return;
    }
    render();
    scheduleComputerTurn();
}

function showPromotion(color) {
    const options = document.getElementById('promotion-options');
    options.replaceChildren();
    for (const type of ['q', 'r', 'b', 'n']) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `promotion-choice ${color}`;
        button.textContent = PIECE_GLYPHS[color][type];
        button.setAttribute('aria-label', PIECE_NAMES[type]);
        button.addEventListener('click', () => {
            const { move, color, capturedPiece } = pendingPromotion;
            board[move.toRow][move.toCol].type = type;
            pendingPromotion = null;
            promotionOverlay.classList.remove('visible');
            promotionOverlay.setAttribute('aria-hidden', 'true');
            completeMove(move, capturedPiece, board[move.toRow][move.toCol]);
        }, { once: true });
        options.append(button);
    }
    promotionOverlay.classList.add('visible');
    promotionOverlay.setAttribute('aria-hidden', 'false');
}

function showDuel(attacker, defender) {
    animating = true;
    if (!settings.duelAnimations) {
        finishDuel();
        return;
    }
    const arena = document.getElementById('duel-arena');
    const attackerFigure = document.getElementById('attacker-figure');
    const defenderFigure = document.getElementById('defender-figure');
    arena.dataset.attacker = attacker.type;
    arena.dataset.defender = defender.type;
    attackerFigure.dataset.piece = attacker.type;
    attackerFigure.dataset.color = attacker.color;
    defenderFigure.dataset.piece = defender.type;
    defenderFigure.dataset.color = defender.color;
    const attackerEdge = attackerFigure.offsetLeft + attackerFigure.offsetWidth;
    const gap = Math.max(0, defenderFigure.offsetLeft - attackerEdge);
    const reach = attacker.type === 'n' || attacker.type === 'b' ? 44 : 16;
    const chargeDistance = Math.max(14, gap - reach - 8);
    const impactX = attackerEdge + chargeDistance + reach - 8;
    attackerFigure.style.setProperty('--charge-distance', `${chargeDistance}px`);
    arena.style.setProperty('--impact-x', `${impactX}px`);
    arena.style.setProperty('--attack-start', `${Math.max(0, attackerEdge - 8)}px`);
    arena.style.setProperty('--attack-span', `${Math.max(30, impactX - attackerEdge + 8)}px`);
    const attackerGlyph = PIECE_GLYPHS[attacker.color][attacker.type];
    const defenderGlyph = PIECE_GLYPHS[defender.color][defender.type];
    document.getElementById('attacker-glyph').textContent = attackerGlyph;
    document.getElementById('defender-glyph').textContent = defenderGlyph;
    document.getElementById('attacker-shield-glyph').textContent = attackerGlyph;
    document.getElementById('defender-shield-glyph').textContent = defenderGlyph;
    document.getElementById('attacker-elephant-glyph').textContent = attackerGlyph;
    document.getElementById('defender-elephant-glyph').textContent = defenderGlyph;
    document.getElementById('duel-turn').textContent = `${attacker.color === 'white' ? 'BEYAZ' : 'SİYAH'} HAMLESİ`;
    arena.classList.remove('play-duel');
    void arena.offsetWidth;
    arena.classList.add('play-duel');
    duelOverlay.classList.add('visible');
    duelOverlay.setAttribute('aria-hidden', 'false');
    moveButton.disabled = true;
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 450 : 2850;
    duelTimer = setTimeout(finishDuel, duration);
}

function finishDuel() {
    clearTimeout(duelTimer);
    duelTimer = null;
    animating = false;
    document.getElementById('duel-arena').classList.remove('play-duel');
    duelOverlay.classList.remove('visible');
    duelOverlay.setAttribute('aria-hidden', 'true');
    render();
    scheduleComputerTurn();
}

function undoMove() {
    if (!moveHistory.length || animating || pendingPromotion || aiThinking) return;
    const undoPlies = gameMode === 'computer' && turn === 'white' ? Math.min(2, moveHistory.length) : 1;
    const previousIndex = moveHistory.length - undoPlies;
    const previous = moveHistory[previousIndex];
    moveHistory.splice(previousIndex, undoPlies);
    board = previous.board;
    turn = previous.turn;
    enPassantTarget = previous.enPassantTarget;
    captured = previous.captured;
    lastMove = previous.lastMove;
    selected = null;
    legalMoves = [];
    gameOver = false;
    moveHint.textContent = 'Son hamle geri alındı.';
    render();
}

document.getElementById('new-game').addEventListener('click', resetGame);
document.getElementById('undo-move').addEventListener('click', undoMove);
document.getElementById('return-to-menu').addEventListener('click', showModeMenu);
document.getElementById('play-menu').addEventListener('click', showPlayMenu);
document.getElementById('tutorial-menu').addEventListener('click', showTutorialMenu);
document.getElementById('settings-menu').addEventListener('click', showSettingsMenu);
document.getElementById('rewards-menu').addEventListener('click', showAchievementsMenu);
document.getElementById('rank-event-menu').addEventListener('click', showRankEventMenu);
document.getElementById('rank-event-play').addEventListener('click', () => {
    const tier = RANK_EVENT_TIERS[rankEventProgress.rankIndex];
    if (tier) startSelectedGame('computer', tier.difficulty, true);
});
document.getElementById('rank-event-back').addEventListener('click', showModeMenu);
document.getElementById('play-back').addEventListener('click', showModeMenu);
document.getElementById('local-mode').addEventListener('click', () => startSelectedGame('local'));
document.getElementById('computer-mode').addEventListener('click', showDifficultyMenu);
document.getElementById('menu-back').addEventListener('click', showPlayMenu);
document.getElementById('settings-back').addEventListener('click', showModeMenu);
document.getElementById('achievements-back').addEventListener('click', showModeMenu);
document.getElementById('tutorial-back').addEventListener('click', showModeMenu);
document.querySelectorAll('[data-difficulty]').forEach(button => {
    button.addEventListener('click', () => startSelectedGame('computer', button.dataset.difficulty));
});
document.querySelectorAll('[data-theme-choice]').forEach(button => {
    button.addEventListener('click', () => {
        settings.theme = button.dataset.themeChoice;
        applyTheme();
        saveSettings();
        renderSettings();
    });
});
document.getElementById('setting-music').addEventListener('change', event => {
    settings.musicEnabled = event.currentTarget.checked;
    audioNotice = '';
    if (settings.musicEnabled) void startConfiguredMusic();
    else stopMusic();
    saveSettings();
    renderSettings();
});
document.getElementById('setting-sound-effects').addEventListener('change', event => {
    settings.soundEffects = event.currentTarget.checked;
    audioNotice = '';
    void updateSoundEffectsSetting();
});
document.getElementById('setting-animations').addEventListener('change', event => {
    settings.duelAnimations = event.currentTarget.checked;
    saveSettings();
});
document.getElementById('setting-move-hints').addEventListener('change', event => {
    settings.showMoveHints = event.currentTarget.checked;
    saveSettings();
});
document.getElementById('setting-flip-board').addEventListener('change', event => {
    settings.boardFlipped = event.currentTarget.checked;
    flipped = settings.boardFlipped;
    saveSettings();
});
document.getElementById('flip-board').addEventListener('click', () => {
    flipped = !flipped;
    settings.boardFlipped = flipped;
    saveStoredData(SETTINGS_STORAGE_KEY, settings, 'Ayarlar');
    document.getElementById('setting-flip-board').checked = flipped;
    render();
});
document.getElementById('skip-duel').addEventListener('click', finishDuel);

function startIntro() {
    const intro = document.getElementById('intro-screen');
    const gameShell = document.querySelector('.game-shell');
    const progressBar = document.getElementById('intro-progress');
    const progressFill = document.getElementById('intro-progress-fill');
    const progressText = document.getElementById('intro-percent');
    const chessboard = document.getElementById('intro-board');
    const duration = 2300;

    function updateProgress(progress) {
        const value = Math.round(progress);
        progressBar.setAttribute('aria-valuenow', value);
        progressText.textContent = `${value}%`;
        progressFill.style.width = `${value}%`;
        chessboard.classList.toggle('playing', value >= 24);
        chessboard.classList.toggle('move-complete', value >= 48);
        chessboard.classList.toggle('check', value >= 68);
        chessboard.classList.toggle('checkmate', value >= 78);
    }

    function finishIntro() {
        updateProgress(100);
        document.body.classList.remove('intro-active');
        gameShell.removeAttribute('aria-hidden');
        intro.classList.add('finished');
        intro.setAttribute('aria-hidden', 'true');
        showModeMenu();
        window.setTimeout(() => intro.remove(), 500);
    }

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        updateProgress(100);
        window.setTimeout(finishIntro, 150);
        return;
    }

    const startedAt = performance.now();
    function advance(now) {
        const progress = Math.min(100, ((now - startedAt) / duration) * 100);
        updateProgress(progress);
        if (progress < 100) {
            window.requestAnimationFrame(advance);
        } else {
            window.setTimeout(finishIntro, 520);
        }
    }
    window.requestAnimationFrame(advance);
}

applyTheme();
resetGame();
startIntro();
