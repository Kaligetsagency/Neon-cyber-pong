// --- Game Configuration & State ---
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const WIN_SCORE = 15;

let isHost = true;
let isAI = false;
let peer = null;
let conn = null;
let animationFrameId;

// Internal resolution state
const game = {
    w: 800,
    h: 600,
    playing: false,
    p1: { x: 30, y: 250, w: 15, h: 100, score: 0, color: '#00ffff' },
    p2: { x: 755, y: 250, w: 15, h: 100, score: 0, color: '#ff00ff' },
    ball: { x: 400, y: 300, r: 10, vx: 5, vy: 5, speed: 7, color: '#ffffff' }
};

// --- DOM Elements ---
const screens = {
    lobby: document.getElementById('lobby'),
    game: document.getElementById('game'),
    gameOver: document.getElementById('game-over')
};
const ui = {
    myId: document.getElementById('my-id'),
    joinId: document.getElementById('join-id'),
    status: document.getElementById('connection-status'),
    winnerText: document.getElementById('winner-text'),
    finalScoreText: document.getElementById('final-score-text')
};

// --- Initialization & PeerJS ---
function initPeer() {
    // Uses Google STUN servers to bypass mobile network firewalls
    peer = new Peer({
        config: {
            'iceServers': [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' }
            ]
        }
    });

    peer.on('open', id => ui.myId.innerText = id);

    peer.on('connection', connection => {
        conn = connection;
        isHost = true;
        isAI = false;
        setupConnection();
    });
}

function joinPeer(id) {
    if (!peer) return;
    ui.status.innerText = "Connecting...";
    conn = peer.connect(id);
    isHost = false;
    isAI = false;
    setupConnection();
}

function setupConnection() {
    conn.on('open', () => {
        ui.status.innerText = "Connected!";
        setTimeout(() => startGame(), 1000);
    });

    conn.on('data', data => {
        if (data.type === 'SYNC' && !isHost) {
            game.ball = data.ball;
            game.p1 = data.p1;
            game.p2.score = data.p2.score; // Sync score, but guest controls own paddle Y
        } else if (data.type === 'INPUT' && isHost) {
            game.p2.y = data.y; // Host receives guest paddle position
        } else if (data.type === 'REPLAY') {
            startGame();
        } else if (data.type === 'GAME_OVER' && !isHost) {
            endGame(data.winner);
        }
    });

    conn.on('close', () => {
        alert("Opponent disconnected.");
        showScreen('lobby');
    });
}

// --- Navigation ---
function showScreen(screenName) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[screenName].classList.add('active');
}

// --- Game Logic ---
function resetBall() {
    game.ball.x = game.w / 2;
    game.ball.y = game.h / 2;
    game.ball.speed = 7;
    game.ball.vx = (Math.random() > 0.5 ? 1 : -1) * game.ball.speed;
    game.ball.vy = (Math.random() * 2 - 1) * game.ball.speed;
}

function startGame() {
    game.p1.score = 0;
    game.p2.score = 0;
    game.p1.y = game.h / 2 - game.p1.h / 2;
    game.p2.y = game.h / 2 - game.p2.h / 2;
    resetBall();
    game.playing = true;
    showScreen('game');
    
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    gameLoop();
}

function gameLoop() {
    if (!game.playing) return;

    if (isHost) updatePhysics();
    drawGame();

    if (isHost && !isAI) {
        // Host sends full state to guest
        conn.send({ type: 'SYNC', ball: game.ball, p1: game.p1, p2: game.p2 });
    }

    animationFrameId = requestAnimationFrame(gameLoop);
}

function updatePhysics() {
    // Move Ball
    game.ball.x += game.ball.vx;
    game.ball.y += game.ball.vy;

    // Wall Collision (Top/Bottom)
    if (game.ball.y - game.ball.r < 0 || game.ball.y + game.ball.r > game.h) {
        game.ball.vy *= -1;
    }

    // AI Logic (Extremely Hard - Trajectory Prediction)
    if (isAI) {
        let targetY = game.h / 2; // Default to center
        if (game.ball.vx > 0) { // If ball is moving towards AI
            let timeToIntercept = (game.p2.x - game.ball.x) / game.ball.vx;
            let predictedY = game.ball.y + (game.ball.vy * timeToIntercept);
            
            // Calculate bounces for prediction
            let virtualY = predictedY;
            while (virtualY < 0 || virtualY > game.h) {
                if (virtualY < 0) virtualY = -virtualY;
                if (virtualY > game.h) virtualY = 2 * game.h - virtualY;
            }
            targetY = virtualY;
        }
        
        // Move AI smoothly but fast
        let aiCenter = game.p2.y + game.p2.h / 2;
        game.p2.y += (targetY - aiCenter) * 0.15; // 0.15 represents reaction/speed limitation
        
        // Constrain AI to board
        game.p2.y = Math.max(0, Math.min(game.h - game.p2.h, game.p2.y));
    }

    // Paddle Collisions
    let paddle = (game.ball.x < game.w / 2) ? game.p1 : game.p2;
    if (collision(game.ball, paddle)) {
        // Calculate angle based on where ball hit paddle
        let collidePoint = (game.ball.y - (paddle.y + paddle.h / 2));
        collidePoint = collidePoint / (paddle.h / 2); // Normalize -1 to 1
        let angleRad = (Math.PI / 4) * collidePoint; // Max 45 degree angle

        let direction = (game.ball.x < game.w / 2) ? 1 : -1;
        game.ball.speed += 0.5; // Increase speed on hit!
        game.ball.vx = direction * game.ball.speed * Math.cos(angleRad);
        game.ball.vy = game.ball.speed * Math.sin(angleRad);
    }

    // Scoring
    if (game.ball.x - game.ball.r < 0) {
        game.p2.score++;
        checkWin();
        if(game.playing) resetBall();
    } else if (game.ball.x + game.ball.r > game.w) {
        game.p1.score++;
        checkWin();
        if(game.playing) resetBall();
    }
}

function collision(b, p) {
    p.top = p.y;
    p.bottom = p.y + p.h;
    p.left = p.x;
    p.right = p.x + p.w;

    b.top = b.y - b.r;
    b.bottom = b.y + b.r;
    b.left = b.x - b.r;
    b.right = b.x + b.r;

    return b.right > p.left && b.bottom > p.top && b.left < p.right && b.top < p.bottom;
}

function checkWin() {
    if (game.p1.score >= WIN_SCORE || game.p2.score >= WIN_SCORE) {
        game.playing = false;
        let winnerName = "";
        
        if (game.p1.score >= WIN_SCORE) {
            winnerName = isHost ? "You Win!" : "Opponent Wins!";
            ui.winnerText.className = 'neon-text cyan';
        } else {
            winnerName = isHost ? (isAI ? "Computer Wins! (You Lose)" : "Opponent Wins!") : "You Win!";
            ui.winnerText.className = 'neon-text pink';
        }

        if (isHost && !isAI) conn.send({ type: 'GAME_OVER', winner: winnerName });
        endGame(winnerName);
    }
}

function endGame(winnerText) {
    game.playing = false;
    ui.winnerText.innerText = winnerText;
    ui.finalScoreText.innerText = `${game.p1.score} - ${game.p2.score}`;
    setTimeout(() => showScreen('gameOver'), 500);
}

// --- Rendering ---
function drawRect(x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 15;
    ctx.fillRect(x, y, w, h);
    ctx.shadowBlur = 0; // Reset
}

function drawCircle(x, y, r, color) {
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 20;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2, false);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
}

function drawText(text, x, y, color) {
    ctx.fillStyle = color;
    ctx.font = "50px Courier New";
    ctx.fillText(text, x, y);
}

function drawGame() {
    // Clear canvas
    ctx.fillStyle = "rgba(5, 5, 16, 0.5)"; // Trail effect
    ctx.fillRect(0, 0, game.w, game.h);

    // Center Net
    for (let i = 0; i <= game.h; i += 40) {
        drawRect(game.w / 2 - 1, i, 2, 20, "rgba(255,255,255,0.2)");
    }

    drawText(game.p1.score, game.w / 4, 100, game.p1.color);
    drawText(game.p2.score, 3 * game.w / 4, 100, game.p2.color);

    drawRect(game.p1.x, game.p1.y, game.p1.w, game.p1.h, game.p1.color);
    drawRect(game.p2.x, game.p2.y, game.p2.w, game.p2.h, game.p2.color);

    drawCircle(game.ball.x, game.ball.y, game.ball.r, game.ball.color);
}

// --- Input Handling ---
function handleInput(e) {
    if (!game.playing) return;
    
    // Normalize input to canvas internal resolution
    const rect = canvas.getBoundingClientRect();
    const scaleY = canvas.height / rect.height;
    
    // Support both mouse and touch
    let clientY = e.touches ? e.touches[0].clientY : e.clientY;
    let yPos = (clientY - rect.top) * scaleY;
    
    // Center paddle on cursor/finger
    let newY = yPos - game.p1.h / 2;
    
    // Keep inside bounds
    newY = Math.max(0, Math.min(game.h - game.p1.h, newY));

    if (isHost) {
        game.p1.y = newY;
    } else {
        game.p2.y = newY; // Guest controls right paddle locally
        conn.send({ type: 'INPUT', y: newY });
    }
}

canvas.addEventListener('mousemove', handleInput);
canvas.addEventListener('touchmove', handleInput, { passive: false });

// --- Event Listeners ---
document.getElementById('btn-ai').addEventListener('click', () => {
    isAI = true;
    isHost = true;
    startGame();
});

document.getElementById('btn-copy-id').addEventListener('click', () => {
    navigator.clipboard.writeText(ui.myId.innerText);
    alert("ID Copied!");
});

document.getElementById('btn-join').addEventListener('click', () => {
    const id = ui.joinId.value;
    if (id) joinPeer(id);
});

document.getElementById('btn-replay').addEventListener('click', () => {
    if (!isAI && conn) conn.send({ type: 'REPLAY' });
    startGame();
});

document.getElementById('btn-menu').addEventListener('click', () => {
    if (conn) { conn.close(); conn = null; }
    isAI = false;
    showScreen('lobby');
});

// Start PeerJS
initPeer();
