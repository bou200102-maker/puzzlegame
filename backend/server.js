const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Queues indexed by gridSize and isCoop
// Example: queues["3_false"] = [...]
let queues = {};

let rooms = new Map();

async function fetchRandomPixabayImage() {
    const categories = ['nature', 'city', 'technology', 'animals', 'food'];
    const category = categories[Math.floor(Math.random() * categories.length)];
    const apiKey = '56917000-88229ea2b5f912f6f52a9039f';
    const url = `https://pixabay.com/api/?key=${apiKey}&q=${category}&image_type=photo&orientation=horizontal`;

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

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('search_match', async (data) => {
        try {
            if (!data) {
                console.error("search_match: No data provided");
                return;
            }
            const { displayName, gridSize, isCoop } = data;
            console.log(`User ${displayName || socket.id} searching: gridSize=${gridSize}, isCoop=${isCoop}`);

            socket.userData = { displayName: displayName || "Guest", gridSize, isCoop };
            const queueKey = `${gridSize}_${isCoop}`;

            // Remove from all queues first to prevent being in multiple queues
            for (let key in queues) {
                queues[key] = queues[key].filter(p => p.id !== socket.id);
            }
            if (!queues[queueKey]) {
                queues[queueKey] = [];
            }
            queues[queueKey].push(socket);

            if (queues[queueKey].length >= 2) {
                const player1 = queues[queueKey].shift();
                const player2 = queues[queueKey].shift();

                // If one of the players disconnected while in queue (race condition)
                if (!player1.connected || !player2.connected) {
                    console.log("One or more players disconnected during queue processing. Aborting match.");
                    if (player1.connected) queues[queueKey].unshift(player1);
                    if (player2.connected) queues[queueKey].unshift(player2);
                    return;
                }

                const roomId = `room_${Date.now()}_${player1.id}_${player2.id}`;
                player1.join(roomId);
                player2.join(roomId);

                console.log(`Fetching image for room ${roomId}...`);
                const imageUri = await fetchRandomPixabayImage();

                // Check again if they are still connected after the async fetch
                if (!player1.connected || !player2.connected) {
                    console.log(`Players disconnected during image fetch for room ${roomId}.`);
                    if (player1.connected) {
                        player1.leave(roomId);
                        queues[queueKey].unshift(player1);
                    }
                    if (player2.connected) {
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

                rooms.set(roomId, {
                    players: [player1, player2],
                    isCoop: isCoop,
                    gridSize: gridSize
                });

                io.to(roomId).emit('start_game', gameData);
                console.log(`Game started in room: ${roomId} (Mode: ${isCoop ? 'Co-op' : 'VS'})`);
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
    });

    socket.on('move', (data) => {
        const { roomId, progress } = data;
        socket.to(roomId).emit('opponent_move', {
            playerId: socket.id,
            progress: progress
        });
    });

    socket.on('piece_moved', (data) => {
        const { roomId, pieceId, row, col } = data;
        // Broadcast the piece move to the partner in Co-op mode
        socket.to(roomId).emit('partner_piece_moved', {
            playerId: socket.id,
            pieceId: pieceId,
            row: row,
            col: col
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

    socket.on('game_won', (data) => {
        const { roomId } = data;
        if (!socket.userData) return;
        io.to(roomId).emit('game_over', {
            winnerId: socket.id,
            winnerName: socket.userData.displayName
        });

        // Cleanup room
        const room = rooms.get(roomId);
        if (room) {
            room.players.forEach(p => p.leave(roomId));
            rooms.delete(roomId);
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        for (let key in queues) {
            queues[key] = queues[key].filter(p => p.id !== socket.id);
        }
        // Active room cleanup logic could be added here if needed
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
