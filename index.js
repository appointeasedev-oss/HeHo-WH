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
let HEHO_API_KEY = process.env.HEHO_API_KEY;
let CHATBOT_ID = process.env.CHATBOT_ID;
const HEHO_API = (process.env.HEHO_API || 'https://heho.vercel.app/api').replace(/\/+$/, '');
const SERVER_URL = process.env.SERVER_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : null);

app.use(express.json());
app.use(express.static('public'));

let qrCodeData = null;
let clientStatus = 'DISCONNECTED';

function getHeHoHeaders() {
    return {
        'Authorization': `Bearer ${HEHO_API_KEY}`,
        'Content-Type': 'application/json'
    };
}

async function notifyHeHo(endpoint, body, logContext) {
    if (!HEHO_API_KEY || !CHATBOT_ID) {
        sendLog(`Skipping ${logContext}: missing HEHO_API_KEY or CHATBOT_ID`, 'warning');
        return;
    }

    try {
        await axios.post(`${HEHO_API}${endpoint}`, body, {
            headers: getHeHoHeaders(),
            timeout: 30000
        });
        sendLog(`${logContext} sent to HeHo.`);
    } catch (error) {
        const errorMsg = error.response ? JSON.stringify(error.response.data) : error.message;
        sendLog(`Failed to send ${logContext}: ${errorMsg}`, 'error');
    }
}

// Helper to send logs to the web UI
function sendLog(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = { timestamp, message, type };
    console.log(`[${type.toUpperCase()}] ${message}`);
    io.emit('log', logEntry);
}

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
            '--single-process',
            '--disable-gpu'
        ],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser'
    },
    webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
    }
});

client.on('qr', (qr) => {
    sendLog('QR Code received, please scan.');
    qrcode.toDataURL(qr, (err, url) => {
        if (err) {
            sendLog('Error generating QR code: ' + err.message, 'error');
            return;
        }
        qrCodeData = url;
        clientStatus = 'QR_READY';
        io.emit('qr', url);
    });
    notifyHeHo('/whatsapp/qr', { chatbot_id: CHATBOT_ID, qr }, 'QR update');
});

client.on('ready', () => {
    sendLog('WhatsApp Client is ready and connected!');
    clientStatus = 'READY';
    qrCodeData = null;
    io.emit('ready');
    notifyHeHo('/whatsapp/connected', { chatbot_id: CHATBOT_ID, status: 'connected' }, 'connected status');
});

client.on('authenticated', () => {
    sendLog('WhatsApp Authenticated successfully.');
    clientStatus = 'AUTHENTICATED';
    io.emit('authenticated');
});

client.on('auth_failure', msg => {
    sendLog('WhatsApp Authentication Failure: ' + msg, 'error');
    clientStatus = 'AUTH_FAILURE';
    io.emit('auth_failure', msg);
});

client.on('disconnected', (reason) => {
    sendLog('WhatsApp Client was logged out: ' + reason, 'warning');
    clientStatus = 'DISCONNECTED';
    io.emit('disconnected');
    setTimeout(() => {
        sendLog('Attempting to re-initialize WhatsApp client...');
        client.initialize().catch(err => sendLog('Failed to re-initialize: ' + err.message, 'error'));
    }, 5000);
});

async function callHeHoAPI(userMessage) {
    if (!HEHO_API_KEY || !CHATBOT_ID) {
        throw new Error('HeHo API Key or Chatbot ID is missing.');
    }

    sendLog(`Calling HeHo API for message: "${userMessage}"`);
    const response = await axios.post(`${HEHO_API}/aichat`, {
        chatbotId: CHATBOT_ID,
        messages: [{ role: 'user', content: userMessage }],
        history: []
    }, {
        headers: getHeHoHeaders(),
        timeout: 30000
    });

    let reply = '';
    if (response.data) {
        if (response.data.reply) {
            reply = response.data.reply;
        } else if (response.data.content) {
            reply = response.data.content;
        } else if (response.data.choices && response.data.choices[0].message) {
            reply = response.data.choices[0].message.content;
        }
    }

    if (!reply) {
        sendLog('Unexpected HeHo API response format: ' + JSON.stringify(response.data), 'error');
        throw new Error('Empty response from HeHo API');
    }

    sendLog(`HeHo API replied: "${reply.substring(0, 50)}..."`);
    return reply;
}

client.on('message', async (msg) => {
    if (msg.from.endsWith('@g.us') || msg.from === 'status@broadcast') return;

    sendLog(`Received WhatsApp message from ${msg.from}: "${msg.body}"`);

    try {
        const reply = await callHeHoAPI(msg.body);
        await client.sendMessage(msg.from, reply);
        sendLog(`Sent reply to ${msg.from}`);
    } catch (error) {
        const errorMsg = error.response ? JSON.stringify(error.response.data) : error.message;
        sendLog('Error processing message: ' + errorMsg, 'error');
    }
});

// API Routes for UI
app.get('/config', (req, res) => {
    res.json({ HEHO_API_KEY, CHATBOT_ID, HEHO_API, SERVER_URL });
});

app.post('/config', (req, res) => {
    const { apiKey, chatbotId } = req.body;
    if (apiKey) HEHO_API_KEY = apiKey;
    if (chatbotId) CHATBOT_ID = chatbotId;
    sendLog('Configuration updated via Web UI');
    res.json({ success: true, HEHO_API_KEY, CHATBOT_ID });
});

app.post('/test-chat', async (req, res) => {
    const { message } = req.body;
    try {
        const reply = await callHeHoAPI(message);
        res.json({ success: true, reply });
    } catch (error) {
        const errorMsg = error.response ? JSON.stringify(error.response.data) : error.message;
        res.status(500).json({ success: false, error: errorMsg });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/status', (req, res) => {
    res.json({ status: clientStatus, qr: qrCodeData });
});

io.on('connection', (socket) => {
    sendLog('Web UI connected');
    if (qrCodeData) socket.emit('qr', qrCodeData);
    socket.emit('status', clientStatus);
    socket.emit('config', { HEHO_API_KEY, CHATBOT_ID, HEHO_API, SERVER_URL });
});

server.listen(PORT, () => {
    sendLog(`Server is running on port ${PORT}`);
    if (SERVER_URL) {
        notifyHeHo('/whatsapp/server-url', { chatbotId: CHATBOT_ID, serverUrl: SERVER_URL }, 'server URL');
    } else {
        sendLog('SERVER_URL and RAILWAY_PUBLIC_DOMAIN are not set; skipping server URL registration.', 'warning');
    }
    notifyHeHo('/whatsapp/deployed', { chatbot_id: CHATBOT_ID }, 'deployment status');
    client.initialize().catch(err => {
        sendLog('Failed to initialize WhatsApp client: ' + err.message, 'error');
    });
});

process.on('SIGINT', async () => {
    sendLog('Shutting down...');
    await client.destroy();
    process.exit(0);
});
