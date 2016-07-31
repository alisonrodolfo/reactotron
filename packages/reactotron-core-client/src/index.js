import R from 'ramda'
import validate from './validate'
import pluginLog from './plugin-log'
import { start } from './stopwatch'

const DEFAULTS = {
  io: null, // the socket.io function to create a socket
  host: 'localhost', // the server to connect (required)
  port: 9090, // the port to connect (required)
  name: 'reactotron-core-client', // some human-friendly session name
  onCommand: cmd => null, // the function called when we receive a command
  onConnect: () => null, // fires when we connect
  onDisconnect: () => null // fires when we disconnect
}

export const CorePlugins = [
  pluginLog
]

// these are not for you.
const isReservedFeature = R.contains(R.__, [
  'options', 'connected', 'socket', 'plugins',
  'configure', 'connect', 'send', 'addPlugin',
  'startTimer'
])

export class Client {

  // the configuration options
  options = R.merge({}, DEFAULTS)
  connected = false
  socket = null
  plugins = []

  startTimer = () => start()

  /**
   * Set the configuration options.
   */
  configure (options = {}) {
    // options get merged & validated before getting set
    const newOptions = R.merge(this.options, options)
    validate(newOptions)
    this.options = newOptions

    // if we have plugins, let's add them here
    if (R.isArrayLike(this.options.plugins)) {
      R.forEach(this.addPlugin.bind(this), this.options.plugins)
    }

    return this
  }

  /**
   * Connect to the Reactotron server.
   */
  connect () {
    this.connected = true
    const { io, host, port } = this.options
    const { onCommand, onConnect, onDisconnect } = this.options

    // establish a socket.io connection to the server
    const socket = io(`ws://${host}:${port}`, {
      jsonp: false,
      transports: ['websocket', 'polling']
    })

    // fires when we talk to the server
    socket.on('connect', () => {
      // fire our optional onConnect handler
      onConnect && onConnect()

      // trigger our plugins onConnect
      R.forEach(plugin => plugin.onConnect && plugin.onConnect(), this.plugins)

      // introduce ourselves
      socket.emit('hello.client', this.options)
    })

    // fires when we disconnect
    socket.on('disconnect', () => {
      // trigger our disconnect handler
      onDisconnect && onDisconnect()

      // as well as the plugin's onDisconnect
      R.forEach(plugin => plugin.onDisconnect && plugin.onDisconnect(), this.plugins)
    })

    // fires when we receive a command, just forward it off
    socket.on('command', command => onCommand && onCommand(command))

    // assign the socket to the instance
    this.socket = socket

    return this
  }

  /**
   * Sends a command to the server
   */
  send (type, payload) {
    this.socket.emit('command', { type, payload })
  }

  /**
   * Adds a plugin to the system
   */
  addPlugin (pluginCreator) {
    // we're supposed to be given a function
    if (typeof pluginCreator !== 'function') throw new Error('plugins must be a function')

    // execute it immediately passing the send function
    const plugin = pluginCreator({
      send: this.send.bind(this),
      ref: this
    })

    // ensure we get an Object-like creature back
    if (!R.is(Object, plugin)) throw new Error('plugins must return an object')

    // do we have features to mixin?
    if (plugin.features) {
      // validate
      if (!R.is(Object, plugin.features)) throw new Error('features must be an object')

      // here's how we're going to inject these in
      const inject = (key) => {
        // grab the function
        const featureFunction = plugin.features[key]

        // only functions may pass
        if (typeof featureFunction !== 'function') throw new Error(`feature ${key} is not a function`)

        // ditch reserved names
        if (isReservedFeature(key)) throw new Error(`feature ${key} is a reserved name`)

        // ok, let's glue it up... and lose all respect from elite JS champions.
        this[key] = featureFunction
      }

      // let's inject
      R.forEach(inject, R.keys(plugin.features))
    }

    // add it to the list
    this.plugins.push(plugin)

    // chain-friendly
    return this
  }

}

// convenience factory function
export const createClient = (options) => {
  const client = new Client()
  client.configure(options)
  return client
}
