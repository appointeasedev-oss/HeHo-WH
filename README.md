# HeHo-WH WhatsApp Bridge

HeHo-WH is a bridge application that connects your WhatsApp account to a HeHo chatbot. It allows you to interact with your AI chatbot directly through WhatsApp.

## Features

- **WhatsApp Web Integration**: Uses `whatsapp-web.js` to connect to your WhatsApp account.
- **QR Code Authentication**: Displays a QR code on a web interface for easy linking.
- **HeHo Chatbot Integration**: Forwards WhatsApp messages to the HeHo API and replies with AI-generated responses.
- **Railway Ready**: Optimized for deployment on Railway with Docker.

## Deployment on Railway

1.  **Fork/Clone this repository** to your GitHub account.
2.  **Create a new project on Railway** and connect it to your repository.
3.  **Configure Environment Variables** in Railway:
    - `HEHO_API_KEY`: Your HeHo API key.
    - `CHATBOT_ID`: The unique ID of your HeHo chatbot.
    - `PORT`: 3000 (Railway usually sets this automatically).
4.  **Wait for deployment**. Once deployed, open the provided Railway URL.
5.  **Scan the QR code** with your WhatsApp app (Settings > Linked Devices > Link a Device).

## Environment Variables

| Variable | Description |
| :--- | :--- |
| `HEHO_API_KEY` | Your HeHo API authorization token (Bearer token). |
| `CHATBOT_ID` | The ID of the chatbot you want to connect to. |
| `PORT` | The port the server will listen on (default: 3000). |

## Local Development

1.  Clone the repository.
2.  Install dependencies: `npm install`.
3.  Create a `.env` file with your `HEHO_API_KEY` and `CHATBOT_ID`.
4.  Run the app: `npm start`.
5.  Open `http://localhost:3000` in your browser.

## Important Notes

- This application uses Puppeteer to run a headless browser for WhatsApp Web.
- On Railway, ensure you use the provided `Dockerfile` which includes the necessary Chromium dependencies.
- To maintain the session across restarts, Railway's persistent volume might be needed for the `.wwebjs_auth` folder, or you will need to re-scan the QR code if the container is redeployed.
