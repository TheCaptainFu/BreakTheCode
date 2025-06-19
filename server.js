const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

// Security middleware
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

const app = express();
const server = http.createServer(app);

// Security configuration
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            connectSrc: ["'self'", "ws:", "wss:"],
            imgSrc: ["'self'", "data:"]
        }
    }
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
});
app.use(limiter);

// Stricter rate limiting for game actions
const gameLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 30, // limit each IP to 30 game actions per minute
    message: 'Too many game actions, please slow down.',
});

const io = socketIo(server, {
    cors: {
        origin: process.env.NODE_ENV === 'production' ? false : "*",
        methods: ["GET", "POST"],
        credentials: true
    },
    // Additional security options
    allowEIO3: true,
    transports: ['websocket', 'polling']
});

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Game state management
const rooms = new Map();
const players = new Map();
const playerActions = new Map(); // Track player actions for anti-cheat

// Security constants
const MAX_ROOM_CODE_LENGTH = 6;
const MAX_PLAYER_NAME_LENGTH = 20;
const MIN_PLAYER_NAME_LENGTH = 2;
const MAX_ROOMS_PER_IP = 5;
const MAX_GUESSES_PER_MINUTE = 10;

// Generate unique room codes
function generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// Security validation functions
function isValidNumber(num) {
    if (typeof num !== 'number' || isNaN(num)) return false;
    const str = num.toString().padStart(4, '0');
    return /^\d{4}$/.test(str) && num >= 0 && num <= 9999;
}

function isValidPlayerName(name) {
    if (typeof name !== 'string') return false;
    const trimmed = name.trim();
    return trimmed.length >= MIN_PLAYER_NAME_LENGTH && 
           trimmed.length <= MAX_PLAYER_NAME_LENGTH &&
           /^[a-zA-Z0-9\s\-_]+$/.test(trimmed);
}

function isValidRoomCode(code) {
    if (typeof code !== 'string') return false;
    return code.length === MAX_ROOM_CODE_LENGTH && /^[A-Z0-9]+$/.test(code);
}

// Anti-cheat: Track player actions
function trackPlayerAction(socketId, action) {
    const now = Date.now();
    if (!playerActions.has(socketId)) {
        playerActions.set(socketId, []);
    }
    
    const actions = playerActions.get(socketId);
    actions.push({ action, timestamp: now });
    
    // Clean old actions (older than 1 minute)
    const oneMinuteAgo = now - 60000;
    playerActions.set(socketId, actions.filter(a => a.timestamp > oneMinuteAgo));
    
    return actions.length;
}

function isRateLimited(socketId, action, maxActions = MAX_GUESSES_PER_MINUTE) {
    const actionCount = trackPlayerAction(socketId, action);
    return actionCount > maxActions;
}

// Core game logic - evaluate guess against secret number
function evaluateGuess(secret, guess) {
    const secretStr = secret.toString().padStart(4, '0');
    const guessStr = guess.toString().padStart(4, '0');
    
    let correctPlace = 0;
    let wrongPlace = 0;
    
    // Count correct positions first
    for (let i = 0; i < 4; i++) {
        if (secretStr[i] === guessStr[i]) {
            correctPlace++;
        }
    }
    
    // Count digits in wrong positions
    for (let digit = '0'; digit <= '9'; digit++) {
        let secretCount = 0;
        let guessCount = 0;
        let correctPositions = 0;
        
        for (let i = 0; i < 4; i++) {
            if (secretStr[i] === digit) secretCount++;
            if (guessStr[i] === digit) guessCount++;
            if (secretStr[i] === digit && guessStr[i] === digit) correctPositions++;
        }
        
        wrongPlace += Math.min(secretCount, guessCount) - correctPositions;
    }
    
    return { correctPlace, wrongPlace };
}

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log(`🎮 Player connected: ${socket.id}`);
    
    // Create a new game room
    socket.on('createRoom', (playerName) => {
        // Security checks
        if (isRateLimited(socket.id, 'createRoom', 5)) {
            socket.emit('error', 'Too many room creation attempts. Please wait.');
            return;
        }
        
        if (!isValidPlayerName(playerName)) {
            socket.emit('error', 'Invalid player name. Use 2-20 characters, letters, numbers, spaces, hyphens, underscores only.');
            return;
        }
        
        const roomCode = generateRoomCode();
        const room = {
            code: roomCode,
            players: {},
            gameState: 'waiting', // waiting, setup, playing, finished
            guesses: {},
            winner: null,
            createdAt: new Date()
        };
        
        room.players[socket.id] = {
            id: socket.id,
            name: playerName,
            secretNumber: null,
            ready: false,
            guesses: [],
            score: 0
        };
        
        rooms.set(roomCode, room);
        players.set(socket.id, { roomCode, playerName });
        
        socket.join(roomCode);
        socket.emit('roomCreated', { roomCode, playerName });
        
        console.log(`🏠 Room created: ${roomCode} by ${playerName}`);
    });
    
    // Join an existing room
    socket.on('joinRoom', ({ roomCode, playerName }) => {
        // Security checks
        if (isRateLimited(socket.id, 'joinRoom', 10)) {
            socket.emit('error', 'Too many join attempts. Please wait.');
            return;
        }
        
        if (!isValidPlayerName(playerName)) {
            socket.emit('error', 'Invalid player name. Use 2-20 characters, letters, numbers, spaces, hyphens, underscores only.');
            return;
        }
        
        if (!isValidRoomCode(roomCode)) {
            socket.emit('error', 'Invalid room code format.');
            return;
        }
        
        const room = rooms.get(roomCode);
        
        if (!room) {
            socket.emit('error', 'Room not found! Please check the room code.');
            return;
        }
        
        if (Object.keys(room.players).length >= 2) {
            socket.emit('error', 'Room is full! Please try another room.');
            return;
        }
        
        if (room.gameState !== 'waiting') {
            socket.emit('error', 'Game is already in progress!');
            return;
        }
        
        room.players[socket.id] = {
            id: socket.id,
            name: playerName,
            secretNumber: null,
            ready: false,
            guesses: [],
            score: 0
        };
        
        players.set(socket.id, { roomCode, playerName });
        socket.join(roomCode);
        
        socket.emit('roomJoined', { roomCode, playerName });
        socket.to(roomCode).emit('playerJoined', { playerName });
        
        // Send current room state to new player
        const roomPlayers = Object.values(room.players).map(p => ({
            name: p.name,
            ready: p.ready
        }));
        
        io.to(roomCode).emit('roomUpdate', {
            players: roomPlayers,
            gameState: room.gameState
        });
        
        console.log(`👥 ${playerName} joined room: ${roomCode}`);
    });
    
    // Set secret number
    socket.on('setSecretNumber', (secretNumber) => {
        const playerData = players.get(socket.id);
        if (!playerData) return;
        
        const room = rooms.get(playerData.roomCode);
        if (!room || !room.players[socket.id]) return;
        
        if (!isValidNumber(secretNumber)) {
            socket.emit('error', 'Secret number must be exactly 4 digits!');
            return;
        }
        
        room.players[socket.id].secretNumber = secretNumber.toString().padStart(4, '0');
        room.players[socket.id].ready = true;
        
        // Check if both players are ready
        const playerIds = Object.keys(room.players);
        const allReady = playerIds.length === 2 && 
                        playerIds.every(id => room.players[id].ready);
        
        if (allReady) {
            room.gameState = 'playing';
            room.guesses = {};
            playerIds.forEach(id => {
                room.guesses[id] = [];
            });
            
            io.to(playerData.roomCode).emit('gameStart', {
                message: 'Both players ready! The guessing battle begins! 🔥',
                players: Object.values(room.players).map(p => ({
                    name: p.name,
                    ready: p.ready
                }))
            });
            
            console.log(`🚀 Game started in room: ${playerData.roomCode}`);
        } else {
            socket.emit('secretNumberSet', 'Secret number set! Waiting for opponent...');
            socket.to(playerData.roomCode).emit('opponentReady', 
                `${room.players[socket.id].name} is ready! Set your secret number to begin.`);
        }
    });
    
    // Make a guess
    socket.on('makeGuess', (guess) => {
        // Security checks
        if (isRateLimited(socket.id, 'makeGuess', MAX_GUESSES_PER_MINUTE)) {
            socket.emit('error', 'Too many guesses. Please slow down.');
            return;
        }
        
        const playerData = players.get(socket.id);
        if (!playerData) return;
        
        const room = rooms.get(playerData.roomCode);
        if (!room || room.gameState !== 'playing') return;
        
        if (!isValidNumber(guess)) {
            socket.emit('error', 'Guess must be exactly 4 digits!');
            return;
        }
        
        // Find opponent
        const opponentId = Object.keys(room.players).find(id => id !== socket.id);
        if (!opponentId) return;
        
        const opponent = room.players[opponentId];
        const guessStr = guess.toString().padStart(4, '0');
        
        // Evaluate guess
        const result = evaluateGuess(opponent.secretNumber, guessStr);
        
        // Store guess
        const guessData = {
            guess: guessStr,
            result,
            timestamp: new Date()
        };
        
        room.players[socket.id].guesses.push(guessData);
        
        // Check for win
        if (result.correctPlace === 4) {
            room.gameState = 'finished';
            room.winner = socket.id;
            room.players[socket.id].score++;
            
            io.to(playerData.roomCode).emit('gameWon', {
                winner: room.players[socket.id].name,
                secretNumber: opponent.secretNumber,
                totalGuesses: room.players[socket.id].guesses.length
            });
            
            console.log(`🏆 ${room.players[socket.id].name} won in room: ${playerData.roomCode}`);
        } else {
            // Send result to guesser
            socket.emit('guessResult', {
                guess: guessStr,
                result,
                guessNumber: room.players[socket.id].guesses.length
            });
            
            // Notify opponent
            socket.to(playerData.roomCode).emit('opponentGuess', {
                playerName: room.players[socket.id].name,
                guess: guessStr,
                result,
                guessNumber: room.players[socket.id].guesses.length
            });
        }
    });
    
    // Get room stats
    socket.on('getRoomStats', () => {
        const playerData = players.get(socket.id);
        if (!playerData) return;
        
        const room = rooms.get(playerData.roomCode);
        if (!room) return;
        
        const stats = {
            roomCode: room.code,
            gameState: room.gameState,
            players: Object.values(room.players).map(p => ({
                name: p.name,
                ready: p.ready,
                guessCount: p.guesses.length,
                score: p.score
            }))
        };
        
        socket.emit('roomStats', stats);
    });
    
    // Handle disconnect
    socket.on('disconnect', () => {
        const playerData = players.get(socket.id);
        if (playerData) {
            const room = rooms.get(playerData.roomCode);
            if (room) {
                delete room.players[socket.id];
                
                // Notify remaining player
                socket.to(playerData.roomCode).emit('playerDisconnected', {
                    message: `${playerData.playerName} has left the game.`,
                    canContinue: false
                });
                
                // Clean up empty rooms
                if (Object.keys(room.players).length === 0) {
                    rooms.delete(playerData.roomCode);
                    console.log(`🗑️ Empty room deleted: ${playerData.roomCode}`);
                }
            }
            
            players.delete(socket.id);
        }
        
        console.log(`👋 Player disconnected: ${socket.id}`);
    });
});

// Clean up old rooms periodically (every 30 minutes)
setInterval(() => {
    const now = new Date();
    const cutoff = 30 * 60 * 1000; // 30 minutes in milliseconds
    
    for (const [roomCode, room] of rooms.entries()) {
        if (now - room.createdAt > cutoff && Object.keys(room.players).length === 0) {
            rooms.delete(roomCode);
            console.log(`🧹 Cleaned up old room: ${roomCode}`);
        }
    }
}, 30 * 60 * 1000);

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Break The Code server running on port ${PORT}`);
    console.log(`🌐 Access the game at: http://localhost:${PORT}`);
    console.log(`🎮 Active rooms: ${rooms.size}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🛑 Server shutting down gracefully...');
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
}); 