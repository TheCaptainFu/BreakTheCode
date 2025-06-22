// 🎮 Break The Code - Client-Side Game Logic
// Advanced multiplayer number guessing game with stunning UI

class BreakTheCodeGame {
    constructor() {
        this.socket = null;
        this.gameState = {
            currentScreen: 'welcome',
            playerName: '',
            roomCode: '',
            isHost: false,
            secretNumber: '',
            currentGuess: '',
            guesses: [],
            opponentGuesses: [],
            gameStatus: 'waiting', // waiting, setup, playing, finished
            winner: null,
            score: { yours: 0, opponent: 0 }
        };
        
        this.init();
    }
    
    init() {
        this.initializeSocket();
        this.setupEventListeners();
        this.updateConnectionStatus('connecting');
        this.showLoading('Connecting to game server...');
    }
    
    // Socket.IO Connection Management
    initializeSocket() {
        this.socket = io({
            // Improved connection options for stability
            reconnection: true,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            maxReconnectionAttempts: 5,
            timeout: 20000,
            forceNew: true
        });
        
        this.socket.on('connect', () => {
            console.log('🔗 Connected to server');
            this.updateConnectionStatus('connected');
            this.hideLoading();
            this.showNotification('Connected to game server!', 'success');
        });
        
        this.socket.on('disconnect', (reason) => {
            console.log('❌ Disconnected from server:', reason);
            this.updateConnectionStatus('disconnected');
            
            if (reason === 'io server disconnect') {
                // Server disconnected us, try to reconnect
                this.showNotification('Server disconnected. Attempting to reconnect...', 'error');
                this.socket.connect();
            } else {
                // Client disconnected, will auto-reconnect
                this.showNotification('Connection lost. Trying to reconnect...', 'error');
            }
        });
        
        this.socket.on('reconnect', (attemptNumber) => {
            console.log('🔄 Reconnected to server after', attemptNumber, 'attempts');
            this.updateConnectionStatus('connected');
            this.showNotification('Reconnected successfully!', 'success');
            
            // If we were in a game, try to rejoin the room
            if (this.gameState.roomCode && this.gameState.playerName) {
                this.showNotification('Attempting to rejoin your game...', 'info');
                this.socket.emit('rejoinRoom', {
                    roomCode: this.gameState.roomCode,
                    playerName: this.gameState.playerName
                });
            }
        });
        
        this.socket.on('reconnect_error', (error) => {
            console.error('🔌 Reconnection failed:', error);
            this.showNotification('Failed to reconnect. Please refresh the page.', 'error');
        });
        
        this.socket.on('reconnect_failed', () => {
            console.error('💥 Reconnection failed completely');
            this.updateConnectionStatus('failed');
            this.showNotification('Connection failed. Please refresh the page to continue.', 'error');
        });
        
        this.setupSocketEvents();
    }
    
    setupSocketEvents() {
        // Room Events
        this.socket.on('roomCreated', (data) => {
            console.log('🏠 Room created:', data);
            this.hideLoading();
            this.gameState.roomCode = data.roomCode;
            this.gameState.playerName = data.playerName;
            this.gameState.isHost = true;
            this.showRoomScreen();
            this.showNotification(`Room ${data.roomCode} created!`, 'success');
        });
        
        this.socket.on('roomJoined', (data) => {
            console.log('👥 Room joined:', data);
            this.hideLoading();
            this.gameState.roomCode = data.roomCode;
            this.gameState.playerName = data.playerName;
            this.gameState.isHost = false;
            this.showRoomScreen();
            this.showNotification(`Joined room ${data.roomCode}!`, 'success');
        });
        
        this.socket.on('playerJoined', (data) => {
            console.log('🎮 Player joined:', data);
            this.updatePlayerCard('player2', data.playerName, 'Connected', false);
            this.showNotification(`${data.playerName} joined the game!`, 'info');
            this.updateRoomStatus('Both players connected! Set your secret numbers.');
        });
        
        this.socket.on('roomUpdate', (data) => {
            console.log('📊 Room update:', data);
            this.updateRoomDisplay(data);
        });
        
        // Game Events
        this.socket.on('gameStart', (data) => {
            console.log('🚀 Game started:', data);
            this.gameState.gameStatus = 'playing';
            this.gameState.currentTurn = data.currentTurn;
            this.gameState.isMyTurn = data.currentTurn === this.socket.id;
            
            // Find your secret number from the players data
            const yourPlayer = data.players.find(p => p.name === this.gameState.playerName);
            if (yourPlayer) {
                this.gameState.secretNumber = yourPlayer.secretNumber;
            }
            
            this.showGameScreen();
            this.showNotification(data.message, 'success');
            this.updateTurnDisplay();
            this.playSound('gameStart');
        });
        
        this.socket.on('secretNumberSet', (message) => {
            console.log('🔒 Secret number set');
            this.showNotification(message, 'success');
            this.updatePlayerCard('player1', this.gameState.playerName, 'Ready! Waiting for opponent...', true);
        });
        
        this.socket.on('opponentReady', (message) => {
            console.log('✅ Opponent ready');
            this.showNotification(message, 'info');
            this.updatePlayerCard('player2', '', 'Ready!', true);
        });
        
        this.socket.on('guessResult', (data) => {
            console.log('🎯 Guess result:', data);
            this.gameState.isMyTurn = data.isYourTurn || false;
            this.handleGuessResult(data);
            this.updateTurnDisplay();
        });
        
        this.socket.on('opponentGuess', (data) => {
            console.log('👀 Opponent guess:', data);
            this.gameState.isMyTurn = data.isYourTurn || false;
            this.handleOpponentGuess(data);
            this.updateTurnDisplay();
            
            if (data.turnMessage) {
                this.showNotification(data.turnMessage, 'info');
            }
        });
        
        this.socket.on('gameWon', (data) => {
            console.log('🏆 Game won:', data);
            this.handleGameEnd(data);
        });
        
        this.socket.on('playerDisconnected', (data) => {
            console.log('👋 Player disconnected:', data);
            this.showNotification(data.message, 'error');
            if (!data.canContinue) {
                this.resetToWelcome();
            }
        });
        
        // Handle new round started by server
        this.socket.on('newRoundStarted', (data) => {
            console.log('🔄 New round started:', data);
            
            // Reset local game state for new round
            this.gameState.guesses = [];
            this.gameState.opponentGuesses = [];
            this.gameState.secretNumber = '';
            this.gameState.gameStatus = 'setup';
            this.gameState.winner = null;
            this.gameState.currentTurn = null;
            this.gameState.isMyTurn = false;
            
            // Update scores if provided
            if (data.scores) {
                const myScore = data.scores.find(s => s.name === this.gameState.playerName);
                const opponentScore = data.scores.find(s => s.name !== this.gameState.playerName);
                if (myScore && opponentScore) {
                    this.gameState.score = {
                        yours: myScore.score,
                        opponent: opponentScore.score
                    };
                }
            }
            
            this.showRoomScreen();
            this.hideLoading();
            this.showNotification(data.message, 'success');
            
            // Clear guess history displays
            this.clearGuessList('yourGuesses');
            this.clearGuessList('opponentGuesses');
            
            // Reset secret number inputs
            ['digit1', 'digit2', 'digit3', 'digit4'].forEach(id => {
                document.getElementById(id).value = '';
            });
            
            // Focus on first digit input
            document.getElementById('digit1').focus();
        });
        
        // Handle successful room rejoin after reconnection
        this.socket.on('roomRejoined', (data) => {
            console.log('🏠 Room rejoined successfully:', data);
            
            // Restore game state
            this.gameState.roomCode = data.roomCode;
            this.gameState.isHost = data.isHost;
            this.gameState.gameStatus = data.gameState;
            this.gameState.currentTurn = data.currentTurn;
            this.gameState.isMyTurn = data.isYourTurn;
            
            // Update scores if available
            if (data.players) {
                const myPlayer = data.players.find(p => p.name === this.gameState.playerName);
                const opponentPlayer = data.players.find(p => p.name !== this.gameState.playerName);
                if (myPlayer && opponentPlayer) {
                    this.gameState.score = {
                        yours: myPlayer.score,
                        opponent: opponentPlayer.score
                    };
                }
            }
            
            // Show appropriate screen based on game state
            if (data.gameState === 'waiting' || data.gameState === 'setup') {
                this.showRoomScreen();
            } else if (data.gameState === 'playing') {
                this.showGameScreen();
                this.updateTurnDisplay();
            }
            
            this.showNotification('Successfully rejoined your game!', 'success');
        });
        
        // Handle other player reconnection
        this.socket.on('playerReconnected', (data) => {
            console.log('👥 Player reconnected:', data);
            this.showNotification(data.message, 'info');
        });
        
        // Error Handling
        this.socket.on('error', (message) => {
            console.error('⚠️ Socket error:', message);
            this.hideLoading();
            this.showNotification(message, 'error');
        });
        
        this.socket.on('connect_error', (error) => {
            console.error('🔌 Connection error:', error);
            this.hideLoading();
            this.showNotification('Failed to connect to game server. Please refresh the page.', 'error');
        });
    }
    
    // UI Event Listeners
    setupEventListeners() {
        // Welcome Screen
        document.getElementById('createRoomBtn').addEventListener('click', () => this.createRoom());
        document.getElementById('joinRoomBtn').addEventListener('click', () => this.openJoinModal());
        document.getElementById('closeJoinModal').addEventListener('click', () => this.closeJoinModal());
        document.getElementById('cancelJoinBtn').addEventListener('click', () => this.closeJoinModal());
        document.getElementById('confirmJoinBtn').addEventListener('click', () => this.joinRoom());
        
        // Player name input
        document.getElementById('playerName').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.createRoom();
        });
        
        // Room code input
        document.getElementById('roomCodeInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.joinRoom();
        });
        
        // Room Screen
        document.getElementById('copyRoomCode').addEventListener('click', () => this.copyRoomCode());
        document.getElementById('setSecretBtn').addEventListener('click', () => this.setSecretNumber());
        
        // Secret number inputs
        this.setupDigitInputs(['digit1', 'digit2', 'digit3', 'digit4']);
        
        // Game Screen
        document.getElementById('submitGuessBtn').addEventListener('click', () => this.submitGuess());
        
        // Guess inputs
        this.setupDigitInputs(['guess1', 'guess2', 'guess3', 'guess4']);
        
        // Game Over Screen
        document.getElementById('playAgainBtn').addEventListener('click', () => this.playAgain());
        document.getElementById('newGameBtn').addEventListener('click', () => this.newGame());
        
        // Auto-focus and auto-advance for digit inputs
        this.setupAutoAdvance();
    }
    
    setupDigitInputs(inputIds) {
        inputIds.forEach((id) => {
            const input = document.getElementById(id);
            if (input) {
                input.addEventListener('input', (e) => {
                    if (e.target.value.length > 1) {
                        e.target.value = e.target.value.slice(-1);
                    }
                    if (!/^\d*$/.test(e.target.value)) {
                        e.target.value = '';
                    }
                });
                
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Backspace' && e.target.value === '') {
                        const currentIndex = inputIds.indexOf(id);
                        if (currentIndex > 0) {
                            document.getElementById(inputIds[currentIndex - 1]).focus();
                        }
                    }
                });
            }
        });
    }
    
    setupAutoAdvance() {
        const digitInputs = document.querySelectorAll('.digit-input, .guess-digit');
        digitInputs.forEach((input, index) => {
            input.addEventListener('input', (e) => {
                if (e.target.value.length === 1) {
                    const nextInput = digitInputs[index + 1];
                    if (nextInput) {
                        nextInput.focus();
                    }
                }
            });
        });
    }
    
    // Game Actions
    createRoom() {
        const playerName = document.getElementById('playerName').value.trim();
        if (!this.validatePlayerName(playerName)) return;
        
        this.showLoading('Creating room...');
        this.socket.emit('createRoom', playerName);
        
        // Timeout fallback - hide loading after 10 seconds if no response
        setTimeout(() => {
            if (this.gameState.currentScreen === 'welcome') {
                this.hideLoading();
                this.showNotification('Room creation timed out. Please try again.', 'error');
            }
        }, 10000);
    }
    
    openJoinModal() {
        const playerName = document.getElementById('playerName').value.trim();
        if (!this.validatePlayerName(playerName)) return;
        
        document.getElementById('joinRoomModal').classList.add('active');
        document.getElementById('roomCodeInput').focus();
    }
    
    closeJoinModal() {
        document.getElementById('joinRoomModal').classList.remove('active');
        document.getElementById('roomCodeInput').value = '';
    }
    
    joinRoom() {
        const playerName = document.getElementById('playerName').value.trim();
        const roomCode = document.getElementById('roomCodeInput').value.trim().toUpperCase();
        
        if (!this.validatePlayerName(playerName)) return;
        if (!this.validateRoomCode(roomCode)) return;
        
        this.showLoading('Joining room...');
        this.closeJoinModal();
        this.socket.emit('joinRoom', { roomCode, playerName });
        
        // Timeout fallback - hide loading after 10 seconds if no response
        setTimeout(() => {
            if (this.gameState.currentScreen === 'welcome') {
                this.hideLoading();
                this.showNotification('Room join timed out. Please try again.', 'error');
            }
        }, 10000);
    }
    
    setSecretNumber() {
        const digits = [
            document.getElementById('digit1').value,
            document.getElementById('digit2').value,
            document.getElementById('digit3').value,
            document.getElementById('digit4').value
        ];
        
        const secretNumber = digits.join('');
        
        if (!this.validateSecretNumber(secretNumber)) return;
        
        this.gameState.secretNumber = secretNumber;
        this.socket.emit('setSecretNumber', parseInt(secretNumber));
        
        // Hide secret setup and show waiting state
        document.getElementById('secretSetup').style.display = 'none';
        this.showNotification('Secret number locked in! 🔒', 'success');
    }
    
    submitGuess() {
        if (!this.gameState.isMyTurn) {
            this.showNotification("Not your turn! Wait for your opponent to guess.", 'warning');
            return;
        }
        
        const digits = [
            document.getElementById('guess1').value,
            document.getElementById('guess2').value,
            document.getElementById('guess3').value,
            document.getElementById('guess4').value
        ];
        
        const guess = digits.join('');
        
        if (!this.validateGuess(guess)) return;
        
        this.socket.emit('makeGuess', parseInt(guess));
        this.clearGuessInputs();
        this.disableGuessInputs(true);
    }
    
    // Validation Methods
    validatePlayerName(name) {
        if (!name || name.length < 2) {
            this.showNotification('Please enter a name (at least 2 characters)', 'error');
            document.getElementById('playerName').focus();
            return false;
        }
        if (name.length > 20) {
            this.showNotification('Name must be 20 characters or less', 'error');
            return false;
        }
        return true;
    }
    
    validateRoomCode(code) {
        if (!code || code.length !== 6) {
            this.showNotification('Please enter a valid 6-character room code', 'error');
            document.getElementById('roomCodeInput').focus();
            return false;
        }
        return true;
    }
    
    validateSecretNumber(number) {
        if (number.length !== 4 || !/^\d{4}$/.test(number)) {
            this.showNotification('Please enter exactly 4 digits', 'error');
            document.getElementById('digit1').focus();
            return false;
        }
        return true;
    }
    
    validateGuess(guess) {
        if (guess.length !== 4 || !/^\d{4}$/.test(guess)) {
            this.showNotification('Please enter exactly 4 digits', 'error');
            document.getElementById('guess1').focus();
            return false;
        }
        return true;
    }
    
    // Game Logic Handlers
    handleGuessResult(data) {
        this.gameState.guesses.push(data);
        this.addGuessToList('yourGuessesList', data, true);
        this.updateGuessCounter();
        
        // Only re-enable inputs if it's still your turn
        if (data.isYourTurn) {
            this.disableGuessInputs(false);
        }
        
        if (data.result.correctPlace === 4) {
            this.showNotification('🎉 You cracked the code!', 'success');
        } else {
            const message = this.formatResult(data.result);
            this.showNotification(message, 'info');
        }
        
        this.playSound('guess');
    }
    
    handleOpponentGuess(data) {
        this.gameState.opponentGuesses.push(data);
        this.addGuessToList('opponentGuessesList', data, false);
        
        const message = `${data.playerName} guessed ${data.guess}`;
        this.showNotification(message, 'info');
        
        this.playSound('opponentGuess');
    }
    
    handleGameEnd(data) {
        this.gameState.gameStatus = 'finished';
        this.gameState.winner = data.winner;
        
        const isWinner = data.winner === this.gameState.playerName;
        
        if (isWinner) {
            this.gameState.score.yours++;
        } else {
            this.gameState.score.opponent++;
        }
        
        this.showGameOverScreen(isWinner, data);
        this.playSound(isWinner ? 'victory' : 'defeat');
    }
    
    // UI Update Methods
    updateConnectionStatus(status) {
        const statusEl = document.getElementById('connectionStatus');
        const icon = statusEl.querySelector('i');
        const text = statusEl.querySelector('span');
        
        statusEl.className = `connection-status ${status}`;
        
        switch (status) {
            case 'connected':
                icon.className = 'fas fa-circle';
                text.textContent = 'Connected';
                break;
            case 'connecting':
                icon.className = 'fas fa-circle';
                text.textContent = 'Connecting...';
                break;
            case 'disconnected':
                icon.className = 'fas fa-circle';
                text.textContent = 'Disconnected';
                break;
        }
    }
    
    showRoomScreen() {
        this.switchScreen('roomScreen');
        document.getElementById('roomCode').textContent = this.gameState.roomCode;
        document.getElementById('gameRoomCode').textContent = this.gameState.roomCode;
        
        // Update player cards
        this.updatePlayerCard('player1', this.gameState.playerName, 'Setting up...', false);
        
        if (!this.gameState.isHost) {
            this.updatePlayerCard('player2', 'Host', 'Setting up...', false);
        }
        
        // Show secret setup
        document.getElementById('secretSetup').style.display = 'block';
        document.getElementById('digit1').focus();
    }
    
    showGameScreen() {
        this.switchScreen('gameScreen');
        document.getElementById('yourNameMini').textContent = this.gameState.playerName;
        document.getElementById('yourScore').textContent = this.gameState.score.yours;
        document.getElementById('opponentScore').textContent = this.gameState.score.opponent;
        
        // Show your secret number
        this.displaySecretNumber();
        
        // Clear previous guesses
        this.clearGuessList('yourGuessesList');
        this.clearGuessList('opponentGuessesList');
        
        // Focus on first guess input
        document.getElementById('guess1').focus();
    }
    
    showGameOverScreen(isWinner, data) {
        this.switchScreen('gameOverScreen');
        
        const resultIcon = document.getElementById('resultIcon');
        const resultTitle = document.getElementById('resultTitle');
        const resultMessage = document.getElementById('resultMessage');
        const finalGuesses = document.getElementById('finalGuesses');
        const secretNumberReveal = document.getElementById('secretNumberReveal');
        
        if (isWinner) {
            resultIcon.innerHTML = '<i class="fas fa-trophy"></i>';
            resultIcon.className = 'result-icon win';
            resultTitle.textContent = 'Victory! 🎉';
            resultTitle.className = 'win';
            resultMessage.textContent = 'You cracked the code first!';
        } else {
            resultIcon.innerHTML = '<i class="fas fa-crown"></i>';
            resultIcon.className = 'result-icon lose';
            resultTitle.textContent = 'Defeated 😤';
            resultTitle.className = 'lose';
            resultMessage.textContent = `${data.winner} beat you to it!`;
        }
        
        finalGuesses.textContent = data.totalGuesses || this.gameState.guesses.length;
        
        // Show the opponent's secret number (the one that was cracked)
        if (isWinner) {
            secretNumberReveal.textContent = data.loserSecretNumber;
        } else {
            secretNumberReveal.textContent = data.winnerSecretNumber;
        }
    }
    
    updatePlayerCard(cardId, name, status, ready) {
        const nameEl = document.getElementById(`${cardId}Name`);
        const statusEl = document.getElementById(`${cardId}Status`);
        const readyEl = document.getElementById(`${cardId}Ready`);
        
        if (name && nameEl) nameEl.textContent = name;
        if (statusEl) statusEl.textContent = status;
        
        if (readyEl) {
            if (ready) {
                readyEl.innerHTML = '<i class="fas fa-check"></i>';
                readyEl.className = 'player-ready ready';
            } else {
                readyEl.innerHTML = '<i class="fas fa-clock"></i>';
                readyEl.className = 'player-ready waiting';
            }
        }
    }
    
    updateRoomStatus(message) {
        const statusEl = document.getElementById('roomStatus');
        if (statusEl) {
            statusEl.innerHTML = `<i class="fas fa-info-circle"></i><span>${message}</span>`;
        }
    }
    
    updateRoomDisplay(data) {
        // Update room display with player information
        if (data.players && data.players.length >= 1) {
            const player1 = data.players[0];
            this.updatePlayerCard('player1', player1.name, player1.ready ? 'Ready!' : 'Setting up...', player1.ready);
        }
        
        if (data.players && data.players.length >= 2) {
            const player2 = data.players[1];
            this.updatePlayerCard('player2', player2.name, player2.ready ? 'Ready!' : 'Setting up...', player2.ready);
        }
        
        // Update game status
        if (data.gameState === 'waiting') {
            this.updateRoomStatus('Waiting for players...');
        } else if (data.gameState === 'setup') {
            this.updateRoomStatus('Set your secret numbers to begin!');
        }
    }
    
    addGuessToList(listId, data, isYours) {
        const listEl = document.getElementById(listId);
        const noGuessesEl = listEl.querySelector('.no-guesses');
        
        if (noGuessesEl) {
            noGuessesEl.style.display = 'none';
        }
        
        const guessEl = document.createElement('div');
        guessEl.className = 'guess-item';
        guessEl.innerHTML = `
            <div class="guess-number">${data.guess}</div>
            <div class="guess-result">
                <span class="result-badge correct-place">
                    <i class="fas fa-bullseye"></i>
                    ${data.result.correctPlace} correct place
                </span>
                <span class="result-badge wrong-place">
                    <i class="fas fa-location-arrow"></i>
                    ${data.result.wrongPlace} wrong place
                </span>
            </div>
        `;
        
        listEl.appendChild(guessEl);
        
        // Auto-scroll to bottom
        listEl.scrollTop = listEl.scrollHeight;
    }
    
    clearGuessList(listId) {
        const listEl = document.getElementById(listId);
        const noGuessesEl = listEl.querySelector('.no-guesses');
        
        // Remove all guess items
        const guessItems = listEl.querySelectorAll('.guess-item');
        guessItems.forEach(item => item.remove());
        
        // Show no-guesses message
        if (noGuessesEl) {
            noGuessesEl.style.display = 'block';
        }
    }
    
    updateGuessCounter() {
        document.getElementById('guessCounter').textContent = this.gameState.guesses.length + 1;
    }
    
    updateTurnDisplay() {
        const turnIndicator = document.getElementById('turnIndicator');
        const submitBtn = document.getElementById('submitGuessBtn');
        
        if (!turnIndicator) return;
        
        if (this.gameState.isMyTurn) {
            turnIndicator.innerHTML = '<i class="fas fa-arrow-right"></i> Your Turn';
            turnIndicator.className = 'turn-indicator your-turn';
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Submit Guess';
            }
            this.disableGuessInputs(false);
        } else {
            turnIndicator.innerHTML = '<i class="fas fa-clock"></i> Opponent\'s Turn';
            turnIndicator.className = 'turn-indicator opponent-turn';
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.textContent = 'Wait for opponent...';
            }
            this.disableGuessInputs(true);
        }
    }
    
    displaySecretNumber() {
        const secretDisplay = document.getElementById('yourSecretNumber');
        if (secretDisplay && this.gameState.secretNumber) {
            secretDisplay.textContent = this.gameState.secretNumber;
        }
    }
    
    // Utility Methods
    switchScreen(screenId) {
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });
        document.getElementById(screenId).classList.add('active');
        this.gameState.currentScreen = screenId;
    }
    
    clearGuessInputs() {
        ['guess1', 'guess2', 'guess3', 'guess4'].forEach(id => {
            document.getElementById(id).value = '';
        });
    }
    
    disableGuessInputs(disabled) {
        ['guess1', 'guess2', 'guess3', 'guess4'].forEach(id => {
            document.getElementById(id).disabled = disabled;
        });
        
        // Don't disable submit button if it's handled by turn display
        const submitBtn = document.getElementById('submitGuessBtn');
        if (submitBtn && !document.getElementById('turnIndicator')) {
            submitBtn.disabled = disabled;
        }
        
        if (!disabled) {
            document.getElementById('guess1').focus();
        }
    }
    
    copyRoomCode() {
        navigator.clipboard.writeText(this.gameState.roomCode).then(() => {
            this.showNotification('Room code copied to clipboard!', 'success');
            
            // Visual feedback
            const copyBtn = document.getElementById('copyRoomCode');
            const originalHTML = copyBtn.innerHTML;
            copyBtn.innerHTML = '<i class="fas fa-check"></i>';
            copyBtn.style.color = '#43e97b';
            
            setTimeout(() => {
                copyBtn.innerHTML = originalHTML;
                copyBtn.style.color = '';
            }, 2000);
        });
    }
    
    formatResult(result) {
        if (result.correctPlace === 0 && result.wrongPlace === 0) {
            return 'No matches! Try completely different digits.';
        }
        
        let message = '';
        if (result.correctPlace > 0) {
            message += `${result.correctPlace} digit${result.correctPlace > 1 ? 's' : ''} in correct place`;
        }
        if (result.wrongPlace > 0) {
            if (message) message += ', ';
            message += `${result.wrongPlace} digit${result.wrongPlace > 1 ? 's' : ''} in wrong place`;
        }
        
        return message;
    }
    
    // Game State Management
    playAgain() {
        // Send play again request to server
        if (this.socket && this.socket.connected) {
            this.showLoading('Starting new round...');
            this.socket.emit('playAgain');
        } else {
            this.showNotification('Connection lost. Please refresh the page.', 'error');
        }
    }
    
    newGame() {
        this.resetToWelcome();
    }
    
    resetToWelcome() {
        this.gameState = {
            currentScreen: 'welcome',
            playerName: '',
            roomCode: '',
            isHost: false,
            secretNumber: '',
            currentGuess: '',
            guesses: [],
            opponentGuesses: [],
            gameStatus: 'waiting',
            winner: null,
            score: { yours: 0, opponent: 0 }
        };
        
        this.switchScreen('welcomeScreen');
        document.getElementById('playerName').value = '';
        document.getElementById('playerName').focus();
    }
    
    // Notification System
    showNotification(message, type = 'info') {
        const container = document.getElementById('notifications');
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        
        container.appendChild(notification);
        
        // Auto-remove after 5 seconds
        setTimeout(() => {
            notification.style.opacity = '0';
            notification.style.transform = 'translateY(-20px)';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }, 5000);
    }
    
    // Loading Overlay
    showLoading(text = 'Loading...') {
        document.getElementById('loadingText').textContent = text;
        document.getElementById('loadingOverlay').classList.add('active');
    }
    
    hideLoading() {
        document.getElementById('loadingOverlay').classList.remove('active');
    }
    
    // Sound Effects (Basic Web Audio API)
    playSound(type) {
        // Create audio context if not exists
        if (!this.audioContext) {
            try {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            } catch (e) {
                return; // Audio not supported
            }
        }
        
        // Simple beep sounds for different events
        const frequencies = {
            guess: 800,
            opponentGuess: 600,
            gameStart: 1000,
            victory: 1200,
            defeat: 400
        };
        
        const frequency = frequencies[type] || 800;
        this.playBeep(frequency, 0.1, 0.2);
    }
    
    playBeep(frequency, duration, volume = 0.1) {
        if (!this.audioContext) return;
        
        const oscillator = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(this.audioContext.destination);
        
        oscillator.frequency.setValueAtTime(frequency, this.audioContext.currentTime);
        oscillator.type = 'sine';
        
        gainNode.gain.setValueAtTime(0, this.audioContext.currentTime);
        gainNode.gain.linearRampToValueAtTime(volume, this.audioContext.currentTime + 0.01);
        gainNode.gain.linearRampToValueAtTime(0, this.audioContext.currentTime + duration);
        
        oscillator.start(this.audioContext.currentTime);
        oscillator.stop(this.audioContext.currentTime + duration);
    }
}

// Initialize the game when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    console.log('🎮 Break The Code - Game Initializing...');
    window.game = new BreakTheCodeGame();
    
    // Add some Easter eggs and animations
    setTimeout(() => {
        console.log('🔓 Welcome to Break The Code!');
        console.log('💻 Built with love and lots of coffee');
        console.log('🚀 Ready to challenge your friends?');
    }, 1000);
}); 