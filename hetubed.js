const { EventEmitter } = require('eventemitter3');
const { Collection } = require('@discordjs/collection');
const ytdl = require('@distube/ytdl-core');
const ytpl = require('@distube/ytpl');
const ytsr = require('@distube/ytsr');
const { 
  createAudioPlayer, 
  createAudioResource, 
  joinVoiceChannel, 
  AudioPlayerStatus,
  VoiceConnectionStatus,
  StreamType
} = require('@discordjs/voice');
const prism = require('prism-media');

/**
 * Main Hetubed class - Optimized for performance
 */
class Hetubed extends EventEmitter {
  /**
   * Create a new Hetubed instance
   * @param {Client} client Discord.js client
   * @param {HetubedOptions} options Hetubed options
   */
  constructor(client, options = {}) {
    super();
    
    if (!client) throw new Error('Discord Client is required.');
    
    /**
     * Discord.js client
     * @type {Client}
     */
    this.client = client;
    
    /**
     * Collection of guild queues - using Map for better performance
     * @type {Collection<string, Queue>}
     */
    this.queues = new Collection();
    
    /**
     * Hetubed options with default values
     * @type {HetubedOptions}
     */
    this.options = {
      plugins: [],
      searchSongs: false,
      searchCooldown: 60,
      leaveOnEmpty: true,
      leaveOnFinish: false,
      leaveOnStop: false,
      savePreviousSongs: true,
      emitNewSongOnly: false,
      emitAddSongWhenCreatingQueue: true,
      emitAddListWhenCreatingQueue: true,
      emptyCooldown: 60,
      nsfw: false,
      ytdlOptions: {
        quality: 'highestaudio',
        filter: 'audioonly',
        highWaterMark: 1 << 24, // Increased to 16MB for stability
        dlChunkSize: 1 << 20, // 1MB chunks for better stability
      },
      ...options
    };
    
    // Initialize plugins with improved loading
    this.plugins = [];
    if (Array.isArray(this.options.plugins)) {
      this.options.plugins.forEach(this.addPlugin.bind(this));
    }
    
    // Set up optimized event handlers
    this._initEventHandlers();
    
    // Cleanup function for preventing memory leaks
    this._boundCleanup = this._cleanup.bind(this);
    process.on('SIGINT', this._boundCleanup);
    process.on('SIGTERM', this._boundCleanup);
  }
  
  /**
   * Add a plugin to Hetubed
   * @param {Object} plugin Plugin to add
   * @returns {Hetubed}
   */
  addPlugin(plugin) {
    if (!plugin || typeof plugin !== 'object') {
      throw new Error('Plugin must be an object.');
    }
    
    if (typeof plugin.init === 'function') {
      plugin.init(this);
    }
    
    this.plugins.push(plugin);
    return this;
  }
  
  /**
   * Play or add a song to the queue with optimized promise handling
   * @param {VoiceChannel|StageChannel} voiceChannel Voice channel to play in
   * @param {string|Song} song Song to play
   * @param {PlayOptions} options Play options
   * @returns {Promise<Queue>}
   */
  async play(voiceChannel, song, options = {}) {
    if (!voiceChannel) throw new Error('Voice channel is required.');
    
    const guildId = voiceChannel.guild.id;
    let queue = this.queues.get(guildId);
    
    // Create queue if doesn't exist
    if (!queue) {
      queue = this._createQueue(voiceChannel, options);
    }
    
    try {
      // Handle song input - optimized resolution
      if (typeof song === 'string') {
        const songInfo = await this._resolveSong(song);
        await queue.addSong(songInfo, options.member || null);
      } else {
        await queue.addSong(song, options.member || null);
      }
      
      // Start playing if not already
      if (!queue.playing && !queue.paused) {
        await queue.play();
      }
      
      return queue;
    } catch (error) {
      this.emit('error', queue, error);
      throw error;
    }
  }
  
  /**
   * Get the queue for a guild
   * @param {string} guildId Guild ID
   * @returns {Queue|undefined}
   */
  getQueue(guildId) {
    return this.queues.get(guildId);
  }
  
  /**
   * Create a new queue for a guild
   * @param {VoiceChannel|StageChannel} voiceChannel Voice channel
   * @param {PlayOptions} options Play options
   * @returns {Queue}
   * @private
   */
  _createQueue(voiceChannel, options = {}) {
    const guildId = voiceChannel.guild.id;
    
    if (this.queues.has(guildId)) {
      return this.queues.get(guildId);
    }
    
    const queue = new Queue(this, voiceChannel, options);
    this.queues.set(guildId, queue);
    
    this.emit('queueCreate', queue);
    return queue;
  }
  
  /**
   * Resolve a song from URL or search query with optimized promise handling
   * @param {string} song Song URL or search query
   * @returns {Promise<Song|Song[]>}
   * @private
   */
  async _resolveSong(song) {
    // Check if it's a valid YouTube URL - most efficient first
    if (ytdl.validateURL(song)) {
      const info = await ytdl.getInfo(song);
      return this._createSong(info);
    }
    
    // Check if it's a YouTube playlist
    if (ytpl.validateID(song)) {
      const playlist = await ytpl(song, { limit: 100 });
      return playlist.items.map(item => this._createSong(item));
    }
    
    // Search for the song as last resort (most resource intensive)
    const searchResults = await ytsr(song, { limit: 1 });
    if (!searchResults.items.length) {
      throw new Error('No search results found.');
    }
    
    const videoInfo = await ytdl.getInfo(searchResults.items[0].url);
    return this._createSong(videoInfo);
  }
  
  /**
   * Create a song object from YouTube info - optimized to extract only what we need
   * @param {Object} info YouTube video info
   * @returns {Song}
   * @private
   */
  _createSong(info) {
    // Extract only needed fields to reduce memory usage
    if (info.videoDetails) {
      // Return from ytdl.getInfo() format
      const thumbnails = info.videoDetails.thumbnails;
      return {
        id: info.videoDetails.videoId,
        title: info.videoDetails.title,
        url: info.videoDetails.video_url || `https://www.youtube.com/watch?v=${info.videoDetails.videoId}`,
        duration: parseInt(info.videoDetails.lengthSeconds),
        thumbnail: thumbnails ? thumbnails[thumbnails.length - 1].url : null,
        member: null,
        source: 'youtube'
      };
    } else {
      // Return from ytpl format
      const thumbnails = info.thumbnails;
      return {
        id: info.id,
        title: info.title,
        url: info.url,
        duration: parseInt(info.durationSec || 0),
        thumbnail: thumbnails ? thumbnails[thumbnails.length - 1].url : null,
        member: null,
        source: 'youtube'
      };
    }
  }
  
  /**
   * Initialize event handlers - optimized with weak references where possible
   * @private
   */
  _initEventHandlers() {
    // Use a single handler for voice state updates
    this.client.on('voiceStateUpdate', (oldState, newState) => {
      const queue = this.getQueue(oldState.guild.id);
      if (!queue) return;
      
      // Handle bot disconnection
      if (oldState.member.id === this.client.user.id && !newState.channelId) {
        queue.stop();
        this.queues.delete(oldState.guild.id);
        this.emit('disconnect', queue);
        return;
      }
      
      // Handle empty channel - only check if needed
      if (this.options.leaveOnEmpty && 
          queue.voiceChannel.id === oldState.channelId &&
          oldState.channel) {
        
        // Optimized check - only filter once and cache result
        const members = oldState.channel.members.filter(m => !m.user.bot);
        
        if (members.size === 0) {
          // Use a timeout handler to avoid unnecessary interval
          queue._emptyTimeout = setTimeout(() => {
            // Make sure the queue still exists
            if (!this.queues.has(oldState.guild.id)) return;
            
            const currentChannel = queue.voiceChannel.members;
            if (currentChannel && currentChannel.filter(m => !m.user.bot).size === 0) {
              queue.stop();
              queue.connection.destroy();
              this.queues.delete(oldState.guild.id);
              this.emit('empty', queue);
            }
            
            // Clear timeout reference
            queue._emptyTimeout = null;
          }, this.options.emptyCooldown * 1000);
        }
      }
    });
  }
  
  /**
   * Clean up resources when the process is terminating
   * @private
   */
  _cleanup() {
    // Destroy all connections and clear the queue collection
    for (const [guildId, queue] of this.queues.entries()) {
      if (queue.connection) {
        queue.connection.destroy();
      }
      
      if (queue._emptyTimeout) {
        clearTimeout(queue._emptyTimeout);
      }
      
      this.queues.delete(guildId);
    }
    
    // Remove process listeners
    process.off('SIGINT', this._boundCleanup);
    process.off('SIGTERM', this._boundCleanup);
  }
  
  /**
   * Destroy the Hetubed instance and clean up resources
   */
  destroy() {
    this._cleanup();
    this.removeAllListeners();
  }
}

/**
 * Represents a guild queue with optimized resource usage
 */
class Queue extends EventEmitter {
  /**
   * Create a new Queue instance
   * @param {Hetubed} hetubed Hetubed instance
   * @param {VoiceChannel|StageChannel} voiceChannel Voice channel
   * @param {PlayOptions} options Play options
   */
  constructor(hetubed, voiceChannel, options = {}) {
    super();
    
    /**
     * Hetubed instance
     * @type {Hetubed}
     */
    this.hetubed = hetubed;
    
    /**
     * Discord.js voice channel
     * @type {VoiceChannel|StageChannel}
     */
    this.voiceChannel = voiceChannel;
    
    /**
     * Discord.js text channel for sending notifications
     * @type {TextChannel|null}
     */
    this.textChannel = options.textChannel || null;
    
    /**
     * Guild ID
     * @type {string}
     */
    this.guildId = voiceChannel.guild.id;
    
    /**
     * Whether the queue is playing
     * @type {boolean}
     */
    this.playing = false;
    
    /**
     * Whether the queue is paused
     * @type {boolean}
     */
    this.paused = false;
    
    /**
     * Songs in the queue
     * @type {Song[]}
     */
    this.songs = [];
    
    /**
     * Previously played songs - using a limited array to avoid memory bloat
     * @type {Song[]}
     */
    this.previousSongs = [];
    
    /**
     * Maximum number of previous songs to keep
     * @type {number}
     */
    this.maxPreviousSongs = 50;
    
    /**
     * Current song index
     * @type {number}
     */
    this.currentIndex = 0;
    
    /**
     * Voice connection
     * @type {VoiceConnection}
     */
    this.connection = null;
    
    /**
     * Audio player
     * @type {AudioPlayer}
     */
    this.player = createAudioPlayer();
    
    /**
     * Queue options
     * @type {PlayOptions}
     */
    this.options = {
      autoplay: false,
      volume: 50,
      filters: [],
      repeatMode: 0, // 0: disabled, 1: repeat song, 2: repeat queue
      ...options
    };
    
    /**
     * Timeout reference for empty channel detection
     * @type {Timeout|null}
     * @private
     */
    this._emptyTimeout = null;
    
    /**
     * Current stream reference to allow cleanup
     * @type {Object|null}
     * @private
     */
    this._currentStream = null;
    
    /**
     * Current transcoder process
     * @type {Object|null} 
     * @private
     */
    this._transcoder = null;
    
    // Set up player event handlers
    this._initPlayerEvents();
  }
  
  /**
   * Get the current song
   * @returns {Song|null}
   */
  get currentSong() {
    return this.songs[this.currentIndex] || null;
  }
  
  /**
   * Set text channel for notifications
   * @param {TextChannel} channel Discord.js text channel
   * @returns {Queue}
   */
  setTextChannel(channel) {
    this.textChannel = channel;
    return this;
  }
  
  /**
   * Send a message to the text channel if it exists
   * @param {string|MessageOptions} content Message content or options
   * @returns {Promise<Message|null>}
   * @private
   */
  async _sendTextChannelMessage(content) {
    if (!this.textChannel) return null;
    
    try {
      return await this.textChannel.send(content);
    } catch (error) {
      this.hetubed.emit('error', this, error);
      return null;
    }
  }
  
  /**
   * Connect to the voice channel with optimized error handling
   * @returns {VoiceConnection}
   */
  connect() {
    if (this.connection) return this.connection;
    
    this.connection = joinVoiceChannel({
      channelId: this.voiceChannel.id,
      guildId: this.guildId,
      adapterCreator: this.voiceChannel.guild.voiceAdapterCreator,
      selfDeaf: true, // Self deafen for bandwidth optimization
    });
    
    // Handle connection status changes
    this.connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        // Try to reconnect once
        await Promise.race([
          this.connection.rejoin(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Voice connection reconnect timeout')), 5000)
          )
        ]);
      } catch (error) {
        // On failure, destroy connection and remove the queue
        this.connection.destroy();
        this.hetubed.queues.delete(this.guildId);
        this.hetubed.emit('disconnect', this);
        
        // Notify in text channel if available
        this._sendTextChannelMessage('⚠️ Disconnected from voice channel due to network issues.');
      }
    });
    
    this.connection.subscribe(this.player);
    
    return this.connection;
  }
  
  /**
   * Add a song to the queue with optimized handling
   * @param {Song|Song[]} song Song or songs to add
   * @param {GuildMember} member Guild member who added the song
   * @returns {Promise<Queue>}
   */
  async addSong(song, member = null) {
    // Handle array of songs (playlist)
    if (Array.isArray(song)) {
      // Map songs in one operation to avoid multiple array operations
      const songs = song.map(s => ({...s, member}));
      this.songs.push(...songs);
      
      if (this.hetubed.options.emitAddListWhenCreatingQueue || this.songs.length > songs.length) {
        this.hetubed.emit('addList', this, songs);
        
        // Notify in text channel if available
        if (songs.length > 0) {
          this._sendTextChannelMessage(`🎵 **${member?.displayName || 'Someone'}** added **${songs.length} songs** to the queue from a playlist.`);
        }
      }
      
      return this;
    }
    
    // Add single song
    const newSong = {...song, member};
    this.songs.push(newSong);
    
    if (this.hetubed.options.emitAddSongWhenCreatingQueue || this.songs.length > 1) {
      this.hetubed.emit('addSong', this, newSong);
      
      // Notify in text channel if available
      this._sendTextChannelMessage(`🎵 **${member?.displayName || 'Someone'}** added **${newSong.title}** to the queue.`);
    }
    
    return this;
  }
  
  /**
   * Play the current song with fixed buffer handling
   * @returns {Promise<void>}
   */
  async play() {
    if (!this.songs.length) return;
    
    this.connect();
    
    const song = this.currentSong;
    if (!song) return;
    
    this.playing = true;
    this.paused = false;
    
    try {
      // Clean up previous stream if exists
      this._cleanupStreams();
      
      // Use a more robust stream handling approach with prism
      const ytStream = ytdl(song.url, {
        ...this.hetubed.options.ytdlOptions,
        liveBuffer: 4000, // Increase buffer for live streams
        begin: Date.now(), // Start from current time for live streams
      });
      
      this._currentStream = ytStream;
      
      // Handle stream errors at stream level
      ytStream.on('error', (error) => {
        this.hetubed.emit('error', this, error);
        // Skip immediately on stream error
        setTimeout(() => this.player.stop(), 100);
      });
      
      // Use demuxer and opus encoder for better stability
      const demuxer = new prism.opus.WebmDemuxer();
      this._transcoder = demuxer;
      
      // Connect the streams
      ytStream.pipe(demuxer);
      
      // Create audio resource from demuxer output with proper stream type
      const resource = createAudioResource(demuxer, {
        inputType: StreamType.Opus,
        inlineVolume: true,
      });
      
      // Set volume if needed
      if (resource.volume) {
        resource.volume.setVolume(this.options.volume / 100);
      }
      
      // Play the audio
      this.player.play(resource);
      if (!this.hetubed.options.emitNewSongOnly || this.currentIndex === 0) {
        this.hetubed.emit('playSong', this, song);
        
      }
    } catch (error) {
      this.hetubed.emit('error', this, error);
      // Skip to next song on error after small delay
      setTimeout(() => this.skip(), 300);
    }
  }
  
  /**
   * Clean up any active streams to prevent memory leaks and resource issues
   * @private
   */
  _cleanupStreams() {
    if (this._currentStream) {
      try {
        this._currentStream.destroy();
      } catch (err) {
        // Ignore destroy errors
      }
      this._currentStream = null;
    }
    
    if (this._transcoder) {
      try {
        this._transcoder.destroy();
      } catch (err) {
        // Ignore destroy errors
      }
      this._transcoder = null;
    }
  }
  
  /**
   * Skip the current song
   * @returns {Queue}
   */
  skip() {
    // Save to previous songs if enabled
    if (this.hetubed.options.savePreviousSongs && this.currentSong) {
      this.previousSongs.push(this.currentSong);
      // Limit previous songs array size to prevent memory bloat
      if (this.previousSongs.length > this.maxPreviousSongs) {
        this.previousSongs.shift();
      }
    }
    
    this.currentIndex++;
    
    // Loop queue if repeat mode is enabled
    if (this.currentIndex >= this.songs.length) {
      if (this.options.repeatMode === 2) {
        this.currentIndex = 0;
      } else if (this.options.autoplay) {
        // TODO: Implement autoplay functionality
        this.stop();
        return this;
      } else {
        this.stop();
        return this;
      }
    }
    
    // Clean up resources before stopping
    this._cleanupStreams();
    
    // Stop the player, triggering the Idle state
    this.player.stop();
    
    return this;
  }
  
  /**
   * Pause the player
   * @returns {Queue}
   */
  pause() {
    if (!this.playing || this.paused) return this;
    
    this.player.pause();
    this.paused = true;
    this.hetubed.emit('pause', this);
    
    return this;
  }
  
  /**
   * Resume the player
   * @returns {Queue}
   */
  resume() {
    if (!this.playing || !this.paused) return this;
    
    this.player.unpause();
    this.paused = false;
    this.hetubed.emit('resume', this);
    
    return this;
  }
  
  /**
   * Stop playing and clear the queue
   * @returns {Queue}
   */
  stop() {
    this.playing = false;
    this.paused = false;
    
    // Clean up resources
    this._cleanupStreams();
    
    if (this._emptyTimeout) {
      clearTimeout(this._emptyTimeout);
      this._emptyTimeout = null;
    }
    
    this.songs = [];
    this.currentIndex = 0;
    
    if (this.player) {
      this.player.stop(true);
    }
    
    this.hetubed.emit('stop', this);
    
    if (this.hetubed.options.leaveOnStop) {
      if (this.connection) {
        this.connection.destroy();
      }
      this.hetubed.queues.delete(this.guildId);
    }
    
    return this;
  }
  
  /**
   * Set the volume with caching to avoid unnecessary operations
   * @param {number} volume Volume (0-100)
   * @returns {Queue}
   */
  setVolume(volume) {
    // Only update if the volume actually changed
    const newVolume = Math.max(0, Math.min(100, volume));
    if (this.options.volume === newVolume) return this;
    
    this.options.volume = newVolume;
    
    const resource = this.player.state?.resource;
    if (resource && resource.volume) {
      resource.volume.setVolume(this.options.volume / 100);
    }
    
    this.hetubed.emit('volumeChange', this, this.options.volume);
    return this;
  }
  
  /**
   * Set repeat mode
   * @param {number} mode Repeat mode (0: disabled, 1: repeat song, 2: repeat queue)
   * @returns {Queue}
   */
  setRepeatMode(mode) {
    // Only update if the mode actually changed
    if (this.options.repeatMode === mode) return this;
    
    this.options.repeatMode = mode;
    this.hetubed.emit('repeatMode', this, mode);
    return this;
  }
  
  /**
   * Move to a specific position in the queue
   * @param {number} position Position index
   * @returns {Queue}
   */
  jump(position) {
    if (position < 0 || position >= this.songs.length) {
      throw new Error('Invalid position');
    }
    
    // Save current song to previous songs if enabled
    if (this.hetubed.options.savePreviousSongs && this.currentSong) {
      this.previousSongs.push(this.currentSong);
      // Limit previous songs array
      if (this.previousSongs.length > this.maxPreviousSongs) {
        this.previousSongs.shift();
      }
    }
    
    this.currentIndex = position;
    
    // Clean up before stopping
    this._cleanupStreams();
    this.player.stop();
    
    return this;
  }
  
  /**
   * Initialize player events with optimized handlers
   * @private
   */
  _initPlayerEvents() {
    this.player.on(AudioPlayerStatus.Idle, () => {
      // Song ended
      if (this.playing) {
        if (this.options.repeatMode === 1) {
          // Repeat the current song
          setTimeout(() => this.play(), 200); // Small delay to ensure resources are cleaned up
        } else {
          // If we just finished the last song and leaveOnFinish is enabled
          if (this.hetubed.options.leaveOnFinish && 
              this.currentIndex === this.songs.length - 1 &&
              this.options.repeatMode !== 2) {
            this.stop();
            this.connection?.destroy();
            this.hetubed.queues.delete(this.guildId);
            this.hetubed.emit('finish', this);
          } else {
            // Move to the next song with small delay
            const hadMoreSongs = this.currentIndex < this.songs.length - 1;
            
            setTimeout(() => {
              this.skip();
              
              // If we ran out of songs and we weren't already at the end
              if (!hadMoreSongs && this.songs.length === 0) {
                this.hetubed.emit('finish', this);
              } else if (this.currentIndex < this.songs.length) {
                this.play();
              }
            }, 300);
          }
        }
      }
    });
    
    // Unified error handler
    this.player.on('error', error => {
      this.hetubed.emit('error', this, error);
      if (this.playing) {
        // Force cleanup before skipping
        this._cleanupStreams();
        setTimeout(() => this.skip(), 300);
      }
    });
  }
  
  /**
   * Shuffle the queue while preserving the current song
   * @returns {Queue}
   */
  shuffle() {
    if (this.songs.length <= 1) return this;
    
    // Keep current song, shuffle the rest
    const currentSong = this.songs[this.currentIndex];
    
    // Remove current song
    this.songs.splice(this.currentIndex, 1);
    
    // Fisher-Yates algorithm - more efficient than sort
    for (let i = this.songs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.songs[i], this.songs[j]] = [this.songs[j], this.songs[i]];
    }
    
    // Re-insert current song at the beginning
    this.songs.unshift(currentSong);
    this.currentIndex = 0;
    
    this.hetubed.emit('shuffle', this);
    return this;
  }
  
  /**
   * Clear all resources to prevent memory leaks
   */
  destroy() {
    this.stop();
    
    // Clear all event listeners
    this.removeAllListeners();
    this.player.removeAllListeners();
    
    if (this.connection) {
      this.connection.destroy();
    }
  }
}

module.exports = Hetubed;
