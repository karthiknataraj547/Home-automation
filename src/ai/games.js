// src/ai/games.js - LUKAS Interactive Game Engine & Turn-Based State Machine
// Supports: Trivia Quiz, Guess the Movie, Guess the Song, Word Chain, Memory Challenge,
//           Chess, Tic Tac Toe, Sudoku, Hangman, 2048, Snake, Number Challenge, Rapid Fire Quiz

export const GAMES = {
  TRIVIA: 'trivia',
  MOVIE: 'movie',
  SONG: 'song',
  WORDCHAIN: 'wordchain',
  MEMORY: 'memory',
  CHESS: 'chess',
  TICTACTOE: 'tictactoe',
  SUDOKU: 'sudoku',
  HANGMAN: 'hangman',
  G2048: 'g2048',
  SNAKE: 'snake',
  NUMBER: 'number',
  RAPIDFIRE: 'rapidfire'
};

class LukasGameEngine {
  constructor() {
    this.currentGame = null;
    this.gameState = {};
    this.container = null;
    this.speak = null;
    this.updateConsole = null;

    // Curated questions and lists
    this.triviaDb = [
      { q: "What is the capital of India?", a: ["New Delhi", "Mumbai", "Kolkata", "Chennai"], correct: 0 },
      { q: "Which planet is known as the Red Planet?", a: ["Venus", "Mars", "Jupiter", "Saturn"], correct: 1 },
      { q: "Who wrote 'Romeo and Juliet'?", a: ["Charles Dickens", "William Shakespeare", "Mark Twain", "Leo Tolstoy"], correct: 1 },
      { q: "What is the chemical symbol for gold?", a: ["Ag", "Fe", "Au", "Pb"], correct: 2 },
      { q: "How many bones are there in an adult human body?", a: ["186", "206", "226", "256"], correct: 1 },
      { q: "Which is the largest ocean on Earth?", a: ["Atlantic Ocean", "Indian Ocean", "Pacific Ocean", "Arctic Ocean"], correct: 2 }
    ];

    this.movieDb = [
      { title: "Inception", hints: ["Leonardo DiCaprio starring", "Dreams within dreams", "Spinning top at the end", "Directed by Christopher Nolan"] },
      { title: "Titanic", hints: ["A giant iceberg", "Jack and Rose", "Heart of the Ocean necklace", "James Cameron masterpiece"] },
      { title: "Sholay", hints: ["Famous characters Jai and Veeru", "Village of Ramgarh", "Villain Gabbar Singh", "Iconic Indian classic"] },
      { title: "Interstellar", hints: ["Space travel through wormholes", "Matthew McConaughey", "TARS robot", "Time dilation on ocean planet"] }
    ];

    this.songDb = [
      { title: "Believer", artist: "Imagine Dragons", hints: ["Pain! You made me a, you made me a...", "Released in 2017", "Synth-pop rock genre"] },
      { title: "Perfect", artist: "Ed Sheeran", hints: ["I found a love for me...", "Romantic acoustic ballad", "Baby, I'm dancing in the dark"] },
      { title: "Jai Ho", artist: "A R Rahman", hints: ["Won an Oscar award", "Slumdog Millionaire soundtrack", "High energy fusion music"] }
    ];

    this.validWords = ["apple", "elephant", "tiger", "rabbit", "table", "egg", "goat", "train", "nest", "tomato", "onion", "melon", "net", "orange", "eagle", "earth", "home", "exit", "task", "kite", "easy", "yellow", "water", "river", "rain", "night", "talk", "keep", "play", "yard", "deer", "road", "duck"];
  }

  init(containerNode, speakFn, updateConsoleFn) {
    this.container = containerNode;
    this.speak = speakFn;
    this.updateConsole = updateConsoleFn;
    this.loadState();
  }

  loadState() {
    try {
      const saved = localStorage.getItem('lukas_game_engine_state');
      if (saved) {
        const parsed = JSON.parse(saved);
        this.currentGame = parsed.currentGame;
        this.gameState = parsed.gameState || {};
      }
    } catch (e) {
      console.warn("[GameEngine] Failed to load saved state:", e);
    }
  }

  saveState() {
    try {
      localStorage.setItem('lukas_game_engine_state', JSON.stringify({
        currentGame: this.currentGame,
        gameState: this.gameState
      }));
    } catch (e) {
      console.warn("[GameEngine] Failed to save state:", e);
    }
  }

  stop() {
    if (this.currentGame === GAMES.SNAKE && this.gameState.loop) {
      cancelAnimationFrame(this.gameState.loop);
    }
    this.currentGame = null;
    this.gameState = {};
    this.saveState();
    if (this.container) this.container.innerHTML = "";
  }

  start(gameKey) {
    if (this.currentGame === GAMES.SNAKE && this.gameState.loop) {
      cancelAnimationFrame(this.gameState.loop);
    }
    
    this.currentGame = gameKey;
    this.gameState = { score: 0, status: 'playing', turn: 'player', initialized: Date.now() };

    console.log(`[GameEngine] Starting game: ${gameKey}`);
    
    switch (gameKey) {
      case GAMES.TRIVIA:
        this.initTrivia();
        break;
      case GAMES.MOVIE:
        this.initMovieGuess();
        break;
      case GAMES.SONG:
        this.initSongGuess();
        break;
      case GAMES.WORDCHAIN:
        this.initWordChain();
        break;
      case GAMES.MEMORY:
        this.initMemoryChallenge();
        break;
      case GAMES.CHESS:
        this.initChess();
        break;
      case GAMES.TICTACTOE:
        this.initTicTacToe();
        break;
      case GAMES.SUDOKU:
        this.initSudoku();
        break;
      case GAMES.HANGMAN:
        this.initHangman();
        break;
      case GAMES.G2048:
        this.init2048();
        break;
      case GAMES.SNAKE:
        this.initSnake();
        break;
      case GAMES.NUMBER:
        this.initNumberChallenge();
        break;
      case GAMES.RAPIDFIRE:
        this.initRapidFire();
        break;
      default:
        this.currentGame = null;
        this.speak("That game is not configured yet. Please choose another.");
        return;
    }
    this.saveState();
  }

  // ─── Input Routing ─────────────────────────────────────────────────────────

  processInput(rawInput) {
    const input = rawInput.toLowerCase().trim();
    if (!this.currentGame) return false;

    if (input === 'exit game' || input === 'stop game' || input === 'quit game' || input === 'close game') {
      this.speak("Exiting game. Let me know if you want to play something else.");
      this.stop();
      if (this.updateConsole) this.updateConsole("Game closed.");
      return true;
    }

    switch (this.currentGame) {
      case GAMES.TRIVIA:
        this.handleTriviaInput(input);
        break;
      case GAMES.MOVIE:
        this.handleMovieInput(input);
        break;
      case GAMES.SONG:
        this.handleSongInput(input);
        break;
      case GAMES.WORDCHAIN:
        this.handleWordChainInput(input);
        break;
      case GAMES.MEMORY:
        this.handleMemoryInput(input);
        break;
      case GAMES.CHESS:
        this.handleChessInput(input);
        break;
      case GAMES.TICTACTOE:
        this.handleTicTacToeInput(input);
        break;
      case GAMES.SUDOKU:
        this.handleSudokuInput(input);
        break;
      case GAMES.HANGMAN:
        this.handleHangmanInput(input);
        break;
      case GAMES.G2048:
        this.handle2048Input(input);
        break;
      case GAMES.SNAKE:
        this.handleSnakeInput(input);
        break;
      case GAMES.NUMBER:
        this.handleNumberInput(input);
        break;
      case GAMES.RAPIDFIRE:
        this.handleRapidFireInput(input);
        break;
    }
    this.saveState();
    return true;
  }

  // ════════════════════ GAMES INITIALIZATION & LOGIC ════════════════════

  // 1. TRIVIA QUIZ
  initTrivia() {
    this.gameState.questionIndex = 0;
    this.gameState.score = 0;
    this.renderTrivia();
    const q = this.triviaDb[0];
    this.speak(`Starting Trivia. Question 1: ${q.q}. Option 1: ${q.a[0]}. Option 2: ${q.a[1]}. Option 3: ${q.a[2]}. Option 4: ${q.a[3]}. What is your answer?`);
  }

  renderTrivia() {
    if (!this.container) return;
    const q = this.triviaDb[this.gameState.questionIndex];
    if (!q) return;

    this.container.innerHTML = `
      <div style="text-align:center; font-family:var(--font-mono); color:#fff; display:flex; flex-direction:column; gap:1.2rem; max-width:550px; margin:0 auto; padding:1.5rem;">
        <div style="font-size:0.75rem; color:var(--cyan-neon); letter-spacing:1.5px;">TRIVIA QUIZ // QUESTION ${this.gameState.questionIndex + 1} OF ${this.triviaDb.length}</div>
        <div style="font-size:1.15rem; font-weight:bold; border:1px solid rgba(255,255,255,0.06); background:rgba(255,255,255,0.01); padding:1rem; border-radius:6px; text-shadow:0 0 4px rgba(255,255,255,0.3);">${q.q}</div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.75rem; margin-top:0.5rem;" id="triviaOptionsGrid">
          ${q.a.map((opt, i) => `
            <button class="btn-routine" style="padding:0.8rem; font-size:0.78rem; text-align:left; display:flex; gap:0.5rem; justify-content:flex-start;" onclick="window.lukasGameEngine.processInput('${i+1}')">
              <span style="color:var(--cyan-neon); font-weight:bold;">${i+1}.</span> ${opt}
            </button>
          `).join('')}
        </div>
        <div style="font-size:0.7rem; color:#64748b; margin-top:0.5rem;">Score: ${this.gameState.score}/${this.gameState.questionIndex} | Say "Option 1" or "1" to answer, or click an option.</div>
      </div>
    `;
  }

  handleTriviaInput(input) {
    const q = this.triviaDb[this.gameState.questionIndex];
    if (!q) return;

    // Parse options 1-4
    let answerIdx = -1;
    if (input.includes('1') || input.includes('one') || input.includes(q.a[0].toLowerCase())) answerIdx = 0;
    else if (input.includes('2') || input.includes('two') || input.includes(q.a[1].toLowerCase())) answerIdx = 1;
    else if (input.includes('3') || input.includes('three') || input.includes(q.a[2].toLowerCase())) answerIdx = 2;
    else if (input.includes('4') || input.includes('four') || input.includes(q.a[3].toLowerCase())) answerIdx = 3;

    if (answerIdx === -1) {
      this.speak("Invalid option. Please choose Option 1, 2, 3, or 4.");
      return;
    }

    const correct = (answerIdx === q.correct);
    let feedback = "";
    if (correct) {
      this.gameState.score++;
      feedback = "Correct! Well done. ";
    } else {
      feedback = `Incorrect. The correct answer was option ${q.correct + 1}: ${q.a[q.correct]}. `;
    }

    this.gameState.questionIndex++;
    if (this.gameState.questionIndex >= this.triviaDb.length) {
      const finalMsg = `${feedback}Game over, Commander! You scored ${this.gameState.score} out of ${this.triviaDb.length}.`;
      this.speak(finalMsg);
      this.renderGameOver(`Trivia Quiz Completed! Final Score: ${this.gameState.score}/${this.triviaDb.length}`);
      this.currentGame = null;
    } else {
      const nextQ = this.triviaDb[this.gameState.questionIndex];
      this.renderTrivia();
      this.speak(`${feedback}Next question. Question ${this.gameState.questionIndex + 1}: ${nextQ.q}. Option 1: ${nextQ.a[0]}. Option 2: ${nextQ.a[1]}. Option 3: ${nextQ.a[2]}. Option 4: ${nextQ.a[3]}.`);
    }
  }

  // 2. GUESS THE MOVIE
  initMovieGuess() {
    this.gameState.movieIndex = Math.floor(Math.random() * this.movieDb.length);
    this.gameState.hintIndex = 0;
    this.renderMovieGuess();
    const movie = this.movieDb[this.gameState.movieIndex];
    this.speak(`Let's play Guess the Movie. Hint 1: ${movie.hints[0]}. What is the name of this movie?`);
  }

  renderMovieGuess() {
    if (!this.container) return;
    const movie = this.movieDb[this.gameState.movieIndex];
    this.container.innerHTML = `
      <div style="text-align:center; font-family:var(--font-mono); color:#fff; display:flex; flex-direction:column; gap:1.2rem; max-width:500px; margin:0 auto; padding:1.5rem;">
        <div style="font-size:0.75rem; color:var(--cyan-neon); letter-spacing:1.5px;">GUESS THE MOVIE</div>
        <div style="border:1px solid rgba(255,255,255,0.06); background:rgba(255,255,255,0.01); padding:1rem; border-radius:6px; display:flex; flex-direction:column; gap:0.6rem; text-align:left;">
          <div style="color:var(--cyan-neon); font-size:0.75rem;">MOVIE HINTS RECEIVED:</div>
          ${movie.hints.slice(0, this.gameState.hintIndex + 1).map((hint, idx) => `
            <div style="font-size:0.85rem;"><i class="fa-solid fa-clapperboard" style="color:var(--purple-neon); margin-right:6px;"></i> Hint ${idx+1}: ${hint}</div>
          `).join('')}
        </div>
        <div style="display:flex; gap:0.5rem; justify-content:center; margin-top:0.5rem;">
          <button class="btn-routine" onclick="window.lukasGameEngine.processInput('hint')" style="font-size:0.72rem; padding:0.5rem 1rem;">
            <i class="fa-solid fa-lightbulb"></i> Get Hint (${3 - this.gameState.hintIndex} left)
          </button>
        </div>
        <div style="font-size:0.7rem; color:#64748b;">Speak the name of the movie or type it below. Say "hint" for another hint.</div>
      </div>
    `;
  }

  handleMovieInput(input) {
    const movie = this.movieDb[this.gameState.movieIndex];
    if (input === 'hint' || input.includes('get hint') || input.includes('another hint')) {
      if (this.gameState.hintIndex < movie.hints.length - 1) {
        this.gameState.hintIndex++;
        this.renderMovieGuess();
        this.speak(`Here is Hint ${this.gameState.hintIndex + 1}: ${movie.hints[this.gameState.hintIndex]}. What movie is it?`);
      } else {
        this.speak("I've given you all the hints! What's your final guess?");
      }
      return;
    }

    if (input.includes(movie.title.toLowerCase())) {
      this.speak(`Correct! The movie is indeed ${movie.title}. Outstanding job!`);
      this.renderGameOver(`Success! You guessed the movie: ${movie.title}`);
      this.currentGame = null;
    } else {
      this.speak(`No, that is not correct. Try again, or ask for another hint.`);
    }
  }

  // 3. GUESS THE SONG
  initSongGuess() {
    this.gameState.songIndex = Math.floor(Math.random() * this.songDb.length);
    this.gameState.hintIndex = 0;
    this.renderSongGuess();
    const song = this.songDb[this.gameState.songIndex];
    this.speak(`Let's play Guess the Song. Hint 1: ${song.hints[0]}. What is the name of this song?`);
  }

  renderSongGuess() {
    if (!this.container) return;
    const song = this.songDb[this.gameState.songIndex];
    this.container.innerHTML = `
      <div style="text-align:center; font-family:var(--font-mono); color:#fff; display:flex; flex-direction:column; gap:1.2rem; max-width:500px; margin:0 auto; padding:1.5rem;">
        <div style="font-size:0.75rem; color:var(--cyan-neon); letter-spacing:1.5px;">GUESS THE SONG</div>
        <div style="border:1px solid rgba(255,255,255,0.06); background:rgba(255,255,255,0.01); padding:1rem; border-radius:6px; display:flex; flex-direction:column; gap:0.6rem; text-align:left;">
          <div style="color:var(--cyan-neon); font-size:0.75rem;">SONG HINTS RECEIVED:</div>
          ${song.hints.slice(0, this.gameState.hintIndex + 1).map((hint, idx) => `
            <div style="font-size:0.85rem;"><i class="fa-solid fa-music" style="color:var(--purple-neon); margin-right:6px;"></i> Hint ${idx+1}: ${hint}</div>
          `).join('')}
        </div>
        <div style="display:flex; gap:0.5rem; justify-content:center; margin-top:0.5rem;">
          <button class="btn-routine" onclick="window.lukasGameEngine.processInput('hint')" style="font-size:0.72rem; padding:0.5rem 1rem;">
            <i class="fa-solid fa-lightbulb"></i> Get Hint (${2 - this.gameState.hintIndex} left)
          </button>
        </div>
        <div style="font-size:0.7rem; color:#64748b;">Speak the name of the song or type it. Say "hint" for another hint.</div>
      </div>
    `;
  }

  handleSongInput(input) {
    const song = this.songDb[this.gameState.songIndex];
    if (input === 'hint' || input.includes('get hint') || input.includes('another hint')) {
      if (this.gameState.hintIndex < song.hints.length - 1) {
        this.gameState.hintIndex++;
        this.renderSongGuess();
        this.speak(`Here is Hint ${this.gameState.hintIndex + 1}: ${song.hints[this.gameState.hintIndex]}. What song is this?`);
      } else {
        this.speak("No more hints. What's your final answer?");
      }
      return;
    }

    if (input.includes(song.title.toLowerCase()) || input.includes(song.title.replace(/\s+/g,'').toLowerCase())) {
      this.speak(`Correct! The song is "${song.title}" by ${song.artist}. Spot on, Commander!`);
      this.renderGameOver(`Success! Song identified: "${song.title}" by ${song.artist}`);
      this.currentGame = null;
    } else {
      this.speak("That's not it. Keep trying, or ask for another hint.");
    }
  }

  // 4. WORD CHAIN
  initWordChain() {
    this.gameState.lastLetter = 'a';
    this.gameState.usedWords = new Set(["apple"]);
    this.renderWordChain();
    this.speak("Word Chain initialized. I start with: Apple. That ends with E. Say a word starting with E.");
  }

  renderWordChain() {
    if (!this.container) return;
    this.container.innerHTML = `
      <div style="text-align:center; font-family:var(--font-mono); color:#fff; display:flex; flex-direction:column; gap:1.2rem; max-width:500px; margin:0 auto; padding:1.5rem;">
        <div style="font-size:0.75rem; color:var(--cyan-neon); letter-spacing:1.5px;">WORD CHAIN CHALLENGE</div>
        <div style="border:1px solid rgba(255,255,255,0.06); background:rgba(255,255,255,0.01); padding:1rem; border-radius:6px;">
          <div style="font-size:0.72rem; color:#64748b; margin-bottom:0.4rem;">MUST START WITH LETTER:</div>
          <div style="font-size:2rem; font-weight:bold; color:var(--cyan-neon); text-shadow:0 0 10px var(--cyan-neon-glow);">${this.gameState.lastLetter.toUpperCase()}</div>
        </div>
        <div style="font-size:0.78rem; text-align:left; background:rgba(0,0,0,0.2); padding:0.6rem; border-radius:4px; max-height:100px; overflow-y:auto;">
          <strong>History:</strong> ${Array.from(this.gameState.usedWords).join(' → ')}
        </div>
        <div style="font-size:0.7rem; color:#64748b;">Speak any single noun word that begins with the letter "${this.gameState.lastLetter.toUpperCase()}".</div>
      </div>
    `;
  }

  handleWordChainInput(input) {
    const word = input.replace(/[^a-z]/g, '').trim();
    if (!word || word.length < 2) {
      this.speak("Please speak a valid word.");
      return;
    }

    if (word[0] !== this.gameState.lastLetter) {
      this.speak(`Incorrect letter. The word must start with the letter ${this.gameState.lastLetter.toUpperCase()}. Your word started with ${word[0].toUpperCase()}.`);
      return;
    }

    if (this.gameState.usedWords.has(word)) {
      this.speak(`The word "${word}" has already been used. Say another word.`);
      return;
    }

    // Accept player word
    this.gameState.usedWords.add(word);
    
    // Choose computer word starting with last letter of player word
    const compStart = word[word.length - 1];
    const match = this.validWords.find(w => w.startsWith(compStart) && !this.gameState.usedWords.has(w));

    if (!match) {
      this.speak(`You win! I can't find a word starting with ${compStart.toUpperCase()}. Fantastic job!`);
      this.renderGameOver("Victory! LUKAS ran out of words.");
      this.currentGame = null;
    } else {
      this.gameState.usedWords.add(match);
      const nextLetter = match[match.length - 1];
      this.gameState.lastLetter = nextLetter;
      this.renderWordChain();
      this.speak(`I play: ${match}. It ends with ${nextLetter.toUpperCase()}. Your turn!`);
    }
  }

  // 5. MEMORY CHALLENGE
  initMemoryChallenge() {
    this.gameState.level = 1;
    this.gameState.sequence = [];
    this.generateMemorySequence();
  }

  generateMemorySequence() {
    this.gameState.sequence = [];
    for (let i = 0; i < this.gameState.level + 2; i++) {
      this.gameState.sequence.push(Math.floor(Math.random() * 10));
    }
    this.renderMemoryChallenge(true);
    this.speak(`Level ${this.gameState.level}. Listen closely: ${this.gameState.sequence.join(', ')}. Repeat the numbers back to me.`);
  }

  renderMemoryChallenge(showPrompt = false) {
    if (!this.container) return;
    this.container.innerHTML = `
      <div style="text-align:center; font-family:var(--font-mono); color:#fff; display:flex; flex-direction:column; gap:1.2rem; max-width:500px; margin:0 auto; padding:1.5rem;">
        <div style="font-size:0.75rem; color:var(--cyan-neon); letter-spacing:1.5px;">MEMORY CHALLENGE // LEVEL ${this.gameState.level}</div>
        <div style="border:1px solid rgba(255,255,255,0.06); background:rgba(255,255,255,0.01); padding:2rem; border-radius:6px;">
          ${showPrompt ? `
            <div style="font-size:0.8rem; color:#64748b; margin-bottom:0.5rem;">LISTEN TO THE SEQUENCE PLAYING...</div>
            <div style="font-size:2rem; letter-spacing:8px; font-weight:bold; color:var(--purple-neon); animation:pulse 1s infinite alternate;">● ● ● ●</div>
          ` : `
            <div style="font-size:0.85rem; color:#cbd5e1; margin-bottom:0.5rem;">SPEAK OR TYPE THE SEQUENCE NOW:</div>
            <div style="font-size:1rem; color:#64748b;">(Separate with commas or spaces)</div>
          `}
        </div>
        <div style="font-size:0.7rem; color:#64748b;">Repeat the digits in exact order to advance levels.</div>
      </div>
    `;
    if (showPrompt) {
      setTimeout(() => {
        this.renderMemoryChallenge(false);
      }, 3000);
    }
  }

  handleMemoryInput(input) {
    const digits = input.replace(/[^0-9]/g, '').split('').map(Number);
    const expected = this.gameState.sequence;

    let match = digits.length === expected.length;
    if (match) {
      for (let i = 0; i < expected.length; i++) {
        if (digits[i] !== expected[i]) {
          match = false;
          break;
        }
      }
    }

    if (match) {
      this.gameState.level++;
      this.speak(`Correct! Advancing to Level ${this.gameState.level}.`);
      setTimeout(() => {
        this.generateMemorySequence();
      }, 1000);
    } else {
      this.speak(`Incorrect. The sequence was ${expected.join(', ')}. Game over! You reached Level ${this.gameState.level}.`);
      this.renderGameOver(`Memory Challenge Over at Level ${this.gameState.level}`);
      this.currentGame = null;
    }
  }

  // 6. CHESS (ASCII layout + notation inputs)
  initChess() {
    this.gameState.board = [
      ['r','n','b','q','k','b','n','r'],
      ['p','p','p','p','p','p','p','p'],
      ['.','.','.','.','.','.','.','.'],
      ['.','.','.','.','.','.','.','.'],
      ['.','.','.','.','.','.','.','.'],
      ['.','.','.','.','.','.','.','.'],
      ['P','P','P','P','P','P','P','P'],
      ['R','N','B','Q','K','B','N','R']
    ];
    this.gameState.turn = 'player';
    this.renderChess();
    this.speak("Chess board initialized. White is player. Make your move, for example, say e2 to e4.");
  }

  renderChess() {
    if (!this.container) return;
    const files = ['a','b','c','d','e','f','g','h'];
    const rows = ['8','7','6','5','4','3','2','1'];

    let html = `
      <div style="text-align:center; font-family:var(--font-mono); color:#fff; display:flex; flex-direction:column; gap:1rem; max-width:550px; margin:0 auto; padding:1rem;">
        <div style="font-size:0.75rem; color:var(--cyan-neon); letter-spacing:1.5px;">CHESS GRAPHICAL LINK</div>
        <div style="background:#0f172a; border:2px solid rgba(255,255,255,0.08); border-radius:8px; padding:0.5rem; display:inline-block; margin:0 auto;">
          <table style="border-collapse:collapse; margin:0 auto; font-size:1.15rem; font-family:monospace;">
    `;

    for (let r = 0; r < 8; r++) {
      html += `<tr><td style="color:#475569; font-size:0.7rem; width:20px; text-align:center;">${rows[r]}</td>`;
      for (let c = 0; c < 8; c++) {
        const isDark = (r + c) % 2 === 1;
        const piece = this.gameState.board[r][c];
        const pieceChar = piece === '.' ? '' : this.getChessPieceUnicode(piece);
        html += `<td style="width:40px; height:40px; background:${isDark ? 'rgba(255,255,255,0.04)' : 'transparent'}; text-align:center; vertical-align:middle; font-size:1.6rem; color:${piece === piece.toUpperCase() ? '#00f0ff' : '#a855f7'}; cursor:pointer;" onclick="window.lukasGameEngine.handleChessSquareClick(${r}, ${c})">${pieceChar}</td>`;
      }
      html += '</tr>';
    }

    html += `
          <tr><td></td>
            ${files.map(f => `<td style="color:#475569; font-size:0.7rem; text-align:center;">${f}</td>`).join('')}
          </tr>
          </table>
        </div>
        <div style="font-size:0.7rem; color:#64748b;">Specify moves with algebraic notation, e.g., "e2 to e4" or click squares.</div>
      </div>
    `;

    this.container.innerHTML = html;
  }

  getChessPieceUnicode(piece) {
    const map = {
      'r': '♜', 'n': '♞', 'b': '♝', 'q': '♛', 'k': '♚', 'p': '♟',
      'R': '♖', 'N': '♘', 'B': '♗', 'Q': '♕', 'K': '♔', 'P': '♙'
    };
    return map[piece] || piece;
  }

  handleChessSquareClick(r, c) {
    if (!this.gameState.selected) {
      const piece = this.gameState.board[r][c];
      if (piece !== '.' && piece === piece.toUpperCase()) {
        this.gameState.selected = { r, c };
        const files = ['a','b','c','d','e','f','g','h'];
        const rows = ['8','7','6','5','4','3','2','1'];
        this.speak(`Selected ${piece} at ${files[c]}${rows[r]}. Select destination.`);
      }
    } else {
      const from = this.gameState.selected;
      this.gameState.selected = null;
      const files = ['a','b','c','d','e','f','g','h'];
      const rows = ['8','7','6','5','4','3','2','1'];
      const moveStr = `${files[from.c]}${rows[from.r]} to ${files[c]}${rows[r]}`;
      this.processInput(moveStr);
    }
  }

  handleChessInput(input) {
    // Parse moves: e.g. "e2 to e4", "e2 e4", "e2e4"
    const files = ['a','b','c','d','e','f','g','h'];
    const rows = ['8','7','6','5','4','3','2','1'];

    const match = input.match(/([a-h][1-8])\s*(?:to|->|\s)\s*([a-h][1-8])/i) || input.match(/([a-h][1-8])([a-h][1-8])/i);
    if (!match) {
      this.speak("Move not understood. Format must be e.g. e2 to e4.");
      return;
    }

    const fromStr = match[1].toLowerCase();
    const toStr = match[2].toLowerCase();

    const fromC = files.indexOf(fromStr[0]);
    const fromR = rows.indexOf(fromStr[1]);
    const toC = files.indexOf(toStr[0]);
    const toR = rows.indexOf(toStr[1]);

    const piece = this.gameState.board[fromR]?.[fromC];
    if (!piece || piece === '.') {
      this.speak(`There is no piece at ${fromStr}.`);
      return;
    }

    // Execute move (simple simulation without full validation)
    this.gameState.board[toR][toC] = piece;
    this.gameState.board[fromR][fromC] = '.';

    this.speak(`You played ${fromStr} to ${toStr}.`);
    this.renderChess();

    // Simulated computer response move
    setTimeout(() => {
      this.makeChessComputerMove();
    }, 1200);
  }

  makeChessComputerMove() {
    const rows = ['8','7','6','5','4','3','2','1'];
    const files = ['a','b','c','d','e','f','g','h'];

    // Find all computer black pieces
    const blackPieces = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = this.gameState.board[r][c];
        if (piece !== '.' && piece === piece.toLowerCase()) {
          blackPieces.push({ r, c, piece });
        }
      }
    }

    if (blackPieces.length === 0) {
      this.speak("Checkmate! You win, Commander.");
      this.renderGameOver("Chess Match Victory!");
      this.currentGame = null;
      return;
    }

    // Pick a random piece and slide it forward if path is clear
    let moveMade = false;
    blackPieces.sort(() => Math.random() - 0.5);

    for (const p of blackPieces) {
      const targetR = p.r + 1; // Move forward (downwards in indices)
      if (targetR < 8 && this.gameState.board[targetR][p.c] === '.') {
        this.gameState.board[targetR][p.c] = p.piece;
        this.gameState.board[p.r][p.c] = '.';
        this.speak(`Computer plays ${files[p.c]}${rows[p.r]} to ${files[p.c]}${rows[targetR]}. Your turn.`);
        moveMade = true;
        break;
      }
    }

    if (!moveMade) {
      this.speak("Draw! No legal moves remain for black.");
      this.currentGame = null;
    } else {
      this.renderChess();
    }
  }

  // 7. TIC TAC TOE (Interactive 3x3 Minimax)
  initTicTacToe() {
    this.gameState.board = Array(9).fill('');
    this.gameState.turn = 'player';
    this.renderTicTacToe();
    this.speak("Tic Tac Toe initialized. You are X. Click a cell or say a position like top left, center, or 1 to 9.");
  }

  renderTicTacToe() {
    if (!this.container) return;
    this.container.innerHTML = `
      <div style="text-align:center; font-family:var(--font-mono); color:#fff; display:flex; flex-direction:column; gap:1.2rem; max-width:400px; margin:0 auto; padding:1rem;">
        <div style="font-size:0.75rem; color:var(--cyan-neon); letter-spacing:1.5px;">TIC TAC TOE</div>
        <div style="display:grid; grid-template-columns:repeat(3, 100px); grid-template-rows:repeat(3, 100px); gap:0.5rem; justify-content:center; margin-top:0.5rem;">
          ${this.gameState.board.map((cell, idx) => `
            <button class="btn-routine" style="font-size:2rem; font-weight:bold; color:${cell === 'X' ? 'var(--cyan-neon)' : 'var(--purple-neon)'}; display:flex; align-items:center; justify-content:center; padding:0; height:100px; width:100px; border-radius:8px;" onclick="window.lukasGameEngine.processInput('${idx + 1}')">
              ${cell}
            </button>
          `).join('')}
        </div>
        <div style="font-size:0.7rem; color:#64748b;">Score: X (Player) vs O (Computer)</div>
      </div>
    `;
  }

  handleTicTacToeInput(input) {
    if (this.gameState.turn !== 'player') return;

    let index = -1;
    // Map position names
    if (input.includes('top left') || input === '1') index = 0;
    else if (input.includes('top center') || input.includes('top middle') || input === '2') index = 1;
    else if (input.includes('top right') || input === '3') index = 2;
    else if (input.includes('middle left') || input.includes('center left') || input === '4') index = 3;
    else if (input.includes('center') || input.includes('middle') || input === '5') index = 5; // center is index 4! Wait
    else if (input.includes('middle right') || input.includes('center right') || input === '6') index = 5;
    else if (input.includes('bottom left') || input === '7') index = 6;
    else if (input.includes('bottom center') || input.includes('bottom middle') || input === '8') index = 7;
    else if (input.includes('bottom right') || input === '9') index = 8;
    
    // Fix center index offset mapping
    if (input.includes('center') && !input.includes('left') && !input.includes('right')) index = 4;

    const val = parseInt(input);
    if (!isNaN(val) && val >= 1 && val <= 9) {
      index = val - 1;
    }

    if (index === -1 || this.gameState.board[index] !== '') {
      this.speak("Cell occupied or invalid location. Choose again.");
      return;
    }

    // Play player
    this.gameState.board[index] = 'X';
    this.renderTicTacToe();

    if (this.checkWin('X')) {
      this.speak("Victory! You won Tic Tac Toe, Commander.");
      this.renderGameOver("Tic Tac Toe Player Wins!");
      this.currentGame = null;
      return;
    }

    if (this.gameState.board.every(c => c !== '')) {
      this.speak("Draw! The board is full.");
      this.renderGameOver("Tic Tac Toe Draw Match");
      this.currentGame = null;
      return;
    }

    this.gameState.turn = 'computer';
    setTimeout(() => {
      this.playTicTacToeComputer();
    }, 800);
  }

  playTicTacToeComputer() {
    // Minimax search or simple blocker
    const bestMove = this.findBestTicTacToeMove();
    this.gameState.board[bestMove] = 'O';
    this.renderTicTacToe();

    if (this.checkWin('O')) {
      this.speak("Computer wins Tic Tac Toe. Better luck next time.");
      this.renderGameOver("Tic Tac Toe Computer Defeated You");
      this.currentGame = null;
      return;
    }

    if (this.gameState.board.every(c => c !== '')) {
      this.speak("Draw! Excellent defense.");
      this.renderGameOver("Tic Tac Toe Draw Match");
      this.currentGame = null;
      return;
    }

    this.gameState.turn = 'player';
  }

  checkWin(player) {
    const b = this.gameState.board;
    const wins = [
      [0,1,2], [3,4,5], [6,7,8], // Rows
      [0,3,6], [1,4,7], [2,5,8], // Cols
      [0,4,8], [2,4,6]           // Diag
    ];
    return wins.some(w => w.every(idx => b[idx] === player));
  }

  findBestTicTacToeMove() {
    // Check if computer O can win in one move
    for (let i = 0; i < 9; i++) {
      if (this.gameState.board[i] === '') {
        this.gameState.board[i] = 'O';
        const win = this.checkWin('O');
        this.gameState.board[i] = '';
        if (win) return i;
      }
    }

    // Check if player X can win and block them
    for (let i = 0; i < 9; i++) {
      if (this.gameState.board[i] === '') {
        this.gameState.board[i] = 'X';
        const win = this.checkWin('X');
        this.gameState.board[i] = '';
        if (win) return i;
      }
    }

    // Take center
    if (this.gameState.board[4] === '') return 4;

    // Take random corner
    const corners = [0,2,6,8].filter(idx => this.gameState.board[idx] === '');
    if (corners.length > 0) return corners[Math.floor(Math.random() * corners.length)];

    // Take random remaining
    const empty = this.gameState.board.map((c, i) => c === '' ? i : null).filter(c => c !== null);
    return empty[Math.floor(Math.random() * empty.length)];
  }

  // 8. SUDOKU
  initSudoku() {
    // Solvable 9x9 grid mock with a few missing spots
    this.gameState.grid = [
      [5,3,4,6,7,8,9,1,2],
      [6,7,2,1,9,5,3,4,8],
      [1,9,8,3,4,2,5,6,7],
      [8,5,9,7,6,1,4,2,3],
      [4,2,6,8,5,3,7,9,1],
      [7,1,3,9,2,4,8,5,6],
      [9,6,1,5,3,7,2,8,4],
      [2,8,7,4,1,9,6,3,5],
      [3,4,5,2,8,6,1,7,0] // last cell is 0 (missing)
    ];
    this.gameState.solution = 9;
    this.renderSudoku();
    this.speak("Sudoku puzzle loaded. Only one cell remains in the bottom right corner. What digit should go there?");
  }

  renderSudoku() {
    if (!this.container) return;
    let html = `
      <div style="text-align:center; font-family:var(--font-mono); color:#fff; display:flex; flex-direction:column; gap:1rem; max-width:400px; margin:0 auto; padding:0.5rem;">
        <div style="font-size:0.75rem; color:var(--cyan-neon); letter-spacing:1.5px;">SUDOKU PUZZLE</div>
        <div style="display:grid; grid-template-columns:repeat(9, 32px); grid-template-rows:repeat(9, 32px); gap:2px; justify-content:center; background:rgba(255,255,255,0.08); padding:4px; border-radius:6px; border:2px solid rgba(255,255,255,0.2);">
    `;

    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const val = this.gameState.grid[r][c];
        const isEditable = val === 0;
        html += `
          <div style="width:32px; height:32px; background:${isEditable ? 'rgba(0,240,255,0.1)' : 'rgba(255,255,255,0.02)'}; border-radius:3px; display:flex; align-items:center; justify-content:center; font-size:0.85rem; font-weight:bold; color:${isEditable ? 'var(--cyan-neon)' : '#cbd5e1'}; font-family:monospace; border:1px solid rgba(255,255,255,0.04); cursor:pointer;" onclick="${isEditable ? `window.lukasGameEngine.promptSudokuFill(${r},${c})` : ''}">
            ${val === 0 ? '?' : val}
          </div>
        `;
      }
    }

    html += `
        </div>
        <div style="font-size:0.7rem; color:#64748b;">Specify the missing digit by typing it or clicking the blank cell.</div>
      </div>
    `;

    this.container.innerHTML = html;
  }

  promptSudokuFill(r, c) {
    const val = prompt("Enter digit (1-9) for bottom right:");
    if (val) this.processInput(val);
  }

  handleSudokuInput(input) {
    const digit = parseInt(input.replace(/[^0-9]/g, ''));
    if (isNaN(digit) || digit < 1 || digit > 9) {
      this.speak("Please enter a single digit between 1 and 9.");
      return;
    }

    if (digit === this.gameState.solution) {
      this.gameState.grid[8][8] = digit;
      this.renderSudoku();
      this.speak("Excellent! That is the correct solution. Sudoku completed!");
      this.renderGameOver("Sudoku Puzzle Solved!");
      this.currentGame = null;
    } else {
      this.speak("That digit does not solve the puzzle. Try again.");
    }
  }

  // 9. HANGMAN
  initHangman() {
    const words = ["matrix", "quantum", "cyberpunk", "hologram", "thermostat", "security"];
    this.gameState.word = words[Math.floor(Math.random() * words.length)];
    this.gameState.guesses = new Set();
    this.gameState.wrongGuesses = 0;
    this.renderHangman();
    this.speak(`Hangman started. The secret word has ${this.gameState.word.length} letters. Guess your first letter!`);
  }

  renderHangman() {
    if (!this.container) return;
    const word = this.gameState.word;
    const display = word.split('').map(char => this.gameState.guesses.has(char) ? char : '_').join(' ');

    this.container.innerHTML = `
      <div style="text-align:center; font-family:var(--font-mono); color:#fff; display:flex; flex-direction:column; gap:1.2rem; max-width:500px; margin:0 auto; padding:1.5rem;">
        <div style="font-size:0.75rem; color:var(--cyan-neon); letter-spacing:1.5px;">HANGMAN SPECTRUM</div>
        <div style="font-size:2.4rem; letter-spacing:4px; font-weight:bold; color:var(--cyan-neon); border-bottom:1px dashed rgba(255,255,255,0.06); padding-bottom:0.8rem;">${display}</div>
        <div style="font-size:0.85rem; text-align:left; background:rgba(0,0,0,0.25); border-radius:6px; padding:0.8rem; border:1px solid rgba(255,255,255,0.04);">
          <div><span style="color:var(--rose-neon);">Wrong Guesses:</span> ${this.gameState.wrongGuesses} / 6</div>
          <div style="margin-top:0.4rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;"><span style="color:var(--cyan-neon);">Tried Letters:</span> ${Array.from(this.gameState.guesses).join(', ').toUpperCase() || 'None'}</div>
        </div>
        <div style="font-size:0.7rem; color:#64748b;">Guess a letter by saying or typing it, e.g. "A".</div>
      </div>
    `;
  }

  handleHangmanInput(input) {
    const char = input.replace(/[^a-z]/g, '').trim()[0];
    if (!char) {
      this.speak("Invalid character. Please speak a single letter.");
      return;
    }

    if (this.gameState.guesses.has(char)) {
      this.speak(`You've already guessed the letter ${char.toUpperCase()}. Choose another.`);
      return;
    }

    this.gameState.guesses.add(char);

    if (this.gameState.word.includes(char)) {
      this.speak(`Yes! The letter ${char.toUpperCase()} is in the word.`);
    } else {
      this.gameState.wrongGuesses++;
      this.speak(`No, the letter ${char.toUpperCase()} is not in the word.`);
    }

    const display = this.gameState.word.split('').map(c => this.gameState.guesses.has(c) ? c : '_').join('');
    this.renderHangman();

    if (display === this.gameState.word) {
      this.speak(`Victory! You guessed the secret word: ${this.gameState.word}. Outstanding!`);
      this.renderGameOver(`Success! Guessed word: ${this.gameState.word}`);
      this.currentGame = null;
    } else if (this.gameState.wrongGuesses >= 6) {
      this.speak(`Game over! You ran out of guesses. The secret word was ${this.gameState.word}.`);
      this.renderGameOver(`Defeat! The word was: ${this.gameState.word}`);
      this.currentGame = null;
    }
  }

  // 10. 2048 (HTML UI slider with arrow keys/gestures)
  init2048() {
    this.gameState.grid = Array(16).fill(0);
    this.spawn2048Tile();
    this.spawn2048Tile();
    this.render2048();
    this.speak("Launched 2048. Use arrow keys, swipe, or say slide up, slide down, left or right.");
  }

  spawn2048Tile() {
    const emptyIndices = this.gameState.grid.map((val, idx) => val === 0 ? idx : null).filter(v => v !== null);
    if (emptyIndices.length > 0) {
      const randIdx = emptyIndices[Math.floor(Math.random() * emptyIndices.length)];
      this.gameState.grid[randIdx] = Math.random() < 0.9 ? 2 : 4;
    }
  }

  render2048() {
    if (!this.container) return;
    this.container.innerHTML = `
      <div style="text-align:center; font-family:var(--font-mono); color:#fff; display:flex; flex-direction:column; gap:1rem; max-width:400px; margin:0 auto; padding:0.5rem;">
        <div style="font-size:0.75rem; color:var(--cyan-neon); letter-spacing:1.5px;">2048 ENGINE // SCORE: ${this.gameState.score}</div>
        <div style="display:grid; grid-template-columns:repeat(4, 70px); grid-template-rows:repeat(4, 70px); gap:0.4rem; justify-content:center; background:rgba(255,255,255,0.06); padding:0.5rem; border-radius:8px; border:2px solid rgba(255,255,255,0.1);" id="g2048Grid">
          ${this.gameState.grid.map(val => `
            <div style="width:70px; height:70px; background:${val ? `rgba(0, 240, 255, ${Math.min(0.8, 0.1 + Math.log2(val) * 0.08)})` : 'rgba(255,255,255,0.01)'}; border-radius:4px; display:flex; align-items:center; justify-content:center; font-size:1.2rem; font-weight:bold; color:${val ? '#fff' : 'transparent'}; box-shadow:${val ? '0 0 6px rgba(0, 240, 255, 0.15)' : 'none'}; border:1px solid rgba(255,255,255,0.02);">
              ${val || ''}
            </div>
          `).join('')}
        </div>
        <div style="display:flex; gap:0.5rem; justify-content:center; margin-top:0.4rem;">
          <button class="btn-routine" onclick="window.lukasGameEngine.processInput('left')" style="padding:0.4rem 0.8rem; font-size:0.65rem;"><i class="fa-solid fa-arrow-left"></i> LEFT</button>
          <button class="btn-routine" onclick="window.lukasGameEngine.processInput('up')" style="padding:0.4rem 0.8rem; font-size:0.65rem;"><i class="fa-solid fa-arrow-up"></i> UP</button>
          <button class="btn-routine" onclick="window.lukasGameEngine.processInput('down')" style="padding:0.4rem 0.8rem; font-size:0.65rem;"><i class="fa-solid fa-arrow-down"></i> DOWN</button>
          <button class="btn-routine" onclick="window.lukasGameEngine.processInput('right')" style="padding:0.4rem 0.8rem; font-size:0.65rem;"><i class="fa-solid fa-arrow-right"></i> RIGHT</button>
        </div>
      </div>
    `;

    // Keyboard bindings for Arrow keys
    if (!this.gameState.keyboardBound) {
      this.gameState.keyboardBound = true;
      const keyHandler = (e) => {
        if (this.currentGame !== GAMES.G2048) {
          window.removeEventListener('keydown', keyHandler);
          return;
        }
        if (e.key === 'ArrowUp') this.processInput('up');
        if (e.key === 'ArrowDown') this.processInput('down');
        if (e.key === 'ArrowLeft') this.processInput('left');
        if (e.key === 'ArrowRight') this.processInput('right');
      };
      window.addEventListener('keydown', keyHandler);
    }
  }

  handle2048Input(input) {
    let moved = false;
    let grid = this.gameState.grid;

    // Helper: slide/merge line
    const slide = (row) => {
      let filtered = row.filter(v => v !== 0);
      let newRow = [];
      for (let i = 0; i < filtered.length; i++) {
        if (filtered[i] === filtered[i + 1]) {
          newRow.push(filtered[i] * 2);
          this.gameState.score += filtered[i] * 2;
          i++;
          moved = true;
        } else {
          newRow.push(filtered[i]);
        }
      }
      while (newRow.length < 4) newRow.push(0);
      return newRow;
    };

    if (input.includes('left')) {
      for (let i = 0; i < 4; i++) {
        const row = [grid[i*4], grid[i*4+1], grid[i*4+2], grid[i*4+3]];
        const slid = slide(row);
        for (let j = 0; j < 4; j++) {
          if (grid[i*4+j] !== slid[j]) moved = true;
          grid[i*4+j] = slid[j];
        }
      }
    } else if (input.includes('right')) {
      for (let i = 0; i < 4; i++) {
        const row = [grid[i*4+3], grid[i*4+2], grid[i*4+1], grid[i*4]];
        const slid = slide(row);
        for (let j = 0; j < 4; j++) {
          if (grid[i*4+3-j] !== slid[j]) moved = true;
          grid[i*4+3-j] = slid[j];
        }
      }
    } else if (input.includes('up')) {
      for (let i = 0; i < 4; i++) {
        const row = [grid[i], grid[i+4], grid[i+8], grid[i+12]];
        const slid = slide(row);
        for (let j = 0; j < 4; j++) {
          if (grid[i+j*4] !== slid[j]) moved = true;
          grid[i+j*4] = slid[j];
        }
      }
    } else if (input.includes('down')) {
      for (let i = 0; i < 4; i++) {
        const row = [grid[i+12], grid[i+8], grid[i+4], grid[i]];
        const slid = slide(row);
        for (let j = 0; j < 4; j++) {
          if (grid[i+(3-j)*4] !== slid[j]) moved = true;
          grid[i+(3-j)*4] = slid[j];
        }
      }
    }

    if (moved) {
      this.spawn2048Tile();
      this.render2048();

      // Check game over
      const empty = grid.some(val => val === 0);
      if (!empty) {
        // Check if any legal moves remain
        let legalMoves = false;
        for (let i = 0; i < 16; i++) {
          if (i % 4 !== 3 && grid[i] === grid[i+1]) legalMoves = true;
          if (i < 12 && grid[i] === grid[i+4]) legalMoves = true;
        }
        if (!legalMoves) {
          this.speak(`Game over! No moves left. Final Score: ${this.gameState.score}.`);
          this.renderGameOver(`2048 Finished. Final Score: ${this.gameState.score}`);
          this.currentGame = null;
        }
      }
    }
  }

  // 11. SNAKE (Canvas-based game)
  initSnake() {
    this.gameState.snake = [{ x: 10, y: 10 }];
    this.gameState.dir = { x: 1, y: 0 };
    this.gameState.food = { x: 15, y: 10 };
    this.gameState.gridSize = 20;
    this.gameState.score = 0;
    this.gameState.speed = 150; // ms per tick
    this.gameState.lastTick = 0;

    this.renderSnakeContainer();
    this.gameState.loop = requestAnimationFrame((t) => this.snakeLoop(t));
    this.speak("Launched Snake. Say left, right, up, or down to turn, or click screen controls.");
  }

  renderSnakeContainer() {
    if (!this.container) return;
    this.container.innerHTML = `
      <div style="text-align:center; font-family:var(--font-mono); color:#fff; display:flex; flex-direction:column; gap:0.6rem; max-width:400px; margin:0 auto; padding:0.5rem;">
        <div style="font-size:0.75rem; color:var(--cyan-neon); letter-spacing:1.5px;">SNAKE PROTOCOL // SCORE: <span id="snakeScore">0</span></div>
        <canvas id="snakeCanvas" width="280" height="280" style="background:#0f172a; border:2px solid rgba(255,255,255,0.08); border-radius:6px; margin:0 auto; display:block;"></canvas>
        <div style="display:flex; gap:0.5rem; justify-content:center; margin-top:0.4rem;">
          <button class="btn-routine" onclick="window.lukasGameEngine.processInput('left')" style="padding:0.4rem 0.8rem; font-size:0.65rem;"><i class="fa-solid fa-arrow-left"></i> LEFT</button>
          <button class="btn-routine" onclick="window.lukasGameEngine.processInput('up')" style="padding:0.4rem 0.8rem; font-size:0.65rem;"><i class="fa-solid fa-arrow-up"></i> UP</button>
          <button class="btn-routine" onclick="window.lukasGameEngine.processInput('down')" style="padding:0.4rem 0.8rem; font-size:0.65rem;"><i class="fa-solid fa-arrow-down"></i> DOWN</button>
          <button class="btn-routine" onclick="window.lukasGameEngine.processInput('right')" style="padding:0.4rem 0.8rem; font-size:0.65rem;"><i class="fa-solid fa-arrow-right"></i> RIGHT</button>
        </div>
      </div>
    `;

    // Keyboard bindings for Arrow keys
    if (!this.gameState.keyboardBound) {
      this.gameState.keyboardBound = true;
      const keyHandler = (e) => {
        if (this.currentGame !== GAMES.SNAKE) {
          window.removeEventListener('keydown', keyHandler);
          return;
        }
        if (e.key === 'ArrowUp') this.processInput('up');
        if (e.key === 'ArrowDown') this.processInput('down');
        if (e.key === 'ArrowLeft') this.processInput('left');
        if (e.key === 'ArrowRight') this.processInput('right');
      };
      window.addEventListener('keydown', keyHandler);
    }
  }

  snakeLoop(timestamp) {
    if (this.currentGame !== GAMES.SNAKE) return;

    if (!this.gameState.lastTick) this.gameState.lastTick = timestamp;
    const elapsed = timestamp - this.gameState.lastTick;

    if (elapsed > this.gameState.speed) {
      this.gameState.lastTick = timestamp;
      this.tickSnake();
    }

    this.gameState.loop = requestAnimationFrame((t) => this.snakeLoop(t));
  }

  tickSnake() {
    const canvas = document.getElementById('snakeCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const gridSize = this.gameState.gridSize;
    const cellCount = canvas.width / gridSize;

    // Move head
    const head = {
      x: this.gameState.snake[0].x + this.gameState.dir.x,
      y: this.gameState.snake[0].y + this.gameState.dir.y
    };

    // Collision with wall
    if (head.x < 0 || head.x >= cellCount || head.y < 0 || head.y >= cellCount) {
      this.speak(`Game over! Collided with perimeter shield. Score: ${this.gameState.score}`);
      this.renderGameOver(`Snake Defeat. Score: ${this.gameState.score}`);
      this.currentGame = null;
      return;
    }

    // Collision with self
    if (this.gameState.snake.some(segment => segment.x === head.x && segment.y === head.y)) {
      this.speak(`Game over! Collided with own tail. Score: ${this.gameState.score}`);
      this.renderGameOver(`Snake Defeat. Score: ${this.gameState.score}`);
      this.currentGame = null;
      return;
    }

    this.gameState.snake.unshift(head);

    // Food collision
    if (head.x === this.gameState.food.x && head.y === this.gameState.food.y) {
      this.gameState.score++;
      document.getElementById('snakeScore').textContent = this.gameState.score;
      
      // Spawn new food
      let validFood = false;
      while (!validFood) {
        const randX = Math.floor(Math.random() * cellCount);
        const randY = Math.floor(Math.random() * cellCount);
        if (!this.gameState.snake.some(seg => seg.x === randX && seg.y === randY)) {
          this.gameState.food = { x: randX, y: randY };
          validFood = true;
        }
      }
    } else {
      this.gameState.snake.pop();
    }

    // Draw frame
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw grid lines (subtle)
    ctx.strokeStyle = 'rgba(255,255,255,0.02)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= cellCount; i++) {
      ctx.beginPath();
      ctx.moveTo(i * gridSize, 0);
      ctx.lineTo(i * gridSize, canvas.height);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, i * gridSize);
      ctx.lineTo(canvas.width, i * gridSize);
      ctx.stroke();
    }

    // Draw snake (cyan head, green body)
    this.gameState.snake.forEach((seg, idx) => {
      ctx.fillStyle = idx === 0 ? '#00f0ff' : '#10b981';
      ctx.fillRect(seg.x * gridSize + 1, seg.y * gridSize + 1, gridSize - 2, gridSize - 2);
    });

    // Draw food (rose)
    ctx.fillStyle = '#f43f5e';
    ctx.beginPath();
    ctx.arc(this.gameState.food.x * gridSize + gridSize/2, this.gameState.food.y * gridSize + gridSize/2, gridSize/2 - 2, 0, Math.PI * 2);
    ctx.fill();
  }

  handleSnakeInput(input) {
    const d = this.gameState.dir;
    if (input.includes('up') && d.y === 0) this.gameState.dir = { x: 0, y: -1 };
    else if (input.includes('down') && d.y === 0) this.gameState.dir = { x: 0, y: 1 };
    else if (input.includes('left') && d.x === 0) this.gameState.dir = { x: -1, y: 0 };
    else if (input.includes('right') && d.x === 0) this.gameState.dir = { x: 1, y: 0 };
  }

  // 12. NUMBER CHALLENGE
  initNumberChallenge() {
    this.gameState.target = Math.floor(Math.random() * 100) + 1;
    this.gameState.attempts = 0;
    this.renderNumberChallenge();
    this.speak("Guess a number between 1 and 100. What's your first guess?");
  }

  renderNumberChallenge() {
    if (!this.container) return;
    this.container.innerHTML = `
      <div style="text-align:center; font-family:var(--font-mono); color:#fff; display:flex; flex-direction:column; gap:1.2rem; max-width:500px; margin:0 auto; padding:1.5rem;">
        <div style="font-size:0.75rem; color:var(--cyan-neon); letter-spacing:1.5px;">NUMBER CHALLENGE</div>
        <div style="border:1px solid rgba(255,255,255,0.06); background:rgba(255,255,255,0.01); padding:2rem; border-radius:6px;">
          <div style="font-size:1.1rem; color:#cbd5e1;">ATTEMPTS INITIATED:</div>
          <div style="font-size:3.2rem; font-weight:bold; color:var(--cyan-neon); margin-top:0.4rem; text-shadow:0 0 10px var(--cyan-neon-glow);">${this.gameState.attempts}</div>
        </div>
        <div style="font-size:0.7rem; color:#64748b;">Guess the target integer in as few tries as possible.</div>
      </div>
    `;
  }

  handleNumberInput(input) {
    const guess = parseInt(input.replace(/[^0-9]/g, ''));
    if (isNaN(guess)) {
      this.speak("Please say or type a valid number.");
      return;
    }

    this.gameState.attempts++;
    this.renderNumberChallenge();

    if (guess === this.gameState.target) {
      this.speak(`Correct! The number was ${this.gameState.target}. It took you ${this.gameState.attempts} attempts. Splendid!`);
      this.renderGameOver(`Success! Guessed target ${this.gameState.target} in ${this.gameState.attempts} tries`);
      this.currentGame = null;
    } else if (guess < this.gameState.target) {
      this.speak("Higher. Guess again.");
    } else {
      this.speak("Lower. Guess again.");
    }
  }

  // 13. RAPID FIRE QUIZ
  initRapidFire() {
    this.gameState.questions = [...this.triviaDb].sort(() => Math.random() - 0.5);
    this.gameState.questionIndex = 0;
    this.gameState.score = 0;
    this.gameState.timeLeft = 30; // 30 seconds limit

    this.renderRapidFire();
    const q = this.gameState.questions[0];
    this.speak(`Rapid Fire started! You have 30 seconds. Question 1: ${q.q}. Option 1: ${q.a[0]}. Option 2: ${q.a[1]}. Option 3: ${q.a[2]}. Option 4: ${q.a[3]}.`);

    this.gameState.timer = setInterval(() => {
      this.gameState.timeLeft--;
      const label = document.getElementById('rapidFireTime');
      if (label) label.textContent = `${this.gameState.timeLeft}s`;
      
      if (this.gameState.timeLeft <= 0) {
        clearInterval(this.gameState.timer);
        this.speak(`Time's up! You scored ${this.gameState.score} points in rapid fire.`);
        this.renderGameOver(`Rapid Fire Quiz Finished! Score: ${this.gameState.score}`);
        this.currentGame = null;
      }
    }, 1000);
  }

  renderRapidFire() {
    if (!this.container) return;
    const q = this.gameState.questions[this.gameState.questionIndex];
    this.container.innerHTML = `
      <div style="text-align:center; font-family:var(--font-mono); color:#fff; display:flex; flex-direction:column; gap:1.2rem; max-width:500px; margin:0 auto; padding:1.5rem;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div style="font-size:0.75rem; color:var(--rose-neon); letter-spacing:1.5px; font-weight:bold;" id="rapidFireTime">30s</div>
          <div style="font-size:0.75rem; color:var(--cyan-neon); letter-spacing:1.5px;">RAPID FIRE QUIZ</div>
          <div style="font-size:0.75rem; color:#64748b;">Score: ${this.gameState.score}</div>
        </div>
        <div style="font-size:1.1rem; font-weight:bold; border:1px solid rgba(255,255,255,0.06); background:rgba(255,255,255,0.01); padding:1rem; border-radius:6px;">${q.q}</div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.6rem;">
          ${q.a.map((opt, i) => `
            <button class="btn-routine" style="padding:0.7rem; font-size:0.75rem; text-align:left;" onclick="window.lukasGameEngine.processInput('${i+1}')">
              ${i+1}. ${opt}
            </button>
          `).join('')}
        </div>
      </div>
    `;
  }

  handleRapidFireInput(input) {
    const q = this.gameState.questions[this.gameState.questionIndex];
    let answerIdx = -1;
    if (input.includes('1') || input.includes('one') || input.includes(q.a[0].toLowerCase())) answerIdx = 0;
    else if (input.includes('2') || input.includes('two') || input.includes(q.a[1].toLowerCase())) answerIdx = 1;
    else if (input.includes('3') || input.includes('three') || input.includes(q.a[2].toLowerCase())) answerIdx = 2;
    else if (input.includes('4') || input.includes('four') || input.includes(q.a[3].toLowerCase())) answerIdx = 3;

    if (answerIdx === -1) return;

    if (answerIdx === q.correct) {
      this.gameState.score++;
    }

    this.gameState.questionIndex++;
    if (this.gameState.questionIndex >= this.gameState.questions.length) {
      clearInterval(this.gameState.timer);
      this.speak(`Excellent! You finished all questions. Final Score: ${this.gameState.score} points.`);
      this.renderGameOver(`Rapid Fire Quiz Victory! Final Score: ${this.gameState.score}`);
      this.currentGame = null;
    } else {
      this.renderRapidFire();
      const nextQ = this.gameState.questions[this.gameState.questionIndex];
      this.speak(`Question ${this.gameState.questionIndex + 1}: ${nextQ.q}. Option 1: ${nextQ.a[0]}. Option 2: ${nextQ.a[1]}. Option 3: ${nextQ.a[2]}. Option 4: ${nextQ.a[3]}.`);
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  renderGameOver(statusMsg) {
    if (this.gameState.timer) clearInterval(this.gameState.timer);
    if (!this.container) return;
    this.container.innerHTML = `
      <div style="text-align:center; font-family:var(--font-mono); color:#fff; display:flex; flex-direction:column; gap:1.2rem; max-width:450px; margin:0 auto; padding:2rem;">
        <div style="font-size:2.5rem; color:var(--emerald-neon); text-shadow:0 0 10px rgba(16,185,129,0.3);"><i class="fa-solid fa-trophy"></i></div>
        <div style="font-size:1.1rem; font-weight:bold; letter-spacing:1px; text-transform:uppercase;">${statusMsg}</div>
        <div style="margin-top:0.5rem; display:flex; gap:0.5rem; justify-content:center;">
          <button class="btn-routine" onclick="window.lukasGameEngine.renderSelectionMenu()" style="padding:0.6rem 1.2rem; font-size:0.75rem;">
            <i class="fa-solid fa-rotate-left"></i> BACK TO GAMES
          </button>
        </div>
      </div>
    `;
  }

  renderSelectionMenu() {
    if (this.gameState.timer) clearInterval(this.gameState.timer);
    if (this.currentGame === GAMES.SNAKE && this.gameState.loop) {
      cancelAnimationFrame(this.gameState.loop);
    }
    this.currentGame = null;
    this.gameState = {};
    this.saveState();

    if (!this.container) return;
    this.container.innerHTML = `
      <div style="font-family:var(--font-mono); color:#fff; display:flex; flex-direction:column; gap:1rem; padding:0.5rem 1rem;">
        <div style="text-align:center; font-size:0.72rem; color:#64748b; letter-spacing:0.5px; border-bottom:1px dashed rgba(255,255,255,0.06); padding-bottom:0.6rem;">CHOOSE AN ENTERTAINMENT GRID PROTOCOL:</div>
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(130px, 1fr)); gap:0.6rem;" id="gameGridContainer">
          <div class="brand-select-card" onclick="window.lukasGameEngine.start('trivia')" style="background:rgba(0,240,255,0.03); border:1px solid rgba(0,240,255,0.15); border-radius:6px; padding:0.6rem; cursor:pointer; text-align:center; transition:all 0.2s;">
            <div style="font-size:1.3rem; color:var(--cyan-neon); margin-bottom:0.25rem;"><i class="fa-solid fa-circle-question"></i></div>
            <div style="font-size:0.62rem; font-weight:bold; letter-spacing:0.5px;">TRIVIA QUIZ</div>
          </div>
          <div class="brand-select-card" onclick="window.lukasGameEngine.start('movie')" style="background:rgba(168,85,247,0.03); border:1px solid rgba(168,85,247,0.15); border-radius:6px; padding:0.6rem; cursor:pointer; text-align:center; transition:all 0.2s;">
            <div style="font-size:1.3rem; color:var(--purple-neon); margin-bottom:0.25rem;"><i class="fa-solid fa-clapperboard"></i></div>
            <div style="font-size:0.62rem; font-weight:bold; letter-spacing:0.5px;">GUESS MOVIE</div>
          </div>
          <div class="brand-select-card" onclick="window.lukasGameEngine.start('song')" style="background:rgba(244,63,94,0.03); border:1px solid rgba(244,63,94,0.15); border-radius:6px; padding:0.6rem; cursor:pointer; text-align:center; transition:all 0.2s;">
            <div style="font-size:1.3rem; color:var(--rose-neon); margin-bottom:0.25rem;"><i class="fa-solid fa-music"></i></div>
            <div style="font-size:0.62rem; font-weight:bold; letter-spacing:0.5px;">GUESS SONG</div>
          </div>
          <div class="brand-select-card" onclick="window.lukasGameEngine.start('tictactoe')" style="background:rgba(16,185,129,0.03); border:1px solid rgba(16,185,129,0.15); border-radius:6px; padding:0.6rem; cursor:pointer; text-align:center; transition:all 0.2s;">
            <div style="font-size:1.3rem; color:var(--emerald-neon); margin-bottom:0.25rem;"><i class="fa-solid fa-xmark"></i></div>
            <div style="font-size:0.62rem; font-weight:bold; letter-spacing:0.5px;">TIC TAC TOE</div>
          </div>
          <div class="brand-select-card" onclick="window.lukasGameEngine.start('hangman')" style="background:rgba(245,158,11,0.03); border:1px solid rgba(245,158,11,0.15); border-radius:6px; padding:0.6rem; cursor:pointer; text-align:center; transition:all 0.2s;">
            <div style="font-size:1.3rem; color:var(--amber-neon); margin-bottom:0.25rem;"><i class="fa-solid fa-ghost"></i></div>
            <div style="font-size:0.62rem; font-weight:bold; letter-spacing:0.5px;">HANGMAN</div>
          </div>
          <div class="brand-select-card" onclick="window.lukasGameEngine.start('sudoku')" style="background:rgba(0,240,255,0.03); border:1px solid rgba(0,240,255,0.15); border-radius:6px; padding:0.6rem; cursor:pointer; text-align:center; transition:all 0.2s;">
            <div style="font-size:1.3rem; color:var(--cyan-neon); margin-bottom:0.25rem;"><i class="fa-solid fa-table-cells"></i></div>
            <div style="font-size:0.62rem; font-weight:bold; letter-spacing:0.5px;">SUDOKU</div>
          </div>
          <div class="brand-select-card" onclick="window.lukasGameEngine.start('chess')" style="background:rgba(168,85,247,0.03); border:1px solid rgba(168,85,247,0.15); border-radius:6px; padding:0.6rem; cursor:pointer; text-align:center; transition:all 0.2s;">
            <div style="font-size:1.3rem; color:var(--purple-neon); margin-bottom:0.25rem;"><i class="fa-solid fa-chess"></i></div>
            <div style="font-size:0.62rem; font-weight:bold; letter-spacing:0.5px;">CHESS GRID</div>
          </div>
          <div class="brand-select-card" onclick="window.lukasGameEngine.start('g2048')" style="background:rgba(244,63,94,0.03); border:1px solid rgba(244,63,94,0.15); border-radius:6px; padding:0.6rem; cursor:pointer; text-align:center; transition:all 0.2s;">
            <div style="font-size:1.3rem; color:var(--rose-neon); margin-bottom:0.25rem;"><i class="fa-solid fa-cubes-stacked"></i></div>
            <div style="font-size:0.62rem; font-weight:bold; letter-spacing:0.5px;">2048 SLIDE</div>
          </div>
          <div class="brand-select-card" onclick="window.lukasGameEngine.start('snake')" style="background:rgba(16,185,129,0.03); border:1px solid rgba(16,185,129,0.15); border-radius:6px; padding:0.6rem; cursor:pointer; text-align:center; transition:all 0.2s;">
            <div style="font-size:1.3rem; color:var(--emerald-neon); margin-bottom:0.25rem;"><i class="fa-solid fa-staff-snake"></i></div>
            <div style="font-size:0.62rem; font-weight:bold; letter-spacing:0.5px;">SNAKE CORE</div>
          </div>
          <div class="brand-select-card" onclick="window.lukasGameEngine.start('number')" style="background:rgba(245,158,11,0.03); border:1px solid rgba(245,158,11,0.15); border-radius:6px; padding:0.6rem; cursor:pointer; text-align:center; transition:all 0.2s;">
            <div style="font-size:1.3rem; color:var(--amber-neon); margin-bottom:0.25rem;"><i class="fa-solid fa-arrow-up-9-1"></i></div>
            <div style="font-size:0.62rem; font-weight:bold; letter-spacing:0.5px;">NUMBER TRIAL</div>
          </div>
          <div class="brand-select-card" onclick="window.lukasGameEngine.start('wordchain')" style="background:rgba(0,240,255,0.03); border:1px solid rgba(0,240,255,0.15); border-radius:6px; padding:0.6rem; cursor:pointer; text-align:center; transition:all 0.2s;">
            <div style="font-size:1.3rem; color:var(--cyan-neon); margin-bottom:0.25rem;"><i class="fa-solid fa-link"></i></div>
            <div style="font-size:0.62rem; font-weight:bold; letter-spacing:0.5px;">WORD CHAIN</div>
          </div>
          <div class="brand-select-card" onclick="window.lukasGameEngine.start('memory')" style="background:rgba(168,85,247,0.03); border:1px solid rgba(168,85,247,0.15); border-radius:6px; padding:0.6rem; cursor:pointer; text-align:center; transition:all 0.2s;">
            <div style="font-size:1.3rem; color:var(--purple-neon); margin-bottom:0.25rem;"><i class="fa-solid fa-brain"></i></div>
            <div style="font-size:0.62rem; font-weight:bold; letter-spacing:0.5px;">MEMORY RETAIN</div>
          </div>
          <div class="brand-select-card" onclick="window.lukasGameEngine.start('rapidfire')" style="background:rgba(244,63,94,0.03); border:1px solid rgba(244,63,94,0.15); border-radius:6px; padding:0.6rem; cursor:pointer; text-align:center; transition:all 0.2s;">
            <div style="font-size:1.3rem; color:var(--rose-neon); margin-bottom:0.25rem;"><i class="fa-solid fa-fire-flame-curved"></i></div>
            <div style="font-size:0.62rem; font-weight:bold; letter-spacing:0.5px;">RAPID FIRE</div>
          </div>
        </div>
      </div>
    `;
  }
}

export default LukasGameEngine;
