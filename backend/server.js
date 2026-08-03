const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
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

    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            console.log("Pixabay request timed out, using fallback.");
            request.abort();
            resolve("https://picsum.photos/600/600");
        }, 5000);

        const request = https.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                clearTimeout(timeout);
                try {
                    const json = JSON.parse(data);
                    if (json.hits && json.hits.length > 0) {
                        const randomIndex = Math.floor(Math.random() * json.hits.length);
                        resolve(json.hits[randomIndex].largeImageURL);
                    } else {
                        resolve("https://picsum.photos/600/600");
                    }
                } catch (e) {
                    resolve("https://picsum.photos/600/600");
                }
            });
        });

        request.on("error", (err) => {
            clearTimeout(timeout);
            resolve("https://picsum.photos/600/600");
        });
    });
}

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('join_queue', async (data) => {
        const { displayName, gridSize, isCoop } = data;
        console.log(`User ${displayName} joined queue: gridSize=${gridSize}, isCoop=${isCoop}`);

        socket.userData = { displayName, gridSize, isCoop };
        const queueKey = `${gridSize}_${isCoop}`;

        if (!queues[queueKey]) {
            queues[queueKey] = [];
        }

        queues[queueKey].push(socket);

        if (queues[queueKey].length >= 2) {
            const player1 = queues[queueKey].shift();
            const player2 = queues[queueKey].shift();

            const roomId = `room_${Date.now()}_${player1.id}_${player2.id}`;
            player1.join(roomId);
            player2.join(roomId);

            const imageUri = await fetchRandomPixabayImage();
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
        // Handle disconnection in active rooms if needed
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
