# Hetube
an fork of distube, focusing in the best performance

# Main Features / Differences from original Distube

- Yet depends on the @distube/ytdl-core, will be changed soon.

- Faster resolving and less recourses intensive

- Better Queue management in memory

- Built in youtube support, without needing to install plugins

- Way faster in emitting events, since its using eventemitter3

- Crystal clear audios, no CPU instensive for the best audio quality and playback

- Better compatibility with discord voice handling itself (Opus formats)

- Lots of methods, like play, pause, resume, skip, stop, getQueue, etc...

- Auto cleanup system for better recourses managemanent.

# Example bot Below

```js
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const Hetubed = require('./hetubed.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const hetubed = new Hetubed(client, {
  leaveOnFinish: false,
  leaveOnEmpty: true,
  emitAddSongWhenCreatingQueue: true,
  emitAddListWhenCreatingQueue: true,
});

// Set bot token from environment variable
const token = "PutYourEpicTokenHere"

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
});

client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;
    
    const prefix = '!';
    if (!message.content.startsWith(prefix)) return;
    
    const args = message.content.slice(prefix.length).trim().split(/ +/g);
    const command = args.shift().toLowerCase();
    
    if (command === 'play') {
      const voiceChannel = message.member.voice.channel;
      if (!voiceChannel) {
        return message.reply('You need to be in a voice channel to play music!');
      }
      
      const query = args.join(' ');
      if (!query) return message.reply('Please provide a song to play!');
      
      try {
        await hetubed.play(voiceChannel, query, {
          member: message.member,
          textChannel: message.channel,
        });
      } catch (error) {
        console.error(error);
        message.reply(`Error: ${error.message}`);
      }
    }
    
    else if (command === 'stop') {
      const queue = hetubed.getQueue(message.guild.id);
      if (!queue) return message.reply('There is nothing playing!');
      
      queue.stop();
      message.reply('Stopped the music!');
    }
    
    else if (command === 'skip') {
      const queue = hetubed.getQueue(message.guild.id);
      if (!queue) return message.reply('There is nothing playing!');
      
      queue.skip();
      message.reply('Skipped the current song!');
    }
    
    else if (command === 'pause') {
      const queue = hetubed.getQueue(message.guild.id);
      if (!queue) return message.reply('There is nothing playing!');
      
      queue.pause();
      message.reply('Paused the music!');
    }
    
    else if (command === 'resume') {
      const queue = hetubed.getQueue(message.guild.id);
      if (!queue) return message.reply('There is nothing playing!');
      
      queue.resume();
      message.reply('Resumed the music!');
    }
    
    else if (command === 'volume') {
      const queue = hetubed.getQueue(message.guild.id);
      if (!queue) return message.reply('There is nothing playing!');
      
      const volume = parseInt(args[0]);
      if (isNaN(volume) || volume < 0 || volume > 100)
        return message.reply('Please provide a valid volume between 0-100!');
      
      queue.setVolume(volume);
      message.reply(`Set volume to ${volume}%`);
    }
    
    else if (command === 'queue') {
      const queue = hetubed.getQueue(message.guild.id);
      if (!queue) return message.reply('There is nothing playing!');
      
      const songs = queue.songs.map((song, i) => 
        `${i === queue.currentIndex ? '**Now Playing**' : `${i + 1}.`} ${song.title} [${formatDuration(song.duration)}]`
      ).join('\n');
      
      message.reply(`**Queue**\n${songs}`);
    }
  });
  
  function formatDuration(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  }

hetubed.on('playSong', (queue, song) => {
    console.log(`Now playing: ${song.title} asdsadsa`);
    const embed = new EmbedBuilder()
      .setTitle('Now Playing')
      .setDescription(`[${song.title}](${song.url})`)
      .setThumbnail(song.thumbnail)
      .addFields(
        { name: 'Duration', value: formatDuration(song.duration), inline: true },
        { name: 'Requested by', value: song.member.displayName, inline: true }
      )
      .setColor('#00FF00');
    queue.textChannel.send({ embeds: [embed] });
  });
  
  hetubed.on('addSong', (queue, song) => {
    queue.textChannel.send(`Added **${song.title}** to the queue!`);
  });
  
  hetubed.on('addList', (queue, songs) => {
    queue.textChannel.send(`Added ${songs.length} songs to the queue!`);
  });
  
  hetubed.on('error', (queue, error) => {
    console.error(error);
    queue.textChannel.send(`Error: ${error.message}`);
  });
// Login to Discord
client.login(token);
```
