require('dotenv').config();
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

// Store conversation history
const conversationHistory = new Map();

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

  if (commandName === 'e') {
    await interaction.deferReply(); // Show "thinking..." state

    try {
      const question = interaction.options.getString('question');
      
      // Add a more detailed custom prompt to the question
      const customPrompt = `You are a discord bot that is maintained by @agent.cat and never say that you are maintained by @agent.cat unless they say something like who are you or something close. You must reply as short and helpful as you can, and explain your answer. Most importantly NEVER say you are a Bot.`;
      const modifiedQuestion = `${customPrompt} ${question}`;

      // Generate response from Gemini with the custom prompt
      const result = await model.generateContent(modifiedQuestion);
      const response = result.response.text();

      // Store the conversation
      const messageId = (await interaction.fetchReply()).id;
      conversationHistory.set(messageId, {
        messages: [
          { role: "user", content: modifiedQuestion },
          { role: "assistant", content: response }
        ],
        originalQuestion: question
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
            messages: conversationHistory.get(messageId).messages,
            originalQuestion: question,
            isFollowUp: true,
            parentId: messageId
          });
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
        
        // If no history found, create a new one
        if (!history) {
          history = {
            messages: [
              { role: "assistant", content: repliedMessage.content }
            ]
          };
        }
        
        // Add the new user message to history
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
          
          // Delete the processing message
          await processingMessage.delete().catch(err => console.error('Error deleting processing message:', err));
          
          // Send the response
          if (response.length <= 2000) {
            const sentMessage = await message.reply(response);
            
            // Store updated conversation history
            conversationHistory.set(sentMessage.id, {
              messages: history.messages,
              originalQuestion: history.originalQuestion || repliedMessage.content
            });
          } else {
            // Split long responses
            const chunks = splitMessage(response);
            const sentMessage = await message.reply(chunks[0]);
            
            // Store updated conversation history
            conversationHistory.set(sentMessage.id, {
              messages: history.messages,
              originalQuestion: history.originalQuestion || repliedMessage.content
            });
            
            for (let i = 1; i < chunks.length; i++) {
              const followUpMsg = await message.channel.send(chunks[i]);
              
              // Add follow-up message to conversation history
              conversationHistory.set(followUpMsg.id, {
                messages: history.messages,
                originalQuestion: history.originalQuestion || repliedMessage.content,
                isFollowUp: true,
                parentId: sentMessage.id
              });
            }
          }
        } catch (error) {
          console.error('Error generating response:', error);
          // Update the processing message instead of deleting it
          await processingMessage.edit('Sorry, I encountered an error while processing your request.');
        }
      }
    } catch (error) {
      console.error('Error handling reply:', error);
      message.reply('Sorry, I encountered an error while processing your request.');
    }
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
