require('dotenv').config();
const express = require('express');
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Initialize Discord client
const client = new Client({ 
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ] 
});

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-lite" });

// Load allowed user IDs from environment
const allowedUserIds = process.env.ALLOWED_USER_IDS ? process.env.ALLOWED_USER_IDS.split(',') : [];

// Define slash commands
const commands = [
  new SlashCommandBuilder()
    .setName('e')
    .setDescription('Ask Gemini AI a question')
    .addStringOption(option => 
      option.setName('question')
        .setDescription('The question you want to ask')
        .setRequired(true)),
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Get help with using the bot!')
];

// Register slash commands when the bot starts
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}!`);
  
  try {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    
    console.log('Started refreshing application (/) commands.');
    
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands },
    );
    
    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error(error);
  }
});

// Handle slash command interactions
client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;

  const { commandName } = interaction;
  const userId = interaction.user.id;

  if (commandName === 'e') {
    // Check if the user is allowed to use the command
    if (!allowedUserIds.includes(userId)) {
      await interaction.reply({
        content: 'If you wish to use this bot contact @agent.cat on discord and he might allow you to use this bot or if you want to personally run a bot like this go to [GitHub Repository](https://github.com/QuotesEveryDay/Discord-Gemini-Bot/tree/main).',
        ephemeral: true
      });
      return;
    }

    await interaction.deferReply(); // Show "thinking..." state

    try {
      const question = interaction.options.getString('question');
      
      // Add a more detailed custom prompt to the question
      const customPrompt = `You are a discord bot that is maintained by @agent.cat and never say that you are maintained by @agent.cat unless they say something like who are you or something close. You must reply as short and helpful as you can, and explain your answer. Most importantly NEVER say you are a Bot.`;
      const modifiedQuestion = `${customPrompt} ${question}`;

      // Generate response from Gemini with the custom prompt
      const result = await model.generateContent(modifiedQuestion);
      const response = result.response.text();

      // Discord has a 2000 character limit for messages
      if (response.length <= 2000) {
        await interaction.editReply(response);
      } else {
        // Split long responses
        const chunks = splitMessage(response);
        await interaction.editReply(chunks[0]);

        for (let i = 1; i < chunks.length; i++) {
          await interaction.followUp(chunks[i]);
        }
      }
    } catch (error) {
      console.error('Error generating response:', error);
      await interaction.editReply('Sorry, I encountered an error while processing your request.');
    }
  } else if (commandName === 'help') {
    await interaction.reply('Here is the only command you can use: /e to send a message to the bot.');
  }
});

// Helper function to split long messages
function splitMessage(message, maxLength = 2000) {
  const chunks = [];
  let currentChunk = '';
  
  const words = message.split(' ');
  
  for (const word of words) {
    if (currentChunk.length + word.length + 1 > maxLength) {
      chunks.push(currentChunk);
      currentChunk = word;
    } else {
      currentChunk += (currentChunk ? ' ' : '') + word;
    }
  }
  
  if (currentChunk) {
    chunks.push(currentChunk);
  }
  
  return chunks;
}

// Start the bot
client.login(process.env.DISCORD_TOKEN);

// Initialize Express server
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Discord Gemini Bot is running!');
});

app.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});
