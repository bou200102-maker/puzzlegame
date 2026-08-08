require('dotenv').config();

if (!process.env.GROQ_API_KEY) {
    console.warn("WARNING: GROQ_API_KEY is missing from environment variables.");
}
if (!process.env.PIXABAY_API_KEY) {
    console.warn("WARNING: PIXABAY_API_KEY is missing from environment variables.");
}

const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const { Groq } = require('groq-sdk');

const app = express();
const server = http.createServer(app);

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const botNames = {
    en: ["Alex", "Jordan", "Taylor", "Charlie", "Casey"],
    fr: ["Jean", "Luc", "Marie", "Claire", "Pierre"],
    ar: ["Ahmed", "Layla", "Omar", "Fatima", "Zaid"]
};

const botPhrases = {
    en: ["Good luck!", "I'm getting closer!", "This is fun!", "Nice move!", "Almost there!"],
    fr: ["Bonne chance!", "Je me rapproche!", "C'est amusant!", "Beau mouvement!", "Presque fini!"],
    ar: ["بالتوفيق!", "لقد اقتربت!", "هذا ممتع!", "حركة جيدة!", "أوشكت على الانتهاء!"]
};

const BOT_PROFILES = {
    "Speed Demon": {
        speedMult: 0.5,
        chatStyle: "Aggressive & Fast",
        phrases: {
            en: ["Too slow!", "I'm on fire!", "Can't catch me!", "Speed is everything!"],
            fr: ["Trop lent!", "Je suis en feu!", "Tu ne m'attraperas pas!", "La vitesse c'est tout!"],
            ar: ["بطيء جداً!", "أنا سريع كالبرق!", "لن تمسك بي!", "السرعة هي كل شيء!"]
        }
    },
    "Trash Talker": {
        speedMult: 1.0,
        chatStyle: "Mocking",
        phrases: {
            en: ["Is that all you got?", "My grandma solves faster.", "Losing again?", "Git gud."],
            fr: ["C'est tout ce que tu as ?", "Ma grand-mère résout plus vite.", "Encore perdu ?", "Améliore-toi."],
            ar: ["هذا كل ما لديك؟", "جدتي تحل الألغاز أسرع منك.", "خسرت مرة أخرى؟", "تعلم كيف تلعب."]
        }
    },
    "Casual Dad": {
        speedMult: 1.5,
        chatStyle: "Friendly & Puns",
        phrases: {
            en: ["Just having some fun!", "Puzzling, isn't it?", "Great job, sport!", "I think I've got it... maybe."],
            fr: ["On s'amuse bien !", "C'est un vrai casse-tête, non ?", "Beau travail, champion !", "Je pense que je l'ai... peut-être."],
            ar: ["مجرد بعض المرح!", "لغز محير، أليس كذلك؟", "عمل رائع يا بطل!", "أعتقد أنني وجدتها... ربما."]
        }
    },
    "Competitive Kid": {
        speedMult: 0.8,
        chatStyle: "Energetic",
        phrases: {
            en: ["I'm gonna win!", "Let's gooo!", "No way!", "Did you see that?!"],
            fr: ["Je vais gagner !", "C'est parti !", "Pas possible !", "Tu as vu ça ?!"],
            ar: ["سأفوز!", "هيا بنا!", "مستحيل!", "هل رأيت ذلك؟!"]
        }
    },
    "Silent Pro": {
        speedMult: 0.6,
        chatStyle: "Minimalist",
        phrases: {
            en: ["...", "GG.", "Focused."],
            fr: ["...", "GG.", "Concentré."],
            ar: ["...", "لعب جيد.", "مركز."]
        }
    },
    "Helpful Player": {
        speedMult: 1.2,
        chatStyle: "Encouraging",
        phrases: {
            en: ["You're doing great!", "Almost there!", "Keep it up!", "Nice one!"],
            fr: ["Tu t'en sors super bien !", "Presque fini !", "Continue comme ça !", "Bien joué !"],
            ar: ["أنت تبلي بلاءً حسناً!", "لقد اقتربت!", "استمر!", "أحسنت!"]
        }
    }
};

// Queues indexed by gridSize and isCoop
// Example: queues["3_false"] = [...]
let queues = {};
let queueEntryTimes = new Map(); // socket.id -> timestamp

let rooms = new Map();
let userIdToSocketId = new Map();

async function fetchRandomPixabayImage(categoryParam) {
    const fallbackCategories = ['nature', 'city', 'technology', 'animals', 'food'];
    const category = (categoryParam && categoryParam !== "Random") ? categoryParam : fallbackCategories[Math.floor(Math.random() * fallbackCategories.length)];
    const apiKey = process.env.PIXABAY_API_KEY;
    const url = `https://pixabay.com/api/?key=${apiKey}&q=${encodeURIComponent(category)}&image_type=photo&orientation=horizontal`;

    const fallback = "https://picsum.photos/600/600";

    return new Promise((resolve) => {
        let resolved = false;
        const safeResolve = (val) => {
            if (!resolved) {
                resolved = true;
                resolve(val);
            }
        };

        const timeout = setTimeout(() => {
            console.log("Pixabay request timed out, using fallback.");
            if (request) {
                try {
                    request.destroy();
                } catch (e) {
                    console.error("Error destroying request during timeout:", e.message);
                }
            }
            safeResolve(fallback);
        }, 8000);

        let request;
        try {
            request = https.get(url, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    clearTimeout(timeout);
                    if (res.statusCode !== 200) {
                        console.error(`Pixabay API returned status ${res.statusCode}`);
                        safeResolve(fallback);
                        return;
                    }
                    try {
                        const json = JSON.parse(data);
                        if (json.hits && json.hits.length > 0) {
                            const randomIndex = Math.floor(Math.random() * json.hits.length);
                            const imgUrl = json.hits[randomIndex].largeImageURL;
                            safeResolve(imgUrl || fallback);
                        } else {
                            console.log("Pixabay API returned no hits, using fallback.");
                            safeResolve(fallback);
                        }
                    } catch (e) {
                        console.error("Error parsing Pixabay response:", e.message);
                        safeResolve(fallback);
                    }
                });

                res.on('error', (err) => {
                    console.error("Response error from Pixabay:", err.message);
                    clearTimeout(timeout);
                    safeResolve(fallback);
                });
            });

            request.on("error", (err) => {
                console.error("Request error from Pixabay:", err.message);
                clearTimeout(timeout);
                safeResolve(fallback);
            });
        } catch (err) {
            console.error("Exception during https.get setup:", err.message);
            clearTimeout(timeout);
            safeResolve(fallback);
        }
    });
}

/**
 * Daily Challenge Helpers
 */
const dailyPuzzleCache = { date: null, data: null };

function getSeedFromDate(dateStr) {
    let hash = 0;
    for (let i = 0; i < dateStr.length; i++) {
        hash = (hash << 5) - hash + dateStr.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash);
}

async function fetchDailyPuzzle(dateStr) {
    if (dailyPuzzleCache.date === dateStr && dailyPuzzleCache.data) {
        return dailyPuzzleCache.data;
    }

    const seed = getSeedFromDate(dateStr);
    const categories = ["nature", "architecture", "travel", "animals", "food", "objects", "textures", "backgrounds"];
    const category = categories[seed % categories.length];
    const apiKey = process.env.PIXABAY_API_KEY;
    const url = `https://pixabay.com/api/?key=${apiKey}&q=${encodeURIComponent(category)}&image_type=photo&orientation=horizontal&min_width=1200&per_page=50&safesearch=true`;

    const fallback = `https://picsum.photos/seed/${dateStr}/800/600`;

    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            console.log("Daily Pixabay request timed out, using fallback.");
            resolve({
                imageUri: fallback,
                seed: seed,
                gridSize: 4 + (seed % 2)
            });
        }, 8000);

        https.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                clearTimeout(timeout);
                let imgUrl = fallback;
                if (res.statusCode === 200) {
                    try {
                        const json = JSON.parse(data);
                        if (json.hits && json.hits.length > 0) {
                            const index = seed % json.hits.length;
                            imgUrl = json.hits[index].largeImageURL || json.hits[index].webformatURL || fallback;
                        }
                    } catch (e) {
                        console.error("Error parsing Pixabay response for daily puzzle:", e.message);
                    }
                }

                const dailyData = {
                    imageUri: imgUrl,
                    seed: seed,
                    gridSize: 4 + (seed % 2)
                };
                dailyPuzzleCache.date = dateStr;
                dailyPuzzleCache.data = dailyData;
                resolve(dailyData);
            });
        }).on("error", (err) => {
            clearTimeout(timeout);
            console.error("Request error from Pixabay for daily puzzle:", err.message);
            resolve({
                imageUri: fallback,
                seed: seed,
                gridSize: 4 + (seed % 2)
            });
        });
    });
}

async function getGroqChatReply(userMessage, language = 'en') {
    let systemPrompt = "You are a competitive and friendly gamer in the Global Chat of 'Puzzle Clash'. Use informal language, gamer slang, and occasionally emojis. Keep responses short and punchy.";

    if (language === 'fr') {
        systemPrompt += " Reply in French.";
    } else if (language === 'ar') {
        systemPrompt += " Reply in Arabic using friendly local idioms like 'Ya Hala'.";
    } else {
        systemPrompt += " Reply in English.";
    }

    try {
        const completion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userMessage }
            ],
            model: "llama-3.1-8b-instant",
        });
        return completion.choices[0]?.message?.content || "";
    } catch (e) {
        console.error("Groq API error:", e);
        return "";
    }
}

async function triggerBotToBotConversation() {
    const languages = ['en', 'fr', 'ar'];
    const lang = languages[Math.floor(Math.random() * languages.length)];
    const possibleBots = botNames[lang];

    const bot1Name = possibleBots[Math.floor(Math.random() * possibleBots.length)];
    let bot2Name = possibleBots[Math.floor(Math.random() * possibleBots.length)];
    while (bot1Name === bot2Name) {
        bot2Name = possibleBots[Math.floor(Math.random() * possibleBots.length)];
    }

    const topics = [
        "their latest puzzle match",
        "reaching the top of the leaderboard",
        "a tricky 5x5 grid they just solved",
        "the new update of Puzzle Clash",
        "challenging each other to a rematch",
        "how fast they solved the last daily puzzle"
    ];
    const topic = topics[Math.floor(Math.random() * topics.length)];

    console.log(`Bot conversation triggered: ${bot1Name} & ${bot2Name} about ${topic} in ${lang}`);

    const firstMessage = await getGroqChatReply(`Start a short conversation with ${bot2Name} about ${topic}.`, lang);
    if (firstMessage) {
        io.emit('global_chat_message', {
            senderId: `bot_${bot1Name}`,
            senderName: `${bot1Name} (Bot)`,
            message: firstMessage,
            avatarUrl: `https://api.dicebear.com/9.x/avataaars/svg?seed=${bot1Name}`,
            timestamp: Date.now()
        });

        setTimeout(async () => {
            const secondMessage = await getGroqChatReply(`${bot1Name} said: "${firstMessage}". Reply to them as ${bot2Name} continuing the conversation about ${topic}. Keep it very short.`, lang);
            if (secondMessage) {
                io.emit('global_chat_message', {
                    senderId: `bot_${bot2Name}`,
                    senderName: `${bot2Name} (Bot)`,
                    message: secondMessage,
                    avatarUrl: `https://api.dicebear.com/9.x/avataaars/svg?seed=${bot2Name}`,
                    timestamp: Date.now()
                });
            }
        }, 8000 + Math.random() * 4000);
    }

    // Schedule next conversation (5-10 minutes)
    const nextInterval = (5 + Math.random() * 5) * 60 * 1000;
    setTimeout(triggerBotToBotConversation, nextInterval);
}

async function startMatch(player1, player2, gridSize, isCoop, category) {
    const queueKey = `${gridSize}_${isCoop}_${category || 'Random'}`;
    const roomId = `room_${Date.now()}_${player1.id}_${player2.id}`;

    if (!player1.isBot) player1.join(roomId);
    if (!player2.isBot) player2.join(roomId);

    console.log(`Fetching image for room ${roomId} (Category: ${category})...`);
    const imageUri = await fetchRandomPixabayImage(category);

    // Check again if real players are still connected
    if ((!player1.isBot && !player1.connected) || (!player2.isBot && !player2.connected)) {
        console.log(`Players disconnected during image fetch for room ${roomId}.`);
        if (!player1.isBot && player1.connected) {
            player1.leave(roomId);
            queues[queueKey].unshift(player1);
        }
        if (!player2.isBot && player2.connected) {
            player2.leave(roomId);
            queues[queueKey].unshift(player2);
        }
        return;
    }

    const gameData = {
        roomId: roomId,
        imageUri: imageUri,
        seed: Math.floor(Math.random() * 1000000),
        gridSize: gridSize,
        isCoop: isCoop,
        players: [
            { id: player1.id, displayName: player1.userData.displayName },
            { id: player2.id, displayName: player2.userData.displayName }
        ]
    };

    const roomObj = {
        players: [player1, player2],
        isCoop: isCoop,
        gridSize: gridSize,
        category: category,
        roomId: roomId,
        startTime: Date.now(),
        rematchRequests: new Set()
    };
    rooms.set(roomId, roomObj);

    io.to(roomId).emit('start_game', gameData);
    console.log(`Game started in room: ${roomId} (Mode: ${isCoop ? 'Co-op' : 'VS'})`);

    // Handle bot behavior
    [player1, player2].forEach(p => {
        if (p.isBot) {
            startBotBehavior(p, roomObj);
        }
    });
}

function startBotBehavior(bot, room) {
    const { roomId, gridSize } = room;
    const profile = bot.userData.profile || BOT_PROFILES["Casual Dad"];
    const language = bot.userData.language;
    const totalPieces = gridSize * gridSize;
    let solvedPieces = 0;

    // Clear existing intervals if any
    if (bot.intervals) {
        bot.intervals.forEach(clearInterval);
    }

    // Periodic Chat
    const chatInterval = setInterval(() => {
        if (!rooms.has(roomId)) {
            clearInterval(chatInterval);
            return;
        }
        const phrases = profile.phrases[language] || botPhrases[language];
        const message = phrases[Math.floor(Math.random() * phrases.length)];
        io.to(roomId).emit('chat_message', {
            senderId: bot.id,
            senderName: bot.userData.displayName,
            message: message,
            timestamp: Date.now()
        });
    }, 15000 + Math.random() * 10000);

    // Periodic Solving
    const botInterval = (4000 + Math.random() * 4000) * profile.speedMult;
    const solveInterval = setInterval(() => {
        if (!rooms.has(roomId)) {
            clearInterval(solveInterval);
            return;
        }
        solvedPieces++;
        const progress = solvedPieces / totalPieces;

        io.to(roomId).emit('opponent_move', {
            playerId: bot.id,
            progress: progress
        });

        if (room.isCoop) {
            io.to(roomId).emit('partner_piece_moved', {
                playerId: bot.id,
                pieceId: solvedPieces - 1,
                row: Math.floor((solvedPieces - 1) / gridSize),
                col: (solvedPieces - 1) % gridSize
            });
        }

        if (solvedPieces >= totalPieces) {
            clearInterval(solveInterval);
            io.to(roomId).emit('game_over', {
                winnerId: bot.id,
                winnerName: bot.userData.displayName
            });
            handleGameEnd(roomId, bot.id);
        }
    }, botInterval);

    bot.intervals = [chatInterval, solveInterval];
}

function handleGameEnd(roomId, winnerId) {
    const room = rooms.get(roomId);
    if (!room) return;

    const result = {
        winnerId: winnerId,
        xpGained: {},
        isDraw: false
    };

    room.players.forEach(p => {
        if (!p.isBot) {
            if (p.id === winnerId) {
                result.xpGained[p.id] = 50;
            } else {
                result.xpGained[p.id] = 10;
            }
        }
    });

    io.to(roomId).emit('game_result', result);
}

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('register_uid', (data) => {
        const { uid } = data;
        if (uid) {
            userIdToSocketId.set(uid, socket.id);
            socket.uid = uid;
            console.log(`User ${uid} registered with socket ${socket.id}`);
        }
    });

    socket.on('get_daily_puzzle', async () => {
        const today = new Date().toISOString().split('T')[0];
        console.log(`User ${socket.id} requested daily puzzle for ${today}`);
        const dailyData = await fetchDailyPuzzle(today);
        socket.emit('daily_puzzle_data', dailyData);
    });

    socket.on('search_match', async (data) => {
        try {
            if (!data) {
                console.error("search_match: No data provided");
                return;
            }
            const { displayName, gridSize, isCoop, category, uid } = data;
            console.log(`User ${displayName || socket.id} (UID: ${uid}) searching: gridSize=${gridSize}, isCoop=${isCoop}, category=${category}`);

            if (uid) {
                userIdToSocketId.set(uid, socket.id);
                socket.uid = uid;
            }

            socket.userData = { displayName: displayName || "Guest", gridSize, isCoop, category: category || "Random", isBot: false };
            const queueKey = `${gridSize}_${isCoop}_${category || 'Random'}`;

            for (let key in queues) {
                queues[key] = queues[key].filter(p => p.id !== socket.id);
            }
            if (!queues[queueKey]) {
                queues[queueKey] = [];
            }
            queues[queueKey].push(socket);
            queueEntryTimes.set(socket.id, Date.now());

            if (queues[queueKey].length >= 2) {
                const player1 = queues[queueKey].shift();
                const player2 = queues[queueKey].shift();
                queueEntryTimes.delete(player1.id);
                queueEntryTimes.delete(player2.id);

                await startMatch(player1, player2, gridSize, isCoop, category);
            }
        } catch (err) {
            console.error("Error in search_match handler:", err);
        }
    });

    socket.on('leave_queue', () => {
        console.log(`User ${socket.id} requested to leave queue.`);
        for (let key in queues) {
            queues[key] = queues[key].filter(p => p.id !== socket.id);
        }
        queueEntryTimes.delete(socket.id);
    });

    socket.on('move', (data) => {
        const { roomId, progress } = data;
        socket.to(roomId).emit('opponent_move', {
            playerId: socket.id,
            progress: progress
        });
    });

    socket.on('piece_moved', (data) => {
        const { roomId, pieceId, fromRow, fromCol, toRow, toCol } = data;
        socket.to(roomId).emit('partner_piece_moved', {
            playerId: socket.id,
            pieceId: pieceId,
            fromRow: fromRow,
            fromCol: fromCol,
            toRow: toRow,
            toCol: toCol
        });
    });

    socket.on('chat_message', (data) => {
        const { roomId, message } = data;
        if (!socket.userData) return;
        const chatData = {
            senderId: socket.id,
            senderName: socket.userData.displayName,
            message: message,
            timestamp: Date.now()
        };
        io.to(roomId).emit('chat_message', chatData);
    });

    socket.on('send_emote', (data) => {
        const { roomId, emoteId } = data;
        const emoteData = {
            senderId: socket.id,
            emoteId: emoteId,
            timestamp: Date.now()
        };
        io.to(roomId).emit('emote_received', emoteData);
    });

    socket.on('global_message', async (data) => {
        const { message, displayName, language } = data;
        const senderName = (socket.userData && socket.userData.displayName) || displayName || "Guest";
        io.emit('global_chat_message', {
            senderId: socket.id,
            senderName: senderName,
            message: message,
            timestamp: Date.now()
        });

        // Groq reply logic
        const allBotNames = [].concat(...Object.values(botNames));
        const mentioned = allBotNames.some(name => message.toLowerCase().includes(name.toLowerCase()));
        const chance = Math.random() < 0.15; // 15% chance for occasional reply

        if (mentioned || chance) {
            const replyLang = language || (socket.userData && socket.userData.language) || 'en';
            const botReply = await getGroqChatReply(message, replyLang);
            if (botReply) {
                const botName = mentioned ? allBotNames.find(name => message.toLowerCase().includes(name.toLowerCase())) : "PuzzleMaster";
                io.emit('global_chat_message', {
                    senderId: 'groq_bot',
                    senderName: `${botName} (AI)`,
                    message: botReply,
                    avatarUrl: `https://api.dicebear.com/9.x/avataaars/svg?seed=${botName}`,
                    timestamp: Date.now()
                });
            }
        }
    });

    socket.on('challenge_user', (data) => {
        if (!data || !data.toUserId) return;
        const { toUserId, gridSize, isCoop, uid } = data;

        if (uid) {
            userIdToSocketId.set(uid, socket.id);
            socket.uid = uid;
        }

        const senderName = (socket.userData && socket.userData.displayName) || "Guest";
        const senderId = socket.uid || socket.id;

        console.log(`Challenge: ${senderName} (${senderId}) challenges ${toUserId} (Grid: ${gridSize}, Coop: ${isCoop})`);

        if (toUserId.startsWith('bot_') || toUserId === 'groq_bot') {
            const delay = 5000;
            console.log(`Bot ${toUserId} auto-accepting in ${delay}ms... (Grid: ${gridSize})`);
            setTimeout(async () => {
                const languages = ['en', 'fr', 'ar'];
                const lang = languages[Math.floor(Math.random() * languages.length)];
                const botDisplayName = toUserId === 'groq_bot' ? "PuzzleMaster" : botNames[lang][Math.floor(Math.random() * botNames[lang].length)];

                const profileKeys = Object.keys(BOT_PROFILES);
                const randomProfileKey = profileKeys[Math.floor(Math.random() * profileKeys.length)];
                const profile = BOT_PROFILES[randomProfileKey];

                const bot = {
                    id: toUserId,
                    userData: {
                        displayName: toUserId === 'groq_bot' ? `${botDisplayName} (AI)` : `${botDisplayName} (Bot)`,
                        isBot: true,
                        language: lang,
                        profile: profile,
                        profileName: randomProfileKey
                    },
                    isBot: true,
                    connected: true,
                    join: (roomId) => {},
                    leave: (roomId) => {},
                    emit: (event, data) => {},
                    to: (roomId) => ({ emit: (event, data) => {} })
                };

                const challengeGridSize = parseInt(gridSize) || 3;

                // Ensure challenger has basic userData if missing
                if (!socket.userData) {
                    socket.userData = { displayName: senderName, gridSize: challengeGridSize, isCoop: isCoop || false };
                }

                const response = {
                    challengeId: socket.id,
                    accepted: true,
                    fromUserId: toUserId
                };
                socket.emit('challenge_response', response);

                await startMatch(socket, bot, challengeGridSize, isCoop || false, data.category || "Random");
            }, delay);
            return;
        }

        const targetSocketId = userIdToSocketId.get(toUserId) || toUserId;
        const targetSocket = io.sockets.sockets.get(targetSocketId);

        if (targetSocket) {
            targetSocket.emit('challenge_received', {
                challengeId: socket.id,
                fromUserId: senderId,
                fromUserName: senderName,
                gridSize: gridSize || 3,
                isCoop: isCoop || false,
                category: data.category || "Random"
            });
        } else {
            console.log(`Challenge target ${toUserId} (Socket: ${targetSocketId}) not found.`);
        }
    });

    socket.on('accept_challenge', async (data) => {
        const { inviterId, gridSize, isCoop, category } = data;
        const finalGridSize = gridSize || 3;
        const finalIsCoop = isCoop || false;
        const finalCategory = category || "Random";

        const targetSocketId = userIdToSocketId.get(inviterId) || inviterId;
        const inviterSocket = io.sockets.sockets.get(targetSocketId);

        console.log(`Routing response to inviter: ${targetSocketId}`);

        if (inviterSocket) {
            if (!socket.userData) socket.userData = { displayName: "Guest", gridSize: finalGridSize, isCoop: finalIsCoop, category: finalCategory };
            if (!inviterSocket.userData) inviterSocket.userData = { displayName: "Guest", gridSize: finalGridSize, isCoop: finalIsCoop, category: finalCategory };

            const response = {
                challengeId: inviterId,
                accepted: true,
                fromUserId: socket.uid || socket.id
            };
            inviterSocket.emit('challenge_response', response);
            socket.emit('challenge_response', response);

            await startMatch(socket, inviterSocket, finalGridSize, finalIsCoop, finalCategory);
        }
    });

    socket.on('decline_challenge', (data) => {
        const { inviterId } = data;
        const targetSocketId = userIdToSocketId.get(inviterId) || inviterId;
        console.log(`Routing response to inviter: ${targetSocketId}`);

        io.to(targetSocketId).emit('challenge_response', {
             challengeId: inviterId,
             accepted: false,
             fromUserId: socket.uid || socket.id
        });
    });

    socket.on('rematch_request', (data) => {
        const { roomId } = data;
        const room = rooms.get(roomId);
        if (!room) return;

        room.rematchRequests.add(socket.id);

        const hasBot = room.players.some(p => p.isBot);
        if (hasBot) {
             // Bot "accepts" rematch immediately
             const bot = room.players.find(p => p.isBot);
             io.to(roomId).emit('rematch_request', { senderId: bot.id });

             setTimeout(() => {
                 if (rooms.has(roomId)) {
                     startMatch(room.players[0], room.players[1], room.gridSize, room.isCoop, room.category);
                 }
             }, 1000);
             return;
        }

        if (room.rematchRequests.size === room.players.length) {
            startMatch(room.players[0], room.players[1], room.gridSize, room.isCoop, room.category);
        }
    });

    socket.on('game_won', (data) => {
        const { roomId } = data;
        if (!socket.userData) return;

        io.to(roomId).emit('game_over', {
            winnerId: socket.id,
            winnerName: socket.userData.displayName
        });

        handleGameEnd(roomId, socket.id);
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);

        if (socket.uid && userIdToSocketId.get(socket.uid) === socket.id) {
            userIdToSocketId.delete(socket.uid);
        }

        for (let key in queues) {
            queues[key] = queues[key].filter(p => p.id !== socket.id);
        }
        queueEntryTimes.delete(socket.id);

        rooms.forEach((room, roomId) => {
            if (room.players.some(p => p.id === socket.id)) {
                const opponent = room.players.find(p => p.id !== socket.id);
                if (opponent) {
                    if (!opponent.isBot) {
                        opponent.emit('opponent_left', {
                            message: "Your opponent disconnected. You win by default!",
                            winnerId: opponent.id
                        });
                        handleGameEnd(roomId, opponent.id);
                    }
                    if (opponent.isBot && opponent.intervals) {
                        opponent.intervals.forEach(clearInterval);
                    }
                }
                console.log(`Leaver Penalty: User ${socket.id} left match ${roomId}`);
                // Emit penalty info to clients if they track it
                socket.broadcast.emit('leaver_penalty', { userId: socket.id, roomId: roomId });

                rooms.delete(roomId);
            }
        });
    });
});

async function createBotMatch(player, gridSize, isCoop, category) {
    console.log(`Player ${player.userData.displayName} waited 40s. Creating bot for category ${category}.`);
    const languages = ['en', 'fr', 'ar'];
    const lang = languages[Math.floor(Math.random() * languages.length)];

    const profileKeys = Object.keys(BOT_PROFILES);
    const randomProfileKey = profileKeys[Math.floor(Math.random() * profileKeys.length)];
    const profile = BOT_PROFILES[randomProfileKey];

    const bot = {
        id: `bot_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        userData: {
            displayName: `${botNames[lang][Math.floor(Math.random() * botNames[lang].length)]} (Bot)`,
            isBot: true,
            language: lang,
            profile: profile,
            profileName: randomProfileKey
        },
        isBot: true,
        connected: true,
        join: (roomId) => {},
        leave: (roomId) => {},
        emit: (event, data) => {},
        to: (roomId) => ({ emit: (event, data) => {} })
    };

    await startMatch(player, bot, gridSize, isCoop, category);
}

// Bot Queue Watcher
setInterval(async () => {
    const now = Date.now();
    for (let key in queues) {
        const queue = queues[key];
        if (queue.length > 0) {
            const player = queue[0];
            const entryTime = queueEntryTimes.get(player.id);
            if (entryTime && (now - entryTime) >= 40000) {
                queues[key].shift();
                queueEntryTimes.delete(player.id);

                const [gridSize, isCoopStr, category] = key.split('_');
                await createBotMatch(player, parseInt(gridSize), isCoopStr === 'true', category);
            }
        }
    }
}, 5000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    // Start bot-to-bot conversations loop
    setTimeout(triggerBotToBotConversation, 60000); // Wait 1 minute before starting the first one
});
