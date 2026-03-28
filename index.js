require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const axios = require('axios');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const HEHO_API_KEY = process.env.HEHO_API_KEY;
const CHATBOT_ID = process.env.CHATBOT_ID;

app.use(express.json());
app.use(express.static('public'));

let qrCodeData = null;
let clientStatus = 'DISCONNECTED';

// Optimized Puppeteer and WhatsApp Client configuration
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process', // Helps in resource-constrained environments
            '--disable-gpu'
        ],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser'
    },
    // Added webVersionCache to prevent version mismatch issues
    webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
    }
});

client.on('qr', (qr) => {
    console.log('QR RECEIVED');
    qrcode.toDataURL(qr, (err, url) => {
        if (err) {
            console.error('Error generating QR code:', err);
            return;
        }
        qrCodeData = url;
        clientStatus = 'QR_READY';
        io.emit('qr', url);
    });
});

client.on('ready', () => {
    console.log('WhatsApp Client is ready!');
    clientStatus = 'READY';
    qrCodeData = null;
    io.emit('ready');
});

client.on('authenticated', () => {
    console.log('WhatsApp Authenticated');
    clientStatus = 'AUTHENTICATED';
    io.emit('authenticated');
});

client.on('auth_failure', msg => {
    console.error('WhatsApp Authentication Failure:', msg);
    clientStatus = 'AUTH_FAILURE';
    io.emit('auth_failure', msg);
});

client.on('disconnected', (reason) => {
    console.log('WhatsApp Client was logged out:', reason);
    clientStatus = 'DISCONNECTED';
    io.emit('disconnected');
    // Re-initialize after a delay to avoid rapid restart loops
    setTimeout(() => {
        client.initialize().catch(err => console.error('Failed to re-initialize:', err));
    }, 5000);
});

client.on('message', async (msg) => {
    // Ignore group messages and status updates
    if (msg.from.endsWith('@g.us') || msg.from === 'status@broadcast') return;

    console.log(`Message from ${msg.from}: ${msg.body}`);

    try {
        const response = await axios.post('https://heho.vercel.app/api/aichat', {
            chatbotId: CHATBOT_ID,
            messages: [{ role: 'user', content: msg.body }]
        }, {
            headers: {
                'Authorization': `Bearer ${HEHO_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 30000 // 30 seconds timeout for HeHo API
        });

        let reply = '';
        if (response.data && response.data.content) {
            reply = response.data.content;
        } else if (response.data && response.data.choices && response.data.choices[0].message) {
            reply = response.data.choices[0].message.content;
        }

        if (reply) {
            await client.sendMessage(msg.from, reply);
        } else {
            console.error('Unexpected HeHo API response format:', response.data);
        }
    } catch (error) {
        console.error('Error calling HeHo API:', error.response ? error.response.data : error.message);
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/status', (req, res) => {
    res.json({ status: clientStatus, qr: qrCodeData });
});

io.on('connection', (socket) => {
    console.log('Web UI connected');
    if (qrCodeData) {
        socket.emit('qr', qrCodeData);
    }
    socket.emit('status', clientStatus);
});

server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    client.initialize().catch(err => {
        console.error('Failed to initialize WhatsApp client:', err);
        process.exit(1); // Exit so Railway can restart the container
    });
});

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('Shutting down...');
    await client.destroy();
    process.exit(0);
});
