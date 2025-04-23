require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');

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

// Store conversation history
const conversationHistory = new Map();

// Store named user histories
const userHistories = new Map();
const historyDir = path.join(__dirname, 'histories');

// Create history directory if it doesn't exist
if (!fs.existsSync(historyDir)) {
  fs.mkdirSync(historyDir, { recursive: true });
}

// Load existing histories
function loadSavedHistories() {
  try {
    const files = fs.readdirSync(historyDir);
    files.forEach(file => {
      if (file.endsWith('.json')) {
        const historyName = file.replace('.json', '');
        const historyData = JSON.parse(fs.readFileSync(path.join(historyDir, file), 'utf8'));
        userHistories.set(historyName, historyData);
      }
    });
    console.log(`Loaded ${userHistories.size} saved histories`);
  } catch (error) {
    console.error('Error loading saved histories:', error);
  }
}

// Save history to file
function saveHistory(name, history) {
  try {
    fs.writeFileSync(
      path.join(historyDir, `${name}.json`), 
      JSON.stringify(history, null, 2)
    );
  } catch (error) {
    console.error(`Error saving history ${name}:`, error);
  }
}

// Load saved histories on startup
loadSavedHistories();

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
    .setDescription('Get help with using the bot!'),
  new SlashCommandBuilder()
    .setName('clearhistory')
    .setDescription('Clear your conversation history'),
  new SlashCommandBuilder()
    .setName('starthistory')
    .setDescription('Start a new named conversation history')
    .addStringOption(option => 
      option.setName('name')
        .setDescription('Name for this conversation history')
        .setRequired(true)),
  new SlashCommandBuilder()
    .setName('loadhistory')
    .setDescription('Load a saved conversation history')
    .addStringOption(option => 
      option.setName('name')
        .setDescription('Name of the history to load')
        .setRequired(true)),
  new SlashCommandBuilder()
    .setName('listhistory')
    .setDescription('List all saved conversation histories')
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

// System prompt that will be sent only once per conversation
const SYSTEM_PROMPT = `You are a discord bot that is maintained by @agent.cat and never say that you are maintained by @agent.cat unless they say something like who are you or something close. You must reply as short and helpful as you can, and explain your answer. Most importantly NEVER say you are a Bot.`;

// Handle slash command interactions
client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;

  const { commandName } = interaction;
  const userId = interaction.user.id;

  try {
    if (commandName === 'e') {
      await interaction.deferReply(); // Show "thinking..." state

      try {
        const question = interaction.options.getString('question');
        
        // Check if user has an active named history
        let activeHistoryName = null;
        let activeHistory = null;
        
        // Look for the most recent message with a historyName for this user
        for (const [_, value] of conversationHistory.entries()) {
          if (value.userId === userId && value.historyName) {
            activeHistoryName = value.historyName;
            activeHistory = userHistories.get(activeHistoryName);
            break;
          }
        }

        let messages = [];
        
        // If there's an active history, use those messages
        if (activeHistory && activeHistory.messages.length > 0) {
          // Use existing history messages
          messages = [...activeHistory.messages];
          
          // Add the new user question without repeating the system prompt
          messages.push({ role: "user", content: question });
        } else {
          // Start a new conversation with the system prompt
          messages = [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: question }
          ];
        }

        // Generate response from Gemini with conversation history
        const result = await model.generateContent({
          contents: messages.map(msg => ({
            role: msg.role,
            parts: [{ text: msg.content }]
          }))
        });
        
        const response = result.response.text();
        
        // Add the assistant's response to messages
        messages.push({ role: "assistant", content: response });

        // If there's an active history, update it
        if (activeHistory) {
          activeHistory.messages = messages;
          userHistories.set(activeHistoryName, activeHistory);
          saveHistory(activeHistoryName, activeHistory);
        }

        // Store the conversation
        const messageId = (await interaction.fetchReply()).id;
        conversationHistory.set(messageId, {
          userId: userId,
          messages: messages,
          originalQuestion: question,
          historyName: activeHistoryName
        });

        // Discord has a 2000 character limit for messages
        if (response.length <= 2000) {
          await interaction.editReply(response);
        } else {
          // Split long responses
          const chunks = splitMessage(response);
          await interaction.editReply(chunks[0]);

          for (let i = 1; i < chunks.length; i++) {
            const followUpMsg = await interaction.followUp(chunks[i]);

            // Add follow-up message to conversation history
            conversationHistory.set(followUpMsg.id, {
              userId: userId,
              messages: messages,
              originalQuestion: question,
              isFollowUp: true,
              parentId: messageId,
              historyName: activeHistoryName
            });
          }
        }
      } catch (error) {
        console.error('Error generating response:', error);
        // Check if the interaction has already been replied to
        if (interaction.replied || interaction.deferred) {
          await interaction.editReply('Sorry, I encountered an error while processing your request.');
        } else {
          await interaction.reply('Sorry, I encountered an error while processing your request.');
        }
      }
    } else if (commandName === 'help') {
      await interaction.reply(
        'Available commands:\n' +
        '- `/e <question>` - Ask Gemini AI a question\n' +
        '- `/clearhistory` - Clear your conversation history\n' +
        '- `/starthistory <name>` - Start a new named conversation history\n' +
        '- `/loadhistory <name>` - Load a saved conversation history\n' +
        '- `/listhistory` - List all saved conversation histories'
      );
    } else if (commandName === 'clearhistory') {
      // Clear user's conversation history
      for (const [key, value] of conversationHistory.entries()) {
        if (value.userId === userId) {
          conversationHistory.delete(key);
        }
      }
      await interaction.reply('Your conversation history has been cleared.');
    } else if (commandName === 'starthistory') {
      const historyName = interaction.options.getString('name');
      
      // Check if name already exists
      if (userHistories.has(historyName)) {
        await interaction.reply(`A history with the name "${historyName}" already exists. Please choose a different name.`);
        return;
      }
      
      // Create new history with system prompt as a user message (not system)
      userHistories.set(historyName, {
        userId: userId,
        createdAt: new Date().toISOString(),
        messages: [
          { role: "user", content: SYSTEM_PROMPT }
        ]
      });
      
      // Save to file
      saveHistory(historyName, userHistories.get(historyName));
      
      await interaction.reply(`Started a new conversation history named "${historyName}".`);
    } else if (commandName === 'loadhistory') {
      const historyName = interaction.options.getString('name');
      
      // Check if history exists
      if (!userHistories.has(historyName)) {
        await interaction.reply(`No history found with the name "${historyName}". Use /listhistory to see available histories.`);
        return;
      }
      
      const history = userHistories.get(historyName);
      
      // Check if user owns this history
      if (history.userId && history.userId !== userId) {
        await interaction.reply(`You don't have permission to load this history.`);
        return;
      }
      
      // Create a new message with this history
      const messageId = (await interaction.reply(`Loaded history "${historyName}". You can now continue this conversation.`)).id;
      
      // Store the loaded history
      conversationHistory.set(messageId, {
        userId: userId,
        messages: history.messages,
        originalQuestion: `Loaded history: ${historyName}`,
        historyName: historyName
      });
      
    } else if (commandName === 'listhistory') {
      // Get histories for this user
      const userHistoryList = Array.from(userHistories.entries())
        .filter(([_, history]) => !history.userId || history.userId === userId)
        .map(([name, history]) => {
          const messageCount = history.messages.length;
          const date = new Date(history.createdAt || Date.now()).toLocaleDateString();
          return `- **${name}** (${messageCount} messages, created ${date})`;
        });
      
      if (userHistoryList.length === 0) {
        await interaction.reply('You have no saved conversation histories.');
      } else {
        await interaction.reply(`Your saved conversation histories:\n${userHistoryList.join('\n')}`);
      }
    }
  } catch (error) {
    console.error('Error handling command:', error);
    try {
      // Check if the interaction has already been replied to
      if (interaction.replied || interaction.deferred) {
        await interaction.editReply('Sorry, I encountered an error while processing your request.');
      } else {
        await interaction.reply('Sorry, I encountered an error while processing your request.');
      }
    } catch (replyError) {
      console.error('Error sending error response:', replyError);
    }
  }
});

// Handle message replies
client.on('messageCreate', async message => {
  // Ignore messages from bots (including itself)
  if (message.author.bot) return;
  
  // Check if the message is a reply to a message
  if (message.reference && message.reference.messageId) {
    try {
      // Get the message being replied to
      const repliedMessage = await message.channel.messages.fetch(message.reference.messageId);
      
      // Check if the replied message is from our bot
      if (repliedMessage.author.id === client.user.id) {
        // Send a notification that the bot is generating a response
        const processingMessage = await message.reply("I'm thinking about your message... Please wait a moment.");
        
        await message.channel.sendTyping();
        
        // Get conversation history for this message
        let history = conversationHistory.get(repliedMessage.id);
        
        // If this is a follow-up message, get the parent conversation
        if (history && history.isFollowUp && history.parentId) {
          history = conversationHistory.get(history.parentId);
        }
        
        // In the message reply handler
        // If no history found, create a new one with system prompt as user message
        if (!history) {
          history = {
            userId: message.author.id,
            messages: [
              { role: "user", content: SYSTEM_PROMPT },
              { role: "assistant", content: repliedMessage.content }
            ]
          };
        }
        
        // Add the new user message to history without repeating the system prompt
        history.messages.push({ role: "user", content: message.content });
        
        try {
          // Generate response from Gemini with conversation history
          const result = await model.generateContent({
            contents: history.messages.map(msg => ({
              role: msg.role,
              parts: [{ text: msg.content }]
            }))
          });
          
          const response = result.response.text();
          
          // Add the assistant's response to history
          history.messages.push({ role: "assistant", content: response });
          
          // If this is from a named history, update it
          if (history.historyName) {
            const namedHistory = userHistories.get(history.historyName);
            if (namedHistory) {
              namedHistory.messages = history.messages;
              saveHistory(history.historyName, namedHistory);
            }
          }
          
          // Delete the processing message
          await processingMessage.delete().catch(err => console.error('Error deleting processing message:', err));
          
          // Send the response
          if (response.length <= 2000) {
            const sentMessage = await message.reply(response);
            
            // Store updated conversation history
            conversationHistory.set(sentMessage.id, {
              userId: message.author.id,
              messages: history.messages,
              originalQuestion: history.originalQuestion || repliedMessage.content,
              historyName: history.historyName
            });
          } else {
            // Split long responses
            const chunks = splitMessage(response);
            const sentMessage = await message.reply(chunks[0]);
            
            // Store updated conversation history
            conversationHistory.set(sentMessage.id, {
              userId: message.author.id,
              messages: history.messages,
              originalQuestion: history.originalQuestion || repliedMessage.content,
              historyName: history.historyName
            });
            
            for (let i = 1; i < chunks.length; i++) {
              const followUpMsg = await message.channel.send(chunks[i]);
              
              // Add follow-up message to conversation history
              conversationHistory.set(followUpMsg.id, {
                userId: message.author.id,
                messages: history.messages,
                originalQuestion: history.originalQuestion || repliedMessage.content,
                isFollowUp: true,
                parentId: sentMessage.id,
                historyName: history.historyName
              });
            }
          }
        } catch (error) {
          console.error('Error generating response:', error);
          // Update the processing message instead of deleting it
          await processingMessage.edit('Sorry, I encountered an error while processing your request.').catch(err => {
            console.error('Error updating processing message:', err);
          });
        }
      }
    } catch (error) {
      console.error('Error handling reply:', error);
      try {
        await message.reply('Sorry, I encountered an error while processing your request.');
      } catch (replyError) {
        console.error('Error sending error response:', replyError);
      }
    }
  }
});

// Add global error handler for unhandled promise rejections
process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
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