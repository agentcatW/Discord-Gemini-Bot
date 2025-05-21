require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, Collection, AttachmentBuilder } = require('discord.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GoogleGenAI } = require('@google/genai');
const winston = require('winston');
const mime = require('mime-types');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'bot.log' })
  ]
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const textModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash-preview-04-17"});
const imageAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const allowedUserIds = process.env.ALLOWED_USER_IDS ? process.env.ALLOWED_USER_IDS.split(',') : [];

const commands = [
  new SlashCommandBuilder()
    .setName('e')
    .setDescription('Ask Gemini AI a question')
    .addStringOption(option =>
      option.setName('question')
        .setDescription('The question you want to ask')
        .setRequired(true)),
  new SlashCommandBuilder()
    .setName('image') 
    .setDescription('Generate an image using Gemini Image/Imagen')
    .addStringOption(option =>
      option.setName('prompt')
        .setDescription('The prompt for the image')
        .setRequired(true)),
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Get help with using the bot!'),
  new SlashCommandBuilder()
    .setName('info')
    .setDescription('Get information about the bot')
];

client.once('ready', async () => {
  logger.info(`Logged in as ${client.user.tag}!`);

  try {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    logger.info('Started refreshing application (/) commands.');

    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands },
    );

    logger.info('Successfully reloaded application (/) commands.');
  } catch (error) {
    logger.error('Error refreshing commands:', error);
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;

  const { commandName } = interaction;
  const userId = interaction.user.id;

  if (!allowedUserIds.includes(userId)) {
    const embed = new EmbedBuilder()
      .setColor('#FF0000')
      .setTitle('Access Denied')
      .setDescription('If you wish to use this bot contact @agent.cat on discord and he might allow you to use this bot.')
      .setFooter({ text: 'Bot maintained by agent.cat' });

    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  if (commandName === 'e') {
    await interaction.deferReply(); 

    try {
      const question = interaction.options.getString('question');

      if (!question || question.trim() === '') {
        const embed = new EmbedBuilder()
          .setColor('#FF0000')
          .setTitle('Invalid Input')
          .setDescription('Please provide a valid question.')
          .setFooter({ text: 'Bot maintained by agent.cat' });

        await interaction.editReply({ embeds: [embed] });
        return;
      }

      const customPrompt = `You are a helpful assistant in a Discord server. Respond in a concise, friendly manner. Provide clear, accurate information. If you don't know the answer, say so politely.`;
      const modifiedQuestion = `${customPrompt} ${question}`;
      const result = await textModel.generateContent(modifiedQuestion);
      const response = result.response.text();

      logger.info(`User ${userId} asked: ${question}`);

      if (response.length <= 2000) {
        const embed = new EmbedBuilder()
          .setColor('#0099FF')
          .setTitle('Response')
          .setDescription(response)
          .setFooter({ text: 'Bot maintained by agent.cat' });

        await interaction.editReply({ embeds: [embed] });
      } else {
        const chunks = splitMessage(response);
        const embed = new EmbedBuilder()
          .setColor('#0099FF')
          .setTitle('Response (Part 1)')
          .setDescription(chunks[0])
          .setFooter({ text: 'Bot maintained by agent.cat' });

        await interaction.editReply({ embeds: [embed] });

        for (let i = 1; i < chunks.length; i++) {
          const followUpEmbed = new EmbedBuilder()
            .setColor('#0099FF')
            .setTitle(`Response (Part ${i+1})`)
            .setDescription(chunks[i])
            .setFooter({ text: 'Bot maintained by agent.cat' });
          await interaction.followUp({ embeds: [followUpEmbed] });
        }
      }
    } catch (error) {
      logger.error('Error generating response (text):', error);
      const embed = new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle('Error')
        .setDescription('Sorry, I encountered an error while processing your text request.')
        .setFooter({ text: 'Bot maintained by agent.cat' });

      if (interaction.replied || interaction.deferred) {
        await interaction.editReply({ embeds: [embed] });
      } else {
        await interaction.reply({ embeds: [embed], ephemeral: true });
      }
    }

  } else if (commandName === 'image') { 
    await interaction.deferReply(); 

    try {
      const prompt = interaction.options.getString('prompt');

      if (!prompt || prompt.trim() === '') {
        const embed = new EmbedBuilder()
          .setColor('#FF0000')
          .setTitle('Invalid Input')
          .setDescription('Please provide a valid prompt for the image.')
          .setFooter({ text: 'Bot maintained by agent.cat' });

        await interaction.editReply({ embeds: [embed] });
        return;
      }

      try {
        const config = {
          responseModalities: [
            'IMAGE',
            'TEXT',
          ],
          responseMimeType: 'text/plain',
        };
        const model = 'gemini-2.0-flash-preview-image-generation';
        const contents = [
          {
            role: 'user',
            parts: [
              {
                text: prompt,
              },
            ],
          },
        ];

        const response = await imageAI.models.generateContentStream({
          model,
          config,
          contents,
        });

        const attachments = [];
        for await (const chunk of response) {
          if (!chunk.candidates || !chunk.candidates[0].content || !chunk.candidates[0].content.parts) {
            continue;
          }
          if (chunk.candidates[0].content.parts[0].inlineData) {
            const inlineData = chunk.candidates[0].content.parts[0].inlineData;
            const fileExtension = mime.lookup(inlineData.mimeType || '') ? mime.extension(inlineData.mimeType || '') : 'png';
            const buffer = Buffer.from(inlineData.data || '', 'base64');
            const attachment = new AttachmentBuilder(buffer, { name: `generated_image.${fileExtension}` });
            attachments.push(attachment);
          }
        }

        logger.info(`User ${userId} requested image for prompt: ${prompt}`);

        if (attachments.length > 0) {
          const embed = new EmbedBuilder()
            .setColor('#0099FF')
            .setTitle('Generated Image')
            .setDescription(`Prompt: "${prompt}"`)
            .setFooter({ text: 'Bot maintained by agent.cat' });
          await interaction.editReply({ embeds: [embed], files: attachments });
        } else {
          const embed = new EmbedBuilder()
            .setColor('#FFA500')
            .setTitle('Image Generation Failed')
            .setDescription('Sorry, I could not generate an image for that prompt.')
            .setFooter({ text: 'Bot maintained by agent.cat' });

          await interaction.editReply({ embeds: [embed] });
        }

      } catch (error) {
        if (error.message.includes("Imagen API is only accessible to billed users")) {
          const embed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('Image Generation Unavailable')
            .setDescription('The image generation feature requires a paid account. Please contact the bot administrator for more information.')
            .setFooter({ text: 'Bot maintained by agent.cat' });

          await interaction.editReply({ embeds: [embed] });
          return;
        } else {
          logger.error('Error generating response (image):', error);
          const embed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('Error')
            .setDescription('Sorry, I encountered an error while processing your image request.')
            .setFooter({ text: 'Bot maintained by agent.cat' });

          if (interaction.replied || interaction.deferred) {
            await interaction.editReply({ embeds: [embed] });
          } else {
            await interaction.reply({ embeds: [embed], ephemeral: true });
          }
        }
      }
    } catch (error) {
      logger.error('Error generating response (image):', error);
      const embed = new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle('Error')
        .setDescription('Sorry, I encountered an error while processing your image request.')
        .setFooter({ text: 'Bot maintained by agent.cat' });

      if (interaction.replied || interaction.deferred) {
        await interaction.editReply({ embeds: [embed] });
      } else {
        await interaction.reply({ embeds: [embed], ephemeral: true });
      }
    }
  } else if (commandName === 'help') {
    const embed = new EmbedBuilder()
      .setColor('#0099FF')
      .setTitle('Help')
      .setDescription('Available commands:\n\n' +
                     '`/e <question>` - Ask Gemini AI a question\n' +
                     '`/image <prompt>` - Generate an image using Gemini Image/Imagen\n' +
                     '`/help` - Show this help message\n' +
                     '`/info` - Get information about the bot')
      .addFields(
        { name: 'Usage Tips', value: 'Be specific with your questions/prompts for better answers.' },
        { name: 'Access', value: 'Bot usage is restricted to allowed users.'} 
      )
      .setFooter({ text: 'Bot maintained by agent.cat' });

    await interaction.reply({ embeds: [embed] });
  } else if (commandName === 'info') {
    const embed = new EmbedBuilder()
      .setColor('#0099FF')
      .setTitle('Bot Information')
      .setDescription('This is a Discord bot powered by Google AI (Gemini Text and Imagen).')
      .addFields(
        { name: 'Version', value: '1.1.0' }, 
        { name: 'Maintainer', value: '@agent.cat' },
        { name: 'Purpose', value: 'To provide helpful text responses and generate images' },
        { name: 'Text Model', value: 'Gemini 2.5 Flash' }, 
        { name: 'Image Model', value: 'Gemini 2.0 Flash Preview Image Generation' } 
      )
      .setFooter({ text: 'Bot maintained by agent.cat' });
    await interaction.reply({ embeds: [embed] });
  }
});

function splitMessage(message, maxLength = 2000) {
  const chunks = [];
  let currentChunk = '';

  const paragraphs = message.split('\n\n');
  for (const paragraph of paragraphs) {
    if (currentChunk.length + paragraph.length + 2 > maxLength) { 
      if (currentChunk) {
        chunks.push(currentChunk.trim()); 
        currentChunk = '';
      }
      if (paragraph.length > maxLength) {
        const lines = paragraph.split('\n');
        for (const line of lines) {
             const words = line.split(' ');
             for (const word of words) {
                if (currentChunk.length + word.length + 1 > maxLength) {
                    if (currentChunk) chunks.push(currentChunk.trim());
                    currentChunk = word;
                } else {
                    currentChunk += (currentChunk ? ' ' : '') + word;
                }
             }
             if (currentChunk && currentChunk !== line) { 
                 currentChunk += '\n';
             }
        }
         if (currentChunk) chunks.push(currentChunk.trim());
         currentChunk = ''; 
      } else {
         if (currentChunk) {
             currentChunk += '\n\n' + paragraph;
         } else {
             currentChunk = paragraph;
         }
      }
    } else {
      if (currentChunk) {
        currentChunk += '\n\n' + paragraph;
      } else {
        currentChunk = paragraph;
      }
    }
  }
  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }

  if (chunks.length === 0 && message.length > maxLength) {
      let i = 0;
      while (i < message.length) {
          chunks.push(message.substring(i, i + maxLength));
          i += maxLength;
      }
  } else if (chunks.length === 0 && message.length > 0) {
      chunks.push(message);
  }

  return chunks;
}

client.login(process.env.DISCORD_TOKEN);