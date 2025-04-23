# Discord Gemini Bot

## Overview

The Discord Gemini Bot is a powerful AI-driven bot that leverages the capabilities of the Gemini 2.0 Flash Lite model, developed by Google. This bot is designed to assist users with a wide range of inquiries, providing precise and insightful responses. It is operated by the Discord user @agent.cat and aims to be the most helpful AI companion.

## Features

- **AI-Powered Responses**: Utilizes the Gemini 2.0 Flash Lite model for generating responses.
- **Slash Commands**: Supports slash commands for easy interaction.
- **Conversation History**: Maintains a history of interactions for context-aware responses.
- **Web Interface**: Includes a simple web interface for monitoring the bot's status.

## Setup

### Prerequisites

- Node.js and npm installed on your machine.
- A Discord account and a bot token from the [Discord Developer Portal](https://discord.com/developers/applications).
- A Gemini API key from [Google AI Studio](https://aistudio.google.com/u/4/apikey).

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/QuotesEveryDay/Discord-Gemini-Bot.git
   cd Discord-Gemini-Bot
   ```

2. Install the dependencies:
    ```bash
    npm i
    ```

3. Create a .env file based on the .env.example file and fill in your credentials:
    ```.env
    # Discord Bot Token - https://discord.com/developers/applications
    DISCORD_TOKEN=Discord_Token

    # Gemini API Key - https://aistudio.google.com/u/4/apikey
    GEMINI_API_KEY=Gemini_Api
    ```

## Run the bot
```bash
node index.js
```
